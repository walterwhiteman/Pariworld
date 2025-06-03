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

    const eventHandlersRef = useRef<Map<string, Set<Function>>>(new Map());

    const emit = useCallback((eventName: string, payload: any) => {
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit(eventName, payload);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, payload);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected.`);
        }
    }, []);

    const on = useCallback((eventName: string, handler: Function) => {
        if (!eventHandlersRef.current.has(eventName)) {
            eventHandlersRef.current.set(eventName, new Set());
        }
        eventHandlersRef.current.get(eventName)!.add(handler);

        if (socketRef.current) {
            socketRef.current.on(eventName, handler);
        }

        return () => {
            const handlers = eventHandlersRef.current.get(eventName);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    eventHandlersRef.current.delete(eventName);
                }
            }
            if (socketRef.current) {
                socketRef.current.off(eventName, handler);
            }
        };
    }, []);

    // Effect to initialize and manage Socket.IO connection
    useEffect(() => {
        if (!socketRef.current) {
            console.log('[useSocket] Attempting to connect to Socket.IO:', BACKEND_URL);
            const socketInstance = io(BACKEND_URL, {
                path: '/ws',
                transports: ['websocket', 'polling'],
                withCredentials: true
            });
            socketRef.current = socketInstance;

            socketInstance.on('connect', () => {
                console.log('[useSocket] Socket.IO connected successfully! (Frontend)');
                setIsConnected(true);
                setConnectionError(null);
                eventHandlersRef.current.forEach((handlers, eventName) => {
                    handlers.forEach(handler => {
                        socketInstance.on(eventName, handler);
                    });
                });
            });

            socketInstance.on('disconnect', (reason) => {
                console.log('[useSocket] Socket.IO disconnected! (Frontend):', reason);
                setIsConnected(false);
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
        }

        return () => {
            if (socketRef.current) {
                console.log('[useSocket] Disconnecting Socket.IO on unmount.');
                socketRef.current.offAny();
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };
    }, [BACKEND_URL]);

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
