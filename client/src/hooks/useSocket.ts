import { useEffect, useRef, useState, useCallback } from 'react';
import io, { Socket } from 'socket.io-client'; // <--- NEW: Import io and Socket type
import { ChatMessage, SocketEvents } from '@/types/chat';

/**
 * Custom hook for managing Socket.IO connection and events
 * Handles real-time communication for the private chat application
 */
export function useSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const socketRef = useRef<Socket | null>(null); // <--- NEW: Use Socket type

    // Define your backend Socket.IO URL here
    // This should be your backend's Render service URL
    // IMPORTANT: The path should match what you configured in your backend's routes.ts for Socket.IO
    const BACKEND_URL = 'https://pariworld-backend.onrender.com'; // Your backend Render URL

    // Use a ref for on and emit callbacks to prevent stale closures and improve performance
    const eventHandlersRef = useRef<Map<string, Set<Function>>>(new Map()); // Use for managing handlers

    /**
     * Emit an event to the server
     */
    const emit = useCallback((eventName: string, payload: any) => {
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit(eventName, payload);
            console.log(`Emitted event: ${eventName}`, payload);
        } else {
            console.warn(`Cannot emit event '${eventName}' - Socket.IO is not connected.`);
        }
    }, []); // No dependencies here means it's stable

    /**
     * Register an event handler
     */
    const on = useCallback((eventName: string, handler: Function) => {
        // Add handler to our local ref for management
        if (!eventHandlersRef.current.has(eventName)) {
            eventHandlersRef.current.set(eventName, new Set());
        }
        eventHandlersRef.current.get(eventName)!.add(handler);

        // If socket already exists, attach the handler
        if (socketRef.current) {
            socketRef.current.on(eventName, handler);
        }

        // Return cleanup function to remove the handler
        return () => {
            const handlers = eventHandlersRef.current.get(eventName);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    eventHandlersRef.current.delete(eventName);
                }
            }
            // Also remove from actual socket if it exists
            if (socketRef.current) {
                socketRef.current.off(eventName, handler);
            }
        };
    }, []); // No dependencies here means it's stable

    // Effect to initialize and manage Socket.IO connection
    useEffect(() => {
        // Only connect if socket not already initialized
        if (!socketRef.current) {
            console.log('Attempting to connect to Socket.IO:', BACKEND_URL);
            const socketInstance = io(BACKEND_URL, {
                // The path here MUST match the path you set for Socket.IO in your backend's routes.ts
                // In your backend's routes.ts, you have `server.use(socketIoInstance);` after `const socketIoInstance = new SocketIOServer(...)`
                // The `path` option for the SocketIOServer is what matters here.
                // Based on your backend, you set `path: '/ws'`.
                path: '/ws', // <--- IMPORTANT: This MUST match your backend's Socket.IO path
                transports: ['websocket', 'polling'], // Prioritize websocket
                withCredentials: true // Important for CORS headers
            });
            socketRef.current = socketInstance;

            socketInstance.on('connect', () => {
                console.log('Socket.IO connected successfully!');
                setIsConnected(true);
                setConnectionError(null);
                // Re-attach any handlers that were registered via `on` before connection
                eventHandlersRef.current.forEach((handlers, eventName) => {
                    handlers.forEach(handler => {
                        socketInstance.on(eventName, handler);
                    });
                });
            });

            socketInstance.on('disconnect', (reason) => {
                console.log('Socket.IO disconnected:', reason);
                setIsConnected(false);
                if (reason === 'io server disconnect') {
                    // The disconnection was initiated by the server, try to reconnect manually
                    setConnectionError('Disconnected by server. Attempting to reconnect...');
                    socketInstance.connect(); // Attempt to reconnect
                } else {
                    setConnectionError(`Disconnected: ${reason}`);
                }
            });

            socketInstance.on('connect_error', (error) => {
                console.error('Socket.IO connection error:', error.message, error.stack);
                setConnectionError(`Connection failed: ${error.message}`);
                setIsConnected(false);
            });
        }

        // Cleanup function for when component unmounts or hook dependencies change
        return () => {
            if (socketRef.current) {
                console.log('Disconnecting Socket.IO on unmount.');
                // Remove all listeners to prevent memory leaks
                socketRef.current.offAny();
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [BACKEND_URL]); // Depend on BACKEND_URL to re-initialize if it changes

    // Public API for the hook
    return {
        isConnected,
        connectionError,
        emit,
        on,
        // These functions are just wrappers around emit for convenience and type safety
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
