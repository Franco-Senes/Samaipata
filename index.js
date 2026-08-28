// Dependencies
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const {json} = require("express");
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 5000; // port

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('JWT_SECRET is missing');
        process.exit(1);
    } else {
        console.error('JWT_SECRET is missing generating the missing key.');
        JWT_SECRET = crypto.randomBytes(32).toString('hex');
    }
}

const OLLAMA = process.env.OLLAMA || 'http://localhost:11434';
const ZERO_CLIENT_ID = process.env.ZERO_CLIENT_ID || '';
const ZERO_CLIENT_SECRET = process.env.ZERO_CLIENT_SECRET || '';
const ZERO_REDIRECT_URI = process.env.ZERO_REDIRECT_URI || 'http://localhost:5000/api/auth/zero/callback';
const ZERO_SERVER_URL = process.env.ZERO_SERVER_URL || 'https://zero.info.bo';

// Hack Club AI environment integration
const HACKCLUB_API_KEY = process.env.HACKCLUB_API_KEY || '';

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5000', 'http://127.0.0.1:5000'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS restrictions'));
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use((req, res, next) => {
    console.log(`[HTTP Request] ${req.method} ${req.url}`);
    next();
});

const dbpath = path.join(__dirname, 'database.db');
// Corrected sqLite3 spelling to sqlite3 and added createTables() startup execution
const db = new sqlite3.Database(dbpath, (err) => {
    if (err) {
        console.error('Error with sqlite database', err.message);
    } else {
        console.log('Sqlite database active at:', dbpath);
        createTables();
    }
});

