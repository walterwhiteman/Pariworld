// src/pages/chat.tsx

import { useState, useCallback, useEffect, useRef } from 'react';
import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal';
import { NotificationToast } from '@/components/chat/NotificationToast';
import { ImageViewerModal } from '@/components/chat/ImageViewerModal';
import { useSocket } from '@/hooks/useSocket'; // Use the new useSocket from your context
import { useWebRTC } from '@/hooks/useWebRTC'; // Make sure useWebRTC also uses the new useSocket

// NEW: Import SocketEvents from types/chat.ts
import { ChatMessage, NotificationData, RoomState, SocketEvents } from '@/types/chat';

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

    // Refs for messages to track visibility for "seen" status
    const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const observer = useRef<IntersectionObserver | null>(null);
    const observerRootRef = useRef<HTMLDivElement>(null); // Ref for the scrollable container

    // Hooks
    const socket = useSocket(); // Consume the socket context

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
    } = useWebRTC(socket, roomState.roomId, roomState.username, recipientUsername); // Pass the new socket from context

    useEffect(() => {
        console.log('ChatPage: Component mounted.');
        return () => {
            console.log('ChatPage: Component unmounted.');
            // Disconnect observer on unmount
            if (observer.current) {
                observer.current.disconnect();
            }
        };
    }, []);

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
        // Use socket.isConnected from the context hook
        if (!socket.isConnected) {
            addNotification('error', 'Connection Error', 'Unable to connect to chat server');
            return;
        }
        setIsConnecting(true);
        setRoomState(prev => ({
            ...prev,
            roomId,
            username,
            isConnected: false,
            messages: []
        }));
        socket.joinRoom(roomId, username); // Call method from context
    }, [socket, addNotification]);

    const handleLeaveRoom = useCallback(() => {
        if (roomState.roomId && roomState.username) {
            socket.leaveRoom(roomState.roomId, roomState.username); // Call method from context
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

    const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp' | 'isSelf' | 'status'>) => {
        if (!socket.isConnected) { // Use socket.isConnected from the context hook
            addNotification('error', 'Connection Error', 'Not connected to chat room');
            return;
        }

        // Assign unique ID and initial status 'sent' immediately
        const newMessage: ChatMessage = {
            id: crypto.randomUUID(), // Generate a unique ID for the message
            roomId: message.roomId,
            sender: message.sender,
            content: message.content,
            imageData: message.imageData,
            messageType: message.messageType,
            timestamp: new Date(),
            isSelf: true,
            status: 'sent' // Set initial status to 'sent'
        };

        setRoomState(prev => ({
            ...prev,
            messages: [...prev.messages, newMessage].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
        }));

        // Send the full message object including ID and status to the server
        socket.sendMessage(newMessage); // Call method from context
    }, [socket, addNotification]); // Dependency on socket and addNotification

    const handleTypingStart = useCallback(() => {
        if (socket.isConnected) { // Use socket.isConnected from the context hook
            socket.sendTypingStatus(roomState.roomId, roomState.username, true); // Call method from context
        }
    }, [roomState, socket]);

    const handleTypingStop = useCallback(() => {
        if (socket.isConnected) { // Use socket.isConnected from the context hook
            socket.sendTypingStatus(roomState.roomId, roomState.username, false); // Call method from context
        }
    }, [roomState, socket]);

    // Callback to get message element refs from ChatMessages component
    const handleMessageRender = useCallback((messageId: string, element: HTMLDivElement | null) => {
        if (element) {
            messageRefs.current.set(messageId, element);
            // Attach data-message-id for easy lookup by IntersectionObserver
            element.setAttribute('data-message-id', messageId);
            // If observer exists, observe the new element
            if (observer.current) {
                observer.current.observe(element);
            }
        } else {
            // Clean up old element reference if it's unmounting
            if (messageRefs.current.has(messageId) && observer.current) {
                const elementToUnobserve = messageRefs.current.get(messageId);
                if (elementToUnobserve) {
                    observer.current.unobserve(elementToUnobserve);
                }
            }
            messageRefs.current.delete(messageId);
        }
    }, []);

    // Effect for IntersectionObserver to detect "seen" messages
    useEffect(() => {
        // Only initialize observer if chat is active (not in modal) and currentUsername exists
        // and the root element for the observer is available
        if (!isRoomModalOpen && roomState.username && observerRootRef.current) {
            const handleIntersection = (entries: IntersectionObserverEntry[]) => {
                const messagesToMarkSeen: { messageId: string; roomId: string; username: string }[] = [];

                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const messageElement = entry.target as HTMLDivElement;
                        const messageId = messageElement.dataset.messageId;

                        if (messageId) {
                            const message = roomState.messages.find(msg => msg.id === messageId);

                            // Mark as seen only if it's not sent by current user and status is not already 'seen'
                            if (message && !message.isSelf && message.status !== 'seen') {
                                messagesToMarkSeen.push({
                                    messageId: message.id,
                                    roomId: message.roomId,
                                    username: roomState.username
                                });
                                // Optimistically update local state to reflect seen status immediately
                                setRoomState(prev => ({
                                    ...prev,
                                    messages: prev.messages.map(msg =>
                                        msg.id === message.id ? { ...msg, status: 'seen' } : msg
                                    )
                                }));
                                // Stop observing this message
                                observer.current?.unobserve(messageElement);
                            }
                        }
                    }
                });

                if (messagesToMarkSeen.length > 0) {
                    // Emit a single event for all seen messages
                    socket.emitMessagesSeen(messagesToMarkSeen); // Call method from context
                }
            };

            // Disconnect existing observer if it exists
            if (observer.current) {
                observer.current.disconnect();
            }

            observer.current = new IntersectionObserver(handleIntersection, {
                root: observerRootRef.current, // Use the ref for the scrollable container
                rootMargin: '0px',
                threshold: 0.5 // Message is considered "seen" when 50% of it is visible
            });

            // Observe all messages currently in messageRefs
            messageRefs.current.forEach(element => {
                if (element) {
                    observer.current!.observe(element);
                }
            });

        } else if (observer.current) {
            // Disconnect observer if modal is open or username is not set, or root element is not ready
            observer.current.disconnect();
            observer.current = null;
        }

        // Cleanup observer on component unmount or when dependencies change
        return () => {
            if (observer.current) {
                observer.current.disconnect();
            }
        };
    }, [isRoomModalOpen, roomState.username, roomState.messages, socket, observerRootRef]); // Dependencies

    // Clean up old refs not present in current messages (important for performance)
    useEffect(() => {
        const currentMessageIds = new Set(roomState.messages.map(msg => msg.id));
        messageRefs.current.forEach((_val, key) => {
            if (!currentMessageIds.has(key)) {
                messageRefs.current.delete(key);
            }
        });
    }, [roomState.messages]);


    useEffect(() => {
        console.log('ChatPage: useEffect (Socket Listeners) Mounted.');
        // Ensure socket object is available before setting up listeners
        if (!socket.on) {
            console.warn('ChatPage: Socket instance not ready for event listeners.');
            return;
        }

        const unsubscribeRoomJoined = socket.on(SocketEvents.RoomJoined, (data) => {
            console.log('Room joined successfully or participants updated:', data);
            setRoomState(prev => ({
                ...prev,
                isConnected: true, // This is set by the connection-established event, but good to ensure
                participants: data.participants
            }));
            setIsRoomModalOpen(false);
            setIsConnecting(false);
        });

        const unsubscribeMessageHistory = socket.on(SocketEvents.MessageHistory, (data) => {
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

        const unsubscribeRoomLeft = socket.on(SocketEvents.RoomLeft, (data) => {
            console.log('User left room:', data);
            if (data.username !== roomState.username) {
                setRoomState(prev => ({
                    ...prev,
                    participants: prev.participants.filter(p => p !== data.username)
                }));
            }
        });

        const unsubscribeMessageReceived = socket.on(SocketEvents.MessageReceived, (message) => {
            console.log('Message received:', message);
            setRoomState(prev => {
                // Ensure message ID is present and unique before adding
                if (!message.id || prev.messages.some(msg => msg.id === message.id)) {
                    console.warn('Duplicate or invalid message ID received, skipping:', message);
                    return prev;
                }
                const receivedMessage: ChatMessage = {
                    ...message,
                    timestamp: new Date(message.timestamp),
                    isSelf: message.sender === prev.username,
                    // If it's not a message sent by current user, set to 'delivered' by default upon receipt
                    status: message.sender !== prev.username ? 'delivered' : (message.status || 'sent')
                };
                return {
                    ...prev,
                    messages: [...prev.messages, receivedMessage].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
                };
            });

            // If this message is not from current user, emit 'message-delivered' to server
            if (message.sender !== roomState.username) {
                socket.emitMessageDelivered({ // Call method from context
                    roomId: message.roomId,
                    messageId: message.id,
                    recipientUsername: roomState.username // This client's username
                });
            }
        });

        const unsubscribeUserTyping = socket.on(SocketEvents.UserTyping, (data) => {
            console.log('User typing:', data);
            if (data.username !== roomState.username) {
                setTypingUser(data.isTyping ? data.username : undefined);
            }
        });

        // The connection status is primarily handled by the SocketProvider's internal
        // 'connect', 'disconnect', 'connect_error' and custom 'connection-established' events.
        // This listener can be used for debugging or additional UI feedback.
        const unsubscribeConnectionStatus = socket.on(SocketEvents.ConnectionStatus, (data) => {
            console.log('Connection status from server:', data);
            setRoomState(prev => ({
                ...prev,
                isConnected: data.connected,
                // You might also update participants based on this if it's more authoritative
            }));
        });

        const unsubscribeError = socket.on(SocketEvents.Error, (data) => {
            console.error('Socket error:', data);
            addNotification('error', 'Error', data.message);
            setIsConnecting(false);
        });

        // NEW: Listener for message status updates from the server
        const unsubscribeMessageStatusUpdate = socket.on(SocketEvents.MessageStatusUpdate, (data) => {
            console.log(`Message status update for ${data.messageId}: ${data.status}`);
            setRoomState(prev => ({
                ...prev,
                messages: prev.messages.map(msg =>
                    msg.id === data.messageId ? { ...msg, status: data.status } : msg
                )
            }));
        });

        // WebRTC event listeners (passing through to useWebRTC)
        const unsubscribeCallOffer = socket.on(SocketEvents.CallOffer, (data) => { callState.onCallOffer(data); });
        const unsubscribeCallAnswer = socket.on(SocketEvents.CallAnswer, (data) => { callState.onCallAnswer(data); });
        const unsubscribeIceCandidate = socket.on(SocketEvents.IceCandidate, (data) => { callState.onIceCandidate(data); });
        const unsubscribeCallRejected = socket.on(SocketEvents.CallRejected, (data) => { callState.onCallRejected(data); });
        const unsubscribeCallEnded = socket.on(SocketEvents.CallEnded, (data) => { callState.onCallEnded(data); });
        const unsubscribeCallBusy = socket.on(SocketEvents.CallBusy, (data) => { callState.onCallBusy(data); });
        const unsubscribeCallRinging = socket.on(SocketEvents.CallRinging, (data) => { callState.onCallRinging(data); });
        const unsubscribeCallAccepted = socket.on(SocketEvents.CallAccepted, (data) => { callState.onCallAccepted(data); });
        const unsubscribeCallParticipantJoined = socket.on(SocketEvents.CallParticipantJoined, (data) => { callState.onCallParticipantJoined(data); });


        return () => {
            console.log('ChatPage: useEffect (Socket Listeners) Cleanup - ChatPage is unmounting or dependencies changed.');
            unsubscribeRoomJoined();
            unsubscribeMessageHistory();
            unsubscribeRoomLeft();
            unsubscribeMessageReceived();
            unsubscribeUserTyping();
            unsubscribeConnectionStatus();
            unsubscribeError();
            unsubscribeMessageStatusUpdate();

            // WebRTC cleanup
            unsubscribeCallOffer();
            unsubscribeCallAnswer();
            unsubscribeIceCandidate();
            unsubscribeCallRejected();
            unsubscribeCallEnded();
            unsubscribeCallBusy();
            unsubscribeCallRinging();
            unsubscribeCallAccepted();
            unsubscribeCallParticipantJoined();
        };
    }, [socket, roomState.username, callState]); // Dependency on socket (and its methods) and roomState.username, callState

    useEffect(() => {
        console.log('ChatPage: useEffect (Connection Error) Mounted.');
        // Use socket.connectionError from the context hook
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
        <div className="flex h-screen flex-col bg-gray-50 overflow-hidden">
            <RoomJoinModal
                isOpen={isRoomModalOpen}
                onJoinRoom={handleJoinRoom}
                isConnecting={isConnecting}
            />

            {!isRoomModalOpen && (
                <>
                    <ChatHeader
                        className="fixed top-0 left-0 right-0 z-10"
                        roomId={roomState.roomId}
                        // Use socket.isConnected from context
                        isConnected={socket.isConnected}
                        participantCount={roomState.participants.length}
                        onStartVideoCall={handleStartVideoCall}
                        onLeaveRoom={handleLeaveRoom}
                    />

                    {/* Attach observerRootRef to the scrollable container */}
                    <ChatMessages
                        ref={observerRootRef} // This ref needs to be forwarded in ChatMessages.tsx
                        className="flex-grow overflow-y-auto pt-[68.8px] pb-[96px] px-4 chat-messages-container"
                        messages={roomState.messages}
                        currentUsername={roomState.username}
                        typingUser={typingUser}
                        onImageClick={handleImageClick}
                        onMessageRender={handleMessageRender}
                    />

                    <MessageInput
                        className="fixed bottom-0 left-0 right-0 z-10"
                        onSendMessage={handleSendMessage}
                        onTypingStart={handleTypingStart}
                        onTypingStop={handleTypingStop}
                        roomId={roomState.roomId}
                        username={roomState.username}
                        // Use socket.isConnected from context
                        disabled={!socket.isConnected}
                    />

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

            <NotificationToast
                notifications={notifications}
                onDismiss={dismissNotification}
            />

            <ImageViewerModal
                isOpen={isImageViewerOpen}
                imageUrl={currentViewingImage}
                onClose={handleCloseImageViewer}
            />
        </div>
    );
}
