// server/src/index.ts
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io'; // <--- THIS IS THE CRITICAL IMPORT
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { db } from './db';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { registerRoutes } from './routes';

dotenv.config(); // Load environment variables from .env file

const app = express();
const httpServer = createServer(app);

// Database connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false, // Required for Neon.tech free tier or self-signed certs
    },
});

// Test database connection on startup
pool.connect().then(client => {
    console.log('Connected to PostgreSQL database!');
    client.release();
}).catch(err => {
    console.error('Error connecting to PostgreSQL database:', err);
    // Exit process if DB connection fails, as the app won't function without it
    process.exit(1);
});


// Configure Socket.IO server
const io = new SocketIOServer(httpServer, {
    cors: {
        // --- IMPORTANT CORS CONFIGURATION ---
        // For Render deployment, list your frontend URL (and localhost for local dev)
        origin: [
            "https://pariworld.onrender.com", // Your deployed frontend URL
            "http://localhost:5173"           // Your local development URL
        ],
        // You can also use a function for more complex logic if needed:
        // origin: (origin, callback) => {
        //     const allowedOrigins = ["https://pariworld.onrender.com", "http://localhost:5173"];
        //     if (!origin || allowedOrigins.includes(origin)) {
        //         callback(null, true);
        //     } else {
        //         callback(new Error('Not allowed by CORS'));
        //     }
        // },
        methods: ["GET", "POST"],
        credentials: true
    },
    path: '/socket.io/' // Ensure this path matches the frontend's useSocket.tsx
});

// Register HTTP routes (e.g., for health checks or API endpoints)
app.get('/', (req, res) => {
    res.send('Backend is running and healthy!');
});

// Run Drizzle migrations
async function runMigrations() {
    try {
        console.log('[Drizzle] Running migrations...');
        await migrate(db, { migrationsFolder: './drizzle' });
        console.log('[Drizzle] Migrations completed!');
    } catch (error) {
        console.error('[Drizzle] Migration failed:', error);
        // Depending on criticality, you might want to exit here
    }
}

// Register Socket.IO routes
// Pass the initialized 'io' and 'pool' to your route handlers
// Ensure routes are registered AFTER Socket.IO server is initialized
registerRoutes(app, io, pool);

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    await runMigrations(); // Run migrations after server starts listening
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // Application specific logging, throwing an error, or other logic here
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1); // Exit process for uncaught exceptions
});

export { io }; // Export io for potential testing or other modules
