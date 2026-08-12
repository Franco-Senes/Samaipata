require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 5000;

// Enforce secure JWT Secret Checks on startup
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        console.error('CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing in production!');
        process.exit(1);
    } else {
        console.warn('WARNING: JWT_SECRET environment variable is missing. Generating a secure dynamic session secret key...');
        JWT_SECRET = crypto.randomBytes(32).toString('hex');
    }
}

const OLLAMA = process.env.OLLAMA || process.env.OLLAMA_HOST || 'http://localhost:11434';
const ZERO_CLIENT_ID = process.env.ZERO_CLIENT_ID || '';
const ZERO_CLIENT_SECRET = process.env.ZERO_CLIENT_SECRET || '';
const ZERO_REDIRECT_URI = process.env.ZERO_REDIRECT_URI || 'http://localhost:5000/api/auth/zero/callback';
const ZERO_SERVER_URL = process.env.ZERO_SERVER_URL || 'https://zero.info.bo';
const HACKCLUB_API_KEY = process.env.HACKCLUB_API_KEY || '';

// Restricted CORS Whitelist mapping
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:5000', 'http://127.0.0.1:5000'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // Allow non-browser agents
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

// HTTP Request Logging Middleware
app.use((req, res, next) => {
    console.log(`[HTTP Request] ${req.method} ${req.url}`);
    next();
});

// Initialize SQLite Database
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening SQLite database:', err.message);
    } else {
        console.log('Connected to SQLite database at:', dbPath);
        createTables();
    }
});

function createTables() {
    db.serialize(() => {
        // Users Table
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
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Conversations Table
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

        // Messages Table
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

        // Memories Table (AI Memory capability)
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

        // Column migrations on existing database tables
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
                // Suppress columns already exist warnings
            });
        });
    });
}

// Database helper wrappers
const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) { err ? reject(err) : resolve(this); });
});

// Authentication Middleware
const authenticateToken = async (req, res, next) => {
    let token = req.cookies.samaipata_session;
    if (!token && req.headers.authorization) {
        const parts = req.headers.authorization.split(' ');
        if (parts.length === 2 && parts[0] === 'Bearer') {
            token = parts[1];
        }
    }
    if (!token) {
        console.log(`[Auth check] No session token found for request: ${req.method} ${req.url}`);
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await dbGet('SELECT id, username, email, avatar_url, role, is_suspended, suspension_reason, suspension_until, allowed_models, rate_limit_messages, rate_limit_tokens, can_manage_models, rate_limits_per_model FROM users WHERE id = ?', [decoded.id]);
        if (!user) {
            console.log(`[Auth check] User ID ${decoded.id} not found in database.`);
            return res.status(401).json({ error: 'User not found.' });
        }

        // Suspension Enforcement Check
        if (user.is_suspended) {
            const now = new Date();
            const until = user.suspension_until ? new Date(user.suspension_until) : null;
            if (!until || until > now) {
                const reason = user.suspension_reason || 'Sin razón especificada';
                const timeStr = until ? ` hasta el ${until.toLocaleString()}` : ' permanentemente';
                console.log(`[Auth check] Suspended user ID ${user.id} denied access to ${req.url}`);
                return res.status(403).json({ error: `Tu cuenta está suspendida${timeStr}. Motivo: ${reason}` });
            } else {
                // Suspension elapsed, reinstate user dynamically in DB
                await dbRun('UPDATE users SET is_suspended = 0, suspension_reason = NULL, suspension_until = NULL WHERE id = ?', [user.id]);
                user.is_suspended = 0;
            }
        }

        console.log(`[Auth check] User "${user.username}" (ID: ${user.id}, Role: ${user.role}) authenticated successfully.`);
        req.user = user;
        next();
    } catch (err) {
        console.error(`[Auth check] Token verification failed: ${err.message}`);
        res.status(403).json({ error: 'Invalid or expired session token.' });
    }
};

// --- AUTHENTICATION ROUTES ---

// Signup Route (Local)
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required.' });
    }
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        
        // Setup initial user as Admin if db users table is empty
        const countRow = await dbGet('SELECT COUNT(*) as count FROM users');
        const role = countRow.count === 0 ? 'admin' : 'user';

        const result = await dbRun(
            'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
            [username, email, passwordHash, role]
        );
        const token = jwt.sign({ id: result.lastID, email, role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('samaipata_session', token, {
            httpOnly: true,
            secure: false, // Set to true if running over HTTPS
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.status(201).json({ token, id: result.lastID, username, email, role });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username or Email already registered.' });
        }
        res.status(500).json({ error: 'Server error during registration.' });
    }
});

