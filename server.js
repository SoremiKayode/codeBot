import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const requestCounts = new Map();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});
app.use((req, res, next) => {
  const key = `${req.ip}:${Math.floor(Date.now() / 60000)}`;
  const nextCount = Number(requestCounts.get(key) || 0) + 1;
  requestCounts.set(key, nextCount);
  if (nextCount > Number(process.env.RATE_LIMIT_PER_MINUTE || 240)) {
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  }
  next();
});
setInterval(() => {
  const cutoff = Math.floor(Date.now() / 60000) - 2;
  for (const key of requestCounts.keys()) {
    const bucket = Number(key.split(':').pop());
    if (bucket < cutoff) requestCounts.delete(key);
  }
}, 60000).unref();

app.use(express.json({ limit: '20mb' }));
app.use(express.static(PUBLIC_DIR));

const IS_LOCAL = process.env.USE_LOCAL === 'true';
const MONGO_URI = IS_LOCAL ? 'mongodb://localhost:27017/whatsapp_bot' : process.env.CLOUD_MONGO_URI;
const PORT = Number(process.env.PORT || 3000);
const CREDIT_SIGNUP_BONUS = Number(process.env.DEFAULT_SIGNUP_CREDITS || 150);
const DEFAULT_TIMEZONE = process.env.DEFAULT_TENANT_TIMEZONE || 'UTC';
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
const APP_PERMISSIONS = {
  OWNER: ['tenant:manage', 'members:manage', 'credits:manage', 'whatsapp:connect', 'tasks:write', 'tasks:read', 'tasks:dispatch'],
  ADMIN: ['members:manage', 'whatsapp:connect', 'tasks:write', 'tasks:read', 'tasks:dispatch'],
  OPERATOR: ['tasks:write', 'tasks:read', 'tasks:dispatch'],
  VIEWER: ['tasks:read'],
};

const connectionStateStore = new Map();
const socketStore = new Map();
const audienceStore = new Map();
const huggingFaceClientStore = new Map();
const oauthStateStore = new Map();

const OAUTH_PROVIDERS = {
  google: {
    clientIdEnv: 'GOOGLE_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    callbackEnv: 'GOOGLE_CALLBACK_URL',
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile'],
  },
  github: {
    clientIdEnv: 'GITHUB_CLIENT_ID',
    clientSecretEnv: 'GITHUB_CLIENT_SECRET',
    callbackEnv: 'GITHUB_CALLBACK_URL',
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['read:user', 'user:email'],
  },
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function createOAuthState(provider, mode) {
  const state = crypto.randomBytes(24).toString('hex');
  oauthStateStore.set(state, {
    provider,
    mode,
    createdAt: Date.now(),
  });
  return state;
}

function consumeOAuthState(state, provider = null) {
  const payload = oauthStateStore.get(state);
  oauthStateStore.delete(state);
  if (!payload) return null;
  if (provider && payload.provider !== provider) return null;
  if (Date.now() - payload.createdAt > 10 * 60 * 1000) return null;
  return payload;
}

function derivePasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, passwordHash = '') {
  const [salt, stored] = String(passwordHash || '').split(':');
  if (!salt || !stored) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(stored, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

function getOAuthProviderConfig(provider) {
  const definition = OAUTH_PROVIDERS[provider];
  if (!definition) return null;
  const clientId = process.env[definition.clientIdEnv] || '';
  const clientSecret = process.env[definition.clientSecretEnv] || '';
  const callbackUrl = process.env[definition.callbackEnv] || '';
  return {
    ...definition,
    clientId,
    clientSecret,
    callbackUrl,
    available: Boolean(clientId && clientSecret && callbackUrl),
  };
}

setInterval(() => {
  const cutoff = Date.now() - (10 * 60 * 1000);
  for (const [state, value] of oauthStateStore.entries()) {
    if (value.createdAt < cutoff) oauthStateStore.delete(state);
  }
}, 60000).unref();

function slugify(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 48) || `workspace-${Date.now()}`;
}

function getPermissionsForRole(role = 'viewer') {
  return APP_PERMISSIONS[String(role || '').toUpperCase()] || APP_PERMISSIONS.VIEWER;
}

function hasPermission(role, permission) {
  return getPermissionsForRole(role).includes(permission);
}

function sanitizeUser(user, membership = null, tenant = null) {
  return {
    id: String(user._id),
    username: user.username,
    email: user.email,
    theme: user.theme,
    whatsappStatus: user.whatsappStatus,
    whatsappPhone: user.whatsappPhone,
    walletBalance: user.walletBalance,
    activeTenant: tenant ? {
      id: String(tenant._id),
      name: tenant.name,
      slug: tenant.slug,
      timezone: tenant.timezone,
      credits: tenant.credits,
    } : null,
    tenantRole: membership?.role || null,
    permissions: membership ? getPermissionsForRole(membership.role) : [],
    credits: tenant?.credits ?? user.credits,
  };
}

function buildDefaultConnectionState(tenantId) {
  return {
    tenantId,
    status: 'idle',
    qr: '',
    lastUpdatedAt: new Date(),
    phoneNumber: '',
    message: 'Connect your WhatsApp account to start automation.',
  };
}

function setConnectionState(tenantId, updates) {
  const current = connectionStateStore.get(tenantId) || buildDefaultConnectionState(tenantId);
  const next = { ...current, ...updates, lastUpdatedAt: new Date() };
  connectionStateStore.set(tenantId, next);
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
    groups: groups.map((group) => ({
      id: normalizeGroupJid(group.id || group.name || ''),
      name: String(group.name || group.id || 'Unnamed group').trim(),
      members: Number(group.members || 0),
      category: String(group.category || 'Group').trim(),
    })).filter((group) => group.id && !seenGroups.has(group.id) && seenGroups.add(group.id)),
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

async function snapshotAudience(tenantId, state) {
  if (!state) return;
  await Promise.all([
    TenantAudienceGroup.deleteMany({ tenantId }),
    TenantAudienceContact.deleteMany({ tenantId }),
  ]);
  if (state.groups.length) {
    await TenantAudienceGroup.insertMany(state.groups.map((group) => ({ tenantId, ...group })), { ordered: false }).catch(() => null);
  }
  if (state.contacts.length) {
    await TenantAudienceContact.insertMany(state.contacts.map((contact) => ({ tenantId, ...contact })), { ordered: false }).catch(() => null);
  }
}

async function upsertAudienceContacts(tenantId, contacts = [], chats = []) {
  const current = audienceStore.get(tenantId) || buildDefaultAudienceState();
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
  const next = { ...current, contacts: Array.from(nextContacts.values()).sort((a, b) => a.name.localeCompare(b.name)), lastSyncedAt: new Date() };
  audienceStore.set(tenantId, next);
  await snapshotAudience(tenantId, next);
  return next;
}

async function upsertAudienceGroups(tenantId, groups = []) {
  const current = audienceStore.get(tenantId) || buildDefaultAudienceState();
  const nextGroups = new Map(current.groups.map((group) => [group.id, group]));
  groups.forEach((group) => {
    const normalized = normalizeGroup(group);
    if (normalized.id) nextGroups.set(normalized.id, normalized);
  });
  const next = { ...current, groups: Array.from(nextGroups.values()).sort((a, b) => a.name.localeCompare(b.name)), lastSyncedAt: new Date() };
  audienceStore.set(tenantId, next);
  await snapshotAudience(tenantId, next);
  return next;
}

async function syncAudienceFromSocket(tenantId, sock) {
  const allGroups = await sock.groupFetchAllParticipating().catch(() => ({}));
  await upsertAudienceGroups(tenantId, Object.values(allGroups || {}));
  return audienceStore.get(tenantId) || buildDefaultAudienceState();
}

async function getAudienceState(tenantId) {
  const inMemory = audienceStore.get(tenantId);
  if (inMemory) return inMemory;
  const [groups, contacts] = await Promise.all([
    TenantAudienceGroup.find({ tenantId }).sort({ name: 1 }).lean(),
    TenantAudienceContact.find({ tenantId }).sort({ name: 1 }).lean(),
  ]);
  return {
    groups: groups.map(({ _id, tenantId: ignoredTenantId, __v, createdAt, updatedAt, ...rest }) => rest),
    contacts: contacts.map(({ _id, tenantId: ignoredTenantId, __v, createdAt, updatedAt, ...rest }) => rest),
    lastSyncedAt: groups[0]?.updatedAt || contacts[0]?.updatedAt || null,
  };
}

const tenantSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, trim: true },
  timezone: { type: String, default: DEFAULT_TIMEZONE },
  credits: { type: Number, default: CREDIT_SIGNUP_BONUS },
  billingEmail: { type: String, default: '' },
  settings: {
    quietHours: { type: Object, default: {} },
    sendWindow: { type: Object, default: {} },
  },
}, { timestamps: true });

const tenantMembershipSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, enum: ['owner', 'admin', 'operator', 'viewer'], default: 'owner' },
  status: { type: String, enum: ['active', 'invited', 'disabled'], default: 'active' },
}, { timestamps: true });
tenantMembershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

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
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  createdAt: { type: Date, default: Date.now, expires: '14d' },
});

const authSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  key: { type: String, required: true },
  data: { type: String, required: true },
}, { timestamps: true });
authSchema.index({ tenantId: 1, key: 1 }, { unique: true });

const whatsappConnectionSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, unique: true },
  userId: { type: String, required: true },
  status: { type: String, default: 'idle' },
  qr: { type: String, default: '' },
  phoneNumber: { type: String, default: '' },
  message: { type: String, default: '' },
  lastUpdatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

const taskSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  createdByUserId: { type: String, required: true },
  title: { type: String, required: true, trim: true },
  type: { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  messageHtml: { type: String, default: '' },
  messageText: { type: String, default: '' },
  translatedPreview: { type: String, default: '' },
  mediaQueue: { type: Array, default: [] },
  recipients: { type: Object, default: { groups: [], contacts: [] } },
  schedule: { type: Object, default: {} },
  timezone: { type: String, default: DEFAULT_TIMEZONE },
  status: { type: String, enum: ['draft', 'active', 'paused', 'completed'], default: 'active' },
  nextRunAt: { type: Date, default: null, index: true },
  lastRunAt: { type: Date, default: null },
  lastRunKey: { type: String, default: '' },
  completedAt: { type: Date, default: null },
  lastError: { type: String, default: '' },
  deliveryStats: {
    attempted: { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
  },
}, { timestamps: true });

const creditLedgerSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  type: { type: String, required: true },
  delta: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  metadata: { type: Object, default: {} },
}, { timestamps: true });

const messageDispatchSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  taskId: { type: String, required: true, index: true },
  recipient: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed', 'skipped'], default: 'pending' },
  error: { type: String, default: '' },
  dispatchedAt: { type: Date, default: null },
  messageType: { type: String, default: 'text' },
}, { timestamps: true });

const tenantAudienceGroupSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  id: { type: String, required: true },
  name: { type: String, required: true },
  members: { type: Number, default: 0 },
  category: { type: String, default: 'Group' },
}, { timestamps: true });
tenantAudienceGroupSchema.index({ tenantId: 1, id: 1 }, { unique: true });

const tenantAudienceContactSchema = new mongoose.Schema({
  tenantId: { type: String, required: true, index: true },
  id: { type: String, required: true },
  name: { type: String, required: true },
  phone: { type: String, default: '' },
  segment: { type: String, default: 'Contact' },
}, { timestamps: true });
tenantAudienceContactSchema.index({ tenantId: 1, id: 1 }, { unique: true });

const enquirySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  message: { type: String, required: true, trim: true },
  recipient: { type: String, default: 'admin@codesignite.com' },
}, { timestamps: true });

