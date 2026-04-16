# Deep Match 🌸

A privacy-first AI dating platform prototype that combines gamified visual novel mechanics with real-world matchmaking. This local prototype demonstrates the core "Discovery" phase where users chat with AI characters to build an anonymous, encrypted compatibility profile.

## 🏗 Project Structure
- **/backend**: Express.js server, SQLite database, and LM Studio LLM integration.
- **/frontend**: React.js web interface with CSS styling.
- **/shared**: (Placeholder) Common types and utilities.

## 🚀 Getting Started

### Prerequisites
- **Docker Desktop**: (Recommended) For containerized setup.
- **LM Studio**: (Optional but recommended) For local LLM responses via its OpenAI-compatible server on port 1234.
  - Download from [lmstudio.ai](https://lmstudio.ai/)
  - Start the Local Server and ensure it binds to `0.0.0.0` or `*`.

### Running with Docker
```bash
docker compose up --build
```
- **Frontend**: http://localhost:3001
- **Backend**: http://localhost:3000

### Running Locally (without Docker)
From the root directory:
```bash
npm install
npm run dev
```
- **Frontend**: http://localhost:3001
- **Backend**: http://localhost:3000

## 🤖 AI Characters
The prototype features 5 AI NPCs, each probing different parts of your compatibility:
1. **Playful Romeo**: Humor & Communication style.
2. **Wise Sage**: Core values & Spirituality.
3. **Direct Debby**: Conflict resolution & Honesty.
4. **Compassionate Soul**: Emotional needs & Attachment.
5. **Ambitious Al**: Life goals & Ambition.

## 🔒 Privacy & Architecture
- **Anonymous IDs**: Users are identified by random names (e.g., "Curious Wanderer #472").
- **Client-Side Encryption**: A 256-bit AES key is generated on the client. Profiles are encrypted before storage.
- **Points System**: Users earn "points" for honest engagement, which eventually unlocks matching with real users.

## 🛣 Roadmap
- [x] Phase 1: Local Prototype (Node + React + LM Studio)
- [ ] Phase 2: iOS App Development (Native Swift/React Native)
- [ ] Phase 3: Cloud Deployment (Postgres + Redis + Kubernetes)
- [ ] Phase 4: Production Launch