// Memory-based brute-force login rate limiter
const loginAttempts = new Map();
const loginLimiter = (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    const attempts = loginAttempts.get(ip) || [];
    // Filter attempts older than 15 minutes (15 * 60 * 1000 ms)
    const recentAttempts = attempts.filter(t => now - t < 15 * 60 * 1000);
    if (recentAttempts.length >= 5) {
        return res.status(429).json({ error: 'Too many login attempts. Please try again after 15 minutes.' });
    }
    recentAttempts.push(now);
    loginAttempts.set(ip, recentAttempts);
    next();
};

// Login Route (Local)
app.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    try {
        const user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            return res.status(400).json({ error: 'User not found.' });
        }

        // Enforce active suspensions check during login
        if (user.is_suspended) {
            const now = new Date();
            const until = user.suspension_until ? new Date(user.suspension_until) : null;
            if (!until || until > now) {
                const reason = user.suspension_reason || 'Sin razón especificada';
                const timeStr = until ? ` hasta el ${until.toLocaleString()}` : ' permanentemente';
                return res.status(403).json({ error: `Tu cuenta está suspendida${timeStr}. Motivo: ${reason}` });
            } else {
                // Suspension expired, reinstate user
                await dbRun('UPDATE users SET is_suspended = 0, suspension_reason = NULL, suspension_until = NULL WHERE id = ?', [user.id]);
                user.is_suspended = 0;
            }
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(400).json({ error: 'Incorrect password.' });
        }
        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('samaipata_session', token, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        res.json({ token, id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, role: user.role });
    } catch (err) {
        res.status(500).json({ error: 'Server error during login.' });
    }
});

// Logout Route
app.post('/api/auth/logout', (req, res) => {
    res.clearCookie('samaipata_session', { path: '/' });
    res.json({ message: 'Signed out successfully' });
});

// Me Route
app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({
        ...req.user,
        hasHackClubApiKey: !!(process.env.HACKCLUB_API_KEY || HACKCLUB_API_KEY)
    });
});

// --- ZERO OAUTH ROUTES ---

// Initiate Zero OAuth login
app.get('/api/auth/zero', async (req, res) => {
    const { reset } = req.query;
    if (reset === 'true') {
        try {
            await dbRun('DELETE FROM messages');
            await dbRun('DELETE FROM conversations');
            await dbRun('DELETE FROM users');
            console.log('Database tables cleared successfully via Zero OAuth reset parameter.');
        } catch (err) {
            console.error('Error resetting database:', err);
        }
    }
    const authorizeUrl = `${ZERO_SERVER_URL}/oauth/authorize?client_id=${ZERO_CLIENT_ID}&redirect_uri=${encodeURIComponent(ZERO_REDIRECT_URI)}&response_type=code&state=samaipata_state`;
    res.redirect(authorizeUrl);
});

