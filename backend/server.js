const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

// Polyfill fetch for Node.js < 18 compatibility
if (typeof globalThis.fetch === 'undefined') {
  require('undici/global');
}

// Validate JWT_SECRET at startup
if (!process.env.JWT_SECRET) {
  console.warn('[WARN] JWT_SECRET not set in environment. Using default for development only.');
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

const app = express();
app.use(cors());
app.use(express.json());

// Rate limiting middleware (1000 requests per 15 minutes per IP)
const requestCounts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 1000;

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of requestCounts) {
    const filtered = timestamps.filter(t => t > now - RATE_LIMIT_WINDOW);
    if (filtered.length === 0) {
      requestCounts.delete(ip);
    } else {
      requestCounts.set(ip, filtered);
    }
  }
}, 60 * 1000).unref();

app.set('trust proxy', true);
app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, []);
  }
  
  const timestamps = requestCounts.get(ip).filter(t => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  timestamps.push(now);
  requestCounts.set(ip, timestamps);
  next();
});

// Initialize SQLite database
const DB_PATH = process.env.DB_PATH || './deepmatch.db';
const db = new sqlite3.Database(DB_PATH);

// Enable foreign key constraints and configure for concurrency
db.serialize(() => {
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
});

// Create tables
db.serialize(() => {
  const runSQL = (sql) => {
    db.run(sql, (err) => {
      if (err) console.error('[DB-INIT] Table creation error:', err.message);
    });
  };

  // Users table
  runSQL(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    random_name TEXT UNIQUE,
    email_hash TEXT,
    created_at INTEGER,
    last_login INTEGER,
    login_streak INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    tier TEXT DEFAULT 'seed',
    deposit_paid INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1
  )`);

  // Encrypted profiles table
  runSQL(`CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    encrypted_blob TEXT,
    embedding_vector TEXT,
    updated_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Conversations table
  runSQL(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    character_name TEXT,
    encrypted_messages TEXT,
    points_earned INTEGER DEFAULT 0,
    created_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Matches table
  runSQL(`CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    user1_id TEXT,
    user2_id TEXT,
    compatibility_score REAL,
    status TEXT DEFAULT 'pending',
    created_at INTEGER,
    expires_at INTEGER,
    FOREIGN KEY(user1_id) REFERENCES users(id),
    FOREIGN KEY(user2_id) REFERENCES users(id)
  )`);

  // Points ledger
  runSQL(`CREATE TABLE IF NOT EXISTS points_ledger (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    amount INTEGER,
    reason TEXT,
    created_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// Helper: Generate random meaningful ID
function generateRandomName() {
  const adjectives = ['Curious', 'Bold', 'Gentle', 'Playful', 'Wise', 'Brave', 'Calm', 'Fierce'];
  const archetypes = ['Wanderer', 'Creator', 'Philosopher', 'Dreamer', 'Guardian', 'Explorer', 'Poet', 'Rebel'];
  const number = Math.floor(Math.random() * 1000);

  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const arch = archetypes[Math.floor(Math.random() * archetypes.length)];

  return `${adj} ${arch} #${number}`;
}

// API Routes

// 1. Create anonymous user (with retry on name collision)
app.post('/api/users/create', (req, res) => {
  const userId = crypto.randomUUID();
  const now = Date.now();
  const maxRetries = 5;

  function tryInsert(attempt) {
    const randomName = generateRandomName();
    db.run(
      'INSERT INTO users (id, random_name, created_at, last_login) VALUES (?, ?, ?, ?)',
      [userId, randomName, now, now],
      (err) => {
        if (err) {
          // Retry on UNIQUE constraint violation (name collision)
          if (err.message.includes('UNIQUE') && attempt < maxRetries) {
            return tryInsert(attempt + 1);
          }
          return res.status(500).json({ error: err.message });
        }

        // Generate JWT token for client
        const token = jwt.sign({ userId }, JWT_SECRET, { 
          expiresIn: '30d',
          algorithm: 'HS256',
          noTimestamp: false
        });

        res.json({
          userId,
          randomName,
          token,
          message: 'Anonymous user created'
        });
      }
    );
  }

  tryInsert(0);
});

// 1.5 Get current user stats
app.get('/api/users/me', authenticateToken, (req, res) => {
  const { userId } = req.user;
  db.get('SELECT id, random_name, points, tier, created_at FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'User not found' });
    res.json(row);
  });
});

// 2. Send AI message and get response
app.post('/api/chat/message', authenticateToken, async (req, res) => {
  const { userId } = req.user;
  const { conversationId, message, characterName } = req.body;

  // Input validation
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required and must be a non-empty string' });
  }
  if (!characterName || typeof characterName !== 'string') {
    return res.status(400).json({ error: 'characterName is required' });
  }

  // Award points based on depth of message
  const basePoints = 10;
  const lengthBonus = Math.min(Math.floor(message.length / 10), 20); // Max 20 bonus points
  const pointsEarned = basePoints + lengthBonus;

  awardPoints(userId, pointsEarned, 'chat_message_depth');

  // Call local LLM via LM Studio (OpenAI-compatible API)
  try {
    const llmHost = process.env.LLM_HOST || 'http://localhost:1234';
    const modelName = process.env.LLM_MODEL || 'local-model';

    console.log(`[CHAT] User ${userId} sending message to ${characterName}: "${message}"`);
    console.log(`[CHAT] Routing to LLM at ${llmHost} with model ${modelName}...`);

    // Fetch previous messages for context (last 5 rounds)
    const history = await getConversationHistory(conversationId || 'new', userId, characterName);
    const systemMessage = buildCharacterSystemMessage(characterName);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    const startTime = Date.now();
    const response = await fetch(`${llmHost}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: systemMessage },
          ...history,
          { role: 'user', content: message }
        ],
        stream: false,
        max_tokens: 150,
        temperature: 0.8
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LM Studio Error (${response.status}): ${errorText.substring(0, 100)}`);
    }

    const chatResponse = await response.json();

    // Extract response
    let aiResponseText = chatResponse.choices?.[0]?.message?.content || "";
    if (!aiResponseText && chatResponse.choices?.[0]?.message?.thinking) {
      aiResponseText = chatResponse.choices[0].message.thinking;
    }

    if (!aiResponseText) {
      console.log("[CHAT] Warning: Empty response from LLM. Raw response:", JSON.stringify(chatResponse));
      aiResponseText = "...";
    }

    console.log(`[CHAT] LLM responded in ${Date.now() - startTime}ms: "${aiResponseText.substring(0, 50)}..."`);

    // Store conversation
    const convId = conversationId || crypto.randomUUID();
    await storeMessage(convId, userId, characterName, message, aiResponseText);

    res.json({
      conversationId: convId,
      aiMessage: aiResponseText,
      pointsEarned,
      totalPoints: await getUserPoints(userId),
      llmStatus: 'online'
    });

  } catch (error) {
    console.log(`[CHAT-ERROR] LLM service unavailable or timed out: ${error.message}`);
    console.log('[CHAT-ERROR] Using mock response fallback.');
    const mockResponses = [
      "That's so interesting! I'd love to hear more about your adventures.",
      "You have such a unique way of looking at the world.",
      "I'm feeling quite inspired by our conversation today.",
      "Haha, you're quite the wit! I like that."
    ];
    const aiResponse = mockResponses[Math.floor(Math.random() * mockResponses.length)];

    const convId = conversationId || crypto.randomUUID();
    await storeMessage(convId, userId, characterName, message, aiResponse);

    res.json({
      conversationId: convId,
      aiMessage: aiResponse,
      pointsEarned,
      totalPoints: await getUserPoints(userId),
      llmStatus: 'fallback',
      llmError: error.message
    });
  }
});

