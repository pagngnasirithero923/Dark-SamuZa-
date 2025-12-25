const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FileType = require('file-type');
const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
  downloadContentFromMessage,
  DisconnectReason
} = require('baileys');

// ---------------- CONFIG ----------------

const BOT_NAME_FANCY = '𝐃𝐀𝐑𝐊 𝐒𝐀𝐌𝐔𝐙𝐀 𝐌𝐃 🔮';

const config = {
  AUTO_VIEW_STATUS: 'false',
  AUTO_LIKE_STATUS: 'false',
  AUTO_RECORDING: 'true',
  AUTO_LIKE_EMOJI: ['🔥','💀','🌑','⚡','👺','🖤','💠','🥀'],
  PREFIX: '.',
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/LMlfzAc3iDj2pdQMmxwoXu',
  RCD_IMAGE_PATH: 'https://files.catbox.moe/fnuywi.jpg',
  NEWSLETTER_JID: '120363421675697127@newsletter',
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: '94752677804', // ඔබේ අලුත් අංකය මෙහි ඇතුළත් කළා
  CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb6FwIK89inhtCZOlp12',
  BOT_NAME: 'Dark SamuZa',
  BOT_VERSION: '1.0.0V',
  OWNER_NAME: 'Rev Pagngnasiri',
  IMAGE_PATH: 'https://files.catbox.moe/fnuywi.jpg',
  BOT_FOOTER: 'ᴘᴏᴡᴇʀᴇᴅ ʙʏ ʀᴇᴠ ᴘᴀɢɴɢɴᴀsɪʀɪ 🍃',
  BUTTON_IMAGES: { ALIVE: 'https://files.catbox.moe/fnuywi.jpg' }
};

// ---------------- MONGO SETUP ----------------

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://gunathilakalayanal56_db_user:mI7a7iSgYkgVbcuX@cluster0.wcwukox.mongodb.net/';
const MONGO_DB = process.env.MONGO_DB || 'KAVINDU_MD_ISHAN'
let mongoClient, mongoDB;
let sessionsCol, numbersCol, adminsCol, newsletterCol, configsCol, newsletterReactsCol;

async function initMongo() {
  try {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected && mongoClient.topology.isConnected()) return;
  } catch(e){}
  mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await mongoClient.connect();
  mongoDB = mongoClient.db(MONGO_DB);

  sessionsCol = mongoDB.collection('sessions');
  numbersCol = mongoDB.collection('numbers');
  adminsCol = mongoDB.collection('admins');
  newsletterCol = mongoDB.collection('newsletter_list');
  configsCol = mongoDB.collection('configs');
  newsletterReactsCol = mongoDB.collection('newsletter_reacts');

  await sessionsCol.createIndex({ number: 1 }, { unique: true });
  await numbersCol.createIndex({ number: 1 }, { unique: true });
  await newsletterCol.createIndex({ jid: 1 }, { unique: true });
  await newsletterReactsCol.createIndex({ jid: 1 }, { unique: true });
  await configsCol.createIndex({ number: 1 }, { unique: true });
  console.log('✅ Mongo initialized and collections ready');
}

// ---------------- Mongo helpers ----------------

async function saveCredsToMongo(number, creds, keys = null) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = { number: sanitized, creds, keys, updatedAt: new Date() };
    await sessionsCol.updateOne({ number: sanitized }, { $set: doc }, { upsert: true });
  } catch (e) { console.error('saveCredsToMongo error:', e); }
}

async function loadCredsFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await sessionsCol.findOne({ number: sanitized });
    return doc || null;
  } catch (e) { console.error('loadCredsFromMongo error:', e); return null; }
}

async function removeSessionFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await sessionsCol.deleteOne({ number: sanitized });
  } catch (e) { console.error('removeSessionToMongo error:', e); }
}

async function addNumberToMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await numbersCol.updateOne({ number: sanitized }, { $set: { number: sanitized } }, { upsert: true });
  } catch (e) { console.error('addNumberToMongo', e); }
}

async function getAllNumbersFromMongo() {
  try {
    await initMongo();
    const docs = await numbersCol.find({}).toArray();
    return docs.map(d => d.number);
  } catch (e) { console.error('getAllNumbersFromMongo', e); return []; }
}

async function loadAdminsFromMongo() {
  try {
    await initMongo();
    const docs = await adminsCol.find({}).toArray();
    return docs.map(d => d.jid || d.number).filter(Boolean);
  } catch (e) { console.error('loadAdminsFromMongo', e); return []; }
}

