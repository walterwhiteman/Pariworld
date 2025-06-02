import type { Express } from "express";
import { createServer, type Server } from "http";
// Import Socket.IO Server instead of ws
import { Server as SocketIOServer } from 'socket.io';
import { storage } from "./storage";
import { RoomParticipant } from "@shared/schema";

// Define ChatMessage interface for server use (unchanged)
interface ChatMessage {
    id: number;
    roomId: string;
    sender: string;
    content?: string;
    imageData?: string;
    messageType: 'text' | 'image' | 'system';
    timestamp: Date;
}

// WebSocket message types (now more aligned with Socket.IO emit structure)
// No longer need WebSocketMessage, as Socket.IO uses direct events and payloads

// Connected clients tracking (modified for Socket.IO sockets)
// We'll track username to socket ID for direct messaging for WebRTC
interface ConnectedClientInfo {
    roomId: string;
    username: string;
    // We don't need 'ws' or 'isAlive' directly here, Socket.IO manages that
}

// Map to store username -> socket.id for WebRTC direct signaling
const usernameToSocketIdMap = new Map<string, string>(); // username -> socket.id

/**
 * Register HTTP routes and WebSocket server for the private chat application
 */
export async function registerRoutes(app: Express): Promise<Server> {
    // --- HTTP Routes (unchanged) ---
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/api/rooms/:roomId', async (req, res) => {
        try {
            const { roomId } = req.params;
            const participants = await storage.getRoomParticipants(roomId);
            const activeParticipants = participants.filter(p => p.isActive);

            // Fetch currently online participants from Socket.IO's perspective
            const onlineParticipants: string[] = [];
            // Iterate through our map to find users in this roomId
            usernameToSocketIdMap.forEach((socketId, username) => {
                // Check if this socket is still connected to the room in Socket.IO
                // (io.sockets.adapter.rooms.get(roomId)?.has(socketId) would be ideal but more complex
                // for this specific setup where we don't have direct access to 'io' yet)
                // For simplicity, we'll rely on our map being updated on join/disconnect.
                // A more robust solution might cross-reference with Socket.IO's internal rooms.
                if (usernameToSocketIdMap.get(username) === socketId) { // Basic check if mapping is consistent
                    onlineParticipants.push(username);
                }
            });

            res.json({
                roomId,
                // Consider participantCount to be only online users
                participantCount: onlineParticipants.length,
                participants: onlineParticipants
            });
        } catch (error) {
            console.error('Error getting room info:', error);
            res.status(500).json({ error: 'Failed to get room info' });
        }
    });

    const httpServer = createServer(app);

    // Initialize Socket.IO Server
    const io = new SocketIOServer(httpServer, {
        path: '/ws', // Matches the path your frontend expects
        cors: {
            origin: "https://pariworld.onrender.com", // <<<< IMPORTANT: ENSURE THIS MATCHES YOUR FRONTEND URL
            methods: ["GET", "POST"] // Allowed methods for CORS preflight
        }
    });

    // Helper functions (now using Socket.IO methods)
    // Socket.IO manages rooms and client sending directly
    // We will update the usage of these in the 'message' handler
    const getRoomParticipantCount = (roomId: string): number => {
        // Socket.IO rooms directly give us this
        return io.sockets.adapter.rooms.get(roomId)?.size || 0;
    };

    const getRoomParticipants = (roomId: string): string[] => {
        const participants: string[] = [];
        // Iterate through our usernameToSocketIdMap to find users in this roomId
        usernameToSocketIdMap.forEach((socketId, username) => {
            // Check if this socket is actually in the room (Socket.IO's internal check)
            if (io.sockets.adapter.rooms.get(roomId)?.has(socketId)) {
                    participants.push(username);
            }
        });
        return participants;
    };

    const generateMessageId = (): string => {
        return `temp_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    // --- Socket.IO Connection Handling ---
    io.on('connection', (socket) => {
        console.log('New Socket.IO connection established:', socket.id);

        // Send connection confirmation
        socket.emit('connection-established', { connected: true });

        socket.on('join-room', async (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;

            if (!roomId || !username) {
                socket.emit('error', { message: 'Room ID and username are required' });
                return;
            }

            // --- IMPORTANT FIX: Set socket.data here ---
            socket.data.roomId = roomId;
            socket.data.username = username;
            // --- END IMPORTANT FIX ---

            // Join the Socket.IO room
            socket.join(roomId);

            // Store client info in our map for direct signaling
            usernameToSocketIdMap.set(username, socket.id);
            console.log(`User ${username} (Socket ID: ${socket.id}) joined room ${roomId}`);

            // Store room participant in DB
            try {
                await storage.addRoomParticipant(roomId, username);
            } catch (error) {
                console.error('Error storing room participant:', error);
            }

            // --- Fetch and send previous messages to the joining client ---
            try {
                const previousMessages = await storage.getMessages(roomId, 50);
                if (previousMessages.length > 0) {
                    console.log(`Sending ${previousMessages.length} historical messages to ${username} in ${roomId}`);
                    socket.emit('message-history', {
                        roomId,
                        messages: previousMessages.map(msg => ({
                            ...msg,
                            timestamp: msg.timestamp.toISOString()
                        }))
                    });
                }
            } catch (error) {
                console.error('Error fetching previous messages:', error);
            }

            // Notify client of successful join
            socket.emit('room-joined', {
                roomId,
                participants: getRoomParticipants(roomId).filter(p => p !== username)
            });

            // Notify others in the room about new connection status
            io.to(roomId).emit('connection-status', {
                connected: true,
                participantCount: getRoomParticipantCount(roomId),
                username: username // Send the joining username for better UI updates
            });

            // Send a system message to others about the new user
            io.to(roomId).emit('message-received', {
                roomId,
                sender: 'System',
                content: `${username} joined the chat`,
                messageType: 'system',
                timestamp: new Date().toISOString()
            });
        });

        socket.on('leave-room', async (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;

            if (usernameToSocketIdMap.get(username) === socket.id) { // Ensure correct client is leaving
                socket.leave(roomId); // Leave Socket.IO room
                usernameToSocketIdMap.delete(username); // Remove from our map

                try {
                    await storage.removeRoomParticipant(roomId, username);
                } catch (error) {
                    console.error('Error removing room participant:', error);
                }

                io.to(roomId).emit('room-left', { roomId, username }); // Notify others
                io.to(roomId).emit('connection-status', {
                    connected: true,
                    participantCount: getRoomParticipantCount(roomId),
                    username: username // Send the leaving username
                });
                console.log(`User ${username} left room ${roomId}`);
            }
        });

        socket.on('send-message', async (messageData: { content?: string, imageData?: string, messageType?: 'text' | 'image' | 'system' }) => {
            // Get roomId and username from our map, since Socket.IO doesn't automatically expose it this way
            // You might need a more robust way to associate socket.id with roomId and username
            // A common pattern is to store this in a 'socket.data' object on connection or room join.
            // Let's ensure the `join-room` event sets these on the `socket` object for easier access.
            const { roomId, username } = socket.data; // Assumes `socket.data` is set on join

            if (!roomId || !username) {
                socket.emit('error', { message: 'Must join a room first' });
                return;
            }

            const completeMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
                roomId,
                sender: username,
                content: messageData.content,
                imageData: messageData.imageData,
                messageType: messageData.messageType || 'text',
            };

            try {
                await storage.addMessage(completeMessage);
            } catch (error) {
                console.error('Error storing message:', error);
            }

            // Broadcast to room participants (including sender)
            io.to(roomId).emit('message-received', {
                id: generateMessageId(), // Still using temp ID for immediate broadcast
                roomId,
                sender: username,
                content: messageData.content,
                imageData: messageData.imageData,
                messageType: messageData.messageType || 'text',
                timestamp: new Date().toISOString()
            });

            console.log(`Message sent in room ${roomId} by ${username}`);
        });

        socket.on('typing-start', (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            // Broadcast to all in the room EXCEPT the sender
            socket.to(roomId).emit('user-typing', { username, isTyping: true });
        });

        socket.on('typing-stop', (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            // Broadcast to all in the room EXCEPT the sender
            socket.to(roomId).emit('user-typing', { username, isTyping: false });
        });

        // --- NEW: WebRTC Signaling Event Handler ---
        socket.on('webrtc-signal', (payload: { roomId: string, sender: string, recipient: string, type: string, data: any }) => {
            const { roomId, sender, recipient, type, data } = payload;

            // Find the recipient's socket ID using our map
            const recipientSocketId = usernameToSocketIdMap.get(recipient);

            if (recipientSocketId && recipientSocketId !== socket.id) { // Ensure recipient is online and not self
                // Emit the signal directly to the recipient's socket
                io.to(recipientSocketId).emit('webrtc-signal', {
                    roomId,
                    sender,
                    recipient, // Keep recipient in payload for frontend validation
                    type,
                    data
                });
                console.log(`Forwarded WebRTC signal type '${type}' from '${sender}' to '${recipient}' (Socket ID: ${recipientSocketId}) in room ${roomId}`);
            } else if (recipientSocketId === socket.id) {
                console.warn(`Attempted to send WebRTC signal to self from ${sender}. Ignoring.`);
                // Optionally, inform the sender that they can't call themselves.
            } else {
                console.warn(`Recipient '${recipient}' not found or not online for WebRTC signal from ${sender}.`);
                // Optionally, send an error back to the sender
                socket.emit('error', { message: `Recipient '${recipient}' is not online or available.` });
            }
        });
        // --- END NEW WEBRTC SIGNALING ---


        // --- Socket.IO Disconnect Handling ---
        socket.on('disconnect', async () => {
            console.log('Socket.IO connection closed:', socket.id);

            // Find the client info from our map based on socket.id
            let disconnectedUsername: string | undefined;
            let disconnectedRoomId: string | undefined;

            // Iterate through the map to find the entry by value (socket.id)
            for (const [username, sockId] of usernameToSocketIdMap.entries()) {
                if (sockId === socket.id) {
                    disconnectedUsername = username;
                    // This now correctly gets roomId from socket.data because we set it on join
                    disconnectedRoomId = socket.data.roomId;
                    usernameToSocketIdMap.delete(username); // Remove from our map
                    break;
                }
            }

            if (disconnectedRoomId && disconnectedUsername) {
                try {
                    await storage.removeRoomParticipant(disconnectedRoomId, disconnectedUsername);
                } catch (error) {
                    console.error('Error removing room participant on disconnect:', error);
                }

                // Notify others in the room about the user leaving
                io.to(disconnectedRoomId).emit('room-left', { roomId: disconnectedRoomId, username: disconnectedUsername });
                io.to(disconnectedRoomId).emit('connection-status', {
                    connected: true,
                    participantCount: getRoomParticipantCount(disconnectedRoomId),
                    username: disconnectedUsername // Send the leaving username
                });
                console.log(`User ${disconnectedUsername} disconnected from room ${disconnectedRoomId}`);
            }
        });

        // The 'set-socket-data' handler is now redundant if join-room sets socket.data
        // You can remove it if it's not used anywhere else for explicit socket.data setting.
        // socket.on('set-socket-data', (data: { roomId: string; username: string }) => {
        //     socket.data.roomId = data.roomId;
        //     socket.data.username = data.username;
        // });

    });

    console.log('Socket.IO server initialized on /ws path');

    // --- Periodic cleanup of old messages (unchanged) ---
    const cleanupInterval = setInterval(async () => {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        try {
            await storage.deleteOldMessages(twentyFourHoursAgo);
        } catch (error) {
            console.error('Error during message cleanup:', error);
        }
    }, 60 * 60 * 1000); // Run this cleanup function every 1 hour (3600000 ms)

    // Ensure cleanup interval is cleared on server close
    httpServer.on('close', () => { // Attach to httpServer close
        clearInterval(cleanupInterval);
    });

    return httpServer;
}
