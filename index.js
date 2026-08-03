const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers,
    downloadMediaMessage,
    delay,
} = require('@whiskeysockets/baileys');

const readline = require('readline-sync');
const axios = require('axios');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const FormData = require('form-data');

// ===== API CONFIGURATIONS =====
const GROQ_API_KEY = "";
const OPENROUTER_API_KEY = ""; 

// Ensure Download directory exists for Saved/Deleted Media & Audio
const downloadDir = './WA_Termux_Media';
if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true });
}

// Memory stores
const messageStore = new Map();
const DB_PATH = './bot_memory.json';
let db = { 
    contacts: {}, 
    groups: {},
    settings: {
        botActive: true,
        voiceMode: false,
        businessActive: false,
        businessInfo: "",
        pricesInfo: "",
        locationInfo: "",
        customOwnerName: ""
    }
};

// Load persistent database
if (fs.existsSync(DB_PATH)) {
    try { 
        db = JSON.parse(fs.readFileSync(DB_PATH)); 
        if (!db.contacts) db.contacts = {};
        if (!db.groups) db.groups = {};
        if (!db.settings) {
            db.settings = {
                botActive: true,
                voiceMode: false,
                businessActive: false,
                businessInfo: "",
                pricesInfo: "",
                locationInfo: "",
                customOwnerName: ""
            };
        }
    } catch (e) {
        console.error("Error loading bot_memory.json, starting fresh.");
    }
}

function saveDB() {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// Helper: Extract clean phone number
function extractPhoneNumber(jid) {
    if (!jid) return '';
    return jid.split('@')[0].split(':')[0];
}

// Helper: Normalize JID to standard format
function normalizeJid(jid) {
    if (!jid) return '';
    const phone = extractPhoneNumber(jid);
    return `${phone}@s.whatsapp.net`;
}

// ===== CONTACT & GROUP MEMORY MANAGER (FIXED) =====
function updateContactMemory(senderJid, pushName, groupJid = null) {
    const phoneNumber = extractPhoneNumber(senderJid);
    
    const cleanPushName = (!pushName || pushName === "Hancock" || pushName === "Unknown") ? `User +${phoneNumber}` : pushName;
    
    if (!db.contacts[phoneNumber]) {
        db.contacts[phoneNumber] = {
            jid: normalizeJid(senderJid),
            name: cleanPushName,
            nickname: "",
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            notes: "",
            history: []
        };
    } else {
        if (cleanPushName && cleanPushName !== `User +${phoneNumber}`) {
            db.contacts[phoneNumber].name = cleanPushName;
        }
        db.contacts[phoneNumber].lastSeen = new Date().toISOString();
    }

    if (groupJid) {
        if (!db.groups[groupJid]) {
            db.groups[groupJid] = { members: {}, warnings: {} };
        }
        if (!db.groups[groupJid].members) db.groups[groupJid].members = {};
        
        db.groups[groupJid].members[phoneNumber] = {
            name: cleanPushName || "Unknown",
            lastActive: new Date().toISOString()
        };
    }

    saveDB();
    return db.contacts[phoneNumber];
}

// ===== PYTHON & TERMUX SYSTEM BRIDGE ENGINE =====
function runSystemCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) reject(stderr || error.message);
            else resolve(stdout.trim());
        });
    });
}