async function listNewslettersFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewslettersFromMongo', e); return []; }
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  try {
    await initMongo();
    const doc = { jid, messageId, emoji, sessionNumber, ts: new Date() };
    const col = mongoDB.collection('newsletter_reactions_log');
    await col.insertOne(doc);
  } catch (e) { console.error('saveNewsletterReaction', e); }
}

async function setUserConfigInMongo(number, conf) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    await configsCol.updateOne({ number: sanitized }, { $set: { number: sanitized, config: conf, updatedAt: new Date() } }, { upsert: true });
  } catch (e) { console.error('setUserConfigInMongo', e); }
}

async function loadUserConfigFromMongo(number) {
  try {
    await initMongo();
    const sanitized = number.replace(/[^0-9]/g, '');
    const doc = await configsCol.findOne({ number: sanitized });
    return doc ? doc.config : null;
  } catch (e) { console.error('loadUserConfigFromMongo', e); return null; }
}

async function listNewsletterReactsFromMongo() {
  try {
    await initMongo();
    const docs = await newsletterReactsCol.find({}).toArray();
    return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
  } catch (e) { console.error('listNewsletterReactsFromMongo', e); return []; }
}

// ---------------- basic utils ----------------

function formatMessage(title, content, footer) {
  return `┏━━━━━━━━━━━━━━━━━━━━━━━━\n┃ 🔮 *${title}*\n┗━━━━━━━━━━━━━━━━━━━━━━━━\n\n${content}\n\n> *${footer}*`;
}
function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getSriLankaTimestamp(){ return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss'); }

const activeSockets = new Map();
const socketCreationTime = new Map();
const otpStore = new Map();

// ---------------- Helpers ----------------

async function joinGroup(socket) {
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No link' };
  const inviteCode = inviteCodeMatch[1];
  try {
    const response = await socket.groupAcceptInvite(inviteCode);
    if (response?.gid) return { status: 'success', gid: response.gid };
    throw new Error('No GID');
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}

async function sendAdminConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  const admins = await loadAdminsFromMongo();
  const groupStatus = groupResult.status === 'success' ? `Joined` : `Failed: ${groupResult.error}`;
  const botName = sessionConfig.botName || BOT_NAME_FANCY;
  const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
  const caption = formatMessage(botName, `📞 Number: ${number}\n🌑 Status: ${groupStatus}\n🕒 Time: ${getSriLankaTimestamp()}`, config.BOT_FOOTER);
  for (const admin of admins) {
    try {
      const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
      await socket.sendMessage(to, { image: { url: image }, caption });
    } catch (err) {}
  }
}

// ---------------- handlers ----------------

async function setupNewsletterHandlers(socket, sessionNumber) {
  const rrPointers = new Map();
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;
    try {
      const followedDocs = await listNewslettersFromMongo();
      const reactConfigs = await listNewsletterReactsFromMongo();
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);
      const followedJids = followedDocs.map(d => d.jid);
      if (!followedJids.includes(jid) && !reactMap.has(jid)) return;
      let emojis = reactMap.get(jid) || followedDocs.find(d => d.jid === jid)?.emojis || config.AUTO_LIKE_EMOJI;
      let idx = rrPointers.get(jid) || 0;
      const emoji = emojis[idx % emojis.length];
      rrPointers.set(jid, (idx + 1) % emojis.length);
      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;
      await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
      await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber);
    } catch (e) {}
  });
}

async function setupStatusHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast') return;
    try {
      if (config.AUTO_VIEW_STATUS === 'true') await socket.readMessages([message.key]);
      if (config.AUTO_LIKE_STATUS === 'true') {
        const emoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
        await socket.sendMessage(message.key.remoteJid, { react: { text: emoji, key: message.key } }, { statusJidList: [message.key.participant] });
      }
    } catch (e) {}
  });
}

// ---------------- Command Handler (The Big Switch) ----------------