function createTables() {
    db.serialize(() => {
        // users
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                email TEXT UNIQUE,
                password_hash TEXT,
                avatar_url TEXT,
                role TEXT DEFAULT 'user',
                is_suspended INTEGER DEFAULT 0,
                suspension_reason TEXT,
                suspension_until DATETIME,
                allowed_models TEXT,
                rate_limit_messages INTEGER DEFAULT NULL,
                rate_limit_tokens INTEGER DEFAULT NULL,
                can_manage_models INTEGER DEFAULT 1,
                rate_limits_per_model TEXT DEFAULT NULL,
                hackclub_api_key TEXT DEFAULT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration to add hackclub_api_key if missing
        db.run(`ALTER TABLE users ADD COLUMN hackclub_api_key TEXT`, () => {});

        // conversations
        db.run(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                title TEXT,
                model_name TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // messages
        db.run(`
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER,
                role TEXT,
                content TEXT,
                tokens INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
        `);

        // memories
        db.run(`
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                fact TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Model Ratings Table (Elo classification)
        db.run(`
            CREATE TABLE IF NOT EXISTS model_ratings (
                model_name TEXT PRIMARY KEY,
                elo INTEGER DEFAULT 1200,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0
            )
        `);

        // Opinions / Feedback Table
        db.run(`
            CREATE TABLE IF NOT EXISTS feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username TEXT,
                model_name TEXT,
                rating TEXT,
                comment TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        const migrations = [
            { table: 'users', col: 'role', type: "TEXT DEFAULT 'user'" },
            { table: 'users', col: 'is_suspended', type: "INTEGER DEFAULT 0" },
            { table: 'users', col: 'suspension_reason', type: "TEXT" },
            { table: 'users', col: 'suspension_until', type: "DATETIME" },
            { table: 'users', col: 'allowed_models', type: "TEXT" },
            { table: 'users', col: 'rate_limit_messages', type: "INTEGER DEFAULT NULL" },
            { table: 'users', col: 'rate_limit_tokens', type: "INTEGER DEFAULT NULL" },
            { table: 'users', col: 'can_manage_models', type: "INTEGER DEFAULT 1" },
            { table: 'users', col: 'rate_limits_per_model', type: "TEXT DEFAULT NULL" },
            { table: 'messages', col: 'tokens', type: "INTEGER DEFAULT 0" }
        ];

        migrations.forEach(({ table, col, type }) => {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`, (err) => {
                // suppress columns already exist warnings
            });
        });
    });
}

// Added the missing 'new' keyword to properly initialize Promise instances
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
});

const authenticateToken = async (req, res, next) => {
    let token = req.cookies.samaipata_session;
    if (!token && req.headers.authorization) {
        const parts = req.headers.authorization.split(' ');
        // Corrected spelling 'Beaver' to 'Bearer'
        if (parts.length === 2 && parts[0] === 'Bearer') {
            token = parts[1];
        }
    }
    if (!token) {
        console.log(`No session token found for request: ${req.method} ${req.url}`);
        return res.status(401).json({ error: 'Unauthorized. login.' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await dbGet('SELECT id, username, email, avatar_url, role, is_suspended, suspension_reason, suspension_until, allowed_models, rate_limit_messages, rate_limit_tokens, can_manage_models, rate_limits_per_model FROM users WHERE id = ?', [decoded.id]);
        if (!user) {
            console.log(`User ID ${decoded.id} not found in database`);
            return res.status(401).json({ error: 'User not found.' });
        }

        if (user.is_suspended) {
            const now = new Date();
            const until = user.suspension_until ? new Date(user.suspension_until) : null;
            if (!until || until > now) {
                const reason = user.suspension_reason || 'No reason provided';
                const timeStr = until ? ` hasta el ${until.toLocaleString()}` : ' permanent';
                console.log(`Suspended user ID ${user.id} denied access to ${req.url}`);
                return res.status(403).json({ error: `Your account was suspended:${timeStr}. Reason: ${reason}` });
            } else {
                await dbRun('UPDATE users SET is_suspended = 0, suspension_reason = NULL, suspension_until = NULL WHERE id = ?', [user.id]);
                user.is_suspended = 0;
            }
        }

        console.log(`User "${user.username}" id: ${user.id}, role: ${user.role}) authenticated successfully.`);
        req.user = user;
        next();
    } catch (err) {
        console.error(err);
        res.status(401).json({ error: 'Unauthorized. login.' });
    }
};

// Auth

// Signup
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const adminCountRow = await dbGet('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
        const role = adminCountRow.count === 0 ? 'admin' : 'user';

        const result = await dbRun(
            'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
            [username.trim(), email.trim().toLowerCase(), passwordHash, role]
        );
        const token = jwt.sign({ id: result.lastID, email: email.trim().toLowerCase(), role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('samaipata_session', token, {
            httpOnly: true,
            secure: false, // ts will never be running through https
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.status(201).json({ token, id: result.lastID, username: username.trim(), email: email.trim().toLowerCase(), role });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }
        res.status(500).json({ error: 'Server error during registration.' });
    }
});

// Rate Limiter
const loginAttempts = new Map();
const loginLimiter = (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || [];
    const recentAttempts = attempts.filter(t => now - t < 15 * 60 * 1000);
    if (recentAttempts.length >= 5) {
        return res.status(429).json({ error: 'Too many login attempts try again in 15 minutes' });
    }
    recentAttempts.push(now);
    loginAttempts.set(ip, recentAttempts);
    next();
};

// Login

app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const identifier = (req.body.email || req.body.username || '').trim();
    const { password } = req.body;
    if (!identifier || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
        const user = await dbGet('SELECT * FROM users WHERE LOWER(email) = LOWER(?) OR LOWER(username) = LOWER(?)', [identifier, identifier]);
        if (!user) {
            return res.status(400).json({ error: 'User not found.' });
        }

        // suspension logic
        if (user.is_suspended) {
            const now = new Date();
            const until = user.suspension_until ? new Date(user.suspension_until) : null;
            if (!until || until > now) {
                const reason = user.suspension_reason || 'No reason provided';
                const timeStr = until ? ` until ${until.toLocaleString()}` : ' permanent';
                return res.status(403).json({ error: `Your account is suspended${timeStr}. Reason: ${reason}` });
            } else {
                // no more suspension for your bradar, lemme reinstalate you
                await dbRun('UPDATE users SET is_suspended = 0, suspension_reason = NULL, suspension_until = NULL WHERE id = ?', [user.id]);
                user.is_suspended = 0;
            }
        }
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(400).json({ error: 'Password incorrect.' });
        }

        // If there are no admins registered in the database, promote this user to admin
        const adminCountRow = await dbGet('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
        if (adminCountRow.count === 0 && user.role !== 'admin') {
            await dbRun('UPDATE users SET role = "admin" WHERE id = ?', [user.id]);
            user.role = 'admin';
        }

        // sign in user
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        // create cookie
        res.cookie('samaipata_session', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({ token, id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, role: user.role });
    } catch (err) {
        res.status(500).json({ error: 'Server error during registration.' });
    }
});

// Logout

app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('samaipata_session', { path: '/' });
    res.json({ message: 'Signed out succesfully' });
});

// Me
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    let userHackClubKey = null;
    try {
        const userRow = await dbGet('SELECT hackclub_api_key FROM users WHERE id = ?', [req.user.id]);
        userHackClubKey = userRow && userRow.hackclub_api_key;
    } catch (e) {}

    res.json({
       ...req.user,
       hasHackClubApiKey: !!(userHackClubKey || process.env.HACKCLUB_API_KEY || HACKCLUB_API_KEY)
    });
});

app.post('/api/user/hackclub-key', authenticateToken, async (req, res) => {
    const { apiKey } = req.body;
    try {
        await dbRun('UPDATE users SET hackclub_api_key = ? WHERE id = ?', [apiKey ? apiKey.trim() : null, req.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Zero Oauth
app.get('/api/auth/zero', async (req, res) => {
    const { reset } = req.query;
    if (reset === 'true') {
        try {
            await dbRun('DELETE FROM messages');
            await dbRun('DELETE FROM conversations');
            await dbRun('DELETE FROM users');
        } catch (err) {
            console.error('Error reseting db:', err);
        }
    }
    const authorizeUrl = `${ZERO_SERVER_URL}/oauth/authorize?client_id=${ZERO_CLIENT_ID}&redirect_uri=${encodeURIComponent(ZERO_REDIRECT_URI)}&response_type=code&state=samaipata_state`;
    res.redirect(authorizeUrl);
});

app.get('/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) {
        return res.redirect('/login.html?error' + encodeURIComponent(error));
    }
    if (!code) {
        return res.redirect('/login.html?error=missing_authorization_code');
    }

    try {
        const tokenResponse = await fetch(`${ZERO_SERVER_URL}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: ZERO_CLIENT_ID,
                client_secret: ZERO_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: ZERO_REDIRECT_URI,
            })
        });

        if (!tokenResponse.ok) {
            const errBody = await tokenResponse.text();
            console.error('Token exchange failed:', errBody);
            return res.redirect('/login.html?error=token_exchange_failed');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token || tokenData.accessToken;

        const profileResponse = await fetch(`${ZERO_SERVER_URL}/api/userinfo`, {
            headers: {'Authorization': `Bearer ${accessToken}`},
        });

        if (!profileResponse.ok) {
            console.error('userinfo failed');
            return res.redirect('/login.html?error=userinfo_fetch_Failed');
        }

        const zeroProfile = await profileResponse.json();
        const email = zeroProfile.email || '';
        const username = zeroProfile.username || zeroProfile.name || zeroProfile.preferred_username || (email ? email.split('@')[0] : user);
        const avatar_url = zeroProfile.avatar_url || zeroProfile.picture || '';

        let user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            const adminCountRow = await dbGet('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
            const role = adminCountRow.count === 0 ? 'admin' : 'user';

            const uniqueUsername = username + '_' + Math.random().toString(36).substring(2, 6);
            const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);
            const result = await dbRun(
                'INSERT INTO users (username, email, password_hash, avatar_url, role) VALUES (?, ?, ?, ?, ?)',
                [username || uniqueUsername, email, randomPasswordHash, avatar_url, role]
            );
            user = { id: result.lastID, username: username || uniqueUsername, email, avatar_url, role };
        } else if (avatar_url && user.avatar_url !== avatar_url) {
            await dbRun('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar_url, user.id]);
            user.avatar_url = avatar_url;
        }

        // create coooookieeeee 🍪🍪
        const localToken = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('samaipata_Session', localToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.redirect('/index.html?token=' + encodeURIComponent(localToken));
    } catch (err) {
        console.error('Error in oauth:', err);
        res.redirect('/login.html?error=oauth_error');
    }
});

// Admin stuff

// list users
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Administrator privileges are required.' });
    }
    try {
        const users = await dbAll('SELECT id, username, email, avatar_url, role, is_suspended, suspension_reason, suspension_until, allowed_models, rate_limit_messages, rate_limit_tokens, can_manage_models, rate_limits_per_model FROM users ORDER BY created_at ASC');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Error loading.' });
    }
});

