// src/index.ts (Complete Code - MODIFIED)

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import cors from 'cors';

import pkg from 'pg';
const { Pool } = pkg;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Ensure CORS is configured for your frontend URL
app.use(cors({
    origin: "https://pariworld.onrender.com", // <<<< IMPORTANT: ENSURE THIS MATCHES YOUR FRONTEND URL
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true
}));

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
    const { httpServer, io } = await registerRoutes(app); // registerRoutes returns both

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
        await setupVite(app, httpServer); // Pass httpServer to setupVite
    } else {
        serveStatic(app);
    }

    // Use the PORT environment variable provided by Render
    const port = process.env.PORT || 5000; // Default to 5000 if PORT is not set (e.g., local dev)
    const host = '0.0.0.0'; // Listen on all network interfaces for Render deployment

    // Use the httpServer received from registerRoutes to listen
    httpServer.listen({ // <--- Use httpServer.listen here
        port,
        host,
        reusePort: true, // This can sometimes help with rapid restarts
    }, () => {
        log(`Backend server serving on http://${host}:${port}`);
        console.log(`[Backend] HTTP server listening on ${host}:${port}`);
        console.log(`[Backend] Socket.IO server accessible via WebSocket on ws://${host}:${port}/ws`);
    });
})();
