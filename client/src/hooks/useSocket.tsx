// src/hooks/useSocket.ts
import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import io, { Socket, SocketOptions, ManagerOptions } from 'socket.io-client';
// Use relative path to avoid potential alias resolution issues on Render
// Also import SocketEventHandlers for strong typing the Socket instance
import { ChatMessage, SocketEvents, SocketEventHandlers } from '../types/chat'; // Ensure this path is correct based on your project structure

// Define the shape of the context value
interface SocketContextType {
    socket: Socket<SocketEventHandlers, SocketEventHandlers> | undefined;
    isConnected: boolean;
    connectionError: string | null;
    // Generic emit/on typed to use SocketEventHandlers
    emit: <K extends keyof SocketEventHandlers>(eventName: K, ...args: Parameters<SocketEventHandlers[K]>) => void;
    on: <K extends keyof SocketEventHandlers>(eventName: K, handler: SocketEventHandlers[K]) => () => void;

    // Chat-related methods
    joinRoom: (roomId: string, username: string) => void;
    leaveRoom: (roomId: string, username: string) => void;
    sendMessage: (message: ChatMessage) => void;
    sendTypingStatus: (roomId: string, username: string, isTyping: boolean) => void;
    // NEW: Message status acknowledgment methods
    // FIX: Changed data structure for emitMessageDelivered to expect a single object
    emitMessageDelivered: (data: { roomId: string; messageId: string; recipientUsername: string }) => void;
    emitMessagesSeen: (data: { roomId: string; messageIds: string[]; username: string }[]) => void;

    // WebRTC related methods
    callUser: (data: { targetUser: string; offer: RTCSessionDescriptionInit; roomId: string }) => void;
    makeAnswer: (data: { to: string; answer: RTCSessionDescriptionInit; roomId: string }) => void;
    sendIceCandidate: (data: { to: string; candidate: RTCIceCandidateInit; roomId: string }) => void;
    rejectCall: (data: { to: string; roomId: string }) => void;
    endCall: (data: { to: string; roomId: string }) => void;
    acceptCall: (data: { to: string; roomId: string }) => void;
}

// Create the context with an initial undefined value
const SocketContext = createContext<SocketContextType | undefined>(undefined);

/**
 * SocketProvider component that initializes and manages the Socket.IO connection
 * Provides the socket instance and its functions to all children components
 */
interface SocketProviderProps {
    children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
    const [socket, setSocket] = useState<Socket<SocketEventHandlers, SocketEventHandlers> | undefined>(undefined);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    // Use the Render backend URL
    const BACKEND_URL = 'https://pariworld-backend.onrender.com';

