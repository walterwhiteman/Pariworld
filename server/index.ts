import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import cors from 'cors';

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
    // In a production app, you might want to throw an error or exit here.
}
if (!CLEANUP_API_KEY) {
    console.error('CLEANUP_API_KEY environment variable is not set. Cleanup endpoint will be INSECURE!');
    // IMPORTANT: In production, you would prevent the app from starting or block access if key is missing.
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
    // We'll expect the API key in a header named 'X-Cleanup-API-Key' or as a query parameter 'key'
    const providedKey = req.headers['x-cleanup-api-key'] || req.query.key;

    if (!providedKey || providedKey !== CLEANUP_API_KEY) {
        console.warn(`[${new Date().toISOString()}] Unauthorized attempt to access cleanup endpoint.`);
        return res.status(401).send('Unauthorized: Invalid or missing API Key.');
    }
    next(); // API key is valid, proceed to the message deletion code
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
  // --- NEW: API ENDPOINT FOR MESSAGE CLEANUP ---
  // This is the "secret door" that the external service will call
  // Place this BEFORE registerRoutes(app) to ensure it's handled first.
  app.post('/api/cleanup-messages', authenticateCleanup, async (req: Request, res: Response) => {
      console.log(`[${new Date().toISOString()}] External cleanup trigger received.`);
      try {
          const client = await pool.connect();
          const query = `DELETE FROM messages WHERE timestamp < NOW() - INTERVAL '24 hours';`;
          const result = await client.query(query);
          client.release(); // Release the database connection
          console.log(`[${new Date().toISOString()}] Successfully deleted ${result.rowCount} messages.`);
          res.status(200).send(`Successfully deleted ${result.rowCount} messages.`);
      } catch (err) {
          console.error(`[${new Date().toISOString()}] Error during external cleanup:`, err);
          res.status(500).send('Error during cleanup operation.');
      }
  });
  // --- END NEW: API ENDPOINT ---


  const server = await registerRoutes(app); // Your existing route registration

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();
