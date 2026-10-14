import fs from "node:fs/promises";
import path from "node:path";
import { Module } from "../lib/plugins.js";
import { db } from "../lib/client.js";
import config from "../config.js";

const ROOT = path.join(process.cwd(), "data", "tagreply");
const savedKey = "global:setmention:list";
const cursorKey = "global:setmention:cursor";
const orderKey = "global:setmention:order";
const cleanNumber = (value) => String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
const botNumber = (conn) => cleanNumber(conn?.user?.id || conn?.user?.jid || "bot") || "bot";
const ownerNumbers = new Set([...(config.ownerNumbers || []), config.ownerNumber, config.owner, process.env.OWNER_NUMBER, ...(String(process.env.OWNER_NUMBERS || "").split(","))].map(cleanNumber).filter(Boolean));
const isOwner = (message) => ownerNumbers.has(cleanNumber(message?.sender || message?.key?.participant || ""));
const mimeOf = (q) => String(q?.msg?.mimetype || q?.mimetype || "");
const fileExt = (mime, type) => type === "image" ? "jpg" : type === "video" ? "mp4" : type === "audio" ? "ogg" : type === "sticker" ? "webp" : (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";

async function saveQuoted(message) {
  const q = message.quoted;
  if (!q) throw new Error("Reply to a text, photo, video, audio, sticker or document.");
  const qType = String(q.type || q.mtype || "");
  const mime = mimeOf(q);
  const type = qType === "stickerMessage" || /sticker/.test(mime) ? "sticker"
    : qType === "imageMessage" ? "image" : qType === "videoMessage" ? "video"
    : qType === "audioMessage" ? "audio" : qType === "documentMessage" ? "document"
    : mime.startsWith("image/") ? "image" : mime.startsWith("video/") ? "video"
    : mime.startsWith("audio/") ? "audio" : mime.startsWith("application/") ? "document" : "text";
  if (type === "text") {
    const text = String(q.body || "").trim();
    if (!text) throw new Error("The replied message has no text to save.");
    return { type, text, createdAt: Date.now() };
  }
  if (typeof q.download !== "function") throw new Error("The replied media cannot be downloaded.");
  const buffer = await q.download();
  if (!buffer?.length) throw new Error("Could not download the replied media.");
  const dir = path.join(ROOT, botNumber(message.conn));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.${fileExt(mime, type)}`);
  await fs.writeFile(file, buffer);
  return { type, file, mime: mime || (type === "video" ? "video/mp4" : type === "audio" ? "audio/ogg; codecs=opus" : type === "sticker" ? "image/webp" : "application/octet-stream"), caption: String(q.body || q.caption || ""), fileName: q.fileName || q?.msg?.fileName || "saved-media", createdAt: Date.now() };
}

async function getItems(sid) {
  const value = await db.getAsync(sid, savedKey, null);
  if (Array.isArray(value)) return value;
  // Migrate the earlier single-item storage format without losing the saved reply.
  const old = await db.getAsync(sid, "global:setmention", null);
  return old && typeof old === "object" ? [old] : [];
}
async function deleteItems(items) {
  for (const item of items || []) if (item?.file) await fs.unlink(item.file).catch(() => {});
}
function ownerUsage() { return "❌ Only the configured owner numbers can use this command."; }

Module({ command: "setmention", aliases: ["tagreply"], package: "owner", description: "Add a text or replied media item to the rotating owner-mention replies" })(async (message) => {
  if (!isOwner(message)) return message.send(ownerUsage());
  if (!message.quoted) return message.send(`Reply to a text/media message with ${config.prefix || "."}setmention to add it to the rotation.`);
  try {
    const sid = botNumber(message.conn);
    const items = await getItems(sid);
    const item = await saveQuoted(message);
    items.push(item);
    await db.set(sid, savedKey, items);
    await db.set(sid, cursorKey, 0);
    await db.set(sid, orderKey, []);
    return message.send(`✅ Mention reply added (${item.type}). Total saved: ${items.length}. Replies rotate in order when the connected bot number is mentioned in a group.`);
  } catch (error) {
    return message.send(`❌ Could not save mention reply: ${String(error?.message || error).slice(0, 180)}`);
  }
});

Module({ command: "delmention", aliases: ["resetmention"], package: "owner", description: "Delete all saved owner-mention replies" })(async (message) => {
  if (!isOwner(message)) return message.send(ownerUsage());
  const sid = botNumber(message.conn);
  const items = await getItems(sid);
  await deleteItems(items);
  await db.del(sid, savedKey);
  await db.del(sid, cursorKey);
  await db.del(sid, orderKey);
  await db.del(sid, "global:setmention");
  return message.send("♻️ All saved mention replies deleted.");
});

Module({ on: "message", name: "owner-mention-reply", package: "owner", description: "Cycle through saved replies when the connected bot number is mentioned" })(async (message) => {
  try {
    if (!message?.isGroup || message.isFromMe || message.fromMe) return;
    const botNum = botNumber(message.conn);
    if (!botNum) return;
    const sender = cleanNumber(message.sender || message.key?.participant || "");
    if (sender === botNum) return;
    const mentions = Array.isArray(message.mentions) ? message.mentions : [];
    const targetMentioned = mentions.some((jid) => cleanNumber(jid) === botNum) || new RegExp(`(?:^|\\D)@${botNum}(?:\\D|$)`).test(String(message.body || ""));
    if (!targetMentioned) return;
    const items = await getItems(botNum);
    if (!items.length) return;
    let cursor = Number(await db.getAsync(botNum, cursorKey, 0));
    let order = await db.getAsync(botNum, orderKey, null);
    const validOrder = Array.isArray(order) && order.length === items.length && new Set(order).size === items.length && order.every((n) => Number.isInteger(n) && n >= 0 && n < items.length);
    if (!validOrder || !Number.isInteger(cursor) || cursor < 0 || cursor >= items.length) {
      order = Array.from({ length: items.length }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      cursor = 0;
    }
    const index = order[cursor];
    const item = items[index];
    const nextCursor = cursor + 1;
    if (nextCursor >= items.length) {
      order = Array.from({ length: items.length }, (_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      await db.set(botNum, orderKey, order);
      await db.set(botNum, cursorKey, 0);
    } else {
      await db.set(botNum, orderKey, order);
      await db.set(botNum, cursorKey, nextCursor);
    }
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
    await message.conn.sendMessage(message.from, payload, { quoted: message.raw || message.key }).catch((error) => console.error("[mention] reply failed:", error?.message || error));
  } catch (error) { console.error("[mention] handler failed:", error?.message || error); }
});
