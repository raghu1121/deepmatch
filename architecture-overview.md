# Match Quest - System Architecture Overview

## Executive Summary

Match Quest is a privacy-first AI dating platform that combines gamified visual novel mechanics with real-world matchmaking. Users engage in deep conversations with AI characters to build encrypted compatibility profiles, earning points that unlock matches with real users who share complementary traits.

## Core Philosophy

**"We don't want to know who you are. We only care about finding who fits you."**

- No phone number required
- No email required (optional for recovery)
- No photos required (avatars only)
- End-to-end encrypted profiles that even we cannot read
- Anonymous by default, transparent by design

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
├─────────────────────────────────────────────────────────────┤
│  iOS App (React Native / Swift)                             │
│  - AI Chat Interface (Visual Novel UI)                      │
│  - Profile Builder                                          │
│  - Match Queue Display                                      │
│  - Points Dashboard                                         │
│  - E2E Encryption (Client-side key generation)             │
└─────────────────────────────────────────────────────────────┘
                            ↕ HTTPS + TLS 1.3
┌─────────────────────────────────────────────────────────────┐
│                      API Gateway Layer                       │
├─────────────────────────────────────────────────────────────┤
│  - Rate Limiting                                            │
│  - Authentication (Magic Link JWT)                          │
│  - Request Validation                                       │
│  - Load Balancing                                           │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                         │
├─────────────────────────────────────────────────────────────┤
│  Microservices:                                             │
│  1. Conversation Service (AI Chat Handler)                  │
│  2. Profile Service (Encrypted Storage)                     │
│  3. Matching Engine (Compatibility Algorithm)               │
│  4. Points Service (Gamification Logic)                     │
│  5. Notification Service (Push/In-App)                      │
│  6. Payment Service (Deposit Management)                    │
│  7. Moderation Service (Behavior Tracking)                  │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                       Data Layer                             │
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL:                                                │
│  - User metadata (random_id, created_at, login_streak)     │
│  - Encrypted profile blobs (AES-256-GCM)                    │
│  - Match history (anonymized)                               │
│  - Points ledger                                            │
│                                                             │
│  Redis:                                                     │
│  - Session management                                       │
│  - Match queue cache                                        │
│  - Rate limiting counters                                   │
│                                                             │
│  S3-Compatible Storage:                                     │
│  - Avatar images (optional, encrypted)                      │
│  - Conversation archives (encrypted, user-controlled)       │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                     AI/ML Layer                              │
├─────────────────────────────────────────────────────────────┤
│  LLM Service (OpenAI API / Self-hosted):                    │
│  - Character dialogue generation                            │
│  - Preference extraction from conversations                 │
│  - Compatibility scoring                                    │
│                                                             │
│  Matching Algorithm:                                        │
│  - Vector embeddings (cosine similarity)                    │
│  - Behavioral reinforcement learning                        │
│  - Priority queue optimization                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. Anonymous User Identity System

**Random Meaningful IDs:**
- Format: `Adjective + Archetype + Number` (e.g., "Curious Wanderer #472")
- Generated on first launch
- Changeable once per month

**Magic Link Authentication:**
- User enters email (optional, for recovery only)
- Time-limited JWT sent via email (15-min expiration, single-use)
- No password storage

**Encryption Key Management:**
- Client generates 256-bit AES key on device
- Key stored in iOS Keychain / Android Keystore
- Profile encrypted client-side before upload
- Server stores only ciphertext

### 2. AI Conversation System

**Visual Novel Interface:**
- Character portraits with mood variations
- Text-based dialogue with multiple choice responses
- Branching conversation paths
- Points awarded for depth/honesty

**LLM Integration:**
- Server-side processing (OpenAI GPT-4 or self-hosted Llama 3)
- Trusted Execution Environment (TEE) for input isolation
- Conversation context maintained in encrypted session
- Preference extraction pipeline:
  - Raw conversation → LLM analysis → Structured traits → Encrypted profile

**Character Roster:**
- 5-10 AI personalities (diverse archetypes)
- Each designed to probe different compatibility dimensions:
  - Communication style
  - Values hierarchy
  - Emotional needs
  - Physical preferences
  - Life goals

### 3. Compatibility Profile Structure

**Extracted Traits (encrypted JSON):**

