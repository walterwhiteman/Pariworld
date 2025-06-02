import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes"; // This likely imports your Express API routes
import { setupVite, serveStatic, log } from "./vite";
import cors from 'cors';
// --- NEW IMPORT FOR SOCKET.IO SERVER ---
import { Server as SocketIOServer } from 'socket.io'; // Import Socket.IO Server
// --- END NEW IMPORT ---

// --- NEW IMPORT FOR DATABASE CONNECTION ---
import pkg from 'pg';
const { Pool } = pkg;
// --- END NEW IMPORT ---

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- EXISTING CORS CONFIGURATION BLOCK ---
app.use(cors({
  origin: "https://pariworld.onrender.com", // <<<< IMPORTANT: REPLACE WITH YOUR ACTUAL RENDER FRONTEND URL
  methods: ["GET", "POST", "PUT", "DELETE"], // Allow common HTTP methods
  credentials: true // Allow cookies and authorization headers if your app uses them
}));
// --- END CORS CONFIGURATION BLOCK ---

// --- NEW: DATABASE POOL & API KEY SETUP ---
// Ensure DATABASE_URL and CLEANUP_API_KEY are set as environment variables on Render!
const connectionString = process.env.DATABASE_URL;
const CLEANUP_API_KEY = process.env.CLEANUP_API_KEY;

if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set. Cleanup will not run.');
}
if (!CLEANUP_API_KEY) {
    console.error('CLEANUP_API_KEY environment variable is not set. Cleanup endpoint will be INSECURE!');
}

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false // Required for Neon if not using specific CA certs
    }
});
// --- END NEW: DATABASE POOL & API KEY SETUP ---


// --- NEW: AUTHENTICATION MIDDLEWARE (THE "SECRET KEY" CHECKER) ---
function authenticateCleanup(req: Request, res: Response, next: NextFunction) {
    const providedKey = req.headers['x-cleanup-api-key'] || req.query.key;

    if (!providedKey || providedKey !== CLEANUP_API_KEY) {
        console.warn(`[${new Date().toISOString()}] Unauthorized attempt to access cleanup endpoint.`);
        return res.status(401).send('Unauthorized: Invalid or missing API Key.');
    }
    next();
}
// --- END NEW: AUTHENTICATION MIDDLEWARE ---


// --- EXISTING LOGGING MIDDLEWARE ---
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});
// --- END EXISTING LOGGING MIDDLEWARE ---


(async () => {
  const server = await registerRoutes(app); // Your existing route registration, this `server` is likely your http.Server instance.

    // --- NEW: Initialize Socket.IO Server ---
    // This attaches Socket.IO to the *same* HTTP server instance that Express uses.
    const io = new SocketIOServer(server, { // Attach Socket.IO to the 'server' returned by registerRoutes
        path: '/ws', // This MUST match the frontend's `path` option in useSocket.ts
        cors: {
            origin: "https://pariworld.onrender.com", // <<<< IMPORTANT: Match your frontend Render URL
            methods: ["GET", "POST"]
        }
    });

    // --- NEW: Basic Socket.IO Connection Handler ---
    // This is where you will define all your real-time event logic (join-room, send-message, etc.)
    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}`);

        socket.on('disconnect', (reason) => {
            console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        });

        // ====================================================================
        // IMPORTANT: ADD YOUR CHAT-SPECIFIC SOCKET.IO EVENT LISTENERS HERE!
        // These are the events your frontend emits (e.g., 'join-room', 'send-message').
        // You will need to implement the logic for each of these:
        // ====================================================================

        // Example:
        // socket.on('join-room', (payload: { roomId: string; username: string }) => {
        //     console.log(`${payload.username} joining room ${payload.roomId}`);
        //     socket.join(payload.roomId);
        //     // Optionally, broadcast to others that a user joined, send participant list etc.
        //     // io.to(payload.roomId).emit('user-joined-notification', { username: payload.username });
        //     // Also send initial state to the joining user:
        //     // const participants = Array.from(io.sockets.adapter.rooms.get(payload.roomId) || []).map(id => io.sockets.sockets.get(id)?.data.username);
        //     // socket.emit('room-joined', { roomId: payload.roomId, participants: participants });
        // });

        // socket.on('send-message', (message: { roomId: string; sender: string; content: string }) => {
        //     console.log(`Message from ${message.sender} in room ${message.roomId}: ${message.content}`);
        //     // Save message to DB (using your 'pool' from above)
        //     // Broadcast message to all in the room
        //     // io.to(message.roomId).emit('message-received', { ...message, id: 'some-db-id', timestamp: new Date().toISOString() });
        // });

        // ... and so on for 'leave-room', 'typing-start', 'typing-stop', etc.
    });
    // --- END NEW SOCKET.IO SETUP ---


  // --- NEW: API ENDPOINT FOR MESSAGE CLEANUP ---
  app.post('/api/cleanup-messages', authenticateCleanup, async (req: Request, res: Response) => {
      console.log(`[${new Date().toISOString()}] External cleanup trigger received.`);
      try {
          const client = await pool.connect();
          const query = `DELETE FROM messages WHERE timestamp < NOW() - INTERVAL '24 hours';`;
          const result = await client.query(query);
          client.release();
          console.log(`[${new Date().toISOString()}] Successfully deleted ${result.rowCount} messages.`);
          res.status(200).send(`Successfully deleted ${result.rowCount} messages.`);
      } catch (err) {
          console.error(`[${new Date().toISOString()}] Error during external cleanup:`, err);
          res.status(500).send('Error during cleanup operation.');
      }
  });
  // --- END NEW: API ENDPOINT ---


  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  if (app.get("env") === "development") {
    await setupVite(app, server); // 'server' here is the http.Server instance
  } else {
    serveStatic(app);
  }

  const port = 5000;
  // The 'server' variable already holds the http.Server instance returned by registerRoutes,
  // and Socket.IO is attached to it. So, just use 'server.listen' as before.
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
