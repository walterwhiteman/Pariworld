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

    // --- REVISED: handleStartVideoCall function for 1-on-1 testing ---
    const handleStartVideoCall = useCallback(() => {
        if (!roomState.isConnected) {
            addNotification('error', 'Call Error', 'Not connected to room.');
            return;
        }

        // IMPORTANT FOR 1-ON-1: You MUST replace 'OTHER_USER_USERNAME_HERE'
        // with the actual username of another user logged into the same room
        // for this to work. This is a temporary hardcode for testing.
        const userToCall = 'OTHER_USER_USERNAME_HERE'; // <--- REPLACE THIS!

        if (!userToCall || userToCall === roomState.username) {
            addNotification('warning', 'Call Info', 'Please enter a valid username for the other person to call.');
            return;
        }

        // Check if the user to call is actually in the room's participant list
        if (!roomState.participants.includes(userToCall)) {
             addNotification('warning', 'Call Info', `${userToCall} is not currently in this room.`);
             return;
        }

        webRTC.startCall(userToCall);
        console.log(`Attempting to call: ${userToCall}`);
        addNotification('info', 'Calling', `Attempting to call ${userToCall}...`);

    }, [roomState, webRTC, addNotification]);
    // --- END REVISED ---


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
                id: generateClientMessageId(), // Use client-side ID for system messages
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

        // Message History Received
        const unsubscribeMessageHistory = socket.on('message-history', (payload: { roomId: string; messages: ChatMessage[] }) =>
