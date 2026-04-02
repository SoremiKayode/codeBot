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

// PHONE CONNECTION AND FETCHING CONTACT

// import * as baileys from '@whiskeysockets/baileys';
// import { Boom } from '@hapi/boom';
// import qrcode from 'qrcode-terminal';
// import { createObjectCsvWriter } from 'csv-writer';
// import readline from 'readline';

// const { 
//     default: makeWASocket, 
//     useMultiFileAuthState, 
//     fetchLatestBaileysVersion, 
//     DisconnectReason,
//     delay 
// } = baileys;

// const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
// const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// let allSavedContacts = [];

// async function startBot() {
//     const { state, saveCreds } = await useMultiFileAuthState('auth_info');
//     const { version } = await fetchLatestBaileysVersion();

//     // Configuration with safer logger access
//     const sock = makeWASocket({
//         version,
//         auth: state,
//         printQRInTerminal: false,
//         browser: ["Ubuntu", "Chrome", "20.0.04"], 
//     });

//     // --- PAIRING CODE LOGIC ---
//     if (!sock.authState.creds.registered) {
//         // Ask for number immediately
//         const phoneNumber = await question('Please enter your phone number (e.g., 2348143164036): ');
        
//         console.log("Waiting for connection to stabilize...");
//         // Wait 5 seconds to avoid the 428 "Precondition Required" error
//         await delay(5000);

//         try {
//             const code = await sock.requestPairingCode(phoneNumber);
//             console.log(`\n----------------------------`);
//             console.log(`🔗 YOUR PAIRING CODE: ${code}`);
//             console.log(`----------------------------\n`);
//             console.log('Steps: WhatsApp > Linked Devices > Link with phone number instead.\n');
//         } catch (err) {
//             console.error("❌ Failed to generate pairing code. Error:", err.message);
//             console.log("Try deleting the 'auth_info' folder and restarting.");
//         }
//     }

//     // --- EVENT LISTENERS ---
//     sock.ev.on('creds.update', saveCreds);

//     sock.ev.on('connection.update', async (update) => {
//         const { connection, lastDisconnect, qr } = update;

//         if (qr && !sock.authState.creds.registered) {
//             qrcode.generate(qr, { small: true });
//         }

//         if (connection === 'open') {
//             console.log('✅ Connected successfully!');
//             rl.close();
//         }

//         if (connection === 'close') {
//             const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
//             if (statusCode !== DisconnectReason.loggedOut) {
//                 console.log("🔄 Reconnecting...");
//                 startBot();
//             } else {
//                 console.log("🚫 Logged out. Delete 'auth_info' folder to pair again.");
//             }
//         }
//     });

//     sock.ev.on('messaging-history.set', async (data) => {
//         if (data.contacts) {
//             allSavedContacts = data.contacts
//                 .filter(c => c.id.endsWith('@s.whatsapp.net'))
//                 .map(c => ({
//                     name: c.name || c.notify || 'Unknown',
//                     phone: c.id.split('@')[0],
//                     jid: c.id
//                 }));

//             await saveToCSV(allSavedContacts);
//             await createStatusWithPrivacy(sock, allSavedContacts);
//         }
//     });
// }
// // --- HELPER FUNCTIONS ---

// async function saveToCSV(contacts) {
//     const csvWriter = createObjectCsvWriter({
//         path: 'contacts.csv',
//         header: [
//             { id: 'name', title: 'NAME' },
//             { id: 'phone', title: 'PHONE' },
//             { id: 'jid', title: 'JID' }
//         ]
//     });

//     try {
//         await csvWriter.writeRecords(contacts);
//         console.log(`📄 Saved ${contacts.length} contacts to CSV.`);
//     } catch (err) {
//         console.error('CSV Error:', err);
//     }
// }

// async function createStatusWithPrivacy(sock, contacts) {
//     try {
//         const participantJids = contacts.map(c => c.jid);
//         const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
//         if (!participantJids.includes(myJid)) participantJids.push(myJid);

//         await sock.sendMessage('status@broadcast', { 
//             text: 'Hello from CodeIgnite! This is an automated status update.' 
//         }, { 
//             statusJidList: participantJids 
//         });

