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

// --- Database Configuration ---
const IS_LOCAL = process.env.USE_LOCAL === 'true'; 
const MONGO_URI = IS_LOCAL ? 'mongodb://localhost:27017/whatsapp_bot' : process.env.CLOUD_MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log(`✅ MongoDB Connected: ${IS_LOCAL ? 'Local' : 'Cloud'}`))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- Mongoose Models ---
const AuthSchema = new mongoose.Schema({ _id: String, data: String }, { collection: 'kayode_session' });
const AuthModel = mongoose.model('Auth', AuthSchema);

const TaskSchema = new mongoose.Schema({
    taskType: { type: String, enum: ['single', 'all_contacts', 'group_members'], required: true },
    targetId: String,   
    message: String,
    mediaUrl: String,   
    mediaType: { type: String, enum: ['text', 'image', 'video', 'audio'], default: 'text' },
    day: Number, 
    time: String, 
    delay: { type: Number, default: 5000 },
    status: { type: String, default: 'pending' },
    lastRun: Date
});
const Task = mongoose.model('Task', TaskSchema);

const ContactSchema = new mongoose.Schema({
    _id: String, // The WhatsApp JID
    name: String,
    notify: String,
    updatedAt: { type: Date, default: Date.now }
});
const Contact = mongoose.model('Contact', ContactSchema);

// --- Auth Provider ---
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

// --- Bot Logic ---
let sock;
let latestQr = null;

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

    // Function to save contacts to DB
    const upsertContact = async (contacts) => {
        // Baileys sends an array of contact objects
        console.log("Processing contacts update:", JSON.stringify(contacts, null, 2));
        for (const contact of contacts) {
            // Use contact.id or contact.jid
            const jid = contact.id || contact.jid;
            
            if (!jid) continue; // Skip if no ID is found

            await Contact.updateOne(
                { _id: jid },
                { 
                    $set: { 
                        name: contact.notify || contact.verifiedName || contact.name || "Unknown",
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
        console.error("Error manual syncing contacts:", e);
    }
}

// Call this inside your connection.update 'open' block:
// if (connection === 'open') { await fetchAllContacts(); }

    // Listen for events
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
            console.log('✅ WhatsApp Connected!');
            fetchAllContacts();
        
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });
}

// --- Scheduler ---
cron.schedule('* * * * *', async () => {
    if (!sock) return;
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    const tasks = await Task.find({ day: now.getDay(), time: currentTime, status: 'pending' });

    for (const task of tasks) {
        let recipients = [];
        try {
            if (task.taskType === 'single') recipients = [task.targetId];
            else if (task.taskType === 'group_members') {
                const group = await sock.groupMetadata(task.targetId);
                recipients = group.participants.map(p => p.id);
            }

            task.status = 'processing';
            await task.save();

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

            task.status = 'completed';
            task.lastRun = new Date();
            await task.save();
        } catch (e) {
            console.error("Task Error:", e);
            task.status = 'failed';
            await task.save();
        }
    }
});

// --- API Endpoints ---
app.get('/api/tasks', async (req, res) => res.json(await Task.find().sort({_id: -1})));
app.post('/api/tasks', async (req, res) => res.json(await new Task(req.body).save()));
app.delete('/api/tasks/:id', async (req, res) => res.json(await Task.findByIdAndDelete(req.params.id)));

// QR Code Check for Frontend
app.get('/api/qr', (req, res) => res.json({ qr: latestQr }));
// --- New API Endpoints ---
app.get('/api/chats', async (req, res) => {
    try {
        // fetch all chats/groups from the store or directly via socket
        const chats = await sock.groupFetchAllParticipating();
        const formatted = Object.values(chats).map(g => ({
            id: g.id,
            name: g.subject,
            members: g.participants.length
        }));
        res.json(formatted);
    } catch (e) {
        res.status(500).json({ error: "Failed to fetch groups" });
    }
});

// Note: Getting full contact lists can be large, consider pagination if you have thousands
app.get('/api/contacts', async (req, res) => {
    try {
        const contacts = await Contact.find().sort({ name: 1 });
        res.json(contacts);
    } catch (e) {
        res.status(500).json({ error: "Could not fetch contacts from DB" });
    }
});

app.listen(3000, () => console.log('🚀 Dashboard: http://localhost:3000'));
startBot();