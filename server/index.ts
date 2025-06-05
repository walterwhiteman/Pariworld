// server/src/index.ts

import express, { type Request, Response, NextFunction } from "express";
import { createServer, type Server as HttpServer } from "http";
import { Server as SocketIOServer } from 'socket.io'; // Import SocketIOServer
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import cors from 'cors'; // Import cors

import pkg from 'pg'; // Import pg for database connection
const { Pool } = pkg;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// IMPORTANT: Configure CORS for your frontend URL
app.use(cors({
    origin: "https://pariworld.onrender.com", // Your Render frontend URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

// Retrieve environment variables for database and cleanup key
const connectionString = process.env.DATABASE_URL;
const CLEANUP_API_KEY = process.env.CLEANUP_API_KEY;

if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set. Database connection and cleanup will not function.');
}
if (!CLEANUP_API_KEY) {
    console.warn('CLEANUP_API_KEY environment variable is not set. Cleanup endpoint will be INSECURE!');
}

// Initialize PostgreSQL connection pool
const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false // Required for Neon.tech connections on Render
    }
});

// Middleware for cleanup endpoint authentication
function authenticateCleanup(req: Request, res: Response, next: NextFunction) {
    const providedKey = req.headers['x-cleanup-api-key'] || req.query.key;

    if (!providedKey || providedKey !== CLEANUP_API_KEY) {
        console.warn(`[${new Date().toISOString()}] Unauthorized attempt to access cleanup endpoint.`);
        return res.status(401).send('Unauthorized: Invalid or missing API Key.');
    }
    next();
}

// Logging middleware
app.use((req: Request, res: Response, next: NextFunction) => { // Explicitly type req, res, next
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, any> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson: any, ...args: any[]) { // Explicitly type bodyJson and args
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
    // Create HTTP server
    const httpServer: HttpServer = createServer(app);
    
    // Create Socket.IO server and attach it to the HTTP server
    const io: SocketIOServer = new SocketIOServer(httpServer, {
        path: '/socket.io/', // Use the default Socket.IO path as requested
        cors: {
            origin: "https://pariworld.onrender.com", // Your Render frontend URL
            methods: ["GET", "POST"],
            credentials: true
        },
        transports: ['websocket', 'polling'] // Prefer websocket but fall back to polling
    });
    console.log('[Backend] HTTP server and Socket.IO server instances created.');

    // Register API and Socket.IO routes, passing the Socket.IO instance
    await registerRoutes(app, io); // Pass 'io' instance to registerRoutes

    // Test connection endpoint
    app.get('/api/test-connection', (req: Request, res: Response) => {
        console.log(`[${new Date().toISOString()}] Received test connection request.`);
        res.status(200).send('Backend is reachable via HTTP!');
    });

    // Cleanup messages endpoint
    app.post('/api/cleanup-messages', authenticateCleanup, async (req: Request, res: Response) => {
        console.log(`[${new Date().toISOString()}] External cleanup trigger received.`);
        try {
            const client = await pool.connect(); // Use the initialized pool
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

    // Error handling middleware
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";

        res.status(status).json({ message });
        console.error("Caught unhandled error:", err); // Log the error for debugging
        // throw err; // Re-throwing might cause process crash, better to just log and respond
    });

    // Serve static files in production or setup Vite in development
    if (app.get("env") === "development") {
        await setupVite(app, httpServer); // Pass httpServer to Vite for HMR
    } else {
        serveStatic(app);
    }

    // Determine port and host for listening
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
    const host = '0.0.0.0'; // Listen on all network interfaces

    // Start the HTTP server (which also handles Socket.IO)
    httpServer.listen({
        port,
        host,
    }, () => {
        const address = httpServer.address();
        if (address && typeof address === 'object') {
            log(`Backend server serving on http://${address.address}:${address.port}`);
            console.log(`[Backend] HTTP server listening on ${address.address}:${address.port}`);
            console.log(`[Backend] Socket.IO server accessible via WebSocket on ws://${address.address}:${address.port}/socket.io/`);
        } else {
            log(`Backend server serving on port ${port}`);
            console.log(`[Backend] HTTP server listening on port ${port}`);
            console.log(`[Backend] Socket.IO server accessible via WebSocket on ws://(host-unknown):${port}/socket.io/`);
        }
    });
})();

