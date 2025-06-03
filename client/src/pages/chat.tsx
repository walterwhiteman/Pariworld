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
    const { socket, isConnected: socketIsConnected, connectionError } = useSocket();
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
        console.log(`[ChatPage] handleJoinRoom called with roomId: ${roomId}, username: ${username}. socketIsConnected: ${socketIsConnected}, socket exists: ${!!socket}`);
        if (!socketIsConnected || !socket) {
            addNotification('error', 'Connection Error', 'Unable to connect to chat server');
            return;
        }

        setIsConnecting(true);
        console.log('[ChatPage] Setting isConnecting to true.');

        // Reset messages and participants when joining a new room
        setRoomState(prev => ({
            ...prev,
            roomId,
            username,
            isConnected: false, // Ensure this is false before emitting join
            messages: [], // Clear messages before joining to prepare for history
            participants: []
        }));
        console.log('[ChatPage] Room state reset for new join attempt.');

        socket.joinRoom(roomId, username); // Use the joinRoom function from useSocket
        console.log('[ChatPage] Emitted join-room event.');
    }, [socket, socketIsConnected, addNotification]);

    /**
     * Leave the current room
     */
    const handleLeaveRoom = useCallback(() => {
        console.log(`[ChatPage] handleLeaveRoom called. Current room: ${roomState.roomId}, user: ${roomState.username}`);
        if (roomState.roomId && roomState.username && socket) {
            socket.leaveRoom(roomState.roomId, roomState.username); // Use the leaveRoom function from useSocket
            console.log('[ChatPage] Emitted leave-room event.');
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
        console.log('[ChatPage] Resetting all chat states to initial, opening modal.');

        addNotification('info', 'Left Room', 'You have left the chat room');
    }, [roomState, socket, webRTC, addNotification]);

    /**
     * Send a message
     */
    const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        if (!roomState.isConnected || !socket) {
            addNotification('error', 'Connection Error', 'Not connected to chat room');
            return;
        }

        socket.sendMessage({
            roomId: message.roomId,
            sender: message.sender,
            content: message.content,
            imageData: message.imageData,
            messageType: message.messageType
        });
        console.log(`[ChatPage] Sent message: ${message.content?.substring(0, 20)}...`);
    }, [roomState.isConnected, socket, addNotification]);

    /**
     * Handle typing start
     */
    const handleTypingStart = useCallback(() => {
        if (roomState.isConnected && socket) {
            socket.sendTypingStatus(roomState.roomId, roomState.username, true);
        }
    }, [roomState, socket]);

    /**
     * Handle typing stop
     */
    const handleTypingStop = useCallback(() => {
        if (roomState.isConnected && socket) {
            socket.sendTypingStatus(roomState.roomId, roomState.username, false);
        }
    }, [roomState, socket]);

    const handleStartVideoCall = useCallback(() => {
        if (!roomState.isConnected) {
            addNotification('error', 'Call Error', 'Not connected to room.');
            return;
        }

        const userToCall = 'OTHER_USER_USERNAME_HERE';

        if (!userToCall || userToCall === roomState.username) {
            addNotification('warning', 'Call Info', 'Please enter a valid username for the other person to call.');
            return;
        }

        if (!roomState.participants.includes(userToCall)) {
             addNotification('warning', 'Call Info', `${userToCall} is not currently in this room.`);
             return;
        }

        webRTC.startCall(userToCall);
        console.log(`[ChatPage] Attempting to call: ${userToCall}`);
        addNotification('info', 'Calling', `Attempting to call ${userToCall}...`);

    }, [roomState, webRTC, addNotification]);


    /**
     * Set up socket event listeners
     */
    useEffect(() => {
        console.log(`[ChatPage useEffect] Running effect. socket: ${!!socket}, socketIsConnected: ${socketIsConnected}, isRoomModalOpen: ${isRoomModalOpen}`);
        if (!socket || !socketIsConnected) {
            console.log('[ChatPage useEffect] Socket not ready, deferring listener setup.');
            return;
        }

        console.log('[ChatPage useEffect] Socket IS ready, setting up listeners.');

        // Room joined successfully
        const unsubscribeRoomJoined = socket.on('room-joined', (data: { roomId: string; participants: string[] }) => {
            console.log(`[Frontend] Room joined successfully event received. Data:`, data);
            console.log(`[Frontend] Before setting isRoomModalOpen to false, it was: ${isRoomModalOpen}`);

            setRoomState(prev => ({
                ...prev,
                isConnected: true,
                participants: data.participants
            }));

            setIsRoomModalOpen(false); // THIS IS THE LINE THAT CLOSES THE MODAL
            setIsConnecting(false);
            console.log('[Frontend] isRoomModalOpen set to false, isConnected set to true.');

            // Add system message for *this* user only
            const systemMessage: ChatMessage = {
                id: generateClientMessageId(),
                roomId: data.roomId,
                sender: 'System',
                content: `You have joined the room ${data.roomId}.`,
                messageType: 'system',
                timestamp: new Date().toISOString()
            };
            setRoomState(prev => ({
                ...prev,
                messages: [...prev.messages, systemMessage]
            }));
            addNotification('success', 'Room Joined', `Welcome to ${data.roomId}!`);
        });

        // Listen for incoming messages
        const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
            console.log('[Frontend] Message received:', message);
            const parsedMessage = { ...message, timestamp: new Date(message.timestamp) };

            setRoomState(prev => ({
                ...prev,
                messages: prev.messages.some(msg => msg.id === parsedMessage.id)
                    ? prev.messages
                    : [...prev.messages, parsedMessage]
            }));
            if (message.sender !== roomState.username) {
                addNotification('info', 'New Message', `From ${message.sender} in ${message.roomId}`);
            }
        });

        // Listen for participant joined events
        const unsubscribeParticipantJoined = socket.on('participant-joined', (data: { username: string; roomId: string; participants: string[] }) => {
            console.log('[Frontend] Participant joined:', data);
            setRoomState(prev => ({
                ...prev,
                participants: data.participants
            }));
            addNotification('info', 'Participant Joined', `${data.username} has joined the room.`);
        });

        // Listen for participant left events
        const unsubscribeParticipantLeft = socket.on('participant-left', (data: { username: string; roomId: string; participants: string[] }) => {
            console.log('[Frontend] Participant left:', data);
            setRoomState(prev => ({
                ...prev,
                participants: data.participants
            }));
            addNotification('info', 'Participant Left', `${data.username} has left the room.`);
        });

        // Listen for typing status updates
        const unsubscribeTypingStatus = socket.on('typing-status', (data: { username: string; isTyping: boolean }) => {
            if (data.isTyping && data.username !== roomState.username) {
                setTypingUser(data.username);
            } else {
                setTypingUser(undefined);
            }
        });

        // Listen for message history (when joining a room)
        const unsubscribeRoomHistory = socket.on('message-history', (data: { messages: ChatMessage[] }) => {
            console.log('[Frontend] Message history received:', data.messages);
            const historyMessages = data.messages.map(msg => ({
                ...msg,
                timestamp: new Date(msg.timestamp)
            }));
            setRoomState(prev => ({
                ...prev,
                messages: historyMessages
            }));
        });

        // Listen for general socket errors
        const unsubscribeError = socket.on('error', (error: { message: string }) => {
            console.error('[Frontend] Socket error:', error);
            addNotification('error', 'Socket Error', error.message);
            setIsConnecting(false);
            setRoomState(prev => ({ ...prev, isConnected: false }));
        });

        // Cleanup function: unsubscribe from all socket events when component unmounts
        return () => {
            console.log('[ChatPage useEffect] Cleaning up socket listeners.');
            if (socket) {
                unsubscribeRoomJoined();
                unsubscribeMessageReceived();
                unsubscribeParticipantJoined();
                unsubscribeParticipantLeft();
                unsubscribeTypingStatus();
                unsubscribeRoomHistory();
                unsubscribeError();
            }
        };
    }, [socket, socketIsConnected, roomState.username, addNotification, isRoomModalOpen]); // Added isRoomModalOpen to dependencies
    // Note: Adding isRoomModalOpen to dependencies will re-run the effect if modal state changes.
    // This is for debugging the sequence, might need adjustment later for optimal performance.

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

            {/* Video Call Modal */}
            <VideoCallModal
                isOpen={webRTC.callState.isModalOpen}
                onClose={webRTC.closeCallModal}
                localStream={webRTC.callState.localStream}
                remoteStream={webRTC.callState.remoteStream}
                callStatus={webRTC.callState.status}
                onAcceptCall={webRTC.acceptCall}
                onEndCall={webRTC.endCall}
                callingUser={webRTC.callState.callingUser}
            />

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
