// import express from 'express';
// import mongoose from 'mongoose';
// import qrcode from 'qrcode-terminal';
// import cron from 'node-cron';
// import dotenv from 'dotenv';
// import pino from 'pino';

// // 1. Dynamic Imports for Baileys
// const { 
//     default: makeWASocket, 
//     DisconnectReason, 
//     BufferJSON, 
//     proto,
//     fetchLatestBaileysVersion 
// } = await import('@whiskeysockets/baileys');

// const { initAuthCreds } = await import('@whiskeysockets/baileys/lib/Utils/auth-utils.js');

// dotenv.config();
// const app = express();
// app.use(express.json());
// app.use(express.static('public'));

// // --- Database Configuration ---
// const IS_LOCAL = process.env.USE_LOCAL === 'true'; 
// const MONGO_URI = IS_LOCAL ? 'mongodb://localhost:27017/whatsapp_bot' : process.env.CLOUD_MONGO_URI;

// await mongoose.connect(MONGO_URI);
// console.log(`✅ MongoDB Connected: ${IS_LOCAL ? 'Local' : 'Cloud'}`);

// // --- Mongoose Models ---
// const AuthSchema = new mongoose.Schema({ _id: String, data: String }, { collection: 'kayode_session' });
// const AuthModel = mongoose.model('Auth', AuthSchema);

// const TaskSchema = new mongoose.Schema({
//     taskType: { type: String, enum: ['single', 'all_contacts', 'group_members'], required: true },
//     targetId: String,   
//     message: String,
//     mediaUrl: String,   
//     mediaType: { type: String, enum: ['text', 'image', 'video', 'audio'], default: 'text' },
//     day: Number, // 0-6
//     time: String, // HH:mm
//     delay: { type: Number, default: 5000 },
//     status: { type: String, default: 'pending' },
//     lastRun: Date
// });
// const Task = mongoose.model('Task', TaskSchema);

// // --- Mongoose Auth State Provider ---
// async function useMongooseAuthState() {
//     const writeData = async (data, id) => {
//         const json = JSON.stringify(data, BufferJSON.replacer);
//         return AuthModel.replaceOne({ _id: id }, { data: json }, { upsert: true });
//     };
//     const readData = async (id) => {
//         const result = await AuthModel.findById(id);
//         return result ? JSON.parse(result.data, BufferJSON.reviver) : null;
//     };
    
//     const creds = await readData('creds') || initAuthCreds();

//     return {
//         state: {
//             creds,
//             keys: {
//                 get: async (type, ids) => {
//                     const data = {};
//                     await Promise.all(ids.map(async (id) => {
//                         let value = await readData(`${type}-${id}`);
//                         if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
//                         data[id] = value;
//                     }));
//                     return data;
//                 },
//                 set: async (data) => {
//                     for (const category in data) {
//                         for (const id in data[category]) {
//                             const value = data[category][id];
//                             const key = `${category}-${id}`;
//                             if (value) await writeData(value, key);
//                             else await AuthModel.deleteOne({ _id: key });
//                         }
//                     }
//                 }
//             }
//         },
//         saveCreds: () => writeData(creds, 'creds')
//     };
// }

// // --- Smart DB Cleanup ---
// async function flushOldRecords() {
//     console.log('🧹 Running smart database cleanup...');
//     const protectedKeys = /creds|session|pre-key|sender-key|app-state-sync-key/;
//     const result = await AuthModel.deleteMany({ _id: { $not: protectedKeys } });
//     console.log(`🗑️ Removed ${result.deletedCount} unnecessary records.`);
// }

// // --- Bot Core ---
// let sock;
// async function startBot() {
//     await flushOldRecords();
//     const { version } = await fetchLatestBaileysVersion();
//     const { state, saveCreds } = await useMongooseAuthState();

//     sock = makeWASocket({
//         version,
//         auth: state,
//         logger: pino({ level: 'error' }),
//         printQRInTerminal: false, // QR handled by terminal or frontend later
//     });

//     sock.ev.on('creds.update', saveCreds);

//     sock.ev.on('connection.update', (update) => {
//         const { connection, lastDisconnect, qr } = update;
//         if (qr) qrcode.generate(qr, { small: true });
//         if (connection === 'open') console.log('✅ WhatsApp Connection Open');
//         if (connection === 'close') {
//             const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
//             if (shouldReconnect) startBot();
//         }
//     });
// }

