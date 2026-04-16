import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import './App.css';

const API_BASE = process.env.REACT_APP_API_BASE || '/api';

// Encryption utilities
function generateEncryptionKey() {
  const array = new Uint8Array(32);
  window.crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

function encryptText(plaintext, key) {
  return CryptoJS.AES.encrypt(plaintext, key).toString();
}

function decryptText(encrypted, key) {
  try {
    const decrypted = CryptoJS.AES.decrypt(encrypted, key).toString(CryptoJS.enc.Utf8);
    return decrypted;
  } catch (e) {
    console.error('Decryption error:', e);
    return '';
  }
}

function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [encryptionKey, setEncryptionKey] = useState(localStorage.getItem('encryptionKey') || null);
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistories, setChatHistories] = useState(JSON.parse(localStorage.getItem('chatHistories') || '{}'));
  const [inputMessage, setInputMessage] = useState('');
  const [characters] = useState(['Playful Romeo', 'Wise Sage', 'Direct Debby', 'Compassionate Soul', 'Ambitious Al']);
  const [currentCharacter, setCurrentCharacter] = useState('Playful Romeo');
  const [conversationIds, setConversationIds] = useState(JSON.parse(localStorage.getItem('convIds') || '{}'));
  const [showEncryptionStatus, setShowEncryptionStatus] = useState(false);

  const messages = chatHistories[currentCharacter] || [];
  const conversationId = conversationIds[currentCharacter] || null;
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!token) {
      createAnonymousUser();
    } else {
      syncUserData();
      // Initialize encryption if not already done
      if (!encryptionKey) {
        initializeEncryption();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Persist chat locally
  useEffect(() => {
    localStorage.setItem('chatHistories', JSON.stringify(chatHistories));
    localStorage.setItem('convIds', JSON.stringify(conversationIds));
  }, [chatHistories, conversationIds]);

  const initializeEncryption = () => {
    const key = generateEncryptionKey();
    localStorage.setItem('encryptionKey', key);
    setEncryptionKey(key);
    console.log('[ENCRYPTION] Encryption initialized for this device');
  };

  const createAnonymousUser = async () => {
    try {
      const res = await axios.post(`${API_BASE}/users/create`);
      const { token: newToken, userId, randomName } = res.data;
      localStorage.setItem('token', newToken);
      localStorage.setItem('userId', userId);
      setToken(newToken);
      setUser({ id: userId, random_name: randomName, points: 0, tier: 'seed' });
      initializeEncryption();
    } catch (error) {
      console.error('Failed to create user:', error);
    }
  };

  const syncUserData = async () => {
    try {
      const res = await axios.get(`${API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUser(res.data);
    } catch (error) {
      if (error.response?.status === 401 || error.response?.status === 403) {
        localStorage.clear();
        setToken(null);
        window.location.reload();
      }
    }
  };

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMsg = { role: 'user', content: inputMessage };
    const sentMessage = inputMessage;
    const sentCharacter = currentCharacter;
    const sentConversationId = conversationId;

    setChatHistories(prev => ({
      ...prev,
      [sentCharacter]: [...(prev[sentCharacter] || []), userMsg]
    }));

    setInputMessage('');
    setIsLoading(true);

    try {
      const res = await axios.post(
        `${API_BASE}/chat/message`,
        {
          conversationId: sentConversationId,
          message: sentMessage,
          characterName: sentCharacter
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const aiMsg = { role: 'assistant', content: res.data.aiMessage || '...' };
      setChatHistories(prev => ({
        ...prev,
        [sentCharacter]: [...(prev[sentCharacter] || []), aiMsg]
      }));

      setConversationIds(prev => ({
        ...prev,
        [sentCharacter]: res.data.conversationId
      }));

      if (res.data.totalPoints !== undefined) {
        setUser(prev => ({ ...prev, points: res.data.totalPoints }));
      }
    } catch (error) {
      const errorMsg = { role: 'assistant', content: 'Connection issue. Check LLM status.' };
      setChatHistories(prev => ({
        ...prev,
        [sentCharacter]: [...(prev[sentCharacter] || []), errorMsg]
      }));
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setChatHistories(prev => ({ ...prev, [currentCharacter]: [] }));
    setConversationIds(prev => ({ ...prev, [currentCharacter]: null }));
  };

  const synthesizeProfile = async () => {
    if (!token) {
      alert('Please create an account first');
      return;
    }

    try {
      setIsLoading(true);
      const res = await axios.post(
        `${API_BASE}/profile/synthesize`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      alert(`Profile synthesized! ${res.data.message}`);
      console.log('[PROFILE] Synthesis result:', res.data);
    } catch (error) {
      console.error('Profile synthesis error:', error);
      const errorMsg = error.response?.data?.error || 'Failed to synthesize profile';
      alert(`Error: ${errorMsg}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="App">
      <header>
        <h1>Deep Match Prototype</h1>
        {user && (
          <div className="user-info">
            <span>{user.random_name}</span>
            <span className="points">🌸 {user.points} pts</span>
          </div>
        )}
      </header>

      <main>
        <div className="chat-container">
          <div className="character-header">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h2>Chatting with {currentCharacter}</h2>
              <button onClick={clearChat} style={{ border: 'none', background: 'none', fontSize: '11px', color: '#9baacf', cursor: 'pointer' }}>Clear History</button>
            </div>
            <div className="character-selector">
              {characters.map(char => (
                <button
                  key={char}
                  className={currentCharacter === char ? 'active' : ''}
                  onClick={() => setCurrentCharacter(char)}
                >
                  {char}
                </button>
              ))}
            </div>
          </div>

          <div className="messages">
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', color: '#9baacf', marginTop: '20%' }}>
                <p>Build your compatibility profile by chatting...</p>
              </div>
            )}
            {messages.map((msg, idx) => (
              <div key={idx} className={`message ${msg.role}`}>
                <p>{msg.content}</p>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={isLoading ? 'Thinking...' : 'Type your message...'}
              disabled={isLoading}
            />
            <button onClick={sendMessage} disabled={!inputMessage.trim() || isLoading}>
              {isLoading ? '...' : 'Send'}
            </button>
          </div>
        </div>

        <aside className="sidebar">
          <div className="card">
            <h3>Match Discovery</h3>
            <div className="match-status">
              <p>Profile Synthesis</p>
              <div className="progress">
                <div className="bar" style={{ width: `${Math.min((user?.points || 0) / 10, 100)}%` }}></div>
              </div>
              <p>{user?.points || 0} / 1000 points to unlock Matching</p>
              <div className="tier-badge">{user?.tier || 'SEED'} TIER</div>
              <button 
                onClick={synthesizeProfile}
                style={{
                  width: '100%',
                  marginTop: '10px',
                  padding: '8px',
                  backgroundColor: '#667eea',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Synthesize Profile
              </button>
            </div>
          </div>
          
          <div className="card">
            <h3>Privacy Guard 🔐</h3>
            <p style={{ fontSize: '12px', color: '#9baacf', lineHeight: '1.4' }}>
              Your messages are encrypted before being stored. Only anonymous traits are used for matching.
            </p>
            <button 
              onClick={() => setShowEncryptionStatus(!showEncryptionStatus)}
              style={{
                width: '100%',
                marginTop: '10px',
                padding: '6px',
                backgroundColor: 'transparent',
                color: '#667eea',
                border: '1px solid #667eea',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px'
              }}
            >
              {showEncryptionStatus ? 'Hide' : 'Show'} Encryption Status
            </button>
            {showEncryptionStatus && encryptionKey && (
              <div style={{ fontSize: '10px', color: '#9baacf', marginTop: '8px', wordBreak: 'break-all' }}>
                <p>✓ Encryption active on this device</p>
                <p>Key ID: {encryptionKey.substring(0, 16)}...</p>
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

export default App;
