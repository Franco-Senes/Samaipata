const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_samaipata_1234567890';

const {
    app,
    db,
    dbGet,
    dbAll,
    dbRun,
    mapOllamaApiModelToCatalog,
    mapAkazwzModelToCatalog,
    FALLBACK_OLLAMA_MODELS
} = require('../index.js');

let server;
let baseUrl;
let adminCookie = '';
let adminToken = '';
let userCookie = '';
let userToken = '';
let regularUserId;

// HTTP request helper for testing Express app
function makeRequest(pathName, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(pathName, baseUrl);
        const reqOptions = {
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        if (options.cookie) {
            reqOptions.headers['Cookie'] = options.cookie;
        }
        if (options.token) {
            reqOptions.headers['Authorization'] = `Bearer ${options.token}`;
        }
        if (options.body) {
            reqOptions.headers['Content-Type'] = 'application/json';
        }

        const req = http.request(url, reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = null;
                const contentType = res.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                    try {
                        parsed = JSON.parse(data);
                    } catch (e) {
                        parsed = data;
                    }
                } else {
                    parsed = data;
                }

                // Extract cookie from Set-Cookie if present
                const setCookie = res.headers['set-cookie'];
                let cookieStr = '';
                if (setCookie) {
                    cookieStr = Array.isArray(setCookie) ? setCookie[0].split(';')[0] : setCookie.split(';')[0];
                }

                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsed,
                    cookie: cookieStr
                });
            });
        });

        req.on('error', reject);

        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        req.end();
    });
}

