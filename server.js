import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import cron from 'node-cron';
import dotenv from 'dotenv';
import pino from 'pino';
import { Client } from '@gradio/client';

const {
  default: makeWASocket,
  DisconnectReason,
  BufferJSON,
  proto,
  fetchLatestBaileysVersion,
} = await import('@whiskeysockets/baileys');
const { initAuthCreds } = await import('@whiskeysockets/baileys/lib/Utils/auth-utils.js');

dotenv.config();

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static('public'));

const IS_LOCAL = process.env.USE_LOCAL === 'true';
const MONGO_URI = IS_LOCAL ? 'mongodb://localhost:27017/whatsapp_bot' : process.env.CLOUD_MONGO_URI;
const PORT = Number(process.env.PORT || 3000);
const CREDIT_SIGNUP_BONUS = Number(process.env.DEFAULT_SIGNUP_CREDITS || 150);
const HUGGINGFACE_TEXT_SPACE_ID = process.env.HUGGINGFACE_TEXT_SPACE_ID || 'codeignite/whatsappText';
const HUGGINGFACE_IMAGE_SPACE_ID = process.env.HUGGINGFACE_IMAGE_SPACE_ID || 'codeignite/whatsappbot';
const HUGGINGFACE_TEXT_API_NAME = process.env.HUGGINGFACE_TEXT_API_NAME || '/respond';
const HUGGINGFACE_IMAGE_API_NAME = process.env.HUGGINGFACE_IMAGE_API_NAME || '/predict';
const HUGGINGFACE_TEXT_SYSTEM_PROMPT = process.env.HUGGINGFACE_TEXT_SYSTEM_PROMPT || 'You write concise WhatsApp-ready marketing and operational messages.';
const HUGGINGFACE_TEXT_MAX_TOKENS = Number(process.env.HUGGINGFACE_TEXT_MAX_TOKENS || 512);
const HUGGINGFACE_TEXT_TEMPERATURE = Number(process.env.HUGGINGFACE_TEXT_TEMPERATURE || 0.7);
const HUGGINGFACE_TEXT_TOP_P = Number(process.env.HUGGINGFACE_TEXT_TOP_P || 0.95);
const HUGGINGFACE_IMAGE_NEGATIVE_PROMPT = process.env.HUGGINGFACE_IMAGE_NEGATIVE_PROMPT || '';
const HUGGINGFACE_IMAGE_SEED = Number(process.env.HUGGINGFACE_IMAGE_SEED || 0);
const HUGGINGFACE_IMAGE_RANDOMIZE_SEED = process.env.HUGGINGFACE_IMAGE_RANDOMIZE_SEED !== 'false';
const HUGGINGFACE_IMAGE_WIDTH = Number(process.env.HUGGINGFACE_IMAGE_WIDTH || 384);
const HUGGINGFACE_IMAGE_HEIGHT = Number(process.env.HUGGINGFACE_IMAGE_HEIGHT || 384);
const HUGGINGFACE_IMAGE_GUIDANCE_SCALE = Number(process.env.HUGGINGFACE_IMAGE_GUIDANCE_SCALE || 0);
const HUGGINGFACE_IMAGE_STEPS = Number(process.env.HUGGINGFACE_IMAGE_STEPS || 2);
const CREDIT_COSTS = {
  whatsappConnect: Number(process.env.CREDIT_COST_WHATSAPP_CONNECT || 5),
  createTask: Number(process.env.CREDIT_COST_CREATE_TASK || 10),
  generateText: Number(process.env.CREDIT_COST_GENERATE_TEXT || 2),
  generateImage: Number(process.env.CREDIT_COST_GENERATE_IMAGE || 6),
};

const connectionStateStore = new Map();
const socketStore = new Map();
const audienceStore = new Map();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function applyCreditActivity(user, amount, reason) {
  const normalizedAmount = Number(amount || 0);
  if (!normalizedAmount) return user;

  const nextCredits = Math.max(0, Number(user.credits || 0) - normalizedAmount);
  if (nextCredits === Number(user.credits || 0)) return user;

  user.credits = nextCredits;
  await user.save();
  logger.info({ userId: String(user._id), reason, amount: normalizedAmount, credits: nextCredits }, 'Credits updated');
  return user;
}

function ensureCredits(user, amount, label) {
  if (Number(user.credits || 0) < Number(amount || 0)) {
    throw new Error(`Insufficient credits to ${label}. Your account has ${Number(user.credits || 0)} credits remaining.`);
  }
}

function sanitizeUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    credits: user.credits,
    theme: user.theme,
    whatsappStatus: user.whatsappStatus,
    whatsappPhone: user.whatsappPhone,
    walletBalance: user.walletBalance,
  };
}

function buildDefaultConnectionState(userId) {
  return {
    userId,
    status: 'idle',
    qr: '',
    lastUpdatedAt: new Date(),
    phoneNumber: '',
    message: 'Connect your WhatsApp account to start automation.',
  };
}

