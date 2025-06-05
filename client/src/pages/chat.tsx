import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
// Removed VideoCallModal and VideoCallOverlay imports
// import { VideoCallModal } from '@/components/chat/VideoCallModal';
// import { VideoCallOverlay } from '@/components/chat/VideoCallOverlay';
import { NotificationToast } from '@/components/chat/NotificationToast';
import { useSocket } from '@/hooks/useSocket';
// Removed useWebRTC import
// import { useWebRTC } from '@/hooks/useWebRTC';
import { ChatMessage, NotificationData, RoomState } from '@/types/chat';

// Import Firebase modules
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, Auth, User } from 'firebase/auth';
import {
  getFirestore, Firestore, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp,
  QueryDocumentSnapshot, DocumentData, limit
} from 'firebase/firestore';

export default function ChatPage() {
  // Firebase State
  const [app, setApp] = useState<FirebaseApp | null>(null);
  const [db, setDb] = useState<Firestore | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

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

  // Removed video call specific states
  // const [isCallMinimized, setIsCallMinimized] = useState(false);
  // const localVideoRef = useRef<HTMLVideoElement>(null);
  // const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const [location] = useLocation();

  const socket = useSocket();
  // Removed useWebRTC hook call
  // const webRTC = useWebRTC(roomState.roomId, roomState.username, localVideoRef, remoteVideoRef);

  /**
   * Add a notification toast
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
   * Dismiss a notification toast
   */
  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  /**
   * Generate a unique client-side message ID for optimistic updates.
   * Note: Firestore will generate its own document ID.
   */
  const generateClientMessageId = useCallback((): string => {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Initialize Firebase app and authenticate the user.
   * This runs once on component mount.
   */
  useEffect(() => {
    let firebaseAppInstance: FirebaseApp;
    let authInstance: Auth;
    let firestoreDbInstance: Firestore;

    try {
      // Check if Firebase is already initialized to avoid errors in development hot-reloads
      if (!app) {
        // Access global variables provided by the Canvas environment
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        firebaseAppInstance = initializeApp(firebaseConfig);
        firestoreDbInstance = getFirestore(firebaseAppInstance);
        authInstance = getAuth(firebaseAppInstance);

        setApp(firebaseAppInstance);
        setDb(firestoreDbInstance);
        setAuth(authInstance);

        // Sign in anonymously or with custom token
        if (initialAuthToken) {
          signInWithCustomToken(authInstance, initialAuthToken)
            .then((userCredential) => {
              console.log('Firebase signed in with custom token:', userCredential.user.uid);
              setUserId(userCredential.user.uid);
              setIsAuthReady(true);
            })
            .catch((error) => {
              console.error('Error signing in with custom token:', error);
              // Fallback to anonymous if custom token fails
              signInAnonymously(authInstance)
                .then((anonUserCredential) => {
                  console.log('Firebase signed in anonymously:', anonUserCredential.user.uid);
                  setUserId(anonUserCredential.user.uid);
                  setIsAuthReady(true);
                })
                .catch((anonError) => {
                  console.error('Error signing in anonymously:', anonError);
                  addNotification('error', 'Auth Error', 'Failed to authenticate. Please refresh.');
                  setIsAuthReady(false);
                });
            });
        } else {
          signInAnonymously(authInstance)
            .then((userCredential) => {
              console.log('Firebase signed in anonymously:', userCredential.user.uid);
              setUserId(userCredential.user.uid);
              setIsAuthReady(true);
            })
            .catch((error) => {
              console.error('Error signing in anonymously:', error);
              addNotification('error', 'Auth Error', 'Failed to authenticate. Please refresh.');
              setIsAuthReady(false);
            });
        }
      }
    } catch (error) {
      console.error('Firebase initialization error:', error);
      addNotification('error', 'Firebase Error', 'Failed to initialize Firebase.');
    }
  }, [addNotification, app]); // Only run once on mount

  /**
   * Handle joining a chat room.
   * Now integrates Firestore for message history.
   */
  const handleJoinRoom = useCallback(async (roomId: string, username: string) => {
    if (!socket.isConnected || !socket.socket) {
      addNotification('error', 'Connection Error', 'Unable to connect to chat server (Socket not ready)');
      return;
    }
    if (!isAuthReady || !db || !userId) {
      addNotification('error', 'Auth/DB Error', 'Authentication or database not ready.');
      return;
    }

    setIsConnecting(true);

    // Reset messages and update room state with new room ID and username
    setRoomState(prev => ({
      ...prev,
      roomId,
      username,
      isConnected: false,
      messages: [] // Clear messages on join
    }));

    socket.joinRoom(roomId, username);

    // --- Firestore Message History ---
    const messagesCollectionRef = collection(db, `artifacts/${__app_id}/public/data/chat_messages`);
    const q = query(
      messagesCollectionRef,
      // Filter messages for the specific room
      // orderBy('timestamp', 'asc'), // Firebase orderBy requires an index for filtering.
      // We will fetch all messages for the room and sort them in memory to avoid index issues.
      // This is a common workaround for Canvas Firestore.
    );

    // Attach real-time listener for messages
    // This listener will also fetch initial messages
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const newMessages: ChatMessage[] = [];
        snapshot.docs.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
            const data = doc.data();
            // Ensure message belongs to the current roomId after fetching all and before sorting
            if (data.roomId === roomId) {
                newMessages.push({
                    id: doc.id, // Use Firestore's generated ID
                    roomId: data.roomId,
                    sender: data.sender,
                    content: data.content,
                    imageData: data.imageData,
                    messageType: data.messageType || 'text', // Default to text
                    // Convert Firestore Timestamp to JavaScript Date
                    timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
                    isSelf: data.sender === username // Determine if self message for display
                });
            }
        });
        // Sort messages by timestamp in memory (since orderBy is removed from query)
        newMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

        setRoomState(prev => ({
            ...prev,
            messages: newMessages
        }));
        console.log(`Loaded ${newMessages.length} messages from Firestore for room ${roomId}`);
    }, (error) => {
        console.error('Error fetching messages from Firestore:', error);
        addNotification('error', 'Firestore Error', 'Failed to load message history.');
    });

    // Store the unsubscribe function to call it when leaving the room
    // or when the component unmounts. This is handled in cleanup effect.
    // For now, we'll store it in a ref or local variable, and ensure cleanup is robust.
    // A more explicit way is to manage it in a ref and clear it on leaveRoom.
    // Let's create a messagesUnsubscribeRef for this.
    messageUnsubscribeRef.current = unsubscribe;

  }, [socket, addNotification, isAuthReady, db, userId]); // Dependencies

  // Ref to hold the Firestore unsubscribe function
  const messageUnsubscribeRef = useRef<(() => void) | null>(null);

  /**
   * Handle leaving the current room.
   * Cleans up Firestore listener.
   */
  const handleLeaveRoom = useCallback(() => {
    if (roomState.roomId && roomState.username) {
      socket.leaveRoom(roomState.roomId, roomState.username);
    }

    // Unsubscribe from Firestore messages listener if active
    if (messageUnsubscribeRef.current) {
        messageUnsubscribeRef.current();
        messageUnsubscribeRef.current = null;
        console.log('Unsubscribed from Firestore message listener.');
    }

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
  }, [roomState, socket, addNotification]);

  /**
   * Send a message.
   * Now saves messages to Firestore.
   */
  const handleSendMessage = useCallback(async (message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    if (!roomState.isConnected || !socket.socket) {
      addNotification('error', 'Connection Error', 'Not connected to chat room (Socket not ready)');
      return;
    }
    if (!db || !userId) {
      addNotification('error', 'DB Error', 'Database not ready to send message.');
      return;
    }

    // Optimistic update for immediate display (optional but good UX)
    const clientSideMessage: ChatMessage = {
      ...message,
      id: generateClientMessageId(), // Client-side ID
      timestamp: new Date(),
      isSelf: true
    };
    setRoomState(prev => ({
      ...prev,
      messages: [...prev.messages, clientSideMessage]
    }));

    try {
      // Save message to Firestore
      const messagesCollectionRef = collection(db, `artifacts/${__app_id}/public/data/chat_messages`);
      await addDoc(messagesCollectionRef, {
        roomId: message.roomId,
        sender: message.sender,
        content: message.content || null,
        imageData: message.imageData || null,
        messageType: message.messageType,
        timestamp: serverTimestamp() // Use Firestore's server timestamp for consistency
      });
      console.log('Message sent to Firestore:', message);

      // No need to explicitly add to local state again after Firestore confirms,
      // as onSnapshot will handle real-time updates including the newly added message.
      // The optimistic update handles the immediate display.

      // Send via socket (for real-time delivery to other users)
      // Note: Backend should NOT save this message again if it receives it.
      // It should only forward it to other users in the room.
      socket.sendMessage(message);

    } catch (error) {
      console.error('Error saving message to Firestore:', error);
      addNotification('error', 'Send Error', 'Failed to send message.');
      // Revert optimistic update if sending fails
      setRoomState(prev => ({
        ...prev,
        messages: prev.messages.filter(msg => msg.id !== clientSideMessage.id)
      }));
    }
  }, [roomState.isConnected, socket, db, userId, addNotification, generateClientMessageId]);

  const handleTypingStart = useCallback(() => {
    if (roomState.isConnected && socket.socket) {
      socket.sendTypingStatus(roomState.roomId, roomState.username, true);
    }
  }, [roomState, socket]);

  const handleTypingStop = useCallback(() => {
    if (roomState.isConnected && socket.socket) {
      socket.sendTypingStatus(roomState.roomId, roomState.username, false);
    }
  }, [roomState, socket]);

  /**
   * Effect for Socket.IO event listeners.
   * This is separate from Firebase initialization.
   */
  useEffect(() => {
    if (!socket.socket) {
        console.warn('Socket instance not yet available for event listeners.');
        return;
    }

    const unsubscribeRoomJoined = socket.on('room-joined', (data: { roomId: string; participants: string[] }) => {
      console.log('Room joined successfully (Socket):', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: true,
        participants: data.participants
      }));

      // No longer explicitly closing modal or setting isConnecting here,
      // as Firebase data loading might still be in progress.
      // Will rely on a combined check or state updates for full readiness.
      setIsRoomModalOpen(false);
      setIsConnecting(false);

      const systemMessage: ChatMessage = {
        id: generateClientMessageId(),
        roomId: data.roomId,
        sender: 'System',
        content: `You (${username}) joined the chat`, // Display current username
        messageType: 'system',
        timestamp: new Date()
      };
      setRoomState(prev => ({ // Optimistically add system message
        ...prev,
        messages: [...prev.messages, systemMessage]
      }));
    });

    const unsubscribeRoomLeft = socket.on('room-left', (data: { roomId: string; username: string }) => {
      console.log('User left room (Socket):', data);

      if (data.username !== roomState.username) {
        setRoomState(prev => ({
          ...prev,
          participants: prev.participants.filter(p => p !== data.username)
        }));

        const systemMessage: ChatMessage = {
          id: generateClientMessageId(),
          roomId: data.roomId,
          sender: 'System',
          content: `${data.username} left the chat`,
          messageType: 'system',
          timestamp: new Date()
        };
        setRoomState(prev => ({ // Optimistically add system message
          ...prev,
          messages: [...prev.messages, systemMessage]
        }));
      }
    });

    const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
      console.log('Message received (Socket):', message);

      // IF using Firestore as source of truth, DO NOT add messages received via socket
      // if they are *our own* messages (already optimistically added) or
      // if they will be picked up by the Firestore listener anyway.
      // Firestore listener will ensure message order and presence.
      // For simplicity, we filter out messages from our own sender ID as a safety measure.
      if (message.sender === roomState.username) {
         return; // Avoid duplicate if Firestore also delivers it
      }

      // Add to local state only if not from self and Firestore hasn't added it yet (less common for real-time)
      const receivedMessage: ChatMessage = {
        ...message,
        timestamp: new Date(message.timestamp), // Ensure Date object
        isSelf: false
      };
      setRoomState(prev => ({
        ...prev,
        messages: [...prev.messages, receivedMessage]
      }));
    });

    const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
      console.log('Message history received (Socket):', data);
      // This listener might be redundant now that Firestore is handling history.
      // You might choose to use either Socket.IO or Firestore for initial history.
      // If Firestore is primary, this can be removed or used for a fallback.
      // For now, let's keep Firestore as the single source of truth for messages.
    });

    const unsubscribeUserTyping = socket.on('user-typing', (data: { username: string; isTyping: boolean }) => {
      console.log('User typing (Socket):', data);

      if (data.username !== roomState.username) {
        setTypingUser(data.isTyping ? data.username : undefined);
      }
    });

    const unsubscribeConnectionStatus = socket.on('connection-status', (data: { connected: boolean; participantCount: number; username: string }) => {
      console.log('Connection status (Socket):', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: data.connected,
        participants: data.username ? [...new Set([...prev.participants, data.username])] : prev.participants
      }));
    });

    const unsubscribeError = socket.on('error', (data: { message: string }) => {
      console.error('Socket error (Socket):', data);
      addNotification('error', 'Error', data.message);
      setIsConnecting(false);
    });

    // Cleanup function for socket listeners
    return () => {
      unsubscribeRoomJoined();
      unsubscribeRoomLeft();
      unsubscribeMessageReceived();
      unsubscribeMessageHistory();
      unsubscribeUserTyping();
      unsubscribeConnectionStatus();
      unsubscribeError();
    };
  }, [socket.socket, roomState.username, generateClientMessageId, addNotification]); // Dependencies, ensure username is stable

  /**
   * Handles general socket connection errors.
   */
  useEffect(() => {
    if (socket.connectionError) {
      addNotification('error', 'Connection Failed', socket.connectionError);
      setIsConnecting(false);
    }
  }, [socket.connectionError, addNotification]);


  // Cleanup Firestore listener on component unmount
  useEffect(() => {
    return () => {
      if (messageUnsubscribeRef.current) {
        messageUnsubscribeRef.current();
        messageUnsubscribeRef.current = null;
      }
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <RoomJoinModal
        isOpen={isRoomModalOpen}
        onJoinRoom={handleJoinRoom}
        isConnecting={isConnecting}
      />

      {/* Render chat UI only if the room modal is closed and Firebase is ready */}
      {!isRoomModalOpen && isAuthReady && db && userId && (
        <>
          <ChatHeader
            roomId={roomState.roomId}
            isConnected={roomState.isConnected}
            participantCount={roomState.participants.length}
            // onStartVideoCall={webRTC.startCall} // Removed video call related props
            onLeaveRoom={handleLeaveRoom}
          />

          <ChatMessages
            messages={roomState.messages}
            currentUsername={roomState.username}
            typingUser={typingUser}
          />

          <MessageInput
            onSendMessage={handleSendMessage}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            roomId={roomState.roomId}
            username={roomState.username}
            disabled={!roomState.isConnected}
          />

          {/* Removed VideoCallModal and VideoCallOverlay rendering */}
        </>
      )}

      <NotificationToast
        notifications={notifications}
        onDismiss={dismissNotification}
      />
    </div>
  );
}
