# Samaipata
Samaipata is a custom, full-stack, local-first AI client interface that works using Ollama and Hack Club AI.

![Samaipata HomeScreen - localhost:5000/index.html](https://i.ibb.co/4RQR5ybR/Screenshot-2026-08-26-175220.png)

## Features
- **1. Multiple API Support**
  - [Hack Club AI](https://ai.hackclub.com)
  - [Ollama](https://ollama.com/)
- **2. Clean Modern UI**
  - Clean interface inspired by Manus AI.
- **3. Real-time Streaming (SSE)**
  - Full support for real-time token streaming and reasoning visualization.
- **4. Custom Model Marketplace**
  - Dynamic marketplace for Hack Club and Local models with ELO leaderboard ratings.
- **5. Admin Panel & User Controls**
  - Automatic admin assignment on first registration.
  - Granular model permissions and rate limits.
  - Analytics and user suspension controls.

## Installation

### Requirements
1. [Node.js](https://nodejs.org/) (v18 or higher).
2. [Ollama](https://ollama.com/) running locally (`http://localhost:11434`).

### Quick Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Franco-Senes/Samaipata.git
   cd Samaipata
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment:**
   Create a `.env` file in the root directory:
   ```env
   PORT=5000
   JWT_SECRET=your_secure_random_key
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
   ```

5. **Open Samaipata:**
   Navigate to [http://localhost:5000](http://localhost:5000) in your web browser.