const Tenant = mongoose.model('Tenant', tenantSchema);
const TenantMembership = mongoose.model('TenantMembership', tenantMembershipSchema);
const User = mongoose.model('User', userSchema);
const AppSession = mongoose.model('AppSession', appSessionSchema);
const AuthState = mongoose.model('AuthState', authSchema);
const WhatsAppConnection = mongoose.model('WhatsAppConnection', whatsappConnectionSchema);
const Task = mongoose.model('Task', taskSchema);
const CreditLedger = mongoose.model('CreditLedger', creditLedgerSchema);
const MessageDispatch = mongoose.model('MessageDispatch', messageDispatchSchema);
const TenantAudienceGroup = mongoose.model('TenantAudienceGroup', tenantAudienceGroupSchema);
const TenantAudienceContact = mongoose.model('TenantAudienceContact', tenantAudienceContactSchema);
const Enquiry = mongoose.model('Enquiry', enquirySchema);

async function connectDatabase() {
  if (!MONGO_URI) throw new Error('Missing MongoDB connection string. Set CLOUD_MONGO_URI or USE_LOCAL=true.');
  await mongoose.connect(MONGO_URI);
  logger.info({ mode: IS_LOCAL ? 'local' : 'cloud' }, 'MongoDB connected');
}

async function persistConnectionState(tenantId, updates) {
  const next = setConnectionState(tenantId, updates);
  await WhatsAppConnection.findOneAndUpdate({ tenantId }, { tenantId, ...next }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return next;
}

async function useMongooseAuthState(tenantId) {
  const writeData = async (data, key) => {
    const json = JSON.stringify(data, BufferJSON.replacer);
    await AuthState.findOneAndUpdate({ tenantId, key }, { tenantId, key, data: json }, { upsert: true, new: true, setDefaultsOnInsert: true });
  };
  const readData = async (key) => {
    const record = await AuthState.findOne({ tenantId, key });
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
            if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) await writeData(value, key);
              else await AuthState.deleteOne({ tenantId, key });
            }
          }
        },
      },
    },
    saveCreds: async () => writeData(creds, 'creds'),
  };
}

async function authenticateRequest(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  const session = await AppSession.findOne({ tokenHash: sha256(token) });
  if (!session) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  const [user, tenant, membership] = await Promise.all([
    User.findById(session.userId),
    Tenant.findById(session.tenantId),
    TenantMembership.findOne({ tenantId: session.tenantId, userId: session.userId, status: 'active' }),
  ]);
  if (!user || !tenant || !membership) return res.status(401).json({ error: 'Workspace membership is no longer active.' });
  req.user = user;
  req.tenant = tenant;
  req.membership = membership;
  req.sessionToken = token;
  next();
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!hasPermission(req.membership?.role, permission)) {
      return res.status(403).json({ error: `You do not have permission to ${permission}.` });
    }
    next();
  };
}

function validateTimezone(timezone = DEFAULT_TIMEZONE) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function validateSignupPayload(payload) {
  const username = String(payload.username || '').trim();
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const workspaceName = String(payload.workspaceName || `${username}'s Workspace`).trim();
  const timezone = validateTimezone(String(payload.timezone || DEFAULT_TIMEZONE).trim());
  if (!username || username.length < 2) throw new Error('Username must be at least 2 characters long.');
  if (!email.includes('@')) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters long.');
  if (!workspaceName || workspaceName.length < 2) throw new Error('Workspace name must be at least 2 characters long.');
  return { username, email, password, workspaceName, timezone };
}

async function issueSession(user, tenant, membership) {
  const token = createToken();
  await AppSession.create({ tokenHash: sha256(token), userId: user._id, tenantId: tenant._id });
  return { token, user: sanitizeUser(user, membership, tenant) };
}

async function appendCreditLedger({ tenant, user, amount, type, metadata = {} }) {
  const normalizedAmount = Number(amount || 0);
  if (!normalizedAmount) return tenant;
  tenant.credits = Math.max(0, Number(tenant.credits || 0) - normalizedAmount);
  await tenant.save();
  await CreditLedger.create({
    tenantId: String(tenant._id),
    userId: String(user._id),
    type,
    delta: -normalizedAmount,
    balanceAfter: tenant.credits,
    metadata,
  });
  return tenant;
}

function ensureCredits(tenant, amount, label) {
  if (Number(tenant.credits || 0) < Number(amount || 0)) {
    throw new Error(`Insufficient credits to ${label}. Your workspace has ${Number(tenant.credits || 0)} credits remaining.`);
  }
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
  if (!submitResponse.ok || !submitPayload.event_id) throw new Error(submitPayload.error || 'Unable to start Hugging Face Space request.');
  const streamResponse = await fetch(`${baseUrl}/gradio_api/call${normalizedApiName}/${submitPayload.event_id}`);
  if (!streamResponse.ok) throw new Error(`Hugging Face Space stream failed with status ${streamResponse.status}.`);
  const streamText = await streamResponse.text();
  const eventBlocks = streamText.split(/\n\n+/).map((block) => block.trim()).filter(Boolean);
  for (const block of eventBlocks.reverse()) {
    const lines = block.split('\n');
    const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const dataLines = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
    const rawData = dataLines.join('\n');
    if (eventName === 'error') throw new Error(rawData || 'Hugging Face Space request failed.');
    if (eventName === 'complete' && rawData) return JSON.parse(rawData);
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

async function getHuggingFaceClient(spaceId) {
  if (!huggingFaceClientStore.has(spaceId)) huggingFaceClientStore.set(spaceId, Client.connect(spaceId));
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
    async () => client.predict(HUGGINGFACE_IMAGE_API_NAME, { prompt, seed: HUGGINGFACE_IMAGE_SEED, randomize_seed: HUGGINGFACE_IMAGE_RANDOMIZE_SEED, width: HUGGINGFACE_IMAGE_WIDTH, height: HUGGINGFACE_IMAGE_HEIGHT }),
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
    async () => callHuggingFaceSpace(HUGGINGFACE_IMAGE_SPACE_ID, HUGGINGFACE_IMAGE_API_NAME, [prompt, HUGGINGFACE_IMAGE_NEGATIVE_PROMPT, HUGGINGFACE_IMAGE_SEED, HUGGINGFACE_IMAGE_RANDOMIZE_SEED, HUGGINGFACE_IMAGE_WIDTH, HUGGINGFACE_IMAGE_HEIGHT, HUGGINGFACE_IMAGE_GUIDANCE_SCALE, HUGGINGFACE_IMAGE_STEPS]),
  ];
  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      const imageUrl = extractImageUrlFromSpaceResult(result?.data ?? result);
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
  return /^\d{2}:\d{2}$/.test(String(value || '').trim()) ? String(value).trim() : '';
}

function normalizeDayName(value = '') {
  const trimmed = String(value || '').trim().toLowerCase();
  return trimmed ? `${trimmed[0].toUpperCase()}${trimmed.slice(1)}` : '';
}

function getWeekOfMonth(date, timezone = DEFAULT_TIMEZONE) {
  const zoned = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const dayOfMonth = zoned.getDate();
  const lastDay = new Date(zoned.getFullYear(), zoned.getMonth() + 1, 0).getDate();
  if (dayOfMonth + 7 > lastDay) return 'last week';
  if (dayOfMonth <= 7) return 'first week';
  if (dayOfMonth <= 14) return 'second week';
  if (dayOfMonth <= 21) return 'third week';
  return 'fourth week';
}

function getDatePartsForTimezone(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    today: `${parts.year}-${parts.month}-${parts.day}`,
    currentTime: `${parts.hour}:${parts.minute}`,
    dayName: parts.weekday,
  };
}