// Fetch Admin System Analytics
app.get('/api/admin/analytics', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied.' });
    }
    const days = parseInt(req.query.days) || 7;
    const periodParam = `-${days} days`;

    try {
        const msgRow = await dbGet('SELECT COUNT(*) as count FROM messages WHERE created_at >= datetime("now", ?)', [periodParam]);
        const tokenRow = await dbGet('SELECT SUM(tokens) as count FROM messages WHERE created_at >= datetime("now", ?)', [periodParam]);
        const chatRow = await dbGet('SELECT COUNT(*) as count FROM conversations WHERE created_at >= datetime("now", ?)', [periodParam]);
        const userRow = await dbGet('SELECT COUNT(*) as count FROM users');

        // Timeline: Daily message distribution
        const timeline = await dbAll(`
            SELECT date(created_at) as date_str, COUNT(*) as count 
            FROM messages 
            WHERE role = 'user' AND created_at >= datetime("now", ?) 
            GROUP BY date(created_at) 
            ORDER BY date(created_at) ASC
        `, [periodParam]);

        // Model Usage details
        const modelUsage = await dbAll(`
            SELECT LOWER(c.model_name) as model_name, COUNT(m.id) as msg_count, COUNT(DISTINCT c.user_id) as user_count, COUNT(DISTINCT c.id) as chat_count, SUM(m.tokens) as total_tokens
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE m.created_at >= datetime("now", ?)
            GROUP BY LOWER(c.model_name)
            ORDER BY msg_count DESC
        `, [periodParam]);

        // User Activity details
        const userActivity = await dbAll(`
            SELECT u.username, u.email, u.avatar_url, COUNT(m.id) as msg_count, SUM(m.tokens) as total_tokens
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            JOIN users u ON c.user_id = u.id
            WHERE m.created_at >= datetime("now", ?)
            GROUP BY u.id
            ORDER BY msg_count DESC
        `, [periodParam]);

        res.json({
            stats: {
                messages: msgRow ? msgRow.count : 0,
                tokens: tokenRow ? (tokenRow.count || 0) : 0,
                chats: chatRow ? chatRow.count : 0,
                users: userRow ? userRow.count : 0
            },
            timeline,
            modelUsage,
            userActivity
        });
    } catch (err) {
        console.error('Failed to load admin analytics:', err);
        res.status(500).json({ error: 'Error generating analytics.' });
    }
});

// Submit User Model Feedback (Up/Down) & ELO rating modifier
app.post('/api/feedback', authenticateToken, async (req, res) => {
    const { model_name, rating, comment } = req.body;
    if (!model_name || !rating) {
        return res.status(400).json({ error: 'model_name and rating are required.' });
    }
    if (rating !== 'up' && rating !== 'down') {
        return res.status(400).json({ error: 'Rating must be either up or down.' });
    }

    try {
        // Log feedback
        await dbRun(
            'INSERT INTO feedback (user_id, username, model_name, rating, comment) VALUES (?, ?, ?, ?, ?)',
            [req.user.id, req.user.username, model_name, rating, comment || null]
        );

        // Update ELO rating
        const existingRating = await dbGet('SELECT * FROM model_ratings WHERE LOWER(model_name) = LOWER(?)', [model_name]);
        let currentElo = 1200;
        let wins = 0;
        let losses = 0;

        if (existingRating) {
            currentElo = existingRating.elo;
            wins = existingRating.wins;
            losses = existingRating.losses;
        }

        if (rating === 'up') {
            wins += 1;
            currentElo += 15;
        } else {
            losses += 1;
            currentElo -= 15;
        }

        if (existingRating) {
            await dbRun(
                'UPDATE model_ratings SET elo = ?, wins = ?, losses = ? WHERE LOWER(model_name) = LOWER(?)',
                [currentElo, wins, losses, model_name]
            );
        } else {
            await dbRun(
                'INSERT INTO model_ratings (model_name, elo, wins, losses) VALUES (?, ?, ?, ?)',
                [model_name, currentElo, wins, losses]
            );
        }

        res.json({ success: true, new_elo: currentElo });
    } catch (err) {
        console.error('Feedback rating submission failed:', err);
        res.status(500).json({ error: 'Error saving model rating.' });
    }
});

// Fetch ELO Leaderboard & User feedback list
app.get('/api/admin/evaluations', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied.' });
    }
    try {
        const ratingsRows = await dbAll('SELECT model_name, elo, wins, losses FROM model_ratings ORDER BY elo DESC');
        
        // Find all unique model names in conversation logs (to populate default 1200 ratings for untracked models)
        const activeModelsRows = await dbAll('SELECT DISTINCT LOWER(model_name) as model_name FROM conversations');
        
        const leaderboardMap = new Map();
        
        // Seed active conversation models
        activeModelsRows.forEach(row => {
            const name = row.model_name;
            if (name) {
                leaderboardMap.set(name, {
                    model_name: name,
                    elo: 1200,
                    wins: 0,
                    losses: 0
                });
            }
        });
        
        // Overlay explicit ELO votes
        ratingsRows.forEach(row => {
            const name = row.model_name.toLowerCase();
            leaderboardMap.set(name, {
                model_name: row.model_name,
                elo: row.elo,
                wins: row.wins,
                losses: row.losses
            });
        });
        
        const leaderboard = Array.from(leaderboardMap.values()).sort((a, b) => b.elo - a.elo);
        
        const feedback = await dbAll(`
            SELECT f.id, f.username, f.model_name, f.rating, f.comment, f.created_at, u.avatar_url 
            FROM feedback f 
            LEFT JOIN users u ON f.user_id = u.id 
            ORDER BY f.created_at DESC 
            LIMIT 50
        `);

        res.json({ leaderboard, feedback });
    } catch (err) {
        console.error('Failed to load evaluations:', err);
        res.status(500).json({ error: 'Error loading evaluations.' });
    }
});

