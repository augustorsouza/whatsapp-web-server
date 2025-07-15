const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

app.use(express.json());

// State management
let whatsappReady = false;
let qrCodePath = null;

// Detect environment - simplified to just local vs docker
const isDockerEnv = process.env.RAILWAY_ENVIRONMENT_ID || 
                   process.env.RAILWAY_ENVIRONMENT || 
                   process.env.DOCKER_ENV || 
                   fs.existsSync('/.dockerenv');
const isLocal = !isDockerEnv;

// Get Chrome executable path based on environment
function getChromeExecutablePath() {
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    
    if (isDockerEnv) {
        return '/usr/bin/chromium';
    }
    
    // Local development - let Puppeteer find Chrome
    return undefined;
}

// Get Chrome args based on environment
function getChromeArgs() {
    const baseArgs = [
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--disable-gpu',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
    ];
    
    if (isDockerEnv) {
        // Docker environment flags (Railway, Docker, etc.) - aggressive optimization
        return [
            ...baseArgs,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--single-process',
            '--no-zygote',
            '--memory-pressure-off',
            '--max_old_space_size=4096',
            '--disable-ipc-flooding-protection',
            '--disable-hang-monitor',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--user-data-dir=/tmp/chrome-user-data',
            '--data-path=/tmp/chrome-data',
            '--disk-cache-dir=/tmp/chrome-cache',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-sync',
            '--aggressive-cache-discard',
            '--disable-background-networking',
            '--disable-prompt-on-repost',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-domain-reliability',
            '--disable-logging',
            '--silent',
            '--disable-breakpad',
        ];
    } else {
        // Local development flags - minimal and safe
        return [
            ...baseArgs,
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-component-update',
        ];
    }
}

console.log(`Environment detected: ${isLocal ? 'Local' : 'Docker'}`);
console.log(`Chrome executable: ${getChromeExecutablePath() || 'Auto-detected'}`);

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: './data'
    }),
    puppeteer: {
        executablePath: getChromeExecutablePath(),
        args: getChromeArgs(),
        headless: true,
        ...(isDockerEnv ? {
            // Docker environment settings
            defaultViewport: null,
            protocolTimeout: 240000,
            timeout: 0,
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false,
        } : {
            // Local development settings
            defaultViewport: null,
            protocolTimeout: 30000,
            timeout: 30000,
        })
    }
});

client.on('qr', async (qr) => {
    try {
        // Generate QR code as PNG
        qrCodePath = path.join(__dirname, 'qr-code.png');
        await qrcode.toFile(qrCodePath, qr);
        console.log('QR code generated. Access it at: /qr');
    } catch (error) {
        console.error('Error generating QR code:', error);
    }
});

client.on('ready', () => {
    console.log('WhatsApp is ready!');
    whatsappReady = true;
    
    // Clean up QR code file
    if (qrCodePath && fs.existsSync(qrCodePath)) {
        fs.unlinkSync(qrCodePath);
        qrCodePath = null;
    }
});

client.on('disconnected', (reason) => {
    console.log('Client was logged out:', reason);
    whatsappReady = false;
    qrCodePath = null;
});

client.initialize();

// QR Code endpoint
app.get('/qr', (req, res) => {
    if (whatsappReady) {
        res.send('WhatsApp is ready!');
    } else if (qrCodePath && fs.existsSync(qrCodePath)) {
        res.sendFile(qrCodePath);
    } else {
        res.send('QR code is being generated... Please refresh in a moment.');
    }
});

// Status endpoint
app.get('/status', (req, res) => {
    res.json({
        ready: whatsappReady,
        qrAvailable: qrCodePath && fs.existsSync(qrCodePath)
    });
});

