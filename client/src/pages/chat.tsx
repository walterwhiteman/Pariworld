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

        // MODIFIED: Send message via socket.emit directly
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
        // MODIFIED: Only set up listeners if socket instance exists AND is connected
        if (!socket || !socketIsConnected) {
            console.log('[ChatPage] Socket not available or not connected, deferring listener setup.');
            return;
        }

        console.log('[ChatPage] Socket is connected, setting up listeners.');

        // Room joined successfully
        const unsubscribeRoomJoined = socket.on('room-joined', (data: { roomId: string; participants: string[] }) => {
            console.log('[Frontend] Room joined successfully:', data);

            setRoomState(prev => ({
                ...prev,
                isConnected: true,
                participants: data.participants
            }));

            setIsRoomModalOpen(false);
            setIsConnecting(false);

            // Add system message for *this* user only
            const systemMessage: ChatMessage = {
                id: generateClientMessageId(), // Use client-side ID for system messages
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
            setRoomState(prev => ({
                ...prev,
                messages: [...prev.messages, message]
            }));
            // Only show notification if it's not our own message
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
            setRoomState(prev => ({
                ...prev,
                messages: data.messages // Populate messages with history
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
            console.log('[ChatPage] Cleaning up socket listeners.');
            // Ensure socket exists before calling off
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
    }, [socket, socketIsConnected, roomState.username, addNotification]); // Added socket and socketIsConnected to dependencies

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
                        onStartVideoCall={handleStartVideoCall} // Pass the video call handler
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