// Update user details
app.post('/api/admin/users/:id/update', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied.' });
    }
    const targetId = parseInt(req.params.id);
    const { role, allowed_models, rate_limit_messages, rate_limit_tokens, can_manage_models, username, email, password, rate_limits_per_model } = req.body;

    try {
        const target = await dbGet('SELECT * FROM users WHERE id = ?', [targetId]);
        if (!target) return res.status(404).json({ error: 'User not found.' });

        // Cross-admin modification protection
        if (target.role === 'admin' && req.user.id !== targetId) {
            return res.status(403).json({ error: 'You do not have permission to modify the attributes of another Administrator.' });
        }

        // Limit rates formatting
        const limitMsgs = rate_limit_messages === '' || rate_limit_messages === null ? null : parseInt(rate_limit_messages);
        const limitTokens = rate_limit_tokens === '' || rate_limit_tokens === null ? null : parseInt(rate_limit_tokens);
        const manageModels = can_manage_models ? 1 : 0;

        // Process password change if provided
        let passHash = target.password_hash;
        if (password && password.trim() !== '') {
            passHash = await bcrypt.hash(password.trim(), 12);
        }

        await dbRun(`
            UPDATE users 
            SET role = ?, allowed_models = ?, rate_limit_messages = ?, rate_limit_tokens = ?, can_manage_models = ?, username = ?, email = ?, password_hash = ?, rate_limits_per_model = ?
            WHERE id = ?
        `, [
            role || target.role,
            allowed_models !== undefined ? allowed_models : target.allowed_models,
            limitMsgs,
            limitTokens,
            manageModels,
            username || target.username,
            email || target.email,
            passHash,
            rate_limits_per_model !== undefined ? rate_limits_per_model : target.rate_limits_per_model,
            targetId
        ]);

        res.json({ success: true });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'The username or email is already registered.' });
        }
        res.status(500).json({ error: 'Error updating user.' });
    }
});

// Suspend/Reactivate user
app.post('/api/admin/users/:id/suspend', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied.' });
    }

    const targetId = parseInt(req.params.id);
    const { is_suspended, suspension_reason, suspension_until } = req.body;

    try {
        const target = await dbGet('SELECT * FROM users WHERE id = ?', [targetId]);
        if (!target) return res.status(404).json({ error: 'User not found.' });

        if (target.role === 'admin') {
            return res.status(403).json({ error: 'Cannot suspend an Administrator account.' });
        }

        const suspendedVal = is_suspended ? 1 : 0;
        const untilVal = is_suspended && suspension_until ? suspension_until : null;
        const reasonVal = is_suspended ? (suspension_reason || 'Administrative suspension') : null;

        await dbRun(`
            UPDATE users 
            SET is_suspended = ?, suspension_reason = ?, suspension_until = ?
            WHERE id = ?
        `, [suspendedVal, reasonVal, untilVal, targetId]);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error changing suspension status.' });
    }
});

app.post('/api/images/generate', authenticateToken, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Image prompt is required' });

    try {
        const seed = Math.floor(Math.random() * 1000000);
        const cleanPrompt = prompt.replace(/[^a-zA-Z0-9\s,.-]/g, '');
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;

        res.json({ url: imageUrl });
    } catch (err) {
        console.error('Image generation error:', err);
        res.status(500).json({ error: 'Error generating image' });
    }
});

//  hackclub models
let cachedHackClubModels = null;
let lastHackClubFetchTime = 0;

async function getHackClubModels() {
    const now = Date.now();
    if (cachedHackClubModels && (now - lastHackClubFetchTime < 3600000)) {
        return cachedHackClubModels;
    }
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('https://ai.hackclub.com/proxy/v1/models', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.data)) {
                cachedHackClubModels = data.data.map(m => ({
                    id: m.id,
                    name: m.id,
                    displayName: m.name || m.id,
                    description: m.description || '',
                    context_length: m.context_length || 4096,
                    is_hackclub: true
                }));
                lastHackClubFetchTime = now;
                return cachedHackClubModels;
            }
        }
    } catch (e) {
        console.error("Failed to fetch hackclub models:", e.message);
    }
    return cachedHackClubModels || [];
}

app.get('/api/hackclub/models', authenticateToken, async (req, res) => {
    try {
        const models = await getHackClubModels();
        res.json(models);
    } catch (e) {
        res.status(500).json({ error: 'Failed to retrive models' });
    }
});

// ollama
app.get('/api/models', authenticateToken, async (req, res) => {
    try {
        let models = [];
        try {
            const response = await fetch(`${OLLAMA}/api/tags`);
            if (response.ok) {
                const data = await response.json();
                models = data.models || [];
            }
        } catch (e) {
            console.warn('Ollama offline, skipping local models');
        }

        const includeHackClub = req.query.hackclub === 'true';
        if (includeHackClub) {
            const hackClubModels = await getHackClubModels();
            const mapped = hackClubModels.map(m => ({
                name: m.name,
                is_hackclub: true,
                displayName: m.displayName
            }));
            models = [...models, ...mapped];
        }

        // Apply restrictions filter if currentUser allowed_models whitelist is set
        if (req.user.role !== 'admin' && req.user.allowed_models) {
            const allowed = req.user.allowed_models.split(',').map(m => m.trim().toLowerCase());
            models = models.filter(model => {
                return allowed.some(a => model.name.toLowerCase().startsWith(a));
            });
        }

        res.json(models);
    } catch (err) {
        res.status(500).json({ error: 'Could not fetch models. Is Ollama running?' });
    }
});


const FALLBACK_OLLAMA_MODELS = require('./fallback_models.json');

