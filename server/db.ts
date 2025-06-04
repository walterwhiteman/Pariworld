import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '@shared/schema'; // Assuming your schema definitions are here

// Ensure the DATABASE_URL environment variable is set
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('*** DATABASE_ERROR: DATABASE_URL environment variable is not set. ***');
  // In a real app, you might want to exit the process or handle this more gracefully.
  // For now, we'll throw to make sure it's caught during startup.
  throw new Error('DATABASE_URL is not set. Cannot connect to database.');
}

let pool: Pool;
try {
  console.log('*** DATABASE: Attempting to create PostgreSQL connection pool... ***');
  pool = new Pool({
    connectionString: connectionString,
    // Optional: Add ssl configuration for Neon if needed, though Render often handles it
    // ssl: {
    //   rejectUnauthorized: false // Use with caution; for local testing or if Render's proxy requires it
    // }
  });
  console.log('*** DATABASE: PostgreSQL connection pool created. ***');

  // Test the connection immediately
  pool.on('error', (err) => {
    console.error('*** DATABASE_POOL_ERROR: Unexpected error on idle client ***', err);
    // process.exit(-1); // Consider exiting if a critical error occurs
  });

  // Verify connection by making a dummy query
  (async () => {
    try {
      console.log('*** DATABASE: Testing connection with a dummy query... ***');
      await pool.query('SELECT 1');
      console.log('*** DATABASE: Connection to PostgreSQL successful! ***');
    } catch (testError) {
      console.error('*** DATABASE_CONNECTION_FAILED: Could not connect to PostgreSQL. ***', testError);
      if (testError instanceof Error) {
        console.error('*** DATABASE_CONNECTION_FAILED STACK: ***', testError.stack);
      }
      throw testError; // Re-throw to prevent server from starting without DB
    }
  })();

} catch (error) {
  console.error('*** DATABASE_INITIALIZATION_ERROR: Failed to initialize PostgreSQL pool. ***', error);
  if (error instanceof Error) {
    console.error('*** DATABASE_INITIALIZATION_ERROR STACK: ***', error.stack);
  }
  throw error; // Re-throw to prevent server startup
}

export const db = drizzle(pool, { schema }); // Initialize Drizzle ORM
console.log('*** DATABASE: Drizzle ORM client initialized. ***');
