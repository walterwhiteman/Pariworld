import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
// Removed: import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
// Removed: import for cartographer plugin

export default defineConfig({
  plugins: [
    react(),
    // Removed Replit-specific plugins as they are not needed for Render deployment
    // runtimeErrorOverlay(),
    // ...(process.env.NODE_ENV !== "production" &&
    // process.env.REPL_ID !== undefined
    //   ? [
    //       await import("@replit/vite-plugin-cartographer").then((m) =>
    //         m.cartographer(),
    //       ),
    //     ]
    //   : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"), // Use __dirname for consistency
      "@shared": path.resolve(__dirname, "shared"), // Use __dirname for consistency
      "@assets": path.resolve(__dirname, "attached_assets"), // Use __dirname for consistency
    },
  },
  root: path.resolve(__dirname, "client"), // Use __dirname for consistency
  build: {
    outDir: path.resolve(__dirname, "dist/public"), // Use __dirname for consistency
    emptyOutDir: true,
  },
});
