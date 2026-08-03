WhatsApp AI Assistant & Moderation Bot is a powerful, feature-rich personal assistant and group moderation bot built using Node.js, Baileys, and Termux. It acts as an autonomous assistant—managing chats with advanced AI, logging memories, transcribing voice notes, processing images, and keeping groups clean.

Features & Capabilities
Smart Contact & Chat Memory Vault: Automatically tracks every person who messages you, stores their push names, records conversation history (up to the last 10 messages), and logs custom notes.
Groq AI Text Assistant: Powered by llama-3.1-8b-instant for ultra-fast, natural, context-aware casual conversation. It adapts to user emotions (angry, happy, playful, sad) and maintains strict boundaries.
OpenRouter Vision Integration: Seamlessly analyzes and describes images sent to you in DMs using free-tier vision models when captioned or requested.
Voice Note Transcription & Generation: Automatically transcribes incoming WhatsApp voice messages using Groq's Whisper (whisper-large-v3-turbo). When voice mode is enabled, it converts AI text responses into natural audio voice notes (via espeak and ffmpeg).
Business & Location Awareness: Turn on business mode to let the bot reference your custom business profile, pricing/products list, and physical location only when a contact explicitly asks about them.
Automated Group moderation: Detects unauthorized external links (chat.whatsapp.com or general web links) in groups, automatically deletes them, issues warnings (up to 3 strikes), and auto-removes repeat link-spammers if granted admin permissions.
Deleted Message Detector: Localizes and logs text and media messages so you can see when someone deletes a message or media file in real time via your Termux console.
Full Remote Owner Command Suite: Control every aspect of your bot directly from WhatsApp using simple prefix commands (! or .)
Complete Command List
All owner commands can be triggered directly via WhatsApp chat using either ! or ..
CommandUsage / ExampleDescription
!bot !bot on / !bot offActivates or deactivates the master bot auto-reply system.
!voice !voice on / !voice off Toggles voice mode (replies sent as audio voice notes instead of text).
!business !business setManages your business profile and activates product/service awareness.
!prices !prices set / !prices clearSets or clears your product catalog and pricing information.
!location !location set / !location clearSets or clears your physical business address or location.
!owner!owner set / !owner clear Customizes or resets the assistant's referenced owner name.
!py !py print("Hello") Executes custom Python code or commands directly through Termux.
!wipe !wipe Completely wipes and resets all saved contacts, group memory, and history.
!status !status (or !sys)Displays system uptime, RAM heap usage, and active feature toggles.
!memories !memories Views a full list of all tracked contacts saved in your memory vault.
!remember !remember Saves a specific relationship note or context tag for a contact.
!history !history Pulls up the recent chat logs recorded for a specific contact.

Termux Installation Guide
To run this assistant natively on your Android device via Termux, follow these steps:
1. Update Packages & Install Dependencies
Open Termux and run the following command to install Node.js, Git, Python, FFmpeg, and eSpeak:
pkg update && pkg upgrade -y
pkg install nodejs git python ffmpeg espeak zip -y

2. Clone or Setup Project Directory
Navigate to your project directory (e.g., ai-assistant):
cd ~/ai-assistant

3. Install Node Modules
npm install

API Keys Configuration
To get this assistant fully functional, you need API keys from Groq and OpenRouter for text generation, speech transcription, and vision capabilities.
const GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";
const OPENROUTER_API_KEY = "YOUR_OPENROUTER_API_KEY_HERE";

How to Get the Keys:
Groq API Key: Sign up for a free account at the Groq Console, generate an API key, and paste it into GROQ_API_KEY. (Required for Llama text processing and Whisper voice transcription).
OpenRouter API Key: Create an account at OpenRouter, generate an API key, and paste it into OPENROUTER_API_KEY. (Required for image/vision analysis).

Running & Deploying
Running Locally in Termux
Start the bot script: node index.js

Note: On first launch, it will prompt you in Termux to enter your phone number with your country code to generate a secure pairing code. Enter the code into WhatsApp under Linked Devices -> Link with phone number.

After a successful deploy remember to use !wipe to clear previous memory after then use !owner clear to remove previous owner then use !owner set and your name to add your name as new owner so the assistant will tell people/customer you're it's owner 


Deploying on a Hosting Panel (Pterodactyl / Custom Panels)
If you are deploying this bot on a hosting panel (such as Pterodactyl or Katabump):
Configure Your Keys: Make sure you have edited your project files to include your API keys directly in index.js.
Upload and Organize: Upload the zip file, delete the zip, open the unzipped folder, and move the contents to the root directory (../).
Launch: Start the server directly from the panel (system dependencies like ffmpeg and espeak are already pre-installed on the panel) and check the console logs to confirm a successful connection.


Business Mode & Extensions
Business mode is completely optional and can be toggled using !business on or !business off, depending on whether you want your AI to handle regular personal chats or customer inquiries.
Pricing (!prices): Works hand-in-hand with business mode to manage your product catalog and costs.
Location (!location): Also integrates with business mode to share your physical business address or location when requested.
Important API Key Requirements
Groq & OpenRouter Only: Your API keys must come strictly from Groq (for AI communication and text processing) and OpenRouter (for vision capabilities to let the assistant analyze pictures).
Using API keys from any other AI provider may cause the script to fail.
Voice Notes & Audio Features
Transcription: The WhatsApp assistant script features built-in audio transcription, meaning it can automatically hear and understand incoming voice notes.
Voice Responses: You can toggle audio replies on or off using !voice on or !voice off. This is turned off by default because live voice generation can sometimes feel less fluent, but you are free to turn it on if you prefer listening to voice notes rather than reading text.
