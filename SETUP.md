# Deep Match - Developer Setup & API Guide

This document covers the technical specifics for the Deep Match local prototype.

---

## 🐳 Docker Setup (Recommended)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- (Optional) [Ollama](https://ollama.ai) running on the host for LLM features

### Quick Start

```bash
# Build and start all services
docker compose up --build

# Or run in background
docker compose up --build -d
```

| Service  | URL                        | Description              |
|----------|----------------------------|--------------------------|
| Frontend | http://localhost:3001       | React UI (via nginx)     |
| Backend  | http://localhost:3000       | Express API              |
| Ollama   | http://localhost:11434      | LLM (runs on host)      |

### Useful Commands

```bash
# View logs
docker compose logs -f

# Restart a single service
docker compose restart backend

# Stop everything
docker compose down

# Stop and remove volumes (reset database)
docker compose down -v
```

### Environment Variables

Set these in a `.env` file in the project root, or pass them directly:

| Variable       | Default                      | Description                        |
|----------------|------------------------------|------------------------------------|
| `JWT_SECRET`   | `super-secret-key-for-dev`   | Secret key for signing JWT tokens  |
| `OLLAMA_HOST`  | `http://host.docker.internal:11434` | Ollama API endpoint        |
| `DB_PATH`      | `/app/data/deepmatch.db`     | SQLite database file path          |

### Data Persistence

SQLite data is stored in a Docker named volume (`backend-data`). Your data survives container restarts. To reset the database, run `docker compose down -v`.

---

## 🛠 Local Development (without Docker)

### Backend Setup

```bash
cd backend
npm install
npm start
```

#### Environment Variables (`backend/.env`)
- `JWT_SECRET`: Secret key for signing authentication tokens.
- `PORT`: Server port (default: 3000).

### Frontend Setup

```bash
cd frontend
npm install
REACT_APP_API_BASE=http://localhost:3000/api npm start
```

> **Note**: When running outside Docker, set `REACT_APP_API_BASE=http://localhost:3000/api` so the frontend knows where the backend is.

---

## 📡 API Endpoints

#### Users
- `POST /api/users/create`: Generates a new random identity and returns a JWT.

#### Chat
- `POST /api/chat/message`: Sends a message to a specific AI character.
  - Body: `{ message, characterName, conversationId? }`
  - Header: `Authorization: Bearer <token>`
  - Response: `{ aiMessage, pointsEarned, totalPoints, conversationId }`

#### Profiles & Matches
- `POST /api/profile/build`: Uploads an encrypted profile blob and vector.
- `GET /api/matches/next`: Retrieves the highest compatibility match (Requires a built profile).

## 🗄 Database Schema (SQLite)
The prototype uses `deepmatch.db` with the following tables:
- `users`: Metadata, points, and account status.
- `profiles`: Encrypted JSON blobs and match vectors.
- `conversations`: History of messages (unencrypted in prototype for debug).
- `points_ledger`: History of all point transactions.

## 🎨 Frontend Details
The React app uses vanilla CSS in `App.css`. The design uses a "Visual Novel" aesthetic:
- **Gradients**: Linear gradients for character headers.
- **Glassmorphism**: Subtle transparencies in the chat UI.
- **Micro-interactions**: Hover states for character selection.

### 🧠 LLM Integration & Troubleshooting

The server sends an OpenAI-compatible POST request to LM Studio's API (configurable via `LLM_HOST`). 

**Important for Docker Users**: 
By default, LM Studio only listens on `localhost:1234`. To allow the Docker container to reach it, you must tell LM Studio to listen on all interfaces:

1. Open LM Studio and go to the **Local Server** (↔) tab on the left.
2. Check the box for **CORS (Cross-Origin Resource Sharing)**.
3. Make sure the server is active on Port `1234`.
4. In the LM Studio Server settings, change the **Listen on / Bind to** address to `0.0.0.0` or `*` instead of `localhost`.
5. Start the Server.

If the API is still unreachable or down, the server automatically switches to **Mock Mode**, providing pre-written responses to ensure the UI remains testable.

You can check the connection status at any time via the backend health endpoint:
`http://localhost:3000/api/health/llm`
