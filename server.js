import crypto from 'crypto';
import path from 'path';
import tls from 'tls';
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
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'wa_session';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.zoho.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const SMTP_USER = process.env.SMTP_USER || 'codebot@zohomail.com';
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || 'CodeBot';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY || '';
const PAYSTACK_CURRENCY = process.env.PAYSTACK_CURRENCY || 'NGN';
const PAYSTACK_CREDIT_RATE = Number(process.env.PAYSTACK_CREDIT_RATE || 1);
const SESSION_COOKIE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
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
const AUTO_REPLY_MIN_DELAY_MS = Number(process.env.AUTO_REPLY_MIN_DELAY_MS || 2000);
const AUTO_REPLY_MAX_DELAY_MS = Number(process.env.AUTO_REPLY_MAX_DELAY_MS || 10000);
const AUTO_REPLY_LIMIT_PER_MINUTE = Number(process.env.AUTO_REPLY_LIMIT_PER_MINUTE || 8);
const HUGGINGFACE_IMAGE_SEED = Number(process.env.HUGGINGFACE_IMAGE_SEED || 0);
const HUGGINGFACE_IMAGE_RANDOMIZE_SEED = process.env.HUGGINGFACE_IMAGE_RANDOMIZE_SEED !== 'false';
const HUGGINGFACE_IMAGE_WIDTH = Number(process.env.HUGGINGFACE_IMAGE_WIDTH || 384);
const HUGGINGFACE_IMAGE_HEIGHT = Number(process.env.HUGGINGFACE_IMAGE_HEIGHT || 384);
const HUGGINGFACE_IMAGE_GUIDANCE_SCALE = Number(process.env.HUGGINGFACE_IMAGE_GUIDANCE_SCALE || 0);
const HUGGINGFACE_IMAGE_STEPS = Number(process.env.HUGGINGFACE_IMAGE_STEPS || 2);
const CREDIT_COSTS = {
  whatsappConnect: Number(process.env.CREDIT_COST_WHATSAPP_CONNECT || 0),
  createTask: Number(process.env.CREDIT_COST_CREATE_TASK || 0),
  sendMessage: Number(process.env.CREDIT_COST_SEND_MESSAGE || process.env.CREDIT_COST_CREATE_TASK || 10),
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
const autoReplyRateStore = new Map();
const conversationStore = new Map();
const unsubscribeStore = new Set();
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;
const TASK_CLAIM_WINDOW_MS = 2 * 60 * 1000;
const OAUTH_STATE_SECRET = process.env.OAUTH_STATE_SECRET || process.env.APP_SECRET || process.env.SESSION_SECRET || 'dev-oauth-state-secret';

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


function parseCookies(header = '') {
  return String(header || '').split(';').reduce((cookies, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) return cookies;
    cookies[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue.join('='));
    return cookies;
  }, {});
}

function encodeSmtpLine(value = '') {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function quotePrintableHeader(value = '') {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      clearTimeout(timeout);
    };
    const onError = (error) => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('SMTP connection closed unexpectedly.')); };
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return;
      const lastLine = lines[lines.length - 1];
      if (/^\d{3} /.test(lastLine)) { cleanup(); resolve(lines); }
    };
    const timeout = setTimeout(() => { cleanup(); reject(new Error('SMTP server timed out.')); }, 15000);
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function sendSmtpCommand(socket, command, expectedCodes = [250]) {
  if (command) socket.write(`${command}\r\n`);
  const lines = await readSmtpResponse(socket);
  const statusCode = Number(String(lines[lines.length - 1] || '').slice(0, 3));
  if (!expectedCodes.includes(statusCode)) {
    throw new Error(lines.join(' | ') || `Unexpected SMTP response ${statusCode}`);
  }
  return lines;
}

