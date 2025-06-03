import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client';
import { ChatMessage, SocketEvents } from '@/types/chat';

/**
 * Custom hook for managing Socket.IO connection and events
 * Handles real-time communication for the private chat application
 */
export function useSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const socketRef = useRef<Socket | null>(null);

    // Define your backend Socket.IO URL here
    const BACKEND_URL = 'https://pariworld-backend.onrender.com'; // Your backend Render URL

    // --- REMOVED: eventHandlersRef is no longer needed for re-attaching ---
    // const eventHandlersRef = useRef<Map<string, Set<Function>>>(new Map());

    // Emit function: always checks if socket is connected
    const emit = useCallback((eventName: string, payload: any) => {
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit(eventName, payload);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, payload);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected.`);
        }
    }, []);

    // --- MODIFIED: Simplified 'on' function ---
    // This 'on' function now directly attaches the handler to the current socket instance.
    // The cleanup function returned by 'on' will remove this specific handler.
    const on = useCallback((eventName: string, handler: Function) => {
        if (socketRef.current) {
            socketRef.current.on(eventName, handler);
        } else {
            // If socket is not yet initialized, queue the handler or log a warning
            console.warn(`[useSocket] Socket not yet initialized when trying to attach '${eventName}' handler.`);
            // In a more complex scenario, you might queue these to attach on 'connect'
        }

        // Return a cleanup function for this specific handler
        return () => {
            if (socketRef.current) {
                socketRef.current.off(eventName, handler);
            }
        };
    }, []); // No dependencies for 'on' itself, as it works with socketRef.current

    // Effect to initialize and manage Socket.IO connection
    useEffect(() => {
        // Only initialize if socketRef.current is null (first render or after full cleanup)
        if (!socketRef.current) {
            console.log('[useSocket] Attempting to connect to Socket.IO:', BACKEND_URL);
            const socketInstance = io(BACKEND_URL, {
                path: '/ws',
                transports: ['websocket', 'polling'],
                withCredentials: true
            });
            socketRef.current = socketInstance; // Assign the instance to the ref

            // --- Socket.IO Event Listeners for the connection lifecycle ---
            socketInstance.on('connect', () => {
                console.log('[useSocket] Socket.IO connected successfully! (Frontend)');
                setIsConnected(true);
                setConnectionError(null);
                // --- REMOVED: No need to re-attach handlers here.
                // The 'on' function in ChatPage's useEffect will handle its own subscriptions
                // when the socket becomes connected.
            });

            socketInstance.on('disconnect', (reason) => {
                console.log('[useSocket] Socket.IO disconnected! (Frontend):', reason);
                setIsConnected(false);
                // --- REMOVED: No need to remove handlers here.
                // The cleanup returned by individual 'on' calls handles detachment.
                if (reason === 'io server disconnect') {
                    // Server initiated disconnect, Socket.IO won't auto-reconnect unless told to
                    setConnectionError('Disconnected by server. Attempting to reconnect...');
                    socketInstance.connect(); // Manually attempt to reconnect
                } else {
                    setConnectionError(`Disconnected: ${reason}`);
                }
            });

            socketInstance.on('connect_error', (error) => {
                console.error('[useSocket] Socket.IO connection error! (Frontend):', error.message, error.stack);
                setConnectionError(`Connection failed: ${error.message}`);
                setIsConnected(false);
            });

            socketInstance.on('reconnect_attempt', (attemptNumber) => {
                console.log(`[useSocket] Reconnect attempt #${attemptNumber}`);
            });

            socketInstance.on('reconnect', (attemptNumber) => {
                console.log(`[useSocket] Reconnected successfully after ${attemptNumber} attempts`);
                setIsConnected(true);
                setConnectionError(null);
                // --- REMOVED: No need to re-attach handlers here.
                // Handlers are re-attached by the 'on' function if the socket is connected.
            });

            socketInstance.on('reconnect_error', (error) => {
                console.error('[useSocket] Reconnect error:', error.message);
                setConnectionError(`Reconnect failed: ${error.message}`);
            });

            socketInstance.on('reconnect_failed', () => {
                console.error('[useSocket] Reconnect failed permanently.');
                setConnectionError('Reconnect failed permanently. Please refresh.');
            });
        }

        // Cleanup function for the useEffect: disconnects the socket when the component using useSocket unmounts
        return () => {
            if (socketRef.current) {
                console.log('[useSocket] Disconnecting Socket.IO on component unmount.');
                // Remove all listeners attached to this socket instance for a clean unmount.
                // This 'offAny' is important to ensure no lingering listeners from this hook.
                socketRef.current.offAny();
                socketRef.current.disconnect();
                socketRef.current = null; // Clear the ref
                setIsConnected(false);
                setConnectionError(null);
            }
        };
    }, [BACKEND_URL]); // Dependency on BACKEND_URL ensures effect runs if URL changes (unlikely here)

    return {
        isConnected,
        connectionError,
        emit,
        on,
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
