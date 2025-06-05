import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import io, { Socket, SocketOptions, ManagerOptions } from 'socket.io-client';
// Import SocketContextType from types/chat, along with other types
import { ChatMessage, SocketEvents, SocketEventHandlers, SocketContextType } from '../types/chat'; // <--- CORRECTED IMPORT

// REMOVED: SocketContextType definition is now in types/chat.ts

// Create the context with an initial undefined value using the imported type
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
            path: '/ws',
            transports: ['polling', 'websocket'],
            withCredentials: true,
            pingInterval: 30000,
            pingTimeout: 25000,
            forceNew: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            randomizationFactor: 0.5
        } as Partial<ManagerOptions & SocketOptions>);

        socketInstance.on('connect', () => {
            console.log('[SocketProvider] Socket.IO connected successfully! (Frontend)');
            setSocket(socketInstance);
            setIsConnected(true);
            setConnectionError(null);
            console.log('[SocketProvider] Socket state set to connected instance. (Inside connect handler)');
        });

        socketInstance.on('disconnect', (reason) => {
            console.log('[SocketProvider] Socket.IO disconnected! (Frontend):', reason);
            setIsConnected(false);
            setSocket(undefined);
            if (reason === 'io server disconnect') {
                setConnectionError('Disconnected by server. Attempting to reconnect...');
            } else {
                setConnectionError(`Disconnected: ${reason}`);
            }
        });

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

        socketInstance.on('reconnect_attempt', (attemptNumber) => {
            console.log(`[SocketProvider] Reconnect attempt #${attemptNumber}`);
            setConnectionError(`Attempting to reconnect... (Attempt ${attemptNumber})`);
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

        return () => {
            if (socketInstance) {
                console.log('[SocketProvider useEffect] Disconnecting Socket.IO client on provider unmount.');
                socketInstance.offAny();
                socketInstance.disconnect();
            }
        };
    }, [BACKEND_URL]);

    const emit = useCallback((eventName: string, payload: any) => {
        if (socket && socket.connected) {
            socket.emit(eventName, payload);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, payload);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected or not initialized.`);
        }
    }, [socket]);

    const on = useCallback((eventName: string, handler: (...args: any[]) => void) => {
        if (socket) {
            socket.on(eventName, handler);
        } else {
            console.warn(`[Socket.on] Socket not yet available when trying to attach '${eventName}' handler.`);
        }
        return () => {
            if (socket) {
                socket.off(eventName, handler);
            }
        };
    }, [socket]);

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
