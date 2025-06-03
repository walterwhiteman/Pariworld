import { useEffect, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { ChatMessage, SocketEvents } from '@/types/chat';

/**
 * Custom hook for managing Socket.IO connection and events
 * Handles real-time communication for the private chat application
 */
export function useSocket() {
    const [socket, setSocket] = useState<Socket | undefined>(undefined);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    const BACKEND_URL = 'https://pariworld-backend.onrender.com';

    // Emit function: always checks if socket is connected
    const emit = (eventName: string, payload: any) => {
        if (socket && socket.connected) {
            socket.emit(eventName, payload);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, payload);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected or not initialized.`);
        }
    };

    // On function: directly attaches handler to the current socket instance.
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

    // MODIFIED: This useEffect now runs ONLY ONCE on component mount.
    // It initializes the socket instance and sets up its core lifecycle listeners.
    useEffect(() => {
        console.log('[useSocket useEffect] Initializing Socket.IO client.');
        const socketInstance = io(BACKEND_URL, {
            path: '/ws',
            transports: ['websocket', 'polling'],
            withCredentials: true
        });

        socketInstance.on('connect', () => {
            console.log('[useSocket] Socket.IO connected successfully! (Frontend)');
            setSocket(socketInstance); // Set the socket state only on successful connection
            setIsConnected(true);
            setConnectionError(null);
            console.log('[useSocket] Socket state set to connected instance.');
        });

        socketInstance.on('disconnect', (reason) => {
            console.log('[useSocket] Socket.IO disconnected! (Frontend):', reason);
            setIsConnected(false);
            setSocket(undefined); // Clear socket state on disconnect
            if (reason === 'io server disconnect') {
                setConnectionError('Disconnected by server. Attempting to reconnect...');
                socketInstance.connect();
            } else {
                setConnectionError(`Disconnected: ${reason}`);
            }
        });

        socketInstance.on('connect_error', (error) => {
            console.error('[useSocket] Socket.IO connection error! (Frontend):', error.message, error.stack);
            setConnectionError(`Connection failed: ${error.message}`);
            setIsConnected(false);
            setSocket(undefined);
        });

        socketInstance.on('reconnect_attempt', (attemptNumber) => {
            console.log(`[useSocket] Reconnect attempt #${attemptNumber}`);
        });

        socketInstance.on('reconnect', (attemptNumber) => {
            console.log(`[useSocket] Reconnected successfully after ${attemptNumber} attempts`);
            setSocket(socketInstance);
            setIsConnected(true);
            setConnectionError(null);
        });

        socketInstance.on('reconnect_error', (error) => {
            console.error('[useSocket] Reconnect error:', error.message);
            setConnectionError(`Reconnect failed: ${error.message}`);
            setSocket(undefined);
        });

        socketInstance.on('reconnect_failed', () => {
            console.error('[useSocket] Reconnect failed permanently.');
            setConnectionError('Reconnect failed permanently. Please refresh.');
            setSocket(undefined);
        });

        // Cleanup function for this specific useEffect: disconnects the socket when the component using useSocket unmounts
        return () => {
            if (socketInstance) {
                console.log('[useSocket useEffect] Disconnecting Socket.IO client on unmount.');
                socketInstance.offAny(); // Remove all listeners from this specific instance
                socketInstance.disconnect();
            }
        };
    }, [BACKEND_URL]); // MODIFIED: Empty dependency array to run only once, or just BACKEND_URL if it's dynamic

    // These useCallbacks are fine as they depend on 'socket' which is state.
    return {
        socket,
        isConnected,
        connectionError,
        emit: useCallback(emit, [socket]), // emit depends on 'socket'
        on: useCallback(on, [socket]),     // on depends on 'socket'
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
