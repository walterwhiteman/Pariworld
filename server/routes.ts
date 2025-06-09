import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from 'socket.io';
import { storage } from "./storage"; // Make sure storage.ts is updated as provided previously
// Assuming RoomParticipant is defined in your shared schema
import { RoomParticipant } from "@shared/schema"; 

// NOTE: This interface is for backend context.
// It should align with the ChatMessage interface in storage.ts and your Drizzle schema.
interface ChatMessage {
    id: string;
    roomId: string;
    sender: string;
    content: string | null;
    imageData: string | null;
    messageType: 'text' | 'image' | 'system';
    timestamp: Date;
}

// Map to store which username is associated with which socket ID
// This is used for quick lookup of a socket ID given a username for targeted emissions.
// It also helps in associating a disconnected socket back to a username.
// IMPORTANT: In a production environment with multiple server instances, this map would need
// to be replaced by a distributed store (e.g., Redis) using the Socket.IO Redis Adapter.
const usernameToSocketIdMap = new Map<string, string>();

export async function registerRoutes(app: Express): Promise<Server> {
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // HTTP server for Express routes
    const httpServer = createServer(app);

    // Socket.IO server attached to the HTTP server
    const io = new SocketIOServer(httpServer, {
        path: '/ws', // Aligning client path with backend's /ws
        cors: {
            origin: "https://pariworld.onrender.com", // Ensure this matches your frontend deployment URL
            methods: ["GET", "POST"],
            credentials: true
        },
        // IMPORTANT: Add pingInterval and pingTimeout to the server-side configuration.
        // These should generally match or be slightly longer than the client's settings.
        pingInterval: 30000, // Server sends a ping every 30 seconds
        pingTimeout: 35000,   // Server waits 35 seconds for a pong before considering disconnected
        // Higher timeout on server than client ensures server doesn't disconnect first
    });

    // Helper functions (defined after `io` is initialized to ensure `io.sockets.adapter` is available)
    const getRoomParticipantCount = (roomId: string): number => {
        // Returns the number of active sockets in a room
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

    const generateMessageId = (): string =>
        `sys_msg_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    app.get('/api/rooms/:roomId', async (req, res) => {
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

    io.on('connection', (socket) => {
        console.log('New Socket.IO connection:', socket.id);

        socket.emit('connection-established', { connected: true });

        // Add a type for the callback function for 'join-room'
        type JoinRoomCallback = (response: { success: boolean; message?: string }) => void;

        // Using `callback` for acknowledgments
        socket.on('join-room', async ({ roomId, username }: { roomId: string; username: string }, callback?: JoinRoomCallback) => {
            if (!roomId || !username) {
                console.error(`Join room failed for socket ${socket.id}: Room ID or username missing.`);
                if (callback) {
                    callback({ success: false, message: 'Room ID and username are required.' });
                } else {
                    socket.emit('error', { message: 'Room ID and username are required.' });
                }
                return;
            }

            // --- Handle existing connections for the same username ---
            if (usernameToSocketIdMap.has(username) && usernameToSocketIdMap.get(username) !== socket.id) {
                console.warn(`User ${username} attempted to join from new socket ${socket.id} while already connected with ${usernameToSocketIdMap.get(username)!}. Disconnecting old socket.`);
                const oldSocketId = usernameToSocketIdMap.get(username)!;
                const oldSocket = io.sockets.sockets.get(oldSocketId);
                if (oldSocket) {
                    oldSocket.emit('force-disconnect', { message: 'You have connected from another location.' });
                    oldSocket.disconnect(true); // Disconnect the old socket
                }
                usernameToSocketIdMap.set(username, socket.id); // Update map to new socket ID
            } else {
                usernameToSocketIdMap.set(username, socket.id); // Map username to new socket ID
            }

            // Store room and username in socket data for easy access on disconnect
            socket.data.roomId = roomId;
            socket.data.username = username;

            const participantsBeforeJoin = getRoomParticipants(roomId);

            if (participantsBeforeJoin.length >= 2) {
                console.log(`Room ${roomId} is full. User ${username} cannot join for video call. (Current: ${participantsBeforeJoin.length})`);
                // Clean up the usernameToSocketIdMap entry if we're not actually joining.
                usernameToSocketIdMap.delete(username);
                socket.data.roomId = undefined; // Clear data if not joining
                socket.data.username = undefined; // Clear data if not joining
                if (callback) {
                    callback({ success: false, message: 'This room is currently full for video calls (max 2 participants).' });
                } else {
                    socket.emit('error', { message: 'This room is currently full for video calls (max 2 participants).' });
                }
                return;
            }

            socket.join(roomId); // Now join the room
            console.log(`User ${username} (Socket ID: ${socket.id}) joined room ${roomId}`);

            try {
                await storage.addRoomParticipant(roomId, username);
            } catch (error) {
                console.error('Error storing room participant:', error);
                if (callback) {
                    callback({ success: false, message: 'Failed to add participant to database.' });
                    return; // Stop processing if DB operation fails
                }
            }

            try {
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
                            timestamp: msg.timestamp.toISOString()
                        }))
                    });
                }
            } catch (error) {
                console.error('Error fetching previous messages:', error);
                // This is not a fatal error for joining, but log it.
            }

            const updatedParticipantsList = getRoomParticipants(roomId);
            console.log(`Server: Updated participants for room ${roomId} after ${username} joined:`, updatedParticipantsList);

            io.to(roomId).emit('room-joined', {
                roomId,
                participants: updatedParticipantsList
            });

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
                participantCount: updatedParticipantsList.length,
                username
            });

            // Acknowledge successful join to the client
            if (callback) {
                callback({ success: true });
            }
        });

        type LeaveRoomCallback = (response: { success: boolean; message?: string }) => void;

        socket.on('leave-room', async ({ roomId, username }: { roomId: string; username: string }, callback?: LeaveRoomCallback) => {
            const leavingRoomId = socket.data.roomId || roomId;
            const leavingUsername = socket.data.username || username;

            if (!leavingRoomId || !leavingUsername) {
                console.warn(`Leave room failed: Missing room ID or username for socket ${socket.id}`);
                if (callback) {
                    callback({ success: false, message: 'Room ID and username are required for leaving.' });
                }
                return;
            }

            if (usernameToSocketIdMap.get(leavingUsername) === socket.id) {
                socket.leave(leavingRoomId);
                usernameToSocketIdMap.delete(leavingUsername);
            } else {
                console.warn(`Leave room: Mismatched socket ID for user ${leavingUsername}. Expected ${usernameToSocketIdMap.get(leavingUsername) || 'no entry'}, got ${socket.id}. Proceeding based on socket.data.`);
            }

            console.log(`User ${leavingUsername} (Socket ID: ${socket.id}) leaving room ${leavingRoomId}`);

            try {
                await storage.removeRoomParticipant(leavingRoomId, leavingUsername);
            } catch (error) {
                console.error('Error removing room participant:', error);
                if (callback) {
                    callback({ success: false, message: 'Failed to remove participant from database.' });
                }
                return;
            }

            io.to(leavingRoomId).emit('message-received', {
                id: generateMessageId(),
                roomId: leavingRoomId,
                sender: 'System',
                content: `${leavingUsername} left the chat`,
                messageType: 'system',
                timestamp: new Date().toISOString()
            });

            const remainingParticipants = getRoomParticipants(leavingRoomId);
            console.log(`Server: Remaining participants in room ${leavingRoomId}:`, remainingParticipants);

            io.to(leavingRoomId).emit('room-left', {
                roomId: leavingRoomId,
                username: leavingUsername,
                participants: remainingParticipants
            });

            io.to(leavingRoomId).emit('connection-status', {
                connected: true,
                participantCount: remainingParticipants.length,
                username: leavingUsername
            });

            if (callback) {
                callback({ success: true });
            }
        });

        socket.on('send-message', async (messageData, callback?: (response: { success: boolean; messageId?: string; message?: string }) => void) => {
            const { roomId, username } = socket.data;

            if (!roomId || !username) {
                console.error(`Send message failed for socket ${socket.id}: Not in a room or username missing.`);
                if (callback) {
                    callback({ success: false, message: 'Must join a room first.' });
                } else {
                    socket.emit('error', { message: 'Must join a room first.' });
                }
                return;
            }

            const messageToSave = {
                roomId,
                sender: username,
                content: messageData.content || null,
                imageData: messageData.imageData || null,
                messageType: messageData.messageType || 'text',
            };

            let savedMessage: ChatMessage;
            try {
                savedMessage = await storage.addMessage(messageToSave);
                console.log('Message successfully saved to DB:', savedMessage);
            } catch (error) {
                console.error('Error storing message:', error);
                if (callback) {
                    callback({ success: false, message: 'Failed to save message to database.' });
                } else {
                    socket.emit('message-error', { message: 'Failed to send message.' });
                }
                return;
            }

            io.to(roomId).emit('message-received', {
                id: savedMessage.id,
                roomId: savedMessage.roomId,
                sender: savedMessage.sender,
                content: savedMessage.content,
                imageData: savedMessage.imageData,
                messageType: savedMessage.messageType,
                timestamp: savedMessage.timestamp.toISOString()
            });

            console.log(`Message sent in room ${roomId} by ${username}`);

            if (callback) {
                callback({ success: true, messageId: savedMessage.id });
            }
        });

        socket.on('typing-start', ({ roomId, username }) => {
            socket.to(roomId).emit('user-typing', { username, isTyping: true });
        });

        socket.on('typing-stop', ({ roomId, username }) => {
            socket.to(roomId).emit('user-typing', { username, isTyping: false });
        });

        socket.on('webrtc-signal', ({ roomId, sender, recipient, type, data }, callback?: (response: { success: boolean; message?: string }) => void) => {
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
                if (callback) {
                    callback({ success: true });
                }
            } else if (recipientSocketId === socket.id) {
                console.warn(`User ${sender} tried to send WebRTC signal to self. Ignored.`);
                if (callback) {
                    callback({ success: false, message: 'Cannot send WebRTC signal to self.' });
                }
            } else {
                console.warn(`Recipient '${recipient}' not online for WebRTC signal from ${sender}.`);
                if (callback) {
                    callback({ success: false, message: `Recipient '${recipient}' is not currently available for a call.` });
                } else {
                    socket.emit('error', { message: `Recipient '${recipient}' is not currently available for a call.` });
                }
            }
        });

        socket.on('disconnect', async (reason) => {
            console.log('Socket.IO disconnected:', socket.id, 'Reason:', reason);

            const disconnectedRoomId = socket.data.roomId as string | undefined;
            const disconnectedUsername = socket.data.username as string | undefined;

            if (disconnectedRoomId && disconnectedUsername) {
                // Check if this socket ID is still the one associated with the username in our map
                // This prevents issues if a user reconnects quickly and the map was updated.
                if (usernameToSocketIdMap.get(disconnectedUsername) === socket.id) {
                    usernameToSocketIdMap.delete(disconnectedUsername);
                    console.log(`Removed ${disconnectedUsername} from usernameToSocketIdMap.`);
                } else {
                    console.warn(`Disconnect cleanup: Mismatched socket ID for username ${disconnectedUsername}. Map has ${usernameToSocketIdMap.get(disconnectedUsername) || 'no entry'}, disconnected socket is ${socket.id}.`);
                }

                try {
                    await storage.removeRoomParticipant(disconnectedRoomId, disconnectedUsername);
                    console.log(`Removed ${disconnectedUsername} from DB for room ${disconnectedRoomId}`);
                } catch (error) {
                    console.error('Error removing participant from DB on disconnect:', error);
                }

                const remainingParticipants = getRoomParticipants(disconnectedRoomId);
                console.log(`Server: Remaining participants in room ${disconnectedRoomId} after disconnect:`, remainingParticipants);

                // Only emit system message and participant updates if there are still clients in the room
                // to receive them, or if we want to update all existing rooms for a general presence.
                // For now, we'll assume we want to update the room if any participants are left.
                if (io.sockets.adapter.rooms.has(disconnectedRoomId) && remainingParticipants.length > 0) {
                     io.to(disconnectedRoomId).emit('message-received', {
                        id: generateMessageId(),
                        roomId: disconnectedRoomId,
                        sender: 'System',
                        content: `${disconnectedUsername} disconnected from the chat`,
                        messageType: 'system',
                        timestamp: new Date().toISOString()
                    });

                    io.to(disconnectedRoomId).emit('room-left', {
                        roomId: disconnectedRoomId,
                        username: disconnectedUsername,
                        participants: remainingParticipants
                    });

                    io.to(disconnectedRoomId).emit('connection-status', {
                        connected: true, // This reflects overall room connection status, not individual
                        participantCount: remainingParticipants.length,
                        username: disconnectedUsername // The username that disconnected
                    });
                } else {
                    console.log(`No remaining participants in room ${disconnectedRoomId}, skipping further broadcasts.`);
                }
            } else {
                console.log(`Disconnected socket ${socket.id} had no associated room/username data.`);
            }
        });
    });

    // Cleanup old messages every hour
    const cleanupInterval = setInterval(async () => {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
        try {
            await storage.deleteOldMessages(cutoff);
            console.log(`Cleaned up messages older than ${cutoff.toISOString()}`);
        } catch (error) {
            console.error('Error during message cleanup:', error);
        }
    }, 60 * 60 * 1000); // Run every hour

    httpServer.on('close', () => {
        console.log('HTTP server closing, clearing cleanup interval.');
        clearInterval(cleanupInterval);
    });

    console.log('Socket.IO server initialized on /ws path');

    return httpServer;
}
