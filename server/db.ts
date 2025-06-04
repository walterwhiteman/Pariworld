// server/src/db.ts

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../shared/schema'; // Import your Drizzle schema

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set.');
}

const pool = new Pool({
    connectionString: connectionString,
    ssl: {
        rejectUnauthorized: false
    }
});

// Initialize Drizzle ORM with the PostgreSQL pool and schema
export const db = drizzle(pool, { schema });

console.log('[DB] Drizzle ORM initialized.');