// OAuth Callback Route
app.get('/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) {
        return res.redirect('/login.html?error=' + encodeURIComponent(error));
    }
    if (!code) {
        return res.redirect('/login.html?error=missing_authorization_code');
    }

    try {
        // Exchange code for token
        const tokenResponse = await fetch(`${ZERO_SERVER_URL}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: ZERO_CLIENT_ID,
                client_secret: ZERO_CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: ZERO_REDIRECT_URI
            })
        });

        if (!tokenResponse.ok) {
            const errBody = await tokenResponse.text();
            console.error('Zero token exchange failed:', errBody);
            return res.redirect('/login.html?error=token_exchange_failed');
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token || tokenData.accessToken;

        // Fetch User Profile from Zero
        const profileResponse = await fetch(`${ZERO_SERVER_URL}/api/userinfo`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!profileResponse.ok) {
            console.error('Zero userinfo request failed');
            return res.redirect('/login.html?error=userinfo_fetch_failed');
        }

        const zeroProfile = await profileResponse.json(); // Standard OIDC mapping fallback support
        const email = zeroProfile.email || '';
        const username = zeroProfile.username || zeroProfile.name || zeroProfile.preferred_username || (email ? email.split('@')[0] : 'user');
        const avatar_url = zeroProfile.avatar_url || zeroProfile.picture || '';

        // Find or create local user
        let user = await dbGet('SELECT * FROM users WHERE email = ?', [email]);
        if (!user) {
            // Setup initial user as Admin if db users table is empty
            const countRow = await dbGet('SELECT COUNT(*) as count FROM users');
            const role = countRow.count === 0 ? 'admin' : 'user';

            const uniqueUsername = username + '_' + Math.random().toString(36).substring(2, 6);
            const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);
            const result = await dbRun(
                'INSERT INTO users (username, email, password_hash, avatar_url, role) VALUES (?, ?, ?, ?, ?)',
                [username || uniqueUsername, email, randomPasswordHash, avatar_url, role]
            );
            user = { id: result.lastID, username: username || uniqueUsername, email, avatar_url, role };
        } else if (avatar_url && user.avatar_url !== avatar_url) {
            // Update avatar if changed
            await dbRun('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar_url, user.id]);
            user.avatar_url = avatar_url;
        }

        // Set local JWT session cookie
        const localToken = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.cookie('samaipata_session', localToken, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.redirect('/index.html?token=' + encodeURIComponent(localToken));
    } catch (err) {
        console.error('Error in Zero OAuth flow:', err);
        res.redirect('/login.html?error=oauth_error');
    }
});


// --- ADMIN USER MANAGEMENT ROUTES ---

// List all users
app.get('/api/admin/users', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied. Administrator privileges are required.' });
    }
    try {
        const users = await dbAll('SELECT id, username, email, avatar_url, role, is_suspended, suspension_reason, suspension_until, allowed_models, rate_limit_messages, rate_limit_tokens, can_manage_models, rate_limits_per_model FROM users ORDER BY created_at ASC');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'Error loading user list.' });
    }
});

// --- ADMIN SYSTEM ANALYTICS & MONITORING ENDPOINTS ---

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

// Delete user account
app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Access denied.' });
    }
    const targetId = parseInt(req.params.id);

    try {
        const target = await dbGet('SELECT * FROM users WHERE id = ?', [targetId]);
        if (!target) return res.status(404).json({ error: 'User not found.' });

        if (target.role === 'admin') {
            return res.status(403).json({ error: 'Cannot delete an Administrator account.' });
        }

        await dbRun('DELETE FROM users WHERE id = ?', [targetId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Error deleting user.' });
    }
});

// Generate Image Route
app.post('/api/images/generate', authenticateToken, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Image prompt is required.' });
    
    try {
        const seed = Math.floor(Math.random() * 1000000);
        // Clean special characters for pollinations URL path compatibility
        const cleanPrompt = prompt.replace(/[^a-zA-Z0-9\s,.-]/g, '');
        const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1024&height=1024&nologo=true&seed=${seed}`;
        
        res.json({ url: imageUrl });
    } catch (err) {
        console.error('Image generation error:', err);
        res.status(500).json({ error: 'Error generating image.' });
    }
});


// --- HACK CLUB AI MODELS CACHING & FETCHING ---
let cachedHackClubModels = null;
let lastHackClubFetchTime = 0;

async function getHackClubModels() {
    const now = Date.now();
    // Cache for 1 hour
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
        console.error("Failed to fetch Hack Club models:", e.message);
    }
    return cachedHackClubModels || [];
}

// Get all available Hack Club models (marketplace view)
app.get('/api/hackclub/models', authenticateToken, async (req, res) => {
    try {
        const models = await getHackClubModels();
        res.json(models);
    } catch (e) {
        res.status(500).json({ error: 'Failed to retrieve Hack Club models.' });
    }
});


// --- OLLAMA MODEL PROXY ROUTES ---

// List Models
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

