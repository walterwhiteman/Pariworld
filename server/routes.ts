import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from 'socket.io';
import { storage } from "./storage";
import { RoomParticipant } from "@shared/schema";

// NOTE: This interface is for backend context. 
// Ensure your frontend's ChatMessage interface (in client/src/types/chat.ts)
// *explicitly* defines 'id: string;' as well.
interface ChatMessage {
    id: string; // Changed to string for consistency with generateMessageId
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

const usernameToSocketIdMap = new Map<string, string>();

export async function registerRoutes(app: Express): Promise<Server> {
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/api/rooms/:roomId', async (req, res) => {
        try {
            const { roomId } = req.params;
            const participants = await storage.getRoomParticipants(roomId);
            const activeParticipants = participants.filter(p => p.isActive);

            // IMPORTANT: 'io' is defined below. This 'io' might not be in scope here
            // if this route is hit before io is initialized. For a simple app, it often works
            // if registerRoutes is called after io initialization or if io is global.
            // If you get an 'io is undefined' error specifically for this route,
            // you might need to reorganize your server setup.
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

    const httpServer = createServer(app);

    const io = new SocketIOServer(httpServer, {
        path: '/ws',
        cors: {
            origin: "https://pariworld.onrender.com",
            methods: ["GET", "POST"],
            credentials: true
        }
    });

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

    const generateMessageId = (): string =>
        `temp_msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

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
                const previousMessages = await storage.getMessages(roomId, 50);
                if (previousMessages.length) {
                    socket.emit('message-history', {
                        roomId,
                        messages: previousMessages.map(msg => ({
                            // Ensure previous message IDs are strings
                            id: String(msg.id), 
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

            // System message for user joining - now includes ID
            io.to(roomId).emit('message-received', {
                id: generateMessageId(), // <--- ADDED: System messages now have an ID
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

                // System message for user leaving - now includes ID
                io.to(roomId).emit('message-received', {
                    id: generateMessageId(), // <--- ADDED: System messages now have an ID
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

            const completeMessage = {
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
                id: generateMessageId(), // This already generated a string ID
                roomId,
                sender: username,
                content: messageData.content,
                imageData: messageData.imageData,
                messageType: messageData.messageType || 'text',
                timestamp: new Date().toISOString()
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

                // System message for user disconnecting - now includes ID
                io.to(disconnectedRoomId).emit('message-received', {
                    id: generateMessageId(), // <--- ADDED: System messages now have an ID
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
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        try {
            await storage.deleteOldMessages(cutoff);
        } catch (error) {
            console.error('Error during message cleanup:', error);
        }
    }, 60 * 60 * 1000);

    httpServer.on('close', () => clearInterval(cleanupInterval));

    console.log('Socket.IO server initialized on /ws path');

    return httpServer;
}
