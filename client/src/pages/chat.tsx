import { useState, useCallback, useEffect } from 'react';
import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal';
import { NotificationToast } from '@/components/chat/NotificationToast';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { ChatMessage, NotificationData, RoomState } from '@/types/chat';

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
   * Generate a unique message ID
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

    // Update room state
    setRoomState(prev => ({
      ...prev,
      roomId,
      username,
      isConnected: false,
      messages: []
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

    // Reset state
    setRoomState({
      roomId: '',
      username: '',
      isConnected: false,
      participants: [],
      messages: []
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
    // The 'message' object received here already contains roomId and sender
    // because MessageInput now correctly passes them.
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
      }));

      setIsRoomModalOpen(false);
      setIsConnecting(false);

      // Add system message
      const systemMessage: ChatMessage = {
        id: generateMessageId(),
        roomId: data.roomId,
        sender: 'System',
        content: 'You joined the chat',
        messageType: 'system',
        timestamp: new Date()
      };

      setRoomState(prev => ({
        ...prev,
        messages: [...prev.messages, systemMessage]
      }));
    });

    // User left room
    const unsubscribeRoomLeft = socket.on('room-left', (data: { roomId: string; username: string }) => {
      console.log('User left room:', data);

      if (data.username !== roomState.username) {
        setRoomState(prev => ({
          ...prev,
          participants: prev.participants.filter(p => p !== data.username)
        }));

        // Add system message
        const systemMessage: ChatMessage = {
          id: generateMessageId(),
          roomId: data.roomId,
          sender: 'System',
          content: `${data.username} left the chat`,
          messageType: 'system',
          timestamp: new Date()
        };

        setRoomState(prev => ({
          ...prev,
          messages: [...prev.messages, systemMessage]
        }));
      }
    });

    // Message received
    const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
      console.log('Message received:', message);

      // Don't add our own messages again (because we optimistically added them)
      if (message.sender === roomState.username) return;

      const receivedMessage: ChatMessage = {
        ...message,
        isSelf: false
      };

      setRoomState(prev => ({
        ...prev,
        messages: [...prev.messages, receivedMessage]
      }));
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
        isConnected: data.connected
      }));
    });

    // Error handling
    const unsubscribeError = socket.on('error', (data: { message: string }) => {
      console.error('Socket error:', data);

      addNotification('error', 'Error', data.message);
      setIsConnecting(false);
    });

    // Cleanup function
    return () => {
      unsubscribeRoomJoined();
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
  }, [socket.connectionError, addNotification]); // Added addNotification to dependencies

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
            roomId={roomState.roomId} // <--- ADDED THIS LINE
            username={roomState.username} // <--- ADDED THIS LINE
            disabled={!roomState.isConnected}
          />

          {/* Video Call Modal with override to hide */}
          <VideoCallModal
            isOpen={isCallActiveOverride}  // Use override here
            callState={webRTC.callState}
            localVideoRef={webRTC.localVideoRef}
            remoteVideoRef={webRTC.remoteVideoRef}
            onEndCall={webRTC.endCall}
            onToggleVideo={webRTC.toggleVideo}
            onToggleAudio={webRTC.toggleAudio}
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
