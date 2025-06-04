import type { Express } from "express";
import { createServer, type Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io"; // Import Socket.IO Server and Socket types
import { storage } from "./storage";
// RoomParticipant interface is still relevant if you're storing participants in your DB
import { RoomParticipant } from "@shared/schema"; 

// Define ChatMessage interface for server use (remains the same)
interface ChatMessage {
  id: string;
  roomId: string;
  sender: string;
  content?: string;
  imageData?: string;
  messageType: 'text' | 'image' | 'system';
  timestamp: Date;
}

// Socket.IO does not need a generic WebSocketMessage interface like this.
// Events are handled by their names.

// Connected clients tracking is mostly handled by Socket.IO's internal state
// but we might still want to store custom data on the socket itself or in a map.
// For simplicity, we'll leverage socket.data for roomId and username.

/**
 * Register HTTP routes and Socket.IO server for the private chat application
 * Implements real-time messaging using Socket.IO
 */
export async function registerRoutes(app: Express): Promise<HttpServer> {

  // HTTP Routes for basic API endpoints (remain the same)

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

  // --- Socket.IO server setup ---
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "https://pariworld.onrender.com", // Your Render frontend URL
      methods: ["GET", "POST"],
      credentials: true
    },
    path: '/socket.io/', // Ensure this matches your frontend client's path configuration
    pingInterval: 30000, // Matching frontend client's ping interval
    pingTimeout: 25000,  // Matching frontend client's ping timeout
  });

  // Helper function to get participants in a room based on connected sockets
  const getSocketIORoomParticipants = (roomId: string): string[] => {
    const participants: string[] = [];
    // Iterate over sockets in the specified room
    io.sockets.adapter.rooms.get(roomId)?.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket && socket.data.username) {
        participants.push(socket.data.username as string);
      }
    });
    return participants;
  };

  // Helper function to get participant count in a room
  const getSocketIORoomParticipantCount = (roomId: string): number => {
    return io.sockets.adapter.rooms.get(roomId)?.size || 0;
  };

  /**
   * Generate unique message ID (remains the same)
   */
  const generateMessageId = (): string => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  /**
   * Handle Socket.IO connections
   */
  io.on('connection', (socket: Socket) => {
    console.log(`New Socket.IO connection established: ${socket.id}`);

    // Send connection confirmation (Socket.IO client automatically knows it's connected)
    // You might still send a custom 'welcome' or 'connection-established' event if needed.
    socket.emit('connection-established', { connected: true, socketId: socket.id });

    /**
     * Handle incoming messages (events)
     */
    socket.on('join-room', async ({ roomId, username }: { roomId: string, username: string }) => {
      if (!roomId || !username) {
        socket.emit('error', { message: 'Room ID and username are required' });
        return;
      }

      // Store roomId and username on the socket itself for easy access
      socket.data.roomId = roomId;
      socket.data.username = username;

      // Join the Socket.IO room
      socket.join(roomId);
      console.log(`Socket ${socket.id} (User: ${username}) joined room ${roomId}`);

      // Store room participant in persistent storage
      try {
        await storage.addRoomParticipant(roomId, username);
      } catch (error) {
        console.error('Error storing room participant:', error);
      }

      // Get current participants from Socket.IO's state
      const participantsInRoom = getSocketIORoomParticipants(roomId);
      const participantCount = getSocketIORoomParticipantCount(roomId);

      // Notify client of successful join
      socket.emit('room-joined', {
        roomId,
        participants: participantsInRoom.filter(p => p !== username) // Exclude self
      });

      // Notify other room participants (excluding sender)
      socket.to(roomId).emit('connection-status', {
        connected: true,
        participantCount
      });

      // Send a system message to others about the new user
      socket.to(roomId).emit('message-received', {
        id: generateMessageId(),
        roomId,
        sender: 'System',
        content: `${username} joined the chat`,
        messageType: 'system',
        timestamp: new Date().toISOString()
      });
    });

    socket.on('leave-room', async ({ roomId, username }: { roomId: string, username: string }) => {
      // Check if the socket is actually in the room and matches the username
      if (socket.data.roomId === roomId && socket.data.username === username) {
        // Leave the Socket.IO room
        socket.leave(roomId);
        console.log(`Socket ${socket.id} (User: ${username}) left room ${roomId}`);

        // Remove from persistent room participant tracking
        try {
          await storage.removeRoomParticipant(roomId, username);
        } catch (error) {
          console.error('Error removing room participant:', error);
        }

        // Notify other participants in the room that the user left
        io.to(roomId).emit('room-left', { roomId, username });
        io.to(roomId).emit('connection-status', {
          connected: true,
          participantCount: getSocketIORoomParticipantCount(roomId)
        });

        // Clear socket data
        socket.data.roomId = undefined;
        socket.data.username = undefined;
      }
    });

    socket.on('send-message', async (messageData: Omit<ChatMessage, 'id' | 'timestamp'>) => {
      const { roomId, username } = socket.data; // Get current room/user from socket data

      if (!roomId || !username) {
        socket.emit('error', { message: 'Must join a room first to send messages' });
        return;
      }

      // Create complete message
      const completeMessage: ChatMessage = {
        id: generateMessageId(),
        roomId: roomId,
        sender: username,
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

      // Broadcast to room participants (including sender, unless you explicitly want to exclude them)
      // If you want to exclude sender: socket.to(roomId).emit('message-received', ...)
      io.to(roomId).emit('message-received', {
        ...completeMessage,
        timestamp: completeMessage.timestamp.toISOString() // Ensure ISO string for client
      });

      console.log(`Message sent in room ${roomId} by ${username}`);
    });

    socket.on('typing-start', ({ roomId, username }: { roomId: string, username: string }) => {
      // Broadcast to others in the room (excluding sender)
      socket.to(roomId).emit('user-typing', { username, isTyping: true });
    });

    socket.on('typing-stop', ({ roomId, username }: { roomId: string, username: string }) => {
      // Broadcast to others in the room (excluding sender)
      socket.to(roomId).emit('user-typing', { username, isTyping: false });
    });

    // WebRTC signaling for video calls (stretch goal) - events remain the same
    socket.on('webrtc-signal', ({ roomId, sender, type, data: signalData }: { roomId: string, sender: string, type: string, data: any }) => {
      // Assuming sender is the current socket's username, validate if needed
      if (socket.data.roomId === roomId && socket.data.username === sender) {
        // Relay to other participants in the room (excluding sender)
        socket.to(roomId).emit('webrtc-signal', { roomId, sender, type, data: signalData });
      }
    });

    // Handle Socket.IO disconnection
    socket.on('disconnect', async (reason) => {
      const { roomId, username } = socket.data; // Retrieve data stored on the socket
      console.log(`Socket ${socket.id} disconnected (Reason: ${reason}). User: ${username}, Room: ${roomId}`);

      if (roomId && username) {
        // Remove from persistent room participant tracking
        try {
          await storage.removeRoomParticipant(roomId, username);
        } catch (error) {
          console.error('Error removing room participant on disconnect:', error);
        }

        // Notify other participants in the room that the user left
        io.to(roomId).emit('room-left', { roomId, username });
        io.to(roomId).emit('connection-status', {
          connected: true,
          participantCount: getSocketIORoomParticipantCount(roomId)
        });
        console.log(`User ${username} disconnected from room ${roomId}`);
      }
    });

    // Handle Socket.IO connection errors (e.g., transport errors)
    socket.on('connect_error', (err) => {
      console.error(`Socket.IO connect_error for ${socket.id}: ${err.message}`);
    });

    // Handle any general Socket.IO errors
    socket.on('error', (err) => {
      console.error(`Socket.IO error for ${socket.id}: ${err.message}`);
    });
  });

  // With Socket.IO, you don't need the manual ping/pong interval or the 'isAlive' tracking.
  // Socket.IO handles the heartbeat mechanism internally.

  console.log('Socket.IO server initialized on /socket.io/ path');

  return httpServer;
}