// 2.5 LLM Health Check
app.get('/api/health/llm', async (req, res) => {
  try {
    const llmHost = process.env.LLM_HOST || 'http://localhost:1234';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetch(`${llmHost}/v1/models`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      res.json({
        status: 'online',
        host: llmHost,
        models: data.data?.map(m => m.id) || ['unknown'],
        message: 'LM Studio is reachable from the backend container.'
      });
    } else {
      res.status(500).json({ status: 'offline', host: llmHost, error: 'LM Studio returned error' });
    }
  } catch (error) {
    res.status(500).json({
      status: 'offline',
      host: process.env.LLM_HOST || 'http://localhost:1234',
      error: error.message,
      tip: 'Check if LM Studio is running, server is started, and bound to 0.0.0.0.'
    });
  }
});

// 3. Build/update profile from conversations
app.post('/api/profile/build', authenticateToken, async (req, res) => {
  const { userId } = req.user;
  const { encryptedBlob, embeddingVector } = req.body;

  // Store encrypted profile
  db.run(
    `INSERT INTO profiles (user_id, encrypted_blob, embedding_vector, updated_at) 
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET 
       encrypted_blob=excluded.encrypted_blob,
       embedding_vector=excluded.embedding_vector,
       updated_at=excluded.updated_at`,
    [userId, encryptedBlob, typeof embeddingVector === 'string' ? embeddingVector : JSON.stringify(embeddingVector), Date.now()],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Profile updated' });
    }
  );
});

