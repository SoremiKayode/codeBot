import express from 'express';
import mongoose from 'mongoose';
import qrcode from 'qrcode-terminal';
import cron from 'node-cron';
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
app.use(express.json());
app.use(express.static('public'));

const IS_LOCAL = process.env.USE_LOCAL === 'true';
const MONGO_URI = IS_LOCAL ? 'mongodb://localhost:27017/whatsapp_bot' : process.env.CLOUD_MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log(`✅ MongoDB Connected: ${IS_LOCAL ? 'Local' : 'Cloud'}`))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

const AuthSchema = new mongoose.Schema({ _id: String, data: String }, { collection: 'kayode_session' });
const AuthModel = mongoose.model('Auth', AuthSchema);

const ScheduleSchema = new mongoose.Schema({
    startDate: { type: Date, required: true },
    frequency: { type: String, enum: ['once', 'weekly', 'monthly'], required: true },
    weeklyDays: [{ type: Number, min: 0, max: 6 }],
    monthlyDates: [{ type: Number, min: 1, max: 31 }],
    monthlyPattern: {
        ordinal: { type: String, enum: ['first', 'second', 'third', 'fourth', 'last'] },
        weekday: { type: Number, min: 0, max: 6 }
    }
}, { _id: false });

const TaskSchema = new mongoose.Schema({
    tenantId: { type: String, default: 'default-tenant', index: true },
    userId: { type: String, default: null, index: true },
    whatsappAccountId: { type: String, default: null, index: true },
    taskType: { type: String, enum: ['single', 'all_contacts', 'group_members'], required: true },
    targetId: String,
    message: String,
    mediaUrl: String,
    mediaType: { type: String, enum: ['text', 'image', 'video', 'audio'], default: 'text' },
    time: { type: String, required: true },
    delay: { type: Number, default: 5000 },
    schedule: { type: ScheduleSchema, required: true },
    status: { type: String, enum: ['pending', 'active', 'processing', 'completed', 'failed'], default: 'active' },
    nextRunAt: { type: Date, index: true },
    lastRunAt: Date,
    lastError: String
}, { timestamps: true });

const Task = mongoose.model('Task', TaskSchema);

const ContactSchema = new mongoose.Schema({
    _id: String,
    name: String,
    notify: String,
    updatedAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', ContactSchema);

function parseTimeToParts(time) {
    const [hours, minutes] = String(time || '').split(':').map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
        throw new Error('Time must be in HH:mm format');
    }
    return { hours, minutes };
}

function startOfMinute(date) {
    const copy = new Date(date);
    copy.setSeconds(0, 0);
    return copy;
}

function combineDateAndTime(dateInput, time) {
    const date = new Date(dateInput);
    if (Number.isNaN(date.getTime())) {
        throw new Error('Invalid start date');
    }
    const { hours, minutes } = parseTimeToParts(time);
    date.setHours(hours, minutes, 0, 0);
    return date;
}

function getDaysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
}

function getNthWeekdayOfMonth(year, monthIndex, weekday, ordinal) {
    const firstDay = new Date(year, monthIndex, 1);
    const firstWeekdayOffset = (weekday - firstDay.getDay() + 7) % 7;

    if (ordinal === 'last') {
        const lastDate = getDaysInMonth(year, monthIndex);
        const lastDay = new Date(year, monthIndex, lastDate);
        const backwardsOffset = (lastDay.getDay() - weekday + 7) % 7;
        return lastDate - backwardsOffset;
    }

    const ordinalMap = {
        first: 1,
        second: 2,
        third: 3,
        fourth: 4
    };

    const nth = ordinalMap[ordinal];
    if (!nth) return null;
    const dayOfMonth = 1 + firstWeekdayOffset + ((nth - 1) * 7);
    return dayOfMonth <= getDaysInMonth(year, monthIndex) ? dayOfMonth : null;
}