```json
{
  "user_id": "curious-wanderer-472",
  "version": 2,
  "updated_at": "2026-02-10T12:00:00Z",
  "traits": {
    "communication": {
      "style": "direct",
      "humor": "sarcastic",
      "conflict_resolution": "collaborative",
      "emotional_expression": "moderate"
    },
    "values": {
      "top_3": ["authenticity", "adventure", "intellectual_growth"],
      "dealbreakers": ["dishonesty", "lack_of_ambition"]
    },
    "lifestyle": {
      "activity_level": "high",
      "social_preference": "ambivert",
      "routine_flexibility": "spontaneous"
    },
    "relationship": {
      "commitment_style": "monogamous",
      "attachment": "secure",
      "love_languages": ["quality_time", "physical_touch"]
    },
    "intimacy": {
      "importance": "high",
      "preferences": ["..."],
      "boundaries": ["..."]
    }
  },
  "embeddings": {
    "vector": [0.234, -0.567, 0.891, ...],  // 768-dim for matching
    "model": "text-embedding-3-large"
  }
}
```

This entire blob is encrypted with the user's key before storage.

### 4. Points & Gamification System

**Point Accumulation:**
- Base: 10 points per conversation message
- Depth bonus: 2x multiplier after 50 messages with same character
- Honesty bonus: 50 points for flagging "this is hard to share"
- Streak bonus: 2x points for 7-day login streak
- Match feedback: +100 points for post-match rating

**Tier System:**

| Tier | Points | Badge | Visibility |
|------|--------|-------|-----------|
| Seed | 0-100 | 🌱 New | Basic profile visible to matches |
| Sprout | 101-500 | 🌿 Active | Full profile + "Active" badge |
| Bloom | 501-2000 | 🌸 Expressive | Priority matching + "Expressive" badge |
| Veteran | 2000+ | 🌳 Seasoned | Top priority + verified quality |

**Hidden Match Quality Score:**
- % of matches accepted by others
- Average conversation duration with matches
- Post-date ratings (1-5 stars)
- This is INTERNAL ONLY—used to rank matches, never shown

### 5. Matching Algorithm

**One-Match-at-a-Time Queue:**

```python
def get_best_match(user_id):
    # Get all active users (logged in last 7 days)
    candidates = get_active_users(exclude=user_id)
    
    # Calculate compatibility for each
    scores = []
    for candidate in candidates:
        compatibility = cosine_similarity(
            user.embedding, 
            candidate.embedding
        )
        
        match_quality = candidate.match_quality_score
        recent_rejections = count_rejections(user_id, candidate.traits)
        
        final_score = (compatibility * match_quality) / (recent_rejections + 1)
        scores.append((candidate, final_score))
    
    # Sort and return top match
    best_match = max(scores, key=lambda x: x[1])
    return best_match
```

**Match Lifecycle:**
1. Both users presented with each other (one at a time)
2. 3-day decision window
3. Options: Accept, Not Now, Never (with reason)
4. If mutual accept → Private chat opens
5. If one rejects → Both get next match after cooldown
6. If expired → Same as rejection

### 6. Privacy & Security Architecture

**Data Classification:**

| Data Type | Storage | Encryption | Access |
|-----------|---------|------------|--------|
| Random ID | PostgreSQL plaintext | None (not sensitive) | Server can read |
| Email (optional) | PostgreSQL hashed | bcrypt | Server can verify, not read |
| Profile blob | PostgreSQL | AES-256-GCM (user key) | Server cannot read |
| Conversation logs | S3, encrypted | AES-256-GCM (user key) | Server cannot read |
| Match history | PostgreSQL anonymized | None (no PII) | Server can read for algorithm |
| Payment info | Stripe/external | PCI-DSS compliant | Never stored on our servers |

**Threat Model & Mitigations:**

| Threat | Mitigation |
|--------|------------|
| Database breach | All sensitive data encrypted with user keys |
| Insider threat | Zero-knowledge architecture—admins can't read profiles |
| Man-in-the-middle | TLS 1.3 + certificate pinning |
| Account takeover | Magic links expire in 15 min, rate-limited |
| Fake accounts | Refundable deposit + behavior tracking |
| Harassment | Escalating warnings, AI-mediated chat, shadowban |

### 7. Payment & Anti-Spam System

**Refundable Deposit Model:**
- $5-10 deposit required to unlock matching
- Held in escrow (Stripe Connect)
- Refunded after 30 days of active use (weekly logins)
- Prevents mass fake accounts without compromising anonymity

**Free vs. Paid Tiers:**

| Feature | Free | Depositor | Premium Subscriber |
|---------|------|-----------|-------------------|
| AI conversations | Unlimited | Unlimited | Unlimited |
| Matches per month | 0 | 4 | Unlimited |
| Priority matching | No | Yes | Yes + Algorithm boost |
| Match history | Last 3 | All | All + Analytics |
| Custom avatars | Basic | Basic | Custom upload |

### 8. Behavior Moderation

**Strike System:**