function buildRunKey(date, frequency, timeValue, timezone) {
  const { today } = getDatePartsForTimezone(date, timezone);
  return `${frequency || 'once'}:${today}:${timeValue || '00:00'}:${timezone}`;
}

function computeNextRunAt(schedule = {}, timezone = DEFAULT_TIMEZONE, now = new Date()) {
  const frequency = String(schedule.frequency || '').trim().toLowerCase();
  const startDate = String(schedule.startDate || '').trim();
  const startTime = normalizeTimeValue(schedule.startTime);
  if (!frequency || !startDate || !startTime) return null;
  const base = new Date(`${startDate}T${startTime}:00.000Z`);
  if (Number.isNaN(base.getTime())) return null;
  if (frequency === 'once') return base;
  if (base > now) return base;
  return new Date(now.getTime() + 60000);
}

function validateSchedule(schedule = {}, timezone = DEFAULT_TIMEZONE) {
  const normalized = {
    startDate: String(schedule.startDate || '').trim(),
    startTime: normalizeTimeValue(schedule.startTime),
    frequency: String(schedule.frequency || '').trim().toLowerCase(),
    dailyTimes: Array.isArray(schedule.dailyTimes) ? schedule.dailyTimes.map(normalizeTimeValue).filter(Boolean) : [],
    weeklySlots: Array.isArray(schedule.weeklySlots) ? schedule.weeklySlots.map((slot) => ({ day: normalizeDayName(slot?.day), time: normalizeTimeValue(slot?.time) })).filter((slot) => slot.day && slot.time) : [],
    monthlyWeeks: Array.isArray(schedule.monthlyWeeks) ? schedule.monthlyWeeks.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean) : [],
    monthlyDays: Array.isArray(schedule.monthlyDays) ? schedule.monthlyDays.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= 31) : [],
    timezone: validateTimezone(timezone),
  };
  if (!normalized.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(normalized.startDate)) throw new Error('A valid start date is required.');
  if (!normalized.startTime) throw new Error('A valid start time is required.');
  if (!['once', 'daily', 'weekly', 'monthly'].includes(normalized.frequency)) throw new Error('A valid schedule frequency is required.');
  if (normalized.frequency === 'daily' && !normalized.dailyTimes.length) normalized.dailyTimes = [normalized.startTime];
  if (normalized.frequency === 'weekly' && !normalized.weeklySlots.length) throw new Error('Weekly tasks require at least one weekday/time slot.');
  if (normalized.frequency === 'monthly' && !normalized.monthlyWeeks.length && !normalized.monthlyDays.length) throw new Error('Monthly tasks require at least one week or day rule.');
  return normalized;
}

function shouldRunTaskNow(task, now = new Date()) {
  const schedule = task?.schedule || {};
  const timezone = validateTimezone(task?.timezone || schedule?.timezone || DEFAULT_TIMEZONE);
  const startDate = String(schedule.startDate || '').trim();
  const startTime = normalizeTimeValue(schedule.startTime);
  const frequency = String(schedule.frequency || '').trim().toLowerCase();
  if (!startDate || !startTime || !frequency) return { due: false, reason: 'missing_schedule' };
  const { today, currentTime, dayName } = getDatePartsForTimezone(now, timezone);
  if (today < startDate) return { due: false, reason: 'before_start_date' };
  let due = false;
  if (frequency === 'once') due = today === startDate && currentTime === startTime;
  else if (frequency === 'daily') {
    const times = Array.isArray(schedule.dailyTimes) ? schedule.dailyTimes.map(normalizeTimeValue).filter(Boolean) : [];
    due = (times.length ? times : [startTime]).includes(currentTime);
  } else if (frequency === 'weekly') {
    const slots = Array.isArray(schedule.weeklySlots) ? schedule.weeklySlots : [];
    due = slots.some((slot) => normalizeDayName(slot?.day) === dayName && normalizeTimeValue(slot?.time) === currentTime);
  } else if (frequency === 'monthly') {
    const monthlyDays = Array.isArray(schedule.monthlyDays) ? schedule.monthlyDays.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 31) : [];
    const monthlyWeeks = Array.isArray(schedule.monthlyWeeks) ? schedule.monthlyWeeks.map((value) => String(value || '').trim().toLowerCase()) : [];
    const zoned = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
    const weekLabel = getWeekOfMonth(now, timezone);
    due = monthlyDays.includes(zoned.getDate()) || (monthlyWeeks.includes(weekLabel) && currentTime === startTime);
  }
  if (!due) return { due: false, reason: 'rule_mismatch' };
  const runKey = buildRunKey(now, frequency, currentTime, timezone);
  if (task.lastRunKey === runKey) return { due: false, reason: 'already_ran', runKey };
  return { due: true, runKey, frequency, currentTime, timezone };
}

