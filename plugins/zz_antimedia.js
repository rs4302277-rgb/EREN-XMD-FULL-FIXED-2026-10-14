import { Module } from "../lib/plugins.js";
import { db } from "../lib/client.js";

const key = (jid) => `antimedia:${jid}:enabled`;
const botNum = (conn) => String(conn?.user?.id || "").split("@")[0].split(":")[0].replace(/\D/g, "");
const isViewOnce = (m) => {
  const root = m?.raw?.message || m?.mek?.message || {};
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object" || seen.has(node)) return false;
    seen.add(node);
    if (node.viewOnce === true || node.viewOnceMessage || node.viewOnceMessageV2 || node.viewOnceMessageV2Extension) return true;
    return Object.values(node).some((value) => walk(value));
  };
  return walk(root) || /view.?once/i.test(String(m?.type || ""));
};
const mediaKind = (m) => {
  const type = String(m?.type || "");
  if (type === "imageMessage" || type === "videoMessage") return type;
  const raw = m?.raw?.message || m?.mek?.message || {};
  const serialized = JSON.stringify(raw);
  if (raw.imageMessage || /"imageMessage"\s*:/.test(serialized)) return "imageMessage";
  if (raw.videoMessage || /"videoMessage"\s*:/.test(serialized)) return "videoMessage";
  return "";
};
async function isAdmin(m) { await m.loadGroupInfo?.(); return !!(m.isAdmin || m.isGroupAdmin || m.isFromMe); }

Module({ command: "antimedia", package: "group", description: "Delete directly sent photos/videos in a group; view-once media is exempt" })(async (m, arg) => {
  if (!m?.isGroup) return m.send("❌ Use .antimedia on/off inside a group.");
  if (!(await isAdmin(m))) return m.send("❌ Only group admins can change AntiMedia.");
  if (!m.isBotAdmin) return m.send("❌ Make the bot a group admin first.");
  const bot = botNum(m.conn); if (!bot) return m.send("❌ Bot number unavailable.");
  const input = String(arg || "").trim().toLowerCase();
  const current = db.get(bot, key(m.from)) === true;
  if (!input) return m.send(`📵 AntiMedia is ${current ? "✅ ON" : "❌ OFF"}. Use .antimedia on/off.`);
  if (!["on", "off"].includes(input)) return m.send("Usage: .antimedia on/off");
  db.setHot(bot, key(m.from), input === "on");
  return m.send(`✅ AntiMedia ${input.toUpperCase()}. ${input === "on" ? "Direct photos/videos will be deleted; view-once media is exempt." : "Photos/videos are allowed."}`);
});

Module({ on: "message", name: "antimedia-enforcement", package: "group", description: "Delete direct photo/video posts when AntiMedia is enabled" })(async (m) => {
  try {
    if (!m?.isGroup || m.isFromMe || m.fromMe || !m?.key?.id) return;
    const bot = botNum(m.conn); if (!bot || db.get(bot, key(m.from)) !== true) return;
    await m.loadGroupInfo?.();
    if (!m.isBotAdmin || isViewOnce(m)) return;
    const kind = mediaKind(m); if (!kind) return;
    const sender = String(m.sender || m.key?.participant || "");
    if (!sender || sender === m.conn?.user?.id) return;
    await m.conn.sendMessage(m.from, { delete: m.key });
  } catch (e) { console.error("[AntiMedia] enforcement failed:", e?.message || e); }
});
