const fs = require('fs');
const path = require('path');
const https = require('https');

const API_KEY = 'AIzaSyDnuk-v_HFzb9LU8VOhfkS2u8LZ3weLOzk';
const OUTPUT_DIR = path.join(__dirname, 'public', 'website', 'images');

const prompts = [
    {
        file: 'moderni-svetaine.png',
        prompt: 'A photorealistic screenshot of a premium modern dark-themed beauty salon website displayed on a MacBook Pro screen. The website shows a sleek hero section with a beautiful salon interior photo, elegant serif typography, cyan accent colors on dark navy background, navigation bar at top, and a Book Now button. Professional high-end web design. Studio lighting, clean composition.'
    },
    {
        file: 'online-registracija.png',
        prompt: 'A photorealistic screenshot of an online booking calendar interface for a beauty salon displayed on a tablet screen. Clean date picker with available time slots highlighted in cyan teal color on dark background, service selection dropdown, client name and phone fields, and a Confirm Booking button. Modern UI design with rounded corners and subtle shadows. Sleek professional look.'
    },
    {
        file: 'google-maps.png',
        prompt: 'A photorealistic screenshot of a salon website section showing an embedded Google Maps view on a dark-themed website. The map shows a location pin marker on a city street. Below the map there is the salon address, phone number, and working hours in clean white text on dark navy background with cyan accent colors. Modern web design.'
    },
    {
        file: 'svetaines-prieziura.png',
        prompt: 'A photorealistic screenshot of a website maintenance dashboard on a monitor screen. Dashboard showing website analytics graphs, uptime status with green indicators, recent updates list, content management panel, and performance metrics. Clean dark-themed UI with cyan teal accent colors. Professional monitoring dashboard design.'
    }
];

function generateWithImagen(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            instances: [{ prompt }],
            parameters: {
                sampleCount: 1,
                aspectRatio: '16:9',
                outputOptions: { mimeType: 'image/png' }
            }
        });

        const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${API_KEY}`);

        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(`API Error: ${json.error.message}`));
                        return;
                    }
                    const prediction = json.predictions?.[0];
                    if (prediction?.bytesBase64Encoded) {
                        resolve(Buffer.from(prediction.bytesBase64Encoded, 'base64'));
                    } else {
                        reject(new Error('No image in response: ' + data.substring(0, 500)));
                    }
                } catch (e) {
                    reject(new Error('Parse error: ' + e.message + ' — ' + data.substring(0, 300)));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// Fallback: try gemini-2.0-flash generateContent with image output
function generateWithGeminiFlash(prompt) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"],
                temperature: 0.4
            }
        });

        const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`);

        const options = {
            hostname: url.hostname,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        reject(new Error(`API Error: ${json.error.message}`));
                        return;
                    }
                    const parts = json.candidates?.[0]?.content?.parts;
                    if (!parts) {
                        reject(new Error('No parts in response: ' + data.substring(0, 500)));
                        return;
                    }
                    const imagePart = parts.find(p => p.inlineData);
                    if (imagePart) {
                        resolve(Buffer.from(imagePart.inlineData.data, 'base64'));
                    } else {
                        reject(new Error('No image in response. Text: ' + (parts[0]?.text || 'none')));
                    }
                } catch (e) {
                    reject(new Error('Parse error: ' + e.message + ' — ' + data.substring(0, 300)));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function main() {
    // Try Imagen 4.0 first, then fall back to Gemini Flash
    const models = [
        { name: 'imagen-4.0-generate-001', fn: generateWithImagen },
        { name: 'imagen-4.0-fast-generate-001', fn: (p) => {
            // Same as Imagen but different model
            return new Promise((resolve, reject) => {
                const body = JSON.stringify({
                    instances: [{ prompt: p }],
                    parameters: { sampleCount: 1, aspectRatio: '16:9' }
                });
                const url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${API_KEY}`);
                const options = {
                    hostname: url.hostname,
                    path: url.pathname + url.search,
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
                };
                const req = https.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            if (json.error) { reject(new Error(json.error.message)); return; }
                            const pred = json.predictions?.[0];
                            if (pred?.bytesBase64Encoded) resolve(Buffer.from(pred.bytesBase64Encoded, 'base64'));
                            else reject(new Error('No image'));
                        } catch(e) { reject(e); }
                    });
                });
                req.on('error', reject);
                req.write(body);
                req.end();
            });
        }},
        { name: 'gemini-2.0-flash', fn: generateWithGeminiFlash },
    ];

    // Test which model works first
    let workingModel = null;
    for (const model of models) {
        console.log(`Testing model: ${model.name}...`);
        try {
            const testImg = await model.fn('A simple blue circle on white background');
            console.log(`  Model ${model.name} works! (${(testImg.length/1024).toFixed(0)} KB)`);
            workingModel = model;
            break;
        } catch (err) {
            console.log(`  ${model.name} failed: ${err.message.substring(0, 100)}`);
        }
    }

    if (!workingModel) {
        console.error('\nNo working image generation model found. Check your API key and billing.');
        process.exit(1);
    }

    console.log(`\nUsing model: ${workingModel.name}\n`);

    for (const item of prompts) {
        const outPath = path.join(OUTPUT_DIR, item.file);
        console.log(`Generating: ${item.file}...`);
        try {
            const imgBuffer = await workingModel.fn(item.prompt);
            fs.writeFileSync(outPath, imgBuffer);
            console.log(`  Saved: ${item.file} (${(imgBuffer.length / 1024).toFixed(0)} KB)`);
        } catch (err) {
            console.error(`  FAILED: ${err.message}`);
        }
        // Small delay between requests to avoid rate limiting
        await new Promise(r => setTimeout(r, 2000));
    }
    console.log('\nDone!');
}

main();
