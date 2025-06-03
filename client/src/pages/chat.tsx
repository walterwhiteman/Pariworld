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
        messages: [] // This will be populated by history on join
    });

    // UI state
    const [isRoomModalOpen, setIsRoomModalOpen] = useState(true);
    const [isConnecting, setIsConnecting] = useState(false);
    const [typingUser, setTypingUser] = useState<string | undefined>();
    const [notifications, setNotifications] = useState<NotificationData[]>([]);

    // Hooks
    // MODIFIED: Destructure socket instance directly from useSocket
    const { socket, isConnected: socketIsConnected, connectionError } = useSocket();
    // Pass the raw socket instance to useWebRTC
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
     * Generate a unique message ID (for temporary client-side use before DB assigns one)
     * This is primarily for system messages or if optimistic updates are re-introduced carefully.
     */
    const generateClientMessageId = (): string => {
        return `client_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    /**
     * Join a chat room
     */
    const handleJoinRoom = useCallback((roomId: string, username: string) => {
        // MODIFIED: Check socketIsConnected from useSocket hook and ensure socket exists
        if (!socketIsConnected || !socket) {
            addNotification('error', 'Connection Error', 'Unable to connect to chat server');
            return;
        }

        setIsConnecting(true);

        // Reset messages and participants when joining a new room
        setRoomState(prev => ({
            ...prev,
            roomId,
            username,
            isConnected: false,
            messages: [], // Clear messages before joining to prepare for history
            participants: []
        }));

        // MODIFIED: Join room via socket.emit directly
        socket.emit('join-room', { roomId, username });
    }, [socket, socketIsConnected, addNotification]); // Added socket and socketIsConnected to dependencies

    /**
     * Leave the current room
     */
    const handleLeaveRoom = useCallback(() => {
        // MODIFIED: Check if socket instance exists before emitting
        if (roomState.roomId && roomState.username && socket) {
            socket.emit('leave-room', { roomId: roomState.roomId, username: roomState.username });
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
    }, [roomState, socket, webRTC, addNotification]); // Added socket to dependencies

    /**
     * Send a message
     */
    const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        // MODIFIED: Check if socket instance exists before emitting
        if (!roomState.isConnected || !socket) {
            addNotification('error', 'Connection Error', 'Not connected to chat room');
            return;
        }

        // --- FIX FOR DOUBLE MESSAGES: ONLY EMIT, DO NOT ADD TO LOCAL STATE HERE ---
        // Removed the optimistic update. The message will be added to the state
        // when the 'message-received' event comes back from the server (for all clients, including the sender).
        socket.emit('send-message', {
            roomId: message.roomId,
            sender: message.sender,
            content: message.content,
            imageData: message.imageData,
            messageType: message.messageType
        });
    }, [roomState.isConnected, socket, addNotification]); // Added socket to dependencies

    /**
     * Handle typing start
     */
    const handleTypingStart = useCallback(() => {
        // MODIFIED: Check if socket instance exists before emitting
        if (roomState.isConnected && socket) {
            socket.emit('typing-start', { roomId: roomState.roomId, username: roomState.username });
        }
    }, [roomState, socket]); // Added socket to dependencies

    /**
     * Handle typing stop
     */
    const handleTypingStop = useCallback(() => {
        // MODIFIED: Check if socket instance exists before emitting
        if (roomState.isConnected && socket) {
            socket.emit('typing-stop', { roomId: roomState.roomId, username: roomState.username });
        }
    }, [roomState, socket]); // Added socket to dependencies

    // --- REVISED: handleStartVideoCall function for 1-on-1 testing ---
    const handleStartVideoCall = useCallback(() => {
        if (!roomState.isConnected) {
            addNotification('error', 'Call Error', 'Not connected to room.');
            retu