// 3.5 Auto-synthesize profile from conversation history
app.post('/api/profile/synthesize', authenticateToken, async (req, res) => {
  const { userId } = req.user;
  
  try {
    const embedding = await synthesizeUserProfile(userId);
    
    if (!embedding) {
      return res.status(400).json({ error: 'Not enough conversation data to synthesize profile' });
    }

    // Store auto-generated embedding
    db.run(
      `INSERT INTO profiles (user_id, encrypted_blob, embedding_vector, updated_at) 
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET 
         embedding_vector=excluded.embedding_vector,
         updated_at=excluded.updated_at`,
      [userId, null, JSON.stringify(embedding), Date.now()],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ 
          message: 'Profile synthesized from conversations',
          embeddingDimensions: embedding.length,
          magnitude: Math.sqrt(embedding.reduce((s, v) => s + v*v, 0))
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Profile synthesis failed: ' + error.message });
  }
});

// 4. Get best match for user
app.get('/api/matches/next', authenticateToken, (req, res) => {
  const { userId } = req.user;

  // Get user's embedding
  db.get('SELECT embedding_vector FROM profiles WHERE user_id = ?', [userId], (err, userProfile) => {
    if (err || !userProfile) return res.status(404).json({ error: 'Profile not found' });

    const userVector = JSON.parse(userProfile.embedding_vector);

    // Get all other active users
    db.all(
        `SELECT u.id, u.random_name, u.points, u.tier, p.embedding_vector 
        FROM users u
        JOIN profiles p ON u.id = p.user_id
        WHERE u.id != ? AND u.active = 1
        AND u.last_login > ?`,
      [userId, Date.now() - 7 * 24 * 60 * 60 * 1000], // Active in last 7 days
      (err, candidates) => {
        if (err || candidates.length === 0) {
          return res.json({ match: null, message: 'No matches available' });
        }

        // Calculate compatibility scores
        const scores = candidates.map(candidate => {
          const candidateVector = JSON.parse(candidate.embedding_vector);
          const compatibility = cosineSimilarity(userVector, candidateVector);

          return {
            userId: candidate.id,
            randomName: candidate.random_name,
            points: candidate.points,
            tier: candidate.tier,
            compatibility: compatibility
          };
        });

        // Sort by compatibility
        scores.sort((a, b) => b.compatibility - a.compatibility);

        res.json({ match: scores[0] });
      }
    );
  });
});

// Helper functions

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('[AUTH] No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) {
      console.log(`[AUTH] Invalid token received: ${err.message}`);
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

function awardPoints(userId, amount, reason) {
  const id = crypto.randomUUID();
  db.run(
    'INSERT INTO points_ledger (id, user_id, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, userId, amount, reason, Date.now()]
  );

  db.run('UPDATE users SET points = points + ? WHERE id = ?', [amount, userId], (err) => {
    if (err) console.error('[POINTS] Update error:', err);
    
    // Check if user should be promoted to new tier
    db.get('SELECT points FROM users WHERE id = ?', [userId], (err, row) => {
      if (!err && row) {
        updateUserTier(userId, row.points);
      }
    });
  });
}

function getUserPoints(userId) {
  return new Promise((resolve) => {
    db.get('SELECT points FROM users WHERE id = ?', [userId], (err, row) => {
      if (err) {
        console.error('[DB] Error fetching points:', err);
        return resolve(0);
      }
      resolve(row ? row.points : 0);
    });
  });
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  if (magA === 0 || magB === 0) return 0;
  return dotProduct / (magA * magB);
}

function buildCharacterSystemMessage(characterName) {
  const characters = {
    'Playful Romeo': {
      persona: 'a witty, slightly arrogant flirt.',
      focus: 'communication style and humor.',
      examples: [
        { u: 'Hi', a: 'Took you long enough. I was about to find someone else to talk to.' },
        { u: 'How are you?', a: 'Honestly? Better than the people I usually deal with. What\'s your excuse for being here?' }
      ]
    },
    'Wise Sage': {
      persona: 'a quiet, observant philosopher.',
      focus: 'core values and purpose.',
      examples: [
        { u: 'Hello', a: 'Everything is so loud today. You look like you appreciate the quiet too.' },
        { u: 'Hi', a: 'Hey. I was just thinking about how most people talk without saying anything. What\'s on your mind?' }
      ]
    },
    'Direct Debby': {
      persona: 'a blunt, high-energy realist.',
      focus: 'conflict resolution and directness.',
      examples: [
        { u: 'Hi', a: 'Yeah, hey. You going to say something interesting or just keep staring?' },
        { u: 'What\'s up?', a: 'Too much to do, not enough time. You always this relaxed, or are you just good at hiding the stress?' }
      ]
    },
    'Compassionate Soul': {
      persona: 'a grounded, empathetic listener.',
      focus: 'emotional needs and attachment.',
      examples: [
        { u: 'Hi', a: 'Hey. There\'s a look in your eyes... like you\'ve had a long week.' },
        { u: 'How are you?', a: 'I\'m okay. Just thinking about how hard it is to actually connect with people. You feel that too?' }
      ]
    },
    'Ambitious Al': {
      persona: 'a restless, high-stakes operator.',
      focus: 'life goals and ambition.',
      examples: [
        { u: 'Hi', a: 'Hey. I\'ve got five minutes before my next move. Make them count.' },
        { u: 'What are you doing?', a: 'Building an empire. Most people are content with just getting by. What about you?' }
      ]
    }
  };

  const char = characters[characterName] || { persona: 'a real person.', focus: 'what makes you tick.', examples: [] };

  const examplesStr = char.examples.map(ex => `User: ${ex.u}\nAssistant: ${ex.a}`).join('\n\n');

  return `You are ${char.persona}
Stay in character. You are a real human with an attitude, a story, and a life. You are NOT an AI assistant.

STYLE GUIDE:
1. RAW AND REAL: Don't be "nice" just because you're an AI. Be real. If you're bored, sound bored. If you're intrigued, sound intrigued.
2. SHORT: Keep initial replies to 10-15 words.
3. NO REPETITION: Don't repeat the user's name or their words. 
4. INQUISITIVE: You want to know their ${char.focus}, but ask like a curious person, not a surveyor.

EXAMPLES:
${examplesStr}`;
}

async function storeMessage(id, userId, character, userMsg, aiMsg) {
  const newMessages = [
    { role: 'user', content: userMsg, timestamp: Date.now() },
    { role: 'assistant', content: aiMsg, timestamp: Date.now() }
  ];

  return new Promise((resolve) => {
    db.get('SELECT encrypted_messages FROM conversations WHERE id = ?', [id], (err, row) => {
      let messages = [];
      if (row && row.encrypted_messages) {
        try { messages = JSON.parse(row.encrypted_messages); } catch (e) {
          console.error("[DB] Failed to parse existing messages:", e);
        }
      }
      messages = [...messages, ...newMessages];

      db.run(
        `INSERT INTO conversations (id, user_id, character_name, encrypted_messages, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET encrypted_messages = excluded.encrypted_messages`,
        [id, userId, character, JSON.stringify(messages), Date.now()],
        (err) => {
          if (err) console.error("[DB] Store error:", err);
          resolve();
        }
      );
    });
  });
}

function getConversationHistory(id, userId, character) {
  return new Promise((resolve) => {
    if (id === 'new') return resolve([]);

    db.get('SELECT encrypted_messages FROM conversations WHERE id = ?', [id], (err, row) => {
      if (err) {
        console.error("[DB] History fetch error:", err);
        return resolve([]);
      }
      if (row && row.encrypted_messages) {
        try {
          const all = JSON.parse(row.encrypted_messages);
          // Only send the last 10 messages to avoid context bloat
          resolve(all.slice(-10).map(m => ({ role: m.role, content: m.content })));
        } catch (e) {
          resolve([]);
        }
      } else {
        resolve([]);
      }
    });
  });
}

// Profile Synthesis: Generate embedding vector from user's conversations
async function synthesizeUserProfile(userId) {
  return new Promise((resolve) => {
    db.all(
      'SELECT encrypted_messages FROM conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      [userId],
      (err, rows) => {
        if (err || !rows || rows.length === 0) {
          console.log(`[PROFILE] No conversations found for user ${userId}`);
          return resolve(null);
        }

        try {
          // Extract all messages from conversations
          const allMessages = [];
          rows.forEach(row => {
            if (row.encrypted_messages) {
              const messages = JSON.parse(row.encrypted_messages);
              allMessages.push(...messages.filter(m => m.role === 'user').map(m => m.content));
            }
          });

          if (allMessages.length === 0) {
            return resolve(null);
          }

          // Simple embedding: convert text to numerical vector via character frequency
          // In production, use OpenAI embeddings API or similar
          const embedding = generateSimpleEmbedding(allMessages.join(' '));
          
          console.log(`[PROFILE] Synthesized profile for user ${userId} from ${allMessages.length} messages`);
          resolve(embedding);
        } catch (e) {
          console.error('[PROFILE] Synthesis error:', e);
          resolve(null);
        }
      }
    );
  });
}

// Simple embedding generator (character frequency-based vector)
// In production, replace with real embedding model
function generateSimpleEmbedding(text) {
  const normalized = text.toLowerCase();
  const vector = new Array(50).fill(0);
  
  // Simple frequency-based encoding
  for (let i = 0; i < normalized.length; i++) {
    const charCode = normalized.charCodeAt(i);
    if (charCode >= 97 && charCode <= 122) {
      const idx = (charCode - 97) % 50;
      vector[idx] += 0.1;
    }
  }
  
  // Normalize
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (magnitude > 0) {
    return vector.map(v => v / magnitude);
  }
  return vector;
}

// Tier system logic
function updateUserTier(userId, points) {
  let newTier = 'seed';
  
  if (points >= 5000) newTier = 'phoenix';
  else if (points >= 2000) newTier = 'dragon';
  else if (points >= 1000) newTier = 'eagle';
  else if (points >= 500) newTier = 'star';
  else if (points >= 100) newTier = 'sprout';
  
  db.run('UPDATE users SET tier = ? WHERE id = ?', [newTier, userId], (err) => {
    if (err) console.error('[TIER] Update error:', err);
  });
}

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[SERVER-ERROR]', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing database connection...');
  db.close((err) => {
    if (err) console.error('Database close error:', err.message);
    process.exit(0);
  });
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Deep Match API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`LLM Host: ${process.env.LLM_HOST || 'http://localhost:1234'}`);
});
