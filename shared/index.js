/**
 * Shared exports
 */

export { 
  generateEncryptionKey,
  encryptText,
  decryptText,
  storeEncryptionKey,
  getStoredEncryptionKey,
  clearStoredEncryptionKey
} from './encryption.js';

export {
  TIER_THRESHOLDS,
  TIER_NAMES,
  AI_CHARACTERS,
  getTierByPoints,
  getNextTierInfo,
  formatRelativeTime,
  validateJWT
} from './constants.js';
