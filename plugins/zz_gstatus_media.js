import { Module } from "../lib/plugins.js";
import { generateWAMessageContent, generateWAMessageFromContent, generateMessageID, jidNormalizedUser } from "@whiskeysockets/baileys";
import crypto from "crypto";

async function admin(m) {
  // Group-status posting is intentionally available to every group member.
  // The WhatsApp account itself does not need group-admin status for this command.
  if (!m?.isGroup) {
    await m.send("❌ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ɪɴ ᴀ ɢʀᴏᴜᴘ.").catch(()=>{});
    return false;
  }
  return true;
}

async function relayStatus(conn, jid, storyData) {
  if (!jid?.endsWith("@g.us")) throw new Error("Group status requires a group chat");
  if (!conn?.user?.id) throw new Error("WhatsApp session is not connected");
  const senderJid = jidNormalizedUser(conn.user.id);
  const contextInfo = {
    forwardingScore: 0,
    featureEligibilities: { canBeReshared: true, canReceiveMultiReact: true },
    pairedMediaType: 0,
    statusSourceType: 4,
    statusAttributions: [{ type: 6, groupStatus: { authorJid: senderJid } }],
    isGroupStatus: true,
    statusAudienceMetadata: { audienceType: 1, listEmoji: "📌", listName: "Group Status" },
  };

  if (storyData?.text != null) {
    const messageSecret = crypto.randomBytes(32);
    const inner = {
      extendedTextMessage: {
        text: String(storyData.text),
        backgroundArgb: (storyData.backgroundColor ?? 0xff128c7e) >>> 0,
        textArgb: 0xffffffff,
        font: Number.isInteger(storyData.font) ? storyData.font : 1,
        contextInfo,
      },
    };
    inner.messageContextInfo = { messageSecret };
    const envelope = { messageContextInfo: { messageSecret }, groupStatusMessageV2: { message: inner } };
    const generated = generateWAMessageFromContent(jid, envelope, { userJid: senderJid });
    await conn.relayMessage(jid, generated.message, { messageId: generated.key?.id || generateMessageID() });
    return;
  }

  // Upload media first, then relay it inside the native groupStatusMessageV2
  // envelope. Sending the uploaded image/video directly would create a normal
  // group-chat message instead of a status post.
  const generatedContent = await generateWAMessageContent(storyData, {
    upload: conn.waUploadToServer,
  });
  const inner = generatedContent?.message || generatedContent;
  if (!inner || typeof inner !== "object") throw new Error("Could not build group-status media payload");
  const mediaKey = Object.keys(inner).find((key) => ["imageMessage", "videoMessage", "audioMessage", "stickerMessage"].includes(key));
  if (!mediaKey) throw new Error("Unsupported group-status media type; use image, video, or audio");
  inner[mediaKey].contextInfo = { ...(inner[mediaKey].contextInfo || {}), ...contextInfo };
  const messageSecret = crypto.randomBytes(32);
  inner.messageContextInfo = { messageSecret };
  const envelope = { messageContextInfo: { messageSecret }, groupStatusMessageV2: { message: inner } };
  const generated = generateWAMessageFromContent(jid, envelope, { userJid: senderJid });
  await conn.relayMessage(jid, generated.message, { messageId: generated.key?.id || generateMessageID() });
}

async function storyFromQuoted(q, caption) {
  const type = q?.type || q?.mtype || "";
  if (!q || !["imageMessage","videoMessage","audioMessage","stickerMessage","documentMessage"].includes(type)) return null;
  const media = await q.download();
  if (!media?.length) throw new Error("Media download failed");
  if (type === "imageMessage") return { image: media, caption: caption || q.body || q.caption || "" };
  if (type === "videoMessage") return { video: media, caption: caption || q.body || q.caption || "" };
  if (type === "audioMessage") return { audio: media, mimetype: q.mimetype || "audio/ogg; codecs=opus", ptt: !!q.ptt };
  if (type === "stickerMessage") return { sticker: media };
  if (type === "documentMessage") return { document: media, mimetype: q.mimetype || "application/octet-stream", fileName: q.fileName || "status-file" };
  return null;
}

Module({command:"gstatus", aliases:["gs","gcstatus","groupstatus","poststatus"], package:"group", description:"Post text or replied media as group status"})(async(m,a)=>{
  try {
    if (!(await admin(m))) return;
    const caption=String(a||"").trim();
    const quoted=m.quoted;
    const media=await storyFromQuoted(quoted,caption);
    await m.react("⏳").catch(()=>{});
    if (media) await relayStatus(m.conn,m.from,media);
    else if (caption) await relayStatus(m.conn,m.from,{text:caption,backgroundColor:0xff128c7e,font:1});
    else return m.send("❌ ᴛᴇxᴛ ᴅᴀᴏ ʙᴀ ɪᴍᴀɢᴇ/ᴠɪᴅᴇᴏ/ᴀᴜᴅɪᴏ/sᴛɪᴄᴋᴇʀ ʀᴇᴘʟʏ ᴋᴏʀᴏɴ.");
    await m.react("✅").catch(()=>{});
    return m.send("╭━━〔 ✦ 𝐆𝐒𝐓𝐀𝐓𝐔𝐒 ✦ 〕━━╮\n┃ 🟢 ʀᴇǫᴜᴇsᴛ sᴜʙᴍɪᴛᴛᴇᴅ ᴛᴏ ᴡʜᴀᴛsᴀᴘᴘ\n┃ 📦 ᴛᴇxᴛ / ɪᴍᴀɢᴇ / ᴠɪᴅᴇᴏ / ᴀᴜᴅɪᴏ\n╰━━━━━━━━━━━━━━━━━━╯");
  } catch(e) { await m.react("❌").catch(()=>{}); return m.send(`❌ ɢsᴛᴀᴛᴜs ᴇʀʀᴏʀ : ${String(e?.message||e).slice(0,180)}`); }
});

Module({command:"gstatusall", aliases:["gsall"], package:"group", description:"Post text or replied media to group statuses"})(async(m,a)=>{
  try {
    if (!(await admin(m))) return;
    const caption=String(a||"").trim();
    const media=await storyFromQuoted(m.quoted,caption);
    if (!media && !caption) return m.send("❌ ᴛᴇxᴛ ᴅᴀᴏ ʙᴀ ᴍᴇᴅɪᴀ ʀᴇᴘʟʏ ᴋᴏʀᴏɴ.");
    const story=media || {text:caption,backgroundColor:0xff128c7e,font:1};
    const groups=await m.conn.groupFetchAllParticipating();
    const ids=Object.keys(groups||{});
    let sent=0,failed=0;
    for(const id of ids){ try { await relayStatus(m.conn,id,story); sent++; } catch(e){ failed++; console.error("[gstatusall]",id,e?.message||e); } }
    return m.send(`╭━━〔 ɢsᴛᴀᴛᴜsᴀʟʟ 〕━━╮\n┃ ᴛᴏᴛᴀʟ : ${ids.length}\n┃ sᴇɴᴛ : ${sent}\n┃ ғᴀɪʟᴇᴅ : ${failed}\n╰━━━━━━━━━━━━━━╯`);
  } catch(e) { return m.send(`❌ ɢsᴛᴀᴛᴜsᴀʟʟ ᴇʀʀᴏʀ : ${String(e?.message||e).slice(0,180)}`); }
});
