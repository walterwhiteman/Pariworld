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
import { useWebRTC } from '@/hooks/useWebRTC'; // Assuming this is the useWebRTC from previous responses

import { ChatMessage, NotificationData, RoomState } from '@/types/chat'; // Ensure ChatMessage and NotificationData are properly defined

/**
 * Main chat page component that orchestrates the entire chat application
 * Manages room state, messaging, notifications, and video calling
 */
export default function ChatPage() {
  console.log('ChatPage: Rendering component.');

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

  // Hooks
  const socket = useSocket();
  // CORRECTED: Pass an options object to useWebRTC
  // The useWebRTC hook provided earlier manages its own socket connection.
  const webRTC = useWebRTC({
    roomId: roomState.roomId,
    username: roomState.username,
    // Add callbacks for webRTC events if needed, e.g.:
    onCallAccepted: (callId) => {
      console.log(`Call accepted with ${callId}`);
      addNotification('success', 'Call Active', `You are now in a call with ${callId}`);
    },
    onCallEnded: (reason) => {
      console.log(`Call ended: ${reason}`);
      addNotification('info', 'Call Ended', `The call has ended.`);
    },
    onIncomingCall: (callerUsername, callId) => {
        console.log(`Incoming call from ${callerUsername} (ID: ${callId})`);
        addNotification('info', 'Incoming Call', `Call from ${callerUsername}.`);
    },
    onCallRejected: () => {
        console.log('Call was rejected or busy.');
        addNotification('warning', 'Call Rejected', 'The call was rejected or user is busy.');
    }
  });


  // Add this useEffect to track ChatPage's mount/unmount
  useEffect(() => {
      console.log('ChatPage: Component mounted.');
      return () => {
          console.log('ChatPage: Component unmounted.');
      };
  }, []);

  /**
   * Helper function to format call duration from seconds to HH:MM:SS
   */
  const formatCallDuration = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    const pad = (num: number) => num.toString().padStart(2, '0');

    if (hours > 0) {
      return `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`;
    }
    return `${pad(minutes)}:${pad(remainingSeconds)}`;
  }, []);


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
   * Handler for starting a video call.
   * This example assumes a recipient is known or hardcoded.
   * In a real app, you might have a participant list to pick from.
   */
  const handleStartVideoCall = useCallback(() => {
    if (!roomState.isConnected || !socket.isConnected) {
        addNotification('error', 'Call Error', 'Not connected to chat room or socket.');
        return;
    }
    // For a multi-user chat, you'd typically need to select a recipient.
    // For demonstration, let's assume a direct call to another specific user or the first participant found.
    // Replace 'some_recipient_id' with actual logic to get a recipient's ID if needed for 1:1 calls.
    // Or, if it's a "group call" button, your `startCall` might internally handle signaling to all.
    // For now, let's pass a dummy recipient ID or the current user's ID if it's a test.
    // IMPORTANT: simple-peer requires a target recipient ID for signaling!
    // This part might need more context from your app's call flow (1:1 vs group).
    // For now, let's just make sure it's not undefined.
    const recipientId = roomState.participants.find(p => p !== roomState.username); // Try to call someone else
    if (recipientId) {
        webRTC.startCall(recipientId);
        addNotification('info', 'Calling', `Attempting to call ${recipientId}...`);
    } else {
        addNotification('warning', 'Call Error', 'No other participant found to call.');
    }

  }, [roomState.isConnected, roomState.participants, roomState.username, socket.isConnected, webRTC, addNotification]);


  /**
   * Set up socket event listeners
   */
  useEffect(() => {
    console.log('ChatPage: useEffect (Socket Listeners) Mounted.');

    if (!socket.on) {
        console.warn('ChatPage: Socket instance not ready for event listeners.');
        return;
    }

    // Room joined successfully
    const unsubscribeRoomJoined = socket.on('room-joined', (data: { roomId: string; participants: string[] }) => {
      console.log('Room joined successfully:', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: true,
        participants: data.participants // Backend provides actual participant list
      }));

      setIsRoomModalOpen(false);
      setIsConnecting(false);
    });

    // Handle historical messages from the server
    const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
      console.log('Received message history:', data.messages);
      setRoomState(prev => {
        // Ensure timestamp is a Date object and mark self messages
        const historicalMessagesWithSelfFlag = data.messages.map(msg => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
          isSelf: msg.sender === prev.username
        }));

        return {
          ...prev,
          messages: [...prev.messages, ...historicalMessagesWithSelfFlag].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()) // Ensure correct order
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
    });

    // Message received (this will handle new messages AND system messages from backend)
    const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
      console.log('Message received:', message);

      setRoomState(prev => {
        // Check if message ID already exists to prevent duplicates
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

      setRoomState(prev => {
        return {
          ...prev,
          isConnected: data.connected,
        };
      });
    });

    // Error handling
    const unsubscribeError = socket.on('error', (data: { message: string }) => {
      console.error('Socket error:', data);

      addNotification('error', 'Error', data.message);
      setIsConnecting(false);
    });

    // Cleanup function for socket listeners
    return () => {
      console.log('ChatPage: useEffect (Socket Listeners) Cleanup - ChatPage is unmounting or dependencies changed.');
      unsubscribeRoomJoined();
      unsubscribeMessageHistory();
      unsubscribeRoomLeft();
      unsubscribeMessageReceived();
      unsubscribeUserTyping();
      unsubscribeConnectionStatus();
      unsubscribeError();
    };
  }, [socket, roomState.username, addNotification]); // Added addNotification to dependencies for useCallback stability

  /**
   * Handle connection errors from useSocket hook
   */
  useEffect(() => {
    console.log('ChatPage: useEffect (Connection Error) Mounted.');
    if (socket.connectionError) {
      addNotification('error', 'Connection Failed', socket.connectionError);
      setIsConnecting(false);
    }
    return () => {
        console.log('ChatPage: useEffect (Connection Error) Cleanup.');
    }
  }, [socket.connectionError, addNotification]);


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
            onStartVideoCall={handleStartVideoCall} {/* Changed to new handler */}
            onLeaveRoom={handleLeaveRoom}
          />

          {/* Chat Messages */}
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

          {/* Video Call Modal */}
          <VideoCallModal
            // CORRECTED: isOpen logic to include all relevant call states
            isOpen={webRTC.callState.isActive || webRTC.callState.isCalling || webRTC.callState.isReceivingCall}
            callState={webRTC.callState}
            localVideoRef={webRTC.localVideoRef}
            remoteVideoRef={webRTC.remoteVideoRef}
            onEndCall={webRTC.endCall}
            // CORRECTED: Prop names for toggle functions
            onToggleVideo={webRTC.toggleLocalVideo}
            onToggleAudio={webRTC.toggleLocalAudio}
            // ADDED: Pass the new formatCallDuration function
            formatCallDuration={formatCallDuration}
            onAcceptCall={webRTC.acceptCall}
            onRejectCall={webRTC.rejectCall}
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