// Curated Fallback list of popular Ollama Models matching frefrik/ollama-models-api schema
const FALLBACK_OLLAMA_MODELS = [
    {
        model_identifier: "llama3.3",
        model_name: "Llama 3.3",
        description: "New state-of-the-art 70B model from Meta, offering high performance for language tasks, reasoning, and coding.",
        pulls: 8500000,
        labels: ["70b"],
        last_updated: "2 weeks ago"
    },
    {
        model_identifier: "llama3.2",
        model_name: "Llama 3.2",
        description: "Meta's lightweight 1B and 3B models, optimized for low-latency on-device processing.",
        pulls: 9200000,
        labels: ["1b", "3b"],
        last_updated: "1 month ago"
    },
    {
        model_identifier: "llama3.2-vision",
        model_name: "Llama 3.2 Vision",
        description: "Multimodal 11B and 90B models from Meta, capable of visual reasoning and text generation.",
        pulls: 4800000,
        labels: ["11b", "90b"],
        last_updated: "1 month ago"
    },
    {
        model_identifier: "llama3.1",
        model_name: "Llama 3.1",
        description: "State-of-the-art Meta models available in 8B, 70B, and 405B parameter sizes, supporting 128K context window.",
        pulls: 18500000,
        labels: ["8b", "70b", "405b"],
        last_updated: "3 months ago"
    },
    {
        model_identifier: "llama3",
        model_name: "Llama 3",
        description: "Meta's highly capable openly available LLM suite offering superb code generation and reasoning.",
        pulls: 14000000,
        labels: ["8b", "70b"],
        last_updated: "6 months ago"
    },
    {
        model_identifier: "deepseek-r1",
        model_name: "DeepSeek-R1",
        description: "DeepSeek's first-generation reasoning models with performance matching OpenAI's o1.",
        pulls: 12000000,
        labels: ["1.5b", "7b", "8b", "14b", "32b", "70b", "671b"],
        last_updated: "1 week ago"
    },
    {
        model_identifier: "gemma3",
        model_name: "Gemma 3",
        description: "Google's latest family of lightweight, state-of-the-art open models built from the same research used to create Gemini.",
        pulls: 4300000,
        labels: ["270m", "4b", "12b", "27b"],
        last_updated: "3 days ago"
    },
    {
        model_identifier: "gemma2",
        model_name: "Gemma 2",
        description: "Google's highly efficient open model family featuring an advanced architecture for superior reasoning.",
        pulls: 5600000,
        labels: ["2b", "9b", "27b"],
        last_updated: "4 months ago"
    },
    {
        model_identifier: "gemma",
        model_name: "Gemma",
        description: "First-generation lightweight open models built by Google DeepMind.",
        pulls: 4100000,
        labels: ["2b", "7b"],
        last_updated: "9 months ago"
    },
    {
        model_identifier: "qwen2.5-coder",
        model_name: "Qwen 2.5 Coder",
        description: "Alibaba's premier code generation and reasoning model, highly optimized for developers.",
        pulls: 3100000,
        labels: ["0.5b", "1.5b", "3b", "7b", "14b", "32b"],
        last_updated: "1 month ago"
    },
    {
        model_identifier: "qwen2.5",
        model_name: "Qwen 2.5",
        description: "Alibaba's general reasoning and language understanding model family, with vast improvements in math and code.",
        pulls: 7400000,
        labels: ["0.5b", "1.5b", "3b", "7b", "14b", "32b", "72b"],
        last_updated: "1 month ago"
    },
    {
        model_identifier: "qwen",
        model_name: "Qwen",
        description: "Original multi-lingual large language model family developed by Alibaba Cloud.",
        pulls: 2300000,
        labels: ["0.5b", "1.8b", "4b", "7b", "14b", "72b"],
        last_updated: "10 months ago"
    },
    {
        model_identifier: "mistral",
        model_name: "Mistral",
        description: "Mistral - 7B dense transformer model, fast, high-quality, and highly customizable.",
        pulls: 6400000,
        labels: ["7b"],
        last_updated: "4 months ago"
    },
    {
        model_identifier: "mixtral",
        model_name: "Mixtral",
        description: "Mistral's high-quality sparse mixture of experts model (MoE) with open weights.",
        pulls: 3200000,
        labels: ["8x7b", "8x22b"],
        last_updated: "5 months ago"
    },
    {
        model_identifier: "mistral-nemo",
        model_name: "Mistral Nemo",
        description: "A state-of-the-art 12B parameter model built in collaboration with NVIDIA, featuring a 128K context window.",
        pulls: 1900000,
        labels: ["12b"],
        last_updated: "2 months ago"
    },
    {
        model_identifier: "phi4",
        model_name: "Phi-4",
        description: "Microsoft's state-of-the-art 14B parameter reasoning model focusing on high-quality synthetic data training.",
        pulls: 1500000,
        labels: ["14b"],
        last_updated: "3 weeks ago"
    },
    {
        model_identifier: "phi3",
        model_name: "Phi-3",
        description: "Microsoft's lightweight 3.8B and 14B parameter models showing exceptional reasoning benchmarks.",
        pulls: 2900000,
        labels: ["mini", "medium"],
        last_updated: "5 months ago"
    },
    {
        model_identifier: "codegemma",
        model_name: "CodeGemma",
        description: "Google's code-specialized models for code completion, generation, and multi-turn instruction chat.",
        pulls: 1800000,
        labels: ["2b", "7b"],
        last_updated: "6 months ago"
    },
    {
        model_identifier: "codellama",
        model_name: "Code Llama",
        description: "Meta's code-specialized model family built on top of Llama 2.",
        pulls: 4600000,
        labels: ["7b", "13b", "34b", "70b"],
        last_updated: "8 months ago"
    },
    {
        model_identifier: "command-r",
        model_name: "Command R",
        description: "Cohere's 35B model optimized for conversational interactions and Retrieval-Augmented Generation (RAG) tasks.",
        pulls: 1700000,
        labels: ["35b"],
        last_updated: "4 months ago"
    },
    {
        model_identifier: "command-r-plus",
        model_name: "Command R Plus",
        description: "Cohere's larger 104B model optimized for multilingual tasks, complex reasoning, and tool use.",
        pulls: 900000,
        labels: ["104b"],
        last_updated: "4 months ago"
    },
    {
        model_identifier: "aya",
        model_name: "Aya",
        description: "Cohere's multilingual model covering more than 23 languages, optimized for translation and dialogue.",
        pulls: 1200000,
        labels: ["8b", "35b"],
        last_updated: "2 months ago"
    },
    {
        model_identifier: "smollm2",
        model_name: "SmolLM2",
        description: "Hugging Face's family of lightweight models optimized for local on-device deployment.",
        pulls: 800000,
        labels: ["135m", "360m", "1.7b"],
        last_updated: "1 month ago"
    },
    {
        model_identifier: "tinyllama",
        model_name: "TinyLlama",
        description: "A compact 1.1B parameter Llama model pre-trained on 3 trillion tokens, ideal for fast and simple local tasks.",
        pulls: 3500000,
        labels: ["latest"],
        last_updated: "8 months ago"
    },
    {
        model_identifier: "starcoder2",
        model_name: "StarCoder 2",
        description: "The next-generation open code model trained on 80+ programming languages by BigCode.",
        pulls: 950000,
        labels: ["3b", "7b", "15b"],
        last_updated: "6 months ago"
    },
    {
        model_identifier: "dolphin-mixtral",
        model_name: "Dolphin Mixtral",
        description: "Uncensored MoE model based on Mixtral 8x7b, optimized by Eric Hartford.",
        pulls: 1500000,
        labels: ["8x7b", "8x22b"],
        last_updated: "6 months ago"
    },
    {
        model_identifier: "dolphin-llama3",
        model_name: "Dolphin Llama 3",
        description: "Eric Hartford's uncensored version of Meta's Llama 3 model.",
        pulls: 2100000,
        labels: ["8b", "70b"],
        last_updated: "5 months ago"
    },
    {
        model_identifier: "llava",
        model_name: "LLaVA",
        description: "Popular visual multimodal model bridging vision and language using CLIP vision encoders.",
        pulls: 3800000,
        labels: ["7b", "13b"],
        last_updated: "6 months ago"
    },
    {
        model_identifier: "minicpm-v",
        model_name: "MiniCPM-V",
        description: "An advanced visual model showing high performance in OCR, scene understanding, and multi-turn chat.",
        pulls: 600000,
        labels: ["latest"],
        last_updated: "1 month ago"
    },
    {
        model_identifier: "moondream",
        model_name: "Moondream",
        description: "A tiny multimodal model designed to run efficiently on mobile and edge devices.",
        pulls: 1400000,
        labels: ["latest"],
        last_updated: "2 weeks ago"
    },
    {
        model_identifier: "nomic-embed-text",
        model_name: "Nomic Embed Text",
        description: "Nomic's high-performance open-source text embedding model with an 8192 context length.",
        pulls: 2700000,
        labels: ["latest"],
        last_updated: "2 weeks ago"
    },
    {
        model_identifier: "bge-m3",
        model_name: "BGE-M3",
        description: "Beijing Academy of Artificial Intelligence's highly performant multilingual embedding model.",
        pulls: 900000,
        labels: ["latest"],
        last_updated: "3 months ago"
    },
    {
        model_identifier: "all-minilm",
        model_name: "All MiniLM",
        description: "Classic fast embedding model suitable for semantic search and simple document comparison.",
        pulls: 1600000,
        labels: ["latest"],
        last_updated: "7 months ago"
    },
    {
        model_identifier: "mxbai-embed-large",
        model_name: "Mxbai Embed Large",
        description: "Mixedbread AI's state-of-the-art text embedding model optimized for search relevance.",
        pulls: 1300000,
        labels: ["latest"],
        last_updated: "5 months ago"
    }
];

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
        if (tagLower.includes('1.5b') || tagLower.includes('2b')) {
            size = '1.1GB';
            context = '32K';
        } else if (tagLower.includes('3b') || tagLower.includes('4b')) {
            size = '2.4GB';
            context = '32K';
        } else if (tagLower.includes('7b') || tagLower.includes('8b') || tagLower.includes('9b')) {
            size = '4.7GB';
            context = '128K';
        } else if (tagLower.includes('14b') || tagLower.includes('12b')) {
            size = '9.0GB';
            context = '128K';
        } else if (tagLower.includes('32b')) {
            size = '20GB';
            context = '128K';
        } else if (tagLower.includes('70b') || tagLower.includes('72b')) {
            size = '42GB';
            context = '128K';
        } else if (tagLower.includes('671b')) {
            size = '404GB';
            context = '128K';
        } else if (tagLower.includes('270m') || tagLower.includes('500m') || tagLower.includes('0.5b')) {
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
        if (tagLower.includes('1.5b') || tagLower.includes('2b')) {
            size = '1.1GB';
            context = '32K';
        } else if (tagLower.includes('3b') || tagLower.includes('4b')) {
            size = '2.4GB';
            context = '32K';
        } else if (tagLower.includes('7b') || tagLower.includes('8b') || tagLower.includes('9b')) {
            size = '4.7GB';
            context = '128K';
        } else if (tagLower.includes('14b') || tagLower.includes('12b')) {
            size = '9.0GB';
            context = '128K';
        } else if (tagLower.includes('32b')) {
            size = '20GB';
            context = '128K';
        } else if (tagLower.includes('70b') || tagLower.includes('72b')) {
            size = '42GB';
            context = '128K';
        } else if (tagLower.includes('671b')) {
            size = '404GB';
            context = '128K';
        } else if (tagLower.includes('270m') || tagLower.includes('500m') || tagLower.includes('0.5b')) {
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

// Fetch Marketplace Models Proxy Endpoint with Triple Redundancy (Cloudflare Worker -> OllamaDB API -> Hardcoded fallback list)
app.get('/api/marketplace/models', authenticateToken, async (req, res) => {
    // 1. Try akazwz Cloudflare Worker
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://ollama-models.zwz.workers.dev', { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error('Worker returned HTTP ' + response.status);
        const data = await response.json();
        const rawModels = Array.isArray(data) ? data : [];
        if (rawModels.length === 0) throw new Error('Empty model array from worker');

        console.log(`Successfully fetched ${rawModels.length} models from akazwz Worker API`);
        const mapped = rawModels.map(mapAkazwzModelToCatalog);
        return res.json(mapped);
    } catch (err) {
        console.warn('akazwz Cloudflare Worker fetch failed:', err.message);
    }

    // 2. Try frefrik OllamaDB API
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
        console.warn('Ollama Models API request failed, using curated library fallback:', err.message);
    }

    // 3. Local fallback database
    const mappedFallback = FALLBACK_OLLAMA_MODELS.map(mapOllamaApiModelToCatalog);
    res.json(mappedFallback);
});