async function sendEnquiryEmail({ name, email, message }) {
  if (!SMTP_PASSWORD) throw new Error('SMTP_PASSWORD is required to send enquiry emails.');
  const socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST, minVersion: 'TLSv1.2' });
  await new Promise((resolve, reject) => {
    socket.once('secureConnect', resolve);
    socket.once('error', reject);
  });
  try {
    await sendSmtpCommand(socket, '', [220]);
    await sendSmtpCommand(socket, `EHLO ${SMTP_HOST}`, [250]);
    await sendSmtpCommand(socket, 'AUTH LOGIN', [334]);
    await sendSmtpCommand(socket, encodeSmtpLine(SMTP_USER), [334]);
    await sendSmtpCommand(socket, encodeSmtpLine(SMTP_PASSWORD), [235]);
    await sendSmtpCommand(socket, `MAIL FROM:<${SMTP_USER}>`, [250]);
    await sendSmtpCommand(socket, `RCPT TO:<${SMTP_USER}>`, [250, 251]);
    await sendSmtpCommand(socket, 'DATA', [354]);
    const safeName = quotePrintableHeader(name);
    const safeEmail = quotePrintableHeader(email);
    const safeMessage = String(message || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
    const composed = [
      `From: ${SMTP_FROM_NAME} <${SMTP_USER}>`,
      `To: ${SMTP_USER}`,
      `Reply-To: ${safeEmail}`,
      `Subject: CodeBot enquiry from ${safeName}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      `Name: ${safeName}`,
      `Email: ${safeEmail}`,
      '',
      safeMessage,
      '.',
    ].join('\r\n');
    await sendSmtpCommand(socket, composed, [250]);
    await sendSmtpCommand(socket, 'QUIT', [221]);
  } finally {
    socket.end();
  }
}

function normalizePaymentAmount(amount) {
  const normalized = Number(amount || 0);
  if (!Number.isFinite(normalized) || normalized <= 0) throw new Error('Enter a valid payment amount.');
  return Math.round(normalized * 100) / 100;
}

function convertAmountToCredits(amount) {
  return Math.max(1, Math.round(Number(amount || 0) * PAYSTACK_CREDIT_RATE));
}

async function creditAccountBalance({ tenant = null, user, amount = 0, type, metadata = {} }) {
  const normalizedAmount = Number(amount || 0);
  if (!normalizedAmount) return tenant || user;
  if (tenant) {
    tenant.credits = Number(tenant.credits || 0) + normalizedAmount;
    await tenant.save();
    await CreditLedger.create({
      tenantId: String(tenant._id),
      userId: String(user._id),
      type,
      delta: normalizedAmount,
      balanceAfter: tenant.credits,
      metadata,
    });
    return tenant;
  }
  user.credits = Number(user.credits || 0) + normalizedAmount;
  await user.save();
  return user;
}

async function initializePaystackTransaction({ email, amount, reference, metadata = {} }) {
  if (!PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is required to initialize payments.');
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      amount: Math.round(Number(amount) * 100),
      reference,
      currency: PAYSTACK_CURRENCY,
      metadata,
      channels: ['card', 'bank', 'ussd', 'bank_transfer', 'mobile_money'],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === false) throw new Error(payload.message || 'Unable to initialize Paystack payment.');
  return payload.data;
}

async function verifyPaystackTransaction(reference) {
  if (!PAYSTACK_SECRET_KEY) throw new Error('PAYSTACK_SECRET_KEY is required to verify payments.');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === false) throw new Error(payload.message || 'Unable to verify Paystack payment.');
  return payload.data;
}

function buildSessionCookie(token) {
  const secure = process.env.NODE_ENV === 'production';
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_COOKIE_MAX_AGE_MS / 1000)}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production';
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
}

function createOAuthState(provider, mode) {
  const payload = {
    provider,
    mode,
    createdAt: Date.now(),
    nonce: crypto.randomBytes(12).toString('hex'),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function consumeOAuthState(state, provider = null) {
  const [encodedPayload, signature] = String(state || '').split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', OAUTH_STATE_SECRET).update(encodedPayload).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!payload?.provider || !payload?.mode || !payload?.createdAt) return null;
  if (provider && payload.provider !== provider) return null;
  if (Date.now() - Number(payload.createdAt) > OAUTH_STATE_MAX_AGE_MS) return null;
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
  const personalPermissions = ['tasks:write', 'tasks:read'];
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
    permissions: membership ? getPermissionsForRole(membership.role) : personalPermissions,
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
  },
}, { timestamps: true });

const appSessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', default: null },
  provider: { type: String, default: 'password' },
  lastSeenAt: { type: Date, default: Date.now },
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
  mode: { type: String, enum: ['broadcast', 'automated_response', 'schedule_status'], default: 'broadcast' },
  description: { type: String, required: true, trim: true },
  messageHtml: { type: String, default: '' },
  messageText: { type: String, default: '' },
  translatedPreview: { type: String, default: '' },
  mediaQueue: { type: Array, default: [] },
  recipients: { type: Object, default: { groups: [], contacts: [] } },
  automation: { type: Object, default: { audience: ['all_incoming'] } },
  schedule: { type: Object, default: {} },
  timezone: { type: String, default: DEFAULT_TIMEZONE },
  status: { type: String, enum: ['draft', 'active', 'paused', 'completed'], default: 'active' },
  nextRunAt: { type: Date, default: null, index: true },
  lastRunAt: { type: Date, default: null },
  lastRunKey: { type: String, default: '' },
  claimToken: { type: String, default: '' },
  claimExpiresAt: { type: Date, default: null, index: true },
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

const companyProfileSchema = new mongoose.Schema({
  scopeId: { type: String, required: true, unique: true, index: true },
  ownerType: { type: String, enum: ['workspace', 'user'], default: 'user' },
  tenantId: { type: String, default: '' },
  userId: { type: String, required: true, index: true },
  businessName: { type: String, default: '' },
  businessNameText: { type: String, default: '' },
  faqs: { type: [{ question: String, answer: String }], default: [] },
  products: { type: [{ name: String, description: String, price: String }], default: [] },
  toneStyle: { type: String, default: '' },
  safetyControls: {
    replyDelayRangeMs: { type: [Number], default: [AUTO_REPLY_MIN_DELAY_MS, AUTO_REPLY_MAX_DELAY_MS] },
    repliesPerMinute: { type: Number, default: AUTO_REPLY_LIMIT_PER_MINUTE },
    allowStop: { type: Boolean, default: true },
    ignoreSpam: { type: Boolean, default: true },
    avoidReplyingToEveryMessage: { type: Boolean, default: true },
  },
}, { timestamps: true });

const conversationHistorySchema = new mongoose.Schema({
  scopeId: { type: String, required: true, index: true },
  tenantId: { type: String, default: '' },
  userId: { type: String, required: true, index: true },
  remoteJid: { type: String, required: true, index: true },
  messages: { type: [{ role: String, text: String, createdAt: { type: Date, default: Date.now } }], default: [] },
  unsubscribed: { type: Boolean, default: false },
  lastIncomingAt: { type: Date, default: null },
  lastReplyAt: { type: Date, default: null },
}, { timestamps: true });
conversationHistorySchema.index({ scopeId: 1, remoteJid: 1 }, { unique: true });

const enquirySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  message: { type: String, required: true, trim: true },
  recipient: { type: String, default: 'admin@codesignite.com' },
}, { timestamps: true });

const paymentTransactionSchema = new mongoose.Schema({
  reference: { type: String, required: true, unique: true },
  userId: { type: String, required: true, index: true },
  tenantId: { type: String, default: '' },
  email: { type: String, required: true, trim: true, lowercase: true },
  amount: { type: Number, required: true },
  credits: { type: Number, required: true },
  currency: { type: String, default: PAYSTACK_CURRENCY },
  status: { type: String, enum: ['initialized', 'success', 'failed'], default: 'initialized' },
  channel: { type: String, default: 'paystack' },
  metadata: { type: Object, default: {} },
  verifiedAt: { type: Date, default: null },
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
const PaymentTransaction = mongoose.model('PaymentTransaction', paymentTransactionSchema);
const CompanyProfile = mongoose.model('CompanyProfile', companyProfileSchema);
const ConversationHistory = mongoose.model('ConversationHistory', conversationHistorySchema);

async function connectDatabase() {
  if (!MONGO_URI) throw new Error('Missing MongoDB connection string. Set CLOUD_MONGO_URI or USE_LOCAL=true.');
  await mongoose.connect(MONGO_URI);
  try {
    const indexes = await WhatsAppConnection.collection.indexes();
    if (indexes.some((index) => index.name === 'userId_1' && index.unique)) await WhatsAppConnection.collection.dropIndex('userId_1');
  } catch (error) {
    logger.warn({ error: error.message }, 'Unable to reconcile WhatsApp connection indexes');
  }
  try {
    const indexes = await AuthState.collection.indexes();
    if (indexes.some((index) => index.name === 'userId_1_key_1' && index.unique)) await AuthState.collection.dropIndex('userId_1_key_1');
  } catch (error) {
    logger.warn({ error: error.message }, 'Unable to reconcile auth state indexes');
  }
  logger.info({ mode: IS_LOCAL ? 'local' : 'cloud' }, 'MongoDB connected');
}

async function persistConnectionState(tenantId, updates) {
  const next = setConnectionState(tenantId, updates);
  await WhatsAppConnection.findOneAndUpdate({ tenantId }, { tenantId, ...next }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
  return next;
}

async function useMongooseAuthState(tenantId) {
  const writeData = async (data, key) => {
    const json = JSON.stringify(data, BufferJSON.replacer);
    await AuthState.findOneAndUpdate({ tenantId, key }, { tenantId, key, data: json }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true });
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
  const cookies = parseCookies(req.headers.cookie || '');
  const bearerToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const token = bearerToken || cookies[SESSION_COOKIE_NAME] || '';
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  const session = await AppSession.findOne({ tokenHash: sha256(token) });
  if (!session) return res.status(401).json({ error: 'Session expired. Please log in again.' });
  const user = await User.findById(session.userId);
  if (!user) return res.status(401).json({ error: 'Account no longer exists.' });

  let tenant = null;
  let membership = null;
  if (session.tenantId) {
    [tenant, membership] = await Promise.all([
      Tenant.findById(session.tenantId),
      TenantMembership.findOne({ tenantId: session.tenantId, userId: session.userId, status: 'active' }),
    ]);
    if (!tenant || !membership) {
      tenant = null;
      membership = null;
      session.tenantId = null;
    }
  }

  if (!tenant || !membership) {
    ({ tenant, membership } = await resolveActiveWorkspaceContext(user));
    if (tenant && membership) session.tenantId = tenant._id;
  }

  session.lastSeenAt = new Date();
  await session.save();
  req.user = user;
  req.tenant = tenant;
  req.membership = membership;
  req.sessionToken = token;
  next();
}


function getScopeContext(req) {
  if (req.tenant && req.membership) {
    return {
      scopeId: String(req.tenant._id),
      tenant: req.tenant,
      membership: req.membership,
      timezone: validateTimezone(String(req.tenant.timezone || DEFAULT_TIMEZONE)),
      hasWorkspace: true,
    };
  }
  return {
    scopeId: `user:${String(req.user._id)}`,
    tenant: null,
    membership: null,
    timezone: DEFAULT_TIMEZONE,
    hasWorkspace: false,
  };
}

function getAutoReplyScope(tenantId, userId) {
  return tenantId ? { scopeId: tenantId, ownerType: 'workspace', tenantId, userId } : { scopeId: `user:${userId}`, ownerType: 'user', tenantId: '', userId };
}

function getUserFromSession(remoteJid = '') {
  const jid = String(remoteJid || '');
  const [tenantId] = jid.split(':');
  return tenantId || '';
}

function getMessageText(msg = {}) {
  return String(msg?.message?.conversation || msg?.message?.extendedTextMessage?.text || msg?.message?.imageMessage?.caption || msg?.message?.videoMessage?.caption || '').trim();
}

function rememberConversation(remoteJid, role, text) {
  if (!text) return [];
  const current = conversationStore.get(remoteJid) || [];
  const next = [...current, { role, text, createdAt: new Date().toISOString() }].slice(-8);
  conversationStore.set(remoteJid, next);
  return next;
}

function ruleBasedReply(userData, message) {
  const msg = String(message || '').toLowerCase();
  if (msg.includes('price')) {
    return (userData.products || []).map((p) => `${p.name}: ${p.price}`).join('\n');
  }
  if (msg.includes('hello') || msg.includes('hi')) {
    return `Hello 👋 welcome to ${userData.businessNameText || userData.businessName || 'our business'}`;
  }
  const faq = (userData.faqs || []).find((item) => msg.includes(String(item.question || '').toLowerCase()));
  if (faq?.answer) return faq.answer;
  return null;
}

function isSpamMessage(text = '') {
  const normalized = String(text || '').trim();
  if (!normalized) return true;
  if (normalized.length > 1000) return true;
  if (/https?:\/\//i.test(normalized) && normalized.split(/https?:\/\//i).length > 3) return true;
  if (/([a-zA-Z0-9])\1{7,}/.test(normalized)) return true;
  return false;
}

function pickReplyDelay() {
  const min = Math.max(0, AUTO_REPLY_MIN_DELAY_MS);
  const max = Math.max(min, AUTO_REPLY_MAX_DELAY_MS);
  return Math.floor(min + Math.random() * (max - min + 1));
}

function canSendAutoReply(scopeId) {
  const bucket = autoReplyRateStore.get(scopeId) || { minute: 0, count: 0 };
  const minute = Math.floor(Date.now() / 60000);
  if (bucket.minute !== minute) {
    autoReplyRateStore.set(scopeId, { minute, count: 1 });
    return true;
  }
  if (bucket.count >= AUTO_REPLY_LIMIT_PER_MINUTE) return false;
  bucket.count += 1;
  autoReplyRateStore.set(scopeId, bucket);
  return true;
}

async function getCompanyProfileForScope(scopeId) {
  const profile = await CompanyProfile.findOne({ scopeId }).lean();
  return profile || null;
}

async function upsertConversationHistory(scope, remoteJid, incomingText, replyText = '') {
  const existing = await ConversationHistory.findOne({ scopeId: scope.scopeId, remoteJid });
  const messages = [...(existing?.messages || []), ...(incomingText ? [{ role: 'user', text: incomingText, createdAt: new Date() }] : []), ...(replyText ? [{ role: 'assistant', text: replyText, createdAt: new Date() }] : [])].slice(-12);
  return ConversationHistory.findOneAndUpdate(
    { scopeId: scope.scopeId, remoteJid },
    {
      scopeId: scope.scopeId, tenantId: scope.tenantId || '', userId: scope.userId, remoteJid, messages,
      lastIncomingAt: incomingText ? new Date() : existing?.lastIncomingAt || null,
      lastReplyAt: replyText ? new Date() : existing?.lastReplyAt || null,
      unsubscribed: existing?.unsubscribed || false,
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
}

async function craftAutoReply(profile, message, history = []) {
  const fallback = ruleBasedReply(profile || {}, message);
  const prompt = [
    'You are generating a concise WhatsApp auto-reply for a business.',
    `Business info: ${profile?.businessNameText || profile?.businessName || 'Unknown business'}`,
    `Tone/style: ${profile?.toneStyle || 'Friendly and professional'}`,
    `FAQs: ${JSON.stringify(profile?.faqs || [])}`,
    `Products: ${JSON.stringify(profile?.products || [])}`,
    `Last conversation: ${JSON.stringify(history.slice(-6))}`,
    `User message: ${message}`,
    'Respond in a safe, concise, helpful WhatsApp style. If you are unsure, say so briefly.',
  ].join('\n');
  try {
    const aiReply = await callHuggingFaceText(prompt);
    return aiReply || fallback || 'Thanks for your message. We will get back to you shortly.';
  } catch {
    return fallback || 'Thanks for your message. We will get back to you shortly.';
  }
}

function hasScopedPermission(req, permission) {
  if (req.membership) return hasPermission(req.membership.role, permission);
  return ['tasks:write', 'tasks:read'].includes(permission);
}

function requireScopedPermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!hasScopedPermission(req, permission)) return res.status(403).json({ error: `You do not have permission to ${permission}.` });
    next();
  };
}

async function ensureCreditsAvailable({ tenant = null, user = null, amount = 0, label = 'complete this action' }) {
  const normalizedAmount = Number(amount || 0);
  const balance = tenant ? Number(tenant.credits || 0) : Number(user?.credits || 0);
  if (balance < normalizedAmount) {
    const owner = tenant ? 'workspace' : 'account';
    throw new Error(`Insufficient credits to ${label}. Your ${owner} has ${balance} credits remaining.`);
  }
}

async function debitCredits({ tenant = null, user = null, amount = 0, type, metadata = {} }) {
  const normalizedAmount = Number(amount || 0);
  if (!normalizedAmount) return tenant || user;
  if (tenant) return appendCreditLedger({ tenant, user, amount: normalizedAmount, type, metadata });
  if (!user) return null;
  user.credits = Math.max(0, Number(user.credits || 0) - normalizedAmount);
  await user.save();
  return user;
}

async function listWorkspaceMembers(tenantId) {
  const memberships = await TenantMembership.find({ tenantId, status: 'active' }).sort({ createdAt: 1 }).lean();
  const users = await User.find({ _id: { $in: memberships.map((item) => item.userId) } }).lean();
  const userMap = new Map(users.map((user) => [String(user._id), user]));
  return memberships.map((membership) => ({
    id: String(membership._id),
    role: membership.role,
    status: membership.status,
    createdAt: membership.createdAt,
    user: (() => {
      const user = userMap.get(String(membership.userId));
      return user ? { id: String(user._id), username: user.username, email: user.email } : null;
    })(),
  })).filter((item) => item.user);
}

function requireActiveWorkspace(req, res, next) {
  if (!req.tenant || !req.membership) {
    return res.status(403).json({ error: 'Create or join a workspace to use this feature.' });
  }
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

function sanitizeTextInput(value = '') {
  return String(value || '').replace(/[<>]/g, '').replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function sanitizeLongText(value = '') {
  return String(value || '').replace(/[<>]/g, '').replace(/\r/g, '').trim();
}

function sanitizeRichText(value = '') {
  return String(value || '').replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').replace(/on\w+=/gi, '').trim();
}

function validateSignupPayload(payload) {
  const username = sanitizeTextInput(payload.username);
  const email = sanitizeTextInput(payload.email).toLowerCase();
  const password = String(payload.password || '');
  if (!username || username.length < 2) throw new Error('Username must be at least 2 characters long.');
  if (!email.includes('@')) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters long.');
  return { username, email, password };
}

function validateCompanyProfilePayload(payload = {}) {
  const businessName = sanitizeRichText(payload.businessName);
  const businessNameText = sanitizeLongText(payload.businessNameText);
  const faqs = Array.isArray(payload.faqs) ? payload.faqs.map((item) => ({ question: sanitizeTextInput(item?.question), answer: sanitizeLongText(item?.answer) })).filter((item) => item.question && item.answer) : [];
  const products = Array.isArray(payload.products) ? payload.products.map((item) => ({ name: sanitizeTextInput(item?.name), description: sanitizeLongText(item?.description), price: sanitizeTextInput(item?.price) })).filter((item) => item.name) : [];
  const toneStyle = sanitizeLongText(payload.toneStyle);
  if (!businessName && !businessNameText) throw new Error('Business name and overview are required.');
  return { businessName, businessNameText, faqs, products, toneStyle };
}

function validateWorkspacePayload(payload, fallbackName = 'New Workspace') {
  const workspaceName = sanitizeTextInput(payload.workspaceName || fallbackName);
  const timezone = validateTimezone(String(payload.timezone || DEFAULT_TIMEZONE).trim());
  if (!workspaceName || workspaceName.length < 2) throw new Error('Workspace name must be at least 2 characters long.');
  return { workspaceName, timezone };
}

async function issueSession(user, tenant = null, membership = null, provider = 'password') {
  const token = createToken();
  await AppSession.create({ tokenHash: sha256(token), userId: user._id, tenantId: tenant?._id || null, provider });
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
  if (frequency === 'now') return now;
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
  if (!['now', 'once', 'daily', 'weekly', 'monthly'].includes(normalized.frequency)) throw new Error('A valid schedule frequency is required.');
  if (normalized.frequency === 'now') {
    const parts = getDatePartsForTimezone(new Date(), normalized.timezone);
    normalized.startDate = parts.today;
    normalized.startTime = parts.currentTime;
    normalized.dailyTimes = [];
    normalized.weeklySlots = [];
    normalized.monthlyWeeks = [];
    normalized.monthlyDays = [];
    return normalized;
  }
  if (!normalized.startDate || !/^\d{4}-\d{2}-\d{2}$/.test(normalized.startDate)) throw new Error('A valid start date is required.');
  if (!normalized.startTime) throw new Error('A valid start time is required.');
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
  if (!frequency) return { due: false, reason: 'missing_schedule' };
  if (frequency === 'now') {
    const { currentTime } = getDatePartsForTimezone(now, timezone);
    const runKey = buildRunKey(now, frequency, currentTime, timezone);
    if (task.lastRunKey === runKey) return { due: false, reason: 'already_ran', runKey };
    return { due: true, runKey, frequency, currentTime, timezone };
  }
  if (!startDate || !startTime) return { due: false, reason: 'missing_schedule' };
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

async function getStatusAudienceJids(tenantId, sock = null) {
  const collectAudienceJids = (audience = {}) => Array.from(new Set(
    (Array.isArray(audience.contacts) ? audience.contacts : [])
      .map((contact) => normalizePhoneJid(contact?.id || contact?.phone || ''))
      .filter(Boolean),
  ));

  const existingAudience = await getAudienceState(tenantId);
  const existingJids = collectAudienceJids(existingAudience);
  if (existingJids.length || !sock) return existingJids;

  const refreshedAudience = await syncAudienceFromSocket(tenantId, sock).catch(() => existingAudience);
  return collectAudienceJids(refreshedAudience);
}

async function resolveTaskRecipients(task, sock) {
  if (task?.mode === 'schedule_status') return ['status@broadcast'];
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

function isGroupJid(jid = '') {
  return String(jid || '').endsWith('@g.us');
}

async function isKnownContactForTenant(tenantId, remoteJid) {
  const jid = normalizePhoneJid(remoteJid);
  if (!jid) return false;
  const record = await TenantAudienceContact.findOne({ tenantId, id: jid }).lean();
  return Boolean(record);
}

async function findMatchingAutomatedResponseTask(tenantId, remoteJid) {
  const tasks = await Task.find({ tenantId, mode: 'automated_response', status: 'active' }).sort({ createdAt: -1 }).lean();
  if (!tasks.length) return null;
  const groupMessage = isGroupJid(remoteJid);
  const knownContact = groupMessage ? false : await isKnownContactForTenant(tenantId, remoteJid);
  return tasks.find((task) => {
    const audienceList = Array.isArray(task.automation?.audience) && task.automation.audience.length
      ? task.automation.audience.map((item) => String(item || ''))
      : [String(task.automation?.audience || 'all_incoming')];
    if (audienceList.includes('all_incoming')) return true;
    if (audienceList.includes('unknown_numbers') && !groupMessage && !knownContact) return true;
    if (audienceList.includes('all_groups') && groupMessage) return true;
    if (audienceList.includes('managed_groups')) {
      const allowedGroups = Array.isArray(task.recipients?.groups) ? task.recipients.groups.map((group) => normalizeGroupJid(group?.id || '')) : [];
      if (groupMessage && allowedGroups.includes(normalizeGroupJid(remoteJid))) return true;
    }
    return false;
  }) || null;
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

async function chargeForMessageSend({ tenant = null, user = null, amount = CREDIT_COSTS.sendMessage, type = 'message_send', metadata = {} }) {
  const normalizedAmount = Number(amount || 0);
  if (!normalizedAmount) return;
  await ensureCreditsAvailable({ tenant, user, amount: normalizedAmount, label: 'send a WhatsApp message' });
  await debitCredits({ tenant, user, amount: normalizedAmount, type, metadata });
}

function logTaskFailure(task, reason, extra = {}) {
  const details = {
    taskId: String(task?._id || ''),
    title: String(task?.title || ''),
    mode: String(task?.mode || 'broadcast'),
    reason,
    ...extra,
  };
  logger.error(details, 'Task execution failed');
  console.error('[task-error]', JSON.stringify(details, null, 2));
}

async function dispatchTask(task, now = new Date()) {
  const timing = shouldRunTaskNow(task, now);
  if (!timing.due) {
    task.claimToken = '';
    task.claimExpiresAt = null;
    await task.save();
    return task;
  }
  const tenantId = String(task.tenantId || '');
  const sock = socketStore.get(tenantId);
  const billingTarget = tenantId.startsWith('user:') ? await User.findById(task.createdByUserId) : await Tenant.findById(tenantId);
  const billingContext = tenantId.startsWith('user:')
    ? { tenant: null, user: billingTarget }
    : { tenant: billingTarget, user: await User.findById(task.createdByUserId) };
  if (!sock) {
    task.lastError = 'WhatsApp is not connected for this workspace.';
    logTaskFailure(task, task.lastError, { tenantId });
    task.nextRunAt = computeNextRunAt(task.schedule, task.timezone, new Date(now.getTime() + 60000));
    task.claimToken = '';
    task.claimExpiresAt = null;
    await task.save();
    return task;
  }
  const messagePayload = await buildMessagePayload(task);
  if (!messagePayload) {
    task.lastError = 'No sendable message payload was available.';
    logTaskFailure(task, task.lastError, { tenantId });
    task.claimToken = '';
    task.claimExpiresAt = null;
    await task.save();
    return task;
  }
  const recipients = await resolveTaskRecipients(task, sock);
  if (!recipients.length) {
    task.lastError = 'No recipients were resolved.';
    logTaskFailure(task, task.lastError, { tenantId });
    task.claimToken = '';
    task.claimExpiresAt = null;
    await task.save();
    return task;
  }
  const projectedCharge = Number(CREDIT_COSTS.sendMessage || 0) * recipients.length;
  await ensureCreditsAvailable({ ...billingContext, amount: projectedCharge, label: `send ${recipients.length} WhatsApp message${recipients.length === 1 ? '' : 's'}` });
  let deliveredCount = 0;
  let failedCount = 0;
  for (const recipient of recipients) {
    try {
      if (task.mode === 'schedule_status') {
        const statusJidList = await getStatusAudienceJids(tenantId, sock);
        if (!statusJidList.length) throw new Error('No WhatsApp contacts are available yet for status delivery. Refresh your workspace audience and try again.');
        await sock.sendMessage('status@broadcast', messagePayload, { broadcast: true, statusJidList });
      } else {
        await sock.sendMessage(recipient, messagePayload);
      }
      await chargeForMessageSend({
        ...billingContext,
        type: task.mode === 'automated_response' ? 'auto_reply_send' : task.mode === 'schedule_status' ? 'status_send' : 'scheduled_message_send',
        metadata: { taskId: String(task._id), recipient, scopeId: tenantId },
      });
      deliveredCount += 1;
      await recordDispatch(tenantId, String(task._id), recipient, 'sent', '', messagePayload);
    } catch (error) {
      failedCount += 1;
      await recordDispatch(tenantId, String(task._id), recipient, 'failed', error.message, messagePayload);
      logger.error({ taskId: String(task._id), recipient, error: error.message, stack: error.stack }, 'Failed to send scheduled WhatsApp message');
      console.error(`[task-send-error] task=${String(task._id)} recipient=${recipient}`, error);
    }
  }
  task.lastRunAt = now;
  task.lastRunKey = timing.runKey;
  task.lastError = failedCount ? `Failed for ${failedCount} recipient(s).` : '';
  if (failedCount) logTaskFailure(task, task.lastError, { tenantId, attempted: recipients.length, delivered: deliveredCount, failed: failedCount });
  task.deliveryStats = { attempted: recipients.length, delivered: deliveredCount, failed: failedCount };
  task.nextRunAt = ['once', 'now'].includes(timing.frequency) ? null : computeNextRunAt(task.schedule, task.timezone, new Date(now.getTime() + 60000));
  if (['once', 'now'].includes(timing.frequency)) {
    task.status = 'completed';
    task.completedAt = now;
  }
  task.claimToken = '';
  task.claimExpiresAt = null;
  await task.save();
  return task;
}

async function processDueTasks() {
  const now = new Date();
  const claimToken = createToken();
  const claimExpiresAt = new Date(now.getTime() + TASK_CLAIM_WINDOW_MS);
  const activeTasks = await Task.find({
    status: 'active',
    nextRunAt: { $ne: null, $lte: new Date(now.getTime() + 60000) },
    $or: [
      { claimExpiresAt: null },
      { claimExpiresAt: { $lte: now } },
    ],
  }).sort({ nextRunAt: 1 }).lean();
  for (const candidate of activeTasks) {
    const task = await Task.findOneAndUpdate({
      _id: candidate._id,
      status: 'active',
      nextRunAt: candidate.nextRunAt,
      $or: [
        { claimExpiresAt: null },
        { claimExpiresAt: { $lte: now } },
      ],
    }, { claimToken, claimExpiresAt }, { returnDocument: 'after' });
    if (!task) continue;
    await dispatchTask(task, now);
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

async function createWorkspaceForUser(user, payload = {}) {
  const { workspaceName, timezone } = validateWorkspacePayload(payload, `${user.username}'s Workspace`);
  const existingMembership = await TenantMembership.findOne({ userId: user._id, status: 'active' }).sort({ createdAt: 1 });
  if (existingMembership) {
    const existingTenant = await Tenant.findById(existingMembership.tenantId);
    if (existingTenant) return { tenant: existingTenant, membership: existingMembership, created: false };
  }

  const slugBase = slugify(workspaceName);
  let slug = slugBase;
  let suffix = 1;
  while (await Tenant.findOne({ slug })) slug = `${slugBase}-${suffix++}`;

  const tenant = await Tenant.create({ name: workspaceName, slug, timezone, billingEmail: user.email, credits: CREDIT_SIGNUP_BONUS });
  const membership = await TenantMembership.create({ tenantId: tenant._id, userId: user._id, role: 'owner', status: 'active' });
  await CreditLedger.create({ tenantId: String(tenant._id), userId: String(user._id), type: 'workspace_created', delta: CREDIT_SIGNUP_BONUS, balanceAfter: tenant.credits, metadata: { source: 'workspace_creation' } });
  return { tenant, membership, created: true };
}

async function resolveActiveWorkspaceContext(user) {
  const membership = await TenantMembership.findOne({ userId: user._id, status: 'active' }).sort({ createdAt: 1 });
  if (!membership) return { membership: null, tenant: null };
  const tenant = await Tenant.findById(membership.tenantId);
  if (!tenant) return { membership: null, tenant: null };
  return { membership, tenant };
}

async function findOrCreateSocialUser(provider, profile, mode = 'login') {
  let user = await User.findOne({ email: profile.email });
  let tenant;
  let membership;
  let created = false;
  const providerPath = `socialProviders.${provider}`;

  if (!user) {
    if (mode === 'login') throw new Error(`No account found for ${profile.email}. Use sign up with ${provider[0].toUpperCase()}${provider.slice(1)} first.`);
    user = await User.create({
      username: profile.username,
      email: profile.email,
      passwordHash: derivePasswordHash(createToken()),
      socialProviders: { [provider]: true },
    });
    created = true;
  } else {
    if (!user.socialProviders?.[provider]) {
      user.set(providerPath, true);
      if (!user.username || user.username === user.email) user.username = profile.username;
      await user.save();
    }
    ({ membership, tenant } = await resolveActiveWorkspaceContext(user));
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
  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      const msg = messages[0];
      if (!msg?.message || msg.key?.fromMe) return;
      const text = getMessageText(msg);
      if (!text || isSpamMessage(text)) return;
      const stopRequested = /^(stop|unsubscribe|cancel)$/i.test(text.trim());
      const remoteJid = String(msg.key?.remoteJid || '');
      const derivedUserId = getUserFromSession(`${tenantId}:${remoteJid}`) || String(user._id);
      const scope = getAutoReplyScope(tenantId, derivedUserId);
      const existingConversation = await ConversationHistory.findOne({ scopeId: scope.scopeId, remoteJid });
      if (stopRequested) {
        unsubscribeStore.add(`${scope.scopeId}:${remoteJid}`);
        await ConversationHistory.findOneAndUpdate({ scopeId: scope.scopeId, remoteJid }, { unsubscribed: true }, { upsert: true, setDefaultsOnInsert: true });
        await sock.sendMessage(remoteJid, { text: 'You have been unsubscribed. Reply START anytime to resume updates.' });
        return;
      }
      if (/^start$/i.test(text.trim())) {
        unsubscribeStore.delete(`${scope.scopeId}:${remoteJid}`);
        await ConversationHistory.findOneAndUpdate({ scopeId: scope.scopeId, remoteJid }, { unsubscribed: false }, { upsert: true, setDefaultsOnInsert: true });
      }
      if (unsubscribeStore.has(`${scope.scopeId}:${remoteJid}`) || existingConversation?.unsubscribed) return;
      if (!canSendAutoReply(scope.scopeId)) return;
      if (existingConversation?.lastIncomingAt && Date.now() - new Date(existingConversation.lastIncomingAt).getTime() < 15000) return;
      const matchingAutomatedTask = await findMatchingAutomatedResponseTask(tenantId, remoteJid);
      const inMemoryHistory = rememberConversation(remoteJid, 'user', text);
      const dbHistory = existingConversation?.messages || [];
      let replyPayload = null;
      let replyText = '';
      if (matchingAutomatedTask) {
        replyPayload = await buildMessagePayload(matchingAutomatedTask);
        replyText = String(matchingAutomatedTask.messageText || matchingAutomatedTask.translatedPreview || matchingAutomatedTask.description || '').trim();
      } else {
        const profile = await getCompanyProfileForScope(scope.scopeId);
        if (!profile) return;
        const reply = await craftAutoReply(profile, text, [...dbHistory, ...inMemoryHistory]);
        replyPayload = { text: reply };
        replyText = reply;
      }
      if (!replyPayload) return;
      await new Promise((resolve) => setTimeout(resolve, pickReplyDelay()));
      await sock.sendMessage(remoteJid, replyPayload);
      await chargeForMessageSend({
        tenant,
        user,
        type: 'auto_reply_send',
        metadata: { tenantId, remoteJid, scopeId: scope.scopeId, automatedTaskId: matchingAutomatedTask ? String(matchingAutomatedTask._id) : '' },
      });
      rememberConversation(remoteJid, 'assistant', replyText);
      await upsertConversationHistory(scope, remoteJid, text, replyText);
    } catch (error) {
      logger.error({ tenantId, error: error.message, stack: error.stack }, 'Unable to process incoming WhatsApp message');
      console.error('[messages-upsert-error]', error);
    }
  });
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
      const restartRequired = statusCode === DisconnectReason.restartRequired;
      logger.error({ tenantId, statusCode, error: lastDisconnect?.error?.message, stack: lastDisconnect?.error?.stack }, 'WhatsApp connection closed');
      console.error('[whatsapp-connection-close]', { tenantId, statusCode, error: lastDisconnect?.error?.message });
      socketStore.delete(tenantId);
      if (loggedOut) {
        await AuthState.deleteMany({ tenantId });
        await User.findByIdAndUpdate(user._id, { whatsappStatus: 'not_connected', whatsappPhone: '' });
        await persistConnectionState(tenantId, { status: 'logged_out', qr: '', phoneNumber: '', message: 'WhatsApp session logged out. Start a new connection to generate another QR code.', userId: String(user._id) });
        return;
      }
      await User.findByIdAndUpdate(user._id, { whatsappStatus: 'connecting' });
      await persistConnectionState(tenantId, {
        status: 'connecting',
        qr: '',
        phoneNumber: user.whatsappPhone || '',
        message: restartRequired
          ? 'WhatsApp requested a socket restart. Reconnecting with the saved credentials.'
          : 'Connection dropped. Attempting to reconnect automatically.',
        userId: String(user._id),
      });
      setTimeout(() => {
        startWhatsAppSession(user, tenant).catch((error) => {
          logger.error({ tenantId, statusCode, error: error.message, stack: error.stack }, 'Unable to restart WhatsApp session');
        });
      }, restartRequired ? 0 : 1_000);
    }
  });
  return connectionStateStore.get(tenantId) || buildDefaultConnectionState(tenantId);
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = validateSignupPayload(req.body);
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: 'An account with that email already exists.' });
    const user = await User.create({ username, email, passwordHash: derivePasswordHash(password) });
    const session = await issueSession(user, null, null, 'password');
    res.setHeader('Set-Cookie', buildSessionCookie(session.token));
    res.status(201).json(session);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to create account.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = sanitizeTextInput(req.body.email).toLowerCase();
  const password = String(req.body.password || '');
  const user = await User.findOne({ email });
  if (!user || !verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password.' });
  const { membership, tenant } = await resolveActiveWorkspaceContext(user);
  const session = await issueSession(user, tenant, membership, 'password');
  res.setHeader('Set-Cookie', buildSessionCookie(session.token));
  res.json(session);
});

