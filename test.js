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

        const payload = {
            data: [
                "Create a funtion code to add two number in python", // [0] message (string)
                [],        // [1] history (Required by ChatInterface, usually an empty array)
                "You are the CodeIgnite AI tutor. Help students learn coding by being encouraging and clear.", // [2] system_message
                512,       // [3] max_tokens (number)
                0.7,       // [4] temperature (number)
                0.95       // [5] top_p (number)
            ]
        };

        // 1. Submit the request
        const submitReq = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (!submitReq.ok) {
            const errorText = await submitReq.text();
            throw new Error(`Submit failed: ${submitReq.status} - ${errorText}`);
        }
        
        const { event_id } = await submitReq.json();
        console.log(`Event ID: ${event_id}`);
        console.log("--- Tutor Response ---");

        // 2. Open the stream
        const response = await fetch(`${url}/${event_id}`);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let lastText = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const messages = chunk.split("\n\n");

            for (const msg of messages) {
                if (msg.includes("data: ")) {
                    const dataLine = msg.split("\n").find(line => line.startsWith("data: "));
                    if (dataLine) {
                        const rawData = dataLine.replace("data: ", "").trim();
                        if (rawData === "null") continue;

                        try {
                            const parsed = JSON.parse(rawData);
                            // Gradio's yield response is usually the first element of an array
                            const currentFullText = Array.isArray(parsed) ? parsed[0] : parsed;

                            if (currentFullText && currentFullText.length > lastText.length) {
                                // Print only the new part of the string
                                const newChars = currentFullText.slice(lastText.length);
                                process.stdout.write(newChars);
                                lastText = currentFullText;
                            }
                        } catch (e) {
                            // Ignore parsing errors for heartbeat/non-json lines
                        }
                    }
                }
            }
        }
        console.log("\n--- Finished ---");

    } catch (error) {
        console.error("\n[Error]:", error.message);
    }
}

runTutor();