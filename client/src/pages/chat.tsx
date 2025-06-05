import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'wouter'; // Import useLocation from wouter

import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal';
import { VideoCallOverlay } from '@/components/chat/VideoCallOverlay'; // Import the new overlay component
import { NotificationToast } from '@/components/chat/NotificationToast';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { ChatMessage, NotificationData, RoomState, VideoCallState } from '@/types/chat'; // Ensure VideoCallState is imported

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

  // Video call state and refs
  const [isCallMinimized, setIsCallMinimized] = useState(false); // New state for overlay
  const localVideoRef = useRef<HTMLVideoElement>(null); // Ref for local video element
  const remoteVideoRef = useRef<HTMLVideoElement>(null); // Ref for remote video element

  // Wouter hook for location changes (to detect "back" or navigation away)
  const [location] = useLocation();

  // Hooks
  const socket = useSocket();
  // Pass video refs to useWebRTC
  const webRTC = useWebRTC(socket, roomState.roomId, roomState.username, localVideoRef, remoteVideoRef);

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
  const generateMessageId = useCallback((): string => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    setIsCallMinimized(false); // Ensure call is not minimized when leaving room

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
      id: generateMessageId(), // Ensure client-side ID for optimistic rendering
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
  }, [roomState.isConnected, socket, addNotification, generateMessageId]);

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
   * Minimize the video call to an overlay
   */
  const minimizeCall = useCallback(() => {
    if (webRTC.callState.isActive) {
      setIsCallMinimized(true);
    }
  }, [webRTC.callState.isActive]);

  /**
   * Expand the video call from the overlay to full screen
   */
  const expandCall = useCallback(() => {
    setIsCallMinimized(false);
  }, []);

  /**
   * Effect to set up socket event listeners
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

      // IMPORTANT: If you are doing optimistic updates, filter out your own messages here.
      // Make sure the ID generated on the client matches the ID from the server
      // or implement a better reconciliation strategy (e.g., replace temp ID with server ID).
      // For now, assuming server sends back the exact message content including sender for filtering.
      if (message.sender === roomState.username) {
        // If the server sends back your own message, update its ID if it was temporary
        // and remove the optimistically added message.
        // This is a common pattern for reliable optimistic updates.
        // For simplicity, for now, we just return if it's our own sender.
        return;
      }

      const receivedMessage: ChatMessage = {
        ...message,
        // Ensure timestamp is a Date object, as it comes as ISO string from backend
        timestamp: new Date(message.timestamp),
        isSelf: false
      };

      setRoomState(prev => ({
        ...prev,
        messages: [...prev.messages, receivedMessage]
      }));
    });

    // Message history received on join
    const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
      console.log('Message history received:', data);
      setRoomState(prev => ({
        ...prev,
        messages: data.messages.map(msg => ({
          ...msg,
          // Ensure timestamp is a Date object
          timestamp: new Date(msg.timestamp),
          isSelf: msg.sender === roomState.username // Mark historical messages as self if needed
        }))
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
    const unsubscribeConnectionStatus = socket.on('connection-status', (data: { connected: boolean; participantCount: number; username: string }) => {
      console.log('Connection status:', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: data.connected,
        // Update participants based on connection status (more robust)
        participants: data.username ? [...new Set([...prev.participants, data.username])] : prev.participants
      }));
    });


    // Error handling
    const unsubscribeError = socket.on('error', (data: { message: string }) => {
      console.error('Socket error:', data);

      addNotification('error', 'Error', data.message);
      setIsConnecting(false);
    });

    // --- WebRTC Socket Listeners (Ensure these are handled in useWebRTC or here if needed) ---
    // If you plan to pass WebRTC signals through Socket.IO, ensure listeners are set up.
    // However, it's generally cleaner to handle WebRTC-specific socket events within useWebRTC.
    // Example:
    // const unsubscribeWebRTCSignal = socket.on('webrtc-signal', (signalData: WebRTCSignal) => {
    //   // Handled inside useWebRTC now
    // });


    // Cleanup function: unsubscribe from all events when component unmounts
    return () => {
      unsubscribeRoomJoined();
      unsubscribeRoomLeft();
      unsubscribeMessageReceived();
      unsubscribeMessageHistory(); // Clean up history listener
      unsubscribeUserTyping();
      unsubscribeConnectionStatus();
      unsubscribeError();
      // unsubscribeWebRTCSignal(); // Clean up WebRTC signal listener if defined here
    };
  }, [socket, roomState.username, generateMessageId, addNotification]); // Dependencies

  /**
   * Handle socket connection errors
   */
  useEffect(() => {
    if (socket.connectionError) {
      addNotification('error', 'Connection Failed', socket.connectionError);
      setIsConnecting(false);
    }
  }, [socket.connectionError, addNotification]);

  /**
   * Effect to handle navigation changes and minimize/expand the call
   * This mimics the "back button" behavior
   */
  useEffect(() => {
    // If a video call is active
    if (webRTC.callState.isActive) {
      // If the current path is NOT the main chat path (e.g., navigating to home or another route)
      // then minimize the call. Assumes '/' is your main chat path. Adjust if your chat is e.g. /chat/:roomId
      // For this example, assuming the ChatPage is always mounted on '/' route or similar root route.
      // If `location` changes FROM something, it implies navigation away.
      // For a single page app where / is the chat, any navigation change might be outside the app.
      // A more robust check might involve comparing previous location to current location or using history API.
      // For now, let's simplify: if the modal is not open, and call is active, it means we navigated
      // *into* chat but then left the "fullscreen" modal state.
      if (!isRoomModalOpen) { // Only apply if we are actually in the chat UI
        // If we want to detect "back" or external navigation, we might need more complex logic.
        // For simple in-app "minimization" on route change, this means if we are not on the main chat page, minimize.
        // If you have other pages, navigating to them should minimize.
        // If 'location' changes to something *other* than the chat route, minimize.
        // This is a simplified check.
        // For example, if your app has /home and /chat:
        // if (location !== '/' && webRTC.callState.isActive) { minimizeCall(); } else { expandCall(); }

        // A more direct way: if the VideoCallModal is explicitly closed (not just minimized by user action)
        // or if a conceptual "back" action happens, we minimize.
        // Since VideoCallModal's 'isOpen' prop is controlled here, and it's always true when active:
        // The overlay logic handles the visual state based on 'isCallMinimized'.

        // To specifically trigger on "back" button press (browser history):
        // This is harder to capture reliably within React's useEffect with 'wouter' directly
        // without tracking history stack. The current approach is more about "if main call UI is not shown, show overlay".

        // Let's refine the logic for "minimizing on navigation away from chat, or back button press"
        // The current use of `isCallMinimized` state already serves this purpose.
        // When the user is in the full chat interface and clicks some button that changes the route,
        // we'd want to call `minimizeCall()`.

        // Let's assume for now, `expandCall` and `minimizeCall` are called by explicit UI actions
        // like a "back" button within the `VideoCallModal` itself, or a dedicated minimize button.
        // The `useEffect` for `location` changes can be used if you want automatic minimize
        // when *any* route change happens away from the chat page.

        // Example: If '/app' is your main chat route, and '/app/settings' is another.
        // If (location !== '/app' && webRTC.callState.isActive && !isCallMinimized) {
        //   minimizeCall();
        // } else if (location === '/app' && webRTC.callState.isActive && isCallMinimized) {
        //   expandCall();
        // }
      }
    }
  }, [location, webRTC.callState.isActive, minimizeCall, expandCall, isRoomModalOpen]);


  // IMPORTANT: The `isCallActiveOverride` state is no longer needed if you manage
  // isOpen of VideoCallModal directly with `webRTC.callState.isActive && !isCallMinimized`.
  // Removed `isCallActiveOverride` from component state and related useEffect.

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

          {/* Video Call Modal (Full Screen) */}
          {webRTC.callState.isActive && !isCallMinimized && (
            <VideoCallModal
              isOpen={true} // It's open if call is active and not minimized
              callState={webRTC.callState}
              localVideoRef={localVideoRef} // Pass refs
              remoteVideoRef={remoteVideoRef} // Pass refs
              onEndCall={webRTC.endCall}
              onToggleVideo={webRTC.toggleVideo}
              onToggleAudio={webRTC.toggleAudio}
              formatCallDuration={webRTC.formatCallDuration}
              // Add a prop to minimize the call
              onMinimizeCall={minimizeCall} // <--- NEW PROP
            />
          )}

          {/* Video Call Overlay (Minimized View) */}
          {webRTC.callState.isActive && isCallMinimized && (
            <VideoCallOverlay
              callState={webRTC.callState}
              localVideoRef={localVideoRef} // Pass refs
              remoteVideoRef={remoteVideoRef} // Pass refs
              onExpandCall={expandCall} // Allows expanding back to full screen
              onEndCall={webRTC.endCall} // Allows ending call from overlay
            />
          )}
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
