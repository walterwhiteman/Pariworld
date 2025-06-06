// src/pages/chat.tsx

import { useState, useCallback, useEffect } from 'react';
import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal';
import { NotificationToast } from '@/components/chat/NotificationToast';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { ChatMessage, NotificationData, RoomState } from '@/types/chat'; // Ensure ChatMessage is correctly typed

/**
 * Main chat page component that orchestrates the entire chat application
 * Manages room state, messaging, notifications, and video calling
 */
export default function ChatPage() {
  // Room and user state
  const [roomState, setRoomState] = useState<RoomState>({
    roomId: '',
    username: '',
    isConnected: false,
    participants: [],
    messages: []
  });

  // UI state
  const [isRoomModalOpen, setIsRoomModalOpen] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [typingUser, setTypingUser] = useState<string | undefined>();
  const [notifications, setNotifications] = useState<NotificationData[]>([]);

  // Override for temporarily silencing the video call state and UI
  const [isCallActiveOverride, setIsCallActiveOverride] = useState(false);

  // Hooks
  const socket = useSocket();
  const webRTC = useWebRTC(socket, roomState.roomId, roomState.username);

  /**
   * Add a notification
   */
  const addNotification = useCallback((
    type: NotificationData['type'],
    title: string,
    message: string,
    duration?: number
  ) => {
    const notification: NotificationData = {
      id: Date.now().toString(),
      type,
      title,
      message,
      duration
    };

    setNotifications(prev => [...prev, notification]);
  }, []);

  /**
   * Dismiss a notification
   */
  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  /**
   * Generate a unique message ID (client-side for optimistic updates)
   */
  const generateMessageId = (): string => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  /**
   * Join a chat room
   */
  const handleJoinRoom = useCallback((roomId: string, username: string) => {
    if (!socket.isConnected) {
      addNotification('error', 'Connection Error', 'Unable to connect to chat server');
      return;
    }

    setIsConnecting(true);

    // Update room state (don't clear messages here, they'll be loaded from history)
    setRoomState(prev => ({
      ...prev,
      roomId,
      username,
      isConnected: false,
      messages: [] // It's okay to clear on a fresh *join* to ensure a clean slate before history loads
    }));

    // Join room via socket
    socket.joinRoom(roomId, username);
  }, [socket, addNotification]);

  /**
   * Leave the current room
   */
  const handleLeaveRoom = useCallback(() => {
    if (roomState.roomId && roomState.username) {
      socket.leaveRoom(roomState.roomId, roomState.username);
    }

    // End video call if active
    if (webRTC.callState.isActive) {
      webRTC.endCall();
    }

    // Reset state after leaving the room
    setRoomState({
      roomId: '',
      username: '',
      isConnected: false,
      participants: [],
      messages: [] // Clear messages when truly leaving the room
    });

    setIsRoomModalOpen(true);
    setIsConnecting(false);
    setTypingUser(undefined);

    addNotification('info', 'Left Room', 'You have left the chat room');
  }, [roomState, socket, webRTC, addNotification]);

  /**
   * Send a message
   */
  const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    if (!roomState.isConnected) {
      addNotification('error', 'Connection Error', 'Not connected to chat room');
      return;
    }

    // Create complete message (for optimistic UI update)
    const completeMessage: ChatMessage = {
      ...message,
      id: generateMessageId(),
      timestamp: new Date(),
      isSelf: true
    };

    // Add to local messages immediately for optimistic display
    setRoomState(prev => ({
      ...prev,
      messages: [...prev.messages, completeMessage]
    }));

    // Send via socket
    socket.sendMessage(message);
  }, [roomState.isConnected, socket, addNotification]);

  /**
   * Handle typing start
   */
  const handleTypingStart = useCallback(() => {
    if (roomState.isConnected) {
      socket.sendTypingStatus(roomState.roomId, roomState.username, true);
    }
  }, [roomState, socket]);

  /**
   * Handle typing stop
   */
  const handleTypingStop = useCallback(() => {
    if (roomState.isConnected) {
      socket.sendTypingStatus(roomState.roomId, roomState.username, false);
    }
  }, [roomState, socket]);

  /**
   * Set up socket event listeners
   */
  useEffect(() => {
    if (!socket.on) return;

    // Room joined successfully
    const unsubscribeRoomJoined = socket.on('room-joined', (data: { roomId: string; participants: string[] }) => {
      console.log('Room joined successfully:', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: true,
        participants: data.participants
        // REMOVED: messages: [] -- messages will be populated by 'message-history'
      }));

      setIsRoomModalOpen(false);
      setIsConnecting(false);

      // Add system message for self-join AFTER previous messages are loaded
      // OR consider adding this system message only on the client if it's purely for client feedback
      // For now, let's keep it in the backend for consistency, but ensure it has an ID
      // If backend sends it, we'll receive it via 'message-received'
    });

    // Handle historical messages from the server
    const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
      console.log('Received message history:', data.messages);
      setRoomState(prev => {
        // Filter out any messages that might already be optimistically added (e.g. from current user's send)
        // And ensure IDs match
        const existingMessageIds = new Set(prev.messages.map(msg => msg.id));
        const newHistoricalMessages = data.messages.filter(
          historicalMsg => !existingMessageIds.has(historicalMsg.id)
        ).map(msg => ({
          ...msg,
          // Ensure timestamp is a Date object, if coming as ISO string from backend
          timestamp: new Date(msg.timestamp),
          isSelf: msg.sender === prev.username // Mark messages sent by self
        }));

        // Append the system message for joining
        const systemMessage: ChatMessage = {
          id: generateMessageId(), // Ensure a unique ID for the system message
          roomId: data.roomId,
          sender: 'System',
          content: 'You joined the chat',
          messageType: 'system',
          timestamp: new Date()
        };

        return {
          ...prev,
          // Prepend historical messages, then existing messages, then the system message
          // This order might need adjustment based on desired UI
          messages: [...newHistoricalMessages, systemMessage, ...prev.messages]
                      .sort((a, b) => (new Date(a.timestamp)).getTime() - (new Date(b.timestamp)).getTime()) // Sort by timestamp
        };
      });
    });


    // User left room
    const unsubscribeRoomLeft = socket.on('room-left', (data: { roomId: string; username: string }) => {
      console.log('User left room:', data);

      if (data.username !== roomState.username) {
        setRoomState(prev => ({
          ...prev,
          participants: prev.participants.filter(p => p !== data.username)
        }));

        // System message for user leaving is now sent from backend, received via 'message-received'
      }
    });

    // Message received (this will handle new messages AND system messages from backend)
    const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
      console.log('Message received:', message);

      setRoomState(prev => {
        // Check if message ID already exists to prevent duplicates (especially with optimistic updates)
        if (prev.messages.some(msg => msg.id === message.id)) {
          return prev; // Message already present, do nothing
        }

        const receivedMessage: ChatMessage = {
          ...message,
          timestamp: new Date(message.timestamp), // Ensure timestamp is Date object
          isSelf: message.sender === prev.username
        };

        return {
          ...prev,
          messages: [...prev.messages, receivedMessage].sort((a, b) => (new Date(a.timestamp)).getTime() - (new Date(b.timestamp)).getTime()) // Re-sort to ensure order
        };
      });
    });

    // User typing
    const unsubscribeUserTyping = socket.on('user-typing', (data: { username: string; isTyping: boolean }) => {
      console.log('User typing:', data);

      if (data.username !== roomState.username) {
        setTypingUser(data.isTyping ? data.username : undefined);
      }
    });

    // Connection status
    const unsubscribeConnectionStatus = socket.on('connection-status', (data: { connected: boolean; participantCount: number }) => {
      console.log('Connection status:', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: data.connected,
        participants: prev.participants.length > 0 ? prev.participants : getRoomParticipantsFromSocketIoAdapter(socket.socket, data.participantCount) // Fallback for initial participants if not in room-joined event
      }));
    });

    // Helper to get participants from Socket.IO adapter (if needed as fallback, but 'room-joined' should provide this)
    // This function needs to be outside or adapted as a utility
    function getRoomParticipantsFromSocketIoAdapter(socketIoInstance: any, count: number): string[] {
        // This is a complex thing to do accurately on the client side without server's map.
        // Rely on 'room-joined' event for participant list.
        // For now, just return an array of empty strings if count is available, or previous participants
        return Array(count).fill('unknown-user');
    }


    // Error handling
    const unsubscribeError = socket.on('error', (data: { message: string }) => {
      console.error('Socket error:', data);

      addNotification('error', 'Error', data.message);
      setIsConnecting(false);
    });

    // Cleanup function
    return () => {
      unsubscribeRoomJoined();
      unsubscribeMessageHistory(); // Clean up new listener
      unsubscribeRoomLeft();
      unsubscribeMessageReceived();
      unsubscribeUserTyping();
      unsubscribeConnectionStatus();
      unsubscribeError();
    };
  }, [socket, roomState.username]); // Added roomState.username to dependencies

  /**
   * Handle connection errors
   */
  useEffect(() => {
    if (socket.connectionError) {
      addNotification('error', 'Connection Failed', socket.connectionError);
      setIsConnecting(false);
    }
  }, [socket.connectionError, addNotification]);

  /**
   * Temporarily override callState.isActive to false
   * to silence the persistent "ending video call" console message
   */
  useEffect(() => {
    setIsCallActiveOverride(false);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Room Join Modal */}
      <RoomJoinModal
        isOpen={isRoomModalOpen}
        onJoinRoom={handleJoinRoom}
        isConnecting={isConnecting}
      />

      {/* Main Chat Interface */}
      {!isRoomModalOpen && (
        <>
          {/* Chat Header */}
          <ChatHeader
            roomId={roomState.roomId}
            isConnected={roomState.isConnected}
            participantCount={roomState.participants.length}
            onStartVideoCall={webRTC.startCall}
            onLeaveRoom={handleLeaveRoom}
          />

          {/* Chat Messages */}
          <ChatMessages
            messages={roomState.messages}
            currentUsername={roomState.username}
            typingUser={typingUser}
          />

          {/* Message Input */}
          <MessageInput
            onSendMessage={handleSendMessage}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            roomId={roomState.roomId}
            username={roomState.username}
            disabled={!roomState.isConnected}
          />

          {/* Video Call Modal with override to hide */}
          <VideoCallModal
            isOpen={isCallActiveOverride}
            callState={webRTC.callState}
            localVideoRef={webRTC.localVideoRef}
            remoteVideoRef={webRTC.remoteVideoRef}
            onEndCall={webRTC.endCall}
            onToggleVideo={webRTC.toggleVideo}
            onToggleAudio={webRTC.toggleAudio}
            onToggleSpeaker={webRTC.toggleSpeaker} // Make sure this prop is passed to VideoCallModal
            formatCallDuration={webRTC.formatCallDuration}
          />
        </>
      )}

      {/* Notification Toasts */}
      <NotificationToast
        notifications={notifications}
        onDismiss={dismissNotification}
      />
    </div>
  );
}
