const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage,
    delay
} = require('@whiskeysockets/baileys');
const readline = require('readline-sync');
const axios = require('axios');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ===== GROQ API CONFIG =====
const GROQ_API_KEY = "";

// Ensure Download directory exists for Saved/Deleted Media
const downloadDir = '/sdcard/Download/WA_Termux_Media';
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}

// Memory stores
const messageStore = new Map();
const DB_PATH = './bot_memory.json';
let db = { contacts: {}, groups: {} };

// Load persistent database
if (fs.existsSync(DB_PATH)) {
    try { 
        db = JSON.parse(fs.readFileSync(DB_PATH)); 
        if (!db.contacts) db.contacts = {};
        if (!db.groups) db.groups = {};
    } catch (e) {
        console.error("Error loading bot_memory.json, starting fresh.");
    }
}

function saveDB() {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ===== CONTACT & GROUP MEMORY MANAGER =====
function updateContactMemory(senderJid, pushName, groupJid = null) {
    const phoneNumber = senderJid.split('@')[0];
    
    if (!db.contacts[phoneNumber]) {
        db.contacts[phoneNumber] = {
            jid: senderJid,
            name: pushName || "Unknown",
            nickname: "",
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            notes: "",
            history: []
        };
    } else {
        if (pushName && pushName !== "Unknown") {
            db.contacts[phoneNumber].name = pushName;
        }
        db.contacts[phoneNumber].lastSeen = new Date().toISOString();
    }

    if (groupJid) {
        if (!db.groups[groupJid]) {
            db.groups[groupJid] = { members: {}, warnings: {} };
        }
        if (!db.groups[groupJid].members) db.groups[groupJid].members = {};
        
        db.groups[groupJid].members[phoneNumber] = {
            name: pushName || "Unknown",
            lastActive: new Date().toISOString()
        };
    }

    saveDB();
    return db.contacts[phoneNumber];
}

// ===== PYTHON BRIDGE ENGINE =====
function runPythonCommand(command) {
    return new Promise((resolve, reject) => {
        exec(`python3 -c "${command}"`, (error, stdout, stderr) => {
            if (error) reject(stderr || error.message);
            else resolve(stdout.trim());
        });
    });
}

// ===== REALISTIC HUMAN TYPING EMULATION =====
async function simulateHumanTyping(sock, jid, text) {
    const initialThinkTime = 2000 + Math.random() * 2000;
    await delay(initialThinkTime);

    await sock.sendPresenceUpdate('composing', jid);

    const charDelay = Math.max(text.length * (60 + Math.random() * 40), 2500);
    const totalTypingTime = Math.min(charDelay, 10000);

    if (Math.random() < 0.40 && text.length > 15) {
        await delay(totalTypingTime * 0.4);
        await sock.sendPresenceUpdate('paused', jid);
        await delay(1200 + Math.random() * 1000);
        await sock.sendPresenceUpdate('composing', jid);
        await delay(totalTypingTime * 0.6);
    } else {
        await delay(totalTypingTime);
    }

    await sock.sendPresenceUpdate('paused', jid);
}

// ===== GROQ TEXT AI ASSISTANT =====
async function getAIReply(senderJid, text, isGroup, ownerName, ownerNumber, pushName) {
    const contact = updateContactMemory(senderJid, pushName);
    const phoneNumber = senderJid.split('@')[0];

    contact.history.push(`User: ${text}`);
    if (contact.history.length > 10) contact.history.shift();

    const systemPrompt = `
You are an AI personal assistant managing WhatsApp messages on behalf of your boss/owner, whose name is ${ownerName}.

=== OWNER INFO ===
Owner Name: ${ownerName}
Owner Phone Number: +${ownerNumber}

=== PERSON YOU ARE TALKING TO ===
Name: ${contact.name}
Phone: +${phoneNumber}
First Met: ${new Date(contact.firstSeen).toDateString()}
${contact.nickname ? `Nickname/Role: ${contact.nickname}` : ""}
${contact.notes ? `Notes about this person: ${contact.notes}` : ""}

=== GREETING & IDENTIFICATION RULES ===
1. If this is the start of a conversation, or if someone asks who you are, what you are doing, or greetings like "hi", "hello", "who is this", ALWAYS state:
   "hi, this is ${ownerName}'s assistant speaking. what do you need?" (or a natural variation of this).
2. NEVER say your owner's name is "the owner". His actual name is ${ownerName}.

=== STRICT REALISM RULES ===
1. Keep replies SHORT and concise (1 to 2 sentences max by default).
2. Talk like a real assistant texting casually on WhatsApp.
3. NEVER sound like a rigid corporate robot.
4. If asked if you can see pictures or images, say YES—tell them to send it over!
`;

    try {
        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: contact.history.join('\n') }
                ],
                temperature: 0.75,
                max_tokens: 150
            },
            {
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        const reply = res.data?.choices?.[0]?.message?.content?.trim();
        if (!reply) throw new Error('Empty AI response');

        contact.history.push(`Assistant: ${reply}`);
        saveDB();
        return reply;

    } catch (err) {
        console.error('Groq AI Error:', err.message);
        return `my bad, had a slight network hitch. i am ${ownerName}'s assistant though—what were you saying?`;
    }
}