function mapOllamaApiModelToCatalog(apiModel) {
   const name = apiModel.model_identifier || apiModel.name || '';
   const title = apiModel.model_name || apiModel.title || name.toUpperCase();
   const desc = apiModel.description || apiModel.desc || '';
   const pulls = apiModel.pulls || 0;
   const downloads = pulls > 1000000 ? (pulls / 1000000).toFixed(1) + 'M' : pulls > 1000 ? (pulls / 1000).toFixed(0) + 'K' : pulls.toString();
   const lastUpdated = apiModel.last_updated_str || apiModel.last_updated || apiModel.updated || 'recently';
   const tags = Array.isArray(apiModel.labels) ? apiModel.labels : (Array.isArray(apiModel.tags) ? apiModel.tags : ['latest']);

   const variants = tags.map(tag => {
    let size = 'N/A';
    let context = '8K';
    let input = 'Text';
    const nameLower = name.toLowerCase();
    if (nameLower.includes('llava') || nameLower.includes('vision') || nameLower.includes('moondream') || nameLower.includes('minicpm')) {
        input = 'Text + Vision';
    }
    const tagLower = tag.toString().toLowerCase();
        if (tagLower.includes('671b')) {
            size = '404GB';
            context = '128K';
        } else if (tagLower.includes('405b')) {
            size = '240GB';
            context = '128K';
        } else if (tagLower.includes('70b') || tagLower.includes('72b')) {
            size = '42GB';
            context = '128K';
        } else if (tagLower.includes('32b')) {
            size = '20GB';
            context = '128K';
        } else if (tagLower.includes('14b') || tagLower.includes('12b') || tagLower.includes('13b') || tagLower.includes('11b')) {
            size = '9.0GB';
            context = '128K';
        } else if (tagLower.includes('7b') || tagLower.includes('8b') || tagLower.includes('9b')) {
            size = '4.7GB';
            context = '128K';
        } else if (tagLower.includes('3b') || tagLower.includes('4b')) {
            size = '2.4GB';
            context = '32K';
        } else if (tagLower.includes('1.5b') || tagLower.includes('2b')) {
            size = '1.1GB';
            context = '32K';
        } else if (tagLower.includes('270m') || tagLower.includes('500m') || tagLower.includes('0.5b') || tagLower.includes('1b')) {
            size = '350MB';
            context = '8K';
        } else {
            size = '4.5GB';
            context = '32K';
        }
        return   { tag: tag.toString(), size, context, input };
   });

   return {
    name,
    title,
    desc,
    downloads,
    updated: lastUpdated,
    category: name.includes('embed') ? 'Embeddings' : name.includes('vision') || name.includes('llava') ? 'Vision' : 'General',
    variants
   };
}

function mapAkazwzModelToCatalog(item) {
    const name = item.name || '';
    const title = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const desc = item.description || '';
    const downloads = 'N/A';
    const lastUpdated = 'recently';
    const tags = Array.isArray(item.tags) ? item.tags : ['latest'];

    const variants = tags.map(tag => {
        let size = 'N/A';
        let context = '8K';
        let input = 'Text';
        const nameLower = name.toLowerCase();
        if (nameLower.includes('llava') || nameLower.includes('vision') || nameLower.includes('moondream') || nameLower.includes('minicpm')) {
            input = 'Text + Vision';
        }
        const tagLower = tag.toString().toLowerCase();
        if (tagLower.includes('671b')) {
            size = '404GB';
            context = '128K';
        } else if (tagLower.includes('405b')) {
            size = '240GB';
            context = '128K';
        } else if (tagLower.includes('70b') || tagLower.includes('72b')) {
            size = '42GB';
            context = '128K';
        } else if (tagLower.includes('32b')) {
            size = '20GB';
            context = '128K';
        } else if (tagLower.includes('14b') || tagLower.includes('12b') || tagLower.includes('13b') || tagLower.includes('11b')) {
            size = '9.0GB';
            context = '128K';
        } else if (tagLower.includes('7b') || tagLower.includes('8b') || tagLower.includes('9b')) {
            size = '4.7GB';
            context = '128K';
        } else if (tagLower.includes('3b') || tagLower.includes('4b')) {
            size = '2.4GB';
            context = '32K';
        } else if (tagLower.includes('1.5b') || tagLower.includes('2b')) {
            size = '1.1GB';
            context = '32K';
        } else if (tagLower.includes('270m') || tagLower.includes('500m') || tagLower.includes('0.5b') || tagLower.includes('1b')) {
            size = '350MB';
            context = '8K';
        } else {
            size = '4.5GB';
            context = '32K';
        }
        return { tag: tag.toString(), size, context, input };
    });

    return {
        name,
        title,
        desc,
        downloads,
        updated: lastUpdated,
        category: name.includes('embed') ? 'Embeddings' : name.includes('vision') || name.includes('llava') ? 'Vision' : 'General',
        variants
    };
}

//marketplace fetch
app.get('/api/marketplace/models', authenticateToken, async (req, res) => {
    // try first api akazwz cloudflare worker
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://ollama-models.zwz.workers.dev', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error('Worker returned HTTP ' + response.status);
        const data = await response.json();
        const rawModels = Array.isArray(data) ? data : [];
        if (rawModels.length === 0) throw new Error('Empty model array from worker');

        console.log(`Successfully fetched ${rawModels.length} models from akazwk`);
        const mapped = rawModels.map(mapAkazwzModelToCatalog);
        return res.json(mapped);
    } catch (err) {
        console.warn('[1] Akazwz didnt work', err.message);
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://ollamadb.dev/api/v1/models?limit=1000', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error('API responded with error code ' + response.status);
        const data = await response.json();
        
        const rawModels = Array.isArray(data) ? data : (data.models || []);
        if (rawModels.length === 0) throw new Error('Empty model array received');

        console.log(`Successfully fetched ${rawModels.length} models from frefrik OllamaDB API`);
        const mapped = rawModels.map(mapOllamaApiModelToCatalog);
        return res.json(mapped);
    } catch (err) {
        console.warn(' [2[ Ollama Models api didnt work switching to fallback models', err.message);
    }

    // 3. Local fallback database
    const mappedFallback = FALLBACK_OLLAMA_MODELS.map(mapOllamaApiModelToCatalog);
    res.json(mappedFallback);
});

app.delete('/api/models/:name', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin' && !req.user.can_manage_models) {
        return res.status(403).json({ error: 'You do not have permision to delete a model' });
    }
    const { name } = req.params;
    try {
        const response = await fetch(`${OLLAMA}/api/delete`, {
            method: 'DELETE',
            body: JSON.stringify({ model: name })
        });
        if (response.ok) {
            res.json({ message: `Model ${name} deleted successfully` });
        } else {
            const errText = await response.text();
            res.status(400).json({ error: errText });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete model.' });
    }
});