// Delete Model
app.delete('/api/models/:name', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin' && !req.user.can_manage_models) {
        return res.status(403).json({ error: 'You do not have permission to delete models.' });
    }
    const { name } = req.params;
    try {
        const response = await fetch(`${OLLAMA}/api/delete`, {
            method: 'DELETE',
            body: JSON.stringify({ model: name })
        });
        if (response.ok) {
            res.json({ message: `Model ${name} deleted successfully.` });
        } else {
            const errText = await response.text();
            res.status(400).json({ error: errText });
        }
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete model.' });
    }
});

// Pull (Download) Model with SSE streaming progress
app.post('/api/models/pull', authenticateToken, async (req, res) => {
    if (req.user.role !== 'admin' && !req.user.can_manage_models) {
        return res.status(403).json({ error: 'You do not have permission to download models.' });
    }
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Model name is required.' });

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
            buffer = lines.pop(); // Keep last incomplete line

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


// --- SEARCH ENGINE SCRAPER ---

async function performWebSearch(query) {
    console.log('Searching DuckDuckGo for:', query);
    try {
        const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (!response.ok) return [];

        const html = await response.text();
        const results = [];

        // Match result blocks
        // In DDG HTML:
        // <div class="result results_links results_links_deep web-result ">
        //   <a class="result__snippet" href="...">Snippet content...</a>
        // </div>
        const resultBlockRegex = /<div class="result results_links[^"]*web-result\s*">([\s\S]*?)<\/div>\s*<\/div>/g;
        let match;
        let limit = 4;

        while ((match = resultBlockRegex.exec(html)) !== null && results.length < limit) {
            const block = match[1];

            // Extract Title & Link
            const titleMatch = /<a class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
            // Extract Snippet
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
        console.error('Error scraping web search:', err);
        return [];
    }
}

// --- IP GEOLOCATION HELPER ---
async function getIpLocation(ip) {
    try {
        let queryIp = ip;
        if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.')) {
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
                city: geoData.cityName || 'Santa Cruz',
                region: geoData.regionName || 'Santa Cruz',
                country: geoData.countryName || 'Bolivia'
            };
        }
    } catch (err) {
        console.error('IP Geolocation failed:', err);
    }
    return { ip, city: 'Santa Cruz', region: 'Santa Cruz', country: 'Bolivia' };
}

