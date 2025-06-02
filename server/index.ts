import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io'; // Import Socket.IO Server

import pkg from 'pg';
const { Pool } = pkg;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- EXISTING CORS CONFIGURATION BLOCK (KEEP THIS ONE!) ---
app.use(cors({
  origin: "https://pariworld.onrender.com", // <<<< IMPORTANT: REPLACE WITH YOUR ACTUAL RENDER FRONTEND URL
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
// --- END CORS CONFIGURATION BLOCK ---

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
        rejectUnauthorized: false
    }
});

function authenticateCleanup(req: Request, res: Response, next: NextFunction) {
    const providedKey = req.headers['x-cleanup-api-key'] || req.query.key;

    if (!providedKey || providedKey !== CLEANUP_API_KEY) {
        console.warn(`[${new Date().toISOString()}] Unauthorized attempt to access cleanup endpoint.`);
        return res.status(401).send('Unauthorized: Invalid or missing API Key.');
    }
    next();
}

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


(async () => {
  const server = await registerRoutes(app);

    // --- MODIFIED: Initialize Socket.IO Server - REMOVED CORS OPTIONS ---
    const io = new SocketIOServer(server, {
        path: '/ws', // Keep this, it's crucial for the client connection
        // REMOVED: cors: { origin: "https://pariworld.onrender.com", methods: ["GET", "POST"] }
    });

    // --- EXISTING: Basic Socket.IO Connection Handler ---
    io.on('connection', (socket) => {
        console.log(`Socket connected: ${socket.id}`);

        socket.on('disconnect', (reason) => {
            console.log(`Socket disconnected: ${socket.id}, Reason: ${reason}`);
        });

        // IMPORTANT: ADD YOUR CHAT-SPECIFIC SOCKET.IO EVENT LISTENERS HERE!
        // ... (your existing socket.on event listeners) ...
    });
    // --- END SOCKET.IO SETUP ---


  // --- EXISTING: API ENDPOINT FOR MESSAGE CLEANUP ---
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


  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