function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

    const type = getContentType(msg.message);
    const from = msg.key.remoteJid;
    const sender = from;
    const nowsender = msg.key.participant || msg.key.remoteJid;
    const senderNumber = (nowsender || '').split('@')[0];
    const isOwner = senderNumber === config.OWNER_NUMBER;

    const body = (type === 'conversation') ? msg.message.conversation
      : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text
      : (type === 'imageMessage') ? msg.message.imageMessage.caption : '';

    if (!body || !body.startsWith(config.PREFIX)) return;
    const command = body.slice(config.PREFIX.length).trim().split(' ').shift().toLowerCase();
    const args = body.trim().split(/ +/).slice(1);

    try {
      switch (command) {
        case 'menu': {
          await socket.sendMessage(from, { react: { text: "🌑", key: msg.key } });
          const text = `
╭──❏ 🌑 *DARK SAMUZA MD* ❏
│ 👸 User: ${senderNumber}
│ 👑 Host: ${config.OWNER_NAME}
│ 🏷️ Ver: ${config.BOT_VERSION}
╰──────────────❏

🔮 *MAIN MENU*

📥 .download
🎨 .creative
🔧 .tools
⚙️ .settings
👑 .owner

> ${config.BOT_FOOTER}
`.trim();
          await socket.sendMessage(from, {
            image: { url: config.IMAGE_PATH },
            caption: text,
            buttons: [
              { buttonId: '.download', buttonText: { displayText: '📥 DOWNLOAD' }, type: 1 },
              { buttonId: '.creative', buttonText: { displayText: '🎨 CREATIVE' }, type: 1 }
            ],
            headerType: 4
          }, { quoted: msg });
          break;
        }

        case 'download': {
          const text = formatMessage('DOWNLOAD MENU', `.song [title]\n.video [title]\n.tiktok [url]\n.fb [url]\n.ig [url]\n.apk [id]`, config.BOT_FOOTER);
          await socket.sendMessage(from, { text });
          break;
        }

        case 'creative': {
          const text = formatMessage('CREATIVE MENU', `.ai [query]\n.aiimg [prompt]\n.font [text]\n.getdp [number]\n.save (reply status)`, config.BOT_FOOTER);
          await socket.sendMessage(from, { text });
          break;
        }

        case 'ai': {
          const q = args.join(' ');
          if (!q) return socket.sendMessage(from, { text: 'Provide a query.' });
          await socket.sendMessage(from, { react: { text: '🤖', key: msg.key } });
          const prompt = `Your name is Dark SamuZa. Created by Rev Pagngnasiri. Query: ${q}`;
          const { data } = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyDD79CzhemWoS4WXoMTpZcs8g0fWNytNug`, {
            contents: [{ parts: [{ text: prompt }] }]
          });
          const reply = data.candidates[0].content.parts[0].text;
          await socket.sendMessage(from, { text: reply + `\n\n> ${config.BOT_FOOTER}` }, { quoted: msg });
          break;
        }

        case 'song': {
          const q = args.join(' ');
          if (!q) return socket.sendMessage(from, { text: 'Need title.' });
          await socket.sendMessage(from, { react: { text: '🔎', key: msg.key } });
          const sRes = await axios.get(`https://movanest.zone.id/v2/ytsearch?query=${encodeURIComponent(q)}`);
          const video = sRes.data.results[0];
          const dlRes = await axios.get(`https://movanest.zone.id/v2/ytmp3?url=${encodeURIComponent(video.url)}`);
          await socket.sendMessage(from, { audio: { url: dlRes.data.results.download.url }, mimetype: 'audio/mpeg' }, { quoted: msg });
          break;
        }

        case 'owner': {
          const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Rev Pagngnasiri\nTEL;type=CELL;type=VOICE;waid=94752677804:+94 75 267 7804\nEND:VCARD';
          await socket.sendMessage(from, { contacts: { displayName: 'Rev Pagngnasiri', contacts: [{ vcard }] } });
          break;
        }

        case 'alive': {
          const text = formatMessage('DARK SAMUZA', `Status: Online\nOwner: Rev Pagngnasiri\nVer: ${config.BOT_VERSION}`, config.BOT_FOOTER);
          await socket.sendMessage(from, { image: { url: config.IMAGE_PATH }, caption: text });
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error(e);
    }
  });
}

// ---------------- Connection & Express ----------------

async function EmpirePair(number, res) {
  const sanitized = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const socket = makeWASocket({
    auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })) },
    printQRInTerminal: false,
    browser: ["Dark SamuZa", "Chrome", "20.0.04"]
  });

  setupStatusHandlers(socket);
  setupCommandHandlers(socket, sanitized);
  setupNewsletterHandlers(socket, sanitized);

  if (!socket.authState.creds.registered) {
    const code = await socket.requestPairingCode(sanitized);
    if (!res.headersSent) res.send({ code });
  }

  socket.ev.on('creds.update', saveCreds);
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      activeSockets.set(sanitized, socket);
      const userJid = jidNormalizedUser(socket.user.id);
      await socket.sendMessage(userJid, { text: formatMessage('CONNECTED', 'Dark SamuZa MD is now active!', config.BOT_FOOTER) });
      await addNumberToMongo(sanitized);
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      if (shouldReconnect) EmpirePair(number, { headersSent: true, send: () => {} });
    }
  });
}

router.get('/', (req, res) => {
  const { number } = req.query;
  if (!number) return res.send({ error: 'No number' });
  EmpirePair(number, res);
});

router.get('/ping', (req, res) => res.send({ status: 'active', bot: 'Dark SamuZa' }));

initMongo().catch(console.error);

module.exports = router;
