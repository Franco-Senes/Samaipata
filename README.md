# Samaipata

**Samaipata** is a platform for local ai. Permits to interact with local models using [Ollama](https://ollama.com/) and cloud integrations like [Hackclub Ai](https://ai.hackclub.com).

---

## Characteristics

- **Real time chat support**:
  - Has support for SSE.

-  **Model marketplace**:
  - A custom model marketplace using diffrent apis.

- **Auth and Security**:
  - Encryption using Bcrypt!

- **Admin Panel**:
  - User roles (`user`, `admin`).
  - Models per user.
  - Ban and suspension support.

---

## Stack 

- **Backend**: Node.js, Express.js
- **Database**: SQLite (`sqlite3`)
- **Auth**: JWT (`jsonwebtoken`), Bcrypt (`bcryptjs`), Cookie-Parser
- **Frontend**: HTML5 semántico, CSS3 moderno (Variables CSS, Flexbox/Grid, Responsive), Vanilla JavaScript
- **Ai**: Ollama API, Hack Club AI and Gemini

---

## Quick start up

### Requirements

1. [Node.js](https://nodejs.org/) (18 or more).
2. [Ollama](https://ollama.com/) installed and executing in your local machine (`http://localhost:11434`).

### Instalación

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

---

## Testing

```bash
npm test
```

Tests every endpoint
---

## Proyect Layout

```text
├── index.js              
├── package.json           
├── fallback_models.json   
├── public/                
│   ├── index.html         
│   ├── login.html         
│   ├── marketplace.html   
│   ├── Icon.ico           
│   ├── css/               
│   └── js/                
└── test/                  
    └── index.test.js
```

---

## Stardance
Support this project on [Stardance](https://stardance.hackclub.com/projects/38064).
