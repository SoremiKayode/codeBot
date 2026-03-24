// import { Client } from "@gradio/client";
// import fs from "node:fs/promises";

// async function generateAndSave() {
//     try {
//         console.log("Connecting to CodeIgnite CPU Engine...");
//         const client = await Client.connect("codeignite/whatsappbot");
        
//         console.log("Sending prediction request (CPU Mode - Please wait ~60s)...");
        
//         // Match the Python function: infer(prompt, seed, randomize_seed, width, height)
//         const result = await client.predict("/predict", {       
//             prompt: "Golden city, cinematic lighting, high resolution", 
//             seed: 0, 
//             randomize_seed: true, 
//             width: 384, // 384 is the "sweet spot" for CPU RAM
//             height: 384, 
//         });

//         console.log("Full Response Object:", JSON.stringify(result, null, 2));

//         // The result usually comes back as an array in result.data
//         if (result.data && result.data[0]) {
//             const imageData = result.data[0];
            
//             // Handle different Gradio return types (URL string vs Object)
//             const imageUrl = typeof imageData === 'string' ? imageData : imageData.url;

//             if (imageUrl) {
//                 console.log(`Downloading image from: ${imageUrl}`);
//                 const response = await fetch(imageUrl);
//                 const arrayBuffer = await response.arrayBuffer();
//                 const fileName = `output_${Date.now()}.png`; // CPU models usually output PNG/JPG
                
//                 await fs.writeFile(fileName, Buffer.from(arrayBuffer));
//                 console.log(`✅ Image saved successfully as ${fileName}!`);
//             }
//         } else {
//             console.error("❌ No image data returned. Check the Space logs.");
//         }

//     } catch (error) {
//         console.error("❌ Error encountered:");
//         console.error(error.message);
//     }
// }

// generateAndSave();

// const url = "https://codeignite-whatsapptext.hf.space/gradio_api/call/respond";

// async function runTutor() {
//     try {
//         console.log("Connecting to CodeIgnite AI...");

//         const payload = {
//             data: [
//                 "Create a funtion code to add two number in python", // [0] message (string)
//                 [],        // [1] history (Required by ChatInterface, usually an empty array)
//                 "You are the CodeIgnite AI tutor. Help students learn coding by being encouraging and clear.", // [2] system_message
//                 512,       // [3] max_tokens (number)
//                 0.7,       // [4] temperature (number)
//                 0.95       // [5] top_p (number)
//             ]
//         };

//         // 1. Submit the request
//         const submitReq = await fetch(url, {
//             method: "POST",
//             headers: { "Content-Type": "application/json" },
//             body: JSON.stringify(payload)
//         });

//         if (!submitReq.ok) {
//             const errorText = await submitReq.text();
//             throw new Error(`Submit failed: ${submitReq.status} - ${errorText}`);
//         }
        
//         const { event_id } = await submitReq.json();
//         console.log(`Event ID: ${event_id}`);
//         console.log("--- Tutor Response ---");

//         // 2. Open the stream
//         const response = await fetch(`${url}/${event_id}`);
//         const reader = response.body.getReader();
//         const decoder = new TextDecoder();

//         let lastText = "";

//         while (true) {
//             const { value, done } = await reader.read();
//             if (done) break;

//             const chunk = decoder.decode(value);
//             const messages = chunk.split("\n\n");

//             for (const msg of messages) {
//                 if (msg.includes("data: ")) {
//                     const dataLine = msg.split("\n").find(line => line.startsWith("data: "));
//                     if (dataLine) {
//                         const rawData = dataLine.replace("data: ", "").trim();
//                         if (rawData === "null") continue;

//                         try {
//                             const parsed = JSON.parse(rawData);
//                             // Gradio's yield response is usually the first element of an array
//                             const currentFullText = Array.isArray(parsed) ? parsed[0] : parsed;

//                             if (currentFullText && currentFullText.length > lastText.length) {
//                                 // Print only the new part of the string
//                                 const newChars = currentFullText.slice(lastText.length);
//                                 process.stdout.write(newChars);
//                                 lastText = currentFullText;
//                             }
//                         } catch (e) {
//                             // Ignore parsing errors for heartbeat/non-json lines
//                         }
//                     }
//                 }
//             }
//         }
//         console.log("\n--- Finished ---");

