WhatsApp AI Assistant & Moderation Bot
​A powerful, feature-rich WhatsApp personal assistant and group moderation bot built using Node.js, Baileys, and Termux. It acts as an autonomous assistant—managing chats with advanced AI, logging memories, transcribing voice notes, processing images, and keeping groups clean.
​Features & Capabilities
​🧠 Smart Contact & Chat Memory Vault: Automatically tracks every person who messages you, stores their push names, records conversation history (up to the last 10 messages), and logs custom notes.
​🤖 Groq AI Text Assistant: Powered by llama-3.1-8b-instant for ultra-fast, natural, context-aware casual conversation. It adapts to user emotions (angry, happy, playful, sad) and maintains strict boundaries.
​👁️ OpenRouter Vision Integration: Seamlessly analyzes and describes images sent to you in DMs using free-tier vision models when captioned or requested.
​🎙️ Voice Note Transcription & Generation: Automatically transcribes incoming WhatsApp voice messages using Groq's Whisper (whisper-large-v3-turbo). When Voice Mode is enabled, it converts AI text responses into natural audio voice notes (via espeak and ffmpeg).
​💼 Business & Location Awareness: Turn on business mode to let the bot reference your custom business profile, pricing/products list, and physical location only when a contact explicitly asks about them.
​🛡️ Automated Group Moderation: Detects unauthorized external links (chat.whatsapp.com or general web links) in groups, automatically deletes them, issues warnings (up to 3 strikes), and auto-removes repeat link-spammers if granted admin permissions.
​🚨 Deleted Message Detector: Logs text and media messages locally so you can see when someone deletes a message or media file in real time via your Termux console.
​👑 Full Remote Owner Command Suite: Control every aspect of your bot directly from WhatsApp using simple prefix commands (! or .) without ever needing to touch Termux.


Complete Command List
​All owner commands can be triggered directly via WhatsApp chat using either ! or !:
CommandUsage / ExampleDescription
!bot!bot on / !bot offActivates or deactivates the master bot auto-reply system.
!voice!voice on / !voice offToggles voice mode (replies sent as audio voice notes instead of text).
!business!business on / !business set <info>Manages your business profile and activates product/service awareness.
!prices!prices set <details> / !prices clearSets or clears your product catalog and pricing information.
!location!location set <address> / !location clearSets or clears your physical business address or location.
!owner!owner set <name> / !owner clearCustomizes or resets the assistant's referenced owner name.
!py!py print("Hello")Executes custom Python code or commands directly through Termux.
!wipe!wipeCompletely wipes and resets all saved contacts, group memory, and history.
!status!status (or !sys)Displays system uptime, RAM heap usage, and active feature toggles.
!memories!memoriesViews a full list of all tracked contacts saved in your memory vault.
!remember!remember <phone> <note>Saves a specific relationship note or context tag for a contact.
!history!history <phone>Pulls up the recent chat logs recorded for a specific contact.

Termux Installation Guide
​To run this assistant natively on your Android device via Termux, follow these steps:
​1. Update Packages & Install Dependencies
​Open Termux and run the following command to install Node.js, Git, Python, FFmpeg, and eSpeak:
pkg update && pkg upgrade -y
pkg install nodejs git python ffmpeg espeak zip -y
2. Clone or Setup Project Directory
​Navigate to your project directory (e.g., ai-assistant):
cd ~/ai-assistant
3. Install Node Modules
npm install
API Keys Configuration
​To get this assistant fully functional, you need API keys from Groq and OpenRouter for text generation, speech transcription, and vision capabilities.
const GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";
const OPENROUTER_API_KEY = "YOUR_OPENROUTER_API_KEY_HERE"; 
How to get the keys:
​Groq API Key: Sign up for a free account at Groq Console, generate an API key, and paste it into GROQ_API_KEY. (Required for Llama text processing and Whisper voice transcription).
​OpenRouter API Key: Create an account at OpenRouter, generate an API key, and paste it into OPENROUTER_API_KEY. (Required for image/vision analysis).
Running & Deploying
​Running Locally in Termux
​Start the bot script:node index.js
Note: On first launch, it will prompt you in Termux to enter your phone number with your country code to generate a secure pairing code. Enter the code into WhatsApp under Linked Devices -> Link with phone number.

Deploying on a Hosting Panel (Pterodactyl / Custom Node.js Panels)
​If you are deploying this bot on a game/bot hosting panel (like Pterodactyl):
1. Create a new Node.js server instance.
2. Upload your zipped project files (ensure node_modules and auth_info are excluded or generated fresh).
3. Set your startup command to point to your main file:
node index.js
4. Ensure your panel environment supports or pre-installs system packages like ffmpeg and espeak if you plan to use the voice note generation feature.
5. Start the server and check the console logs for connection status.