    // This useEffect initializes the Socket.IO client ONLY ONCE when the provider mounts
    useEffect(() => {
        console.log('[SocketProvider useEffect] Initializing Socket.IO client.');
        const socketInstance = io(BACKEND_URL, {
            path: '/ws', // Aligning client path with backend's /ws
            transports: ['polling', 'websocket'],
            withCredentials: true, // Important for CORS and session handling
            pingInterval: 30000,
            pingTimeout: 25000,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            randomizationFactor: 0.5
        } as Partial<ManagerOptions & SocketOptions>);

        setSocket(socketInstance);

        // Standard Socket.IO 'connect' event (frontend confirms connection)
        socketInstance.on('connect', () => {
            console.log('[SocketProvider] Socket.IO connected successfully! (Frontend)');
            // isConnected will be set to true by the 'connection-established' event from server
            setConnectionError(null); // Clear any previous connection errors
        });

        // Custom 'connection-established' event from your backend (backend confirms connection)
        socketInstance.on(SocketEvents.ConnectionEstablished, (payload) => {
            console.log('[SocketProvider] Received connection-established from server.', payload);
            setIsConnected(payload.connected);
        });

        // Event listener for disconnection
        socketInstance.on('disconnect', (reason) => {
            console.log('[SocketProvider] Socket.IO disconnected! (Frontend):', reason);
            setIsConnected(false); // Immediately set to false on disconnect
            if (reason === 'io server disconnect') {
                setConnectionError('Disconnected by server. Attempting to reconnect...');
            } else {
                setConnectionError(`Disconnected: ${reason}`);
            }
        });

        // Event listener for connection errors
        socketInstance.on('connect_error', (error) => {
            console.error('[SocketProvider] Socket.IO connection error! (Frontend):', error.message, error.stack);
            setConnectionError(`Connection failed: ${error.message}`);
            setIsConnected(false); // Immediately set to false on error
        });

        // Event listener for reconnection attempts
        socketInstance.on('reconnect_attempt', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnect attempt #${attemptNumber}`);
            setConnectionError(`Attempting to reconnect... (Attempt ${attemptNumber})`);
        });

        // Event listener for successful reconnection
        socketInstance.on('reconnect', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnected successfully after ${attemptNumber} attempts`);
            // isConnected will be set to true by the 'connection-established' event from server
            setConnectionError(null); // Clear error on successful reconnection
        });

        // Event listener for reconnection errors
        socketInstance.on('reconnect_error', (error) => {
            console.error('[SocketProvider] Reconnect error:', error.message);
            setConnectionError(`Reconnect failed: ${error.message}`);
        });

        // Event listener for permanent reconnection failure
        socketInstance.on('reconnect_failed', () => {
            console.error('[SocketProvider] Reconnect failed permanently.');
            setConnectionError('Reconnect failed permanently. Please refresh.');
        });

        // Cleanup function: disconnect socket when component unmounts
        return () => {
            if (socketInstance) {
                console.log('[SocketProvider useEffect] Disconnecting Socket.IO client on provider unmount.');
                socketInstance.offAny(); // Remove all event listeners attached to this socket instance
                socketInstance.disconnect(); // Disconnect the socket
            }
        };
    }, [BACKEND_URL]);

    /**
     * Emits a Socket.IO event to the server, with type safety.
     * @param eventName The name of the event to emit.
     * @param args The arguments to send with the event, matching the signature in SocketEventHandlers.
     */
    const emit = useCallback(<K extends keyof SocketEventHandlers>(eventName: K, ...args: Parameters<SocketEventHandlers[K]>) => {
        if (socket && socket.connected) {
            // Need to cast to any because TS struggles with spread args and generic keys
            // This cast is generally safe here because the 'args' are derived from Parameters<SocketEventHandlers[K]>
            (socket.emit as any)(eventName, ...args);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, ...args);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected or not initialized.`);
        }
    }, [socket]);

    /**
     * Registers a handler for a Socket.IO event, with type safety.
     * @param eventName The name of the event to listen for.
     * @param handler The callback function to execute when the event is received, matching SocketEventHandlers.
     * @returns A cleanup function to unsubscribe from the event.
     */
    const on = useCallback(<K extends keyof SocketEventHandlers>(eventName: K, handler: SocketEventHandlers[K]) => {
        if (socket) {
            // Need to cast to any because TS struggles with overloaded signatures
            (socket.on as any)(eventName, handler);
        } else {
            console.warn(`[Socket.on] Socket not yet available when trying to attach '${eventName}' handler.`);
        }
        return () => {
            if (socket) {
                (socket.off as any)(eventName, handler);
            }
        };
    }, [socket]);

    // Specific chat-related event emitters, using the generic 'emit' function
    const joinRoom = useCallback((roomId: string, username: string) => {
        // CORRECTED: Emit the data as a single object payload to match backend common practice
        emit(SocketEvents.JoinRoom, { roomId, username }, (response: { success: boolean; message?: string }) => {
            // This callback is for the client-side response to the join-room emit
            if (!response.success) {
                console.error('Failed to join room (from callback):', response.message);
                setConnectionError(response.message || 'Failed to join room.');
            }
        });
    }, [emit]);


    const leaveRoom = useCallback((roomId: string, username: string) => {
        emit(SocketEvents.LeaveRoom, roomId, username);
    }, [emit]);

    // MODIFIED: sendMessage now accepts full ChatMessage as per types/chat.ts
    const sendMessage = useCallback((message: ChatMessage) => {
        emit(SocketEvents.SendMessage, message);
    }, [emit]);

    const sendTypingStatus = useCallback((roomId: string, username: string, isTyping: boolean) => {
        // The SocketEventHandlers defined typing-start and typing-stop with `isTyping` as a parameter.
        // It's more efficient to have one event 'typing-status' on the backend that takes 'isTyping'.
        // However, if your backend strictly expects 'typing-start' or 'typing-stop', you'll use the respective event.
        // Based on the provided types, I'll use the explicit start/stop events.
        if (isTyping) {
            emit(SocketEvents.TypingStart, roomId, username, isTyping);
        } else {
            emit(SocketEvents.TypingStop, roomId, username, isTyping);
        }
    }, [emit]);

    // NEW: Emit 'message-delivered' acknowledgment
    const emitMessageDelivered = useCallback((data: { roomId: string; messageId: string; recipientUsername: string }) => {
        // FIX: Sending a single object as the payload to match the server's expected destructuring
        emit(SocketEvents.MessageDelivered, { messageId: data.messageId, roomId: data.roomId, recipientUsername: data.recipientUsername });
    }, [emit]);

    // NEW: Emit 'messages-seen' acknowledgment (can be multiple)
    const emitMessagesSeen = useCallback((data: { roomId: string; messageIds: string[]; username: string }[]) => {
        // The backend expects an array of objects. The 'emit' wrapper will handle passing it.
        // The SocketEventHandlers for MessagesSeen expects an array of objects directly.
        emit(SocketEvents.MessagesSeen, data);
    }, [emit]);


    // WebRTC related emits (using SocketEvents enum and generic emit)
    const callUser = useCallback((data: { targetUser: string; offer: RTCSessionDescriptionInit; roomId: string }) => {
        emit(SocketEvents.CallUser, data.targetUser, data.offer, data.roomId);
    }, [emit]);

    const makeAnswer = useCallback((data: { to: string; answer: RTCSessionDescriptionInit; roomId: string }) => {
        emit(SocketEvents.MakeAnswer, data.to, data.answer, data.roomId);
    }, [emit]);

    const sendIceCandidate = useCallback((data: { to: string; candidate: RTCIceCandidateInit; roomId: string }) => {
        emit(SocketEvents.SendIceCandidate, data.to, data.candidate, data.roomId);
    }, [emit]);

    const rejectCall = useCallback((data: { to: string; roomId: string }) => {
        emit(SocketEvents.RejectCall, data.to, data.roomId);
    }, [emit]);

    const endCall = useCallback((data: { to: string; roomId: string }) => {
        emit(SocketEvents.EndCall, data.to, data.roomId);
    }, [emit]);

    const acceptCall = useCallback((data: { to: string; roomId: string }) => {
        emit(SocketEvents.AcceptCall, data.to, data.roomId);
    }, [emit]);

    // Value provided by the context to consuming components
    const contextValue = {
        socket,
        isConnected,
        connectionError,
        emit,
        on,
        joinRoom,
        leaveRoom,
        sendMessage,
        sendTypingStatus,
        emitMessageDelivered,
        emitMessagesSeen,
        callUser,
        makeAnswer,
        sendIceCandidate,
        rejectCall,
        endCall,
        acceptCall
    };

    return (
        <SocketContext.Provider value={contextValue}>
            {children}
        </SocketContext.Provider>
    );
}

/**
 * Custom hook to consume the SocketContext.
 * Components use this hook to access the socket instance and its functions.
 * Throws an error if used outside of a SocketProvider.
 */
export function useSocket() {
    const context = useContext(SocketContext);
    if (context === undefined) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
}
