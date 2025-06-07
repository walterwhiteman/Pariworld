// src/pages/chat.tsx

import { useState, useCallback, useEffect } from 'react';
import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal'; // This component will be updated next
import { NotificationToast } from '@/components/chat/NotificationToast';
import { ImageViewerModal } from '@/components/chat/ImageViewerModal';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC'; // Ensure VideoCallState is exported from useWebRTC if not already

import { ChatMessage, NotificationData, RoomState } from '@/types/chat';

/**
 * Main chat page component that orchestrates the entire chat application
 * Manages room state, messaging, notifications, and video calling
 */
export default function ChatPage() {
    console.log('ChatPage: Rendering component.');

    // Room and user state
    const [roomState, setRoomState] = useState<RoomState>({
        roomId: '',
        username: '', // This will be set once during handleJoinRoom
        isConnected: false,
        participants: [], // This array needs to be kept in sync by the backend
        messages: []
    });

    // UI state
    const [isRoomModalOpen, setIsRoomModalOpen] = useState(true);
    const [isConnecting, setIsConnecting] = useState(false);
    const [typingUser, setTypingUser] = useState<string | undefined>();
    const [notifications, setNotifications] = useState<NotificationData[]>([]);

    // Image Viewer Modal state
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [currentViewingImage, setCurrentViewingImage] = useState<string | null>(null);

    // Hooks
    const socket = useSocket();

    // Determine the recipient for a 1-on-1 call
    // This assumes a 1-on-1 chat context.
    // If there are more than 2 participants, this logic would need to be expanded
    // (e.g., allow selecting a user from a list, and pass that selected user's ID).
    const recipientUsername = roomState.participants.find(
        (p) => p !== roomState.username
    );

    // Pass recipientUsername to useWebRTC hook and destructure new functions
    const {
        callState,
        localVideoRef,
        remoteVideoRef,
        startCall,
        endCall,
        acceptIncomingCall, // <--- NEW: Function to accept an incoming call
        rejectIncomingCall, // <--- NEW: Function to reject an incoming call
        toggleVideo,
        toggleAudio,
        formatCallDuration
    } = useWebRTC(socket, roomState.roomId, roomState.username, recipientUsername);

    // Add this useEffect to track ChatPage's mount/unmount
    useEffect(() => {
        console.log('ChatPage: Component mounted.');
        return () => {
            console.log('ChatPage: Component unmounted.');
        };
    }, []);

    // --- DEBUGGING LOGS: START ---
    // These logs will help you see the state of participants and recipientUsername
    useEffect(() => {
        console.log('ChatPage DEBUG: Current roomState.username:', roomState.username);
        console.log('ChatPage DEBUG: Current roomState.participants:', roomState.participants);
        console.log('ChatPage DEBUG: Calculated recipientUsername:', recipientUsername);
        // Add logs for WebRTC call state
        console.log('ChatPage DEBUG: WebRTC - Call Active:', callState.isActive);
        console.log('ChatPage DEBUG: WebRTC - Incoming Call Offer:', callState.incomingCallOffer ? 'Present' : 'None');
        console.log('ChatPage DEBUG: WebRTC - Incoming Caller:', callState.incomingCallerUsername);
    }, [
        roomState.username,
        roomState.participants,
        recipientUsername,
        callState.isActive,
        callState.incomingCallOffer,
        callState.incomingCallerUsername
    ]);
    // --- DEBUGGING LOGS: END ---


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
     * Handle image click to open in viewer modal
     */
    const handleImageClick = useCallback((imageUrl: string) => {
        setCurrentViewingImage(imageUrl);
        setIsImageViewerOpen(true);
    }, []);

    /**
     * Handle closing the image viewer modal
     */
    const handleCloseImageViewer = useCallback(() => {
        setIsImageViewerOpen(false);
        setCurrentViewingImage(null);
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

        // Clear messages on a fresh join before history loads
        setRoomState(prev => ({
            ...prev,
            roomId,
            username, // <--- This is the primary place where the username is set
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
        if (callState.isActive) {
            console.log('handleLeaveRoom: Ending active video call before leaving room.');
            endCall();
        } else if (callState.incomingCallOffer) { // <--- NEW: Reject incoming call if pending
            console.log('handleLeaveRoom: Rejecting pending incoming call before leaving room.');
            rejectIncomingCall(); // Notify the caller the call was rejected
        }

        // Reset state after leaving the room
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
    }, [roomState, socket, callState.isActive, callState.incomingCallOffer, endCall, rejectIncomingCall, addNotification]); // Updated dependencies for WebRTC state

    /**
     * Send a message
     * No longer performs optimistic UI update for the message itself.
     * Relies on backend's 'message-received' event for display.
     */
    const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp' | 'isSelf'>) => {
        if (!roomState.isConnected) {
            addNotification('error', 'Connection Error', 'Not connected to chat room');
            return;
        }

        // Send only the necessary data to the backend.
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
        console.log('ChatPage: useEffect (Socket Listeners) Mounted.');

        if (!socket.on) {
            console.warn('ChatPage: Socket instance not ready for event listeners.');
            return;
        }

        // Room joined successfully (or updated participant list)
        const unsubscribeRoomJoined = socket.on('room-joined', (data: { roomId: string; participants: string[] }) => {
            console.log('Room joined successfully or participants updated:', data);
            setRoomState(prev => ({
                ...prev,
                isConnected: true,
                participants: data.participants // Backend provides actual participant list
            }));

            setIsRoomModalOpen(false);
            setIsConnecting(false);
        });

        // Handle historical messages from the server
        const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
            console.log('Received message history:', data.messages);
            setRoomState(prev => {
                const historicalMessagesWithSelfFlag = data.messages.map(msg => ({
                    ...msg,
                    timestamp: new Date(msg.timestamp), // Ensure timestamp is a Date object
                    isSelf: msg.sender === prev.username // Mark messages sent by self
                }));

                // Simply replace the messages with historical messages, ensuring correct order
                return {
                    ...prev,
                    messages: historicalMessagesWithSelfFlag.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                };
            });
        });

        // User left room
        const unsubscribeRoomLeft = socket.on('room-left', (data: { roomId: string; username: string }) => {
            console.log('User left room:', data);

            if (data.username !== roomState.username) {
                // NOTE: The backend should now send an updated 'room-joined' event
                // with the new participant list, making this filter potentially redundant
                // if your backend strictly manages participants.
                // However, keeping it doesn't hurt.
                setRoomState(prev => ({
                    ...prev,
                    participants: prev.participants.filter(p => p !== data.username)
                }));
            }
        });

        // Message received (this will handle new messages AND system messages from backend)
        const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
            console.log('Message received:', message);

            setRoomState(prev => {
                // Check if message ID already exists to prevent duplicates
                if (prev.messages.some(msg => msg.id === message.id)) {
                    return prev; // Message already present, do nothing
                }

                const receivedMessage: ChatMessage = {
                    ...message,
                    timestamp: new Date(message.timestamp), // Ensure timestamp is Date object
                    isSelf: message.sender === prev.username
                };

                return {
                    ...prev,
                    messages: [...prev.messages, receivedMessage].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()) // Re-sort to ensure order
                };
            });
        });

        // User typing
        const unsubscribeUserTyping = socket.on('user-typing', (data: { username: string; isTyping: boolean }) => {
            console.log('User typing:', data);

            if (data.username !== roomState.username) {
                setTypingUser(data.isTyping ? data.username : undefined);
            }
        });

        // Connection status (participantCount might update here too)
        const unsubscribeConnectionStatus = socket.on('connection-status', (data: { connected: boolean; participantCount: number, username: string }) => {
            console.log('Connection status:', data);

            setRoomState(prev => {
                // ONLY update isConnected here.
                // DO NOT modify username here as it's set on handleJoinRoom.
                // Rely on 'room-joined' and 'room-left' for participant list changes.
                return {
                    ...prev,
                    isConnected: data.connected,
                    // participantCount: data.participantCount, // Optional, if you want to store this number separately
                };
            });
        });

        // Error handling
        const unsubscribeError = socket.on('error', (data: { message: string }) => {
            console.error('Socket error:', data);

            addNotification('error', 'Error', data.message);
            setIsConnecting(false);
        });

        // Cleanup function for socket listeners
        return () => {
            console.log('ChatPage: useEffect (Socket Listeners) Cleanup - ChatPage is unmounting or dependencies changed.');
            unsubscribeRoomJoined();
            unsubscribeMessageHistory();
            unsubscribeRoomLeft();
            unsubscribeMessageReceived();
            unsubscribeUserTyping();
            unsubscribeConnectionStatus();
            unsubscribeError();
        };
    }, [socket, roomState.username]); // Added roomState.username to dependencies

    /**
     * Handle connection errors from useSocket hook
     */
    useEffect(() => {
        console.log('ChatPage: useEffect (Connection Error) Mounted.');
        if (socket.connectionError) {
            addNotification('error', 'Connection Failed', socket.connectionError);
            setIsConnecting(false);
        }
        return () => {
            console.log('ChatPage: useEffect (Connection Error) Cleanup.');
        }
    }, [socket.connectionError, addNotification]);

    // Handle starting the video call with the recipient
    const handleStartVideoCall = useCallback(() => {
        if (!recipientUsername) {
            addNotification('error', 'Call Error', 'No other user available for a call.');
            console.warn('handleStartVideoCall: No recipient username found.');
            return;
        }
        // Also check if a call is already active or incoming before initiating a new one
        if (callState.isActive) {
            addNotification('info', 'Call in Progress', 'You are already in a call.');
            console.warn('handleStartVideoCall: Call is already active. Cannot start new call.');
            return;
        }
        if (callState.incomingCallOffer) {
             addNotification('info', 'Incoming Call Pending', 'An incoming call is pending. Please accept or reject it first.');
             console.warn('handleStartVideoCall: Incoming call offer is pending. Cannot start new call.');
            return;
        }
        console.log('handleStartVideoCall: Attempting to start call...');
        startCall(); // Call the startCall function from useWebRTC
    }, [recipientUsername, callState.isActive, callState.incomingCallOffer, startCall, addNotification]);


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
                    {/* Chat Header - Make it fixed at the top */}
                    <ChatHeader
                        className="flex-none"
                        roomId={roomState.roomId}
                        isConnected={roomState.isConnected}
                        participantCount={roomState.participants.length}
                        onStartVideoCall={handleStartVideoCall}
                        onLeaveRoom={handleLeaveRoom}
                    />

                    {/* Chat Messages */}
                    <ChatMessages
                        messages={roomState.messages}
                        currentUsername={roomState.username}
                        typingUser={typingUser}
                        onImageClick={handleImageClick}
                    />

                    {/* Message Input - Make it fixed at the bottom */}
                    <MessageInput
                        className="flex-none"
                        onSendMessage={handleSendMessage}
                        onTypingStart={handleTypingStart}
                        onTypingStop={handleTypingStop}
                        roomId={roomState.roomId}
                        username={roomState.username}
                        disabled={!roomState.isConnected}
                    />

                    {/* Video Call Modal */}
                    {/* The modal should be open if a call is active OR if there's an incoming offer */}
                    <VideoCallModal
                        isOpen={callState.isActive || !!callState.incomingCallOffer} {/* <--- MODIFIED: Open if active or incoming */}
                        callState={callState}
                        localVideoRef={localVideoRef}
                        remoteVideoRef={remoteVideoRef}
                        onEndCall={endCall}
                        onToggleVideo={toggleVideo}
                        onToggleAudio={toggleAudio}
                        formatCallDuration={formatCallDuration}
                        onAcceptCall={acceptIncomingCall} // <--- NEW PROP: Pass accept function
                        onRejectCall={rejectIncomingCall} // <--- NEW PROP: Pass reject function
                    />
                </>
            )}

            {/* Notification Toasts */}
            <NotificationToast
                notifications={notifications}
                onDismiss={dismissNotification}
            />

            {/* Image Viewer Modal */}
            <ImageViewerModal
                isOpen={isImageViewerOpen}
                imageUrl={currentViewingImage}
                onClose={handleCloseImageViewer}
            />
        </div>
    );
}
