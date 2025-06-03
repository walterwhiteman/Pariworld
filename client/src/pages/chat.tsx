import { useState, useCallback, useEffect, useRef } from 'react';
import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { NotificationToast } from '@/components/chat/NotificationToast'; // VideoCallModal removed
import { useSocket } from '@/hooks/useSocket';
// import { useWebRTC } from '@/hooks/useWebRTC'; // REMOVED IMPORT FOR DIAGNOSIS
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
    // const webRTC = useWebRTC(socket, roomState.roomId, roomState.username); // REMOVED USAGE FOR DIAGNOSIS

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

        // webRTC.endCall(); // REMOVED USAGE FOR DIAGNOSIS

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
        if (!roomState.isConnected) {
            addNotification('error', 'Call Error', 'Not connected to room.');
            return;
        }

        const userToCall = 'OTHER_USER_USERNAME_HERE';

        if (!userToCall || userToCall === roomState.username) {
            addNotification('warning', 'Call Info', 'Please enter a valid username for the other person to call.');
            return;
        }

        console.log(`[ChatPage] Attempting to call: ${userToCall}`);
        addNotification('info', 'Calling', `Attempting to call ${userToCall}...`);

    }, [roomState, addNotification]);


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
            timestamp: new Date().toISOString()
        };
        setRoomState(prev => ({
            ...prev,
            messages: [...prev.messages, systemMessage]
        }));
        addNotification('success', 'Room Joined', `Welcome to ${data.roomId}!`);
    }, [isRoomModalOpen, generateClientMessageId, addNotification]);

    const handleMessageReceived = useCallback((message: ChatMessage) => {
        console.log('[Frontend] Message received:', message);
        const parsedMessage = { ...message, timestamp: new Date(message.timestamp) };

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
            timestamp: new Date(msg.timestamp)
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
                        // onStartVideoCall={handleStartVideoCall} // TEMPORARILY REMOVED
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
            {/* <VideoCallModal // TEMPORARILY REMOVED
                isOpen={webRTC.callState.isModalOpen}
                onClose={webRTC.closeCallModal}
                localStream={webRTC.callState.localStream}
                remoteStream={webRTC.callState.remoteStream}
                callStatus={webRTC.callState.status}
                onAcceptCall={webRTC.acceptCall}
                onEndCall={webRTC.endCall}
                callingUser={webRTC.callState.callingUser}
            /> */}

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
```

The user is asking about a previous fix for a similar error. I need to explain the difference between the past build error and the current runtime error.

**Past Error (Build Error):**
The previous `TypeError: n is not a function` (or `t` in minified code) was a **build-time error** related to JSX syntax in a `.ts` file. The error message explicitly pointed to `Expected ">" but found "value"` at `<SocketContext.Provider value={contextValue}>` in `src/hooks/useSocket.ts`. This was fixed by **renaming `src/hooks/useSocket.ts` to `src/hooks/useSocket.tsx`**. This told the build tools to correctly parse the JSX.

**Current Error (Runtime Error):**
The current `TypeError: t is not a function` is a **runtime error** that occurs *after* the frontend successfully builds and connects to the backend. The logs show:
* Socket connects successfully.
* `ChatPage` re-renders.
* `ChatPage`'s `useEffect` for listeners runs.
* **Then the `TypeError` occurs.**

This indicates that `t` (which is a minified variable name) is expected to be a function, but it is not, at the point where `socket.on(eventName, handler)` or `socket.off(eventName, handler)` is being called.

My current hypothesis is that despite using `useCallback` for the handlers, there might still be some subtle timing or closure issue, or perhaps a `null`/`undefined` value is being passed to `socket.on` or `socket.off` unexpectedly.

I've already added more logging to the selected code (the `ChatPage` file) to log the `typeof` each handler and the `on` function itself. This will be crucial for the next step.

I need to explain this difference clearly and then ask the user to provide the *new* logs from the latest deployment with these added `typeof` checks.

**Plan:**
1.  Explain the difference between the previous build error and the current runtime error.
2.  Acknowledge the user's frustration.
3.  Explain that the current logs with `typeof` checks will be the key to understanding why `t` is not a function.
4.  Ask the user to deploy the current `ChatPage` code (which I just provided with the new logs) and share the console output.I understand your frustration that the app is still not connecting, and you're asking how this specific error was fixed before. It's a very valid question, and it's important to distinguish between the previous issue and the current one.

The `TypeError: t is not a function` you're seeing now is a **runtime error**, meaning it occurs *after* your frontend code has successfully built and deployed. It happens when the JavaScript tries to execute a function, but the variable it's trying to call is `null`, `undefined`, or some other non-function value.

The previous time we saw a `TypeError: n is not a function` (or similar), it was a **build-time error**. The specific message was `ERROR: Expected ">" but found "value"` at the line `<SocketContext.Provider value={contextValue}>` in `src/hooks/useSocket.ts`. That error meant your build tools (Vite/esbuild) couldn't understand the JSX syntax in a `.ts` file. That was fixed by **renaming `src/hooks/useSocket.ts` to `src/hooks/useSocket.tsx`**, which tells the build system to treat the file as a React component. So, that particular build error is resolved.

**The current `TypeError: t is not a function` is a different problem.** Your latest logs show that the Socket.IO connection itself is successful:
* `[SocketProvider] Socket.IO connected successfully! (Frontend)`
* `[SocketProvider] Socket state set to connected instance.`

However, immediately after this, when `ChatPage` re-renders and attempts to set up its event listeners, that's when the `TypeError` occurs:
* `[ChatPage useEffect] Socket IS ready, setting up listeners.`
* `Uncaught TypeError: t is not a function`

This indicates that either the `on` function (which comes from `useSocket` and is used to attach listeners) is somehow not a function at that exact moment, or one of the *handler functions* you're passing to `on` (like `handleRoomJoined`, `handleMessageReceived`, etc.) is not a function.

To pinpoint this, I've added more specific logging to the `useEffect` block in the `ChatPage` component in the Canvas you selected (`frontend-chat-page-simplified-handlers`). This logging will tell us the `typeof` each handler and the `on` function right before they are used.

**Please perform the following steps with the updated `src/pages/chat.tsx` code in the Canvas:**

1.  **Ensure your `src/pages/chat.tsx` file matches the content in the Canvas above.** (It already includes the new `console.log` statements for `typeof` handlers).
2.  **Save the file.**
3.  **Commit and push** these changes to your GitHub repository.
    * `git add .`
    * `git commit -m "Frontend: Add typeof checks for socket event handlers in ChatPage useEffect"`
    * `git push origin main` (or `master`)
4.  **Go to your Render Dashboard.**
5.  **Manually trigger a "Clear cache & Deploy" for your frontend service.**

Once the frontend deploys successfully, please:

* **Open your frontend application (`https://pariworld.onrender.com/`) in an Incognito/Private browser window.**
* **Open your browser's Developer Tools (F12) and go to the "Console" tab.**
* **Clear the console.**
* **Refresh the page.**
* **Copy *all* the console logs** from the moment the page loads until the error occurs.

These new logs will show us the types of the functions involved, which should help us understand why `t` is not a functi
