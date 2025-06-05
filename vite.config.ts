import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url"; // <-- ADD THIS IMPORT
import { dirname } from "path";     // <-- ADD THIS IMPORT

// Define __filename and __dirname for ES Module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename); // <-- ADD THESE LINES

// Custom plugin for runtime error overlay (optional)
function runtimeErrorOverlay() {
  return {
    name: "runtime-error-overlay",
    apply: "serve", // Only apply in dev mode
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/__runtime_error_overlay") {
          // Serve a simple HTML page or JSON indicating runtime error
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<h1>Runtime Error Occurred. Check Console.</h1>");
        } else {
          next();
        }
      });
    },
  };
}

// Replit specific plugin for cartographer (optional)
function cartographer() {
  return {
    name: "replit-cartographer",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/__cartographer_ping") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        } else {
          next();
        }
      });
    },
  };
}

const isDev = process.env.NODE_ENV === "development";
const isReplit = process.env.REPL_ID; // Assuming REPL_ID env var is set on Replit

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(isDev && isReplit ? [cartographer()] : []),
  ],
  server: {
    host: "0.0.0.0",
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
    hmr: {
      clientPort: process.env.VITE_CLIENT_PORT
        ? parseInt(process.env.VITE_CLIENT_PORT)
        : undefined,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client/src"), // Uses the corrected __dirname
      "@shared": path.resolve(__dirname, "./shared"), // Uses the corrected __dirname
    },
  },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
  },
});
