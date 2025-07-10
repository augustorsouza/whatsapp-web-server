const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode-terminal');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

app.use(express.json());

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox'],
    }
});

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above to log in.');
});

client.on('ready', () => {
    console.log('WhatsApp is ready!');
});

client.initialize();

app.post('/send-group-message', async (req, res) => {
    if (AUTH_TOKEN && req.headers['authorization'] !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    const { groupName, message } = req.body;
    if (!groupName || !message) {
        return res.status(400).json({ error: 'groupName and message required' });
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
});