app.post('/api/auth/logout', authenticateRequest, async (req, res) => {
  await AppSession.deleteOne({ tokenHash: sha256(req.sessionToken) });
  res.setHeader('Set-Cookie', clearSessionCookie());
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
  if (!['google', 'github'].includes(provider)) return res.status(404).json({ error: 'Unsupported provider.' });
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
    const session = await issueSession(user, tenant, membership, provider);
    const mode = created ? 'signup' : statePayload.mode;
    res.setHeader('Set-Cookie', buildSessionCookie(session.token));
    return res.redirect(buildOAuthSuccessRedirect(session, provider, mode));
  } catch (oauthError) {
    logger.warn({ provider, error: oauthError.message }, 'OAuth callback failed');
    return res.redirect(buildOAuthErrorRedirect(provider, oauthError.message || 'Unable to complete social login.'));
  }
}

app.get('/api/auth/oauth/callback', handleOAuthCallback);
app.get('/api/auth/oauth/:provider/callback', handleOAuthCallback);
app.get('/auth/:provider/callback', handleOAuthCallback);

app.post('/api/workspaces', authenticateRequest, async (req, res) => {
  try {
    const { tenant, membership, created } = await createWorkspaceForUser(req.user, req.body || {});
    await AppSession.updateOne({ tokenHash: sha256(req.sessionToken) }, { tenantId: tenant._id, lastSeenAt: new Date() });
    res.status(created ? 201 : 200).json({
      workspace: tenant,
      membership,
      user: sanitizeUser(req.user, membership, tenant),
      created,
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to create workspace.' });
  }
});

app.post('/api/whatsapp/connect', authenticateRequest, requireActiveWorkspace, requirePermission('whatsapp:connect'), async (req, res) => {
  try {
    const state = await startWhatsAppSession(req.user, req.tenant);
    res.json({ ...state, user: sanitizeUser(req.user, req.membership, req.tenant) });
  } catch (error) {
    await persistConnectionState(String(req.tenant._id), { status: 'error', qr: '', message: error.message || 'Unable to start WhatsApp connection.', userId: String(req.user._id) });
    res.status(500).json({ error: error.message || 'Unable to start WhatsApp connection.' });
  }
});

app.get('/api/whatsapp/status', authenticateRequest, requireActiveWorkspace, async (req, res) => {
  const tenantId = String(req.tenant._id);
  const state = connectionStateStore.get(tenantId) || await WhatsAppConnection.findOne({ tenantId }).lean() || buildDefaultConnectionState(tenantId);
  res.json(state);
});

app.get('/api/whatsapp/audience', authenticateRequest, requireActiveWorkspace, async (req, res) => {
  const tenantId = String(req.tenant._id);
  const sock = socketStore.get(tenantId);
  const connectionState = connectionStateStore.get(tenantId) || await WhatsAppConnection.findOne({ tenantId }).lean() || buildDefaultConnectionState(tenantId);
  if (sock && connectionState.status === 'connected') await syncAudienceFromSocket(tenantId, sock).catch(() => null);
  const audience = await getAudienceState(tenantId);
  res.json({ status: connectionState.status, groups: audience.groups, contacts: audience.contacts, lastSyncedAt: audience.lastSyncedAt });
});

app.get('/api/company-profile', authenticateRequest, async (req, res) => {
  const scope = getScopeContext(req);
  const profile = await CompanyProfile.findOne({ scopeId: scope.scopeId }).lean();
  res.json({ profile: profile ? { ...profile, id: String(profile._id) } : null, user: sanitizeUser(req.user, req.membership, req.tenant) });
});

app.post('/api/company-profile', authenticateRequest, async (req, res) => {
  try {
    const scope = getScopeContext(req);
    const payload = validateCompanyProfilePayload(req.body || {});
    const profile = await CompanyProfile.findOneAndUpdate(
      { scopeId: scope.scopeId },
      {
        scopeId: scope.scopeId,
        ownerType: scope.hasWorkspace ? 'workspace' : 'user',
        tenantId: scope.tenant ? String(scope.tenant._id) : '',
        userId: String(req.user._id),
        businessName: payload.businessName,
        businessNameText: payload.businessNameText,
        faqs: payload.faqs,
        products: payload.products,
        toneStyle: payload.toneStyle,
        safetyControls: {
          replyDelayRangeMs: [AUTO_REPLY_MIN_DELAY_MS, AUTO_REPLY_MAX_DELAY_MS],
          repliesPerMinute: AUTO_REPLY_LIMIT_PER_MINUTE,
          allowStop: true,
          ignoreSpam: true,
          avoidReplyingToEveryMessage: true,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );
    res.status(201).json({ profile: { ...profile.toObject(), id: String(profile._id) }, user: sanitizeUser(req.user, req.membership, req.tenant) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to save company profile.' });
  }
});

app.post('/api/tasks', authenticateRequest, requireScopedPermission('tasks:write'), async (req, res) => {
  const title = sanitizeTextInput(req.body.title);
  const type = sanitizeTextInput(req.body.type);
  const mode = ['automated_response', 'schedule_status'].includes(String(req.body.mode || '')) ? String(req.body.mode) : 'broadcast';
  const description = sanitizeLongText(req.body.description) || 'Media-only task';
  const sanitizedMediaQueue = Array.isArray(req.body.mediaQueue) ? req.body.mediaQueue.slice(0, 10).map((item) => ({
    name: sanitizeTextInput(item?.name || 'attachment'),
    type: sanitizeTextInput(item?.type || 'document'),
    dataUrl: String(item?.dataUrl || ''),
    mimeType: sanitizeTextInput(item?.mimeType || 'application/octet-stream'),
    size: Number(item?.size || 0),
    sizeLabel: sanitizeTextInput(item?.sizeLabel || ''),
    previewText: sanitizeLongText(item?.previewText || ''),
    source: sanitizeTextInput(item?.source || ''),
  })).filter((item) => item.dataUrl.startsWith('data:')) : [];
  if (!title || !type || (!description && !sanitizedMediaQueue.length)) return res.status(400).json({ error: 'Title, type, and either description or media are required.' });
  const scope = getScopeContext(req);
  const recipients = req.body.recipients || {};
  const groupDeliveryMode = recipients.groupDeliveryMode === 'members' ? 'members' : 'group';
  const normalizedRecipients = sanitizeTaskRecipients(recipients);
  if (!['automated_response', 'schedule_status'].includes(mode) && !normalizedRecipients.groups.length && !normalizedRecipients.contacts.length) return res.status(400).json({ error: 'At least one valid contact or group recipient is required.' });
  const timezone = validateTimezone(String(req.body.timezone || scope.timezone || DEFAULT_TIMEZONE));
  const automationAudience = Array.isArray(req.body.automation?.audience)
    ? req.body.automation.audience.map((item) => String(item || '')).filter((item) => ['all_incoming', 'unknown_numbers', 'all_groups', 'managed_groups'].includes(item))
    : ['all_incoming', 'unknown_numbers', 'all_groups', 'managed_groups'].includes(String(req.body.automation?.audience || '')) ? [String(req.body.automation.audience)] : ['all_incoming'];
  if (!automationAudience.length) automationAudience.push('all_incoming');
  if (automationAudience.includes('all_incoming')) automationAudience.splice(0, automationAudience.length, 'all_incoming');
  if (mode === 'automated_response' && automationAudience.includes('managed_groups') && !normalizedRecipients.groups.length) return res.status(400).json({ error: 'Select at least one group when using the managed groups automated response option.' });
  const schedule = mode === 'automated_response' ? {} : validateSchedule(req.body.schedule || {}, timezone);
  const task = await Task.create({
    tenantId: scope.scopeId,
    createdByUserId: String(req.user._id),
    title,
    type,
    mode,
    description,
    messageHtml: sanitizeRichText(req.body.messageHtml || ''),
    messageText: sanitizeLongText(req.body.messageText || ''),
    translatedPreview: sanitizeLongText(req.body.translatedPreview || ''),
    mediaQueue: sanitizedMediaQueue,
    recipients: { groups: normalizedRecipients.groups, contacts: normalizedRecipients.contacts, groupDeliveryMode },
    automation: { audience: automationAudience },
    schedule,
    timezone,
    status: 'active',
    nextRunAt: mode === 'automated_response' ? null : computeNextRunAt(schedule, timezone),
  });
  const finalTask = schedule.frequency === 'now' ? await dispatchTask(task, new Date()) : task;
  res.status(201).json({ task: finalTask, user: sanitizeUser(req.user, req.membership, req.tenant) });
});

app.post('/api/ai/text', authenticateRequest, requireScopedPermission('tasks:write'), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });
    const scope = getScopeContext(req);
    await ensureCreditsAvailable({ tenant: scope.tenant, user: req.user, amount: CREDIT_COSTS.generateText, label: 'generate AI text' });
    const text = await callHuggingFaceText(prompt);
    await debitCredits({ tenant: scope.tenant, user: req.user, amount: CREDIT_COSTS.generateText, type: 'ai_text', metadata: { promptLength: prompt.length, scopeId: scope.scopeId } });
    res.json({ text, model: 'hugging-face-space', user: sanitizeUser(req.user, req.membership, req.tenant) });
  } catch (error) {
    logger.warn({ error: error.message }, 'AI text generation unavailable');
    res.status(502).json({ error: 'We are unable to generate text right now. Please try again shortly.' });
  }
});

app.post('/api/ai/image', authenticateRequest, requireScopedPermission('tasks:write'), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || '').trim();
    if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });
    const scope = getScopeContext(req);
    await ensureCreditsAvailable({ tenant: scope.tenant, user: req.user, amount: CREDIT_COSTS.generateImage, label: 'generate AI image' });
    const imageUrl = await callHuggingFaceImage(prompt);
    await debitCredits({ tenant: scope.tenant, user: req.user, amount: CREDIT_COSTS.generateImage, type: 'ai_image', metadata: { promptLength: prompt.length, scopeId: scope.scopeId } });
    res.json({ imageUrl, user: sanitizeUser(req.user, req.membership, req.tenant) });
  } catch (error) {
    logger.warn({ error: error.message }, 'AI image generation unavailable');
    res.status(502).json({ error: 'We are unable to generate an image right now. Please try again shortly.' });
  }
});