// ===== GROQ VISION AI (UPDATED CURRENT MODELS) =====
async function analyzeImageWithAI(imageBuffer, captionText, ownerName, senderJid, pushName) {
    const contact = updateContactMemory(senderJid, pushName);
    
    // Updated Groq Vision models (Active 2026 model IDs)
    const visionModels = [
        'llama-3.2-11b-vision-instruct',
        'meta-llama/llama-3.2-11b-vision-instruct',
        'llama-3.2-90b-vision-instruct'
    ];

    const base64Image = imageBuffer.toString('base64');
    const userPrompt = (captionText && captionText.trim() !== '') 
        ? captionText 
        : "Describe what is in this image naturally in 1-2 casual sentences.";

    for (const modelName of visionModels) {
        try {
            const res = await axios.post(
                'https://api.groq.com/openai/v1/chat/completions',
                {
                    model: modelName,
                    messages: [
                        {
                            role: 'user',
                            content: [
                                { 
                                    type: 'text', 
                                    text: `You are ${ownerName}'s WhatsApp assistant talking to ${contact.name}.\nPrompt: ${userPrompt}\n\nRule: Keep your reply short, natural, and direct (1 to 2 sentences max).` 
                                },
                                {
                                    type: 'image_url',
                                    image_url: {
                                        url: `data:image/jpeg;base64,${base64Image}`
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens: 200
                },
                {
                    headers: {
                        'Authorization': `Bearer ${GROQ_API_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const reply = res.data?.choices?.[0]?.message?.content?.trim();
            if (reply) return reply;
        } catch (err) {
            if (err.response) {
                console.error(`Groq Vision API Error (${modelName}):`, JSON.stringify(err.response.data, null, 2));
            } else {
                console.error(`Groq Vision API Error (${modelName}):`, err.message);
            }
        }
    }

    return "failed to process that picture. try sending it again?";
}

// ===== MAIN ENGINE =====
async function startSuperiorAssistant() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: Browsers.ubuntu('Chrome'),
        printQRInTerminal: false
    });

    if (!sock.authState.creds.registered) {
        console.log('\n========================================');
        console.log('    SUPERIOR AI ASSISTANT SETUP         ');
        console.log('========================================');
        const inputNumber = readline.question('Enter YOUR phone number with country code (e.g. 2349135615687): ');
        const cleanNumber = inputNumber.replace(/[^0-9]/g, '');

        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(cleanNumber);
                console.log(`\n===================================`);
                console.log(` YOUR PAIRING CODE: \x1b[32m${code}\x1b[0m`);
                console.log(`===================================\n`);
            } catch (err) {
                console.error('Failed to generate pairing code:', err);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Connection closed. Reconnecting...', shouldReconnect);
            if (shouldReconnect) startSuperiorAssistant();
        } else if (connection === 'open') {
            console.log('\x1b[36m%s\x1b[0m', '✅ WhatsApp Assistant Active!\n');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.remoteJid === 'status@broadcast') continue;

            const jid = msg.key.remoteJid;
            const msgId = msg.key.id;
            const isGroup = jid.endsWith('@g.us');
            const sender = isGroup ? (msg.key.participant || jid) : jid;
            const pushName = msg.pushName || "Unknown";
            const time = new Date(msg.messageTimestamp * 1000).toLocaleTimeString();

            updateContactMemory(sender, pushName, isGroup ? jid : null);

            // Determine Owner (Bot) details cleanly
            const botJid = sock.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : '';
            const botPhone = botJid.split('@')[0];
            const ownerName = sock.user?.name || pushName || botPhone;
            const isFromMe = msg.key.fromMe;

            const unwrapMessage = msg.message.viewOnceMessage?.message 
                               || msg.message.viewOnceMessageV2?.message 
                               || msg.message;

            const text = msg.message.conversation 
                      || msg.message.extendedTextMessage?.text 
                      || unwrapMessage?.imageMessage?.caption 
                      || "";
            const lowerText = text.toLowerCase().trim();

            // ===== OWNER COMMANDS =====
            if (isFromMe && text.startsWith('!')) {
                if (lowerText === '!memories') {
                    let memoryList = "*🧠 BOT MEMORY VAULT*\n\n";
                    const contacts = Object.keys(db.contacts);

                    if (contacts.length === 0) {
                        memoryList += "No contacts logged yet.";
                    } else {
                        contacts.forEach(phone => {
                            const c = db.contacts[phone];
                            memoryList += `👤 *${c.name}* (+${phone})\n`;
                            if (c.nickname) memoryList += `   🏷️ Role: ${c.nickname}\n`;
                            if (c.notes) memoryList += `   📝 Note: ${c.notes}\n`;
                            memoryList += `   🕒 Last Active: ${new Date(c.lastSeen).toLocaleTimeString()}\n\n`;
                        });
                    }

                    await simulateHumanTyping(sock, jid, memoryList);
                    return sock.sendMessage(jid, { text: memoryList });
                }

                if (lowerText.startsWith('!history ')) {
                    const phone = text.slice(9).trim().replace(/[^0-9]/g, '');

                    if (!db.contacts[phone]) {
                        return sock.sendMessage(jid, { text: `❌ Phone number +${phone} not found in memory.` });
                    }

                    const c = db.contacts[phone];
                    let historyOutput = `📜 *CHAT HISTORY FOR ${c.name.toUpperCase()} (+${phone})*\n\n`;

                    if (!c.history || c.history.length === 0) {
                        historyOutput += "No recent chat logs recorded.";
                    } else {
                        historyOutput += c.history.join('\n');
                    }

                    await simulateHumanTyping(sock, jid, historyOutput);
                    return sock.sendMessage(jid, { text: historyOutput });
                }

                if (lowerText.startsWith('!remember ')) {
                    const parts = text.slice(10).trim().split(' ');
                    const phone = parts[0].replace(/[^0-9]/g, '');
                    const note = parts.slice(1).join(' ');

                    if (!phone || !note) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!remember <number> <your note>`" });
                    }

                    if (!db.contacts[phone]) {
                        db.contacts[phone] = {
                            jid: `${phone}@s.whatsapp.net`,
                            name: "Saved Contact",
                            nickname: "",
                            firstSeen: new Date().toISOString(),
                            lastSeen: new Date().toISOString(),
                            notes: note,
                            history: []
                        };
                    } else {
                        db.contacts[phone].notes = note;
                    }

                    saveDB();
                    return sock.sendMessage(jid, { text: `✅ Saved note for +${phone}: "${note}"` });
                }
            }

            // ===== 1. DELETED MESSAGE DETECTOR =====
            if (msg.message.protocolMessage && msg.message.protocolMessage.type === 0) {
                const deletedId = msg.message.protocolMessage.key.id;
                const savedMsg = messageStore.get(deletedId);

                console.log(`\n\x1b[41m\x1b[37m 🚨 DELETED MESSAGE DETECTED! 🚨 \x1b[0m`);
                console.log(`\x1b[31mFrom:\x1b[0m ${pushName} (+${sender.split('@')[0]})`);
                console.log(`\x1b[31mTime:\x1b[0m ${time}`);

                if (savedMsg) {
                    if (savedMsg.isMedia) {
                        console.log(`\x1b[33mSender tried to delete a media file!\x1b[0m`);
                        console.log(`\x1b[32m📁 Saved copy location:\x1b[0m ${savedMsg.filePath}`);
                    } else {
                        console.log(`\x1b[33mDeleted Text:\x1b[0m "${savedMsg.text}"`);
                    }
                }
                console.log(`-----------------------------------------\n`);
                continue;
            }

            // ===== 2. AUTO-SAVE & UNWRAP MEDIA =====
            const mediaType = Object.keys(unwrapMessage).find(key => 
                ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage', 'ptvMessage'].includes(key)
            );

            let downloadedBuffer = null;

            if (mediaType) {
                let ext = 'bin';
                if (mediaType === 'imageMessage') ext = 'jpg';
                else if (mediaType === 'videoMessage' || mediaType === 'ptvMessage') ext = 'mp4';
                else if (mediaType === 'stickerMessage') ext = 'webp';
                else if (mediaType === 'audioMessage') ext = 'ogg';

                try {
                    downloadedBuffer = await downloadMediaMessage(
                        msg,
                        'buffer',
                        {},
                        { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }
                    );

                    const filename = `WA_${Date.now()}.${ext}`;
                    const filePath = path.join(downloadDir, filename);
                    fs.writeFileSync(filePath, downloadedBuffer);

                    messageStore.set(msgId, { isMedia: true, filePath });
                } catch (e) { }
            }

            if (text) messageStore.set(msgId, { isMedia: false, text });

            // ===== 3. DIRECT MESSAGES (DM MODE) =====
            if (!isGroup && !isFromMe) {
                if (unwrapMessage.imageMessage && downloadedBuffer) {
                    const visionReply = await analyzeImageWithAI(downloadedBuffer, text, ownerName, sender, pushName);
                    await simulateHumanTyping(sock, jid, visionReply);
                    return sock.sendMessage(jid, { text: visionReply });
                }

                if (/who is (your|the) owner|who (owns|runs) this/i.test(lowerText)) {
                    const reply = `hi, this is ${ownerName}'s assistant speaking. what do you need?`;
                    await simulateHumanTyping(sock, jid, reply);
                    return sock.sendMessage(jid, { text: reply });
                }

                if (lowerText.startsWith('!py ')) {
                    const pyCode = text.slice(4);
                    try {
                        const pyResult = await runPythonCommand(pyCode);
                        await simulateHumanTyping(sock, jid, pyResult);
                        return sock.sendMessage(jid, { text: pyResult });
                    } catch (err) {
                        return sock.sendMessage(jid, { text: `Python Error: ${err}` });
                    }
                }

                if (text) {
                    const aiReply = await getAIReply(sender, text, false, ownerName, botPhone, pushName);
                    await simulateHumanTyping(sock, jid, aiReply);
                    return sock.sendMessage(jid, { text: aiReply });
                }
            }

            // ===== 4. GROUP MODERATION & ACCURATE TAG/REPLY TRIGGER =====
            if (isGroup) {
                if (!db.groups[jid]) db.groups[jid] = { members: {}, warnings: {} };
                if (!db.groups[jid].warnings) db.groups[jid].warnings = {};

                // Check for links (WhatsApp group links or web URLs)
                const hasLink = /chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(text) || /https?:\/\/[^\s]+/i.test(text);

                if (hasLink) {
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
                        
                        // Rule 1: NEVER moderate or punish admins (including the bot/owner)
                        const isSenderAdmin = admins.includes(sender);

                        if (!isSenderAdmin) {
                            let isCurrentGroupLink = false;

                            // Check if the link matches THIS specific group's code
                            if (/chat\.whatsapp\.com\/[A-Za-z0-9]+/i.test(text)) {
                                try {
                                    const currentInviteCode = await sock.groupInviteCode(jid);
                                    if (currentInviteCode && text.includes(currentInviteCode)) {
                                        isCurrentGroupLink = true; // It's allowed!
                                    }
                                } catch (e) {
                                    // If bot isn't admin, it might fail to get invite code, proceed to safety check
                                }
                            }

                            // Rule 2: Delete & warn/kick ONLY if it's an EXTERNAL link
                            if (!isCurrentGroupLink) {
                                await sock.sendMessage(jid, { delete: msg.key });

                                const senderPhone = sender.split('@')[0];
                                const currentWarnings = (db.groups[jid].warnings[senderPhone] || 0) + 1;
                                db.groups[jid].warnings[senderPhone] = currentWarnings;
                                saveDB();

                                const isBotAdmin = admins.includes(botJid);

                                if (currentWarnings >= 3 && isBotAdmin) {
                                    await sock.groupParticipantsUpdate(jid, [sender], 'remove');
                                    await sock.sendMessage(jid, { text: `🚫 @${senderPhone} was removed for repeatedly sharing external links.`, mentions: [sender] });
                                } else {
                                    await sock.sendMessage(jid, { text: `⚠️ External links are not allowed here @${senderPhone}! Warning ${currentWarnings}/3`, mentions: [sender] });
                                }
                            }
                        }
                    } catch (err) {
                        console.error('Group moderation error:', err.message);
                    }
                }

                // COMPREHENSIVE GROUP TAG & QUOTE DETECTION
                const contextInfo = msg.message?.extendedTextMessage?.contextInfo 
                                 || msg.message?.imageMessage?.contextInfo
                                 || unwrapMessage?.imageMessage?.contextInfo;
                
                const mentionedJids = contextInfo?.mentionedJid || [];
                const quotedParticipant = contextInfo?.participant || "";

                const isMentioned = mentionedJids.some(id => id.includes(botPhone)) || text.includes(`@${botPhone}`);
                const isQuoted = quotedParticipant.includes(botPhone);

                if ((isMentioned || isQuoted) && !isFromMe) {
                    if (unwrapMessage.imageMessage && downloadedBuffer) {
                        const visionReply = await analyzeImageWithAI(downloadedBuffer, text, ownerName, sender, pushName);
                        await simulateHumanTyping(sock, jid, visionReply);
                        return sock.sendMessage(jid, { text: visionReply }, { quoted: msg });
                    }

                    if (text) {
                        const aiReply = await getAIReply(sender, text, true, ownerName, botPhone, pushName);
                        await simulateHumanTyping(sock, jid, aiReply);
                        return sock.sendMessage(jid, { text: aiReply }, { quoted: msg });
                    }
                }
            }
        }
    });
}

startSuperiorAssistant();