function setConnectionState(userId, updates) {
  const current = connectionStateStore.get(userId) || buildDefaultConnectionState(userId);
  const next = {
    ...current,
    ...updates,
    lastUpdatedAt: new Date(),
  };
  connectionStateStore.set(userId, next);
  return next;
}


function buildDefaultAudienceState() {
  return { groups: [], contacts: [], lastSyncedAt: null };
}

function normalizePhoneNumber(jid = '') {
  const raw = String(jid).split('@')[0].replace(/[^\d]/g, '');
  return raw ? `+${raw}` : '';
}

function normalizePhoneJid(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/@s\.whatsapp\.net$/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits.length >= 7 ? `${digits}@s.whatsapp.net` : '';
}

function normalizeGroupJid(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/@g\.us$/i.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, '');
  return digits ? `${digits}@g.us` : '';
}

function sanitizeTaskRecipients(recipients = {}) {
  const groups = Array.isArray(recipients.groups) ? recipients.groups : [];
  const contacts = Array.isArray(recipients.contacts) ? recipients.contacts : [];
  const seenGroups = new Set();
  const seenContacts = new Set();

  return {
    groups: groups.map((group) => {
      const id = normalizeGroupJid(group.id || group.name || '');
      return {
        id,
        name: String(group.name || id || 'Unnamed group').trim(),
        members: Number(group.members || 0),
        category: String(group.category || 'Group').trim(),
      };
    }).filter((group) => group.id && !seenGroups.has(group.id) && seenGroups.add(group.id)),
    contacts: contacts.map((contact) => {
      const id = normalizePhoneJid(contact.id || contact.phone || '');
      return {
        id,
        name: String(contact.name || normalizePhoneNumber(id) || id).trim(),
        phone: normalizePhoneNumber(contact.phone || id),
        segment: String(contact.segment || 'Contact').trim(),
      };
    }).filter((contact) => contact.id && !seenContacts.has(contact.id) && seenContacts.add(contact.id)),
  };
}

function normalizeGroup(group) {
  return {
    id: String(group.id || ''),
    name: String(group.subject || group.name || group.id || 'Unnamed group'),
    members: Array.isArray(group.participants) ? group.participants.length : 0,
    category: group.announce ? 'Announcement' : 'Group',
  };
}

function normalizeContact(contact = {}, chat = {}) {
  const id = String(contact.id || chat.id || '');
  const name = String(contact.name || contact.notify || contact.verifiedName || chat.name || chat.notify || normalizePhoneNumber(id) || id);
  return {
    id,
    name,
    phone: normalizePhoneNumber(contact.phoneNumber || id),
    segment: chat.unreadCount ? 'Recent chat' : 'Contact',
  };
}

function upsertAudienceContacts(userId, contacts = [], chats = []) {
  const current = audienceStore.get(userId) || buildDefaultAudienceState();
  const chatMap = new Map((Array.isArray(chats) ? chats : []).map((chat) => [String(chat.id || ''), chat]));
  const nextContacts = new Map(current.contacts.map((contact) => [contact.id, contact]));

  contacts.forEach((contact) => {
    const normalized = normalizeContact(contact, chatMap.get(String(contact.id || '')));
    if (normalized.id && !normalized.id.endsWith('@g.us')) nextContacts.set(normalized.id, { ...nextContacts.get(normalized.id), ...normalized });
  });

  chatMap.forEach((chat, id) => {
    if (!id || id.endsWith('@g.us') || id === 'status@broadcast') return;
    const normalized = normalizeContact({}, chat);
    nextContacts.set(id, { ...nextContacts.get(id), ...normalized });
  });

  const next = {
    ...current,
    contacts: Array.from(nextContacts.values()).sort((a, b) => a.name.localeCompare(b.name)),
    lastSyncedAt: new Date(),
  };
  audienceStore.set(userId, next);
  return next;
}

function upsertAudienceGroups(userId, groups = []) {
  const current = audienceStore.get(userId) || buildDefaultAudienceState();
  const nextGroups = new Map(current.groups.map((group) => [group.id, group]));
  groups.forEach((group) => {
    const normalized = normalizeGroup(group);
    if (normalized.id) nextGroups.set(normalized.id, normalized);
  });
  const next = {
    ...current,
    groups: Array.from(nextGroups.values()).sort((a, b) => a.name.localeCompare(b.name)),
    lastSyncedAt: new Date(),
  };
  audienceStore.set(userId, next);
  return next;
}

async function syncAudienceFromSocket(userId, sock) {
  const allGroups = await sock.groupFetchAllParticipating().catch(() => ({}));
  upsertAudienceGroups(userId, Object.values(allGroups || {}));
  return audienceStore.get(userId) || buildDefaultAudienceState();
}