```
Strike 1: Warning + AI etiquette module (can clear)
Strike 2: 7-day "rehabilitation pool" (only matched with similar)
Strike 3: All matches AI-mediated (must prove 3 positive interactions)
Strike 4: Permanent shadowban to bad-actor pool
```

**Detection Methods:**
- User reports (weighted by reporter's credibility)
- AI sentiment analysis (aggressive language, manipulation)
- Behavioral patterns (rapid ghosting, inappropriate first messages)

**False Positive Mitigation:**
- Appeal process (submit explanation to AI review)
- Cultural sensitivity training for AI moderator
- Expire Strike 1 after 90 days of good behavior

---

## Data Flow: User Journey

### Phase 1: Onboarding (Anonymous)
1. User downloads app
2. App generates random ID ("Curious Wanderer #472") + encryption key
3. User starts chatting with first AI character (no signup required)
4. Profile built locally, points accumulate
5. After 100 points, prompt: "Ready to match? Enter email for magic link"

### Phase 2: Matching Activation
6. User enters email (optional), pays $5 deposit
7. Profile encrypted with user's key, uploaded to server
8. User marked "active" in matching pool
9. Weekly login required to stay active

### Phase 3: First Match
10. Algorithm calculates best match
11. Both users notified in-app: "You have a potential match!"
12. Both shown encrypted profile summary (decrypted client-side with their own key)
13. 3 days to accept/reject
14. If mutual: In-app E2E encrypted chat opens

### Phase 4: Continuous Improvement
15. After 10 messages, app suggests exchanging off-platform contact
16. One week later: "Rate your match" (1-5 stars)
17. Feedback feeds back into matching algorithm
18. Points continue accumulating, new matches unlocked monthly

---

## Scalability Considerations

### Prototype (MacBook Local)
- SQLite database
- Local LLM (LM Studio with Llama 3 or compatible open weights)
- Single Node.js server
- React Native app (iOS simulator)

### Production (Cloud)
- PostgreSQL with read replicas
- Redis for caching/session management
- Kubernetes for microservices orchestration
- OpenAI API (or self-hosted LLM on GPU instances)
- CloudFront CDN for static assets
- Multi-region deployment for latency

### Bottlenecks & Solutions

| Bottleneck | Solution |
|------------|----------|
| LLM latency | Cache common responses, streaming responses, batch processing |
| Matching computation | Pre-compute embeddings, cache scores, run hourly batch jobs |
| Database writes | Write-through cache, async profile updates, connection pooling |
| Real-time chat | WebSocket servers with horizontal scaling, Redis pub/sub |

---

## Compliance & Legal

### GDPR Compliance
- **Data minimization**: Only collect what's needed for matching
- **Right to erasure**: One-tap delete (wipes encrypted blobs)
- **Right to access**: Export encrypted profile (user decrypts with key)
- **Special category data**: Explicit consent for sexual preferences
- **DPIA required**: Completed before launch

### Terms of Service Key Points
- Users own their data
- We cannot read encrypted profiles
- Matches are algorithmic suggestions, not guarantees
- Behavioral moderation explained transparently
- Deposit refund conditions clearly stated

---

## Success Metrics

### Engagement Metrics
- Daily/Weekly Active Users (DAU/WAU)
- Average messages per session with AI
- Points earned per week
- Login streak distribution

### Matching Metrics
- Match acceptance rate (both sides)
- Time to first mutual match
- Post-match chat duration
- Date conversion rate (% who meet IRL)

### Business Metrics
- Deposit conversion rate
- Churn rate (7-day, 30-day)
- Lifetime value (LTV)
- Cost per match

### Quality Metrics
- User-reported satisfaction (1-5 stars)
- Strike rate (% users flagged for bad behavior)
- Algorithm precision (accepted matches / presented matches)
- Retention cohorts

---

## Future Enhancements (Post-MVP)

1. **Voice mode**: Voice conversations with AI characters
2. **Group matching**: Polyamorous/ENM users matched in triads
3. **Events system**: Virtual speed-dating nights
4. **Mentor mode**: High-scoring veterans help new users improve profiles
5. **API for third-party apps**: Compatibility scoring as a service
6. **Web version**: PWA for desktop access
7. **Decentralized storage**: IPFS for ultimate privacy

---

## Conclusion

Match Quest solves the dating app paradox: apps need deep user data to make good matches, but users rightfully distrust apps with their intimate information. By combining client-side encryption, gamified engagement, and AI-driven conversations, we create a system where users willingly share their authentic selves because they control the keys—literally.

The architecture prioritizes privacy as a feature, not a constraint, positioning Match Quest as the only dating platform that mathematically cannot betray user trust.