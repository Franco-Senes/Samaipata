# Samaipata
Samaipata is a custom, full-stack, local-first AI client interface. That works using ollama and Hackclub AI.
![Samaipata HomeScreen - localhost:5000/index.html](https://i.ibb.co/4RQR5ybR/Screenshot-2026-08-26-175220.png)
## Notes for stardance reviewers
1. First i cant put the project on a web server because its meant to be runned locally using ollama like projects like openwebui. I could do a web version that only has hackclub ai and gemini.
2. The installer currently only works with windows.
Thats all! Wish you luck with samaipata
## Features
- 1. Multiple api support
   - Has support for multiple apis like
   - 1. [Hackclub AI](ai.hackclub.com)
   - 2. [Gemini](gemini.hackclub.com)
   - 3. [Ollama](https://ollama.com/)
- 2. Clean ui
   - Clean ui inspired by [Manus](manus.im)
- 3. SSE Support
   - Support for realtime chat.
- 4. Custom model marketplace
   - A custom model marketplace for Hackclub and Local models. Data extracted using the following apis:
   - 1. Akazwz Cloudflare worker
   - 2. OllamaDB api
   - 3. Fallback json file
- 5. Admin Panel
   - A custom admin panel with the following features:
   - 1. User roles
   - 2. Suspension and ban system
   - 3. Permited models
## Instalation
### Installer
- 1. Windows Installer
  - Currently there is only a windows installer which you can find in releases
    [Installer](https://github.com/Franco-Senes/Samaipata/releases/tag/%23Samaipata)
   
### Manual
### Requirements

1. [Node.js](https://nodejs.org/) (18 or more).
2. [Ollama](https://ollama.com/) installed and executing in your local machine (`http://localhost:11434`).


1. **Clone the repo:**
   ```bash
   git clone https://github.com/Franco-Senes/Samaipata.git
   cd Samaipata
   ```

2. **Install the dependencies:**
   ```bash
   npm install
   ```

3. **Setup .env:**
   Create a .env file with the following atributes:
   ```env
   PORT=5000
   JWT_SECRET=yourcustomkey
   OLLAMA=http://localhost:11434
   ALLOWED_ORIGINS=http://localhost:5000,http://127.0.0.1:5000

   ZERO_CLIENT_ID=
   ZERO_CLIENT_SECRET=
   ZERO_REDIRECT_URI=http://localhost:5000/api/auth/zero/callback
   ZERO_SERVER_URL=https://zero.info.bo

   HACKCLUB_API_KEY=
   ```

4. **Start the server:**
   ```bash
   npm start

   npm run dev
   ```

5. **Access the application:**
   Open in your browser [http://localhost:5000](http://localhost:5000) PORT 5000 by default.

