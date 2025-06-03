// src/routes.ts (Complete Code)

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
            const participants = await storage.getRoomParticipants(roomId);
            const activeParticipants = participants.filter(p => p.isActive);

            const onlineParticipants: string[] = [];
            usernameToSocketIdMap.forEach((socketId, username) => {
                if (usernameToSocketIdMap.get(username) === socketId) {
                    onlineParticipants.push(username);
                }
            });

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

    const getRoomParticipants = (roomId: string): string[] => {
        const participants: string[] = [];
        usernameToSocketIdMap.forEach((socketId, username) => {
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

        socket.emit('connection-established', { connected: true });

        socket.on('join-room', async (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;

            if (!roomId || !username) {
                socket.emit('error', { message: 'Room ID and username are required' });
                return;
            }

            socket.data.roomId = roomId; // <--- IMPORTANT: Set socket.data here
            socket.data.username = username; // <--- IMPORTANT: Set socket.data here

            socket.join(roomId);

            usernameToSocketIdMap.set(username, socket.id);
            console.log(`User ${username} (Socket ID: ${socket.id}) joined room ${roomId}`);

            try {
                await storage.addRoomParticipant(roomId, username);
            } catch (error) {
                console.error('Error storing room participant:', error);
            }

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

            socket.emit('room-joined', {
                roomId,
                participants: getRoomParticipants(roomId).filter(p => p !== username)
            });

            io.to(roomId).emit('connection-status', {
                connected: true,
                participantCount: getRoomParticipantCount(roomId),
                username: username
            });

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

            if (usernameToSocketIdMap.get(username) === socket.id) {
                socket.leave(roomId);
                usernameToSocketIdMap.delete(username);

                try {
                    await storage.removeRoomParticipant(roomId, username);
                } catch (error) {
                    console.error('Error removing room participant:', error);
                }

                io.to(roomId).emit('room-left', { roomId, username });
                io.to(roomId).emit('connection-status', {
                    connected: true,
                    participantCount: getRoomParticipantCount(roomId),
                    username: username
                });
                console.log(`User ${username} left room ${roomId}`);
            }
        });

        socket.on('send-message', async (messageData: { content?: string, imageData?: string, messageType?: 'text' | 'image' | 'system' }) => {
            console.log(`[Backend] Received send-message from ${socket.data.username} in room ${socket.data.roomId}`); // ADDED LOG
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
                await storage.addMessage(completeMessage);
            } catch (error) {
                console.error('Error storing message:', error);
            }

            io.to(roomId).emit('message-received', {
                id: generateMessageId(),
                roomId,
                sender: username,
                content: messageData.content,
                imageData: messageData.imageData,
                messageType: messageData.messageType || 'text',
                timestamp: new Date().toISOString()
            });

            console.log(`[Backend] Message broadcasted in room ${roomId} by ${username}`); // ADDED LOG
        });

        socket.on('typing-start', (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            socket.to(roomId).emit('user-typing', { username, isTyping: true });
        });

        socket.on('typing-stop', (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            socket.to(roomId).emit('user-typing', { username, isTyping: false });
        });

        socket.on('webrtc-signal', (payload: { roomId: string, sender: string, recipient: string, type: string, data: any }) => {
            const { roomId, sender, recipient, type, data } = payload;

            const recipientSocketId = usernameToSocketIdMap.get(recipient);

            if (recipientSocketId && recipientSocketId !== socket.id) {
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

        socket.on('disconnect', async () => {
            console.log('Socket.IO connection closed:', socket.id);

            let disconnectedUsername: string | undefined;
            let disconnectedRoomId: string | undefined;

            for (const [username, sockId] of usernameToSocketIdMap.entries()) {
                if (sockId === socket.id) {
                    disconnectedUsername = username;
                    disconnectedRoomId = socket.data.roomId;
                    usernameToSocketIdMap.delete(username);
                    break;
                }
            }

            if (disconnectedRoomId && disconnectedUsername) {
                try {
                    await storage.removeRoomParticipant(disconnectedRoomId, disconnectedUsername);
                } catch (error) {
                    console.error('Error removing room participant on disconnect:', error);
                }

                io.to(disconnectedRoomId).emit('room-left', { roomId: disconnectedRoomId, username: disconnectedUsername });
                io.to(disconnectedRoomId).emit('connection-status', {
                    connected: true,
                    participantCount: getRoomParticipantCount(disconnectedRoomId),
                    username: disconnectedUsername
                });
                console.log(`User ${disconnectedUsername} disconnected from room ${disconnectedRoomId}`);
            }
        });
    });

    console.log('Socket.IO server initialized on /ws path');

    const cleanupInterval = setInterval(async () => {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        try {
            await storage.deleteOldMessages(twentyFourHoursAgo);
        } catch (error) {
            console.error('Error during message cleanup:', error);
        }
    }, 60 * 60 * 1000);

    httpServer.on('close', () => {
        clearInterval(cleanupInterval);
    });

    return { httpServer, io }; // <--- MODIFIED RETURN VALUE
}