// --- CHAT MEMORY AND COMPLETION ROUTINES ---

// Memory Extractor (runs in background)
async function extractAndStoreMemory(userId, userMsg, aiResponse, modelName) {
    try {
        let extractorModel = modelName;
        if (modelName.toLowerCase().startsWith('gemini-') || modelName.includes('/')) {
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
        console.error('Background memory extraction failed:', err);
    }
}

// Retrieve relevant memories as contextual text
async function retrieveMemories(userId) {
    try {
        const rows = await dbAll('SELECT fact FROM memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [userId]);
        if (rows.length === 0) return '';
        return rows.map(r => `- ${r.fact}`).join('\n');
    } catch (err) {
        return '';
    }
}

// Conversation History list (sorted by latest active message time)
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
        console.error('Fetch conversations error:', err);
        res.status(500).json({ error: 'Failed to retrieve conversations.' });
    }
});

// Import conversation history
app.post('/api/conversations/import', authenticateToken, async (req, res) => {
    const { title, model_name, messages } = req.body;
    if (!title || !model_name || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'Invalid backup data format.' });
    }

    try {
        // Insert conversation
        const convResult = await dbRun(
            'INSERT INTO conversations (user_id, title, model_name) VALUES (?, ?, ?)',
            [req.user.id, title, model_name]
        );
        const conversationId = convResult.lastID;

        // Insert messages sequentially
        for (const msg of messages) {
            await dbRun(
                'INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)',
                [conversationId, msg.role, msg.content]
            );
        }

        res.json({ success: true, conversation_id: conversationId });
    } catch (err) {
        console.error('Import conversation error:', err);
        res.status(500).json({ error: 'Failed to import conversation.' });
    }
});