app.get('/api/tasks', authenticateRequest, requireScopedPermission('tasks:read'), async (req, res) => {
  const scope = getScopeContext(req);
  const tasks = await Task.find({ tenantId: scope.scopeId }).sort({ createdAt: -1 }).lean();
  res.json({ tasks });
});

app.patch('/api/tasks/:taskId/status', authenticateRequest, requireScopedPermission('tasks:write'), async (req, res) => {
  const status = String(req.body.status || '').trim().toLowerCase();
  if (!['active', 'paused', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid task status.' });
  const scope = getScopeContext(req);
  const task = await Task.findOneAndUpdate({ _id: req.params.taskId, tenantId: scope.scopeId }, { status }, { returnDocument: 'after' });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  res.json({ task });
});

app.delete('/api/tasks/:taskId', authenticateRequest, requireScopedPermission('tasks:write'), async (req, res) => {
  const scope = getScopeContext(req);
  const task = await Task.findOneAndDelete({ _id: req.params.taskId, tenantId: scope.scopeId });
  if (!task) return res.status(404).json({ error: 'Task not found.' });
  res.json({ success: true });
});

app.post('/api/tasks/bulk-action', authenticateRequest, requireScopedPermission('tasks:write'), async (req, res) => {
  const action = String(req.body.action || '').trim().toLowerCase();
  const taskIds = Array.isArray(req.body.taskIds) ? req.body.taskIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (!taskIds.length) return res.status(400).json({ error: 'Select at least one task.' });
  if (action === 'pause') {
    const scope = getScopeContext(req);
    await Task.updateMany({ _id: { $in: taskIds }, tenantId: scope.scopeId }, { status: 'paused' });
    return res.json({ success: true, action });
  }
  if (action === 'delete') {
    const scope = getScopeContext(req);
    await Task.deleteMany({ _id: { $in: taskIds }, tenantId: scope.scopeId });
    return res.json({ success: true, action });
  }
  return res.status(400).json({ error: 'Unsupported bulk action.' });
});


app.get('/api/workspaces/members', authenticateRequest, requireActiveWorkspace, requirePermission('members:manage'), async (req, res) => {
  const members = await listWorkspaceMembers(req.tenant._id);
  res.json({ members, workspace: req.tenant });
});

app.post('/api/workspaces/members', authenticateRequest, requireActiveWorkspace, requirePermission('members:manage'), async (req, res) => {
  try {
    const email = sanitizeTextInput(req.body.email).toLowerCase();
    const role = ['admin', 'operator', 'viewer'].includes(String(req.body.role || '').trim().toLowerCase())
      ? String(req.body.role || '').trim().toLowerCase()
      : 'viewer';
    if (!email.includes('@')) return res.status(400).json({ error: 'Enter a valid teammate email address.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'No account exists for that email yet.' });
    let membership = await TenantMembership.findOne({ tenantId: req.tenant._id, userId: user._id });
    if (membership) {
      membership.role = role;
      membership.status = 'active';
      await membership.save();
    } else {
      membership = await TenantMembership.create({ tenantId: req.tenant._id, userId: user._id, role, status: 'active' });
    }
    await AppSession.updateMany({ userId: user._id }, { tenantId: req.tenant._id, lastSeenAt: new Date() });
    const members = await listWorkspaceMembers(req.tenant._id);
    res.status(201).json({ membership, members, workspace: req.tenant });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to add teammate to the workspace.' });
  }
});

app.patch('/api/workspaces/members/:membershipId', authenticateRequest, requireActiveWorkspace, requirePermission('members:manage'), async (req, res) => {
  const role = String(req.body.role || '').trim().toLowerCase();
  if (!['admin', 'operator', 'viewer', 'owner'].includes(role)) return res.status(400).json({ error: 'Choose a valid role.' });
  const membership = await TenantMembership.findOne({ _id: req.params.membershipId, tenantId: req.tenant._id });
  if (!membership) return res.status(404).json({ error: 'Workspace member not found.' });
  if (String(membership.userId) === String(req.user._id) && membership.role === 'owner' && role !== 'owner') {
    return res.status(400).json({ error: 'The workspace owner cannot remove their own owner role.' });
  }
  membership.role = role;
  await membership.save();
  const members = await listWorkspaceMembers(req.tenant._id);
  res.json({ membership, members, workspace: req.tenant });
});

app.get('/api/tenants/me', authenticateRequest, requireActiveWorkspace, async (req, res) => {
  const ledger = await CreditLedger.find({ tenantId: String(req.tenant._id) }).sort({ createdAt: -1 }).limit(25).lean();
  res.json({ tenant: req.tenant, membership: req.membership, ledger });
});

app.post('/api/payments/paystack/initialize', authenticateRequest, async (req, res) => {
  try {
    const amount = normalizePaymentAmount(req.body.amount);
    const credits = convertAmountToCredits(amount);
    const scope = getScopeContext(req);
    const reference = `codebot_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    await PaymentTransaction.create({
      reference,
      userId: String(req.user._id),
      tenantId: scope.tenant ? String(scope.tenant._id) : '',
      email: req.user.email,
      amount,
      credits,
      currency: PAYSTACK_CURRENCY,
      metadata: { scopeId: scope.scopeId, scopeType: scope.tenant ? 'workspace' : 'account' },
    });
    const initialized = await initializePaystackTransaction({
      email: req.user.email,
      amount,
      reference,
      metadata: { credits, scopeId: scope.scopeId, scopeType: scope.tenant ? 'workspace' : 'account' },
    });
    res.status(201).json({
      reference,
      accessCode: initialized.access_code,
      authorizationUrl: initialized.authorization_url,
      amount,
      credits,
      currency: PAYSTACK_CURRENCY,
      publicKey: PAYSTACK_PUBLIC_KEY,
      email: req.user.email,
      user: sanitizeUser(req.user, req.membership, req.tenant),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to initialize payment.' });
  }
});

app.post('/api/payments/paystack/verify', authenticateRequest, async (req, res) => {
  try {
    const reference = String(req.body.reference || '').trim();
    if (!reference) return res.status(400).json({ error: 'Payment reference is required.' });
    const transaction = await PaymentTransaction.findOne({ reference, userId: String(req.user._id) });
    if (!transaction) return res.status(404).json({ error: 'Payment transaction not found.' });
    if (transaction.status === 'success') {
      if (transaction.tenantId) req.tenant = await Tenant.findById(transaction.tenantId);
      return res.json({
        success: true,
        transaction,
        user: sanitizeUser(await User.findById(req.user._id), req.membership, req.tenant || null),
      });
    }
    const verified = await verifyPaystackTransaction(reference);
    if (verified.status !== 'success') {
      transaction.status = 'failed';
      transaction.metadata = { ...transaction.metadata, paystackStatus: verified.status || 'failed' };
      await transaction.save();
      return res.status(400).json({ error: 'Payment was not successful.' });
    }
    const paidAmount = Number(verified.amount || 0) / 100;
    if (paidAmount < Number(transaction.amount || 0)) {
      transaction.status = 'failed';
      transaction.metadata = { ...transaction.metadata, paidAmount };
      await transaction.save();
      return res.status(400).json({ error: 'Verified payment amount did not match the expected amount.' });
    }
    const scopeTenant = transaction.tenantId ? await Tenant.findById(transaction.tenantId) : null;
    const freshUser = await User.findById(req.user._id);
    await creditAccountBalance({
      tenant: scopeTenant,
      user: freshUser,
      amount: Number(transaction.credits || 0),
      type: 'payment_topup',
      metadata: { reference, channel: 'paystack', amount: transaction.amount, currency: transaction.currency },
    });
    transaction.status = 'success';
    transaction.verifiedAt = new Date();
    transaction.metadata = { ...transaction.metadata, gatewayResponse: verified.gateway_response || '', channel: verified.channel || '' };
    await transaction.save();
    const membership = transaction.tenantId ? await TenantMembership.findOne({ tenantId: transaction.tenantId, userId: freshUser._id, status: 'active' }) : null;
    res.json({
      success: true,
      transaction,
      user: sanitizeUser(freshUser, membership, scopeTenant),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to verify payment.' });
  }
});

app.post('/api/enquiries', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = sanitizeTextInput(req.body.email).toLowerCase();
    const message = String(req.body.message || '').trim();
    if (!name || !email || !message) return res.status(400).json({ error: 'Name, email, and message are required.' });
    await Enquiry.create({ name, email, message, recipient: SMTP_USER });
    await sendEnquiryEmail({ name, email, message });
    res.status(201).json({ success: true, message: `Enquiry sent successfully to ${SMTP_USER}.` });
  } catch (error) {
    logger.warn({ error: error.message }, 'Unable to send enquiry email');
    res.status(500).json({ error: error.message || 'Unable to send your enquiry right now.' });
  }
});

app.get('/api/config/public', (req, res) => {
  res.json({
    paystackPublicKey: PAYSTACK_PUBLIC_KEY,
    paystackCurrency: PAYSTACK_CURRENCY,
    paystackCreditRate: PAYSTACK_CREDIT_RATE,
    smtpFrom: SMTP_USER,
  });
});

app.get('/api/config/required-credentials', (req, res) => {
  res.json({
    database: ['CLOUD_MONGO_URI or USE_LOCAL=true'],
    security: ['RATE_LIMIT_PER_MINUTE (optional)', 'DEFAULT_TENANT_TIMEZONE (optional)'],
    socialLogin: {
      google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'],
      github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_CALLBACK_URL'],
    },
    payments: ['PAYSTACK_PUBLIC_KEY', 'PAYSTACK_SECRET_KEY', 'PAYSTACK_CURRENCY (optional)', 'PAYSTACK_CREDIT_RATE (optional)'],
    email: ['SMTP_PORT', 'SMTP_PASSWORD', 'SMTP_HOST (optional)', 'SMTP_USER (optional)', 'SMTP_FROM_NAME (optional)'],
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
