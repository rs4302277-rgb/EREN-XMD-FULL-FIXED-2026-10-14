import fs from "node:fs/promises";
import path from "node:path";
import { Module } from "../lib/plugins.js";
import { db } from "../lib/client.js";
import config from "../config.js";

const ROOT = path.join(process.cwd(), "data", "tagreply");
const savedKey = "global:setmention";
const cleanNumber = (value) => String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
const botNumber = (conn) => cleanNumber(conn?.user?.id || conn?.user?.jid || "bot") || "bot";
// Accept every explicitly configured owner, regardless of +, spaces, JID suffix,
// or Baileys device suffix. Keep config.ownerNumber as the primary display owner.
const OWNER_NUMBERS = new Set([
  "6297085571", "7029177912", "7431831126", // India (+91)
  "44520793", // Armenia (+374)
  config.ownerNumber || config.owner || process.env.OWNER_NUMBER || "",
].map((value) => cleanNumber(value)).filter(Boolean));
const ownerNumber = () => cleanNumber(config.ownerNumber || config.owner || process.env.OWNER_NUMBER);
const isOwner = (message) => {
  const candidates = [
    message?.sender, message?.key?.participant, message?.key?.participantAlt,
    message?.participant, message?.author, message?.jid,
  ];
  return candidates.some((value) => {
    const sender = cleanNumber(value);
    return sender && OWNER_NUMBERS.has(sender);
  });
};
const mimeOf = (q) => String(q?.msg?.mimetype || q?.mimetype || "");
const fileExt = (mime, type) => type === "image" ? "jpg" : type === "video" ? "mp4" : type === "audio" ? "ogg" : type === "sticker" ? "webp" : (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";

async function saveQuoted(message) {
  const q = message.quoted;
  if (!q) throw new Error("Reply to a text, photo, video, audio, sticker or document.");
  const qType = String(q.type || q.mtype || "");
  const mime = mimeOf(q);
  const type = qType === "stickerMessage" || /sticker/.test(mime) ? "sticker"
    : qType === "imageMessage" ? "image"
    : qType === "videoMessage" ? "video"
    : qType === "audioMessage" ? "audio"
    : qType === "documentMessage" ? "document"
    : mime.startsWith("image/") ? "image"
    : mime.startsWith("video/") ? "video"
    : mime.startsWith("audio/") ? "audio"
    : mime.startsWith("application/") ? "document" : "text";
  if (type === "text") {
    const text = String(q.body || "").trim();
    if (!text) throw new Error("The replied message has no text to save.");
    return { type, text };
  }
  if (typeof q.download !== "function") throw new Error("The replied media cannot be downloaded.");
  const buffer = await q.download();
  if (!buffer?.length) throw new Error("Could not download the replied media.");
  const dir = path.join(ROOT, botNumber(message.conn));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${fileExt(mime, type)}`);
  await fs.writeFile(file, buffer);
  return { type, file, mime: mime || (type === "video" ? "video/mp4" : type === "audio" ? "audio/ogg; codecs=opus" : type === "sticker" ? "image/webp" : "application/octet-stream"), caption: String(q.body || q.caption || ""), fileName: q.fileName || q?.msg?.fileName || "saved-media" };
}

async function clearSaved(sid) {
  const current = await db.getAsync(sid, savedKey, null);
  if (current?.file) await fs.unlink(current.file).catch(() => {});
  await db.del(sid, savedKey);
}

function ownerUsage() {
  return "*_❌ এই command টা শুধু devoloper soumya আর owner eren use কোরতে পারবে রে পাগলাচোদা🤣_*";
}

Module({ command: "setmention", aliases: ["tagreply"], package: "owner", description: "Save the owner's text or replied media as the mention reply" })(async (message) => {
  if (!isOwner(message)) return message.send(ownerUsage());
  if (!message.quoted) return message.send(`Reply to a text/media message with ${config.prefix || "."}setmention to save it.`);
  try {
    const sid = botNumber(message.conn);
    const item = await saveQuoted(message);
    await clearSaved(sid);
    await db.set(sid, savedKey, item);
    return message.send(`✅ Mention reply saved (${item.type}).\nWhen someone mentions the owner number in a group, I will reply to that message with this saved content.`);
  } catch (error) {
    return message.send(`❌ Could not save mention reply: ${String(error?.message || error).slice(0, 180)}`);
  }
});

Module({ command: "delmention", aliases: ["resetmention"], package: "owner", description: "Delete the saved owner mention reply" })(async (message) => {
  if (!isOwner(message)) return message.send(ownerUsage());
  const sid = botNumber(message.conn);
  await clearSaved(sid);
  return message.send("♻️ Saved mention reply deleted.");
});

Module({ on: "message", name: "owner-mention-reply", package: "owner", description: "Reply to messages that mention the owner number" })(async (message) => {
  try {
    if (!message?.isGroup) return;
    const owner = ownerNumber();
    if (!owner) return;
    const sender = cleanNumber(message.sender || message.key?.participant || "");
    if (sender === owner) return;
    const mentioned = Array.isArray(message.mentions) ? message.mentions : [];
    const rawBody = String(message.body || "");
    const ownerMentioned = mentioned.some((jid) => cleanNumber(jid) === owner) || new RegExp(`(?:^|\\D)@${owner}(?:\\D|$)`).test(rawBody);
    if (!ownerMentioned) return;
    const item = await db.getAsync(botNumber(message.conn), savedKey, null);
    if (!item) return;
    let payload;
    if (item.type === "text") payload = { text: item.text };
    else {
      const buffer = await fs.readFile(item.file);
      if (item.type === "image") payload = { image: buffer, caption: item.caption || "" };
      else if (item.type === "video") payload = { video: buffer, caption: item.caption || "", mimetype: item.mime || "video/mp4" };
      else if (item.type === "audio") payload = { audio: buffer, mimetype: item.mime || "audio/ogg; codecs=opus", ptt: false };
      else if (item.type === "sticker") payload = { sticker: buffer };
      else payload = { document: buffer, mimetype: item.mime || "application/octet-stream", fileName: item.fileName || "saved-media", caption: item.caption || "" };
    }
    await message.conn.sendMessage(message.from, payload, { quoted: message.raw || message.key }).catch((error) => {
      console.error("[mention] reply failed:", error?.message || error);
    });
  } catch (error) {
    console.error("[mention] handler failed:", error?.message || error);
  }
});