app.post('/send-group-message', async (req, res) => {
    const timestamp = new Date().toISOString();
    const requestId = Math.random().toString(36).substring(2, 11);
    
    console.log(`[${timestamp}] [${requestId}] POST /send-group-message - Request received`);
    
    // Log request details (without sensitive data)
    const { groupName, groupId, message } = req.body;
    console.log(`[${timestamp}] [${requestId}] Request details: groupName="${groupName}", groupId="${groupId}", messageLength=${message?.length || 0}`);
    
    // Authorization check
    if (AUTH_TOKEN && req.headers['authorization'] !== `Bearer ${AUTH_TOKEN}`) {
        console.log(`[${timestamp}] [${requestId}] Authorization failed - Invalid or missing token`);
        return res.status(403).json({ error: 'Unauthorized' });
    }
    console.log(`[${timestamp}] [${requestId}] Authorization successful`);

    // Request validation
    if ((!groupName && !groupId) || !message) {
        console.log(`[${timestamp}] [${requestId}] Validation failed - Missing required fields: groupName=${!!groupName}, groupId=${!!groupId}, message=${!!message}`);
        return res.status(400).json({ error: 'Either groupName or groupId is required, along with message' });
    }
    
    if (groupName && groupId) {
        console.log(`[${timestamp}] [${requestId}] Validation warning - Both groupName and groupId provided, using groupId for efficiency`);
    }
    
    console.log(`[${timestamp}] [${requestId}] Request validation successful`);

    // WhatsApp readiness check
    if (!whatsappReady) {
        console.log(`[${timestamp}] [${requestId}] WhatsApp not ready - Client needs to scan QR code`);
        return res.status(503).json({ error: 'WhatsApp is not ready. Please scan the QR code first.' });
    }
    console.log(`[${timestamp}] [${requestId}] WhatsApp client is ready`);

    try {
        let targetGroupId;
        let targetGroupName;
        
        if (groupId) {
            // Direct approach using groupId - much faster
            console.log(`[${timestamp}] [${requestId}] Using direct groupId approach: "${groupId}"`);
            targetGroupId = groupId;
            targetGroupName = groupName || 'Unknown'; // Use provided name or fallback
            
            console.log(`[${timestamp}] [${requestId}] Sending message directly to group ID: ${targetGroupId}`);
            
        } else {
            // Fallback approach using groupName - requires fetching chats
            console.log(`[${timestamp}] [${requestId}] Using groupName approach, fetching chats...`);
            const chats = await client.getChats();
            console.log(`[${timestamp}] [${requestId}] Retrieved ${chats.length} chats`);
            
            console.log(`[${timestamp}] [${requestId}] Searching for group: "${groupName}"`);
            const group = chats.find(chat => chat.isGroup && chat.name === groupName);
            
            if (!group) {
                const availableGroups = chats.filter(chat => chat.isGroup).map(chat => chat.name);
                console.log(`[${timestamp}] [${requestId}] Group not found: "${groupName}". Available groups: [${availableGroups.join(', ')}]`);
                return res.status(404).json({ error: 'Group not found' });
            }
            
            targetGroupId = group.id._serialized;
            targetGroupName = group.name;
            console.log(`[${timestamp}] [${requestId}] Group found: "${targetGroupName}" (ID: ${targetGroupId})`);
        }
        
        console.log(`[${timestamp}] [${requestId}] Sending message to group...`);
        await client.sendMessage(targetGroupId, message);
        
        console.log(`[${timestamp}] [${requestId}] Message sent successfully to group "${targetGroupName}" (ID: ${targetGroupId})`);
        res.json({ 
            success: true, 
            requestId, 
            timestamp,
            groupId: targetGroupId,
            groupName: targetGroupName
        });
        
    } catch (err) {
        console.error(`[${timestamp}] [${requestId}] Error sending message:`, {
            error: err.message,
            stack: err.stack,
            groupName,
            groupId,
            messageLength: message?.length || 0
        });
        res.status(500).json({ 
            error: 'Failed to send message', 
            requestId, 
            timestamp,
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`QR code will be available at: http://localhost:${port}/qr`);
});

// Graceful shutdown handler
async function gracefulShutdown(signal) {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
    
    try {
        // Stop accepting new connections
        console.log('Closing HTTP server...');
        server.close(() => {
            console.log('HTTP server closed');
        });
        
        // Clean up QR code file
        if (qrCodePath && fs.existsSync(qrCodePath)) {
            fs.unlinkSync(qrCodePath);
            console.log('QR code file cleaned up');
        }
        
        // Disconnect WhatsApp client
        if (client) {
            console.log('Disconnecting WhatsApp client...');
            await client.destroy();
            console.log('WhatsApp client disconnected');
        }
        
        console.log('Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        console.error('Error during graceful shutdown:', error);
        process.exit(1);
    }
}

// Handle termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    gracefulShutdown('unhandledRejection');
});