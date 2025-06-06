import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from 'socket.io';
import { storage } from "./storage"; // Make sure storage.ts is updated as provided previously
import { RoomParticipant } from "@shared/schema";

// NOTE: This interface is for backend context.
// It should align with the ChatMessage interface in storage.ts and your Drizzle schema.
interface ChatMessage {
    id: string;
    roomId: string;
    sender: string;
    content: string | null; // Changed to string | null for consistency
    imageData: string | null; // Changed to string | null for consistency
    messageType: 'text' | 'image' | 'system';
    timestamp: Date;
}

interface ConnectedClientInfo {
    roomId: string;
    username: string;
}

const usernameToSocketIdMap = new Map<string, string>();

export async function registerRoutes(app: Express): Promise<Server> {
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // HTTP server for Express routes
    const httpServer = createServer(app);

    // Socket.IO server attached to the HTTP server
    const io = new SocketIOServer(httpServer, {
        path: '/ws',
        cors: {
            origin: "https://pariworld.onrender.com",
            methods: ["GET", "POST"],
            credentials: true
        }
    });

    // Helper functions (defined after `io` is initialized to ensure `io.sockets.adapter` is available)
    const getRoomParticipantCount = (roomId: string): number => {
        return io.sockets.adapter.rooms.get(roomId)?.size || 0;
    };

    const getRoomParticipants = (roomId: string): string[] => {
        const participants: string[] = [];
        const roomSockets = io.sockets.adapter.rooms.get(roomId);
        if (roomSockets) {
            roomSockets.forEach(socketId => {
                for (const [username, id] of usernameToSocketIdMap.entries()) {
                    if (id === socketId) participants.push(username);
                }
            });
        }
        return participants;
    };

    // This generateMessageId is primarily for *system messages* that might not be stored in DB
    // Regular chat messages will now get their ID from the database.
    const generateMessageId = (): string =>
        `sys_msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    // This API route should technically be defined *after* `io` if it uses `io` directly.
    // Moved it here for clarity regarding `io`'s scope.
    app.get('/api/rooms/:roomId', async (req, res) => {
        try {
            const { roomId } = req.params;
            const participants = await storage.getRoomParticipants(roomId);
            const activeParticipants = participants.filter(p => p.isActive);

            // Using `io` directly here. Ensure this route is hit after io is initialized.
            const roomSockets = io.sockets.adapter.rooms.get(roomId);
            const onlineParticipants: string[] = [];
            if (roomSockets) {
                roomSockets.forEach(socketId => {
                    for (const [username, id] of usernameToSocketIdMap.entries()) {
                        if (id === socketId) onlineParticipants.push(username);
                    }
                });
            }

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

    io.on('connection', (socket) => {
        console.log('New Socket.IO connection:', socket.id);

        socket.emit('connection-established', { connected: true });

        socket.on('join-room', async ({ roomId, username }) => {
            if (!roomId || !username) {
                socket.emit('error', { message: 'Room ID and username are required' });
                return;
            }

            socket.join(roomId);
            usernameToSocketIdMap.set(username, socket.id);

            socket.data.roomId = roomId;
            socket.data.username = username;

            console.log(`User ${username} (Socket ID: ${socket.id}) joined room ${roomId}`);

            try {
                await storage.addRoomParticipant(roomId, username);
            } catch (error) {
                console.error('Error storing room participant:', error);
            }

            try {
                // Fetch previous messages using the updated storage.getMessages
                const previousMessages = await storage.getMessages(roomId, 50);
                if (previousMessages.length) {
                    socket.emit('message-history', {
                        roomId,
                        messages: previousMessages.map(msg => ({
                            id: String(msg.id),
                            roomId: msg.roomId,
                            sender: msg.sender,
                            content: msg.content,
                            imageData: msg.imageData,
                            messageType: msg.messageType,
                            timestamp: msg.timestamp.toISOString() // Convert Date to ISO string for transport
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

            // System message for user joining - using generated ID (not stored in DB)
            io.to(roomId).emit('message-received', {
                id: generateMessageId(),
                roomId,
                sender: 'System',
                content: `${username} joined the chat`,
                messageType: 'system',
                timestamp: new Date().toISOString()
            });

            io.to(roomId).emit('connection-status', {
                connected: true,
                participantCount: getRoomParticipantCount(roomId),
                username
            });
        });

        socket.on('leave-room', async ({ roomId, username }) => {
            if (usernameToSocketIdMap.get(username) === socket.id) {
                socket.leave(roomId);
                usernameToSocketIdMap.delete(username);

                try {
                    await storage.removeRoomParticipant(roomId, username);
                } catch (error) {
                    console.error('Error removing room participant:', error);
                }

                // System message for user leaving - using generated ID (not stored in DB)
                io.to(roomId).emit('message-received', {
                    id: generateMessageId(),
                    roomId,
                    sender: 'System',
                    content: `${username} left the chat`,
                    messageType: 'system',
                    timestamp: new Date().toISOString()
                });

                io.to(roomId).emit('room-left', { roomId, username });
                io.to(roomId).emit('connection-status', {
                    connected: true,
                    participantCount: getRoomParticipantCount(roomId),
                    username
                });

                console.log(`User ${username} left room ${roomId}`);
            }
        });

        socket.on('send-message', async (messageData) => {
            const { roomId, username } = socket.data;

            if (!roomId || !username) {
                socket.emit('error', { message: 'Must join a room first' });
                return;
            }

            // Create message object to be saved. No ID or timestamp here.
            const messageToSave = {
                roomId,
                sender: username,
                content: messageData.content || null, // Ensure null if undefined
                imageData: messageData.imageData || null, // Ensure null if undefined
                messageType: messageData.messageType || 'text',
            };

            let savedMessage: ChatMessage;
            try {
                // Call addMessage, which now returns the inserted message with DB-generated ID and timestamp
                savedMessage = await storage.addMessage(messageToSave);
                console.log('Message successfully saved to DB:', savedMessage); // For debugging
            } catch (error) {
                console.error('Error storing message:', error);
                socket.emit('message-error', { message: 'Failed to send message.' }); // Inform sender of error
                return;
            }

            // Emit the message to the room using the canonical ID and timestamp from the database
            io.to(roomId).emit('message-received', {
                id: savedMessage.id, // <-- USE THE DB-GENERATED ID
                roomId: savedMessage.roomId,
                sender: savedMessage.sender,
                content: savedMessage.content,
                imageData: savedMessage.imageData,
                messageType: savedMessage.messageType,
                timestamp: savedMessage.timestamp.toISOString() // <-- USE THE DB-GENERATED TIMESTAMP
            });

            console.log(`Message sent in room ${roomId} by ${username}`);
        });

        socket.on('typing-start', ({ roomId, username }) => {
            socket.to(roomId).emit('user-typing', { username, isTyping: true });
        });

        socket.on('typing-stop', ({ roomId, username }) => {
            socket.to(roomId).emit('user-typing', { username, isTyping: false });
        });

        socket.on('webrtc-signal', ({ roomId, sender, recipient, type, data }) => {
            const recipientSocketId = usernameToSocketIdMap.get(recipient);

            if (recipientSocketId && recipientSocketId !== socket.id) {
                io.to(recipientSocketId).emit('webrtc-signal', {
                    roomId,
                    sender,
                    recipient,
                    type,
                    data
                });
                console.log(`Forwarded WebRTC signal '${type}' from '${sender}' to '${recipient}'`);
            } else if (recipientSocketId === socket.id) {
                console.warn(`User ${sender} tried to send WebRTC signal to self. Ignored.`);
            } else {
                console.warn(`Recipient '${recipient}' not online for WebRTC signal from ${sender}.`);
                socket.emit('error', { message: `Recipient '${recipient}' not available.` });
            }
        });

        socket.on('disconnect', async () => {
            console.log('Socket.IO disconnected:', socket.id);

            let disconnectedUsername: string | undefined;
            for (const [username, id] of usernameToSocketIdMap.entries()) {
                if (id === socket.id) {
                    disconnectedUsername = username;
                    usernameToSocketIdMap.delete(username);
                    break;
                }
            }

            const disconnectedRoomId = socket.data.roomId;

            if (disconnectedRoomId && disconnectedUsername) {
                try {
                    await storage.removeRoomParticipant(disconnectedRoomId, disconnectedUsername);
                } catch (error) {
                    console.error('Error removing participant on disconnect:', error);
                }

                // System message for user disconnecting - using generated ID (not stored in DB)
                io.to(disconnectedRoomId).emit('message-received', {
                    id: generateMessageId(),
                    roomId: disconnectedRoomId,
                    sender: 'System',
                    content: `${disconnectedUsername} disconnected from the chat`,
                    messageType: 'system',
                    timestamp: new Date().toISOString()
                });

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

    const cleanupInterval = setInterval(async () => {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
        try {
            // Assumes storage.deleteOldMessages is implemented to delete messages older than cutoff
            await storage.deleteOldMessages(cutoff);
            console.log(`Cleaned up messages older than ${cutoff.toISOString()}`);
        } catch (error) {
            console.error('Error during message cleanup:', error);
        }
    }, 60 * 60 * 1000); // Run every hour

    httpServer.on('close', () => clearInterval(cleanupInterval));

    console.log('Socket.IO server initialized on /ws path');

    return httpServer;
}