function dataUrlToBuffer(dataUrl = '') {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  return match ? { mimeType: match[1], buffer: Buffer.from(match[2], 'base64') } : null;
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

async function recordDispatch(tenantId, taskId, recipient, status, error = '', messagePayload = {}) {
  await MessageDispatch.create({
    tenantId,
    taskId,
    recipient,
    status,
    error,
    dispatchedAt: status === 'sent' ? new Date() : null,
    messageType: messagePayload.image ? 'image' : messagePayload.video ? 'video' : messagePayload.audio ? 'audio' : messagePayload.document ? 'document' : 'text',
  });
}

async function processDueTasks() {
  const now = new Date();
  const activeTasks = await Task.find({ status: 'active' });
  for (const task of activeTasks) {
    const timing = shouldRunTaskNow(task, now);
    if (!timing.due) continue;
    const tenantId = String(task.tenantId || '');
    const sock = socketStore.get(tenantId);
    if (!sock) {
      task.lastError = 'WhatsApp is not connected for this workspace.';
      task.nextRunAt = computeNextRunAt(task.schedule, task.timezone, new Date(now.getTime() + 60000));
      await task.save();
      continue;
    }
    const messagePayload = await buildMessagePayload(task);
    if (!messagePayload) {
      task.lastError = 'No sendable message payload was available.';
      await task.save();
      continue;
    }
    const recipients = await resolveTaskRecipients(task, sock);
    if (!recipients.length) {
      task.lastError = 'No recipients were resolved.';
      await task.save();
      continue;
    }
    let deliveredCount = 0;
    let failedCount = 0;
    for (const recipient of recipients) {
      try {
        await sock.sendMessage(recipient, messagePayload);
        deliveredCount += 1;
        await recordDispatch(tenantId, String(task._id), recipient, 'sent', '', messagePayload);
      } catch (error) {
        failedCount += 1;
        await recordDispatch(tenantId, String(task._id), recipient, 'failed', error.message, messagePayload);
        logger.error({ taskId: String(task._id), recipient, error: error.message }, 'Failed to send scheduled WhatsApp message');
      }
    }
    task.lastRunAt = now;
    task.lastRunKey = timing.runKey;
    task.lastError = failedCount ? `Failed for ${failedCount} recipient(s).` : '';
    task.deliveryStats = { attempted: recipients.length, delivered: deliveredCount, failed: failedCount };
    task.nextRunAt = timing.frequency === 'once' ? null : computeNextRunAt(task.schedule, task.timezone, new Date(now.getTime() + 60000));
    if (timing.frequency === 'once') {
      task.status = 'completed';
      task.completedAt = now;
    }
    await task.save();
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
  const config = getOAuthProviderConfig(provider);
  const requiredCredentials = provider === 'google'
    ? ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL']
    : provider === 'github'
      ? ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL']
      : ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_CALLBACK_URL'];
  return {
    provider,
    available: Boolean(config?.available),
    message: config?.available
      ? `${provider[0].toUpperCase()}${provider.slice(1)} OAuth is configured and ready.`
      : `Provide ${provider} OAuth client credentials to enable this login flow.`,
    requiredCredentials,
  };
}

function buildOAuthErrorRedirect(provider, message) {
  return `/auth/callback.html?error=${encodeURIComponent(message)}&provider=${encodeURIComponent(provider)}`;
}

function buildOAuthSuccessRedirect(session, provider, mode) {
  const params = new URLSearchParams({
    token: session.token,
    provider,
    mode,
    message: mode === 'signup' ? 'Account created successfully.' : 'Logged in successfully.',
  });
  return `/auth/callback.html?${params.toString()}`;
}

async function exchangeGoogleCodeForProfile(code, config) {
  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || 'Google token exchange failed.');
  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !profile.email) throw new Error(profile.error_description || 'Google profile lookup failed.');
  return {
    email: String(profile.email).toLowerCase(),
    username: String(profile.name || profile.given_name || profile.email.split('@')[0] || 'Google User').trim(),
    providerUserId: String(profile.sub || ''),
  };
}

async function exchangeGitHubCodeForProfile(code, config) {
  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
    }),
  });
  const tokenData = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || tokenData.error || 'GitHub token exchange failed.');
  const headers = { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'CodeBot OAuth' };
  const [userResponse, emailsResponse] = await Promise.all([
    fetch('https://api.github.com/user', { headers }),
    fetch('https://api.github.com/user/emails', { headers }),
  ]);
  const user = await userResponse.json().catch(() => ({}));
  const emails = await emailsResponse.json().catch(() => ([]));
  const primaryEmail = Array.isArray(emails)
    ? emails.find((entry) => entry.primary && entry.verified)?.email || emails.find((entry) => entry.verified)?.email
    : '';
  const email = String(primaryEmail || user.email || '').toLowerCase();
  if (!email) throw new Error('GitHub did not return a verified email address.');
  return {
    email,
    username: String(user.name || user.login || email.split('@')[0] || 'GitHub User').trim(),
    providerUserId: String(user.id || ''),
  };
}