app.post('/api/models/pull', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin' && !req.user.can_manage_models) {
        return res.status(403).json({ error: 'You dont have permission to download models'});

    }

    const { name } = req.body;
    if (!name) return res.status(403).json({ error: 'Model name is required' });
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    try {
        const response = await fetch(`${OLLAMA}/api/pull`, {
          method: 'POST',
          body: JSON.stringify({ name, stream: true })
        });

        if (!response.ok) {
            const errText = await response.text();
            res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
            return res.end();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.trim()) {
                    res.write(`data: ${line}\n\n`);
                }
            }
        }
        res.write(`data: ${JSON.stringify({ completed: true })}\n\n`);
        res.end();
    } catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

async function performWebSearch(query) {
    console.log('[DuckduckGo] Searching for:', query);
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch (url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (!response.ok) return [];
        const html = await response.text();
        const results = [];

        const resultBlockRegex = /<div class="result results_links[^"]*web-result\s*">([\s\S]*?)<\/div>\s*<\/div>/g;
        let match;
        let limit = 4;

        while ((match = resultBlockRegex.exec(html)) !== null && results.length < limit) {
            const block = match[1];

            const titleMatch = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
            const snippetMatch = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);

            if (titleMatch) {
                const link = titleMatch[1];
                const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
                const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';
                results.push({ title, link, snippet });
            }
        }
        return results;
    } catch (err) {
        console.error('[DuckduckGo] Failed search:', err);
        return [];
    }
}

async function getIpLocation(ip) {
    try {
        let queryIp = ip;
        if (ip === '::1' || ip == '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.')) {
            const ipRes = await fetch('https://api.ipify.org?format=json');
            if (ipRes.ok) {
                const ipData = await ipRes.json();
                queryIp = ipData.ip;
            }
        }

        const geoRes = await fetch(`https://freeipapi.com/api/json/${queryIp}`);
        if (geoRes.ok) {
            const geoData = await geoRes.json();
            return {
                ip: queryIp,
                city: geoData.cityName || 'City not found',
                region: geoData.regionName || 'Region not found',
                country: geoData.countryName || 'County not found'
            };
        }
    } catch (err) {
        console.error('[Ip Localization] Failed to get location:', err);
    }
    return {ip, city: 'Unknown', region: 'Unknown', country: 'Unknown'};
}   

