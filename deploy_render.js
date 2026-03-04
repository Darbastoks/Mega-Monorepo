const https = require('https');

const API_KEY = 'rnd_qjpg7OXuFJcTj6DPoXRtjkB12CrT';
const OWNER_ID = 'tea-d6f2hon5r7bs738g3m60';

const data = JSON.stringify({
    type: "web_service",
    name: "Velora-Mega-Server",
    ownerId: OWNER_ID,
    repo: "https://github.com/Darbastoks/Mega-Monorepo",
    autoDeploy: "yes",
    branch: "main",
    serviceDetails: {
        env: "node",
        plan: "free",
        envSpecificDetails: {
            buildCommand: "npm install",
            startCommand: "npm start"
        }
    }
});

const options = {
    hostname: 'api.render.com',
    port: 443,
    path: '/v1/services',
    method: 'POST',
    headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
    }
};

const req = https.request(options, res => {
    let response = '';
    res.on('data', d => response += d);
    res.on('end', () => console.log(`Created Velora-Mega-Server Response:`, response));
});
req.write(data);
req.end();
