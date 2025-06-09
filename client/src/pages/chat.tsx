// src/pages/chat.tsx

import { useState, useCallback, useEffect } from 'react';
import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal';
import { NotificationToast } from '@/components/chat/NotificationToast';
import { ImageViewerModal } from '@/components/chat/ImageViewerModal';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';

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

    // Image Viewer Modal state
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [currentViewingImage, setCurrentViewingImage] = useState<string | null>(null);

    // Hooks
    const socket = useSocket();

    const recipientUsername = roomState.participants.find(
        (p) => p !== roomState.username
    );

    const {
        callState,
        localVideoRef,
        remoteVideoRef,
        startCall,
        endCall,
        acceptIncomingCall,
        rejectIncomingCall,
        toggleVideo,
        toggleAudio,
        formatCallDuration
    } = useWebRTC(socket, roomState.roomId, roomState.username, recipientUsername);

    useEffect(() => {
        console.log('ChatPage: Component mounted.');
        return () => {
            console.log('ChatPage: Component unmounted.');
        };
    }, []);

    // --- START: CORRECTED useEffect for Browser Navigation Handling ---
    useEffect(() => {
        // A unique identifier for our controlled history state
        const HISTORY_STATE_ID = 'chat-room-controlled-state';

        // Function to create/replace a dummy history entry
        const createControlledHistoryEntry = () => {
            // Use replaceState to modify the current history entry.
            // This prevents the history stack from growing infinitely and ensures
            // that our controlled state is always the "top" one.
            window.history.replaceState({ id: HISTORY_STATE_ID }, document.title, window.location.href);
            console.log('ChatPage: Replaced history state with controlled dummy entry.');
        };

        // Event listener for browser's popstate (back/forward button presses)
        const handlePopState = (event: PopStateEvent) => {
            console.log('ChatPage: Popstate event detected.');
            // Check if the state being popped is our controlled dummy state.
            // If it is, it means the user pressed back while we were already controlling history.
            if (event.state && event.state.id === HISTORY_STATE_ID) {
                console.log('ChatPage: Browser back button intercepted. Re-creating controlled state.');
                createControlledHistoryEntry(); // Immediately put our controlled state back
            } else {
                // This scenario means the user is trying to navigate truly back
                // to a page *before* our controlled state (e.g., from an external link
                // or a previous route not managed by this effect).
                // We still want to prevent them from leaving this tab.
                console.warn('ChatPage: Popstate event for non-controlled state. User might be truly navigating away. Preventing.');
                createControlledHistoryEntry(); // Re-establish our controlled state to keep them here.
            }
        };

        // On component mount, ensure our controlled history entry exists.
        // Use setTimeout to ensure it runs *after* any initial history pushes by routing libraries
        // or the browser's default behavior, ensuring we're setting the state at the right "top".
        const timeoutId = setTimeout(() => {
            createControlledHistoryEntry();
        }, 0);


        // Add the event listener for popstate
        window.addEventListener('popstate', handlePopState);

        // Cleanup function: remove the event listener and clear timeout when the component unmounts
        return () => {
            clearTimeout(timeoutId); // Clear any pending setTimeout
            console.log('ChatPage: Cleaning up popstate listener.');
            window.removeEventListener('popstate', handlePopState);
            // Optional: If you want to "clean" the history when the user legitimately leaves your app
            // (e.g., by clicking an in-app "Leave Room" button that navigates them away),
            // you might want to replace the state with a null or simple entry here.
            // For now, we'll assume the component unmounts when the app is closed or navigated away externally.
        };
    }, []); // Empty dependency array, runs once on mount
    // --- END: CORRECTED useEffect for Browser Navigation Handling ---


    useEffect(() => {
        console.log('ChatPage DEBUG: Current roomState.username:', roomState.username);
        console.log('ChatPage DEBUG: Current roomState.participants:', roomState.participants);
        console.log('ChatPage DEBUG: Calculated recipientUsername:', recipientUsername);
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

    const dismissNotification = useCallback((id: string) => {
        setNotifications(prev => prev.filter(n => n.id !== id));
    }, []);

    const handleImageClick = useCallback((imageUrl: string) => {
        setCurrentViewingImage(imageUrl);
        setIsImageViewerOpen(true);
    }, []);

    const handleCloseImageViewer = useCallback(() => {
        setIsImageViewerOpen(false);
        setCurrentViewingImage(null);
    }, []);

    const handleJoinRoom = useCallback((roomId: string, username: string) => {
        // This is the updated logic from useSocket.ts now, not handled directly here for consistency
        // but the notification for connection error is still useful.
        if (!socket.isConnected && !socket.socket?.io.reconnecting) {
             addNotification('error', 'Connection Error', 'Unable to connect to chat server. Trying to reconnect...');
        }

        setIsConnecting(true);
        setRoomState(prev => ({
            ...prev,
            roomId,
            username,
            isConnected: false, // Will be set to true by socket.on('room-joined')
            messages: []
        }));
        socket.joinRoom(roomId, username);
    }, [socket, addNotification]);


    const handleLeaveRoom = useCallback(() => {
        if (roomState.roomId && roomState.username) {
            socket.leaveRoom(roomState.roomId, roomState.username);
        }
        if (callState.isActive) {
            console.log('handleLeaveRoom: Ending active video call before leaving room.');
            endCall();
        } else if (callState.incomingCallOffer) {
            console.log('handleLeaveRoom: Rejecting pending incoming call before leaving room.');
            rejectIncomingCall();
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
    }, [roomState, socket, callState.isActive, callState.incomingCallOffer, endCall, rejectIncomingCall, addNotification]);

    const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp' | 'isSelf'>) => {
        if (!roomState.isConnected) {
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
    }, [roomState.isConnected, socket, addNotification]);

    const handleTypingStart = useCallback(() => {
        if (roomState.isConnected) {
            socket.sendTypingStatus(roomState.roomId, roomState.username, true);
        }
    }, [roomState, socket]);

    const handleTypingStop = useCallback(() => {
        if (roomState.isConnected) {
            socket.sendTypingStatus(roomState.roomId, roomState.username, false);
        }
    }, [roomState, socket]);

    useEffect(() => {
        console.log('ChatPage: useEffect (Socket Listeners) Mounted.');
        if (!socket.on) {
            console.warn('ChatPage: Socket instance not ready for event listeners.');
            return;
        }
        const unsubscribeRoomJoined = socket.on('room-joined', (data: { roomId: string; participants: string[] }) => {
            console.log('Room joined successfully or participants updated:', data);
            setRoomState(prev => ({
                ...prev,
                isConnected: true,
                participants: data.participants
            }));
            setIsRoomModalOpen(false);
            setIsConnecting(false);
        });
        const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
            console.log('Received message history:', data.messages);
            setRoomState(prev => {
                const historicalMessagesWithSelfFlag = data.messages.map(msg => ({
                    ...msg,
                    timestamp: new Date(msg.timestamp),
                    isSelf: msg.sender === prev.username
                }));
                return {
                    ...prev,
                    messages: historicalMessagesWithSelfFlag.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                };
            });
        });
        const unsubscribeRoomLeft = socket.on('room-left', (data: { roomId: string; username: string }) => {
            console.log('User left room:', data);
            if (data.username !== roomState.username) {
                setRoomState(prev => ({
                    ...prev,
                    participants: prev.participants.filter(p => p !== data.username)
                }));
            }
        });
        const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
            console.log('Message received:', message);
            setRoomState(prev => {
                if (prev.messages.some(msg => msg.id === message.id)) {
                    return prev;
                }
                const receivedMessage: ChatMessage = {
                    ...message,
                    timestamp: new Date(message.timestamp),
                    isSelf: message.sender === prev.username
                };
                return {
                    ...prev,
                    messages: [...prev.messages, receivedMessage].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                };
            });
        });
        const unsubscribeUserTyping = socket.on('user-typing', (data: { username: string; isTyping: boolean }) => {
            console.log('User typing:', data);
            if (data.username !== roomState.username) {
                setTypingUser(data.isTyping ? data.username : undefined);
            }
        });
        const unsubscribeConnectionStatus = socket.on('connection-status', (data: { connected: boolean; participantCount: number, username: string }) => {
            console.log('Connection status:', data);
            setRoomState(prev => {
                return {
                    ...prev,
                    isConnected: data.connected,
                };
            });
        });
        const unsubscribeError = socket.on('error', (data: { message: string }) => {
            console.error('Socket error:', data);
            addNotification('error', 'Error', data.message);
            setIsConnecting(false);
        });
        return () => {
            console.log('ChatPage: useEffect (Socket Listeners) Cleanup - ChatPage is unmounting or dependencies changed.');
            unsubscribeRoomJoined();
            unsubscribeMessageHistory();
            unsubscribeRoomLeft();
            // --- FIX APPLIED HERE ---
            unsubscribeMessageReceived(); // Corrected from unsubscribeRoomReceived()
            // --- END FIX ---
            unsubscribeUserTyping();
            unsubscribeConnectionStatus();
            unsubscribeError();
        };
    }, [socket, roomState.username]);

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

    const handleStartVideoCall = useCallback(() => {
        if (!recipientUsername) {
            addNotification('error', 'Call Error', 'No other user available for a call.');
            console.warn('handleStartVideoCall: No recipient username found.');
            return;
        }
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
        startCall();
    }, [recipientUsername, callState.isActive, callState.incomingCallOffer, startCall, addNotification]);

    return (
        // Outermost container: Full height, flex column, hide overflow to ensure scrolling is inside.
        <div className="flex h-screen flex-col bg-gray-50 overflow-hidden">
            {/* Room Join Modal */}
            <RoomJoinModal
                isOpen={isRoomModalOpen}
                onJoinRoom={handleJoinRoom}
                isConnecting={isConnecting}
            />

            {/* Main Chat Interface */}
            {!isRoomModalOpen && (
                <>
                    {/* Chat Header - Fixed at the top */}
                    <ChatHeader
                        // Apply fixed positioning classes directly here
                        className="fixed top-0 left-0 right-0 z-10"
                        roomId={roomState.roomId}
                        isConnected={roomState.isConnected}
                        participantCount={roomState.participants.length}
                        onStartVideoCall={handleStartVideoCall}
                        onLeaveRoom={handleLeaveRoom}
                    />

                    {/* Chat Messages Area - This is the scrollable part */}
                    <ChatMessages
                        // flex-grow: Takes up remaining vertical space
                        // overflow-y-auto: Enables vertical scrolling
                        // pt-[68.8px]: Set padding-top based on the header's calculated height from code
                        // pb-[96px]: Adds bottom padding to clear the fixed message input
                        // px-4: Adds horizontal padding to prevent messages from touching the sides
                        className="flex-grow overflow-y-auto pt-[68.8px] pb-[96px] px-4" // Corrected: Added px-4
                        messages={roomState.messages}
                        currentUsername={roomState.username}
                        typingUser={typingUser}
                        onImageClick={handleImageClick}
                    />

                    {/* Message Input - Fixed at the bottom */}
                    <MessageInput
                        // Apply fixed positioning classes directly here
                        className="fixed bottom-0 left-0 right-0 z-10"
                        onSendMessage={handleSendMessage}
                        onTypingStart={handleTypingStart}
                        onTypingStop={handleTypingStop}
                        roomId={roomState.roomId}
                        username={roomState.username}
                        disabled={!roomState.isConnected}
                    />

                    {/* Video Call Modal */}
                    <VideoCallModal
                        isOpen={callState.isActive || !!callState.incomingCallOffer}
                        callState={callState}
                        localVideoRef={localVideoRef}
                        remoteVideoRef={remoteVideoRef}
                        onEndCall={endCall}
                        onToggleVideo={toggleVideo}
                        onToggleAudio={toggleAudio}
                        formatCallDuration={formatCallDuration}
                        onAcceptCall={acceptIncomingCall}
                        onRejectCall={rejectIncomingCall}
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
