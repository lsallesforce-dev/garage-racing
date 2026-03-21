const fs = require('fs');
const https = require('https');
const path = require('path');

// 1. Ler .env.local manualmente para evitar dependências
const envPath = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
    console.error("❌ Erro: Arquivo .env.local não encontrado!");
    process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
    if (match) {
        let value = match[2].trim();
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        env[match[1]] = value;
    }
});

const instanceId = env.NEXT_PUBLIC_ZAPI_INSTANCE;
const token = env.ZAPI_TOKEN;
const clientToken = env.ZAPI_CLIENT_TOKEN;

async function setup() {
    const publicUrl = process.argv[2];
    if (!publicUrl) {
        console.log("\n🚀 FLASH Z-API SETUP");
        console.log("--------------------");
        console.log("Como rodar:");
        console.log("node scripts/setup-zapi.js https://sua-url-do-ngrok.io\n");
        process.exit(1);
    }

    if (!instanceId || !token) {
        console.error("❌ Erro: Credenciais (Instance/Token) não encontradas no .env.local");
        process.exit(1);
    }

    const webhookUrl = `${publicUrl.replace(/\/$/, '')}/api/webhook/zapi`;
    const payload = JSON.stringify({ value: webhookUrl });
    
    const options = {
        hostname: 'api.z-api.io',
        path: `/instances/${instanceId}/token/${token}/update-webhook-received`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
            'Client-Token': clientToken || ''
        }
    };

    console.log(`📡 Enviando configuração para Z-API...`);
    console.log(`🔗 Webhook: ${webhookUrl}`);

    const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            if (res.statusCode === 200 || res.statusCode === 201) {
                console.log("\n✅ SUCESSO! Webhook configurado.");
                console.log("📱 Agora você pode testar o !status no WhatsApp.");
            } else {
                console.log(`\n❌ ERRO ${res.statusCode}:`, data);
            }
        });
    });

    req.on('error', (e) => {
        console.error(`\n💥 ERRO DE CONEXÃO: ${e.message}`);
    });

    req.write(payload);
    req.end();
}

setup();
