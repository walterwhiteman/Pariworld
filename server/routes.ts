import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage"; // Ensure this imports your modified Storage class
import { RoomParticipant } from "@shared/schema";

// Define ChatMessage interface for server use
interface ChatMessage {
    id: number; // Changed to number to match serial('id') in schema
    roomId: string;
    sender: string;
    content?: string;
    imageData?: string;
    messageType: 'text' | 'image' | 'system';
    timestamp: Date; // Note: In server, it's Date; for sending, it's ISO string.
}

// WebSocket message types (unchanged)
interface WebSocketMessage {
    event: string;
    payload: any;
}

// Connected clients tracking (unchanged)
interface ConnectedClient {
    ws: WebSocket;
    roomId?: string;
    username?: string;
    isAlive: boolean;
}

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

            res.json({
                roomId,
                participantCount: activeParticipants.length,
                participants: activeParticipants.map(p => p.username)
            });
        } catch (error) {
            console.error('Error getting room info:', error);
            res.status(500).json({ error: 'Failed to get room info' });
        }
    });

    const httpServer = createServer(app);
    const wss = new WebSocketServer({
        server: httpServer,
        path: '/ws'
    });

    const clients = new Map<WebSocket, ConnectedClient>();

    // --- Helper Functions (unchanged) ---
    const sendToRoom = (roomId: string, message: WebSocketMessage, excludeWs?: WebSocket) => {
        clients.forEach((client, ws) => {
            if (client.roomId === roomId && ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
                try {
                    ws.send(JSON.stringify(message));
                } catch (error) {
                    console.error('Error sending message to client:', error);
                }
            }
        });
    };

    const sendToClient = (ws: WebSocket, message: WebSocketMessage) => {
        if (ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify(message));
            } catch (error) {
                console.error('Error sending message to client:', error);
            }
        }
    };

    const getRoomParticipantCount = (roomId: string): number => {
        let count = 0;
        clients.forEach((client) => {
            if (client.roomId === roomId) {
                count++;
            }
        });
        return count;
    };

    const getRoomParticipants = (roomId: string): string[] => {
        const participants: string[] = [];
        clients.forEach((client) => {
            if (client.roomId === roomId && client.username) {
                participants.push(client.username);
            }
        });
        return participants;
    };

    const generateMessageId = (): string => {
        // Since 'id' is now serial() in DB, this ID is for frontend use until DB assigns one
        // For a true unique ID before DB insert, you might use a UUID library here.
        // For now, we'll rely on DB to assign the primary key.
        return `temp_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    // --- WebSocket Connection Handling ---
    wss.on('connection', (ws) => {
        console.log('New WebSocket connection established');

        const client: ConnectedClient = {
            ws,
            isAlive: true
        };
        clients.set(ws, client);

        sendToClient(ws, {
            event: 'connection-established',
            payload: { connected: true }
        });

        ws.on('message', async (data) => {
            try {
                const message: WebSocketMessage = JSON.parse(data.toString());
                const { event, payload } = message;

                console.log(`Received event: ${event}`, payload);

                switch (event) {
                    case 'join-room': {
                        const { roomId, username } = payload;

                        if (!roomId || !username) {
                            sendToClient(ws, {
                                event: 'error',
                                payload: { message: 'Room ID and username are required' }
                            });
                            return;
                        }

                        // Update client info
                        client.roomId = roomId;
                        client.username = username;

                        // Store room participant
                        try {
                            await storage.addRoomParticipant(roomId, username);
                        } catch (error) {
                            console.error('Error storing room participant:', error);
                        }

                        // --- NEW: Fetch and send previous messages to the joining client ---
                        try {
                            const previousMessages = await storage.getMessages(roomId, 50); // Get last 50 messages
                            if (previousMessages.length > 0) {
                                console.log(`Sending ${previousMessages.length} historical messages to ${username} in ${roomId}`);
                                sendToClient(ws, {
                                    event: 'message-history', // New event type for history
                                    payload: {
                                        roomId,
                                        messages: previousMessages.map(msg => ({
                                            ...msg,
                                            // Ensure timestamp is ISO string for sending over WebSocket
                                            timestamp: msg.timestamp.toISOString()
                                        }))
                                    }
                                });
                            }
                        } catch (error) {
                            console.error('Error fetching previous messages:', error);
                        }
                        // --- END NEW ---

                        // Get current participants
                        const participants = getRoomParticipants(roomId);
                        const participantCount = getRoomParticipantCount(roomId);

                        // Notify client of successful join
                        sendToClient(ws, {
                            event: 'room-joined',
                            payload: {
                                roomId,
                                participants: participants.filter(p => p !== username)
                            }
                        });

                        // Notify other room participants about new connection
                        sendToRoom(roomId, {
                            event: 'connection-status',
                            payload: {
                                connected: true,
                                participantCount
                            }
                        }, ws);

                        // Send a system message to others about the new user
                        sendToRoom(roomId, {
                            event: 'message-received',
                            payload: {
                                // ID will be auto-generated by DB, so we don't assign here for system messages
                                roomId,
                                sender: 'System',
                                content: `${username} joined the chat`,
                                messageType: 'system',
                                timestamp: new Date().toISOString()
                            }
                        }, ws);

                        console.log(`User ${username} joined room ${roomId}`);
                        break;
                    }

                    case 'leave-room': {
                        const { roomId, username } = payload;

                        if (client.roomId === roomId && client.username === username) {
                            try {
                                await storage.removeRoomParticipant(roomId, username);
                            } catch (error) {
                                console.error('Error removing room participant:', error);
                            }

                            sendToRoom(roomId, {
                                event: 'room-left',
                                payload: { roomId, username }
                            });

                            sendToRoom(roomId, {
                                event: 'connection-status',
                                payload: {
                                    connected: true,
                                    participantCount: getRoomParticipantCount(roomId) - 1
                                }
                            }, ws);

                            client.roomId = undefined;
                            client.username = undefined;

                            console.log(`User ${username} left room ${roomId}`);
                        }
                        break;
                    }

                    case 'send-message': {
                        const messageData = payload;

                        if (!client.roomId || !client.username) {
                            sendToClient(ws, {
                                event: 'error',
                                payload: { message: 'Must join a room first' }
                            });
                            return;
                        }

                        // For 'serial' ID, we don't assign it here; DB will.
                        // The frontend will receive the message back with the DB-assigned ID.
                        const completeMessage: Omit<ChatMessage, 'id' | 'timestamp'> = {
                            roomId: client.roomId,
                            sender: client.username,
                            content: messageData.content,
                            imageData: messageData.imageData,
                            messageType: messageData.messageType || 'text',
                        };

                        // Store message using the modified storage.addMessage
                        try {
                            await storage.addMessage(completeMessage);
                            // After adding, you might want to re-fetch the message with its assigned ID
                            // or rely on the broadcast to send the full message object.
                            // For simplicity, we'll let the broadcast handle the full message.
                        } catch (error) {
                            console.error('Error storing message:', error);
                        }

                        // Broadcast to room participants (including sender for confirmation)
                        // Note: The 'id' and 'timestamp' will be generated by the DB.
                        // You'll need to fetch the message back or rely on the frontend to assign a temp ID
                        // and then update it when the confirmed message comes back.
                        // For simplicity, we'll send a message that the frontend can use,
                        // and it will be updated if history is fetched.
                        sendToRoom(client.roomId, {
                            event: 'message-received',
                            payload: {
                                // For now, we'll send what we have. Frontend should handle temp IDs.
                                // A more robust solution would fetch the message from DB after insert
                                // to get the actual serial ID and timestamp.
                                id: generateMessageId(), // Use a temp ID for immediate display
                                roomId: client.roomId,
                                sender: client.username,
                                content: messageData.content,
                                imageData: messageData.imageData,
                                messageType: messageData.messageType || 'text',
                                timestamp: new Date().toISOString() // Use current time for immediate broadcast
                            }
                        }, ws); // Send to all, including sender, for immediate display

                        console.log(`Message sent in room ${client.roomId} by ${client.username}`);
                        break;
                    }

                    case 'typing-start':
                    case 'typing-stop': {
                        const { roomId, username } = payload;

                        if (client.roomId === roomId && client.username === username) {
                            sendToRoom(roomId, {
                                event: 'user-typing',
                                payload: {
                                    username,
                                    isTyping: event === 'typing-start'
                                }
                            }, ws);
                        }
                        break;
                    }

                    case 'webrtc-signal': {
                        const { roomId, sender, type, data: signalData } = payload;

                        if (client.roomId === roomId && client.username === sender) {
                            sendToRoom(roomId, {
                                event: 'webrtc-signal',
                                payload: { roomId, sender, type, data: signalData }
                            }, ws);
                        }
                        break;
                    }

                    default:
                        console.log(`Unknown event: ${event}`);
                        sendToClient(ws, {
                            event: 'error',
                            payload: { message: `Unknown event type: ${event}` }
                        });
                }
            } catch (error) {
                console.error('Error processing WebSocket message:', error);
                sendToClient(ws, {
                    event: 'error',
                    payload: { message: 'Invalid message format' }
                });
            }
        });

        // --- WebSocket Error and Close Handling (unchanged) ---
        ws.on('error', (error) => {
            console.error('WebSocket error:', error);
        });

        ws.on('close', async () => {
            console.log('WebSocket connection closed');

            const client = clients.get(ws);
            if (client && client.roomId && client.username) {
                try {
                    await storage.removeRoomParticipant(client.roomId, client.username);
                } catch (error) {
                    console.error('Error removing room participant on disconnect:', error);
                }

                sendToRoom(client.roomId, {
                    event: 'room-left',
                    payload: { roomId: client.roomId, username: client.username }
                });

                sendToRoom(client.roomId, {
                    event: 'connection-status',
                    payload: {
                        connected: true,
                        participantCount: getRoomParticipantCount(client.roomId) - 1
                    }
                });

                console.log(`User ${client.username} disconnected from room ${client.roomId}`);
            }

            clients.delete(ws);
        });

        // --- Ping/Pong for connection health check (unchanged) ---
        ws.on('pong', () => {
            const client = clients.get(ws);
            if (client) {
                client.isAlive = true;
            }
        });
    });

    // --- Heartbeat Interval (unchanged) ---
    const heartbeatInterval = setInterval(() => {
        clients.forEach((client, ws) => {
            if (!client.isAlive) {
                console.log('Terminating dead WebSocket connection');
                ws.terminate();
                return;
            }

            client.isAlive = false;
            ws.ping();
        });
    }, 30000); // 30 seconds

    // --- Cleanup on server shutdown (unchanged) ---
    wss.on('close', () => {
        clearInterval(heartbeatInterval);
    });

    console.log('WebSocket server initialized on /ws path');

    // --- NEW: Periodic cleanup of old messages (Run every hour) ---
    const cleanupInterval = setInterval(async () => {
        // Calculate the cutoff time (24 hours ago)
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        try {
            await storage.deleteOldMessages(twentyFourHoursAgo);
        } catch (error) {
            console.error('Error during message cleanup:', error);
        }
    }, 60 * 60 * 1000); // Run this cleanup function every 1 hour (3600000 ms)

    // Ensure the cleanup interval is cleared when the WebSocket server closes
    wss.on('close', () => {
        clearInterval(cleanupInterval);
    });

    return httpServer;
}