//         console.log('✅ Status uploaded successfully!');
//     } catch (err) {
//         console.log('Status upload failed (may be due to privacy settings).');
//     }
// }

// // Start the process
// startBot().catch(err => console.error("Critical Error:", err));


import * as baileys from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import readline from 'readline';
import fs from 'fs';
import path from 'path';

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    delay
} = baileys;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

let allContacts = [];

// =============================
// 🚀 START BOT
// =============================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        browser: ["Ubuntu", "Chrome", "1.0"],
        syncFullHistory: true // 🔥 important
    });

    // =============================
    // 🔗 PHONE NUMBER PAIRING
    // =============================
    if (!sock.authState.creds.registered) {
        const phoneNumber = await question('Enter phone number (234XXXXXXXXXX): ');

        console.log("⏳ Preparing pairing...");
        await delay(5000);

        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`\n🔑 PAIRING CODE: ${code}\n`);
            console.log('👉 WhatsApp > Linked Devices > Link with phone number\n');
        } catch (err) {
            console.error("❌ Pairing failed:", err.message);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    // =============================
    // 🔥 FETCH USERS FROM CHATS (RELIABLE)
    // =============================
    sock.ev.on('messaging-history.set', (data) => {
        if (data.chats && data.chats.length > 0) {

            allContacts = data.chats
                .filter(c => c.id.endsWith('@s.whatsapp.net'))
                .map(c => ({
                    name: c.name || 'Unknown',
                    jid: c.id
                }));

            console.log("\n📞 USERS (FROM CHATS):");
            allContacts.forEach((c, i) => {
                console.log(`${i + 1}. ${c.name} - ${c.jid}`);
            });

            console.log(`\n✅ Total Users: ${allContacts.length}`);
        }
    });

    // =============================
    // CONNECTION
    // =============================
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('✅ Connected successfully!');
            rl.close();

            console.log("⏳ Waiting for chat sync...");

            // 🔥 WAIT UNTIL USERS ARE AVAILABLE
            let attempts = 0;

            while (allContacts.length === 0 && attempts < 10) {
                await delay(3000);
                attempts++;
                console.log(`⏳ Waiting... (${attempts}) Users: ${allContacts.length}`);
            }

            if (allContacts.length === 0) {
                console.log("❌ No users found. Cannot send status.");
                return;
            }

            console.log(`✅ Users ready: ${allContacts.length}`);

            await sendStatus(sock);
        }

        if (connection === 'close') {
            const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;

            if (statusCode !== DisconnectReason.loggedOut) {
                console.log("🔄 Reconnecting...");
                startBot();
            } else {
                console.log("🚫 Logged out. Delete auth_info to reconnect.");
            }
        }
    });
}

// =============================
// 📤 SEND STATUS
// =============================
async function sendStatus(sock) {
    try {
        let participantJids = allContacts.map(c => c.jid);

        // ✅ INCLUDE YOURSELF
        const myJid = sock.user.id.includes(':')
            ? sock.user.id.split(':')[0] + '@s.whatsapp.net'
            : sock.user.id;

        if (!participantJids.includes(myJid)) {
            participantJids.push(myJid);
        }

        console.log(`📡 Sending status to ${participantJids.length} users`);

        // =============================
        // FILE PATH
        // =============================
        const filePath = path.join(process.cwd(), 'public', 'assets', 'hero.png');

        if (!fs.existsSync(filePath)) {
            console.error("❌ File not found:", filePath);
            return;
        }

        let message;

        if (filePath.endsWith('.mp4')) {
            message = {
                video: fs.readFileSync(filePath),
                caption: '🚀 CodeIgnite Automation Status'
            };
        } else {
            message = {
                image: fs.readFileSync(filePath),
                caption: '🚀 CodeIgnite Automation Status'
            };
        }

        // 🔥 FINAL DELAY (IMPORTANT)
        await delay(5000);

        await sock.sendMessage(
            'status@broadcast',
            message,
            { statusJidList: participantJids }
        );

        console.log('✅ Status uploaded successfully!');

    } catch (err) {
        console.error("❌ Status failed:", err.message);
    }
}

// =============================
startBot().catch(err => console.error("Critical Error:", err));