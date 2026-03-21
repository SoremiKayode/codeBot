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

const connectionStateStore = new Map();
const socketStore = new Map();

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function createToken() {
  return crypto.randomBytes(24).toString('hex');
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
    const state = await startWhatsAppSession(req.user);
    res.json(state);
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

app.post('/api/tasks', authenticateRequest, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const type = String(req.body.type || '').trim();
  const description = String(req.body.description || '').trim();

  if (!title || !type || !description) {
    return res.status(400).json({ error: 'Title, type, and description are required.' });
  }

  const task = await Task.create({
    userId: String(req.user._id),
    title,
    type,
    description,
    status: 'active',
  });

  res.status(201).json({ task });
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