// // --- Scheduler & Messaging ---
// cron.schedule('* * * * *', async () => {
//     if (!sock) return;
//     const now = new Date();
//     const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
//     const tasks = await Task.find({ day: now.getDay(), time: currentTime, status: 'pending' });

//     for (const task of tasks) {
//         let recipients = [];
//         if (task.taskType === 'single') recipients = [task.targetId];
//         else if (task.taskType === 'group_members') {
//             const group = await sock.groupMetadata(task.targetId);
//             recipients = group.participants.map(p => p.id);
//         }

//         task.status = 'processing';
//         await task.save();

//         for (const jid of recipients) {
//             try {
//                 const content = { caption: task.message };
//                 if (task.mediaType === 'text') {
//                     await sock.sendMessage(jid, { text: task.message });
//                 } else {
//                     content[task.mediaType] = { url: task.mediaUrl };
//                     await sock.sendMessage(jid, content);
//                 }
//             } catch (e) { console.error(`Error sending to ${jid}:`, e.message); }
//             await new Promise(r => setTimeout(r, task.delay));
//         }

//         task.status = 'completed';
//         task.lastRun = new Date();
//         await task.save();
//     }
// });

// // --- API Endpoints ---
// app.get('/api/tasks', async (req, res) => res.json(await Task.find().sort({_id: -1})));
// app.post('/api/tasks', async (req, res) => res.json(await new Task(req.body).save()));
// app.delete('/api/tasks/:id', async (req, res) => res.json(await Task.findByIdAndDelete(req.params.id)));

// app.listen(3000, () => console.log('🚀 API Running on Port 3000'));
// startBot();

// import makeWASocket, { 
//     useMultiFileAuthState, 
//     DisconnectReason, 
//     fetchLatestBaileysVersion 
// } from '@whiskeysockets/baileys';
// import { Boom } from '@hapi/boom';
// import qrcode from 'qrcode-terminal';

// async function startBot() {
//     // 1. Setup Auth and Version
//     const { state, saveCreds } = await useMultiFileAuthState('auth_info');
//     const { version } = await fetchLatestBaileysVersion();

//     // 2. Initialize the Socket
//     const sock = makeWASocket({
//         version,
//         auth: state,
//         // We handle QR manually to ensure it displays in ESM
//     });

//     // 3. Connection Handler
//     sock.ev.on('connection.update', async (update) => {
//         const { connection, lastDisconnect, qr } = update;

//         // Display QR Code
//         if (qr) {
//             console.log('--- SCAN THE QR CODE BELOW ---');
//             qrcode.generate(qr, { small: true });
//         }

//         if (connection === 'close') {
//             const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
//             const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
//             console.log(`Connection closed. Status: ${statusCode}. Reconnecting: ${shouldReconnect}`);
//             if (shouldReconnect) startBot();
//         } else if (connection === 'open') {
//             console.log('✅ Connected successfully to WhatsApp!');

//             // --- FETCH GROUPS ---
//             const groups = await listAllGroups(sock);
            
//             // --- FETCH MEMBERS (Example: first group in the list) ---
//             const groupIds = Object.keys(groups);
//             if (groupIds.length > 0) {
//                 await listGroupMembers(sock, groupIds[0]);
//             }
//         }
//     });

//     // Save session credentials
//     sock.ev.on('creds.update', saveCreds);
// }

// // --- LOGIC FUNCTIONS ---

// async function listAllGroups(sock) {
//     try {
//         const groups = await sock.groupFetchAllParticipating();
//         console.log('\n--- JOINED GROUPS ---');
//         for (const jid in groups) {
//             console.log(`Group: ${groups[jid].subject} | ID: ${jid}`);
//         }
//         return groups;
//     } catch (err) {
//         console.error('Error fetching groups:', err);
//         return {};
//     }
// }

// async function listGroupMembers(sock, groupId) {
//     try {
//         const metadata = await sock.groupMetadata(groupId);
//         console.log(`\n--- MEMBERS OF: ${metadata.subject} ---`);
//         metadata.participants.forEach((p, i) => {
//             const adminLabel = p.admin ? `(${p.admin})` : '';
//             console.log(`${i + 1}. ID: ${p.id} ${adminLabel}`);
//         });
//     } catch (err) {
//         console.error(`Error fetching members for ${groupId}:`, err);
//     }
// }

// // Start the application


// // Fetch All Contacts
// import * as baileys from '@whiskeysockets/baileys';
// import { Boom } from '@hapi/boom';
// import qrcode from 'qrcode-terminal';

// const { 
//     default: makeWASocket, 
//     useMultiFileAuthState, 
//     fetchLatestBaileysVersion, 
//     DisconnectReason 
// } = baileys;

