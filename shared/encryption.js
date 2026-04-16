/**
 * Encryption utilities for client-side E2E encryption
 * Uses AES-256-GCM for maximum security
 */

// Note: In Node.js environment
let CryptoJS;
if (typeof window === 'undefined') {
  // Node.js
  CryptoJS = require('crypto-js');
}

/**
 * Generate a random encryption key
 * @returns {string} Base64-encoded 256-bit key
 */
export function generateEncryptionKey() {
  if (typeof window !== 'undefined') {
    // Browser environment
    const key = window.crypto.getRandomValues(new Uint8Array(32));
    return btoa(String.fromCharCode.apply(null, key));
  } else {
    // Node.js
    const crypto = require('crypto');
    return crypto.randomBytes(32).toString('base64');
  }
}

/**
 * Encrypt text with AES-256-GCM
 * @param {string} plaintext - Text to encrypt
 * @param {string} key - Base64-encoded encryption key
 * @returns {string} JSON string containing ciphertext and IV
 */
export function encryptText(plaintext, key) {
  try {
    if (!plaintext || !key) {
      throw new Error('plaintext and key are required');
    }

    if (typeof window !== 'undefined') {
      // Browser: Use crypto-js
      const encrypted = window.CryptoJS.AES.encrypt(plaintext, key).toString();
      return encrypted;
    } else {
      // Node.js: Use native crypto
      const crypto = require('crypto');
      const keyBuffer = Buffer.from(key, 'base64');
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
      
      let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
      ciphertext += cipher.final('hex');
      const authTag = cipher.getAuthTag();
      
      return JSON.stringify({
        iv: iv.toString('hex'),
        ciphertext: ciphertext,
        authTag: authTag.toString('hex')
      });
    }
  } catch (error) {
    console.error('[ENCRYPTION] Encryption error:', error);
    throw error;
  }
}

/**
 * Decrypt text with AES-256-GCM
 * @param {string} encrypted - Encrypted data (JSON string or CryptoJS output)
 * @param {string} key - Base64-encoded encryption key
 * @returns {string} Decrypted plaintext
 */
export function decryptText(encrypted, key) {
  try {
    if (!encrypted || !key) {
      throw new Error('encrypted and key are required');
    }

    if (typeof window !== 'undefined') {
      // Browser: Use crypto-js
      const decrypted = window.CryptoJS.AES.decrypt(encrypted, key).toString(window.CryptoJS.enc.Utf8);
      return decrypted;
    } else {
      // Node.js: Use native crypto
      const crypto = require('crypto');
      const keyBuffer = Buffer.from(key, 'base64');
      
      const data = JSON.parse(encrypted);
      const iv = Buffer.from(data.iv, 'hex');
      const ciphertext = Buffer.from(data.ciphertext, 'hex');
      const authTag = Buffer.from(data.authTag, 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
      decipher.setAuthTag(authTag);
      
      let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
      plaintext += decipher.final('utf8');
      
      return plaintext;
    }
  } catch (error) {
    console.error('[ENCRYPTION] Decryption error:', error);
    throw error;
  }
}

/**
 * Store encryption key in browser localStorage
 * @param {string} key - Encryption key to store
 * @param {string} userId - User ID to associate with key
 */
export function storeEncryptionKey(key, userId) {
  if (typeof window === 'undefined') {
    console.warn('[ENCRYPTION] storeEncryptionKey only works in browser');
    return;
  }
  localStorage.setItem(`encKey_${userId}`, key);
}

/**
 * Retrieve encryption key from browser localStorage
 * @param {string} userId - User ID
 * @returns {string|null} Encryption key or null if not found
 */
export function getStoredEncryptionKey(userId) {
  if (typeof window === 'undefined') {
    console.warn('[ENCRYPTION] getStoredEncryptionKey only works in browser');
    return null;
  }
  return localStorage.getItem(`encKey_${userId}`);
}

/**
 * Clear stored encryption key
 * @param {string} userId - User ID
 */
export function clearStoredEncryptionKey(userId) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(`encKey_${userId}`);
}

export default {
  generateEncryptionKey,
  encryptText,
  decryptText,
  storeEncryptionKey,
  getStoredEncryptionKey,
  clearStoredEncryptionKey
};