async function getAudienceState(userId) {
  return audienceStore.get(userId) || buildDefaultAudienceState();
}

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true },
  credits: { type: Number, default: CREDIT_SIGNUP_BONUS },
  walletBalance: { type: Number, default: 0 },
  theme: { type: String, enum: ['light', 'dark'], default: 'light' },
  whatsappStatus: { type: String, enum: ['not_connected', 'connecting', 'connected'], default: 'not_connected' },
  whatsappPhone: { type: String, default: '' },
  socialProviders: {
    google: { type: Boolean, default: false },
    github: { type: Boolean, default: false },
    microsoft: { type: Boolean, default: false },
  },
}, { timestamps: true });

const appSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now, expires: '14d' },
});

const authSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  key: { type: String, required: true },
  data: { type: String, required: true },
}, { timestamps: true });
authSchema.index({ userId: 1, key: 1 }, { unique: true });

const whatsappConnectionSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  status: { type: String, default: 'idle' },
  qr: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  message: { type: String, default: '' },
  lastUpdatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  title: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  messageHtml: { type: String, default: '' },
  messageText: { type: String, default: '' },
  translatedPreview: { type: String, default: '' },
  mediaQueue: { type: Array, default: [] },
  recipients: { type: Object, default: { groups: [], contacts: [] } },
  schedule: { type: Object, default: {} },
  status: { type: String, enum: ['draft', 'active', 'paused', 'completed'], default: 'active' },
  lastRunAt: { type: Date, default: null },
  lastRunKey: { type: String, default: '' },
  completedAt: { type: Date, default: null },
}, { timestamps: true });

const enquirySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  message: { type: String, required: true, trim: true },
  recipient: { type: String, default: 'admin@codesignite.com' },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);
const AppSession = mongoose.model('AppSession', appSessionSchema);
const AuthState = mongoose.model('AuthState', authSchema);
const WhatsAppConnection = mongoose.model('WhatsAppConnection', whatsappConnectionSchema);
const Task = mongoose.model('Task', taskSchema);
const Enquiry = mongoose.model('Enquiry', enquirySchema);

async function connectDatabase() {
  if (!MONGO_URI) {
    throw new Error('Missing MongoDB connection string. Set CLOUD_MONGO_URI or USE_LOCAL=true.');
  }
  await mongoose.connect(MONGO_URI);
  console.log(`✅ MongoDB Connected: ${IS_LOCAL ? 'Local' : 'Cloud'}`);
}

async function persistConnectionState(userId, updates) {
  const next = setConnectionState(userId, updates);
  await WhatsAppConnection.findOneAndUpdate(
    { userId },
    { ...next },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return next;
}

async function useMongooseAuthState(userId) {
  const writeData = async (data, key) => {
    const json = JSON.stringify(data, BufferJSON.replacer);
    await AuthState.findOneAndUpdate(
      { userId, key },
      { userId, key, data: json },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  };

  const readData = async (key) => {
    const record = await AuthState.findOne({ userId, key });
    return record ? JSON.parse(record.data, BufferJSON.reviver) : null;
  };

  const creds = await readData('creds') || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                await writeData(value, key);
              } else {
                await AuthState.deleteOne({ userId, key });
              }
            }
          }
        },
      },
    },
    saveCreds: async () => {
      await writeData(creds, 'creds');
      await User.findByIdAndUpdate(userId, { whatsappStatus: 'connected' });
    },
  };
}

async function authenticateRequest(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const tokenHash = sha256(token);
  const session = await AppSession.findOne({ tokenHash });
  if (!session) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }

  const user = await User.findById(session.userId);
  if (!user) {
    return res.status(401).json({ error: 'User not found.' });
  }

  req.user = user;
  req.sessionToken = token;
  next();
}

