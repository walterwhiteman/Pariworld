// src/routes.ts (Complete Code - MODIFIED)

import type { Express } from "express";
import { createServer, type Server } from "http";
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

interface ConnectedClientInfo {
    roomId: string;
    username: string;
}

// Keep this map for quick lookup of socket.id by username, but ensure it's kept consistent
const usernameToSocketIdMap = new Map<string, string>(); // username -> socket.id

/**
 * Register HTTP routes and WebSocket server for the private chat application
 * Returns both the HTTP server and the Socket.IO server instance.
 */
export async function registerRoutes(app: Express): Promise<{ httpServer: Server, io: SocketIOServer }> { // <--- MODIFIED RETURN TYPE
    // --- HTTP Routes (unchanged) ---
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/api/rooms/:roomId', async (req, res) => {
        try {
            const { roomId } = req.params;
            // The storage.getRoomParticipants might be for persistent participants,
            // but for 'online' participants, we rely on Socket.IO's state.
            const onlineParticipants = getRoomParticipants(roomId); // Use the updated helper
            
            res.json({
                roomId,
                participantCount: onlineParticipants.length,
                participants: onlineParticipants
            });
        } catch (error) {
            console.error('Error getting room info:', error);
            res.status(500).json({ error: 'Failed to get room info' });
        }
    });

    const httpServer = createServer(app);

    // Initialize Socket.IO Server (ONLY ONCE HERE!)
    const io = new SocketIOServer(httpServer, {
        path: '/ws', // Matches the path your frontend expects
        cors: {
            origin: "https://pariworld.onrender.com", // <<<< IMPORTANT: ENSURE THIS MATCHES YOUR FRONTEND URL
            methods: ["GET", "POST"]
        }
    });

    // Helper functions (now using Socket.IO methods)
    const getRoomParticipantCount = (roomId: string): number => {
        return io.sockets.adapter.rooms.get(roomId)?.size || 0;
    };

    // --- MODIFIED: getRoomParticipants to be more robust ---
    const getRoomParticipants = (roomId: string): string[] => {
        const participants: string[] = [];
        const roomSockets = io.sockets.adapter.rooms.get(roomId);

        if (roomSockets) {
            for (const socketId of roomSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket && socket.data.username) { // Ensure socket exists and has username data
                    participants.push(socket.data.username);
                }
            }
        }
        return participants;
    };
    // --- END MODIFIED ---

    const generateMessageId = (): string => {
        return `temp_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    // --- Socket.IO Connection Handling ---
    io.on('connection', (socket) => {
        console.log('New Socket.IO connection established:', socket.id);

        // Initial connection confirmation (optional, but good for debugging)
        socket.emit('connection-established', { connected: true });

        socket.on('join-room', async (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;

            if (!roomId || !username) {
                socket.emit('error', { message: 'Room ID and username are required' });
                return;
            }

            // Store user data directly on the socket
            socket.data.roomId = roomId;
            socket.data.username = username;

            // Join the Socket.IO room
            socket.join(roomId);

            // Update the username to socket.id map
            usernameToSocketIdMap.set(username, socket.id);
            console.log(`User ${username} (Socket ID: ${socket.id}) joined room ${roomId}`);

            try {
                // Add participant to persistent storage (if not already there and active)
                await storage.addRoomParticipant(roomId, username);
            } catch (error) {
                console.error('Error storing room participant:', error);
            }

            try {
                // Fetch and send message history
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

            // Emit 'room-joined' to the joining client with current participants
            socket.emit('room-joined', {
                roomId,
                participants: getRoomParticipants(roomId).filter(p => p !== username) // Exclude self for initial list
            });

            // Broadcast to everyone in the room (including sender) that a new participant joined
            // This replaces the 'connection-status' and system message for clarity
            io.to(roomId).emit('participant-joined', {
                username: username,
                roomId: roomId,
                participants: getRoomParticipants(roomId) // Send updated list of all participants
            });

            // Send system message to the room (optional, can be part of participant-joined)
            io.to(roomId).emit('message-received', {
                id: generateMessageId(),
                roomId,
                sender: 'System',
                content: `${username} joined the chat`,
                messageType: 'system',
                timestamp: new Date().toISOString()
            });
        });

        socket.on('leave-room', async (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;

            // Only process if the socket ID matches the one in our map for this username
            if (usernameToSocketIdMap.get(username) === socket.id) {
                socket.leave(roomId);
                usernameToSocketIdMap.delete(username); // Remove from map

                try {
                    // Mark participant as inactive in persistent storage
                    await storage.removeRoomParticipant(roomId, username);
                } catch (error) {
                    console.error('Error removing room participant:', error);
                }

                // Broadcast to everyone in the room that a participant left
                io.to(roomId).emit('participant-left', {
                    username: username,
                    roomId: roomId,
                    participants: getRoomParticipants(roomId) // Send updated list of all participants
                });

                // Send system message to the room
                io.to(roomId).emit('message-received', {
                    id: generateMessageId(),
                    roomId,
                    sender: 'System',
                    content: `${username} left the chat`,
                    messageType: 'system',
                    timestamp: new Date().toISOString()
                });
                console.log(`User ${username} left room ${roomId}`);
            }
        });

        socket.on('send-message', async (messageData: { content?: string, imageData?: string, messageType?: 'text' | 'image' | 'system' }) => {
            console.log(`[Backend] Received send-message from ${socket.data.username} in room ${socket.data.roomId}`);
            const { roomId, username } = socket.data;

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
                // Store message in database
                await storage.addMessage(completeMessage);
            } catch (error) {
                console.error('Error storing message:', error);
            }

            // Broadcast message to all clients in the room
            io.to(roomId).emit('message-received', {
                id: generateMessageId(), // Generate ID for client display
                roomId,
                sender: username,
                content: messageData.content,
                imageData: messageData.imageData,
                messageType: messageData.messageType || 'text',
                timestamp: new Date().toISOString()
            });

            console.log(`[Backend] Message broadcasted in room ${roomId} by ${username}`);
        });

        socket.on('typing-start', (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            // Broadcast to everyone in the room EXCEPT the sender
            socket.to(roomId).emit('typing-status', { username, isTyping: true });
        });

        socket.on('typing-stop', (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            // Broadcast to everyone in the room EXCEPT the sender
            socket.to(roomId).emit('typing-status', { username, isTyping: false });
        });

        // --- WebRTC Signaling ---
        socket.on('webrtc-signal', (payload: { roomId: string, sender: string, recipient: string, type: string, data: any }) => {
            const { roomId, sender, recipient, type, data } = payload;

            const recipientSocketId = usernameToSocketIdMap.get(recipient);

            if (recipientSocketId && recipientSocketId !== socket.id) {
                // Forward the signal to the recipient's socket
                io.to(recipientSocketId).emit('webrtc-signal', {
                    roomId,
                    sender,
                    recipient,
                    type,
                    data
                });
                console.log(`Forwarded WebRTC signal type '${type}' from '${sender}' to '${recipient}' (Socket ID: ${recipientSocketId}) in room ${roomId}`);
            } else if (recipientSocketId === socket.id) {
                console.warn(`Attempted to send WebRTC signal to self from ${sender}. Ignoring.`);
            } else {
                console.warn(`Recipient '${recipient}' not found or not online for WebRTC signal from ${sender}.`);
                socket.emit('error', { message: `Recipient '${recipient}' is not online or available.` });
            }
        });
        // --- END WebRTC Signaling ---

        socket.on('disconnect', async () => {
            console.log('Socket.IO connection closed:', socket.id);

            const disconnectedUsername = socket.data.username;
            const disconnectedRoomId = socket.data.roomId;

            // Remove from map if present and matches socket ID
            if (disconnectedUsername && usernameToSocketIdMap.get(disconnectedUsername) === socket.id) {
                usernameToSocketIdMap.delete(disconnectedUsername);
            }

            if (disconnectedRoomId && disconnectedUsername) {
                try {
                    // Mark participant as inactive in persistent storage
                    await storage.removeRoomParticipant(disconnectedRoomId, disconnectedUsername);
                } catch (error) {
                    console.error('Error removing room participant on disconnect:', error);
                }

                // Broadcast to everyone in the room that a participant left
                io.to(disconnectedRoomId).emit('participant-left', {
                    username: disconnectedUsername,
                    roomId: disconnectedRoomId,
                    participants: getRoomParticipants(disconnectedRoomId) // Send updated list of all participants
                });

                // Send system message to the room
                io.to(disconnectedRoomId).emit('message-received', {
                    id: generateMessageId(),
                    roomId: disconnectedRoomId,
                    sender: 'System',
                    content: `${disconnectedUsername} disconnected from the chat`,
                    messageType: 'system',
                    timestamp: new Date().toISOString()
                });
                console.log(`User ${disconnectedUsername} disconnected from room ${disconnectedRoomId}`);
            }
        });
    });

    console.log('Socket.IO server initialized on /ws path');

    // --- Message Cleanup Cron Job (Moved from index.ts to here for clarity) ---
    // This runs every hour to delete messages older than 24 hours
    const cleanupInterval = setInterval(async () => {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        try {
            console.log(`[${new Date().toISOString()}] Starting scheduled message cleanup.`);
            await storage.deleteOldMessages(twentyFourHoursAgo);
            console.log(`[${new Date().toISOString()}] Scheduled message cleanup completed.`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error during scheduled message cleanup:`, error);
        }
    }, 60 * 60 * 1000); // Run every hour (60 minutes * 60 seconds * 1000 milliseconds)

    // Clear the interval when the HTTP server closes
    httpServer.on('close', () => {
        clearInterval(cleanupInterval);
        console.log('Message cleanup interval cleared.');
    });
    // --- END Message Cleanup Cron Job ---


    return { httpServer, io };
}
