import { Client } from "@gradio/client";
import fs from "node:fs/promises";

async function generateAndSave() {
    try {
        console.log("Connecting to CodeIgnite CPU Engine...");
        const client = await Client.connect("codeignite/whatsappbot");
        
        console.log("Sending prediction request (CPU Mode - Please wait ~60s)...");
        
        // Match the Python function: infer(prompt, seed, randomize_seed, width, height)
        const result = await client.predict("/predict", {       
            prompt: "Golden city, cinematic lighting, high resolution", 
            seed: 0, 
            randomize_seed: true, 
            width: 384, // 384 is the "sweet spot" for CPU RAM
            height: 384, 
        });

        console.log("Full Response Object:", JSON.stringify(result, null, 2));

        // The result usually comes back as an array in result.data
        if (result.data && result.data[0]) {
            const imageData = result.data[0];
            
            // Handle different Gradio return types (URL string vs Object)
            const imageUrl = typeof imageData === 'string' ? imageData : imageData.url;

            if (imageUrl) {
                console.log(`Downloading image from: ${imageUrl}`);
                const response = await fetch(imageUrl);
                const arrayBuffer = await response.arrayBuffer();
                const fileName = `output_${Date.now()}.png`; // CPU models usually output PNG/JPG
                
                await fs.writeFile(fileName, Buffer.from(arrayBuffer));
                console.log(`✅ Image saved successfully as ${fileName}!`);
            }
        } else {
            console.error("❌ No image data returned. Check the Space logs.");
        }

    } catch (error) {
        console.error("❌ Error encountered:");
        console.error(error.message);
    }
}

generateAndSave();