async function findOrCreateSocialUser(provider, profile, mode = 'login') {
  let user = await User.findOne({ email: profile.email });
  let tenant;
  let membership;
  let created = false;
  const providerPath = `socialProviders.${provider}`;

  if (!user) {
    if (mode === 'login') throw new Error(`No account found for ${profile.email}. Use sign up with ${provider[0].toUpperCase()}${provider.slice(1)} first.`);
    const workspaceName = `${profile.username}'s Workspace`;
    const slugBase = slugify(workspaceName);
    let slug = slugBase;
    let suffix = 1;
    while (await Tenant.findOne({ slug })) slug = `${slugBase}-${suffix++}`;
    user = await User.create({
      username: profile.username,
      email: profile.email,
      passwordHash: derivePasswordHash(createToken()),
      socialProviders: { [provider]: true },
    });
    tenant = await Tenant.create({ name: workspaceName, slug, timezone: DEFAULT_TIMEZONE, billingEmail: profile.email, credits: CREDIT_SIGNUP_BONUS });
    membership = await TenantMembership.create({ tenantId: tenant._id, userId: user._id, role: 'owner', status: 'active' });
    await CreditLedger.create({ tenantId: String(tenant._id), userId: String(user._id), type: 'signup_bonus', delta: CREDIT_SIGNUP_BONUS, balanceAfter: tenant.credits, metadata: { source: `${provider}_oauth_signup`, providerUserId: profile.providerUserId } });
    created = true;
  } else {
    if (!user.socialProviders?.[provider]) {
      user.set(providerPath, true);
      if (!user.username || user.username === user.email) user.username = profile.username;
      await user.save();
    }
    membership = await TenantMembership.findOne({ userId: user._id, status: 'active' }).sort({ createdAt: 1 });
    if (!membership) throw new Error('No active workspace membership found for this account.');
    tenant = await Tenant.findById(membership.tenantId);
    if (!tenant) throw new Error('Workspace not found for this account.');
  }

  return { user, tenant, membership, created };
}

async function startWhatsAppSession(user, tenant) {
  const tenantId = String(tenant._id);
  if (socketStore.has(tenantId)) return connectionStateStore.get(tenantId) || buildDefaultConnectionState(tenantId);
  await persistConnectionState(tenantId, { status: 'connecting', qr: '', phoneNumber: user.whatsappPhone || '', message: 'Starting WhatsApp connection and waiting for QR code.', userId: String(user._id) });
  await User.findByIdAndUpdate(user._id, { whatsappStatus: 'connecting' });
  const { version } = await fetchLatestBaileysVersion();
  const { state, saveCreds } = await useMongooseAuthState(tenantId);
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, syncFullHistory: false, markOnlineOnConnect: false });
  socketStore.set(tenantId, sock);
  sock.ev.on('creds.update', async () => { await saveCreds(); });
  sock.ev.on('messaging-history.set', ({ contacts, chats }) => { upsertAudienceContacts(tenantId, contacts, chats); });
  sock.ev.on('contacts.upsert', (contacts) => { upsertAudienceContacts(tenantId, contacts); });
  sock.ev.on('contacts.update', (contacts) => { upsertAudienceContacts(tenantId, contacts); });
  sock.ev.on('chats.upsert', (chats) => { upsertAudienceContacts(tenantId, [], chats); });
  sock.ev.on('chats.update', (chats) => { upsertAudienceContacts(tenantId, [], chats); });
  sock.ev.on('groups.upsert', (groups) => { upsertAudienceGroups(tenantId, groups); });
  sock.ev.on('groups.update', (groups) => { upsertAudienceGroups(tenantId, groups); });
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      await persistConnectionState(tenantId, { status: 'qr_ready', qr, message: 'Scan this QR code with WhatsApp on your phone.', userId: String(user._id) });
    }
    if (connection === 'open') {
      const phoneNumber = sock?.user?.id || '';
      await User.findByIdAndUpdate(user._id, { whatsappStatus: 'connected', whatsappPhone: phoneNumber });
      await syncAudienceFromSocket(tenantId, sock);
      await persistConnectionState(tenantId, { status: 'connected', qr: '', phoneNumber, message: 'WhatsApp connected successfully. Credentials were saved to the workspace.', userId: String(user._id) });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      socketStore.delete(tenantId);
      if (loggedOut) {
        await AuthState.deleteMany({ tenantId });
        await User.findByIdAndUpdate(user._id, { whatsappStatus: 'not_connected', whatsappPhone: '' });
        await persistConnectionState(tenantId, { status: 'logged_out', qr: '', phoneNumber: '', message: 'WhatsApp session logged out. Start a new connection to generate another QR code.', userId: String(user._id) });
        return;
      }
      await User.findByIdAndUpdate(user._id, { whatsappStatus: 'not_connected' });
      await persistConnectionState(tenantId, { status: 'disconnected', qr: '', message: 'Connection dropped. Start the session again to reconnect.', userId: String(user._id) });
    }
  });
  return connectionStateStore.get(tenantId) || buildDefaultConnectionState(tenantId);
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password, workspaceName, timezone } = validateSignupPayload(req.body);
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });
    const slugBase = slugify(workspaceName);
    let slug = slugBase;
    let suffix = 1;
    while (await Tenant.findOne({ slug })) slug = `${slugBase}-${suffix++}`;
    const user = await User.create({ username, email, passwordHash: derivePasswordHash(password) });
    const tenant = await Tenant.create({ name: workspaceName, slug, timezone, billingEmail: email, credits: CREDIT_SIGNUP_BONUS });
    const membership = await TenantMembership.create({ tenantId: tenant._id, userId: user._id, role: 'owner', status: 'active' });
    await CreditLedger.create({ tenantId: String(tenant._id), userId: String(user._id), type: 'signup_bonus', delta: CREDIT_SIGNUP_BONUS, balanceAfter: tenant.credits, metadata: { source: 'signup' } });
    const session = await issueSession(user, tenant, membership);
    res.status(201).json(session);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email });
  if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password.' });
  const membership = await TenantMembership.findOne({ userId: user._id, status: 'active' }).sort({ createdAt: 1 });
  if (!membership) return res.status(403).json({ error: 'No active workspace membership found.' });
  const tenant = await Tenant.findById(membership.tenantId);
  if (!tenant) return res.status(403).json({ error: 'Workspace not found.' });
  const session = await issueSession(user, tenant, membership);
  res.json(session);
});

app.post('/api/auth/logout', authenticateRequest, async (req, res) => {
  await AppSession.deleteOne({ tokenHash: sha256(req.sessionToken) });
  res.json({ success: true });
});

app.get('/api/auth/me', authenticateRequest, async (req, res) => {
  res.json({ user: sanitizeUser(req.user, req.membership, req.tenant) });
});

