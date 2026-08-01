# 🤖 WhatsApp AI Assistant (`ai-assistant`)

An automated, intelligent WhatsApp assistant built with `@whiskeysockets/baileys` and integrated with the **Groq API** (powered by LLaMA) for ultra-fast natural language responses.

---

## 🎯 Features

* **AI-Powered Responses:** Automatically processes incoming messages and generates fast, intelligent context-aware replies using the Groq AI API.
* **Auto-Reconnect & Resilience:** Detects connection drops and automatically restores socket sessions.
* **Cross-Platform:** Ready for deployment on hosting panels (Pterodactyl, BotHost, VPS) or local environments (Termux, Linux, Windows).

---

## 🛠️ Prerequisites & Stack

* **Node.js:** `v18.0.0` or higher
* **Core Libraries:** `@whiskeysockets/baileys`, `groq-sdk` (or `axios`/`dotenv`)
* **API Key:** A free API Key from [Groq Cloud Console](https://console.groq.com)

---

## 🚀 Setup & Installation Guide

### Step 1: Upload / Extract Files
Upload your project files to your hosting panel or server.  
*Ensure `node_modules` and any session folders (like `auth_info/`) are excluded.*

### Step 2: Configure Environment Variables
Create a `.env` file in the root folder (or set Environment Variables in your host panel settings):

```env
GROQ_API_KEY=your_groq_api_key_here