// Single Conversation Details
app.get('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const conversation = await dbGet('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });

        const messages = await dbAll('SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC', [req.params.id]);
        res.json({ conversation, messages });
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve messages.' });
    }
});

// Clear/Delete conversation
app.delete('/api/conversations/:id', authenticateToken, async (req, res) => {
    try {
        const conversation = await dbGet('SELECT * FROM conversations WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });

        await dbRun('DELETE FROM conversations WHERE id = ?', [req.params.id]);
        res.json({ message: 'Conversation deleted.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete conversation.' });
    }
});

// Streaming Chat API (SSE)
app.post('/api/chat', authenticateToken, async (req, res) => {
    const { model_name, message_content, web_search_enabled, memory_enabled, system_instruction } = req.body;
    let conversation_id = req.body.conversation_id;

    if (!model_name || !message_content) {
        return res.status(400).json({ error: 'model_name and message_content are required.' });
    }

    // 1. Allowed Models Restriction Validation
    if (req.user.role !== 'admin' && req.user.allowed_models) {
        const allowed = req.user.allowed_models.split(',').map(m => m.trim().toLowerCase());
        if (!allowed.includes(model_name.trim().toLowerCase())) {
            return res.status(403).json({ error: `You do not have permission to use model: ${model_name}` });
        }
    }

    // 2. Per-Model Quotas Validation (Notebook specifications)
    if (req.user.role !== 'admin' && req.user.rate_limits_per_model) {
        try {
            const modelLimits = JSON.parse(req.user.rate_limits_per_model);
            const matchedKey = Object.keys(modelLimits).find(k => k.toLowerCase() === model_name.toLowerCase());
            if (matchedKey) {
                const limits = modelLimits[matchedKey];
                
                // Enforce message limits
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

                // Enforce token limits
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

    // 3. Daily Message Count Quota Limit Validation (Global)
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

    // 4. Daily Token Volume Quota Limit Validation (Global)
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
        // Create conversation if new
        if (!conversation_id) {
            const title = message_content.substring(0, 30) + (message_content.length > 30 ? '...' : '');
            const result = await dbRun(
                'INSERT INTO conversations (user_id, title, model_name) VALUES (?, ?, ?)',
                [req.user.id, title, model_name]
            );
            conversation_id = result.lastID;
            // Send conversation_id to client immediately in stream
            res.write(`data: ${JSON.stringify({ conversation_id })}\n\n`);
        }

        // Save User Message with calculated token size
        const userTokens = Math.ceil(message_content.length / 4);
        await dbRun(
            'INSERT INTO messages (conversation_id, role, content, tokens) VALUES (?, ?, ?, ?)',
            [conversation_id, 'user', message_content, userTokens]
        );

        // Fetch Conversation History (Latest 20 messages in chronological order)
        const historyRows = await dbAll(
            'SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 20',
            [conversation_id]
        );
        historyRows.reverse();

        // Fetch User Memory context (conditionally based on context toggle settings)
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

        // Retrieve client IP and geolocate
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const cleanIp = clientIp.split(',')[0].trim();
    const ipLocation = await getIpLocation(cleanIp);

    // Setup Ollama chat history payload
    const messagesPayload = [];

    // Build System Prompt
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

        // Push chat history
        historyRows.forEach(row => {
            messagesPayload.push({ role: row.role, content: row.content });
        });

        const isGemini = model_name.toLowerCase().startsWith('gemini-');
        const geminiApiKey = req.body.gemini_api_key;

        if (isGemini && geminiApiKey) {
            // Build Gemini Contents format
            const geminiContents = [];
            
            // Map message history (role must be "user" or "model")
            historyRows.forEach(row => {
                const role = row.role === 'assistant' ? 'model' : 'user';
                geminiContents.push({
                    role: role,
                    parts: [{ text: row.content }]
                });
            });

            const startTime = Date.now();
            const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model_name}:streamGenerateContent?key=${geminiApiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: geminiContents,
                    systemInstruction: {
                        parts: [{ text: systemPrompt }]
                    }
                })
            });

            if (!geminiRes.ok) {
                const errText = await geminiRes.text();
                res.write(`data: ${JSON.stringify({ error: `Error de API Gemini: ${errText}` })}\n\n`);
                return res.end();
            }

            const reader = geminiRes.body.getReader();
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
                        let cleanLine = line.trim();
                        if (cleanLine.startsWith(',')) cleanLine = cleanLine.substring(1).trim();
                        if (cleanLine.startsWith('[')) cleanLine = cleanLine.substring(1).trim();
                        if (cleanLine.endsWith(']')) cleanLine = cleanLine.substring(0, cleanLine.length - 1).trim();

                        try {
                            const parsed = JSON.parse(cleanLine);
                            if (parsed.candidates && parsed.candidates[0].content && parsed.candidates[0].content.parts[0].text) {
                                const text = parsed.candidates[0].content.parts[0].text;
                                fullAiResponse += text;
                                res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
                            }
                        } catch (e) {
                            // ignore line chunk format error
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
            
            // Extract memory in background
            extractAndStoreMemory(req.user.id, message_content, fullAiResponse, model_name);
            return;
        }

        const isHackClub = model_name.includes('/') || req.body.is_hackclub;
        const hackclubApiKey = req.body.hackclub_api_key || HACKCLUB_API_KEY;

        if (isHackClub) {
            if (!hackclubApiKey) {
                res.write(`data: ${JSON.stringify({ error: 'Hack Club API Key is missing. Please configure it in Settings.' })}\n\n`);
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
                res.write(`data: ${JSON.stringify({ error: `Error de API Hack Club: ${errText}` })}\n\n`);
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
                            if (parsed.choices && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                                const text = parsed.choices[0].delta.content;
                                fullAiResponse += text;
                                res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
                            }
                        } catch (e) {
                            // ignore format error
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

            // Extract memory in background
            extractAndStoreMemory(req.user.id, message_content, fullAiResponse, model_name);
            return;
        }

        // Query Ollama API (streaming)
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
            buffer = lines.pop(); // Keep last incomplete line

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const parsed = JSON.parse(line);
                        if (parsed.message && parsed.message.content) {
                            fullAiResponse += parsed.message.content;
                            res.write(`data: ${JSON.stringify({ content: parsed.message.content })}\n\n`);
                        }
                    } catch (e) {
                        // In case parsing fails for a non-JSON chunk
                    }
                }
            }
        }

        const durationMs = Date.now() - startTime;

        // Save AI response to messages table with computed token size
        const assistantTokens = Math.ceil(fullAiResponse.length / 4);
        await dbRun(
            'INSERT INTO messages (conversation_id, role, content, tokens) VALUES (?, ?, ?, ?)',
            [conversation_id, 'assistant', fullAiResponse, assistantTokens]
        );

        // Send finished notification with total generation time
        res.write(`data: ${JSON.stringify({ done: true, duration_ms: durationMs })}\n\n`);
        res.end();

        // Extract memory in background (asynchronously)
        extractAndStoreMemory(req.user.id, message_content, fullAiResponse, model_name);

    } catch (err) {
        console.error('Chat routing error:', err);
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
    }
});

// --- MEMORY ROUTES ---
app.get('/api/memories', authenticateToken, async (req, res) => {
    try {
        const memories = await dbAll('SELECT id, fact, created_at FROM memories WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
        res.json(memories);
    } catch (err) {
        res.status(500).json({ error: 'Failed to retrieve memories.' });
    }
});

app.delete('/api/memories/:id', authenticateToken, async (req, res) => {
    try {
        await dbRun('DELETE FROM memories WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        res.json({ message: 'Memory fact deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete memory.' });
    }
});

// Serve Static files for public site
app.use(express.static(path.join(__dirname, 'public')));

// Catch all other requests and send back frontend app
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Samaipata server is running on http://localhost:${PORT}`);
    console.log(`Exposed on your local network: http://0.0.0.0:${PORT}`);
});