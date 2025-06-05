import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Cartographer plugin import moved outside async context
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import cartographer from "@replit/vite-plugin-cartographer";

const isReplit = process.env.REPL_ID !== undefined;
const isDev = process.env.NODE_ENV !== "production";

export default defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...(isDev && isReplit ? [cartographer()] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
