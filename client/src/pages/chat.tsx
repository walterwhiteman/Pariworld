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

        // --- NEW: Message History Received ---
        const unsubscribeMessageHistory = socket.on('message-history', (payload: { roomId: string; messages: ChatMessage[] }) => {
            console.log('Received message history:', payload.messages.length, 'messages');
            const historyMessages = payload.messages.map(msg => ({
                ...msg,
                timestamp: new Date(msg.timestamp) // Ensure Date object
            }));
            setRoomState(prev => ({
                ...prev,
                messages: historyMessages // Set messages from history
            }));
        });
        // --- END NEW ---

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
                    id: generateClientMessageId(), // Use client-side ID for system messages
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

            // Ensure message timestamp is a Date object if coming from server as ISO string
            const parsedMessage = { ...message, timestamp: new Date(message.timestamp) };

            setRoomState(prev => ({
                ...prev,
                messages: prev.messages.some(msg => msg.id === parsedMessage.id)
                    ? prev.messages // If message with this ID already exists (e.g., from history), don't add duplicate
                    : [...prev.messages, parsedMessage]
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
        const unsubscribeConnectionStatus = socket.on('connection-status', (data: { connected: boolean; participantCount: number }) => {
            console.log('Connection status:', data);

            setRoomState(prev => ({
                ...prev,
                isConnected: data.connected,
                participants: prev.participants // Keep current participants, this event is more for general status
            }));
        });

        // Error handling
        const unsubscribeError = socket.on('error', (data: { message: string }) => {
            console.error('Socket error:', data);

            addNotification('error', 'Error', data.message);
            setIsConnecting(false);
        });

        // Cleanup function
        return () => {
            unsubscribeRoomJoined();
            unsubscribeMessageHistory(); // Clean up history listener
            unsubscribeRoomLeft();
            unsubscribeMessageReceived();
            unsubscribeUserTyping();
            unsubscribeConnectionStatus();
            unsubscribeError();
        };
    }, [socket, roomState.username]); // Removed addNotification to prevent infinite loop

    /**
     * Handle connection errors
     */
    useEffect(() => {
        if (socket.connectionError) {
            addNotification('error', 'Connection Failed', socket.connectionError);
            setIsConnecting(false);
        }
    }, [socket.connectionError]); // Removed addNotification to prevent infinite loop

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
                </>
            )}

            {/* Video Call Modal */}
            <VideoCallModal
                isOpen={webRTC.callState.isActive}
                callState={webRTC.callState}
                localVideoRef={webRTC.localVideoRef}
                remoteVideoRef={webRTC.remoteVideoRef}
                onEndCall={webRTC.endCall}
                onToggleVideo={webRTC.toggleVideo}
                onToggleAudio={webRTC.toggleAudio}
                formatCallDuration={webRTC.formatCallDuration}
            />

            {/* Notifications */}
            <NotificationToast
                notifications={notifications}
                onDismiss={dismissNotification}
            />
        </div>
    );
}
