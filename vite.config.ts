import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from 'url'; // NEW: Import fileURLToPath from 'url'

// __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url); // NEW: Get current file path
const __dirname = path.dirname(__filename); // NEW: Get current directory name

export default defineConfig({
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      // MODIFIED: Use the __dirname equivalent for path resolution
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  // MODIFIED: Use the __dirname equivalent for root
  root: path.resolve(__dirname, "client"),
  build: {
    // MODIFIED: Use the __dirname equivalent for outDir
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
