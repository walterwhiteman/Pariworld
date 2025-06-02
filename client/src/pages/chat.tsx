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
     * Generate a unique message ID (for temporary client-side use before DB assigns one)
     */
    const generateClientMessageId = (): string => {
        return `client_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

        // Reset messages and participants when joining a new room
        setRoomState(prev => ({
            ...prev,
            roomId,
            username,
            isConnected: false,
            messages: [], // Clear messages before joining to prepare for history
            participants: []
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

        // Create a temporary client-side message with a client-generated ID
        const tempMessage: ChatMessage = {
            ...message,
            id: generateClientMessageId(), // Client-side ID
            timestamp: new Date(),
            isSelf: true
        } as ChatMessage; // Cast to ChatMessage for local state

        // Add to local messages immediately
        setRoomState(prev => ({
            ...prev,
            messages: [...prev.messages, tempMessage]
        }));

        // Send via socket (without client-side ID as DB will generate)
        socket.sendMessage({
            roomId: message.