app.patch('/api/users/theme', authenticateRequest, async (req, res) => {
  req.user.theme = req.body.theme === 'dark' ? 'dark' : 'light';
  await req.user.save();
  res.json({ user: sanitizeUser(req.user, req.membership, req.tenant) });
});

app.get('/api/auth/providers/:provider', (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  if (!['google', 'github', 'microsoft'].includes(provider)) return res.status(404).json({ error: 'Unsupported provider.' });
  res.json(buildSocialProviderResponse(provider));
});

app.get('/api/auth/oauth/:provider/start', (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const mode = String(req.query.mode || 'login').toLowerCase() === 'signup' ? 'signup' : 'login';
  if (!['google', 'github'].includes(provider)) {
    return res.redirect(buildOAuthErrorRedirect(provider, `${provider} OAuth is not available in this build.`));
  }
  const config = getOAuthProviderConfig(provider);
  if (!config?.available) {
    return res.redirect(buildOAuthErrorRedirect(provider, `Missing ${provider} OAuth configuration.`));
  }
  const state = createOAuthState(provider, mode);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state,
  });
  if (provider === 'google') params.set('access_type', 'offline');
  res.redirect(`${config.authorizationUrl}?${params.toString()}`);
});

async function handleOAuthCallback(req, res) {
  const requestedProvider = String(req.params.provider || '').toLowerCase();
  if (requestedProvider && !['google', 'github'].includes(requestedProvider)) {
    return res.redirect(buildOAuthErrorRedirect(requestedProvider, `${requestedProvider} OAuth is not supported.`));
  }

  const error = String(req.query.error || '').trim();
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const statePayload = consumeOAuthState(state, requestedProvider || null);
  const provider = requestedProvider || statePayload?.provider || 'google';
  const config = getOAuthProviderConfig(provider);

  if (error) {
    return res.redirect(buildOAuthErrorRedirect(provider, `${provider} authorization failed: ${error}`));
  }
  if (!config?.available || !code || !statePayload) {
    return res.redirect(buildOAuthErrorRedirect(provider, 'The OAuth callback was invalid or has expired. Please try again.'));
  }

  try {
    const profile = provider === 'google'
      ? await exchangeGoogleCodeForProfile(code, config)
      : await exchangeGitHubCodeForProfile(code, config);
    const { user, tenant, membership, created } = await findOrCreateSocialUser(provider, profile, statePayload.mode);
    const session = await issueSession(user, tenant, membership);
    const mode = created ? 'signup' : statePayload.mode;
    return res.redirect(buildOAuthSuccessRedirect(session, provider, mode));
  } catch (oauthError) {
    logger.warn({ provider, error: oauthError.message }, 'OAuth callback failed');
    return res.redirect(buildOAuthErrorRedirect(provider, oauthError.message || 'Unable to complete social login.'));
  }
}

app.get('/api/auth/oauth/callback', handleOAuthCallback);
app.get('/api/auth/oauth/:provider/callback', handleOAuthCallback);
app.get('/auth/:provider/callback', handleOAuthCallback);

app.post('/api/whatsapp/connect', authenticateRequest, requirePermission('whatsapp:connect'), async (req, res) => {
  try {
    ensureCredits(req.tenant, CREDIT_COSTS.whatsappConnect, 'connect WhatsApp');
    const state = await startWhatsAppSession(req.user, req.tenant);
    await appendCreditLedger({ tenant: req.tenant, user: req.user, amount: CREDIT_COSTS.whatsappConnect, type: 'whatsapp_connect', metadata: { tenantId: String(req.tenant._id) } });
    res.json({ ...state, user: sanitizeUser(req.user, req.membership, req.tenant) });
  } catch (error) {
    await persistConnectionState(String(req.tenant._id), { status: 'error', qr: '', message: error.message || 'Unable to start WhatsApp connection.', userId: String(req.user._id) });
    res.status(500).json({ error: error.message || 'Unable to start WhatsApp connection.' });
  }
});

app.get('/api/whatsapp/status', authenticateRequest, async (req, res) => {
  const tenantId = String(req.tenant._id);
  const state = connectionStateStore.get(tenantId) || await WhatsAppConnection.findOne({ tenantId }).lean() || buildDefaultConnectionState(tenantId);
  res.json(state);
});

app.get('/api/whatsapp/audience', authenticateRequest, async (req, res) => {
  const tenantId = String(req.tenant._id);
  const sock = socketStore.get(tenantId);
  const connectionState = connectionStateStore.get(tenantId) || await WhatsAppConnection.findOne({ tenantId }).lean() || buildDefaultConnectionState(tenantId);
  if (sock && connectionState.status === 'connected') await syncAudienceFromSocket(tenantId, sock).catch(() => null);
  const audience = await getAudienceState(tenantId);
  res.json({ status: connectionState.status, groups: audience.groups, contacts: audience.contacts, lastSyncedAt: audience.lastSyncedAt });
});

app.post('/api/tasks', authenticateRequest, requirePermission('tasks:write'), async (req, res) => {
  const title = String(req.body.title || '').trim();
  const type = String(req.body.type || '').trim();
  const description = String(req.body.description || '').trim();
  if (!title || !type || !description) return res.status(400).json({ error: 'Title, type, and description are required.' });
  ensureCredits(req.tenant, CREDIT_COSTS.createTask, 'create a task');
  const recipients = req.body.recipients || {};
  const groupDeliveryMode = recipients.groupDeliveryMode === 'members' ? 'members' : 'group';
  const normalizedRecipients = sanitizeTaskRecipients(recipients);
  if (!normalizedRecipients.groups.length && !normalizedRecipients.contacts.length) return res.status(400).json({ error: 'At least one valid contact or group recipient is required.' });
  const timezone = validateTimezone(String(req.body.timezone || req.tenant.timezone || DEFAULT_TIMEZONE));
  const schedule = validateSchedule(req.body.schedule || {}, timezone);
  const task = await Task.create({
    tenantId: String(req.tenant._id),
    createdByUserId: String(req.user._id),
    title,
    type,
    description,
    messageHtml: String(req.body.messageHtml || ''),
    messageText: String(req.body.messageText || ''),
    translatedPreview: String(req.body.translatedPreview || ''),
    mediaQueue: Array.isArray(req.body.mediaQueue) ? req.body.mediaQueue.slice(0, 10) : [],
    recipients: { groups: normalizedRecipients.groups, contacts: normalizedRecipients.contacts, groupDeliveryMode },
    schedule,
    timezone,
    status: 'active',
    nextRunAt: computeNextRunAt(schedule, timezone),
  });
  await appendCreditLedger({ tenant: req.tenant, user: req.user, amount: CREDIT_COSTS.createTask, type: 'task_create', metadata: { taskId: String(task._id) } });
  res.status(201).json({ task, user: sanitizeUser(req.user, req.membership, req.tenant) });
});