async function extractAndStoreMemory(userId, userMsg, aiResponse, modelName) {
    try {
        let extractorModel = modelName;
        if (modelName.includes('/')) {
            try {
                const ollamaRes = await fetch(`${OLLAMA}/api/tags`);
                if (ollamaRes.ok) {
                    const data = await ollamaRes.json();
                    if (data.models && data.models.length > 0) {
                        extractorModel = data.models[0].name;
                    }
                }
            } catch (e) {
                // Ignore fallback tag load error
            }
        }

        const prompt = `Analyze the conversation turn. Extract key details or facts about the user (e.g. name, age, likes/dislikes, job, location, hobbies). Write them as short, singular, factual sentences starting with "The user...". If no new details are shared, output nothing. Do not repeat existing facts.
        User: ${userMsg}
        Assistant: ${aiResponse}
        Facts:`;

        const response = await fetch(`${OLLAMA}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: extractorModel,
                messages: [{ role: 'user', content: prompt }],
                stream: false
            })
        });

        if (!response.ok) return;
        const data = await response.json();
        const extracted = data.message.content.trim();

        if (extracted && extracted.length > 5 && !extracted.includes("nothing") && !extracted.includes("nothing new")) {
            const lines = extracted.split('\n').map(l => l.replace(/^[-*•\d.\s]+/, '').trim()).filter(l => l.length > 5);
            for (const line of lines) {
                if (line.toLowerCase().startsWith('the user')) {
                    // Check if fact already exists to prevent duplicate memory clutter
                    const exists = await dbGet('SELECT id FROM memories WHERE user_id = ? AND fact = ?', [userId, line]);
                    if (!exists) {
                        await dbRun('INSERT INTO memories (user_id, fact) VALUES (?, ?)', [userId, line]);
                        console.log(`[Memory Saved] user ${userId}: ${line}`);
                    }
                }
            }
        }
    } catch (err) {
        console.error('[Memory Extraction] Failed to extract memory:', err);
    }
}

async function retrieveMemories(userId) {
    try {
        const rows = await dbAll('SELECT fact FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
        if (rows.length === 0) return '';
        return rows.map(r => `- ${r.fact}`).join('\n');
    } catch (err) {
        return '';
    }
}

app.get('/api/conversations', authenticateToken, async (req, res) => {
    try {
        const sql = `
        SELECT c.*, MAX(m.created_at) as last_message_time
        FROM conversations c
        LEFT JOIN messages m ON c.id = m.conversation_id
        WHERE c.user_id = ?
        GROUP BY c.id
        ORDER BY COALESCE(last_message_time, c.created_at) DESC
        `;
        const list = await dbAll(sql, [req.user.id]);
        res.json(list);
    } catch (err) {
        console.error('[Conversations] Failed to retrieve:', err);
        res.status(500).json({ error: 'Failed to retrieve conversations.' });
    }
});

app.post('/api/conversations/import', authenticateToken, async (req, res) => {
    const { title, model_name, messages } = req.body;
    if (!title || !model_name || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Invalid backup data format'})
    }

    try {
        const convResult = await dbRun(
            'INSERT INTO conversations (user_id, title, model_name) VALUES (?,?,?)',
            [req.user.id, title, model_name]
        );
        const conversationId = convResult.lastID;

        for (const msg of messages) {
            await dbRun(
                'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
                [conversationId, msg.role, msg.content]
            );
        }
        res.json({ success: true, conversationId: conversationId });
    } catch (err) {
        console.error('Import conversation error:', err);
        res.status(500).json({ error: 'Failed to import conversation.' });
    }
});

app.get('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const conversation = await dbGet('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found.' });
        }

        const messages = await dbAll('SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', [req.params.id]);
        res.json({ conversation, messages });
    } catch (err) {
        console.error('Failed to retrieve conversation:', err);
        res.status(500).json({ error: 'Failed to retrieve conversation.' });
    }
});

app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const conversation = await dbGet('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found.' });
        }
        await dbRun('DELETE FROM conversations WHERE id = ?', [req.params.id]);
        await dbRun('DELETE FROM messages WHERE conversation_id = ?', [req.params.id]);
        res.json({ message: 'Conversation deleted'})
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete conversation.' });
    }
});

app.post('/api/chat', authenticateToken, async (req, res) => {
    const { model_name, message_content, web_search_enabled, memory_enabled, system_instruction } = req.body;
    let conversation_id = req.body.conversation_id;

    if (!model_name || !message_content) {
        return res.status(400).json({ error: 'model_name and message_content are required.' });
    }

    if (req.user.role !== 'admin' && req.user.allowed_models) {
        const allowed = req.user.allowed_models.split(',').map(m => m.trim().toLowerCase());
        if (!allowed.includes(model_name.trim().toLowerCase())) {
            return res.status(403).json({ error: `You do not have permission to use model: ${model_name}` });
        }
    }

    if (req.user.role !== 'admin' && req.user.rate_limits_per_model) {
        try {
            const modelLimits = JSON.parse(req.user.rate_limits_per_model);
            const matchedKey = Object.keys(modelLimits).find(k => k.toLowerCase() === model_name.toLowerCase());
            if (matchedKey) {
                const limits = modelLimits[matchedKey];
                
                if (limits.messages !== undefined && limits.messages !== null) {
                    const countRow = await dbGet(`
                        SELECT COUNT(*) as count 
                        FROM messages m 
                        JOIN conversations c ON m.conversation_id = c.id 
                        WHERE c.user_id = ? AND LOWER(c.model_name) = LOWER(?) AND m.role = 'user' AND m.created_at >= datetime('now', '-1 day')
                    `, [req.user.id, model_name]);
                    if (countRow && countRow.count >= limits.messages) {
                        return res.status(429).json({ error: `Message limit exceeded for model ${model_name} (${limits.messages} messages per day).` });
                    }
                }

                if (limits.tokens !== undefined && limits.tokens !== null) {
                    const tokensRow = await dbGet(`
                        SELECT SUM(tokens) as total_tokens 
                        FROM messages m 
                        JOIN conversations c ON m.conversation_id = c.id 
                        WHERE c.user_id = ? AND LOWER(c.model_name) = LOWER(?) AND m.created_at >= datetime('now', '-1 day')
                    `, [req.user.id, model_name]);
                    const currentUsed = (tokensRow && tokensRow.total_tokens) || 0;
                    if (currentUsed >= limits.tokens) {
                        return res.status(429).json({ error: `Token limit exceeded for model ${model_name} (${limits.tokens} tokens per day).` });
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing rate_limits_per_model JSON:', e);
        }
    }

    if (req.user.role !== 'admin' && req.user.rate_limit_messages !== null && req.user.rate_limit_messages !== undefined) {
        try {
            const countRow = await dbGet(`
                SELECT COUNT(*) as count 
                FROM messages m 
                JOIN conversations c ON m.conversation_id = c.id 
                WHERE c.user_id = ? AND m.role = 'user' AND m.created_at >= datetime('now', '-1 day')
            `, [req.user.id]);
            if (countRow && countRow.count >= req.user.rate_limit_messages) {
                return res.status(429).json({ error: `Daily AI message limit exceeded (${req.user.rate_limit_messages} messages per day).` });
            }
        } catch (err) {
            console.error('Rate limiting message check failed:', err);
        }
    }

    if (req.user.role !== 'admin' && req.user.rate_limit_tokens !== null && req.user.rate_limit_tokens !== undefined) {
        try {
            const tokensRow = await dbGet(`
                SELECT SUM(tokens) as total_tokens 
                FROM messages m 
                JOIN conversations c ON m.conversation_id = c.id 
                WHERE c.user_id = ? AND m.created_at >= datetime('now', '-1 day')
            `, [req.user.id]);
            const currentUsed = (tokensRow && tokensRow.total_tokens) || 0;
            if (currentUsed >= req.user.rate_limit_tokens) {
                return res.status(429).json({ error: `Daily AI token limit exceeded (${req.user.rate_limit_tokens} tokens per day).` });
            }
        } catch (err) {
            console.error('Rate limiting tokens check failed:', err);
        }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
        if (!conversation_id) {
            const title = message_content.substring(0, 30) + (message_content.length > 30 ? '...' : '');
            const result = await dbRun(
                'INSERT INTO conversations (user_id, title, model_name) VALUES (?, ?, ?)',
                [req.user.id, title, model_name]
            );
            conversation_id = result.lastID;
            res.write(`data: ${JSON.stringify({ conversation_id })}\n\n`);
        }

        const userTokens = Math.ceil(message_content.length / 4);
        await dbRun(
            'INSERT INTO messages (conversation_id, role, content, tokens) VALUES (?, ?, ?, ?)',
            [conversation_id, 'user', message_content, userTokens]
        );

        const historyRows = await dbAll(
            'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 20',
            [conversation_id]
        );
        historyRows.reverse();

        const memoryContext = memory_enabled !== false ? await retrieveMemories(req.user.id) : '';

        let searchContext = '';
        if (web_search_enabled) {
            res.write(`data: ${JSON.stringify({ search_status: 'searching' })}\n\n`);
            const searchResults = await performWebSearch(message_content);
            if (searchResults.length > 0) {
                searchContext = searchResults.map(r => `Title: ${r.title}\nLink: ${r.link}\nSnippet: ${r.snippet}`).join('\n\n');
                res.write(`data: ${JSON.stringify({ search_status: 'found', results: searchResults })}\n\n`);
            } else {
                res.write(`data: ${JSON.stringify({ search_status: 'no_results' })}\n\n`);
            }
        }

        const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const cleanIp = clientIp.split(',')[0].trim();
        const ipLocation = await getIpLocation(cleanIp);

        const messagesPayload = [];

        let basePrompt = system_instruction || `You are Samaipata, a highly helpful AI assistant. Your underlying AI model is "${model_name}" (if asked what model you are, you must state that you are "${model_name}"). Respond in detail. You have access to user profile details, memory, and web search contexts.
IMPORTANT: Do NOT plainly output or announce your metadata, model details, or user profile facts (such as the user's name, email, IP location, or memory facts) unless it is directly necessary or asked by the user. Do not state them plainly at the start of your response. Always refer to yourself as Samaipata when your name is needed.`;

        let systemPrompt = `${basePrompt}

[CURRENT USER PROFILE]
- Name/Username: ${req.user.username}
- Email: ${req.user.email}
- IP Address: ${ipLocation.ip}
- Approximate Location: ${ipLocation.city}, ${ipLocation.region}, ${ipLocation.country}`;

        if (memoryContext) {
            systemPrompt += `\n\n[USER FACTS IN MEMORY] (Details extracted from past conversations with this user. Use these details to customize your answers if helpful):\n${memoryContext}`;
        }
        if (searchContext) {
            systemPrompt += `\n\n[WEB SEARCH RESULTS] (Analyze these facts to answer accurately. Always cite relevant facts. Current Date: ${new Date().toISOString().split('T')[0]}):\n${searchContext}`;
        }

        messagesPayload.push({ role: 'system', content: systemPrompt });

        historyRows.forEach(row => {
            messagesPayload.push({ role: row.role, content: row.content });
        });

        const isHackClub = model_name.includes('/') || req.body.is_hackclub || req.body.isHackClub;
        let hackclubApiKey = req.body.hackclub_api_key || HACKCLUB_API_KEY;

        if (isHackClub) {
            if (!hackclubApiKey && req.user && req.user.id) {
                try {
                    const userRow = await dbGet('SELECT hackclub_api_key FROM users WHERE id = ?', [req.user.id]);
                    if (userRow && userRow.hackclub_api_key) hackclubApiKey = userRow.hackclub_api_key;
                } catch (e) {}
            }

            if (!hackclubApiKey) {
                res.write(`data: ${JSON.stringify({ error: 'Falta la API Key de Hack Club. Por favor configúrala en Configuración.' })}\n\n`);
                return res.end();
            }

            const startTime = Date.now();
            const hackClubRes = await fetch('https://ai.hackclub.com/proxy/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${hackclubApiKey}`
                },
                body: JSON.stringify({
                    model: model_name,
                    messages: messagesPayload.map(m => ({
                        role: m.role === 'system' ? 'system' : (m.role === 'assistant' ? 'assistant' : 'user'),
                        content: m.content
                    })),
                    stream: true
                })
            });

            if (!hackClubRes.ok) {
                const errText = await hackClubRes.text();
                let cleanError = `Error de API (${hackClubRes.status})`;
                try {
                    const parsedErr = JSON.parse(errText);
                    if (parsedErr.error && parsedErr.error.metadata && parsedErr.error.metadata.raw) {
                        try {
                            const rawErr = JSON.parse(parsedErr.error.metadata.raw);
                            if (rawErr.error && rawErr.error.message) {
                                cleanError = rawErr.error.message;
                            }
                        } catch (e) {}
                    }
                    if (cleanError === `Error de API (${hackClubRes.status})` && parsedErr.error && parsedErr.error.message) {
                        cleanError = parsedErr.error.message;
                    }
                } catch (e) {
                    cleanError = errText || cleanError;
                }
                res.write(`data: ${JSON.stringify({ error: cleanError })}\n\n`);
                return res.end();
            }

            const reader = hackClubRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullAiResponse = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    const cleanLine = line.trim();
                    if (!cleanLine) continue;
                    if (cleanLine.startsWith('data: ')) {
                        const rawData = cleanLine.substring(6).trim();
                        if (rawData === '[DONE]') continue;
                        try {
                            const parsed = JSON.parse(rawData);
                            if (parsed.choices && parsed.choices[0]) {
                                const delta = parsed.choices[0].delta || {};
                                const text = delta.content || delta.text || (parsed.choices[0].message && parsed.choices[0].message.content) || '';
                                if (text) {
                                    fullAiResponse += text;
                                    res.write(`data: ${JSON.stringify({ message: text, content: text })}\n\n`);
                                }
                            }
                        } catch (e) {
                        }
                    }
                }
            }

            const durationMs = Date.now() - startTime;
            const assistantTokens = Math.ceil(fullAiResponse.length / 4);
            await dbRun(
                'INSERT INTO messages (conversation_id, role, content, tokens) VALUES (?, ?, ?, ?)',
                [conversation_id, 'assistant', fullAiResponse, assistantTokens]
            );

            res.write(`data: ${JSON.stringify({ done: true, duration_ms: durationMs })}\n\n`);
            res.end();

            extractAndStoreMemory(req.user.id, message_content, fullAiResponse, model_name);
            return;
        }

        const startTime = Date.now();
        const ollamaRes = await fetch(`${OLLAMA}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: model_name,
                messages: messagesPayload,
                stream: true
            })
        });

        if (!ollamaRes.ok) {
            const errText = await ollamaRes.text();
            res.write(`data: ${JSON.stringify({ error: errText })}\n\n`);
            return res.end();
        }

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullAiResponse = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message && parsed.message.content) {
                            fullAiResponse += parsed.message.content;
                            res.write(`data: ${JSON.stringify({ content: parsed.message.content })}\n\n`);
                        }
                    } catch (e) {
                    }
                }
            }
        }

        const durationMs = Date.now() - startTime;

        const assistantTokens = Math.ceil(fullAiResponse.length / 4);
        await dbRun(
            'INSERT INTO messages (conversation_id, role, content, tokens) VALUES (?, ?, ?, ?)',
            [conversation_id, 'assistant', fullAiResponse, assistantTokens]
        );

        res.write(`data: ${JSON.stringify({ done: true, duration_ms: durationMs })}\n\n`);
        res.end();

        extractAndStoreMemory(req.user.id, message_content, fullAiResponse, model_name);

    } catch (err) {
        console.error('Chat routing error:', err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

app.get('api/memories', authenticateToken, async (req, res) => {
    try {
        const memories = await dbAll('SELECT fact, created_at FROM memories WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
        res.json(memories);
    } catch (err) {
        console.error('[memories] Failed to retrieve memories:', err);
        res.status(500).json({ error: 'Failed to retrieve memories.' });
    }
});


app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Stardance] https://stardance.hackclub.com/projects/38064`);
        console.log(`[Samaipata] http://localhost:${PORT}`);
        console.log(`[Samaipata Network] http://0.0.0.0:${PORT}`);
    });
}

module.exports = {
    app,
    db,
    dbGet,
    dbAll,
    dbRun,
    mapOllamaApiModelToCatalog,
    mapAkazwzModelToCatalog,
    getHackClubModels,
    FALLBACK_OLLAMA_MODELS,
    JWT_SECRET
};