// async function startBot() {
//     const { state, saveCreds } = await useMultiFileAuthState('auth_info');
//     const { version } = await fetchLatestBaileysVersion();

//     const sock = makeWASocket({
//         version,
//         auth: state,
//         printQRInTerminal: false,
//     });

//     // --- RELIABLE EXTRACTION LOGIC ---

//     // 1. This fires for your existing chat list
//     sock.ev.on('chats.set', (data) => {
//         const { chats } = data;
//         console.log(`\n--- FOUND ${chats.length} CHATS ---`);
        
//         chats.forEach((chat) => {
//             const jid = chat.id;
            
//             // Filter: Only look for individual chats (skip groups)
//             if (jid.endsWith('@s.whatsapp.net')) {
//                 const phoneNumber = jid.split('@')[0];
//                 const name = chat.name || 'No Name';
//                 console.log(`Name: ${name.padEnd(20)} | Phone: ${phoneNumber}`);
//             }
//         });
//     });

//     // 2. This fires if you have a massive history sync (usually first link)
//     sock.ev.on('messaging-history.set', (data) => {
//         if (data.contacts) {
//             console.log(`\n--- HISTORY SYNC: ${data.contacts.length} CONTACTS ---`);
//             data.contacts.forEach(c => {
//                 if (c.id.endsWith('@s.whatsapp.net')) {
//                     const num = c.id.split('@')[0];
//                     console.log(`Name: ${(c.name || c.notify || 'Unknown').padEnd(20)} | Phone: ${num}`);
//                 }
//             });
//         }
//     });

//     // 3. Connection Handler
//     sock.ev.on('connection.update', async (update) => {
//         const { connection, lastDisconnect, qr } = update;

//         if (qr) {
//             console.log('--- SCAN THE QR CODE ---');
//             qrcode.generate(qr, { small: true });
//         }

//         if (connection === 'close') {
//             const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
//             if (statusCode !== DisconnectReason.loggedOut) startBot();
//         } else if (connection === 'open') {
//             console.log('✅ Connected! If nothing prints, try sending a message to yourself or opening a chat on your phone.');
//         }
//     });

//     sock.ev.on('creds.update', saveCreds);
// }

// startBot().catch(err => console.error(err));


import * as baileys from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { createObjectCsvWriter } from 'csv-writer';
import fs from 'fs';

const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    DisconnectReason 
} = baileys;

// Global array to store contacts for the status function
let allSavedContacts = [];

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
    });

    sock.ev.on('messaging-history.set', async (data) => {
        if (data.contacts) {
            allSavedContacts = data.contacts
                .filter(c => c.id.endsWith('@s.whatsapp.net'))
                .map(c => ({
                    name: c.name || c.notify || 'Unknown',
                    phone: c.id.split('@')[0],
                    jid: c.id
                }));

            await saveToCSV(allSavedContacts);
            
            // Once saved, let's create a status
            await createStatusWithPrivacy(sock, allSavedContacts);
        }
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'open') console.log('✅ Connected!');
        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) startBot();
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// --- FUNCTION 1: SAVE TO CSV ---
async function saveToCSV(contacts) {
    const csvWriter = createObjectCsvWriter({
        path: 'contacts.csv',
        header: [
            { id: 'name', title: 'NAME' },
            { id: 'phone', title: 'PHONE' },
            { id: 'jid', title: 'JID' }
        ]
    });

    try {
        await csvWriter.writeRecords(contacts);
        console.log(`\n📄 Successfully saved ${contacts.length} contacts to contacts.csv`);
    } catch (err) {
        console.error('Error saving CSV:', err);
    }
}

// --- FUNCTION 2: CREATE STATUS WITH PRIVACY ---
async function createStatusWithPrivacy(sock, contacts) {
    try {
        // Extract just the JIDs for the privacy list
        const participantJids = contacts.map(c => c.jid);
        
        // Add your own number to the list so you can see it too
        const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
        if (!participantJids.includes(myJid)) {
            participantJids.push(myJid);
        }

        console.log(`📤 Uploading status to ${participantJids.length} people...`);

        // Posting a Text Status
        await sock.sendMessage('status@broadcast', { 
            text: 'Hello from CodeIgnite! This is an automated status update.' 
        }, { 
            statusJidList: participantJids 
        });

        console.log('✅ Status uploaded successfully!');
    } catch (err) {
        console.error('Error posting status:', err);
    }
}

startBot().catch(err => console.error(err));