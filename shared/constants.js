/**
 * Shared utilities and constants
 */

// Tier progression system
export const TIER_THRESHOLDS = {
  'seed': 0,
  'sprout': 100,
  'star': 500,
  'eagle': 1000,
  'dragon': 2000,
  'phoenix': 5000
};

export const TIER_NAMES = [
  { tier: 'seed', emoji: '🌱', name: 'Seed' },
  { tier: 'sprout', emoji: '🌿', name: 'Sprout' },
  { tier: 'star', emoji: '⭐', name: 'Star' },
  { tier: 'eagle', emoji: '🦅', name: 'Eagle' },
  { tier: 'dragon', emoji: '🐉', name: 'Dragon' },
  { tier: 'phoenix', emoji: '🔥', name: 'Phoenix' }
];

// Character data
export const AI_CHARACTERS = [
  {
    name: 'Playful Romeo',
    emoji: '😏',
    focus: 'communication style and humor',
    description: 'A witty, slightly arrogant flirt'
  },
  {
    name: 'Wise Sage',
    emoji: '🧙',
    focus: 'core values and purpose',
    description: 'A quiet, observant philosopher'
  },
  {
    name: 'Direct Debby',
    emoji: '💪',
    focus: 'conflict resolution and directness',
    description: 'A blunt, high-energy realist'
  },
  {
    name: 'Compassionate Soul',
    emoji: '💚',
    focus: 'emotional needs and attachment',
    description: 'A grounded, empathetic listener'
  },
  {
    name: 'Ambitious Al',
    emoji: '🚀',
    focus: 'life goals and ambition',
    description: 'A restless, high-stakes operator'
  }
];

/**
 * Get tier info by points
 * @param {number} points - User points
 * @returns {object} Tier information
 */
export function getTierByPoints(points) {
  const thresholds = Object.entries(TIER_THRESHOLDS).reverse();
  for (const [tier, minPoints] of thresholds) {
    if (points >= minPoints) {
      return TIER_NAMES.find(t => t.tier === tier) || TIER_NAMES[0];
    }
  }
  return TIER_NAMES[0]; // seed
}

/**
 * Calculate points needed to next tier
 * @param {number} currentPoints - Current user points
 * @returns {object} Info about next tier
 */
export function getNextTierInfo(currentPoints) {
  const thresholds = Object.entries(TIER_THRESHOLDS);
  for (let i = 0; i < thresholds.length - 1; i++) {
    const [_, currentMin] = thresholds[i];
    const [nextTier, nextMin] = thresholds[i + 1];
    
    if (currentPoints >= currentMin && currentPoints < nextMin) {
      return {
        nextTier: TIER_NAMES.find(t => t.tier === nextTier),
        pointsNeeded: nextMin - currentPoints,
        totalRequired: nextMin
      };
    }
  }
  
  // Already at max tier
  return {
    nextTier: null,
    pointsNeeded: 0,
    totalRequired: null
  };
}

/**
 * Format timestamp as relative time
 * @param {number} timestamp - Milliseconds since epoch
 * @returns {string} Relative time string
 */
export function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Validate JWT token (client-side basic check)
 * @param {string} token - JWT token
 * @returns {object|null} Decoded token or null if invalid
 */
export function validateJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return null; // Token expired
    }
    
    return payload;
  } catch (e) {
    return null;
  }
}

export default {
  TIER_THRESHOLDS,
  TIER_NAMES,
  AI_CHARACTERS,
  getTierByPoints,
  getNextTierInfo,
  formatRelativeTime,
  validateJWT
};
