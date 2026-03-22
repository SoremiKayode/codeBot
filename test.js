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

const url = "https://codeignite-whatsapptext.hf.space/gradio_api/call/respond";


async function runTutor() {
    try {
        console.log("Connecting to CodeIgnite AI...");

        // 1. Submit the request to get an Event ID
        const submitReq = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                data: [
                    "Hello!!", // User Message
                    "You are the CodeIgnite AI tutor. Help students learn coding by being encouraging and clear.", // System Message
                    2048, // Max new tokens
                    4,  // Temperature
                    1.0   // Top-p
                ]
            })
        });

        if (!submitReq.ok) throw new Error(`Submit failed: ${submitReq.statusText}`);
        
        const { event_id } = await submitReq.json();
        console.log(`Event ID: ${event_id}`);

        // 2. Open the stream
        const response = await fetch(`${url}/${event_id}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let fullResponse = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            
            // SSE format splits messages by double newlines
            const messages = chunk.split("\n\n");

            for (const msg of messages) {
                if (msg.includes("event: error")) {
                    console.error("\n[Server Error]:", msg);
                    return;
                }

                if (msg.includes("data: ")) {
                    // Extract the content after "data: "
                    const dataLine = msg.split("\n").find(line => line.startsWith("data: "));
                    if (dataLine) {
                        const rawData = dataLine.replace("data: ", "").trim();
                        
                        // Skip heartbeats or empty data
                        if (rawData === "null" || rawData === "[]") continue;

                        try {
                            // Gradio usually sends data as a JSON array [string]
                            const parsed = JSON.parse(rawData);
                            const text = Array.isArray(parsed) ? parsed[0] : parsed;
                            
                            // If the API sends the full accumulated text, 
                            // we only print the new part
                            if (text && text.length > fullResponse.length) {
                                const newChar = text.slice(fullResponse.length);
                                process.stdout.write(newChar); 
                                fullResponse = text;
                            }
                        } catch (e) {
                            // If it's not JSON, just print it raw
                            if (rawData !== "null") process.stdout.write(rawData);
                        }
                    }
                }
            }
        }

        console.log("\n\n--- Done ---");

    } catch (error) {
        console.error("Error:", error.message);
    }
}

runTutor();