app.post('/api/ai/text', authenticateRequest, requirePermission('tasks:write'), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });
    ensureCredits(req.tenant, CREDIT_COSTS.generateText, 'generate AI text');
    const text = await callHuggingFaceText(prompt);
    await appendCreditLedger({ tenant: req.tenant, user: req.user, amount: CREDIT_COSTS.generateText, type: 'ai_text', metadata: { promptLength: prompt.length } });
    res.json({ text, model: 'hugging-face-space', user: sanitizeUser(req.user, req.membership, req.tenant) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to generate AI text.' });
  }
});

app.post('/api/ai/image', authenticateRequest, requirePermission('tasks:write'), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });
    ensureCredits(req.tenant, CREDIT_COSTS.generateImage, 'generate AI image');
    let imageUrl;
    try {
      imageUrl = await callHuggingFaceImage(prompt);
    } catch (providerError) {
      logger.warn({ error: providerError.message }, 'Hugging Face image generation failed, returning fallback image');
      await appendCreditLedger({ tenant: req.tenant, user: req.user, amount: CREDIT_COSTS.generateImage, type: 'ai_image_fallback', metadata: { promptLength: prompt.length } });
      return res.json({ imageUrl: fallbackImage(prompt), model: 'fallback-placeholder', user: sanitizeUser(req.user, req.membership, req.tenant) });
    }
    await appendCreditLedger({ tenant: req.tenant, user: req.user, amount: CREDIT_COSTS.generateImage, type: 'ai_image', metadata: { promptLength: prompt.length } });
    res.json({ imageUrl, user: sanitizeUser(req.user, req.membership, req.tenant) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Unable to generate AI image.' });
  }
});

app.get('/api/tasks', authenticateRequest, requirePermission('tasks:read'), async (req, res) => {
  const tasks = await Task.find({ tenantId: String(req.tenant._id) }).sort({ createdAt: -1 }).lean();
  res.json({ tasks });
});

app.patch('/api/tasks/:taskId/status', authenticateRequest, requirePermission('tasks:write'), async (req, res) => {
  const status = String(req.body.status || '').trim().toLowerCase();
  if (!['active', 'paused', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid task status.' });
  const task = await Task.findOneAndUpdate({ _id: req.params.taskId, tenantId: String(req.tenant._id) }, { status }, { new: true });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  res.json({ task });
});

app.delete('/api/tasks/:taskId', authenticateRequest, requirePermission('tasks:write'), async (req, res) => {
  const task = await Task.findOneAndDelete({ _id: req.params.taskId, tenantId: String(req.tenant._id) });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  res.json({ success: true });
});

app.post('/api/tasks/bulk-action', authenticateRequest, requirePermission('tasks:write'), async (req, res) => {
  const action = String(req.body.action || '').trim().toLowerCase();
  const taskIds = Array.isArray(req.body.taskIds) ? req.body.taskIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (!taskIds.length) return res.status(400).json({ error: 'Select at least one task.' });
  if (action === 'pause') {
    await Task.updateMany({ _id: { $in: taskIds }, tenantId: String(req.tenant._id) }, { status: 'paused' });
    return res.json({ success: true, action });
  }
  if (action === 'delete') {
    await Task.deleteMany({ _id: { $in: taskIds }, tenantId: String(req.tenant._id) });
    return res.json({ success: true, action });
  }
  return res.status(400).json({ error: 'Unsupported bulk action.' });
});

app.get('/api/tenants/me', authenticateRequest, async (req, res) => {
  const ledger = await CreditLedger.find({ tenantId: String(req.tenant._id) }).sort({ createdAt: -1 }).limit(25).lean();
  res.json({ tenant: req.tenant, membership: req.membership, ledger });
});

app.post('/api/enquiries', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const message = String(req.body.message || '').trim();
  if (!name || !email || !message) return res.status(400).json({ error: 'Name, email, and message are required.' });
  await Enquiry.create({ name, email, message, recipient: 'admin@codesignite.com' });
  const mailtoUrl = `mailto:admin@codesignite.com?subject=${encodeURIComponent(`CodeBot enquiry from ${name}`)}&body=${encodeURIComponent(`Name: ${name}\nEmail: ${email}\n\n${message}`)}`;
  res.status(201).json({ success: true, message: 'Enquiry saved and ready to send to admin@codesignite.com.', mailtoUrl });
});

app.get('/api/config/required-credentials', (req, res) => {
  res.json({
    database: ['CLOUD_MONGO_URI or USE_LOCAL=true'],
    security: ['RATE_LIMIT_PER_MINUTE (optional)', 'DEFAULT_TENANT_TIMEZONE (optional)'],
    socialLogin: {
      google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
      github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL'],
      microsoft: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_CALLBACK_URL'],
    },
    optional: ['PORT', 'DEFAULT_SIGNUP_CREDITS', 'HUGGINGFACE_TEXT_SPACE_ID', 'HUGGINGFACE_IMAGE_SPACE_ID', 'HUGGINGFACE_TEXT_SYSTEM_PROMPT'],
  });
});

app.use((req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

connectDatabase()
  .then(() => {
    startTaskScheduler();
    app.listen(PORT, () => logger.info({ port: PORT }, 'App running'));
  })
  .catch((error) => {
    logger.error({ error: error.message }, 'Startup failure');
    process.exit(1);
  });
