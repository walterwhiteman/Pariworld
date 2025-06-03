import { createContext, useContext, useEffect, useState, useCallback, ReactNode, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { ChatMessage, SocketEvents } from '@/types/chat';

// Define the shape of the context value
interface SocketContextType {
    socket: Socket | undefined;
    isConnected: boolean;
    connectionError: string | null;
    emit: (eventName: string, payload: any) => void;
    on: (eventName: string, handler: Function) => () => void;
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
    const [socket, setSocket] = useState<Socket | undefined>(undefined);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const BACKEND_URL = 'https://pariworld-backend.onrender.com';

    // Use a ref to store the actual socket instance to prevent stale closures
    const socketRef = useRef<Socket | undefined>(undefined);

    // This useEffect initializes the Socket.IO client ONLY ONCE when the provider mounts
    useEffect(() => {
        console.log('[SocketProvider useEffect] Initializing Socket.IO client.');
        const socketInstance = io(BACKEND_URL, {
            path: '/ws',
            transports: ['websocket', 'polling'],
            withCredentials: true
        });

        socketRef.current = socketInstance; // Store instance in ref

        socketInstance.on('connect', () => {
            console.log('[SocketProvider] Socket.IO connected successfully! (Frontend)');
            setSocket(socketInstance); // Update state
            setIsConnected(true);
            setConnectionError(null);
            console.log('[SocketProvider] Socket state set to connected instance.');
        });

        socketInstance.on('disconnect', (reason) => {
            console.log('[SocketProvider] Socket.IO disconnected! (Frontend):', reason);
            setIsConnected(false);
            setSocket(undefined); // Clear state
            if (reason === 'io server disconnect') {
                setConnectionError('Disconnected by server. Attempting to reconnect...');
                socketInstance.connect();
            } else {
                setConnectionError(`Disconnected: ${reason}`);
            }
        });

        socketInstance.on('connect_error', (error) => {
            console.error('[SocketProvider] Socket.IO connection error! (Frontend):', error.message, error.stack);
            setConnectionError(`Connection failed: ${error.message}`);
            setIsConnected(false);
            setSocket(undefined);
        });

        socketInstance.on('reconnect_attempt', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnect attempt #${attemptNumber}`);
        });

        socketInstance.on('reconnect', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnected successfully after ${attemptNumber} attempts`);
            setSocket(socketInstance);
            setIsConnected(true);
            setConnectionError(null);
        });

        socketInstance.on('reconnect_error', (error) => {
            console.error('[SocketProvider] Reconnect error:', error.message);
            setConnectionError(`Reconnect failed: ${error.message}`);
            setSocket(undefined);
        });

        socketInstance.on('reconnect_failed', () => {
            console.error('[SocketProvider] Reconnect failed permanently.');
            setConnectionError('Reconnect failed permanently. Please refresh.');
            setSocket(undefined);
        });

        // Cleanup function for this specific useEffect: disconnects the socket when the provider unmounts
        return () => {
            if (socketRef.current) { // Use ref for cleanup
                console.log('[SocketProvider useEffect] Disconnecting Socket.IO client on provider unmount.');
                socketRef.current.offAny(); // Remove all listeners from this specific instance
                socketRef.current.disconnect();
            }
        };
    }, [BACKEND_URL]); // Empty dependency array to run only once on mount

    // Memoized functions that use the socketRef
    const emit = useCallback((eventName: string, payload: any) => {
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit(eventName, payload);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, payload);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected or not initialized.`);
        }
    }, []); // No dependencies, always uses latest socketRef.current

    const on = useCallback((eventName: string, handler: Function) => {
        const currentSocket = socketRef.current; // Get current socket from ref
        if (currentSocket) {
            console.log(`[Socket.on] Attaching '${eventName}' handler.`);
            currentSocket.on(eventName, handler);
        } else {
            console.warn(`[Socket.on] Socket not yet available when trying to attach '${eventName}' handler.`);
        }
        return () => {
            if (currentSocket) { // Use the same socket instance for cleanup
                console.log(`[Socket.on Cleanup] Detaching '${eventName}' handler.`); // ADDED LOG
                currentSocket.off(eventName, handler);
            }
        };
    }, []); // No dependencies, always uses latest socketRef.current

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

    // The value provided to the context
    const contextValue = {
        socket, // This is the state variable, which causes re-renders when it changes
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
 * Custom hook to consume the SocketContext
 * Components use this hook to access the socket instance and its functions
 */
export function useSocket() {
    const context = useContext(SocketContext);
    if (context === undefined) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
}