// ===== TEXT-TO-SPEECH GENERATOR ENGINE (ESPEAK / WAV TO OGG) =====
async function generateAudioResponse(text) {
    const wavPath = path.join(downloadDir, `tts_${Date.now()}.wav`);
    const oggPath = path.join(downloadDir, `tts_${Date.now()}.ogg`);
    
    const safeText = text.replace(/["'`]/g, '');

    return new Promise((resolve, reject) => {
        exec(`espeak "${safeText}" -w "${wavPath}" && ffmpeg -i "${wavPath}" -c:a libopus "${oggPath}" -y`, (err) => {
            if (fs.existsSync(wavPath)) fs.unlinkSync(wavPath);
            if (err || !fs.existsSync(oggPath)) {
                reject("Audio conversion failed");
            } else {
                resolve(oggPath);
            }
        });
    });
}

// ===== GROQ WHISPER VOICE TRANSCRIBER ENGINE =====
async function transcribeAudio(audioBuffer) {
    const tempAudioPath = path.join(downloadDir, `audio_in_${Date.now()}.ogg`);
    try {
        fs.writeFileSync(tempAudioPath, audioBuffer);

        const formData = new FormData();
        formData.append('file', fs.createReadStream(tempAudioPath), {
            filename: 'voice_message.ogg',
            contentType: 'audio/ogg',
        });
        formData.append('model', 'whisper-large-v3-turbo');

        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${GROQ_API_KEY}`
            }
        });

        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        return res.data?.text || "";
    } catch (err) {
        console.error("Whisper Transcription Error:", err.response?.data || err.message);
        if (fs.existsSync(tempAudioPath)) fs.unlinkSync(tempAudioPath);
        return "";
    }
}

// ===== REALISTIC HUMAN TYPING EMULATION =====
async function simulateHumanTyping(sock, jid, text) {
    const initialThinkTime = 1200 + Math.random() * 1000;
    await delay(initialThinkTime);

    if (db.settings.voiceMode) {
        await sock.sendPresenceUpdate('recording', jid);
    } else {
        await sock.sendPresenceUpdate('composing', jid);
    }

    const charDelay = Math.max(text.length * (40 + Math.random() * 20), 1500);
    const totalTypingTime = Math.min(charDelay, 6000);

    await delay(totalTypingTime);
    await sock.sendPresenceUpdate('paused', jid);
}

// ===== GROQ TEXT AI ASSISTANT (DYNAMIC BUSINESS & LOCATION AWARENESS) =====
async function getAIReply(senderJid, text, isGroup, ownerName, ownerNumber, pushName) {
    const contact = updateContactMemory(senderJid, pushName);
    const phoneNumber = extractPhoneNumber(senderJid);

    contact.history.push({ role: 'user', content: text });
    if (contact.history.length > 10) contact.history.shift();

    let businessPromptSection = "";
    if (db.settings.businessActive && db.settings.businessInfo) {
        businessPromptSection += `\n=== OWNER BUSINESS PROFILE ===\n${ownerName} runs/operates: "${db.settings.businessInfo}".`;
    }
    if (db.settings.businessActive && db.settings.pricesInfo) {
        businessPromptSection += `\n=== PRICING & PRODUCTS ===\n${db.settings.pricesInfo}`;
    }
    if (db.settings.locationInfo) {
        businessPromptSection += `\n=== LOCATION INFO ===\n${ownerName} / The Business is located at: "${db.settings.locationInfo}".`;
    }

    const systemPrompt = `
You are an AI personal assistant managing WhatsApp messages on behalf of your boss/owner, whose name is ${ownerName}.

=== OWNER INFO ===
Owner Name: ${ownerName}
Owner Phone Number: +${ownerNumber}
${businessPromptSection}

=== PERSON YOU ARE TALKING TO ===
Name: ${contact.name}
Phone: +${phoneNumber}
First Met: ${new Date(contact.firstSeen).toDateString()}
${contact.nickname ? `Role/Nickname: ${contact.nickname}` : ""}
${contact.notes ? `Notes/Relationship to Owner: ${contact.notes}` : ""}

=== EMOTIONAL HEART ENGINE ===
Read the user's message and gauge their emotion:
- Angry/Pissed: Be calm, concise, and non-confrontational.
- Happy/Excited: Match their light energy casually.
- Sad/Down: Show brief, natural empathy without sounding overly dramatic.
- Funny/Playful: Throw back a short, witty response.

=== SYSTEM AWARENESS & RULES ===
1. You have a background memory vault system where all conversation details are saved.
2. Whenever you tell a caller or contact "I'll let him know", "I'll tell him", or "I've noted this down", know that ${ownerName} can instantly pull up your exact logs via internal commands.
3. STRICT BUSINESS RULE: ONLY bring up business, services, pricing, or location IF the contact explicitly asks about them (e.g., "Where are you located?", "What do you sell?", "How much is X?"). Otherwise, act strictly as a casual personal assistant.

=== OUTPUT STRICT RULES ===
1. NEVER output prefix labels like "User:", "Assistant:", or "AI:". Output ONLY the response message itself!
2. Keep all responses natural, casual, and brief (1 to 2 short sentences max).
3. If greeting or asked who you are, state naturally: "hi, this is ${ownerName}'s assistant speaking. what do you need?"
4. Never sound like a rigid corporate script.
`;

    const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...contact.history.map(item => ({
            role: item.role === 'user' ? 'user' : 'assistant',
            content: item.content
        }))
    ];

    try {
        const res = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama-3.1-8b-instant',
                messages: apiMessages,
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

        let reply = res.data?.choices?.[0]?.message?.content?.trim();
        if (!reply) throw new Error('Empty AI response');

        reply = reply.replace(/^(User|Assistant|AI):\s*/i, '').trim();

        contact.history.push({ role: 'assistant', content: reply });
        saveDB();
        return reply;

    } catch (err) {
        console.error('Groq AI Error:', err.message);
        return `my bad, had a slight network hitch. i am ${ownerName}'s assistant though—what were you saying?`;
    }
}

// ===== VISION AI ENGINE =====
async function analyzeImageWithAI(imageBuffer, captionText, ownerName, senderJid, pushName, mimeType = "image/jpeg") {
    const contact = updateContactMemory(senderJid, pushName);
    const userPrompt = (captionText && captionText.trim() !== '') 
        ? captionText 
        : "Describe what is in this image naturally in 1-2 casual sentences.";

    try {
        const promptText = `You are ${ownerName}'s WhatsApp assistant talking to ${contact.name}.\nPrompt: ${userPrompt}\n\nRule: Keep your reply short, natural, direct, and under 2 sentences. DO NOT include prefixes.`;
        const base64Image = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;

        const res = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: 'openrouter/free', 
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: promptText },
                            { type: 'image_url', image_url: { url: base64Image } }
                        ]
                    }
                ],
                max_tokens: 150,
                temperature: 0.7
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://localhost:3000', 
                    'X-Title': 'Termux_WABot_Assistant'
                }
            }
        );

        let reply = res.data?.choices?.[0]?.message?.content?.trim();
        
        if (reply && reply.length > 0) {
            reply = reply.replace(/^(User|Assistant|AI):\s*/i, '').trim();

            if (reply.includes("User Safety:") || reply.includes("Safety Categories:")) {
                reply = "i saw the picture, but the vision filter flagged it by mistake. try sending another angle or object!";
            }

            contact.history.push({ role: 'user', content: `[Sent an image with caption: "${userPrompt}"]` });
            contact.history.push({ role: 'assistant', content: reply });
            if (contact.history.length > 10) contact.history.shift();
            saveDB();

            return reply;
        }

    } catch (err) {
        console.error("OpenRouter Vision Error:", err.response?.data || err.message);
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
            const rawSender = isGroup ? (msg.key.participant || jid) : jid;
            const pushName = msg.pushName || "Unknown";
            const time = new Date(msg.messageTimestamp * 1000).toLocaleTimeString();

            const cleanSenderJid = normalizeJid(rawSender);
            updateContactMemory(cleanSenderJid, pushName, isGroup ? jid : null);

            const botJid = normalizeJid(sock.user?.id);
            const botPhone = extractPhoneNumber(botJid);
            const ownerName = db.settings.customOwnerName || sock.user?.name || pushName || botPhone;
            const isFromMe = msg.key.fromMe;

            const unwrapMessage = msg.message.viewOnceMessage?.message 
                               || msg.message.viewOnceMessageV2?.message 
                               || msg.message;

            let text = msg.message.conversation 
                    || msg.message.extendedTextMessage?.text 
                    || unwrapMessage?.imageMessage?.caption 
                    || "";

            // ===== QUOTED MESSAGE DETECTOR =====
            const contextInfo = msg.message.extendedTextMessage?.contextInfo;
            if (contextInfo && contextInfo.quotedMessage) {
                const quotedUnwrapped = contextInfo.quotedMessage.viewOnceMessage?.message 
                                     || contextInfo.quotedMessage.viewOnceMessageV2?.message 
                                     || contextInfo.quotedMessage;

                const quotedText = quotedUnwrapped.conversation 
                                || quotedUnwrapped.extendedTextMessage?.text 
                                || quotedUnwrapped.imageMessage?.caption 
                                || "";

                if (quotedText) {
                    text = `[Replying to: "${quotedText}"] ${text}`;
                }
            }

            const lowerText = text.toLowerCase().trim();

            // ===== OWNER COMMAND CONTROLS (Accepts ! and .) =====
            if (isFromMe && (text.startsWith('!') || text.startsWith('.'))) {
                const args = text.slice(1).trim().split(' ');
                const command = args[0].toLowerCase();
                const subInput = args.slice(1).join(' ').trim();

                let commandHandled = false;

                // 1. MASTER BOT TOGGLE
                if (command === 'bot') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.botActive = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🤖 *Bot Auto-Reply System:* ACTIVATED ✅" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.botActive = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🤖 *Bot Auto-Reply System:* DEACTIVATED ❌" });
                    }
                    const statusText = db.settings.botActive ? "ACTIVE ✅" : "INACTIVE ❌";
                    return sock.sendMessage(jid, { text: `🤖 Bot Status: *${statusText}*\n\n_Usage: \`!bot on\` | \`!bot off\`_` });
                }

                // 2. VOICE MODE TOGGLE
                if (command === 'voice') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.voiceMode = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "🎙️ *Voice Mode:* ACTIVATED ✅ (Replies sent as Voice Notes)" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.voiceMode = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "💬 *Voice Mode:* DISABLED ❌ (Replies sent as Text)" });
                    }
                    const vStatus = db.settings.voiceMode ? "ENABLED 🎙️" : "DISABLED 💬";
                    return sock.sendMessage(jid, { text: `🎙️ Voice Mode: *${vStatus}*\n\n_Usage: \`!voice on\` | \`!voice off\`_` });
                }

                // 3. BUSINESS TOGGLE & DESCRIPTION
                if (command === 'business') {
                    commandHandled = true;
                    if (subInput.toLowerCase() === 'on') {
                        db.settings.businessActive = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: "💼 *Business Mode:* ENABLED ✅" });
                    }
                    if (subInput.toLowerCase() === 'off') {
                        db.settings.businessActive = false;
                        saveDB();
                        return sock.sendMessage(jid, { text: "💼 *Business Mode:* DISABLED ❌" });
                    }
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const bizInfo = subInput.slice(4).trim();
                        db.settings.businessInfo = bizInfo;
                        db.settings.businessActive = true;
                        saveDB();
                        return sock.sendMessage(jid, { text: `💼 *Business Profile Updated & Activated:*\n"${bizInfo}"` });
                    }

                    const state = db.settings.businessActive ? "ENABLED ✅" : "DISABLED ❌";
                    const profile = db.settings.businessInfo || "None set";
                    return sock.sendMessage(jid, { text: `💼 *Business Mode:* ${state}\n*Current Details:* ${profile}\n\n_Usage: \`!business set <text>\`, \`!business on\`, \`!business off\`_` });
                }

                // 4. PRICES & CURRENCY COMMAND
                if (command === 'prices' || command === 'price') {
                    commandHandled = true;
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const priceData = subInput.slice(4).trim();
                        db.settings.pricesInfo = priceData;
                        saveDB();
                        return sock.sendMessage(jid, { text: `💰 *Pricing & Products Updated:*\n"${priceData}"` });
                    }
                    if (subInput.toLowerCase() === 'clear') {
                        db.settings.pricesInfo = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "💰 *Pricing Info Cleared!*" });
                    }
                    const currentPrices = db.settings.pricesInfo || "No pricing set.";
                    return sock.sendMessage(jid, { text: `💰 *Current Prices & Products:*\n${currentPrices}\n\n_Usage: \`!prices set <details>\`, \`!prices clear\`_` });
                }

                // 5. LOCATION COMMAND
                if (command === 'location') {
                    commandHandled = true;
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const locData = subInput.slice(4).trim();
                        db.settings.locationInfo = locData;
                        saveDB();
                        return sock.sendMessage(jid, { text: `📍 *Location Stamped:*\n"${locData}"` });
                    }
                    if (subInput.toLowerCase() === 'clear') {
                        db.settings.locationInfo = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "📍 *Location Cleared!*" });
                    }
                    const currentLoc = db.settings.locationInfo || "No location set.";
                    return sock.sendMessage(jid, { text: `📍 *Current Location:*\n${currentLoc}\n\n_Usage: \`!location set <address>\`, \`!location clear\`_` });
                }

                // 6. OWNER COMMAND (Overwrite / Set Custom Owner Name)
                if (command === 'owner') {
                    commandHandled = true;
                    if (subInput.toLowerCase().startsWith('set ')) {
                        const newOwnerName = subInput.slice(4).trim();
                        db.settings.customOwnerName = newOwnerName;
                        saveDB();
                        return sock.sendMessage(jid, { text: `👑 *Owner Name Overwritten Successfully!*\nNew Owner Name: *${newOwnerName}*` });
                    }
                    if (subInput.toLowerCase() === 'clear') {
                        db.settings.customOwnerName = "";
                        saveDB();
                        return sock.sendMessage(jid, { text: "👑 *Custom Owner Name Cleared!* Reverted to WhatsApp account name." });
                    }
                    const activeOwner = db.settings.customOwnerName || sock.user?.name || pushName || botPhone;
                    return sock.sendMessage(jid, { text: `👑 *Current Owner Name:* ${activeOwner}\n\n_Usage: \`!owner set <new name>\`, \`!owner clear\`_` });
                }

                // 7. PYTHON / SYSTEM EXECUTION COMMAND
                if (command === 'py') {
                    commandHandled = true;
                    if (!subInput) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!py <python code or command>`" });
                    }
                    try {
                        const pyResult = await runSystemCommand(`python3 -c "${subInput}"`);
                        await simulateHumanTyping(sock, jid, pyResult);
                        return sock.sendMessage(jid, { text: pyResult });
                    } catch (err) {
                        return sock.sendMessage(jid, { text: `🐍 Python Execution Error:\n${err}` });
                    }
                }

                // 8. UNMERGED MEMORY VAULT COMMANDS (!memories vs !remember)
                if (command === 'memories') {
                    commandHandled = true;
                    let memoryList = "*🧠 BOT MEMORY VAULT (TRACKED CONTACTS)*\n\n";
                    const contacts = Object.keys(db.contacts);

                    if (contacts.length === 0) {
                        memoryList += "No contacts logged yet.";
                    } else {
                        contacts.forEach(phone => {
                            const c = db.contacts[phone];
                            memoryList += `👤 *${c.name}* (+${phone})\n`;
                            if (c.nickname) memoryList += `   🏷️ Role: ${c.nickname}\n`;
                            if (c.notes) memoryList += `   📝 Owner Notes: ${c.notes}\n`;
                            memoryList += `   🕒 Last Active: ${new Date(c.lastSeen).toLocaleTimeString()}\n\n`;
                        });
                    }

                    await simulateHumanTyping(sock, jid, memoryList);
                    return sock.sendMessage(jid, { text: memoryList });
                }

                if (command === 'remember') {
                    commandHandled = true;
                    const parts = subInput.split(' ');
                    const phone = parts[0] ? parts[0].replace(/[^0-9]/g, '') : '';
                    const note = parts.slice(1).join(' ');

                    if (!phone || !note) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!remember <phone_number> <note about who this person is to you>`" });
                    }

                    if (!db.contacts[phone]) {
                        db.contacts[phone] = {
                            jid: `${phone}@s.whatsapp.net`,
                            name: `User +${phone}`,
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
                    return sock.sendMessage(jid, { text: `✅ Saved relationship note for +${phone}:\n"${note}"` });
                }

                if (command === 'history') {
                    commandHandled = true;
                    const phone = subInput.replace(/[^0-9]/g, '');

                    if (!phone) {
                        return sock.sendMessage(jid, { text: "⚠️ Usage: `!history <phone_number>`" });
                    }

                    if (!db.contacts[phone]) {
                        return sock.sendMessage(jid, { text: `❌ Phone number +${phone} not found in memory.` });
                    }

                    const c = db.contacts[phone];
                    let historyOutput = `📜 *CHAT HISTORY FOR ${c.name.toUpperCase()} (+${phone})*\n\n`;

                    if (!c.history || c.history.length === 0) {
                        historyOutput += "No recent chat logs recorded.";
                    } else {
                        historyOutput += c.history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
                    }

                    await simulateHumanTyping(sock, jid, historyOutput);
                    return sock.sendMessage(jid, { text: historyOutput });
                }

                // 9. WIPE MEMORY COMMAND (Python execution to clear bot_memory.json memory data)
                if (command === 'wipe') {
                    commandHandled = true;
                    try {
                        await runSystemCommand(`python3 -c "import json; f=open('./bot_memory.json', 'w'); json.dump({'contacts':{}, 'groups':{}, 'settings':{}}, f); f.close()"`);
                        db = { 
                            contacts: {}, 
                            groups: {},
                            settings: {
                                botActive: true,
                                voiceMode: false,
                                businessActive: false,
                                businessInfo: "",
                                pricesInfo: "",
                                locationInfo: "",
                                customOwnerName: ""
                            }
                        };
                        return sock.sendMessage(jid, { text: "🧹 *Bot Memory Wiped Successfully via Python!* All contacts and history have been reset." });
                    } catch (err) {
                        return sock.sendMessage(jid, { text: `❌ Wipe Error:\n${err}` });
                    }
                }

                // 10. SYSTEM STATUS UTILITY (Bonus Command for remote monitoring)
                if (command === 'status' || command === 'sys') {
                    commandHandled = true;
                    try {
                        const uptimeSecs = process.uptime();
                        const hours = Math.floor(uptimeSecs / 3600);
                        const mins = Math.floor((uptimeSecs % 3600) / 60);
                        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
                        
                        const sysInfo = `📊 *SYSTEM STATUS REPORT*
⏱️ Uptime: ${hours}h ${mins}m
💾 RAM Heap: ${memoryUsage.toFixed(2)} MB
👥 Saved Contacts: ${Object.keys(db.contacts).length}
🤖 Bot Active: ${db.settings.botActive ? 'YES ✅' : 'NO ❌'}
🎙️ Voice Mode: ${db.settings.voiceMode ? 'ON 🎙️' : 'OFF 💬'}
💼 Business Mode: ${db.settings.businessActive ? 'ON ✅' : 'OFF ❌'}`;

                        return sock.sendMessage(jid, { text: sysInfo });
                    } catch (e) {
                        return sock.sendMessage(jid, { text: "⚠️ Failed to fetch system status." });
                    }
                }

                // CATCH-ALL UNRECOGNIZED COMMAND MENU
                if (!commandHandled) {
                    const fallbackHelp = `⚠️ *Unrecognized Command:* \`${command}\`

Available Commands:
🤖 *!bot* - \`on\` | \`off\`
🎙️ *!voice* - \`on\` | \`off\`
💼 *!business* - \`set <info>\` | \`on\` | \`off\`
💰 *!prices* - \`set <details>\` | \`clear\`
📍 *!location* - \`set <address>\` | \`clear\`
👑 *!owner* - \`set <new name>\` | \`clear\`
🐍 *!py* - \`<python code>\`
🧹 *!wipe* - Clear all saved memory & history
📊 *!status* - Check system uptime & memory
🧠 *!memories* - View saved contacts list
📝 *!remember* - \`<phone_number> <note>\`
📜 *!history* - \`<phone_number>\``;

                    return sock.sendMessage(jid, { text: fallbackHelp });
                }
            }

            // ===== DELETED MESSAGE DETECTOR =====
            if (msg.message.protocolMessage && msg.message.protocolMessage.type === 0) {
                const deletedId = msg.message.protocolMessage.key.id;
                const savedMsg = messageStore.get(deletedId);

                console.log(`\n\x1b[41m\x1b[37m 🚨 DELETED MESSAGE DETECTED! 🚨 \x1b[0m`);
                console.log(`\x1b[31mFrom:\x1b[0m ${pushName} (+${extractPhoneNumber(cleanSenderJid)})`);
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

            // ===== AUTO-SAVE MEDIA & AUDIO TRANSCRIBER =====
            const mediaType = Object.keys(unwrapMessage).find(key => 
                ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage', 'ptvMessage'].includes(key)
            );

            let downloadedBuffer = null;
            let mimeType = "image/jpeg";

            if (mediaType) {
                let ext = 'bin';
                if (mediaType === 'imageMessage') {
                    ext = 'jpg';
                    mimeType = unwrapMessage.imageMessage?.mimetype || "image/jpeg";
                }
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

                    // Transcribe Voice Notes automatically using Whisper
                    if (mediaType === 'audioMessage' && downloadedBuffer) {
                        const transcribedSpeech = await transcribeAudio(downloadedBuffer);
                        if (transcribedSpeech) {
                            text = `[Voice Note Transcribed]: ${transcribedSpeech}`;
                        }
                    }
                } catch (e) { }
            }

            if (text) messageStore.set(msgId, { isMedia: false, text });

            // ===== DIRECT MESSAGES RESPONSE ENGINE (DM MODE) =====
            if (!isGroup && !isFromMe) {
                // Respect Master Bot Switch
                if (!db.settings.botActive) continue;

                let finalReply = "";

                if (unwrapMessage.imageMessage && downloadedBuffer) {
                    finalReply = await analyzeImageWithAI(downloadedBuffer, text, ownerName, cleanSenderJid, pushName, mimeType);
                } else if (/who is (your|the) owner|who (owns|runs) this/i.test(lowerText)) {
                    finalReply = `hi, this is ${ownerName}'s assistant speaking. what do you need?`;
                } else if (text) {
                    finalReply = await getAIReply(cleanSenderJid, text, false, ownerName, botPhone, pushName);
                }

                if (finalReply) {
                    await simulateHumanTyping(sock, jid, finalReply);

                    // Output voice note if voiceMode is on, otherwise send standard text
                    if (db.settings.voiceMode) {
                        try {
                            const oggPath = await generateAudioResponse(finalReply);
                            await sock.sendMessage(jid, { audio: { url: oggPath }, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
                            if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);
                        } catch (audioErr) {
                            await sock.sendMessage(jid, { text: finalReply });
                        }
                    } else {
                        await sock.sendMessage(jid, { text: finalReply });
                    }
                    continue;
                }
            }

            // ===== GROUP MODERATION & KICK ENGINE =====
            if (isGroup) {
                if (!db.groups[jid]) db.groups[jid] = { members: {}, warnings: {} };
                if (!db.groups[jid].warnings) db.groups[jid].warnings = {};

                const linkRegex = /chat\.whatsapp\.com\/([A-Za-z0-9]+)|https?:\/\/[^\s]+/i;
                const match = text.match(linkRegex);

                if (match) {
                    try {
                        const metadata = await sock.groupMetadata(jid);
                        
                        const adminJids = metadata.participants
                            .filter(p => p.admin)
                            .map(p => normalizeJid(p.id));

                        const isSenderAdmin = adminJids.includes(cleanSenderJid);
                        const isBotAdmin = adminJids.includes(botJid);

                        let currentGroupInviteCode = "";
                        if (isBotAdmin) {
                            try {
                                currentGroupInviteCode = await sock.groupInviteCode(jid);
                            } catch (e) { }
                        }

                        const extractedInviteCode = match[1];
                        const isCurrentGroupLink = extractedInviteCode && (extractedInviteCode === currentGroupInviteCode);

                        if (!isSenderAdmin && !isCurrentGroupLink) {
                            
                            await sock.sendMessage(jid, { delete: msg.key });

                            const senderPhone = extractPhoneNumber(cleanSenderJid);
                            const currentWarnings = (db.groups[jid].warnings[senderPhone] || 0) + 1;
                            db.groups[jid].warnings[senderPhone] = currentWarnings;
                            saveDB();

                            if (currentWarnings >= 3) {
                                if (isBotAdmin) {
                                    try {
                                        await sock.groupParticipantsUpdate(jid, [rawSender], 'remove');
                                        await sock.sendMessage(jid, { 
                                            text: `🚫 @${senderPhone} was removed for sending prohibited links (3/3 warnings).`, 
                                            mentions: [cleanSenderJid] 
                                        });
                                        delete db.groups[jid].warnings[senderPhone];
                                        saveDB();
                                    } catch (kickErr) {
                                        console.error("Kick Error Details:", kickErr);
                                        await sock.sendMessage(jid, { 
                                            text: `⚠️ @${senderPhone} reached max warnings (3/3), but auto-kick failed. Make sure I am Admin!`, 
                                            mentions: [cleanSenderJid] 
                                        });
                                    }
                                } else {
                                    await sock.sendMessage(jid, { 
                                        text: `⚠️ @${senderPhone} reached max warnings (3/3)! Promote me to Admin to auto-remove link spammers.`, 
                                        mentions: [cleanSenderJid] 
                                    });
                                }
                            } else {
                                await sock.sendMessage(jid, { 
                                    text: `⚠️ External links are not allowed here @${senderPhone}! Warning ${currentWarnings}/3`, 
                                    mentions: [cleanSenderJid] 
                                });
                            }
                        }
                    } catch (err) {
                        console.error('Group moderation error:', err.message);
                    }
                }
            }
        }
    });
}

startSuperiorAssistant();
