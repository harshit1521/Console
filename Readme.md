# Console

Console is an online, distributed, queue-driven code execution platform. It allows users to write, compile, and execute code in real-time within highly isolated, secure Docker sandboxes. It supports real-time terminal stream piping (`stdout`, `stderr`, and interactive `stdin`) via WebSockets.

Currently supported languages:
* **JavaScript** (Node.js)
* **TypeScript** (TSX JIT)
* **Python**
* **C++** (GCC)
* **Java** (OpenJDK)

---

## Architecture Overview

![Console architecture](./assets/Screenshot%202026-07-15%20015052.png)

1. **Frontend Client ([client](file:///c:/AllCSstuff/DEV/Console/client))**: A React application featuring a Monaco editor for writing code, template boilers, and Xterm.js for a terminal environment. Interactive input streams are piped live to the WS server.
2. **WebSocket Server ([server](file:///c:/AllCSstuff/DEV/Console/server))**: A Node.js server that manages client sessions, assigns execution tasks to a Redis queue, and bridges real-time `stdin`, output, and termination requests between the client and the worker.
3. **Execution Worker ([worker](file:///c:/AllCSstuff/DEV/Console/worker))**: A Node.js daemon that pops tasks from the queue, handles compile/execute lifecycle hooks, monitors timeouts and output limits, and runs the untrusted code within transient, locked-down Docker containers.

---

## Security Sandboxing & Guardrails

To protect the host system from untrusted user code execution, every Docker container is strictly isolated:

| Guardrail | Configuration | Purpose |
| :--- | :--- | :--- |
| **Network Isolation** | `--network none` | Prevents outbound internet access, database connection attempts, or VPS metadata scanning. |
| **Memory Limit** | `--memory=256m` / `512m` | Prevents resource starvation or Out-of-Memory (OOM) host crashes. |
| **CPU Control** | `--cpus=0.5` | Throttles CPU usage to prevent infinite loops from freezing the host CPU. |
| **Ephemeral Filesystem** | `--rm` | Automatically destroys the container filesystem immediately upon exit. |
| **Volume Mount** | `-v host:app:ro` | Mounts the code directory in read-only mode so the code cannot alter the host source directories. |
| **Output Limit** | Max 5 MB | Kills execution if code floods output buffers (`[ERROR]: Output limit exceeded.`). |
| **Timeout Protection** | 20 seconds hard timeout | Kills running processes using OS-native tree-killing (`taskkill` on Windows, `SIGKILL` on POSIX). |

---

## Project Structure

* [client/](file:///c:/AllCSstuff/DEV/Console/client) — React & TypeScript Frontend (Vite, Monaco Editor, Tailwind CSS, Xterm.js)
* [server/](file:///c:/AllCSstuff/DEV/Console/server) — WebSocket Orchestrator (Node.js, ws, Express)
* [worker/](file:///c:/AllCSstuff/DEV/Console/worker) — Execution Worker Daemon (spawns sandboxed Docker containers)
* [assets/](file:///c:/AllCSstuff/DEV/Console/assets) — Assets and architecture diagrams

---

## Prerequisites

Before running the application locally or in production, ensure you have:
* **Node.js** (v20.x LTS or higher)
* **Docker Engine** / **Docker Desktop**
* **Redis** (e.g., Upstash Redis, or a local Redis instance)
* **PostgreSQL** (Prisma ORM database connection - configured via environmental variables)

---

## Local Installation & Setup

Follow these steps to run all components locally:

### 1. Clone the Repository
```bash
git clone <your-repository-url> Console
cd Console
```

### 2. Configure Environment Variables
Create a `.env` file in **both** the `server/` and `worker/` directories:

```env
# server/.env & worker/.env
REDIS_URL="rediss://default:YOUR_PASSWORD@YOUR_REDIS_ENDPOINT:6379"
```

### 3. Pre-Pull Docker Sandboxing Images
Ensure the following base images are downloaded to avoid delays on the first code run:
```bash
docker pull node:20-slim
docker pull python:3.11-slim
docker pull gcc:13
docker pull eclipse-temurin:21-jdk-jammy
```
*(Note: A local custom image named `node-tsx` must be present for TypeScript files execution as defined in `worker/index.ts`)*

### 4. Install and Start Services

#### **A. Start the WebSocket Server**
```bash
cd server
npm install
npx tsx index.ts
```

#### **B. Start the Worker**
```bash
cd ../worker
npm install
npx tsx index.ts
```

#### **C. Start the Frontend Client**
```bash
cd ../client
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.

---

## Multi-Language Support Grid

| Language | Extension | Execution Environment (Docker) | Execution Details |
| :--- | :--- | :--- | :--- |
| **JavaScript** | `.mjs` | `node:20-slim` | Spawns `node <id>.mjs` |
| **TypeScript** | `.ts` | `node-tsx` | Spawns `tsx <id>.ts` |
| **Python** | `.py` | `python:3.11-slim` | Spawns `python3 -u <id>.py` |
| **C++** | `.cpp` | `gcc:13` | Compiles using `g++`, then executes binary |
| **Java** | `.java` | `eclipse-temurin:21-jdk-jammy` | Compiles using `javac`, then executes `Main` class |

---

## API & WebSocket Protocol

### WebSocket Connection
The client connects to the WebSocket server at:
`ws://localhost:8080` (or your production server URL).

### Messages Format

#### **1. Run Request (Client ➔ Server)**
```json
{
  "code": "print('Hello, World!')",
  "language": "PYTHON",
  "id": "unique-task-id-123"
}
```

#### **2. Stream Output (Server ➔ Client)**
```json
{
  "type": "stdout",
  "data": "Hello, World!\n"
}
```

#### **3. Stream Input (Client ➔ Server)**
```json
{
  "type": "stdin",
  "data": "user input text"
}
```

#### **4. Execution Complete (Server ➔ Client)**
```json
{
  "type": "done",
  "status": "SUCCESS" // Or "COMPILE_ERROR", "TIMEOUT", "LIMIT_EXCEEDED"
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
1. Fork the Project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

---

## License

This project is licensed under the **ISC License** - see the individual package metadata for details.

---