function normalizeTaskPayload(payload) {
    const schedule = payload.schedule || {};
    const normalized = {
        tenantId: payload.tenantId || 'default-tenant',
        userId: payload.userId || null,
        whatsappAccountId: payload.whatsappAccountId || null,
        taskType: payload.taskType,
        targetId: payload.targetId,
        message: payload.message,
        mediaUrl: payload.mediaUrl,
        mediaType: payload.mediaType || 'text',
        time: payload.time,
        delay: Number(payload.delay) || 5000,
        schedule: {
            startDate: schedule.startDate || payload.startDate,
            frequency: schedule.frequency || payload.frequency,
            weeklyDays: Array.isArray(schedule.weeklyDays) ? schedule.weeklyDays.map(Number) : [],
            monthlyDates: Array.isArray(schedule.monthlyDates) ? schedule.monthlyDates.map(Number) : [],
            monthlyPattern: schedule.monthlyPattern || null
        }
    };

    if (!normalized.schedule.startDate) {
        throw new Error('Start date is required');
    }

    if (!normalized.schedule.frequency) {
        throw new Error('Frequency is required');
    }

    if (normalized.schedule.frequency === 'weekly' && normalized.schedule.weeklyDays.length === 0) {
        throw new Error('Select at least one day for weekly tasks');
    }

    if (normalized.schedule.frequency === 'monthly') {
        const hasMonthlyDates = normalized.schedule.monthlyDates.length > 0;
        const hasMonthlyPattern = normalized.schedule.monthlyPattern && Number.isInteger(Number(normalized.schedule.monthlyPattern.weekday));
        if (!hasMonthlyDates && !hasMonthlyPattern) {
            throw new Error('Monthly tasks need month dates or a weekday pattern');
        }
        if (hasMonthlyPattern) {
            normalized.schedule.monthlyPattern = {
                ordinal: normalized.schedule.monthlyPattern.ordinal,
                weekday: Number(normalized.schedule.monthlyPattern.weekday)
            };
        }
    }

    return normalized;
}

function calculateNextRun(taskLike, fromDate = new Date()) {
    const startDate = combineDateAndTime(taskLike.schedule.startDate, taskLike.time);
    const baseline = startOfMinute(fromDate);
    const searchStart = startDate > baseline ? startDate : baseline;
    const frequency = taskLike.schedule.frequency;

    if (frequency === 'once') {
        return startDate >= baseline ? startDate : null;
    }

    if (frequency === 'weekly') {
        const selectedDays = [...new Set((taskLike.schedule.weeklyDays || []).map(Number).filter(day => day >= 0 && day <= 6))].sort((a, b) => a - b);
        for (let offset = 0; offset < 370; offset += 1) {
            const candidate = new Date(searchStart);
            candidate.setDate(candidate.getDate() + offset);
            candidate.setHours(startDate.getHours(), startDate.getMinutes(), 0, 0);
            if (candidate < startDate || candidate < baseline) continue;
            if (selectedDays.includes(candidate.getDay())) {
                return candidate;
            }
        }
        return null;
    }

    if (frequency === 'monthly') {
        const monthlyDates = [...new Set((taskLike.schedule.monthlyDates || []).map(Number).filter(day => day >= 1 && day <= 31))].sort((a, b) => a - b);
        const monthlyPattern = taskLike.schedule.monthlyPattern;

        for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
            const cursor = new Date(searchStart.getFullYear(), searchStart.getMonth() + monthOffset, 1);
            const year = cursor.getFullYear();
            const monthIndex = cursor.getMonth();
            const candidateDates = [];

            for (const dayOfMonth of monthlyDates) {
                const safeDay = Math.min(dayOfMonth, getDaysInMonth(year, monthIndex));
                candidateDates.push(new Date(year, monthIndex, safeDay, startDate.getHours(), startDate.getMinutes(), 0, 0));
            }

            if (monthlyPattern?.ordinal && Number.isInteger(monthlyPattern.weekday)) {
                const patternDay = getNthWeekdayOfMonth(year, monthIndex, Number(monthlyPattern.weekday), monthlyPattern.ordinal);
                if (patternDay) {
                    candidateDates.push(new Date(year, monthIndex, patternDay, startDate.getHours(), startDate.getMinutes(), 0, 0));
                }
            }

            candidateDates.sort((a, b) => a - b);
            const match = candidateDates.find(candidate => candidate >= startDate && candidate >= baseline);
            if (match) return match;
        }
        return null;
    }

    return null;
}

async function useMongooseAuthState() {
    const writeData = async (data, id) => {
        const json = JSON.stringify(data, BufferJSON.replacer);
        return AuthModel.replaceOne({ _id: id }, { data: json }, { upsert: true });
    };
    const readData = async (id) => {
        const result = await AuthModel.findById(id);
        return result ? JSON.parse(result.data, BufferJSON.reviver) : null;
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
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            if (value) await writeData(value, key);
                            else await AuthModel.deleteOne({ _id: key });
                        }
                    }
                }
            }
        },
        saveCreds: () => writeData(creds, 'creds')
    };
}

