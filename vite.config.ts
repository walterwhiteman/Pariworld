import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  root: './client', // <-- ADDED THIS LINE: Tells Vite to use the 'client' directory as its root
  plugins: [
    react(),
    // Custom plugin for runtime error overlay (optional)
    function runtimeErrorOverlay() {
      return {
        name: "runtime-error-overlay",
        apply: "serve", // Only apply in dev mode
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url === "/__runtime_error_overlay") {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end("<h1>Runtime Error Occurred. Check Console.</h1>");
            } else {
              next();
            }
          });
        },
      };
    },
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
    },
    // Conditionally add cartographer if in dev and Replit
    ...(process.env.NODE_ENV === "development" && process.env.REPL_ID ? [/* cartographer() removed or correctly defined here */] : []),
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
      // Aliases defined here are now relative to the `root` ('./client')
      // So, '@/...' will resolve to 'client/src' from Vite's perspective.
      // But since __dirname in vite.config.ts is the project root,
      // path.resolve(__dirname, './client/src') is still correct for the alias definition.
      // They are just path mapping, not actual file resolution from Vite's root.
      "@": path.resolve(__dirname, "./client/src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
  build: {
    // outDir is relative to the `root` if not an absolute path.
    // We want it to be `dist/client` relative to the project root.
    outDir: '../dist/client', // <-- CHANGED THIS: Go up one level from 'client', then into 'dist/client'
    emptyOutDir: true,
  },
});
