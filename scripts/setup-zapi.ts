import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// 1. Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const instanceId = process.env.NEXT_PUBLIC_ZAPI_INSTANCE;
const token = process.env.ZAPI_TOKEN;
const clientToken = process.env.ZAPI_CLIENT_TOKEN;

async function setup() {
    const publicUrl = process.argv[2];
    if (!publicUrl) {
        console.log("\n🚀 FLASH Z-API SETUP");
        console.log("--------------------");
        console.log("How to run:");
        console.log("npx tsx scripts/setup-zapi.ts https://your-ngrok-url.io\n");
        process.exit(1);
    }

    if (!instanceId || !token) {
        console.error("❌ Error: Credentials (Instance/Token) not found in .env.local");
        process.exit(1);
    }

    const webhookUrl = `${publicUrl.replace(/\/$/, '')}/api/webhook/zapi`;
    
    console.log(`📡 Sending configuration to Z-API...`);
    console.log(`🔗 Webhook: ${webhookUrl}`);

    try {
        const url = `https://api.z-api.io/instances/${instanceId}/token/${token}/update-webhook-received`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Client-Token': clientToken || ''
            },
            body: JSON.stringify({ value: webhookUrl })
        });

        const data = await response.json();

        if (response.ok) {
            console.log("\n✅ SUCCESS! Webhook configured.");
            console.log("📱 You can now test !status on WhatsApp.");
        } else {
            console.log(`\n❌ ERROR ${response.status}:`, data);
        }
    } catch (error: any) {
        console.error(`\n💥 CONNECTION ERROR: ${error.message}`);
    }
}

setup();
