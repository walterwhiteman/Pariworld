import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from 'socket.io';
import { storage } from "./storage"; // Make sure storage.ts is updated as provided previously
import { RoomParticipant } from "@shared/schema"; // Ensure this path is correct based on your project structure

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

// Map to store which username is associated with which socket ID
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
            origin: "https://pariworld.onrender.com", // Ensure this matches your frontend deployment URL
            methods: ["GET", "POST"],
            credentials: true
        }
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
            // Iterate over socket IDs in the room and find corresponding usernames
            roomSockets.forEach(socketId => {
                // Find the username associated with this socketId
                for (const [username, id] of usernameToSocketIdMap.entries()) {
                    if (id === socketId) {
                        participants.push(username);
                        break; // Found the username, move to the next socketId
                    }
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
            // The `storage.getRoomParticipants` might get all participants ever,
            // but `getRoomParticipants` above gets currently online ones.
            // It's good to use the online list for real-time participant count.
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

        socket.on('join-room', async ({ roomId, username }) => {
            if (!roomId || !username) {
                socket.emit('error', { message: 'Room ID and username are required' });
                return;
            }

            // Check the number of current participants in the room
            const currentParticipantsInRoom = getRoomParticipantCount(roomId);

            // --- IMPORTANT: Implement the 2-user limit for rooms (especially for video calls) ---
            if (currentParticipantsInRoom >= 2) {
                console.log(`Room ${roomId} is full. User ${username} cannot join for video call.`);
                socket.emit('error', { message: 'This room is currently full for video calls (max 2 participants).' });
                return; // Prevent joining the room if it's full
            }
            // --- End of 2-user limit check ---

            socket.join(roomId);
            usernameToSocketIdMap.set(username, socket.id);

            // Store room and username in socket data for easy access on disconnect
            socket.data.roomId = roomId;
            socket.data.username = username;

            console.log(`User ${username} (Socket ID: ${socket.id}) joined room ${roomId}`);

            try {
                // Add participant to the database, marking them as active
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

            // Get updated list of participants for the room
            const currentRoomParticipants = getRoomParticipants(roomId);

            // Emit 'room-joined' only to the joining socket
            socket.emit('room-joined', {
                roomId,
                // Send other participants *excluding* the current user
                participants: currentRoomParticipants.filter(p => p !== username)
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

            // Broadcast connection status update to all in the room
            io.to(roomId).emit('connection-status', {
                connected: true, // This indicates a general connection status, not individual user status
                participantCount: getRoomParticipantCount(roomId),
                username // The username of the user who just connected/updated status
            });
        });

        socket.on('leave-room', async ({ roomId, username }) => {
            // Ensure the socket leaving is the one associated with the username
            if (usernameToSocketIdMap.get(username) === socket.id) {
                socket.leave(roomId);
                usernameToSocketIdMap.delete(username); // Remove from our map

                try {
                    // Update participant status in DB to inactive
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

                // Emit 'room-left' to all in the room to update their participant lists
                io.to(roomId).emit('room-left', { roomId, username });
                
                // Broadcast updated connection status to all in the room
                io.to(roomId).emit('connection-status', {
                    connected: true, // This reflects overall room connection, not a specific user
                    participantCount: getRoomParticipantCount(roomId),
                    username // The username of the user who just left
                });

                console.log(`User ${username} left room ${roomId}`);
            }
        });

        socket.on('send-message', async (messageData) => {
            const { roomId, username } = socket.data; // Retrieve room and username from socket data

            if (!roomId || !username) {
                socket.emit('error', { message: 'Must join a room first' });
                return;
            }

            // Create message object to be saved. No ID or timestamp here, as DB will generate.
            const messageToSave = {
                roomId,
                sender: username,
                content: messageData.content || null, // Ensure null if content is empty/undefined
                imageData: messageData.imageData || null, // Ensure null if imageData is empty/undefined
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
            // Broadcast to all in the room EXCEPT the sender
            socket.to(roomId).emit('user-typing', { username, isTyping: true });
        });

        socket.on('typing-stop', ({ roomId, username }) => {
            // Broadcast to all in the room EXCEPT the sender
            socket.to(roomId).emit('user-typing', { username, isTyping: false });
        });

        // WebRTC signaling
        socket.on('webrtc-signal', ({ roomId, sender, recipient, type, data }) => {
            const recipientSocketId = usernameToSocketIdMap.get(recipient);

            if (recipientSocketId && recipientSocketId !== socket.id) {
                // Forward the signal to the intended recipient
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
                // Optionally, inform the sender that the recipient is not available
                socket.emit('error', { message: `Recipient '${recipient}' is not currently available for a call.` });
            }
        });


        socket.on('disconnect', async () => {
            console.log('Socket.IO disconnected:', socket.id);

            let disconnectedUsername: string | undefined;
            // Find the username associated with the disconnected socket ID
            for (const [username, id] of usernameToSocketIdMap.entries()) {
                if (id === socket.id) {
                    disconnectedUsername = username;
                    usernameToSocketIdMap.delete(username); // Remove from map
                    break;
                }
            }

            const disconnectedRoomId = socket.data.roomId; // Retrieve room ID from socket data

            if (disconnectedRoomId && disconnectedUsername) {
                try {
                    // Update participant status in DB to inactive
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

                // Emit 'room-left' and 'connection-status' to inform remaining users
                io.to(disconnectedRoomId).emit('room-left', { roomId: disconnectedRoomId, username: disconnectedUsername });
                io.to(disconnectedRoomId).emit('connection-status', {
                    connected: true, // This reflects overall room connection, not a specific user
                    participantCount: getRoomParticipantCount(disconnectedRoomId),
                    username: disconnectedUsername // The username of the user who just disconnected
                });

                console.log(`User ${disconnectedUsername} disconnected from room ${disconnectedRoomId}`);
            }
        });
    });

    // Cleanup old messages every hour
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

    httpServer.on('close', () => clearInterval(cleanupInterval)); // Clean up interval on server close

    console.log('Socket.IO server initialized on /ws path');

    return httpServer;
}
