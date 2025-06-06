// src/pages/chat.tsx

import { useState, useCallback, useEffect } from 'react';
import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal';
import { NotificationToast } from '@/components/chat/NotificationToast';
import { ImageViewerModal } from '@/components/chat/ImageViewerModal';
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

  // Image Viewer Modal state
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [currentViewingImage, setCurrentViewingImage] = useState<string | null>(null);

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
   * Handle image click to open in viewer modal
   */
  const handleImageClick = useCallback((imageUrl: string) => {
    setCurrentViewingImage(imageUrl);
    setIsImageViewerOpen(true);
  }, []);

  /**
   * Handle closing the image viewer modal
   */
  const handleCloseImageViewer = useCallback(() => {
    setIsImageViewerOpen(false);
    setCurrentViewingImage(null);
  }, []);

  /**
   * Join a chat room
   */
  const handleJoinRoom = useCallback((roomId: string, username: string) => {
    if (!socket.isConnected) {
      addNotification('error', 'Connection Error', 'Unable to connect to chat server');
      return;
    }

    setIsConnecting(true);

    // Clear messages on a fresh join before history loads
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
   * No longer performs optimistic UI update for the message itself.
   * Relies on backend's 'message-received' event for display.
   */
  const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp' | 'isSelf'>) => {
    if (!roomState.isConnected) {
      addNotification('error', 'Connection Error', 'Not connected to chat room');
      return;
    }

    // Send only the necessary data to the backend.
    // The backend will save it, generate ID/timestamp, and broadcast it back.
    socket.sendMessage({
      roomId: message.roomId,
      sender: message.sender,
      content: message.content,
      imageData: message.imageData,
      messageType: message.messageType
    });

    // Optionally: If you *really* want optimistic UI for your own messages,
    // you would add a temporary ID and then in message-received, find and update
    // that message with the server's canonical ID. For now, this simpler approach
    // directly fixes the double message bug by waiting for the server.
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
    });

    // Handle historical messages from the server
    const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
      console.log('Received message history:', data.messages);
      setRoomState(prev => {
        const historicalMessagesWithSelfFlag = data.messages.map(msg => ({
          ...msg,
          timestamp: new Date(msg.timestamp), // Ensure timestamp is a Date object
          isSelf: msg.sender === prev.username // Mark messages sent by self
        }));

        // Simply replace the messages with historical messages, ensuring correct order
        return {
          ...prev,
          messages: historicalMessagesWithSelfFlag.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
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
      }
      // System message for user leaving is now sent from backend, received via 'message-received'
    });

    // Message received (this will handle new messages AND system messages from backend)
    const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
      console.log('Message received:', message);

      setRoomState(prev => {
        // Check if message ID already exists to prevent duplicates
        // This is crucial now that the backend sends the canonical ID.
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
          messages: [...prev.messages, receivedMessage].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()) // Re-sort to ensure order
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

    // Connection status (participantCount might update here too)
    const unsubscribeConnectionStatus = socket.on('connection-status', (data: { connected: boolean; participantCount: number, username: string }) => {
      console.log('Connection status:', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: data.connected,
        // Update participants array to reflect current room participants
        // This is a more robust way to update participants if needed,
        // but 'room-joined' and 'room-left' should handle primary updates.
        // This particular `connection-status` event from backend might update participants
        // by filtering out the disconnected user if `username` is provided.
        participants: (() => {
            const currentOnline = new Set(getRoomParticipantsFromSocketIoAdapter(socket.socket, data.participantCount));
            if (data.connected) {
                // If a user connects, ensure they are in the list (already done by backend via 'room-joined')
                // This event mostly confirms counts.
                return prev.participants; // Rely on other events for list
            } else {
                // If a user disconnects, remove them from the list if the event signifies it
                // The `room-left` event already handles removing from the list.
                return prev.participants.filter(p => p !== data.username);
            }
        })()
      }));
    });

    // Helper to get participants from Socket.IO adapter (client-side) - this is generally not reliable
    // and should be handled by server events like 'room-joined' and 'room-left'.
    // Removed direct usage, relying on backend.
    function getRoomParticipantsFromSocketIoAdapter(socketIoInstance: any, count: number): string[] {
      // This is generally unreliable on client side for exact usernames.
      // Rely on server-sent participant lists.
      // Returning empty array or a placeholder as this function should ideally not be needed.
      return [];
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
      unsubscribeMessageHistory();
      unsubscribeRoomLeft();
      unsubscribeMessageReceived();
      unsubscribeUserTyping();
      unsubscribeConnectionStatus();
      unsubscribeError();
    };
  }, [socket, roomState.username]); // Added roomState.username to dependencies

  /**
   * Handle connection errors from useSocket hook
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
   * (This is an existing override, kept as is)
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
          {/* Chat Header - Make it fixed at the top */}
          <ChatHeader
            className="flex-none"
            roomId={roomState.roomId}
            isConnected={roomState.isConnected}
            participantCount={roomState.participants.length}
            onStartVideoCall={webRTC.startCall}
            onLeaveRoom={handleLeaveRoom}
          />

          {/* Chat Messages - This component's internal 'main' tag already has flex-1 and overflow-hidden,
                           and its inner div has overflow-y-auto, so messages will scroll here. */}
          <ChatMessages
            messages={roomState.messages}
            currentUsername={roomState.username}
            typingUser={typingUser}
            onImageClick={handleImageClick}
          />

          {/* Message Input - Make it fixed at the bottom */}
          <MessageInput
            className="flex-none"
            onSendMessage={handleSendMessage}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            roomId={roomState.roomId}
            username={roomState.username}
            disabled={!roomState.isConnected}
          />

          {/* Video Call Modal with override to hide */}
          <VideoCallModal
            isOpen={webRTC.callState.isActive && !isCallActiveOverride} // Use webRTC.callState.isActive directly for actual call state
            callState={webRTC.callState}
            localVideoRef={webRTC.localVideoRef}
            remoteVideoRef={webRTC.remoteVideoRef}
            onEndCall={webRTC.endCall}
            onToggleVideo={webRTC.toggleVideo}
            onToggleAudio={webRTC.toggleAudio}
            onToggleSpeaker={webRTC.toggleSpeaker} // <-- Removed duplicate line
            formatCallDuration={webRTC.formatCallDuration}
          />
        </>
      )}

      {/* Notification Toasts */}
      <NotificationToast
        notifications={notifications}
        onDismiss={dismissNotification}
      />

      {/* Image Viewer Modal */}
      <ImageViewerModal
        isOpen={isImageViewerOpen}
        imageUrl={currentViewingImage}
        onClose={handleCloseImageViewer}
      />
    </div>
  );
}
