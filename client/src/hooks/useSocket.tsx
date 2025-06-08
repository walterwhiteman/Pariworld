import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import io, { Socket, SocketOptions, ManagerOptions } from 'socket.io-client';
import { ChatMessage, SocketEvents, SocketEventHandlers } from '../types/chat'; // Adjust path as necessary

// Define the shape of the context value
interface SocketContextType {
    socket: Socket<SocketEventHandlers, SocketEventHandlers> | undefined;
    isConnected: boolean;
    connectionError: string | null;
    emit: (eventName: string, payload: any) => void;
    // Keeping 'on' generic for flexibility, type checking happens via SocketEventHandlers
    on: <T extends keyof SocketEventHandlers>(eventName: T, handler: SocketEventHandlers[T]) => () => void;
    joinRoom: (roomId: string, username: string) => void;
    leaveRoom: (roomId: string, username: string) => void;
    sendMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
    sendTypingStatus: (roomId: string, username: string, isTyping: boolean) => void;
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

    // IMPORTANT: Ensure VITE_BACKEND_URL is set in your .env file (e.g., .env.development, .env.production)
    // Example: VITE_BACKEND_URL=https://pariworld-backend.onrender.com
    const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001'; // Fallback for development

    // This useEffect initializes the Socket.IO client ONLY ONCE when the provider mounts
    useEffect(() => {
        console.log(`[SocketProvider useEffect] Initializing Socket.IO client. Backend URL: ${BACKEND_URL}`);

        const socketInstance = io(BACKEND_URL, {
            path: '/ws', // Aligning client path with backend's /ws
            transports: ['polling', 'websocket'],
            withCredentials: true, // Important for CORS and session handling
            pingInterval: 30000, // Keep-alive ping interval
            pingTimeout: 25000, // How long to wait for a pong before disconnecting
            reconnectionAttempts: Infinity, // Allow infinite reconnection attempts
            reconnectionDelay: 1000, // Initial delay before reconnection attempt
            reconnectionDelayMax: 5000, // Max delay between reconnection attempts
            randomizationFactor: 0.5 // Randomization factor for reconnection delay
        } as Partial<ManagerOptions & SocketOptions>); // Type assertion for options compatibility

        setSocket(socketInstance); // Set the socket instance immediately after creation.

        // Event listener for successful connection
        socketInstance.on('connect', () => {
            console.log('[SocketProvider] Socket.IO connected successfully! ✅ (Frontend)');
            setIsConnected(true);
            setConnectionError(null); // Clear any previous connection errors
        });

        // Event listener for disconnection
        socketInstance.on('disconnect', (reason) => {
            console.warn('[SocketProvider] Socket.IO disconnected! ❌ (Frontend):', reason);
            setIsConnected(false);
            if (reason === 'io server disconnect') {
                setConnectionError('Disconnected by server. Attempting to reconnect...');
            } else {
                setConnectionError(`Disconnected: ${reason}`);
            }
        });

        // Event listener for connection errors
        socketInstance.on('connect_error', (error) => {
            console.error('[SocketProvider] Socket.IO connection error! 🚫 (Frontend):', error.message);
            setConnectionError(`Connection failed: ${error.message}`);
            setIsConnected(false);
        });

        // Event listener for reconnection attempts
        socketInstance.on('reconnect_attempt', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnect attempt #${attemptNumber}`);
            setConnectionError(`Attempting to reconnect... (Attempt ${attemptNumber})`);
        });

        // Event listener for successful reconnection
        socketInstance.on('reconnect', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnected successfully after ${attemptNumber} attempts ✅`);
            setIsConnected(true);
            setConnectionError(null); // Clear error on successful reconnection
        });

        // Event listener for reconnection errors
        socketInstance.on('reconnect_error', (error) => {
            console.error('[SocketProvider] Reconnect error! 🚫', error.message);
            setConnectionError(`Reconnect failed: ${error.message}`);
        });

        // Event listener for permanent reconnection failure
        socketInstance.on('reconnect_failed', () => {
            console.error('[SocketProvider] Reconnect failed permanently. 🔴');
            setConnectionError('Reconnect failed permanently. Please refresh the page.');
        });

        // Generic error handler for any other socket errors
        socketInstance.on('error', (error) => {
            console.error('[SocketProvider] Generic Socket Error: ❗️', error);
            setConnectionError(`Socket error: ${error instanceof Error ? error.message : String(error)}`);
        });

        // Cleanup function: disconnect socket when component unmounts
        return () => {
            if (socketInstance) {
                console.log('[SocketProvider useEffect] Disconnecting Socket.IO client on provider unmount.');
                socketInstance.offAny(); // Remove all event listeners attached to this socket instance
                socketInstance.disconnect(); // Disconnect the socket
            }
        };
    }, [BACKEND_URL]); // Dependency array: re-run effect if BACKEND_URL changes

    /**
     * Emits a Socket.IO event to the server.
     * @param eventName The name of the event to emit.
     * @param payload The data to send with the event.
     */
    const emit = useCallback((eventName: string, payload: any) => {
        if (socket && socket.connected) {
            console.log(`[Socket.emit] Emitting event: ${eventName}`, payload);
            socket.emit(eventName, payload);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected or not initialized. Payload:`, payload);
        }
    }, [socket]);

    /**
     * Registers a handler for a Socket.IO event.
     * Use this within a useEffect in consuming components to ensure proper cleanup.
     * @param eventName The name of the event to listen for.
     * @param handler The callback function to execute when the event is received.
     * @returns A cleanup function to unsubscribe from the event.
     */
    const on = useCallback(<T extends keyof SocketEventHandlers>(eventName: T, handler: SocketEventHandlers[T]) => {
        if (socket) {
            console.log(`[Socket.on] Registering handler for event: ${eventName}`);
            socket.on(eventName, handler);
        } else {
            console.warn(`[Socket.on] Socket not yet available when trying to attach '${eventName}' handler.`);
        }
        return () => {
            if (socket) {
                console.log(`[Socket.off] Unregistering handler for event: ${eventName}`);
                socket.off(eventName, handler);
            }
        };
    }, [socket]);

    // Specific chat-related event emitters, using the generic 'emit' function
    const joinRoom = useCallback((roomId: string, username: string) => {
        console.log(`[Socket.emit] Attempting to join room: ${roomId} with user: ${username}`);
        emit(SocketEvents.JoinRoom, { roomId, username });
    }, [emit]);

    const leaveRoom = useCallback((roomId: string, username: string) => {
        console.log(`[Socket.emit] Attempting to leave room: ${roomId} with user: ${username}`);
        emit(SocketEvents.LeaveRoom, { roomId, username });
    }, [emit]);

    const sendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        console.log(`[Socket.emit] Sending message to room ${message.roomId}:`, message);
        emit(SocketEvents.SendMessage, message);
    }, [emit]);

    const sendTypingStatus = useCallback((roomId: string, username: string, isTyping: boolean) => {
        console.log(`[Socket.emit] Sending typing status (${isTyping ? 'start' : 'stop'}) for room ${roomId} by user ${username}`);
        emit(isTyping ? SocketEvents.TypingStart : SocketEvents.TypingStop, { roomId, username });
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
        sendTypingStatus
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
