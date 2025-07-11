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

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
        headless: true,
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
    if (AUTH_TOKEN && req.headers['authorization'] !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { groupName, message } = req.body;
    if (!groupName || !message) {
        return res.status(400).json({ error: 'groupName and message required' });
    }

    if (!whatsappReady) {
        return res.status(503).json({ error: 'WhatsApp is not ready. Please scan the QR code first.' });
    }

    try {
        const chats = await client.getChats();
        const group = chats.find(chat => chat.isGroup && chat.name === groupName);
        if (!group) {
            return res.status(404).json({ error: 'Group not found' });
        }
        await client.sendMessage(group.id._serialized, message);
        res.json({ success: true });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`QR code will be available at: http://localhost:${port}/qr`);
});