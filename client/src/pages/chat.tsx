import { useState, useCallback, useEffect, useRef } from 'react';
import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput'; // Corrected: 'from' instead of '=>'
import { NotificationToast } from '@/components/chat/NotificationToast';
import { useSocket } from '@/hooks/useSocket';
import { ChatMessage, NotificationData, RoomState } from '@/types/chat';

/**
 * Main chat page component that orchestrates the entire chat application
 * Manages room state, messaging, notifications, and video calling
 */
export default function ChatPage() {
    console.log('[ChatPage Render] Component rendering...');

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

    // Hooks - useSocket now gets its value from context
    const { socket, isConnected: socketIsConnected, connectionError, joinRoom, leaveRoom, sendMessage, sendTypingStatus, on } = useSocket();

    // Use a ref to store the latest roomState and username for handlers
    const roomStateRef = useRef(roomState);
    useEffect(() => {
        roomStateRef.current = roomState;
    }, [roomState]);

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
    const generateClientMessageId = useCallback((): string => {
        return `client_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }, []);

    /**
     * Join a chat room
     */
    const handleJoinRoom = useCallback((roomId: string, username: string) => {
        console.log(`[ChatPage] handleJoinRoom called with roomId: ${roomId}, username: ${username}. socketIsConnected: ${socketIsConnected}, socket exists: ${!!socket}`);
        if (!socketIsConnected || !socket) {
            addNotification('error', 'Connection Error', 'Unable to connect to chat server');
            return;
        }

        setIsConnecting(true);
        console.log('[ChatPage] Setting isConnecting to true.');

        setRoomState(prev => ({
            ...prev,
            roomId,
            username,
            isConnected: false,
            messages: [],
            participants: []
        }));
        console.log('[ChatPage] Room state reset for new join attempt.');

        joinRoom(roomId, username);
        console.log('[ChatPage] Emitted join-room event.');
    }, [socket, socketIsConnected, joinRoom, addNotification]);

    /**
     * Leave the current room
     */
    const handleLeaveRoom = useCallback(() => {
        console.log(`[ChatPage] handleLeaveRoom called. Current room: ${roomState.roomId}, user: ${roomState.username}`);
        if (roomState.roomId && roomState.username && socket) {
            leaveRoom(roomState.roomId, roomState.username);
            console.log('[ChatPage] Emitted leave-room event.');
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
        console.log('[ChatPage] Resetting all chat states to initial, opening modal.');

        addNotification('info', 'Left Room', 'You have left the chat room');
    }, [roomState, socket, leaveRoom, addNotification]);

    /**
     * Send a message
     */
    const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        if (!roomState.isConnected || !socket) {
            addNotification('error', 'Connection Error', 'Not connected to chat room');
            return;
        }

        sendMessage({
            roomId: message.roomId,
            sender: message.sender,
            content: message.content,
            imageData: message.imageData,
            messageType: message.messageType
        });
        console.log(`[ChatPage] Sent message: ${message.content?.substring(0, 20)}...`);
    }, [roomState.isConnected, socket, sendMessage, addNotification]);

    /**
     * Handle typing start
     */
    const handleTypingStart = useCallback(() => {
        if (roomState.isConnected && socket) {
            sendTypingStatus(roomState.roomId, roomState.username, true);
        }
    }, [roomState, socket, sendTypingStatus]);

    /**
     * Handle typing stop
     */
    const handleTypingStop = useCallback(() => {
        if (roomState.isConnected && socket) {
            sendTypingStatus(roomState.roomId, roomState.username, false);
        }
    }, [roomState, socket, sendTypingStatus]);

    const handleStartVideoCall = useCallback(() => {
        addNotification('info', 'Feature Disabled', 'Video call is temporarily disabled for debugging.');
    }, [addNotification]);


    // Define all event handlers as useCallback functions
    const handleRoomJoined = useCallback((data: { roomId: string; participants: string[] }) => {
        console.log(`[Frontend] Room joined successfully event received. Data:`, data);
        console.log(`[Frontend] Before setting isRoomModalOpen to false, it was: ${isRoomModalOpen}`);

        setRoomState(prev => ({
            ...prev,
            isConnected: true,
            participants: data.participants
        }));

        setIsRoomModalOpen(false);
        setIsConnecting(false);
        console.log('[Frontend] isRoomModalOpen set to false, isConnected set to true.');

        const systemMessage: ChatMessage = {
            id: generateClientMessageId(),
            roomId: data.roomId,
            sender: 'System',
            content: `You have joined the room ${data.roomId}.`,
            messageType: 'system',
            timestamp: new Date().toISOString() // This is a string
        };
        setRoomState(prev => ({
            ...prev,
            messages: [...prev.messages, systemMessage]
        }));
        addNotification('success', 'Room Joined', `Welcome to ${data.roomId}!`);
    }, [isRoomModalOpen, generateClientMessageId, addNotification]);

    const handleMessageReceived = useCallback((message: ChatMessage) => {
        console.log('[Frontend] Message received:', message);
        // Ensure timestamp is handled as a string as it comes from toISOString()
        const parsedMessage = { ...message, timestamp: message.timestamp };

        setRoomState(prev => ({
            ...prev,
            messages: prev.messages.some(msg => msg.id === parsedMessage.id)
                ? prev.messages
                : [...prev.messages, parsedMessage]
        }));
        if (message.sender !== roomStateRef.current.username) {
            addNotification('info', 'New Message', `From ${message.sender} in ${message.roomId}`);
        }
    }, [addNotification]);

    const handleParticipantJoined = useCallback((data: { username: string; roomId: string; participants: string[] }) => {
        console.log('[Frontend] Participant joined:', data);
        setRoomState(prev => ({
            ...prev,
            participants: data.participants
        }));
        addNotification('info', 'Participant Joined', `${data.username} has joined the room.`);
    }, [addNotification]);

    const handleParticipantLeft = useCallback((data: { username: string; roomId: string; participants: string[] }) => {
        console.log('[Frontend] Participant left:', data);
        setRoomState(prev => ({
            ...prev,
            participants: data.participants
        }));
        addNotification('info', 'Participant Left', `${data.username} has left the room.`);
    }, [addNotification]);

    const handleTypingStatus = useCallback((data: { username: string; isTyping: boolean }) => {
        if (data.isTyping && data.username !== roomStateRef.current.username) {
            setTypingUser(data.username);
        } else {
            setTypingUser(undefined);
        }
    }, []);

    const handleMessageHistory = useCallback((data: { messages: ChatMessage[] }) => {
        console.log('[Frontend] Message history received:', data.messages);
        const historyMessages = data.messages.map(msg => ({
            ...msg,
            timestamp: msg.timestamp // Already a string
        }));
        setRoomState(prev => ({
            ...prev,
            messages: historyMessages
        }));
    }, []);

    const handleError = useCallback((error: { message: string }) => {
        console.error('[Frontend] Socket error:', error);
        addNotification('error', 'Socket Error', error.message);
        setIsConnecting(false);
        setRoomState(prev => ({ ...prev, isConnected: false }));
    }, [addNotification]);


    /**
     * Set up socket event listeners
     */
    useEffect(() => {
        console.log(`[ChatPage useEffect] Running effect for listeners. socket: ${!!socket}, socketIsConnected: ${socketIsConnected}`);
        if (!socket || !socketIsConnected) {
            console.log('[ChatPage useEffect] Socket not ready for listeners, deferring setup.');
            return;
        }

        console.log('[ChatPage useEffect] Socket IS ready, setting up listeners.');

        // Log the type of each handler before attaching
        console.log(`[ChatPage useEffect] Type of handleRoomJoined: ${typeof handleRoomJoined}`);
        console.log(`[ChatPage useEffect] Type of handleMessageReceived: ${typeof handleMessageReceived}`);
        console.log(`[ChatPage useEffect] Type of handleParticipantJoined: ${typeof handleParticipantJoined}`);
        console.log(`[ChatPage useEffect] Type of handleParticipantLeft: ${typeof handleParticipantLeft}`);
        console.log(`[ChatPage useEffect] Type of handleTypingStatus: ${typeof handleTypingStatus}`);
        console.log(`[ChatPage useEffect] Type of handleMessageHistory: ${typeof handleMessageHistory}`);
        console.log(`[ChatPage useEffect] Type of handleError: ${typeof handleError}`);
        console.log(`[ChatPage useEffect] Type of 'on' function from useSocket: ${typeof on}`);


        // Attach listeners using the stable useCallback handlers
        const unsubscribeRoomJoined = on('room-joined', handleRoomJoined);
        const unsubscribeMessageReceived = on('message-received', handleMessageReceived);
        const unsubscribeParticipantJoined = on('participant-joined', handleParticipantJoined);
        const unsubscribeParticipantLeft = on('participant-left', handleParticipantLeft);
        const unsubscribeTypingStatus = on('typing-status', handleTypingStatus);
        const unsubscribeRoomHistory = on('message-history', handleMessageHistory);
        const unsubscribeError = on('error', handleError);

        // Cleanup function: unsubscribe from all socket events when component unmounts
        return () => {
            console.log('[ChatPage useEffect] Cleaning up socket listeners.');
            unsubscribeRoomJoined();
            unsubscribeMessageReceived();
            unsubscribeParticipantJoined();
            unsubscribeParticipantLeft();
            unsubscribeTypingStatus();
            unsubscribeRoomHistory();
            unsubscribeError();
        };
    }, [socket, socketIsConnected, on, handleRoomJoined, handleMessageReceived, handleParticipantJoined, handleParticipantLeft, handleTypingStatus, handleMessageHistory, handleError]);


    // Rendered UI
    return (
        <div className="flex flex-col h-screen bg-gray-100">
            {/* Room Join Modal */}
            <RoomJoinModal
                isOpen={isRoomModalOpen}
                onJoin={handleJoinRoom}
                isConnecting={isConnecting}
            />

            {/* Main Chat UI (only visible when connected) */}
            {!isRoomModalOpen && roomState.isConnected && (
                <>
                    <ChatHeader
                        roomName={roomState.roomId}
                        username={roomState.username}
                        participants={roomState.participants}
                        onLeaveRoom={handleLeaveRoom}
                        onStartVideoCall={handleStartVideoCall}
                    />
                    <ChatMessages
                        messages={roomState.messages}
                        currentUsername={roomState.username}
                        typingUser={typingUser}
                    />
                    <MessageInput
                        roomId={roomState.roomId}
                        sender={roomState.username}
                        onSendMessage={handleSendMessage}
                        onTypingStart={handleTypingStart}
                        onTypingStop={handleTypingStop}
                    />
                </>
            )}

            {/* Notification Toasts */}
            <div className="fixed bottom-4 right-4 z-50 space-y-2">
                {notifications.map(notification => (
                    <NotificationToast
                        key={notification.id}
                        notification={notification}
                        onDismiss={dismissNotification}
                    />
                ))}
            </div>
        </div>
    );
}