let sock;
let latestQr = null;
let taskSocketActive = false;

async function startBot() {
    const { version } = await fetchLatestBaileysVersion();
    const { state, saveCreds } = await useMongooseAuthState();

    sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'error' }),
        printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    const upsertContact = async (contacts) => {
        console.log('Processing contacts update:', JSON.stringify(contacts, null, 2));
        for (const contact of contacts) {
            const jid = contact.id || contact.jid;
            if (!jid) continue;

            await Contact.updateOne(
                { _id: jid },
                {
                    $set: {
                        name: contact.notify || contact.verifiedName || contact.name || 'Unknown',
                        notify: contact.notify || '',
                        updatedAt: new Date()
                    }
                },
                { upsert: true }
            );
        }
    };

    async function fetchAllContacts() {
        try {
            const contacts = await sock.contacts;
            if (contacts) {
                const contactArray = Object.values(contacts);
                await upsertContact(contactArray);
                console.log(`✅ Synced ${contactArray.length} contacts to DB`);
            }
        } catch (e) {
            console.error('Error manual syncing contacts:', e);
        }
    }

    sock.ev.on('contacts.upsert', upsertContact);
    sock.ev.on('contacts.update', upsertContact);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            latestQr = qr;
            console.log('✨ New QR Code generated. Scan it in terminal or dashboard.');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            latestQr = null;
            taskSocketActive = true;
            console.log('✅ WhatsApp Connected!');
            fetchAllContacts();
        }
        if (connection === 'close') {
            taskSocketActive = false;
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });
}

async function getTaskRecipients(task) {
    if (task.taskType === 'single') return [task.targetId];
    if (task.taskType === 'group_members') {
        const group = await sock.groupMetadata(task.targetId);
        return group.participants.map(p => p.id);
    }
    if (task.taskType === 'all_contacts') {
        const contacts = await Contact.find({}, { _id: 1 });
        return contacts.map(contact => contact._id);
    }
    return [];
}

async function runDueTasks() {
    if (!sock || !taskSocketActive) return;

    const now = startOfMinute(new Date());
    const dueTasks = await Task.find({
        status: { $in: ['active', 'pending'] },
        nextRunAt: { $lte: now }
    }).sort({ nextRunAt: 1, createdAt: 1 });

    for (const task of dueTasks) {
        try {
            task.status = 'processing';
            await task.save();

            const recipients = await getTaskRecipients(task);
            for (const jid of recipients) {
                const content = { caption: task.message };
                if (task.mediaType === 'text') {
                    await sock.sendMessage(jid, { text: task.message });
                } else {
                    content[task.mediaType] = { url: task.mediaUrl };
                    await sock.sendMessage(jid, content);
                }
                await new Promise(r => setTimeout(r, task.delay));
            }

            task.lastRunAt = new Date();
            task.lastError = null;
            const nextRunAt = calculateNextRun(task, new Date(task.lastRunAt.getTime() + 60000));
            task.nextRunAt = nextRunAt;
            task.status = nextRunAt ? 'active' : 'completed';
            await task.save();
        } catch (e) {
            console.error('Task Error:', e);
            task.status = 'failed';
            task.lastError = e.message;
            await task.save();
        }
    }
}

cron.schedule('* * * * *', runDueTasks);

app.get('/api/tasks', async (req, res) => res.json(await Task.find().sort({ createdAt: -1 })));
app.post('/api/tasks', async (req, res) => {
    try {
        const payload = normalizeTaskPayload(req.body);
        const task = new Task(payload);
        task.nextRunAt = calculateNextRun(task);
        task.status = task.nextRunAt ? 'active' : 'completed';
        const saved = await task.save();
        res.status(201).json(saved);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});
app.delete('/api/tasks/:id', async (req, res) => res.json(await Task.findByIdAndDelete(req.params.id)));

app.get('/api/qr', (req, res) => res.json({ qr: latestQr }));
app.get('/api/chats', async (req, res) => {
    try {
        const chats = await sock.groupFetchAllParticipating();
        const formatted = Object.values(chats).map(g => ({
            id: g.id,
            name: g.subject,
            members: g.participants.length
        }));
        res.json(formatted);
    } catch (e) {
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

app.get('/api/contacts', async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ name: 1 });
        res.json(contacts);
    } catch (e) {
        res.status(500).json({ error: 'Could not fetch contacts from DB' });
    }
});

app.listen(3000, () => console.log('🚀 Dashboard: http://localhost:3000'));
startBot();
