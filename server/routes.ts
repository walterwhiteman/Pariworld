import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { RoomParticipant } from "@shared/schema";

// Define ChatMessage interface for server use
interface ChatMessage {
  id: string;
  roomId: string;
  sender: string;
  content?: string;
  imageData?: string;
  messageType: 'text' | 'image' | 'system';
  timestamp: Date;
}

// WebSocket message types
interface WebSocketMessage {
  event: string;
  payload: any;
}

// Connected clients tracking
interface ConnectedClient {
  ws: WebSocket;
  roomId?: string;
  username?: string;
  isAlive: boolean;
}

/**
 * Register HTTP routes and WebSocket server for the private chat application
 * Implements real-time messaging using WebSocket instead of Socket.IO for simplicity
 */
export async function registerRoutes(app: Express): Promise<Server> {
  
  // HTTP Routes for basic API endpoints
  
  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Get room info (optional - for future use)
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

  // Create HTTP server
  const httpServer = createServer(app);

  // WebSocket server setup
  const wss = new WebSocketServer({ 
    server: httpServer, 
    path: '/ws'
  });

  // Track connected clients
  const clients = new Map<WebSocket, ConnectedClient>();

  /**
   * Send message to specific room participants
   */
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

  /**
   * Send message to specific client
   */
  const sendToClient = (ws: WebSocket, message: WebSocketMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending message to client:', error);
      }
    }
  };

  /**
   * Get room participant count
   */
  const getRoomParticipantCount = (roomId: string): number => {
    let count = 0;
    clients.forEach((client) => {
      if (client.roomId === roomId) {
        count++;
      }
    });
    return count;
  };

  /**
   * Get room participant usernames
   */
  const getRoomParticipants = (roomId: string): string[] => {
    const participants: string[] = [];
    clients.forEach((client) => {
      if (client.roomId === roomId && client.username) {
        participants.push(client.username);
      }
    });
    return participants;
  };

  /**
   * Generate unique message ID
   */
  const generateMessageId = (): string => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  /**
   * Handle WebSocket connections
   */
  wss.on('connection', (ws) => {
    console.log('New WebSocket connection established');

    // Initialize client
    const client: ConnectedClient = {
      ws,
      isAlive: true
    };
    clients.set(ws, client);

    // Send connection confirmation
    sendToClient(ws, {
      event: 'connection-established',
      payload: { connected: true }
    });

    /**
     * Handle incoming messages
     */
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

            // Notify other room participants
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
                id: generateMessageId(),
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
              // Remove from room participant tracking
              try {
                await storage.removeRoomParticipant(roomId, username);
              } catch (error) {
                console.error('Error removing room participant:', error);
              }

              // Notify other participants
              sendToRoom(roomId, {
                event: 'room-left',
                payload: { roomId, username }
              }, ws);

              sendToRoom(roomId, {
                event: 'connection-status',
                payload: { 
                  connected: true, 
                  participantCount: getRoomParticipantCount(roomId) - 1 
                }
              }, ws);

              // Clear client room info
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

            // Create complete message
            const completeMessage: ChatMessage = {
              id: generateMessageId(),
              roomId: client.roomId,
              sender: client.username,
              content: messageData.content,
              imageData: messageData.imageData,
              messageType: messageData.messageType || 'text',
              timestamp: new Date()
            };

            // Store message (optional - for message history)
            try {
              await storage.addMessage(completeMessage);
            } catch (error) {
              console.error('Error storing message:', error);
            }

            // Broadcast to room participants (excluding sender)
            sendToRoom(client.roomId, {
              event: 'message-received',
              payload: {
                ...completeMessage,
                timestamp: completeMessage.timestamp.toISOString()
              }
            }, ws);

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

          // WebRTC signaling for video calls (stretch goal)
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

    /**
     * Handle WebSocket errors
     */
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    /**
     * Handle WebSocket disconnection
     */
    ws.on('close', async () => {
      console.log('WebSocket connection closed');

      const client = clients.get(ws);
      if (client && client.roomId && client.username) {
        // Remove from room participant tracking
        try {
          await storage.removeRoomParticipant(client.roomId, client.username);
        } catch (error) {
          console.error('Error removing room participant on disconnect:', error);
        }

        // Notify other participants
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

      // Remove client from tracking
      clients.delete(ws);
    });

    /**
     * Ping/pong for connection health check
     */
    ws.on('pong', () => {
      const client = clients.get(ws);
      if (client) {
        client.isAlive = true;
      }
    });
  });

  /**
   * Periodic health check for WebSocket connections
   */
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

  /**
   * Cleanup on server shutdown
   */
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  console.log('WebSocket server initialized on /ws path');

  return httpServer;
}
