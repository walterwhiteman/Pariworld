import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import io, { Socket, SocketOptions, ManagerOptions } from 'socket.io-client';
// Use relative path to avoid potential alias resolution issues on Render
// Also import SocketEventHandlers for strong typing the Socket instance
import { ChatMessage, SocketEvents, SocketEventHandlers } from '../types/chat';

// Define the shape of the context value
interface SocketContextType {
    socket: Socket<SocketEventHandlers, SocketEventHandlers> | undefined;
    isConnected: boolean;
    connectionError: string | null;
    emit: (eventName: string, payload: any) => void;
    on: (eventName: string, handler: (...args: any[]) => void) => () => void;
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

    // Use the Render backend URL
    const BACKEND_URL = 'https://pariworld-backend.onrender.com';

    // This useEffect initializes the Socket.IO client ONLY ONCE when the provider mounts
    useEffect(() => {
        console.log('[SocketProvider useEffect] Initializing Socket.IO client.');
        // Initialize Socket.IO client with the specified backend URL and path
        const socketInstance = io(BACKEND_URL, {
            path: '/ws', // <--- CHANGED: Aligning client path with backend's /ws
            transports: ['polling', 'websocket'],
            withCredentials: true, // Important for CORS and session handling
            pingInterval: 30000, // Keep-alive ping interval
            pingTimeout: 25000,  // How long to wait for a pong before disconnecting
            forceNew: true, // Forces a new connection for each instance
            reconnectionAttempts: 10, // Max reconnection attempts
            reconnectionDelay: 1000, // Initial delay before reconnection attempt
            reconnectionDelayMax: 5000, // Max delay between reconnection attempts
            randomizationFactor: 0.5 // Randomization factor for reconnection delay
        } as Partial<ManagerOptions & SocketOptions>); // Type assertion for options compatibility

        // Event listener for successful connection
        socketInstance.on('connect', () => {
            console.log('[SocketProvider] Socket.IO connected successfully! (Frontend)');
            setSocket(socketInstance);
            setIsConnected(true);
            setConnectionError(null); // Clear any previous connection errors
            console.log('[SocketProvider] Socket state set to connected instance. (Inside connect handler)');
        });

        // Event listener for disconnection
        socketInstance.on('disconnect', (reason) => {
            console.log('[SocketProvider] Socket.IO disconnected! (Frontend):', reason);
            setIsConnected(false);
            setSocket(undefined); // Clear socket instance on disconnect
            // Provide user-friendly messages for different disconnection reasons
            if (reason === 'io server disconnect') {
                setConnectionError('Disconnected by server. Attempting to reconnect...');
            } else {
                setConnectionError(`Disconnected: ${reason}`);
            }
        });

        // Event listener for connection errors
        socketInstance.on('connect_error', (error) => {
            console.error('[SocketProvider] Socket.IO connection error! (Frontend):',
                                error.message,
                                'Description:', (error as any).description,
                                'Type:', (error as any).type,
                                'Event:', (error as any).event,
                                'Reason:', (error as any).reason,
                                error.stack);
            setConnectionError(`Connection failed: ${error.message}`);
            setIsConnected(false);
            setSocket(undefined);
        });

        // Event listener for reconnection attempts
        socketInstance.on('reconnect_attempt', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnect attempt #${attemptNumber}`);
            setConnectionError(`Attempting to reconnect... (Attempt ${attemptNumber})`);
        });

        // Event listener for successful reconnection
        socketInstance.on('reconnect', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnected successfully after ${attemptNumber} attempts`);
            setSocket(socketInstance);
            setIsConnected(true);
            setConnectionError(null); // Clear error on successful reconnection
        });

        // Event listener for reconnection errors
        socketInstance.on('reconnect_error', (error) => {
            console.error('[SocketProvider] Reconnect error:', error.message);
            setConnectionError(`Reconnect failed: ${error.message}`);
            setSocket(undefined);
        });

        // Event listener for permanent reconnection failure
        socketInstance.on('reconnect_failed', () => {
            console.error('[SocketProvider] Reconnect failed permanently.');
            setConnectionError('Reconnect failed permanently. Please refresh.');
            setSocket(undefined);
        });

        // Cleanup function: disconnect socket when component unmounts
        return () => {
            if (socketInstance) {
                console.log('[SocketProvider useEffect] Disconnecting Socket.IO client on provider unmount.');
                socketInstance.offAny(); // Remove all event listeners
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
            socket.emit(eventName, payload);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, payload);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected or not initialized.`);
        }
    }, [socket]); // Dependency: socket instance

    /**
     * Registers a handler for a Socket.IO event.
     * @param eventName The name of the event to listen for.
     * @param handler The callback function to execute when the event is received.
     * @returns A cleanup function to unsubscribe from the event.
     */
    const on = useCallback((eventName: string, handler: (...args: any[]) => void) => {
        if (socket) {
            socket.on(eventName, handler);
        } else {
            console.warn(`[Socket.on] Socket not yet available when trying to attach '${eventName}' handler.`);
        }
        // Return a cleanup function to remove the handler when no longer needed
        return () => {
            if (socket) {
                socket.off(eventName, handler);
            }
        };
    }, [socket]); // Dependency: socket instance

    // Specific chat-related event emitters, using the generic 'emit' function
    const joinRoom = useCallback((roomId: string, username: string) => {
        emit(SocketEvents.JoinRoom, { roomId, username });
    }, [emit]);

    const leaveRoom = useCallback((roomId: string, username: string) => {
        emit(SocketEvents.LeaveRoom, { roomId, username });
    }, [emit]);

    const sendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        emit(SocketEvents.SendMessage, message);
    }, [emit]);

    const sendTypingStatus = useCallback((roomId: string, username: string, isTyping: boolean) => {
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
