import { useEffect, useState } from 'react'; // Removed useCallback as it's not used directly for emit/on
import io, { Socket } from 'socket.io-client';
import { ChatMessage, SocketEvents } from '@/types/chat';

/**
 * Custom hook for managing Socket.IO connection and events
 * Handles real-time communication for the private chat application
 */
export function useSocket() {
    // Use state for socket instance to ensure reactivity
    const [socket, setSocket] = useState<Socket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    // Define your backend Socket.IO URL here
    const BACKEND_URL = 'https://pariworld-backend.onrender.com'; // Your backend Render URL

    // Emit function: always checks if socket is connected
    // Not wrapped in useCallback as it directly depends on 'socket' state
    const emit = (eventName: string, payload: any) => {
        if (socket && socket.connected) {
            socket.emit(eventName, payload);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, payload);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected.`);
        }
    };

    // On function: directly attaches handler to the current socket instance.
    // Not wrapped in useCallback as it directly depends on 'socket' state
    const on = (eventName: string, handler: Function) => {
        if (socket) {
            socket.on(eventName, handler);
        } else {
            console.warn(`[useSocket] Socket not yet available when trying to attach '${eventName}' handler.`);
        }

        // Return a cleanup function for this specific handler
        return () => {
            if (socket) {
                socket.off(eventName, handler);
            }
        };
    };

    // Effect to initialize and manage Socket.IO connection
    useEffect(() => {
        // If socket is already set, don't re-initialize
        if (socket) return;

        console.log('[useSocket] Attempting to connect to Socket.IO:', BACKEND_URL);
        const socketInstance = io(BACKEND_URL, {
            path: '/ws',
            transports: ['websocket', 'polling'],
            withCredentials: true
        });
        setSocket(socketInstance); // Set the socket instance in state

        // --- Socket.IO Event Listeners for the connection lifecycle ---
        socketInstance.on('connect', () => {
            console.log('[useSocket] Socket.IO connected successfully! (Frontend)');
            setIsConnected(true);
            setConnectionError(null);
        });

        socketInstance.on('disconnect', (reason) => {
            console.log('[useSocket] Socket.IO disconnected! (Frontend):', reason);
            setIsConnected(false);
            if (reason === 'io server disconnect') {
                setConnectionError('Disconnected by server. Attempting to reconnect...');
                socketInstance.connect(); // Manually attempt to reconnect
            } else {
                setConnectionError(`Disconnected: ${reason}`);
            }
        });

        socketInstance.on('connect_error', (error) => {
            console.error('[useSocket] Socket.IO connection error! (Frontend):', error.message, error.stack);
            setConnectionError(`Connection failed: ${error.message}`);
        });

        socketInstance.on('reconnect_attempt', (attemptNumber) => {
            console.log(`[useSocket] Reconnect attempt #${attemptNumber}`);
        });

        socketInstance.on('reconnect', (attemptNumber) => {
            console.log(`[useSocket] Reconnected successfully after ${attemptNumber} attempts`);
            setIsConnected(true);
            setConnectionError(null);
        });

        socketInstance.on('reconnect_error', (error) => {
            console.error('[useSocket] Reconnect error:', error.message);
            setConnectionError(`Reconnect failed: ${error.message}`);
        });

        socketInstance.on('reconnect_failed', () => {
            console.error('[useSocket] Reconnect failed permanently.');
            setConnectionError('Reconnect failed permanently. Please refresh.');
        });

        // Cleanup function for the useEffect: disconnects the socket when the component using useSocket unmounts
        return () => {
            if (socketInstance) {
                console.log('[useSocket] Disconnecting Socket.IO on component unmount.');
                socketInstance.offAny(); // Remove all listeners from this specific instance
                socketInstance.disconnect();
                setSocket(null); // Clear the socket instance from state
                setIsConnected(false);
                setConnectionError(null);
            }
        };
    }, [socket, BACKEND_URL]); // Dependency on 'socket' state to prevent re-initialization

    // Use useCallback for the returned functions to ensure stable references for React components
    return {
        socket,
        isConnected,
        connectionError,
        emit: useCallback(emit, [emit]), // Wrap emit in useCallback
        on: useCallback(on, [on]),       // Wrap on in useCallback
        joinRoom: useCallback((roomId: string, username: string) => {
            emit(SocketEvents.JoinRoom, { roomId, username });
        }, [emit]),
        leaveRoom: useCallback((roomId: string, username: string) => {
            emit(SocketEvents.LeaveRoom, { roomId, username });
        }, [emit]),
        sendMessage: useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
            emit(SocketEvents.SendMessage, message);
        }, [emit]),
        sendTypingStatus: useCallback((roomId: string, username: string, isTyping: boolean) => {
            emit(isTyping ? SocketEvents.TypingStart : SocketEvents.TypingStop, { roomId, username });
        }, [emit])
    };
}
