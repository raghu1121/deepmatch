# Match Quest - Technical Implementation Guide

## Overview

This document provides step-by-step technical implementation details for building Match Quest, from local MacBook prototype to production cloud deployment and iOS app.

---

## Phase 1: Local Prototype (MacBook Development)

**Goal**: Minimal viable demo that proves core mechanics work locally before investing in cloud infrastructure.

**Timeline**: 2-3 weeks

**Tech Stack**:
- Backend: Node.js with Express
- Database: SQLite (file-based, no server needed)
- LLM: LM Studio with OpenAI-compatible API (runs locally on port 1234)
- Frontend: React (web browser testing)
- Encryption: crypto-js library (AES-256 client-side)

### Step 1.1: Environment Setup

```bash
# Install Node.js (if not installed)
brew install node

# Install LM Studio for local LLM
# Download from https://lmstudio.ai/
# Or via Ollama: brew install ollama && ollama pull llama2

# Create project structure
mkdir deepmatch
cd deepmatch
mkdir backend frontend shared
```

### Step 1.2: Backend Setup

```bash
cd backend
npm init -y

# Install dependencies
npm install express sqlite3 jsonwebtoken bcryptjs \
  nodemailer uuid cors dotenv body-parser
```

**File: `backend/server.js`**

```javascript
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize SQLite database
const db = new sqlite3.Database('./matchquest.db');

// Create tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
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
  db.run(`CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY,
    encrypted_blob TEXT,
    embedding_vector TEXT,
    updated_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Conversations table
  db.run(`CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    character_name TEXT,
    encrypted_messages TEXT,
    points_earned INTEGER DEFAULT 0,
    created_at INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Matches table
  db.run(`CREATE TABLE IF NOT EXISTS matches (
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
  db.run(`CREATE TABLE IF NOT EXISTS points_ledger (
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

// 1. Create anonymous user
app.post('/api/users/create', (req, res) => {
  const userId = crypto.randomUUID();
  const randomName = generateRandomName();
  const now = Date.now();

  db.run(
    'INSERT INTO users (id, random_name, created_at, last_login) VALUES (?, ?, ?, ?)',
    [userId, randomName, now, now],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Generate JWT token for client
      const token = jwt.sign({ userId }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '30d' });
      
      res.json({
        userId,
        randomName,
        token,
        message: 'Anonymous user created'
      });
    }
  );
});

// 2. Send AI message and get response
app.post('/api/chat/message', authenticateToken, async (req, res) => {
  const { userId } = req.user;
  const { conversationId, message, characterName } = req.body;

  // Award points for message
  const pointsEarned = 10;
  awardPoints(userId, pointsEarned, 'chat_message');

  // Call local LLM via Ollama API
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2',
        prompt: buildCharacterPrompt(characterName, message),
        stream: false
      })
    });

    const aiResponse = await response.json();

    // Store conversation (in real app, encrypt this)
    const convId = conversationId || crypto.randomUUID();
    storeMessage(convId, userId, characterName, message, aiResponse.response);

    res.json({
      conversationId: convId,
      aiMessage: aiResponse.response,
      pointsEarned,
      totalPoints: await getUserPoints(userId)
    });

  } catch (error) {
    res.status(500).json({ error: 'LLM service unavailable' });
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
    [userId, encryptedBlob, JSON.stringify(embeddingVector), Date.now()],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: 'Profile updated' });
    }
  );
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
       WHERE u.id != ? AND u.active = 1 AND u.deposit_paid = 1
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

  if (!token) return res.status(401).json({ error: 'No token provided' });

  jwt.verify(token, process.env.JWT_SECRET || 'dev-secret', (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
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

  db.run('UPDATE users SET points = points + ? WHERE id = ?', [amount, userId]);
}

function getUserPoints(userId) {
  return new Promise((resolve) => {
    db.get('SELECT points FROM users WHERE id = ?', [userId], (err, row) => {
      resolve(row ? row.points : 0);
    });
  });
}

function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magA * magB);
}

function buildCharacterPrompt(characterName, userMessage) {
  const characters = {
    'Playful Romeo': 'You are a flirtatious, witty character who loves wordplay and making people laugh. Respond playfully to:',
    'Wise Sage': 'You are a thoughtful, philosophical character who asks deep questions. Respond wisely to:',
    // Add more characters
  };

  const systemPrompt = characters[characterName] || 'You are a friendly AI character. Respond to:';
  return `${systemPrompt}\n\nUser: ${userMessage}\n\nAssistant:`;
}

function storeMessage(conversationId, userId, character, userMsg, aiMsg) {
  // In production, encrypt messages here
  const messages = JSON.stringify([
    { role: 'user', content: userMsg, timestamp: Date.now() },
    { role: 'assistant', content: aiMsg, timestamp: Date.now() }
  ]);

  db.run(
    `INSERT INTO conversations (id, user_id, character_name, encrypted_messages, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET encrypted_messages = encrypted_messages || ?`,
    [conversationId, userId, character, messages, Date.now(), messages]
  );
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Match Quest API running on port ${PORT}`);
});
```

### Step 1.3: Frontend Setup (React Web)

```bash
cd ../frontend
npx create-react-app .

# Install dependencies
npm install axios crypto-js
```

**File: `frontend/src/App.js`**

```javascript
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import './App.css';

const API_BASE = 'http://localhost:3000/api';

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [encryptionKey, setEncryptionKey] = useState(localStorage.getItem('encKey'));
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [currentCharacter] = useState('Playful Romeo');
  const [conversationId, setConversationId] = useState(null);

  // Initialize user on first load
  useEffect(() => {
    if (!token) {
      createAnonymousUser();
    } else {
      loadUserData();
    }
  }, [token]);

  const createAnonymousUser = async () => {
    try {
      const res = await axios.post(`${API_BASE}/users/create`);
      const { token, userId, randomName } = res.data;

      // Generate client-side encryption key
      const key = CryptoJS.lib.WordArray.random(256/8).toString();

      localStorage.setItem('token', token);
      localStorage.setItem('encKey', key);
      localStorage.setItem('userId', userId);

      setToken(token);
      setEncryptionKey(key);
      setUser({ id: userId, name: randomName, points: 0 });

    } catch (error) {
      console.error('Failed to create user:', error);
    }
  };

  const loadUserData = () => {
    // Load user data from localStorage for demo
    const userId = localStorage.getItem('userId');
    const userName = localStorage.getItem('userName') || 'Anonymous User';
    const points = parseInt(localStorage.getItem('points') || '0');

    setUser({ id: userId, name: userName, points });
  };

  const sendMessage = async () => {
    if (!inputMessage.trim()) return;

    const userMsg = { role: 'user', content: inputMessage };
    setMessages([...messages, userMsg]);
    setInputMessage('');

    try {
      const res = await axios.post(
        `${API_BASE}/chat/message`,
        {
          conversationId,
          message: inputMessage,
          characterName: currentCharacter
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      const aiMsg = { role: 'assistant', content: res.data.aiMessage };
      setMessages(prev => [...prev, aiMsg]);
      setConversationId(res.data.conversationId);

      // Update points
      localStorage.setItem('points', res.data.totalPoints);
      setUser(prev => ({ ...prev, points: res.data.totalPoints }));

    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  return (
    <div className="App">
      <header>
        <h1>Match Quest</h1>
        {user && (
          <div className="user-info">
            <span>{user.name}</span>
            <span>🌸 {user.points} points</span>
          </div>
        )}
      </header>

      <main>
        <div className="chat-container">
          <div className="character-header">
            <h2>Chatting with {currentCharacter}</h2>
          </div>

          <div className="messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <p>{msg.content}</p>
              </div>
            ))}
          </div>

          <div className="input-area">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type your message..."
            />
            <button onClick={sendMessage}>Send</button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
```

**File: `frontend/src/App.css`**

```css
.App {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 2px solid #eee;
}

.user-info {
  display: flex;
  gap: 20px;
  font-size: 14px;
}

.chat-container {
  border: 1px solid #ddd;
  border-radius: 12px;
  overflow: hidden;
}

.character-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px;
}

.messages {
  height: 500px;
  overflow-y: auto;
  padding: 20px;
  background: #f9f9f9;
}

.message {
  margin-bottom: 15px;
  padding: 12px 16px;
  border-radius: 8px;
  max-width: 70%;
}

.message.user {
  background: #007bff;
  color: white;
  margin-left: auto;
  text-align: right;
}

.message.assistant {
  background: white;
  border: 1px solid #e0e0e0;
}

.input-area {
  display: flex;
  padding: 15px;
  background: white;
  border-top: 1px solid #ddd;
}

.input-area input {
  flex: 1;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
}

.input-area button {
  margin-left: 10px;
  padding: 12px 24px;
  background: #667eea;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
}

.input-area button:hover {
  background: #5568d3;
}
```

### Step 1.4: Running the Prototype

```bash
# Terminal 1: Start Ollama
ollama serve

# Terminal 2: Start backend
cd backend
node server.js

# Terminal 3: Start frontend
cd frontend
npm start
```

Visit `http://localhost:3001` to test the prototype.

---

## Phase 2: iOS App Development

**Goal**: Native iOS app with visual novel UI and client-side encryption.

**Timeline**: 4-6 weeks

**Tech Stack**: Swift + SwiftUI or React Native

### Option A: React Native (Cross-platform)

```bash
npx react-native init MatchQuestApp
cd MatchQuestApp

# Install dependencies
npm install @react-navigation/native @react-navigation/stack \
  react-native-encrypted-storage axios react-native-push-notification
```

**Key Components:**

1. **Onboarding Screen**: Generate random ID, create encryption key
2. **Character Selection**: Choose AI personality to chat with
3. **Chat Interface**: Visual novel-style UI with character portraits
4. **Profile Dashboard**: View points, tier, match readiness
5. **Match Queue**: View/accept/reject matches
6. **Settings**: Export profile, delete data, recovery email

**File: `src/screens/ChatScreen.js`**

```javascript
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Image } from 'react-native';
import EncryptedStorage from 'react-native-encrypted-storage';
import axios from 'axios';

const ChatScreen = ({ route }) => {
  const { character } = route.params;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [token, setToken] = useState(null);

  useEffect(() => {
    loadToken();
  }, []);

  const loadToken = async () => {
    const storedToken = await EncryptedStorage.getItem('auth_token');
    setToken(storedToken);
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user', content: input };
    setMessages([...messages, userMessage]);
    setInput('');

    try {
      const response = await axios.post(
        'https://your-api.com/api/chat/message',
        { message: input, characterName: character.name },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const aiMessage = { role: 'assistant', content: response.data.aiMessage };
      setMessages(prev => [...prev, aiMessage]);

    } catch (error) {
      console.error('Chat error:', error);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.characterHeader}>
        <Image source={character.portrait} style={styles.portrait} />
        <Text style={styles.characterName}>{character.name}</Text>
      </View>

      <ScrollView style={styles.messagesContainer}>
        {messages.map((msg, index) => (
          <View
            key={index}
            style={[
              styles.messageBubble,
              msg.role === 'user' ? styles.userMessage : styles.aiMessage
            ]}
          >
            <Text style={styles.messageText}>{msg.content}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Type your message..."
          multiline
        />
        <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
          <Text style={styles.sendButtonText}>Send</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = {
  characterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#667eea',
  },
  portrait: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginRight: 15,
  },
  characterName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
  },
  messagesContainer: {
    flex: 1,
    padding: 15,
    backgroundColor: '#f5f5f5',
  },
  messageBubble: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    maxWidth: '80%',
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#007bff',
  },
  aiMessage: {
    alignSelf: 'flex-start',
    backgroundColor: 'white',
  },
  messageText: {
    fontSize: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 15,
    backgroundColor: 'white',
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  input: {
    flex: 1,
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    marginRight: 10,
  },
  sendButton: {
    backgroundColor: '#667eea',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    justifyContent: 'center',
  },
  sendButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
};

export default ChatScreen;
```

### Option B: Native Swift

**File: `ChatViewController.swift`**

```swift
import UIKit
import CryptoKit

class ChatViewController: UIViewController {
    let character: Character
    var messages: [Message] = []
    var conversationId: String?
    
    private let tableView = UITableView()
    private let inputContainer = UIView()
    private let textField = UITextField()
    private let sendButton = UIButton()
    
    init(character: Character) {
        self.character = character
        super.init(nibName: nil, bundle: nil)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
    }
    
    private func setupUI() {
        // Character header
        let headerView = CharacterHeaderView(character: character)
        view.addSubview(headerView)
        
        // Messages table
        tableView.delegate = self
        tableView.dataSource = self
        tableView.register(MessageCell.self, forCellReuseIdentifier: "MessageCell")
        view.addSubview(tableView)
        
        // Input area
        inputContainer.backgroundColor = .white
        textField.placeholder = "Type your message..."
        sendButton.setTitle("Send", for: .normal)
        sendButton.addTarget(self, action: #selector(sendMessage), for: .touchUpInside)
        
        inputContainer.addSubview(textField)
        inputContainer.addSubview(sendButton)
        view.addSubview(inputContainer)
        
        // Layout constraints
        setupConstraints()
    }
    
    @objc private func sendMessage() {
        guard let text = textField.text, !text.isEmpty else { return }
        
        let userMessage = Message(role: .user, content: text)
        messages.append(userMessage)
        tableView.reloadData()
        textField.text = ""
        
        // Call API
        APIClient.shared.sendChatMessage(
            conversationId: conversationId,
            message: text,
            characterName: character.name
        ) { [weak self] result in
            switch result {
            case .success(let response):
                let aiMessage = Message(role: .assistant, content: response.aiMessage)
                self?.messages.append(aiMessage)
                self?.conversationId = response.conversationId
                self?.tableView.reloadData()
                
            case .failure(let error):
                print("Chat error: \\(error)")
            }
        }
    }
}
```

---

## Phase 3: Cloud Deployment

**Goal**: Scale prototype to handle thousands of users with production-grade infrastructure.

**Timeline**: 3-4 weeks

### Step 3.1: Database Migration (SQLite → PostgreSQL)

```bash
# Install PostgreSQL locally for testing
brew install postgresql
brew services start postgresql

# Create database
createdb matchquest_prod
```

**Migration Script:**

```sql
-- PostgreSQL schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    random_name VARCHAR(100) UNIQUE NOT NULL,
    email_hash VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login TIMESTAMPTZ DEFAULT NOW(),
    login_streak INTEGER DEFAULT 0,
    points INTEGER DEFAULT 0,
    tier VARCHAR(20) DEFAULT 'seed',
    deposit_paid BOOLEAN DEFAULT FALSE,
    active BOOLEAN DEFAULT TRUE
);

CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    encrypted_blob TEXT NOT NULL,
    embedding_vector FLOAT8[],
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_embedding ON profiles USING GIN(embedding_vector);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    character_name VARCHAR(100),
    encrypted_messages TEXT,
    points_earned INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE matches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user1_id UUID REFERENCES users(id),
    user2_id UUID REFERENCES users(id),
    compatibility_score FLOAT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(user1_id, user2_id)
);

CREATE TABLE points_ledger (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    reason VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_users_active ON users(active, last_login);
CREATE INDEX idx_matches_status ON matches(status, created_at);
CREATE INDEX idx_points_user ON points_ledger(user_id, created_at);
```

### Step 3.2: Containerize with Docker

**File: `backend/Dockerfile`**

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
```

**File: `docker-compose.yml`**

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: matchquest
      POSTGRES_USER: mquser
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://mquser:${DB_PASSWORD}@postgres:5432/matchquest
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      - postgres
      - redis

volumes:
  pgdata:
  redisdata:
```

### Step 3.3: Deploy to Cloud (AWS/GCP/Azure)

**Recommended: AWS with ECS + RDS**

```bash
# Install AWS CLI
brew install awscli
aws configure

# Create RDS PostgreSQL instance
aws rds create-db-instance \
  --db-instance-identifier matchquest-db \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --master-username mqadmin \
  --master-user-password YOUR_PASSWORD \
  --allocated-storage 20

# Create ECR repository
aws ecr create-repository --repository-name matchquest-backend

# Build and push Docker image
docker build -t matchquest-backend ./backend
docker tag matchquest-backend:latest AWS_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/matchquest-backend:latest
docker push AWS_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/matchquest-backend:latest

# Deploy with ECS Fargate
aws ecs create-cluster --cluster-name matchquest-cluster
```

**Alternative: Heroku (Simpler for MVP)**

```bash
# Install Heroku CLI
brew install heroku/brew/heroku

# Login and create app
heroku login
heroku create matchquest-api

# Add PostgreSQL
heroku addons:create heroku-postgresql:hobby-dev

# Deploy
git push heroku main
```

### Step 3.4: LLM Integration (Production)

**Option 1: OpenAI API**

```javascript
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getAIResponse(characterName, message, conversationHistory) {
  const systemPrompt = getCharacterSystemPrompt(characterName);
  
  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: message }
    ],
    temperature: 0.8,
  });

  return completion.choices[0].message.content;
}
```

**Option 2: Self-hosted (Cost-effective at scale)**

```bash
# Deploy LLM on GPU instance (AWS EC2 g4dn.xlarge)
# Use vLLM or TGI for serving

pip install vllm

# Serve Llama 3 70B
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Meta-Llama-3-70B-Instruct \
  --tensor-parallel-size 1 \
  --host 0.0.0.0 \
  --port 8000
```

### Step 3.5: Monitoring & Logging

```bash
# Install DataDog or use CloudWatch
npm install dd-trace --save

# backend/server.js
require('dd-trace').init();

# Add logging
const winston = require('winston');
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
```

---

## Phase 4: Advanced Features

### Step 4.1: Vector Search for Matching

```javascript
// Use pgvector extension
const { Client } = require('pg');

async function findBestMatch(userId) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Get user embedding
  const userResult = await client.query(
    'SELECT embedding_vector FROM profiles WHERE user_id = $1',
    [userId]
  );

  const userVector = userResult.rows[0].embedding_vector;

  // Find closest matches using cosine distance
  const matches = await client.query(`
    SELECT 
      u.id, 
      u.random_name, 
      u.points,
      1 - (p.embedding_vector <=> $1::vector) AS similarity
    FROM users u
    JOIN profiles p ON u.id = p.user_id
    WHERE u.id != $2 
      AND u.active = TRUE 
      AND u.deposit_paid = TRUE
      AND u.last_login > NOW() - INTERVAL '7 days'
    ORDER BY p.embedding_vector <=> $1::vector
    LIMIT 10
  `, [userVector, userId]);

  await client.end();
  return matches.rows;
}
```

### Step 4.2: Real-time Chat with WebSockets

```javascript
const { Server } = require('socket.io');

const io = new Server(server, {
  cors: { origin: '*' }
});

io.on('connection', (socket) => {
  socket.on('join-match', (matchId) => {
    socket.join(matchId);
  });

  socket.on('send-message', async (data) => {
    const { matchId, message, senderId } = data;
    
    // Encrypt and store message
    const encryptedMessage = encryptMessage(message);
    await storeMatchMessage(matchId, senderId, encryptedMessage);

    // Broadcast to other user
    socket.to(matchId).emit('new-message', {
      senderId,
      message: encryptedMessage,
      timestamp: Date.now()
    });
  });
});
```

### Step 4.3: Push Notifications (iOS)

```swift
import UserNotifications

class NotificationManager {
    static func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if granted {
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }
    
    static func sendMatchNotification(matchName: String) {
        let content = UNMutableNotificationContent()
        content.title = "New Match! 🎉"
        content.body = "You matched with \\(matchName). Say hi!"
        content.sound = .default
        
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger)
        
        UNUserNotificationCenter.current().add(request)
    }
}
```

---

## Testing Strategy

### Unit Tests (Backend)

```javascript
const request = require('supertest');
const app = require('./server');

describe('User API', () => {
  test('POST /api/users/create creates anonymous user', async () => {
    const res = await request(app)
      .post('/api/users/create')
      .expect(200);

    expect(res.body).toHaveProperty('userId');
    expect(res.body).toHaveProperty('randomName');
    expect(res.body).toHaveProperty('token');
  });
});

describe('Chat API', () => {
  let token;

  beforeAll(async () => {
    const res = await request(app).post('/api/users/create');
    token = res.body.token;
  });

  test('POST /api/chat/message returns AI response', async () => {
    const res = await request(app)
      .post('/api/chat/message')
      .set('Authorization', `Bearer ${token}`)
      .send({ message: 'Hello!', characterName: 'Playful Romeo' })
      .expect(200);

    expect(res.body).toHaveProperty('aiMessage');
    expect(res.body).toHaveProperty('pointsEarned');
  });
});
```

### Integration Tests (iOS)

```swift
import XCTest
@testable import MatchQuest

class ChatTests: XCTestCase {
    var chatViewModel: ChatViewModel!
    
    override func setUp() {
        super.setUp()
        chatViewModel = ChatViewModel(character: Character.playfulRomeo)
    }
    
    func testSendMessageAddsToHistory() {
        chatViewModel.sendMessage("Test message")
        
        XCTAssertEqual(chatViewModel.messages.count, 1)
        XCTAssertEqual(chatViewModel.messages[0].content, "Test message")
    }
    
    func testEncryptionDecryption() {
        let original = "Sensitive data"
        let encrypted = EncryptionManager.encrypt(original)
        let decrypted = EncryptionManager.decrypt(encrypted)
        
        XCTAssertEqual(original, decrypted)
        XCTAssertNotEqual(original, encrypted)
    }
}
```

---

## Performance Optimization

### Caching Strategy

```javascript
const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL);

// Cache user points
async function getUserPoints(userId) {
  const cached = await redis.get(`points:${userId}`);
  if (cached) return parseInt(cached);

  const result = await db.query('SELECT points FROM users WHERE id = $1', [userId]);
  const points = result.rows[0].points;

  await redis.setex(`points:${userId}`, 300, points); // 5-min cache
  return points;
}

// Cache match queue
async function getMatchQueue(userId) {
  const cached = await redis.get(`queue:${userId}`);
  if (cached) return JSON.parse(cached);

  const matches = await calculateMatches(userId);
  await redis.setex(`queue:${userId}`, 3600, JSON.stringify(matches)); // 1-hour cache

  return matches;
}
```

### Database Optimization

```sql
-- Add indexes
CREATE INDEX CONCURRENTLY idx_users_login_active ON users(last_login) WHERE active = TRUE;
CREATE INDEX CONCURRENTLY idx_conversations_user_time ON conversations(user_id, created_at DESC);

-- Partition large tables
CREATE TABLE points_ledger_2026 PARTITION OF points_ledger
FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- Use materialized views for analytics
CREATE MATERIALIZED VIEW user_stats AS
SELECT 
    user_id,
    COUNT(*) as total_messages,
    SUM(points_earned) as total_points,
    MAX(created_at) as last_active
FROM conversations
GROUP BY user_id;

CREATE UNIQUE INDEX ON user_stats(user_id);
REFRESH MATERIALIZED VIEW CONCURRENTLY user_stats;
```

---

## Security Checklist

- [ ] All API endpoints use HTTPS/TLS 1.3
- [ ] JWT tokens expire after 30 days
- [ ] Rate limiting: 100 requests/min per user
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (input sanitization)
- [ ] CSRF tokens for state-changing operations
- [ ] Encryption keys stored in iOS Keychain
- [ ] Environment variables for secrets (no hardcoding)
- [ ] Regular dependency updates (`npm audit`)
- [ ] GDPR-compliant data export/deletion
- [ ] Logging excludes sensitive data
- [ ] Backup strategy (daily PostgreSQL dumps)

---

## Deployment Checklist

### Pre-launch
- [ ] Load testing (1000+ concurrent users)
- [ ] Security audit (third-party penetration test)
- [ ] Privacy policy & terms of service reviewed by lawyer
- [ ] App Store submission (iOS review ~2 weeks)
- [ ] Analytics integration (Mixpanel/Amplitude)
- [ ] Error tracking (Sentry)
- [ ] Customer support system (Intercom)

### Launch Day
- [ ] Database backups verified
- [ ] Monitoring dashboards active
- [ ] On-call rotation established
- [ ] Rollback plan documented
- [ ] Marketing site live
- [ ] Social media accounts ready

### Post-launch
- [ ] Monitor error rates (<1%)
- [ ] Track retention (D1, D7, D30)
- [ ] Collect user feedback
- [ ] Iterate on matching algorithm
- [ ] Scale infrastructure as needed

---

## Estimated Costs (Monthly)

**Prototype (Local)**: $0

**MVP (100 users)**:
- Heroku Hobby: $7
- PostgreSQL Hobby: $9
- OpenAI API: ~$50
- Domain: $1
**Total: ~$70/month**

**Growth (1,000 users)**:
- AWS ECS: $50
- RDS db.t3.small: $25
- Redis ElastiCache: $15
- OpenAI API: ~$500
- S3: $5
**Total: ~$600/month**

**Scale (10,000 users)**:
- AWS ECS: $200
- RDS db.r5.large: $150
- Redis: $50
- Self-hosted LLM (GPU): $500
- CDN: $50
- Monitoring: $50
**Total: ~$1,000/month**

---

## Timeline Summary

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| **Prototype** | 2-3 weeks | Working local demo |
| **iOS App** | 4-6 weeks | App Store submission |
| **Cloud Deploy** | 3-4 weeks | Production API |
| **Advanced Features** | 2-3 weeks | WebSockets, push notifications |
| **Beta Testing** | 2 weeks | 50-100 beta users |
| **Public Launch** | 1 week | App Store approved |

**Total: 14-19 weeks (3.5-4.5 months)**

---

## Next Steps

1. **Week 1-2**: Build local prototype, test core mechanics
2. **Week 3**: Decide on React Native vs native Swift
3. **Week 4-8**: Develop iOS app
4. **Week 9-11**: Deploy to cloud, integrate production LLM
5. **Week 12-13**: Beta test with friends/early users
6. **Week 14**: Launch publicly

Start with the prototype—it will validate the concept before investing in full production infrastructure.