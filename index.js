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
let client = null;
let isRestarting = false;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;

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

// Get Chrome args based on environment - IMPROVED for Railway stability
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
        // Railway/Docker optimized flags - removed problematic --single-process
        return [
            ...baseArgs,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--memory-pressure-off',
            '--max_old_space_size=2048', // Reduced from 4096
            '--disable-ipc-flooding-protection',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--user-data-dir=/tmp/chrome-user-data',
            '--data-path=/tmp/chrome-data',
            '--disk-cache-dir=/tmp/chrome-cache',
            '--disable-extensions',
            '--disable-plugins',
            '--disable-sync',
            '--disable-background-networking',
            '--disable-prompt-on-repost',
            '--disable-client-side-phishing-detection',
            '--disable-component-update',
            '--disable-domain-reliability',
            '--disable-logging',
            '--disable-breakpad',
            // Additional stability flags
            '--disable-dev-tools',
            '--disable-crash-reporter',
            '--no-crash-upload',
            '--disable-gpu-crashpad',
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

// Create WhatsApp client with improved error handling
function createWhatsAppClient() {
    console.log(`Creating WhatsApp client... (Attempt ${restartAttempts + 1}/${MAX_RESTART_ATTEMPTS})`);
    console.log(`Environment detected: ${isLocal ? 'Local' : 'Docker'}`);
    console.log(`Chrome executable: ${getChromeExecutablePath() || 'Auto-detected'}`);

    const newClient = new Client({
        authStrategy: new LocalAuth({
            dataPath: './data'
        }),
        puppeteer: {
            executablePath: getChromeExecutablePath(),
            args: getChromeArgs(),
            headless: true,
            ...(isDockerEnv ? {
                // Docker environment settings - improved timeouts
                defaultViewport: null,
                protocolTimeout: 180000, // Reduced from 240000
                timeout: 60000, // Set reasonable timeout instead of 0
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

    // Event handlers
    newClient.on('qr', async (qr) => {
        try {
            qrCodePath = path.join(__dirname, 'qr-code.png');
            await qrcode.toFile(qrCodePath, qr);
            console.log('QR code generated. Access it at: /qr');
        } catch (error) {
            console.error('Error generating QR code:', error);
        }
    });

    newClient.on('ready', () => {
        console.log('WhatsApp is ready!');
        whatsappReady = true;
        restartAttempts = 0; // Reset restart attempts on successful connection
        
        // Clean up QR code file
        if (qrCodePath && fs.existsSync(qrCodePath)) {
            fs.unlinkSync(qrCodePath);
            qrCodePath = null;
        }
    });

    newClient.on('disconnected', (reason) => {
        console.log('Client was logged out:', reason);
        whatsappReady = false;
        qrCodePath = null;
        
        // Auto-restart if not intentionally disconnected and within retry limits
        if (!isRestarting && restartAttempts < MAX_RESTART_ATTEMPTS) {
            console.log('Attempting to restart WhatsApp client...');
            setTimeout(() => restartWhatsAppClient(), 5000); // Wait 5s before restart
        }
    });

    // Handle authentication failure
    newClient.on('auth_failure', (msg) => {
        console.error('Authentication failure:', msg);
        whatsappReady = false;
    });

    return newClient;
}

// Restart WhatsApp client function
async function restartWhatsAppClient() {
    if (isRestarting) {
        console.log('Restart already in progress, skipping...');
        return;
    }

    isRestarting = true;
    restartAttempts++;
    
    console.log(`Restarting WhatsApp client (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
    
    try {
        // Destroy old client
        if (client) {
            await client.destroy();
        }
        
        // Create new client
        client = createWhatsAppClient();
        await client.initialize();
        
        console.log('WhatsApp client restart initiated');
    } catch (error) {
        console.error('Error restarting WhatsApp client:', error);
        
        if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
            console.error('Max restart attempts reached. Manual intervention required.');
        }
    } finally {
        isRestarting = false;
    }
}

// Initialize WhatsApp client
client = createWhatsAppClient();
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

// Status endpoint with more detailed info
app.get('/status', (req, res) => {
    res.json({
        ready: whatsappReady,
        qrAvailable: qrCodePath && fs.existsSync(qrCodePath),
        isRestarting: isRestarting,
        restartAttempts: restartAttempts,
        maxRestartAttempts: MAX_RESTART_ATTEMPTS
    });
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        whatsappReady: whatsappReady,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// IMPROVED send-group-message with better error handling
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

    // WhatsApp readiness check with restart option
    if (!whatsappReady) {
        console.log(`[${timestamp}] [${requestId}] WhatsApp not ready - Current state: ready=${whatsappReady}, restarting=${isRestarting}`);
        
        // If not currently restarting and we haven't hit max attempts, try restart
        if (!isRestarting && restartAttempts < MAX_RESTART_ATTEMPTS) {
            console.log(`[${timestamp}] [${requestId}] Attempting to restart WhatsApp client...`);
            restartWhatsAppClient(); // Don't await, let it run in background
        }
        
        return res.status(503).json({ 
            error: 'WhatsApp is not ready. Please scan the QR code or wait for automatic restart.',
            isRestarting: isRestarting,
            restartAttempts: restartAttempts
        });
    }
    console.log(`[${timestamp}] [${requestId}] WhatsApp client is ready`);

    // Retry mechanism for the message sending
    const MAX_SEND_RETRIES = 2;
    let sendAttempts = 0;
    
    while (sendAttempts < MAX_SEND_RETRIES) {
        sendAttempts++;
        
        try {
            let targetGroupId;
            let targetGroupName;
            
            if (groupId) {
                // Direct approach using groupId - much faster
                console.log(`[${timestamp}] [${requestId}] Using direct groupId approach: "${groupId}" (attempt ${sendAttempts})`);
                targetGroupId = groupId;
                targetGroupName = groupName || 'Unknown';
                
                console.log(`[${timestamp}] [${requestId}] Sending message directly to group ID: ${targetGroupId}`);
                
            } else {
                // Fallback approach using groupName - requires fetching chats
                console.log(`[${timestamp}] [${requestId}] Using groupName approach, fetching chats... (attempt ${sendAttempts})`);
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
            
            console.log(`[${timestamp}] [${requestId}] Sending message to group... (attempt ${sendAttempts})`);
            await client.sendMessage(targetGroupId, message);
            
            console.log(`[${timestamp}] [${requestId}] Message sent successfully to group "${targetGroupName}" (ID: ${targetGroupId})`);
            return res.json({ 
                success: true, 
                requestId, 
                timestamp,
                groupId: targetGroupId,
                groupName: targetGroupName,
                attempts: sendAttempts
            });
            
        } catch (err) {
            console.error(`[${timestamp}] [${requestId}] Error sending message (attempt ${sendAttempts}):`, {
                error: err.message,
                stack: err.stack,
                groupName,
                groupId,
                messageLength: message?.length || 0
            });
            
            // Check if it's a browser/session closed error
            const isBrowserError = err.message.includes('Session closed') || 
                                 err.message.includes('Protocol error') ||
                                 err.message.includes('Target closed');
            
            if (isBrowserError) {
                console.log(`[${timestamp}] [${requestId}] Browser session error detected. Marking client as not ready.`);
                whatsappReady = false;
                
                // Trigger restart for next requests
                if (!isRestarting && restartAttempts < MAX_RESTART_ATTEMPTS) {
                    console.log(`[${timestamp}] [${requestId}] Triggering client restart due to browser error...`);
                    setTimeout(() => restartWhatsAppClient(), 1000);
                }
                
                // If this was our last attempt or first attempt with browser error, return error
                if (sendAttempts >= MAX_SEND_RETRIES || sendAttempts === 1) {
                    return res.status(503).json({ 
                        error: 'Browser session was closed. WhatsApp client is restarting.', 
                        requestId, 
                        timestamp,
                        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
                        willRetry: restartAttempts < MAX_RESTART_ATTEMPTS
                    });
                }
                
                // Break retry loop for browser errors - no point retrying immediately
                break;
            }
            
            // For non-browser errors, continue with retries
            if (sendAttempts >= MAX_SEND_RETRIES) {
                return res.status(500).json({ 
                    error: 'Failed to send message after retries', 
                    requestId, 
                    timestamp,
                    attempts: sendAttempts,
                    details: process.env.NODE_ENV === 'development' ? err.message : undefined
                });
            }
            
            // Wait a bit before retry
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
});

// Restart endpoint for manual recovery
app.post('/restart', async (req, res) => {
    if (AUTH_TOKEN && req.headers['authorization'] !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    
    if (isRestarting) {
        return res.json({ message: 'Restart already in progress' });
    }
    
    console.log('Manual restart requested via API');
    restartAttempts = 0; // Reset attempts for manual restart
    restartWhatsAppClient();
    
    res.json({ message: 'WhatsApp client restart initiated' });
});

const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`QR code will be available at: http://localhost:${port}/qr`);
    console.log(`Health check available at: http://localhost:${port}/health`);
});

// Graceful shutdown handler (unchanged)
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