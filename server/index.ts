// server/src/index.ts
// ... (other imports and setup)

// Configure Socket.IO server
const io = new SocketIOServer(httpServer, {
    cors: {
        // --- IMPORTANT CORS CONFIGURATION ---
        // Option B (Recommended for Render deployment):
        origin: [
            "https://pariworld.onrender.com", // Your deployed frontend URL
            "http://localhost:5173"           // Your local development URL
        ],
        // If the above doesn't work *after* confirming backend starts,
        // you can temporarily try the wildcard for testing, but it's less secure:
        // origin: "*",

        methods: ["GET", "POST"],
        credentials: true
    },
    path: '/socket.io/' // Ensure this path matches the frontend's useSocket.tsx
});

// ... (rest of your backend code)
