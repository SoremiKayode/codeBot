import crypto from 'crypto';
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import pino from 'pino';

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
const SILICONFLOW_API_KEY = process.env.SILICONFLOW_API_KEY || '';
const SILICONFLOW_BASE_URL = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1';
const SILICONFLOW_TEXT_MODEL = process.env.SILICONFLOW_TEXT_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
const SILICONFLOW_IMAGE_MODEL = process.env.SILICONFLOW_IMAGE_MODEL || 'Qwen/Qwen-Image';
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
    throw new Error(`Not enough credits to ${label}.`);
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
  status: { type: String, enum: ['draft', 'active', 'completed'], default: 'active' },
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

async function callSiliconFlow(path, payload) {
  if (!SILICONFLOW_API_KEY) {
    throw new Error('Missing SILICONFLOW_API_KEY on the server. Add it to your environment before using AI generation.');
  }

  const response = await fetch(`${SILICONFLOW_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error?.message || 'SiliconFlow request failed.');
  }
  return data;
}

function fallbackImage(prompt) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="100%" height="100%" fill="#0f172a"/><rect x="64" y="64" width="896" height="896" rx="48" fill="#25d366" opacity="0.16"/><text x="80" y="220" fill="white" font-size="56" font-family="Arial">AI image placeholder</text><text x="80" y="320" fill="white" font-size="28" font-family="Arial">${String(prompt).replace(/[<&>]/g, '')}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
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

  const task = await Task.create({
    userId: String(req.user._id),
    title,
    type,
    description,
    messageHtml: String(req.body.messageHtml || ''),
    messageText: String(req.body.messageText || ''),
    translatedPreview: String(req.body.translatedPreview || ''),
    mediaQueue: Array.isArray(req.body.mediaQueue) ? req.body.mediaQueue.slice(0, 10) : [],
    recipients: req.body.recipients || { groups: [], contacts: [] },
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

    const data = await callSiliconFlow('/chat/completions', {
      model: SILICONFLOW_TEXT_MODEL,
      messages: [
        { role: 'system', content: 'You write concise WhatsApp-ready marketing and operational messages.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    });

    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('No text was returned by the AI provider.');
    await applyCreditActivity(req.user, CREDIT_COSTS.generateText, 'ai_text');
    res.json({ text, user: sanitizeUser(req.user) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to generate AI text.' });
  }
});

app.post('/api/ai/image', authenticateRequest, async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

    ensureCredits(req.user, CREDIT_COSTS.generateImage, 'generate AI image');

    if (!SILICONFLOW_API_KEY) {
      await applyCreditActivity(req.user, CREDIT_COSTS.generateImage, 'ai_image_fallback');
      return res.json({ imageUrl: fallbackImage(prompt), model: 'fallback-placeholder', user: sanitizeUser(req.user) });
    }

    const data = await callSiliconFlow('/images/generations', {
      model: SILICONFLOW_IMAGE_MODEL,
      prompt,
      size: '1024x1024',
    });

    const imageUrl = data.images?.[0]?.url || data.data?.[0]?.url || data.data?.[0]?.b64_json && `data:image/png;base64,${data.data[0].b64_json}`;
    if (!imageUrl) throw new Error('No image was returned by the AI provider.');
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
    optional: ['PORT', 'DEFAULT_SIGNUP_CREDITS'],
  });
});

app.use((req, res) => {
  res.sendFile(new URL('./public/index.html', import.meta.url).pathname);
});

connectDatabase()
  .then(() => {
    app.listen(PORT, () => console.log(`🚀 App running on http://localhost:${PORT}`));
  })
  .catch((error) => {
    console.error('❌ Startup failure:', error.message);
    process.exit(1);
  });
