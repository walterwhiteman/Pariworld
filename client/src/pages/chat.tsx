import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { NotificationToast } from '@/components/chat/NotificationToast';
import { useSocket } from '@/hooks/useSocket';
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

  const [location] = useLocation();

  const socket = useSocket();

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
      if (!app) {
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'; // Use default if not provided

        // DIAGNOSTIC LOG: Log the config being used
        console.log('Firebase Config being used:', firebaseConfig);
        console.log('App ID being used:', appId);
        console.log('Initial Auth Token present:', initialAuthToken ? 'Yes' : 'No');

        firebaseAppInstance = initializeApp(firebaseConfig);
        firestoreDbInstance = getFirestore(firebaseAppInstance);
        authInstance = getAuth(firebaseAppInstance);

        setApp(firebaseAppInstance);
        setDb(firestoreDbInstance);
        setAuth(authInstance);

        if (initialAuthToken) {
          signInWithCustomToken(authInstance, initialAuthToken)
            .then((userCredential) => {
              console.log('Firebase signed in with custom token:', userCredential.user.uid);
              setUserId(userCredential.user.uid);
              setIsAuthReady(true);
            })
            .catch((error) => {
              console.error('Error signing in with custom token, falling back to anonymous:', error);
              signInAnonymously(authInstance)
                .then((anonUserCredential) => {
                  console.log('Firebase signed in anonymously:', anonUserCredential.user.uid);
                  setUserId(anonUserCredential.user.uid);
                  setIsAuthReady(true);
                })
                .catch((anonError) => {
                  console.error('Error signing in anonymously (fallback failed):', anonError);
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
      // More specific error message for Firebase config
      if (error instanceof Error && error.message.includes("projectId")) {
        addNotification('error', 'Firebase Config Error', 'Firebase "projectId" is missing or invalid.');
      } else {
        addNotification('error', 'Firebase Error', 'Failed to initialize Firebase.');
      }
    }
  }, [addNotification, app]);

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
    // Ensure __app_id is used for the collection path as per security rules
    const currentAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    const messagesCollectionRef = collection(db, `artifacts/${currentAppId}/public/data/chat_messages`);
    const q = query(
      messagesCollectionRef,
      // Temporarily removed orderBy and limit to fetch all for in-memory sorting
      // This is a workaround for typical Firestore index requirements on complex queries in Canvas.
    );

    // Attach real-time listener for messages
    const unsubscribe = onSnapshot(q, (snapshot) => {
        const newMessages: ChatMessage[] = [];
        snapshot.docs.forEach((doc: QueryDocumentSnapshot<DocumentData>) => {
            const data = doc.data();
            // Filter messages for the specific room in memory
            if (data.roomId === roomId) {
                newMessages.push({
                    id: doc.id, // Use Firestore's generated ID
                    roomId: data.roomId,
                    sender: data.sender,
                    content: data.content,
                    imageData: data.imageData,
                    messageType: data.messageType || 'text',
                    timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
                    isSelf: data.sender === username
                });
            }
        });
        // Sort messages by timestamp in memory
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

    messageUnsubscribeRef.current = unsubscribe;

  }, [socket, addNotification, isAuthReady, db, userId, location]); // Added location to dependencies for completeness

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

    // Optimistic update for immediate display
    const clientSideMessage: ChatMessage = {
      ...message,
      id: generateClientMessageId(),
      timestamp: new Date(),
      isSelf: true
    };
    setRoomState(prev => ({
      ...prev,
      messages: [...prev.messages, clientSideMessage]
    }));

    try {
      const currentAppId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const messagesCollectionRef = collection(db, `artifacts/${currentAppId}/public/data/chat_messages`);
      await addDoc(messagesCollectionRef, {
        roomId: message.roomId,
        sender: message.sender,
        content: message.content || null,
        imageData: message.imageData || null,
        messageType: message.messageType,
        timestamp: serverTimestamp()
      });
      console.log('Message sent to Firestore:', message);

      socket.sendMessage(message);

    } catch (error) {
      console.error('Error saving message to Firestore:', error);
      addNotification('error', 'Send Error', 'Failed to send message.');
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

      setIsRoomModalOpen(false);
      setIsConnecting(false);

      const systemMessage: ChatMessage = {
        id: generateClientMessageId(),
        roomId: data.roomId,
        sender: 'System',
        content: `You (${roomState.username}) joined the chat`, // Use roomState.username
        messageType: 'system',
        timestamp: new Date()
      };
      setRoomState(prev => ({
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
        setRoomState(prev => ({
          ...prev,
          messages: [...prev.messages, systemMessage]
        }));
      }
    });

    const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
      console.log('Message received (Socket):', message);

      if (message.sender === roomState.username) {
         return;
      }

      const receivedMessage: ChatMessage = {
        ...message,
        timestamp: new Date(message.timestamp),
        isSelf: false
      };
      setRoomState(prev => ({
        ...prev,
        messages: [...prev.messages, receivedMessage]
      }));
    });

    const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
      console.log('Message history received (Socket - might be redundant with Firestore):', data);
      // This listener might be redundant now that Firestore is handling history.
      // Keeping it here won't hurt, but Firestore is the source of truth.
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
  }, [socket.socket, roomState.username, generateClientMessageId, addNotification]);

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
        </>
      )}

      <NotificationToast
        notifications={notifications}
        onDismiss={dismissNotification}
      />
    </div>
  );
}