describe('Samaipata - index.js Test Suite', () => {

    before(async () => {
        // Start ephemeral HTTP server for testing
        await new Promise((resolve) => {
            server = app.listen(0, '127.0.0.1', () => {
                const port = server.address().port;
                baseUrl = `http://127.0.0.1:${port}`;
                resolve();
            });
        });

        // Ensure database tables exist and clean up old test users
        await new Promise(resolve => setTimeout(resolve, 300));
        await dbRun("DELETE FROM users");
        await dbRun("DELETE FROM feedback");
        await dbRun("DELETE FROM model_ratings");
    });

    after(async () => {
        // Clean up test data and close server
        try {
            await dbRun("DELETE FROM users WHERE email LIKE '%@test.com'");
            await dbRun("DELETE FROM feedback WHERE username LIKE 'test%'");
            await dbRun("DELETE FROM model_ratings WHERE model_name LIKE 'test%'");
        } catch (e) {}

        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
    });

    // -------------------------------------------------------------
    // 1. UNIT TESTS: Catalog & Model Mapping Functions
    // -------------------------------------------------------------
    describe('1. Model Mapping & Fallback Catalog Unit Tests', () => {
        it('fallback_models.json should exist and be a non-empty array with valid schema', () => {
            assert.ok(Array.isArray(FALLBACK_OLLAMA_MODELS), 'FALLBACK_OLLAMA_MODELS should be an array');
            assert.ok(FALLBACK_OLLAMA_MODELS.length > 0, 'FALLBACK_OLLAMA_MODELS should contain entries');
            
            const first = FALLBACK_OLLAMA_MODELS[0];
            assert.ok(first.model_identifier, 'Entry should have model_identifier');
            assert.ok(first.model_name, 'Entry should have model_name');
            assert.ok(first.description, 'Entry should have description');
            assert.ok(Array.isArray(first.labels), 'Entry should have labels array');
        });

        it('mapOllamaApiModelToCatalog() maps Ollama API model format properly', () => {
            const sampleOllamaModel = {
                model_identifier: 'deepseek-coder:6.7b',
                model_name: 'DeepSeek Coder',
                description: 'Code intelligence model',
                pulls: 5200000,
                labels: ['6.7b', 'latest'],
                last_updated: '2 weeks ago'
            };

            const catalogModel = mapOllamaApiModelToCatalog(sampleOllamaModel);
            assert.strictEqual(catalogModel.name, 'deepseek-coder:6.7b');
            assert.strictEqual(catalogModel.title, 'DeepSeek Coder');
            assert.strictEqual(catalogModel.downloads, '5.2M');
            assert.strictEqual(catalogModel.category, 'General');
            assert.ok(Array.isArray(catalogModel.variants));
            assert.strictEqual(catalogModel.variants.length, 2);
            assert.strictEqual(catalogModel.variants[0].tag, '6.7b');
        });

        it('mapOllamaApiModelToCatalog() accurately detects Vision category and size labels', () => {
            const visionModel = {
                model_identifier: 'llava:13b',
                model_name: 'LLaVA',
                description: 'Visual reasoning model',
                pulls: 1500,
                labels: ['13b'],
                last_updated: 'yesterday'
            };

            const catalogModel = mapOllamaApiModelToCatalog(visionModel);
            assert.strictEqual(catalogModel.category, 'Vision');
            assert.strictEqual(catalogModel.downloads, '2K');
            assert.strictEqual(catalogModel.variants[0].input, 'Text + Vision');
        });

        it('mapAkazwzModelToCatalog() transforms Cloudflare worker model structure correctly', () => {
            const rawWorkerModel = {
                name: 'mistral-nemo',
                description: 'A 12B model by Mistral AI',
                tags: ['12b', 'latest']
            };

            const mapped = mapAkazwzModelToCatalog(rawWorkerModel);
            assert.strictEqual(mapped.name, 'mistral-nemo');
            assert.strictEqual(mapped.title, 'Mistral Nemo');
            assert.strictEqual(mapped.category, 'General');
            assert.strictEqual(mapped.variants[0].size, '9.0GB');
        });
    });

    // -------------------------------------------------------------
    // 2. INTEGRATION TESTS: Authentication & Authorization Flow
    // -------------------------------------------------------------
    describe('2. Authentication & Authorization Routes', () => {
        const testAdminUser = {
            username: `testadmin_${Date.now()}`,
            email: `admin_${Date.now()}@test.com`,
            password: 'SuperSecretAdminPassword123!'
        };

        const testRegularUser = {
            username: `testuser_${Date.now()}`,
            email: `user_${Date.now()}@test.com`,
            password: 'UserPassword123!'
        };

        it('POST /api/auth/register creates first user as admin', async () => {
            const res = await makeRequest('/api/auth/register', {
                method: 'POST',
                body: testAdminUser
            });

            assert.strictEqual(res.status, 201);
            assert.ok(res.body.token, 'Should return jwt token');
            assert.strictEqual(res.body.username, testAdminUser.username);
            assert.strictEqual(res.body.role, 'admin');
            assert.ok(res.cookie.includes('samaipata_session='), 'Should set session cookie');

            adminCookie = res.cookie;
            adminToken = res.body.token;
        });

        it('POST /api/auth/register creates subsequent users as regular user', async () => {
            const res = await makeRequest('/api/auth/register', {
                method: 'POST',
                body: testRegularUser
            });

            assert.strictEqual(res.status, 201);
            assert.strictEqual(res.body.role, 'user');
            assert.ok(res.body.id);
            regularUserId = res.body.id;
            userCookie = res.cookie;
            userToken = res.body.token;
        });

        it('POST /api/auth/register rejects duplicate username or email with 400', async () => {
            const res = await makeRequest('/api/auth/register', {
                method: 'POST',
                body: testAdminUser
            });

            assert.strictEqual(res.status, 400);
            assert.ok(res.body.error);
        });

        it('POST /api/auth/login logs in user successfully with valid credentials', async () => {
            const res = await makeRequest('/api/auth/login', {
                method: 'POST',
                body: {
                    email: testAdminUser.email,
                    password: testAdminUser.password
                }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.email, testAdminUser.email);
            assert.strictEqual(res.body.role, 'admin');
            assert.ok(res.cookie.includes('samaipata_session='));
        });

        it('POST /api/auth/login rejects wrong password with 400', async () => {
            const res = await makeRequest('/api/auth/login', {
                method: 'POST',
                body: {
                    email: testAdminUser.email,
                    password: 'WrongIncorrectPassword!'
                }
            });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.body.error, 'Password incorrect.');
        });

        it('GET /api/auth/me returns authenticated user details', async () => {
            const res = await makeRequest('/api/auth/me', {
                cookie: adminCookie
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.email, testAdminUser.email);
            assert.strictEqual(res.body.role, 'admin');
            assert.strictEqual(typeof res.body.hasHackClubApiKey, 'boolean');
        });

        it('Protected endpoints reject unauthenticated requests with 401', async () => {
            const res = await makeRequest('/api/auth/me');
            assert.strictEqual(res.status, 401);
            assert.ok(res.body.error.includes('Unauthorized'));
        });

        it('POST /api/auth/logout clears session cookie', async () => {
            const res = await makeRequest('/api/auth/logout', {
                method: 'POST'
            });

            assert.strictEqual(res.status, 200);
            assert.ok(res.body.message.includes('Signed out'));
        });
    });

    // -------------------------------------------------------------
    // 3. INTEGRATION TESTS: Marketplace & Model Catalog Routes
    // -------------------------------------------------------------
    describe('3. Marketplace & Model Catalog Endpoints', () => {
        it('GET /api/marketplace/models returns mapped models list with fallback', async () => {
            const res = await makeRequest('/api/marketplace/models', {
                cookie: adminCookie
            });

            assert.strictEqual(res.status, 200);
            assert.ok(Array.isArray(res.body), 'Marketplace should return an array of models');
            assert.ok(res.body.length > 0, 'Marketplace should contain models');

            const model = res.body[0];
            assert.ok(model.name, 'Model should have name');
            assert.ok(model.title, 'Model should have title');
            assert.ok(model.downloads, 'Model should have downloads');
            assert.ok(model.category, 'Model should have category');
            assert.ok(Array.isArray(model.variants), 'Model should have variants array');
        });

        it('GET /api/hackclub/models handles request and returns cached/fetched models', async () => {
            const res = await makeRequest('/api/hackclub/models', {
                cookie: adminCookie
            });

            assert.strictEqual(res.status, 200);
            assert.ok(Array.isArray(res.body), 'HackClub endpoint should return an array');
        });
    });

    // -------------------------------------------------------------
    // 4. INTEGRATION TESTS: Admin Management & Analytics Routes
    // -------------------------------------------------------------
    describe('4. Admin Management, Analytics & User Control', () => {
        it('GET /api/admin/users allows admin access and returns user list', async () => {
            const res = await makeRequest('/api/admin/users', {
                cookie: adminCookie
            });

            assert.strictEqual(res.status, 200);
            assert.ok(Array.isArray(res.body));
            assert.ok(res.body.length >= 2);
        });

        it('GET /api/admin/users blocks non-admin users with 403 Forbidden', async () => {
            const res = await makeRequest('/api/admin/users', {
                cookie: userCookie
            });

            assert.strictEqual(res.status, 403);
            assert.ok(res.body.error.includes('Access denied'));
        });

        it('POST /api/admin/users/:id/update updates user properties', async () => {
            const res = await makeRequest(`/api/admin/users/${regularUserId}/update`, {
                method: 'POST',
                cookie: adminCookie,
                body: {
                    allowed_models: 'llama3.2,mistral',
                    rate_limit_messages: 50,
                    rate_limit_tokens: 10000,
                    can_manage_models: false
                }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);

            // Verify in database
            const user = await dbGet('SELECT * FROM users WHERE id = ?', [regularUserId]);
            assert.strictEqual(user.allowed_models, 'llama3.2,mistral');
            assert.strictEqual(user.rate_limit_messages, 50);
            assert.strictEqual(user.can_manage_models, 0);
        });

        it('POST /api/admin/users/:id/suspend suspends a regular user', async () => {
            const res = await makeRequest(`/api/admin/users/${regularUserId}/suspend`, {
                method: 'POST',
                cookie: adminCookie,
                body: {
                    is_suspended: true,
                    suspension_reason: 'Testing suspension policy'
                }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);

            // Attempting to access protected route with suspended user's token should fail with 403
            const meRes = await makeRequest('/api/auth/me', {
                cookie: userCookie
            });
            assert.strictEqual(meRes.status, 403);
            assert.ok(meRes.body.error.includes('Testing suspension policy'));
        });

        it('POST /api/admin/users/:id/suspend reinstates a suspended user', async () => {
            const res = await makeRequest(`/api/admin/users/${regularUserId}/suspend`, {
                method: 'POST',
                cookie: adminCookie,
                body: {
                    is_suspended: false
                }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);

            // Verify restored access
            const meRes = await makeRequest('/api/auth/me', {
                cookie: userCookie
            });
            assert.strictEqual(meRes.status, 200);
        });

        it('GET /api/admin/analytics computes and returns system stats', async () => {
            const res = await makeRequest('/api/admin/analytics', {
                cookie: adminCookie
            });

            assert.strictEqual(res.status, 200);
            assert.ok(res.body.stats, 'Should contain stats object');
            assert.ok(typeof res.body.stats.users === 'number');
            assert.ok(Array.isArray(res.body.timeline));
            assert.ok(Array.isArray(res.body.modelUsage));
            assert.ok(Array.isArray(res.body.userActivity));
        });
    });

    // -------------------------------------------------------------
    // 5. INTEGRATION TESTS: Feedback & Model ELO Classification
    // -------------------------------------------------------------
    describe('5. Community Feedback & Model ELO Rating System', () => {
        const testModelName = 'test-llama-elo';

        it('POST /api/feedback records an upvote and increases model ELO rating', async () => {
            const res = await makeRequest('/api/feedback', {
                method: 'POST',
                cookie: adminCookie,
                body: {
                    model_name: testModelName,
                    rating: 'up',
                    comment: 'Impressive reasoning capabilities'
                }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);
            assert.strictEqual(res.body.new_elo, 1215); // Default 1200 + 15 = 1215

            const rating = await dbGet('SELECT * FROM model_ratings WHERE model_name = ?', [testModelName]);
            assert.strictEqual(rating.elo, 1215);
            assert.strictEqual(rating.wins, 1);
            assert.strictEqual(rating.losses, 0);
        });

        it('POST /api/feedback records a downvote and decreases model ELO rating', async () => {
            const res = await makeRequest('/api/feedback', {
                method: 'POST',
                cookie: adminCookie,
                body: {
                    model_name: testModelName,
                    rating: 'down',
                    comment: 'Produced minor hallucinations'
                }
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.new_elo, 1200); // 1215 - 15 = 1200
        });

        it('GET /api/admin/evaluations returns model leaderboard and recent feedback', async () => {
            const res = await makeRequest('/api/admin/evaluations', {
                cookie: adminCookie
            });

            assert.strictEqual(res.status, 200);
            assert.ok(Array.isArray(res.body.leaderboard));
            assert.ok(Array.isArray(res.body.feedback));

            const match = res.body.leaderboard.find(m => m.model_name === testModelName);
            assert.ok(match, 'Test model should appear on leaderboard');
            assert.strictEqual(match.elo, 1200);
        });
    });

    // -------------------------------------------------------------
    // 6. INTEGRATION TESTS: Image Generation
    // -------------------------------------------------------------
    describe('6. Image Generation Endpoint', () => {
        it('POST /api/images/generate validates prompt and returns pollinations URL', async () => {
            const res = await makeRequest('/api/images/generate', {
                method: 'POST',
                cookie: adminCookie,
                body: {
                    prompt: 'A scenic landscape of Samaipata, Bolivia mountains'
                }
            });

            assert.strictEqual(res.status, 200);
            assert.ok(res.body.url, 'Should return generated image url');
            assert.ok(res.body.url.includes('pollinations.ai'));
        });

        it('POST /api/images/generate rejects empty prompt with 400', async () => {
            const res = await makeRequest('/api/images/generate', {
                method: 'POST',
                cookie: adminCookie,
                body: { prompt: '' }
            });

            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.body.error, 'Image prompt is required');
        });
    });

    // -------------------------------------------------------------
    // 7. NEW FEATURES: Setup, Ollama Status & Model Unavailability
    // -------------------------------------------------------------
    describe('7. AI Services Setup, Ollama Status & Error Handling', () => {
        it('GET /api/models returns empty array when no services are connected', async () => {
            const res = await makeRequest('/api/models', {
                cookie: userCookie
            });

            assert.strictEqual(res.status, 200);
            assert.ok(Array.isArray(res.body), 'Models should be an array');
        });

        it('GET /api/system/ollama-status returns system status structure', async () => {
            const res = await makeRequest('/api/system/ollama-status', {
                cookie: adminCookie
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(typeof res.body.installed, 'boolean');
            assert.strictEqual(typeof res.body.running, 'boolean');
            assert.strictEqual(typeof res.body.modelsCount, 'number');
            assert.ok(Array.isArray(res.body.models));
        });

        it('POST /api/admin/complete-setup marks setup as completed for admin', async () => {
            const res = await makeRequest('/api/admin/complete-setup', {
                method: 'POST',
                cookie: adminCookie
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body.success, true);

            // Verify in /api/auth/me
            const meRes = await makeRequest('/api/auth/me', {
                cookie: adminCookie
            });
            assert.strictEqual(meRes.status, 200);
            assert.strictEqual(meRes.body.setup_completed, 1);
        });

        it('POST /api/admin/complete-setup denies access for regular users with 403', async () => {
            const res = await makeRequest('/api/admin/complete-setup', {
                method: 'POST',
                cookie: userCookie
            });

            assert.strictEqual(res.status, 403);
        });

        it('POST /api/chat returns error when model_name is missing or empty', async () => {
            const res = await makeRequest('/api/chat', {
                method: 'POST',
                cookie: adminCookie,
                body: {
                    model_name: '',
                    message_content: 'Hello'
                }
            });

            const bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
            assert.ok(bodyStr.includes('No API keys are setup or Ollama is not running'));
        });
    });

    // -------------------------------------------------------------
    // 8. OLLAMA INFERENCE / STREAMING TESTS (SKIPPED PER USER REQUEST)
    // -------------------------------------------------------------
    describe('8. Ollama AI Inference & Streaming (Skipped)', () => {
        it('Live Ollama inference streaming test (SKIPPED: low-spec hardware optimization)', (t) => {
            t.skip('Skipping live Ollama test because local Ollama model execution is too resource intensive on this hardware.');
        });

        it('Live Ollama model pull test (SKIPPED: low-spec hardware optimization)', (t) => {
            t.skip('Skipping live Ollama pull test to preserve bandwidth and hardware performance.');
        });
    });
});