//     } catch (error) {
//         console.error("\n[Error]:", error.message);
//     }
// }

// runTutor();


// import makeWASocket, { useMultiFileAuthState, delay, Browsers } from '@whiskeysockets/baileys';
// import pino from 'pino';
// import qrcode from 'qrcode-terminal';

// async function startStatusBot() {
//     const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
//     // Array to hold your contact JIDs
//     let contactList = [];

//     const sock = makeWASocket({
//         auth: state,
//         logger: pino({ level: 'silent' }),
//         browser: Browsers.macOS('Safari'),
//         syncFullHistory: true // CRITICAL: Tells WA to send your history/contacts
//     });

//     sock.ev.on('creds.update', saveCreds);

//     sock.ev.on('connection.update', (update) => {
//         const { connection, qr } = update;
//         if (qr) {
//             console.clear();
//             console.log('📸 Scan this QR:');
//             qrcode.generate(qr, { small: true });
//         }
//         if (connection === 'open') console.log('✅ Connected! Waiting for contacts to sync...');
//     });

//     // 1. Listen for the initial history sync to fill your array
//     sock.ev.on('messaging-history.set', async ({ contacts }) => {
//         // Filter for person JIDs only (skip groups/broadcasts)
//         contactList = contacts
//             .map(c => c.id)
//             .filter(id => id.endsWith('@s.whatsapp.net'));

//         console.log(`📦 Array updated: ${contactList.length} contacts found.`);

//         // 2. Post the status now that the array is full
//         if (contactList.length > 0) {
//             try {
//                 // Always include yourself so you can see it
//                 const myJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
//                 if (!contactList.includes(myJid)) contactList.push(myJid);

//                 await sock.sendMessage('status@broadcast', { 
//                     text: "No-Store Array Status Test! 🚀" 
//                 }, { 
//                     statusJidList: contactList 
//                 });
//                 console.log('🎉 Status posted to all contacts in the array!');
//             } catch (err) {
//                 console.error('❌ Failed to post:', err.message);
//             }
//         }
//     });

//     // 3. Optional: Listen for new contacts added while the bot is running
//     sock.ev.on('contacts.upsert', (newContacts) => {
//         for (const contact of newContacts) {
//             if (contact.id.endsWith('@s.whatsapp.net') && !contactList.includes(contact.id)) {
//                 contactList.push(contact.id);
//             }
//         }
//     });
// }

// startStatusBot();

import makeWASocket, { useMultiFileAuthState, delay, Browsers, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';

async function startStatusBot() {
    // 1. You MUST delete your 'auth_info' folder before running this
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        // FIX: The 1033893291 build is currently the only one bypassing the 405 block in 2026
        version: [2, 3000, 1033893291], 
        // FIX: Use 'Desktop' instead of 'Chrome' to appear as the official app
        browser: Browsers.macOS('Desktop'),
        syncFullHistory: true,
        connectTimeoutMs: 60000,
        printQRInTerminal: false 
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.clear();
            console.log('✨ QR Code Generated! Scan now:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            console.log('✅ Connected! Preparing status...');
            await delay(5000);

            try {
                const myNumber = '2348143164036@s.whatsapp.net';
                await sock.sendMessage('status@broadcast', { 
                    text: "405 Fixed! 🚀 Status is live." 
                }, {
                    statusJidList: [myNumber]
                });
                console.log('🎉 Status posted successfully!');
            } catch (err) {
                console.error('❌ Post error:', err.message);
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`🔌 Connection Closed. Status: ${statusCode}`);

            // If you keep getting 405, it means your IP might be temporarily flagged.
            // Wait 30 seconds before trying again.
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;
            if (!isLoggedOut) {
                const retryDelay = statusCode === 405 ? 30000 : 5000;
                console.log(`🔄 Retrying in ${retryDelay/1000}s...`);
                setTimeout(() => startStatusBot(), retryDelay);
            }
        }
    });
}

startStatusBot();