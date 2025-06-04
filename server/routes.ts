// src/routes.ts (Complete Code - MODIFIED with types)

import type { Express, Request, Response } from "express"; // Import Request and Response types
import { createServer, type Server } from "http";
import { Server as SocketIOServer, Socket } from 'socket.io'; // Import Socket type
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
    timestamp: Date; // Keep as Date object on backend for DB operations
}

interface ConnectedClientInfo {
    roomId: string;
    username: string;
}

const usernameToSocketIdMap = new Map<string, string>();

export async function registerRoutes(app: Express, io: SocketIOServer): Promise<{ httpServer: Server, io: SocketIOServer }> {
    app.get('/api/health', (req: Request, res: Response) => { // Explicitly type req, res
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    app.get('/api/rooms/:roomId', async (req: Request, res: Response) => { // Explicitly type req, res
        try {
            const { roomId } = req.params;
            const onlineParticipants = getRoomParticipants(roomId);
            
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

    console.log('[Backend Socket.IO] Socket.IO server instance created.');

    const getRoomParticipantCount = (roomId: string): number => {
        return io.sockets.adapter.rooms.get(roomId)?.size || 0;
    };

    const getRoomParticipants = (roomId: string): string[] => {
        const participants: string[] = [];
        const roomSockets = io.sockets.adapter.rooms.get(roomId);

        if (roomSockets) {
            for (const socketId of roomSockets) {
                const socket = io.sockets.sockets.get(socketId);
                if (socket && socket.data.username) {
                    participants.push(socket.data.username);
                }
            }
        }
        return participants;
    };

    const generateMessageId = (): string => {
        return `temp_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    io.on('connection', (socket: Socket) => { // Explicitly type socket
        console.log(`[Backend Socket.IO] New Socket.IO connection established: ${socket.id} from ${socket.handshake.address}`);

        socket.emit('connection-established', { connected: true });

        socket.on('join-room', async (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            console.log(`[Backend Socket.IO] Received join-room from ${username} for room ${roomId}`);

            if (!roomId || !username) {
                socket.emit('error', { message: 'Room ID and username are required' });
                console.warn(`[Backend Socket.IO] Join room failed: Room ID or username missing for socket ${socket.id}`);
                return;
            }

            socket.data.roomId = roomId;
            socket.data.username = username;

            socket.join(roomId);

            usernameToSocketIdMap.set(username, socket.id);
            console.log(`[Backend Socket.IO] User ${username} (Socket ID: ${socket.id}) joined room ${roomId}`);

            try {
                await storage.addRoomParticipant(roomId, username);
            } catch (error) {
                console.error('[Backend Socket.IO] Error storing room participant:', error);
            }

            try {
                const previousMessages = await storage.getMessages(roomId, 50);
                if (previousMessages.length > 0) {
                    console.log(`[Backend Socket.IO] Sending ${previousMessages.length} historical messages to ${username} in ${roomId}`);
                    socket.emit('message-history', {
                        roomId,
                        messages: previousMessages.map(msg => ({
                            ...msg,
                            timestamp: msg.timestamp.toISOString()
                        }))
                    });
                }
            } catch (error) {
                console.error('[Backend Socket.IO] Error fetching previous messages:', error);
            }

            socket.emit('room-joined', {
                roomId,
                participants: getRoomParticipants(roomId).filter(p => p !== username)
            });

            io.to(roomId).emit('participant-joined', {
                username: username,
                roomId: roomId,
                participants: getRoomParticipants(roomId)
            });

            io.to(roomId).emit('message-received', {
                id: generateMessageId(),
                roomId,
                sender: 'System',
                content: `${username} joined the chat`,
                messageType: 'system',
                timestamp: new Date().toISOString()
            });
            console.log(`[Backend Socket.IO] User ${username} successfully processed join for room ${roomId}`);
        });

        socket.on('leave-room', async (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            console.log(`[Backend Socket.IO] Received leave-room from ${username} for room ${roomId}`);

            if (usernameToSocketIdMap.get(username) === socket.id) {
                socket.leave(roomId);
                usernameToSocketIdMap.delete(username);

                try {
                    await storage.removeRoomParticipant(roomId, username);
                } catch (error) {
                    console.error('[Backend Socket.IO] Error removing room participant:', error);
                }

                io.to(roomId).emit('participant-left', {
                    username: username,
                    roomId: roomId,
                    participants: getRoomParticipants(roomId)
                });

                io.to(roomId).emit('message-received', {
                    id: generateMessageId(),
                    roomId: roomId,
                    sender: 'System',
                    content: `${username} left the chat`,
                    messageType: 'system',
                    timestamp: new Date().toISOString()
                });
                console.log(`[Backend Socket.IO] User ${username} left room ${roomId}`);
            }
        });

        socket.on('send-message', async (messageData: { content?: string, imageData?: string, messageType?: 'text' | 'image' | 'system' }) => { // Explicitly type messageData
            console.log(`[Backend Socket.IO] Received send-message from ${socket.data.username} in room ${socket.data.roomId}`);
            const { roomId, username } = socket.data;

            if (!roomId || !username) {
                socket.emit('error', { message: 'Must join a room first' });
                console.warn(`[Backend Socket.IO] Send message failed: User not in room for socket ${socket.id}`);
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
                console.error('[Backend Socket.IO] Error storing message:', error);
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

            console.log(`[Backend Socket.IO] Message broadcasted in room ${roomId} by ${username}`);
        });

        socket.on('typing-start', (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            console.log(`[Backend Socket.IO] ${username} started typing in room ${roomId}`);
            socket.to(roomId).emit('typing-status', { username, isTyping: true });
        });

        socket.on('typing-stop', (payload: { roomId: string, username: string }) => {
            const { roomId, username } = payload;
            console.log(`[Backend Socket.IO] ${username} stopped typing in room ${roomId}`);
            socket.to(roomId).emit('typing-status', { username, isTyping: false });
        });

        socket.on('webrtc-signal', (payload: { roomId: string, sender: string, recipient: string, type: string, data: any }) => {
            const { roomId, sender, recipient, type, data } = payload;
            console.log(`[Backend Socket.IO] Received WebRTC signal type '${type}' from '${sender}' for '${recipient}' in room ${roomId}`);

            const recipientSocketId = usernameToSocketIdMap.get(recipient);

            if (recipientSocketId && recipientSocketId !== socket.id) {
                io.to(recipientSocketId).emit('webrtc-signal', {
                    roomId,
                    sender,
                    recipient,
                    type,
                    data
                });
                console.log(`[Backend Socket.IO] Forwarded WebRTC signal type '${type}' from '${sender}' to '${recipient}' (Socket ID: ${recipientSocketId}) in room ${roomId}`);
            } else if (recipientSocketId === socket.id) {
                console.warn(`[Backend Socket.IO] Attempted to send WebRTC signal to self from ${sender}. Ignoring.`);
            } else {
                console.warn(`[Backend Socket.IO] Recipient '${recipient}' not found or not online for WebRTC signal from ${sender}.`);
                socket.emit('error', { message: `Recipient '${recipient}' is not online or available.` });
            }
        });

        socket.on('disconnect', async (reason: string) => { // Explicitly type reason
            console.log(`[Backend Socket.IO] Socket.IO connection closed: ${socket.id}. Reason: ${reason}`);

            const disconnectedUsername = socket.data.username;
            const disconnectedRoomId = socket.data.roomId;

            if (disconnectedUsername && usernameToSocketIdMap.get(disconnectedUsername) === socket.id) {
                usernameToSocketIdMap.delete(disconnectedUsername);
                console.log(`[Backend Socket.IO] Removed ${disconnectedUsername} from usernameToSocketIdMap.`);
            }

            if (disconnectedRoomId && disconnectedUsername) {
                try {
                    await storage.removeRoomParticipant(disconnectedRoomId, disconnectedUsername);
                    console.log(`[Backend Socket.IO] Marked ${disconnectedUsername} as inactive in DB for room ${disconnectedRoomId}.`);
                } catch (error) {
                    console.error('[Backend Socket.IO] Error removing room participant on disconnect:', error);
                }

                io.to(disconnectedRoomId).emit('participant-left', {
                    username: disconnectedUsername,
                    roomId: disconnectedRoomId,
                    participants: getRoomParticipants(disconnectedRoomId)
                });

                io.to(disconnectedRoomId).emit('message-received', {
                    id: generateMessageId(),
                    roomId: disconnectedRoomId,
                    sender: 'System',
                    content: `${disconnectedUsername} disconnected from the chat`,
                    messageType: 'system',
                    timestamp: new Date().toISOString()
                });
                console.log(`[Backend Socket.IO] User ${disconnectedUsername} disconnected from room ${disconnectedRoomId}. Broadcasted leave event.`);
            }
        });
    });

    console.log('[Backend Socket.IO] Socket.IO server initialized and listening for connections.');

    const cleanupInterval = setInterval(async () => {
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        try {
            console.log(`[${new Date().toISOString()}] Starting scheduled message cleanup.`);
            await storage.deleteOldMessages(twentyFourHoursAgo);
            console.log(`[${new Date().toISOString()}] Scheduled message cleanup completed.`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error during scheduled message cleanup:`, error);
        }
    }, 60 * 60 * 1000);

    httpServer.on('close', () => {
        clearInterval(cleanupInterval);
        console.log('[Backend Socket.IO] Message cleanup interval cleared on HTTP server close.');
    });

    return { httpServer, io };
}