function validateSignupPayload(payload) {
  const username = String(payload.username || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');

  if (!username || username.length < 2) throw new Error('Username must be at least 2 characters long.');
  if (!email.includes('@')) throw new Error('Enter a valid email address.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters long.');

  return { username, email, password };
}

async function issueSession(user) {
  const token = createToken();
  await AppSession.create({ tokenHash: sha256(token), userId: user._id });
  return { token, user: sanitizeUser(user) };
}

function buildHuggingFaceSpaceUrl(spaceId) {
  if (/^https?:\/\//i.test(spaceId)) return spaceId.replace(/\/$/, '');
  return `https://${spaceId.replace('/', '-')}.hf.space`;
}

async function callHuggingFaceSpace(spaceId, apiName, data) {
  const baseUrl = buildHuggingFaceSpaceUrl(spaceId);
  const normalizedApiName = apiName.startsWith('/') ? apiName : `/${apiName}`;
  const submitResponse = await fetch(`${baseUrl}/gradio_api/call${normalizedApiName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data }),
  });

  const submitPayload = await submitResponse.json().catch(() => ({}));
  if (!submitResponse.ok || !submitPayload.event_id) {
    throw new Error(submitPayload.error || 'Unable to start Hugging Face Space request.');
  }

  const streamResponse = await fetch(`${baseUrl}/gradio_api/call${normalizedApiName}/${submitPayload.event_id}`);
  if (!streamResponse.ok) {
    throw new Error(`Hugging Face Space stream failed with status ${streamResponse.status}.`);
  }

  const streamText = await streamResponse.text();
  const eventBlocks = streamText.split(/\n\n+/).map((block) => block.trim()).filter(Boolean);

  for (const block of eventBlocks.reverse()) {
    const lines = block.split('\n');
    const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const dataLines = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
    const rawData = dataLines.join('\n');

    if (eventName === 'error') {
      throw new Error(rawData || 'Hugging Face Space request failed.');
    }

    if (eventName === 'complete' && rawData) {
      return JSON.parse(rawData);
    }
  }

  throw new Error('No completion payload was returned by the Hugging Face Space.');
}

function extractTextFromSpaceResult(payload) {
  if (typeof payload === 'string' && payload.trim()) return payload.trim();
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const extracted = extractTextFromSpaceResult(item);
      if (extracted) return extracted;
    }
  }
  if (payload && typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      const extracted = extractTextFromSpaceResult(value);
      if (extracted) return extracted;
    }
  }
  return '';
}

function extractImageUrlFromSpaceResult(payload) {
  if (typeof payload === 'string' && /^https?:\/\//i.test(payload)) return payload;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const extracted = extractImageUrlFromSpaceResult(item);
      if (extracted) return extracted;
    }
  }
  if (payload && typeof payload === 'object') {
    if (typeof payload.url === 'string' && payload.url) return payload.url;
    if (typeof payload.path === 'string' && payload.path) {
      const prefix = payload.path.startsWith('/') ? '' : '/';
      return `${buildHuggingFaceSpaceUrl(HUGGINGFACE_IMAGE_SPACE_ID)}/gradio_api/file=${prefix}${payload.path}`;
    }
    for (const value of Object.values(payload)) {
      const extracted = extractImageUrlFromSpaceResult(value);
      if (extracted) return extracted;
    }
  }
  return '';
}

const huggingFaceClientStore = new Map();

async function getHuggingFaceClient(spaceId) {
  if (!huggingFaceClientStore.has(spaceId)) {
    huggingFaceClientStore.set(spaceId, Client.connect(spaceId));
  }
  return huggingFaceClientStore.get(spaceId);
}

async function callHuggingFaceText(prompt) {
  const client = await getHuggingFaceClient(HUGGINGFACE_TEXT_SPACE_ID);
  const result = await client.predict(HUGGINGFACE_TEXT_API_NAME, {
    message: prompt,
    system_message: HUGGINGFACE_TEXT_SYSTEM_PROMPT,
    max_tokens: HUGGINGFACE_TEXT_MAX_TOKENS,
    temperature: HUGGINGFACE_TEXT_TEMPERATURE,
    top_p: HUGGINGFACE_TEXT_TOP_P,
  });

  const text = extractTextFromSpaceResult(result?.data);
  if (!text) throw new Error('No text was returned by the Hugging Face Space.');
  return text;
}

async function callHuggingFaceImage(prompt) {
  const client = await getHuggingFaceClient(HUGGINGFACE_IMAGE_SPACE_ID);
  const attempts = [
    async () => client.predict(HUGGINGFACE_IMAGE_API_NAME, {
      prompt,
      seed: HUGGINGFACE_IMAGE_SEED,
      randomize_seed: HUGGINGFACE_IMAGE_RANDOMIZE_SEED,
      width: HUGGINGFACE_IMAGE_WIDTH,
      height: HUGGINGFACE_IMAGE_HEIGHT,
    }),
    async () => client.predict(HUGGINGFACE_IMAGE_API_NAME, {
      prompt,
      negative_prompt: HUGGINGFACE_IMAGE_NEGATIVE_PROMPT,
      seed: HUGGINGFACE_IMAGE_SEED,
      randomize_seed: HUGGINGFACE_IMAGE_RANDOMIZE_SEED,
      width: HUGGINGFACE_IMAGE_WIDTH,
      height: HUGGINGFACE_IMAGE_HEIGHT,
      guidance_scale: HUGGINGFACE_IMAGE_GUIDANCE_SCALE,
      num_inference_steps: HUGGINGFACE_IMAGE_STEPS,
    }),
    async () => callHuggingFaceSpace(HUGGINGFACE_IMAGE_SPACE_ID, HUGGINGFACE_IMAGE_API_NAME, [
      prompt,
      HUGGINGFACE_IMAGE_NEGATIVE_PROMPT,
      HUGGINGFACE_IMAGE_SEED,
      HUGGINGFACE_IMAGE_RANDOMIZE_SEED,
      HUGGINGFACE_IMAGE_WIDTH,
      HUGGINGFACE_IMAGE_HEIGHT,
      HUGGINGFACE_IMAGE_GUIDANCE_SCALE,
      HUGGINGFACE_IMAGE_STEPS,
    ]),
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const payload = result?.data ?? result;
      const imageUrl = extractImageUrlFromSpaceResult(payload);
      if (imageUrl) return imageUrl;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('No image was returned by the Hugging Face Space.');
}

function fallbackImage(prompt) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#0f172a"/><rect x="64" y="64" width="896" height="896" rx="48" fill="#25d366" opacity="0.16"/><text x="80" y="220" fill="white" font-size="56" font-family="Arial">AI image placeholder</text><text x="80" y="320" fill="white" font-size="28" font-family="Arial">${String(prompt).replace(/[<&>]/g, '')}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function normalizeTimeValue(value = '') {
  const trimmed = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : '';
}

function normalizeDayName(value = '') {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return '';
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

function getWeekOfMonth(date) {
  const dayOfMonth = date.getUTCDate();
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  if (dayOfMonth + 7 > lastDay) return 'last week';
  if (dayOfMonth <= 7) return 'first week';
  if (dayOfMonth <= 14) return 'second week';
  if (dayOfMonth <= 21) return 'third week';
  return 'fourth week';
}

function buildRunKey(date, frequency, timeValue) {
  const isoDate = date.toISOString().slice(0, 10);
  return `${frequency || 'once'}:${isoDate}:${timeValue || '00:00'}`;
}

function shouldRunTaskNow(task, now = new Date()) {
  const schedule = task?.schedule || {};
  const startDate = String(schedule.startDate || '').trim();
  const startTime = normalizeTimeValue(schedule.startTime);
  const frequency = String(schedule.frequency || '').trim().toLowerCase();

  if (!startDate || !startTime || !frequency) return { due: false, reason: 'missing_schedule' };

  const today = now.toISOString().slice(0, 10);
  const currentTime = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
  if (today < startDate) return { due: false, reason: 'before_start_date' };

  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' }).format(now);
  let due = false;

  if (frequency === 'once') {
    due = today === startDate;
  } else if (frequency === 'daily') {
    const times = Array.isArray(schedule.dailyTimes) ? schedule.dailyTimes.map(normalizeTimeValue).filter(Boolean) : [];
    due = times.length ? times.includes(currentTime) : currentTime === startTime;
  } else if (frequency === 'weekly') {
    const slots = Array.isArray(schedule.weeklySlots) ? schedule.weeklySlots : [];
    due = slots.some((slot) => normalizeDayName(slot?.day) === dayName && normalizeTimeValue(slot?.time) === currentTime);
  } else if (frequency === 'monthly') {
    const monthlyDays = Array.isArray(schedule.monthlyDays) ? schedule.monthlyDays.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 31) : [];
    const monthlyWeeks = Array.isArray(schedule.monthlyWeeks) ? schedule.monthlyWeeks.map((value) => String(value || '').trim().toLowerCase()) : [];
    const weekLabel = getWeekOfMonth(now);
    due = monthlyDays.includes(now.getUTCDate()) || (monthlyWeeks.includes(weekLabel) && currentTime === startTime);
  }

  if (!due) return { due: false, reason: 'rule_mismatch' };

  const runKey = buildRunKey(now, frequency, currentTime);
  if (task.lastRunKey === runKey) return { due: false, reason: 'already_ran', runKey };
  return { due: true, runKey, frequency, currentTime };
}

function dataUrlToBuffer(dataUrl = '') {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') };
}

async function buildMessagePayload(task) {
  const text = String(task.messageText || task.translatedPreview || task.description || '').trim();
  const firstMedia = Array.isArray(task.mediaQueue) ? task.mediaQueue[0] : null;
  if (!firstMedia?.dataUrl) return text ? { text } : null;

  const parsed = dataUrlToBuffer(firstMedia.dataUrl);
  if (!parsed?.buffer) return text ? { text } : null;

  const caption = text || undefined;
  const fileName = String(firstMedia.name || 'attachment');
  if (firstMedia.type === 'image') return { image: parsed.buffer, mimetype: parsed.mimeType, fileName, caption };
  if (firstMedia.type === 'video') return { video: parsed.buffer, mimetype: parsed.mimeType, fileName, caption };
  if (firstMedia.type === 'audio') return { audio: parsed.buffer, mimetype: parsed.mimeType, fileName, ptt: false };
  return { document: parsed.buffer, mimetype: parsed.mimeType, fileName, caption };
}

async function resolveTaskRecipients(task, sock) {
  const recipients = task?.recipients || {};
  const recipientIds = new Set();

  for (const contact of Array.isArray(recipients.contacts) ? recipients.contacts : []) {
    const jid = normalizePhoneJid(contact?.id || contact?.phone || '');
    if (jid) recipientIds.add(jid);
  }

  const groups = Array.isArray(recipients.groups) ? recipients.groups : [];
  if (groups.length) {
    if (recipients.groupDeliveryMode === 'members') {
      for (const group of groups) {
        const jid = normalizeGroupJid(group?.id || '');
        if (!jid) continue;
        try {
          const metadata = await sock.groupMetadata(jid);
          for (const participant of metadata.participants || []) {
            const memberJid = normalizePhoneJid(participant?.id || '');
            if (memberJid) recipientIds.add(memberJid);
          }
        } catch (error) {
          logger.warn({ taskId: String(task._id), groupId: jid, error: error.message }, 'Unable to load group members for scheduled task');
        }
      }
    } else {
      for (const group of groups) {
        const jid = normalizeGroupJid(group?.id || '');
        if (jid) recipientIds.add(jid);
      }
    }
  }

  return Array.from(recipientIds);
}

async function processDueTasks() {
  const now = new Date();
  const activeTasks = await Task.find({ status: 'active' });

  for (const task of activeTasks) {
    const timing = shouldRunTaskNow(task, now);
    if (!timing.due) continue;

    const userId = String(task.userId || '');
    const sock = socketStore.get(userId);
    if (!sock) {
      logger.warn({ taskId: String(task._id), userId }, 'Skipping scheduled task because WhatsApp is not connected');
      continue;
    }

    const messagePayload = await buildMessagePayload(task);
    if (!messagePayload) {
      logger.warn({ taskId: String(task._id) }, 'Skipping scheduled task because no sendable message payload was available');
      continue;
    }

    const recipients = await resolveTaskRecipients(task, sock);
    if (!recipients.length) {
      logger.warn({ taskId: String(task._id) }, 'Skipping scheduled task because no recipients were resolved');
      continue;
    }

    let deliveredCount = 0;
    for (const recipient of recipients) {
      try {
        await sock.sendMessage(recipient, messagePayload);
        deliveredCount += 1;
      } catch (error) {
        logger.error({ taskId: String(task._id), recipient, error: error.message }, 'Failed to send scheduled WhatsApp message');
      }
    }

    task.lastRunAt = now;
    task.lastRunKey = timing.runKey;
    if (timing.frequency === 'once') {
      task.status = 'completed';
      task.completedAt = now;
    }
    await task.save();
    logger.info({ taskId: String(task._id), deliveredCount, attemptedCount: recipients.length }, 'Processed scheduled WhatsApp task');
  }
}

function startTaskScheduler() {
  cron.schedule('* * * * *', async () => {
    try {
      await processDueTasks();
    } catch (error) {
      logger.error({ error: error.message }, 'Scheduled task processor failed');
    }
  }, { timezone: 'UTC' });
}

function buildSocialProviderResponse(provider) {
  return {
    provider,
    available: false,
    message: `Provide ${provider} OAuth client credentials to enable this login flow.`,
    requiredCredentials: provider === 'google'
      ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']
      : provider === 'github'
        ? ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL']
        : ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_CALLBACK_URL'],
  };
}

async function startWhatsAppSession(user) {
  const userId = String(user._id);
  if (socketStore.has(userId)) {
    return connectionStateStore.get(userId) || buildDefaultConnectionState(userId);
  }

  await persistConnectionState(userId, {
    status: 'connecting',
    qr: '',
    phoneNumber: user.whatsappPhone || '',
    message: 'Starting WhatsApp connection and waiting for QR code.',
  });
  await User.findByIdAndUpdate(userId, { whatsappStatus: 'connecting' });

  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMongooseAuthState(userId);
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  socketStore.set(userId, sock);

  sock.ev.on('creds.update', async () => {
    await saveCreds();
  });

  sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
    upsertAudienceContacts(userId, contacts, chats);
  });

  sock.ev.on('contacts.upsert', (contacts) => {
    upsertAudienceContacts(userId, contacts);
  });

  sock.ev.on('contacts.update', (contacts) => {
    upsertAudienceContacts(userId, contacts);
  });

  sock.ev.on('chats.upsert', (chats) => {
    upsertAudienceContacts(userId, [], chats);
  });

  sock.ev.on('chats.update', (chats) => {
    upsertAudienceContacts(userId, [], chats);
  });

  sock.ev.on('groups.upsert', (groups) => {
    upsertAudienceGroups(userId, groups);
  });

  sock.ev.on('groups.update', (groups) => {
    upsertAudienceGroups(userId, groups);
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      await persistConnectionState(userId, {
        status: 'qr_ready',
        qr,
        message: 'Scan this QR code with WhatsApp on your phone.',
      });
    }

    if (connection === 'open') {
      const phoneNumber = sock?.user?.id || '';
      await User.findByIdAndUpdate(userId, {
        whatsappStatus: 'connected',
        whatsappPhone: phoneNumber,
      });
      await syncAudienceFromSocket(userId, sock);
      await persistConnectionState(userId, {
        status: 'connected',
        qr: '',
        phoneNumber,
        message: 'WhatsApp connected successfully. Credentials were saved to the database.',
      });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      socketStore.delete(userId);

      if (loggedOut) {
        await AuthState.deleteMany({ userId });
        await User.findByIdAndUpdate(userId, { whatsappStatus: 'not_connected', whatsappPhone: '' });
        await persistConnectionState(userId, {
          status: 'logged_out',
          qr: '',
          phoneNumber: '',
          message: 'WhatsApp session logged out. Start a new connection to generate another QR code.',
        });
        return;
      }

      await User.findByIdAndUpdate(userId, { whatsappStatus: 'not_connected' });
      await persistConnectionState(userId, {
        status: 'disconnected',
        qr: '',
        message: 'Connection dropped. Start the session again to reconnect.',
      });
    }
  });

  return connectionStateStore.get(userId) || buildDefaultConnectionState(userId);
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = validateSignupPayload(req.body);
    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    const user = await User.create({
      username,
      email,
      passwordHash: sha256(password),
    });

    const session = await issueSession(user);
    res.status(201).json(session);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email });

  if (!user || user.passwordHash !== sha256(password)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const session = await issueSession(user);
  res.json(session);
});

app.post('/api/auth/logout', authenticateRequest, async (req, res) => {
  await AppSession.deleteOne({ tokenHash: sha256(req.sessionToken) });
  res.json({ success: true });
});

app.get('/api/auth/me', authenticateRequest, async (req, res) => {
  res.json({ user: sanitizeUser(req.user) });
});

app.patch('/api/users/theme', authenticateRequest, async (req, res) => {
  const theme = req.body.theme === 'dark' ? 'dark' : 'light';
  req.user.theme = theme;
  await req.user.save();
  res.json({ user: sanitizeUser(req.user) });
});

app.get('/api/auth/providers/:provider', (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  if (!['google', 'github', 'microsoft'].includes(provider)) {
    return res.status(404).json({ error: 'Unsupported provider.' });
  }
  res.json(buildSocialProviderResponse(provider));
});

app.post('/api/whatsapp/connect', authenticateRequest, async (req, res) => {
  try {
    ensureCredits(req.user, CREDIT_COSTS.whatsappConnect, 'connect WhatsApp');
    const state = await startWhatsAppSession(req.user);
    await applyCreditActivity(req.user, CREDIT_COSTS.whatsappConnect, 'whatsapp_connect');
    res.json({ ...state, user: sanitizeUser(req.user) });
  } catch (error) {
    await persistConnectionState(String(req.user._id), {
      status: 'error',
      qr: '',
      message: error.message || 'Unable to start WhatsApp connection.',
    });
    res.status(500).json({ error: error.message || 'Unable to start WhatsApp connection.' });
  }
});

app.get('/api/whatsapp/status', authenticateRequest, async (req, res) => {
  const userId = String(req.user._id);
  const state = connectionStateStore.get(userId) || await WhatsAppConnection.findOne({ userId }).lean() || buildDefaultConnectionState(userId);
  res.json(state);
});

app.get('/api/whatsapp/audience', authenticateRequest, async (req, res) => {
  const userId = String(req.user._id);
  const sock = socketStore.get(userId);
  const connectionState = connectionStateStore.get(userId) || await WhatsAppConnection.findOne({ userId }).lean() || buildDefaultConnectionState(userId);

  if (sock && connectionState.status === 'connected') {
    await syncAudienceFromSocket(userId, sock).catch(() => null);
  }

  const audience = await getAudienceState(userId);
  res.json({
    status: connectionState.status,
    groups: audience.groups,
    contacts: audience.contacts,
    lastSyncedAt: audience.lastSyncedAt,
  });
});

app.post('/api/tasks', authenticateRequest, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const type = String(req.body.type || '').trim();
  const description = String(req.body.description || '').trim();

  if (!title || !type || !description) {
    return res.status(400).json({ error: 'Title, type, and description are required.' });
  }

  ensureCredits(req.user, CREDIT_COSTS.createTask, 'create a task');

  const recipients = req.body.recipients || {};
  const groupDeliveryMode = recipients.groupDeliveryMode === 'members' ? 'members' : 'group';
  const normalizedRecipients = sanitizeTaskRecipients(recipients);
  const task = await Task.create({
    userId: String(req.user._id),
    title,
    type,
    description,
    messageHtml: String(req.body.messageHtml || ''),
    messageText: String(req.body.messageText || ''),
    translatedPreview: String(req.body.translatedPreview || ''),
    mediaQueue: Array.isArray(req.body.mediaQueue) ? req.body.mediaQueue.slice(0, 10) : [],
    recipients: {
      groups: normalizedRecipients.groups,
      contacts: normalizedRecipients.contacts,
      groupDeliveryMode,
    },
    schedule: req.body.schedule || {},
    status: 'active',
  });

  await applyCreditActivity(req.user, CREDIT_COSTS.createTask, 'task_create');
  res.status(201).json({ task, user: sanitizeUser(req.user) });
});

app.post('/api/ai/text', authenticateRequest, async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

    ensureCredits(req.user, CREDIT_COSTS.generateText, 'generate AI text');

    const text = await callHuggingFaceText(prompt);
    await applyCreditActivity(req.user, CREDIT_COSTS.generateText, 'ai_text');
    res.json({ text, model: 'hugging-face-space', user: sanitizeUser(req.user) });
  } catch (error) {
    console.error('AI text generation failed:', error);
    res.status(500).json({ error: error.message || 'Unable to generate AI text.' });
  }
});

app.post('/api/ai/image', authenticateRequest, async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

    ensureCredits(req.user, CREDIT_COSTS.generateImage, 'generate AI image');

    let imageUrl;
    try {
      imageUrl = await callHuggingFaceImage(prompt);
    } catch (providerError) {
      logger.warn({ error: providerError.message }, 'Hugging Face image generation failed, returning fallback image');
      await applyCreditActivity(req.user, CREDIT_COSTS.generateImage, 'ai_image_fallback');
      return res.json({ imageUrl: fallbackImage(prompt), model: 'fallback-placeholder', user: sanitizeUser(req.user) });
    }
    await applyCreditActivity(req.user, CREDIT_COSTS.generateImage, 'ai_image');
    res.json({ imageUrl, user: sanitizeUser(req.user) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to generate AI image.' });
  }
});

app.get('/api/tasks', authenticateRequest, async (req, res) => {
  const tasks = await Task.find({ userId: String(req.user._id) }).sort({ createdAt: -1 }).lean();
  res.json({ tasks });
});

app.patch('/api/tasks/:taskId/status', authenticateRequest, async (req, res) => {
  const status = String(req.body.status || '').trim().toLowerCase();
  if (!['active', 'paused', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid task status.' });
  }

  const task = await Task.findOneAndUpdate(
    { _id: req.params.taskId, userId: String(req.user._id) },
    { status },
    { new: true },
  );
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  res.json({ task });
});

app.delete('/api/tasks/:taskId', authenticateRequest, async (req, res) => {
  const task = await Task.findOneAndDelete({ _id: req.params.taskId, userId: String(req.user._id) });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  res.json({ success: true });
});

app.post('/api/tasks/bulk-action', authenticateRequest, async (req, res) => {
  const action = String(req.body.action || '').trim().toLowerCase();
  const taskIds = Array.isArray(req.body.taskIds) ? req.body.taskIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (!taskIds.length) return res.status(400).json({ error: 'Select at least one task.' });

  if (action === 'pause') {
    await Task.updateMany({ _id: { $in: taskIds }, userId: String(req.user._id) }, { status: 'paused' });
    return res.json({ success: true, action });
  }

  if (action === 'delete') {
    await Task.deleteMany({ _id: { $in: taskIds }, userId: String(req.user._id) });
    return res.json({ success: true, action });
  }

  return res.status(400).json({ error: 'Unsupported bulk action.' });
});

app.post('/api/enquiries', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const message = String(req.body.message || '').trim();

  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  }

  await Enquiry.create({ name, email, message, recipient: 'admin@codesignite.com' });

  const mailtoUrl = `mailto:admin@codesignite.com?subject=${encodeURIComponent(`CodeBot enquiry from ${name}`)}&body=${encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`)}`;
  res.status(201).json({
    success: true,
    message: 'Enquiry saved and ready to send to admin@codesignite.com.',
    mailtoUrl,
  });
});

app.get('/api/config/required-credentials', (req, res) => {
  res.json({
    database: ['CLOUD_MONGO_URI or USE_LOCAL=true'],
    socialLogin: {
      google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
      github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL'],
      microsoft: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_CALLBACK_URL'],
    },
    optional: ['PORT', 'DEFAULT_SIGNUP_CREDITS', 'HUGGINGFACE_TEXT_SPACE_ID', 'HUGGINGFACE_IMAGE_SPACE_ID', 'HUGGINGFACE_TEXT_SYSTEM_PROMPT'],
  });
});

app.use((req, res) => {
  res.sendFile(new URL('./public/index.html', import.meta.url).pathname);
});

connectDatabase()
  .then(() => {
    startTaskScheduler();
    app.listen(PORT, () => console.log(`🚀 App running on http://localhost:${PORT}`));
  })
  .catch((error) => {
    console.error('❌ Startup failure:', error.message);
    process.exit(1);
  });
