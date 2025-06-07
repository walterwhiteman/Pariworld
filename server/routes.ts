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
    content: string | null;
    imageData: string | null;
    messageType: 'text' | 'image' | 'system';
    timestamp: Date;
}

interface ConnectedClientInfo {
    roomId: string;
    username: string;
}

// Map to store which username is associated with which socket ID
// This is used for quick lookup of a socket ID given a username for targeted emissions.
// It also helps in associating a disconnected socket back to a username.
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

    // Corrected and more robust getRoomParticipants:
    // It should iterate through the sockets in the room and use their `socket.data.username`
    // which is set when the user joins. This is more reliable than iterating `usernameToSocketIdMap`
    // which is a global map and might not perfectly reflect room membership by itself.
    const getRoomParticipants = (roomId: string): string[] => {
        const participants: string[] = [];
        const roomSockets = io.sockets.adapter.rooms.get(roomId);
        if (roomSockets) {
            // Iterate over socket IDs in the room
            for (const socketId of roomSockets) {
                const socket = io.sockets.sockets.get(socketId); // Get the actual socket object
                if (socket && socket.data.username) {
                    participants.push(socket.data.username);
                }
            }
        }
        return participants;
    };

    // This generateMessageId is primarily for *system messages* that might not be stored in DB
    // Regular chat messages will now get their ID from the database.
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

        socket.on('join-room', async ({ roomId, username }) => {
            if (!roomId || !username) {
                socket.emit('error', { message: 'Room ID and username are required' });
                return;
            }

            // --- IMPORTANT: Handle existing connections for the same username ---
            // If the username is already mapped to a different socket ID,
            // it means the user might be reconnecting or opening another tab.
            // In a simple chat, we want to ensure only one active socket per username.
            if (usernameToSocketIdMap.has(username) && usernameToSocketIdMap.get(username) !== socket.id) {
                console.warn(`User ${username} attempted to join from new socket ${socket.id} while already connected with ${usernameToSocketIdMap.get(username)!}.`);
                const oldSocketId = usernameToSocketIdMap.get(username)!;
                const oldSocket = io.sockets.sockets.get(oldSocketId);
                if (oldSocket) {
                    console.log(`Disconnecting old socket ${oldSocketId} for user ${username}.`);
                    // Optionally, inform the old socket client it's being disconnected
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

            // Before actually joining the room, check the participant count to enforce the 2-user limit.
            // We get the participants *before* adding the current socket to the room,
            // so `getRoomParticipants` will *not* include the current user yet.
            const participantsBeforeJoin = getRoomParticipants(roomId);

            if (participantsBeforeJoin.length >= 2) {
                console.log(`Room ${roomId} is full. User ${username} cannot join for video call. (Current: ${participantsBeforeJoin.length})`);
                socket.emit('error', { message: 'This room is currently full for video calls (max 2 participants).' });
                // Do not call socket.join if the room is full
                // Also, clean up the usernameToSocketIdMap entry if we're not actually joining.
                usernameToSocketIdMap.delete(username);
                socket.data.roomId = undefined;
                socket.data.username = undefined;
                return;
            }

            socket.join(roomId); // Now join the room
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
                    socket.emit('message-history', { // Send message history only to the joining client
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

            // Get the *truly* updated list of participants for the room AFTER the user has joined
            const updatedParticipantsList = getRoomParticipants(roomId);
            console.log(`Server: Updated participants for room ${roomId} after ${username} joined:`, updatedParticipantsList);

            // Emit 'room-joined' to ALL clients in this room (including the newly joined one)
            io.to(roomId).emit('room-joined', {
                roomId,
                participants: updatedParticipantsList
            });

            // System message for user joining
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
                connected: true,
                participantCount: updatedParticipantsList.length, // Use length of the truly updated list
                username // The username of the user who just connected/updated status
            });
        });

        socket.on('leave-room', async ({ roomId, username }) => {
            // It's safer to get room and username from socket.data if available,
            // as the client might send incorrect data or disconnect without proper leave.
            const leavingRoomId = socket.data.roomId || roomId;
            const leavingUsername = socket.data.username || username;

            if (!leavingRoomId || !leavingUsername) {
                console.warn(`Leave room failed: Missing room ID or username for socket ${socket.id}`);
                return;
            }

            // Ensure the socket leaving is the one currently associated with the username
            if (usernameToSocketIdMap.get(leavingUsername) === socket.id) {
                socket.leave(leavingRoomId);
                usernameToSocketIdMap.delete(leavingUsername); // Remove from our map
            } else {
                console.warn(`Leave room: Mismatched socket ID for user ${leavingUsername}. Expected ${usernameToSocketIdMap.get(leavingUsername)}, got ${socket.id}. Proceeding based on socket.data.`);
            }

            console.log(`User ${leavingUsername} (Socket ID: ${socket.id}) leaving room ${leavingRoomId}`);

            try {
                // Update participant status in DB to inactive
                await storage.removeRoomParticipant(leavingRoomId, leavingUsername);
            } catch (error) {
                console.error('Error removing room participant:', error);
            }

            // System message for user leaving
            io.to(leavingRoomId).emit('message-received', {
                id: generateMessageId(),
                roomId: leavingRoomId,
                sender: 'System',
                content: `${leavingUsername} left the chat`,
                messageType: 'system',
                timestamp: new Date().toISOString()
            });

            // Get the updated list of participants *after* the user has left
            const remainingParticipants = getRoomParticipants(leavingRoomId);
            console.log(`Server: Remaining participants in room ${leavingRoomId}:`, remainingParticipants);

            // Emit 'room-left' to all in the room to update their participant lists
            // This event can carry the specific username that left and the new participant list
            io.to(leavingRoomId).emit('room-left', {
                roomId: leavingRoomId,
                username: leavingUsername,
                participants: remainingParticipants // Send updated list to remaining users
            });

            // Broadcast updated connection status to all in the room
            io.to(leavingRoomId).emit('connection-status', {
                connected: true, // This reflects overall room connection, not a specific user
                participantCount: remainingParticipants.length, // Use length of the updated list
                username: leavingUsername // The username of the user who just left
            });
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
                content: messageData.content || null,
                imageData: messageData.imageData || null,
                messageType: messageData.messageType || 'text',
            };

            let savedMessage: ChatMessage;
            try {
                // Call addMessage, which now returns the inserted message with DB-generated ID and timestamp
                savedMessage = await storage.addMessage(messageToSave);
                console.log('Message successfully saved to DB:', savedMessage);
            } catch (error) {
                console.error('Error storing message:', error);
                socket.emit('message-error', { message: 'Failed to send message.' });
                return;
            }

            // Emit the message to the room using the canonical ID and timestamp from the database
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

            // Retrieve room and username from socket.data
            const disconnectedRoomId = socket.data.roomId as string | undefined;
            const disconnectedUsername = socket.data.username as string | undefined;

            if (disconnectedRoomId && disconnectedUsername) {
                // Only remove from map if this socket ID is still associated with the username
                if (usernameToSocketIdMap.get(disconnectedUsername) === socket.id) {
                    usernameToSocketIdMap.delete(disconnectedUsername);
                } else {
                    console.warn(`Disconnect: Mismatched socket ID for username ${disconnectedUsername}. Map has ${usernameToSocketIdMap.get(disconnectedUsername) || 'no entry'}, disconnected socket is ${socket.id}.`);
                    // This can happen if a user reconnects quickly and the map was updated.
                    // We still proceed with the username/room from socket.data for cleanup.
                }

                try {
                    // Update participant status in DB to inactive
                    await storage.removeRoomParticipant(disconnectedRoomId, disconnectedUsername);
                } catch (error) {
                    console.error('Error removing participant on disconnect:', error);
                }

                // System message for user disconnecting
                io.to(disconnectedRoomId).emit('message-received', {
                    id: generateMessageId(),
                    roomId: disconnectedRoomId,
                    sender: 'System',
                    content: `${disconnectedUsername} disconnected from the chat`,
                    messageType: 'system',
                    timestamp: new Date().toISOString()
                });

                // Get the updated list of participants *after* the user has truly disconnected
                const remainingParticipants = getRoomParticipants(disconnectedRoomId);
                console.log(`Server: Remaining participants in room ${disconnectedRoomId}:`, remainingParticipants);

                // Emit 'room-left' to all in the room to update their participant lists
                io.to(disconnectedRoomId).emit('room-left', {
                    roomId: disconnectedRoomId,
                    username: disconnectedUsername,
                    participants: remainingParticipants
                });

                // Broadcast updated connection status to all in the room
                io.to(disconnectedRoomId).emit('connection-status', {
                    connected: true, // This reflects overall room connection, not a specific user
                    participantCount: remainingParticipants.length, // Use length of the updated list
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
