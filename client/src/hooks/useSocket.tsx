import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import io, { Socket, SocketOptions, ManagerOptions } from 'socket.io-client';
import { ChatMessage, SocketEvents, SocketEventHandlers } from '../types/chat';

// Define the shape of the context value
interface SocketContextType {
    socket: Socket<SocketEventHandlers, SocketEventHandlers> | undefined;
    isConnected: boolean;
    connectionError: string | null;
    messages: ChatMessage[]; // ADDED: State to hold chat messages
    emit: <EventName extends keyof SocketEventHandlers>(eventName: EventName, ...args: Parameters<SocketEventHandlers[EventName]>) => void;
    on: <EventName extends keyof SocketEventHandlers>(eventName: EventName, handler: SocketEventHandlers[EventName]) => () => void;
    joinRoom: (roomId: string, username: string) => void;
    leaveRoom: (roomId: string, username: string) => void;
    sendMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
    sendTypingStatus: (roomId: string, username: string, isTyping: boolean) => void;
}

// Create the context with an initial undefined value
const SocketContext = createContext<SocketContextType | undefined>(undefined);

interface SocketProviderProps {
    children: ReactNode;
}

export function SocketProvider({ children }: SocketProviderProps) {
    const [socket, setSocket] = useState<Socket<SocketEventHandlers, SocketEventHandlers> | undefined>(undefined);
    const [isConnected, setIsConnected] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]); // NEW: State for chat messages

    const BACKEND_URL = 'https://pariworld-backend.onrender.com';

    useEffect(() => {
        console.log('[SocketProvider useEffect] Initializing Socket.IO client.');
        const socketInstance = io(BACKEND_URL, {
            path: '/socket.io/', // CORRECTED: Aligning client path with backend's /socket.io/
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
        });

        socketInstance.on('disconnect', (reason) => {
            console.log('[SocketProvider] Socket.IO disconnected! (Frontend):', reason);
            setIsConnected(false);
            setSocket(undefined);
            setMessages([]); // Clear messages on disconnect
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

        // Cleanup function for socket instance
        return () => {
            if (socketInstance) {
                console.log('[SocketProvider useEffect] Disconnecting Socket.IO client on provider unmount.');
                socketInstance.offAny();
                socketInstance.disconnect();
            }
        };
    }, [BACKEND_URL]);

    // NEW useEffect for message handling (listens for events when socket is ready)
    useEffect(() => {
        if (!socket) return;

        // Listener for historical messages when joining a room
        const handleRoomMessagesLoaded = (historicalMessages: ChatMessage[]) => {
            console.log('[SocketEvent] Received historical messages:', historicalMessages.length);
            // Ensure messages are valid Date objects if they are strings from DB
            const formattedMessages = historicalMessages.map(msg => ({
                ...msg,
                timestamp: new Date(msg.timestamp) // Convert timestamp to Date object
            }));
            setMessages(formattedMessages); // Replace current messages with historical ones
        };

        // Listener for new incoming messages
        const handleMessageReceived = (newMessage: ChatMessage) => {
            console.log('[SocketEvent] Received new message:', newMessage);
            // Ensure timestamp is a Date object
            const formattedMessage = {
                ...newMessage,
                timestamp: new Date(newMessage.timestamp)
            };
            setMessages((prevMessages) => [...prevMessages, formattedMessage]); // Append new message
        };

        // Listener for when a user leaves a room
        const handleRoomLeft = () => {
            console.log('[SocketEvent] Room left, clearing messages.');
            setMessages([]); // Clear messages when the user leaves a room
        };


        socket.on(SocketEvents.RoomMessagesLoaded, handleRoomMessagesLoaded);
        socket.on(SocketEvents.MessageReceived, handleMessageReceived);
        socket.on(SocketEvents.RoomLeft, handleRoomLeft);

        // Cleanup function for these specific listeners
        return () => {
            socket.off(SocketEvents.RoomMessagesLoaded, handleRoomMessagesLoaded);
            socket.off(SocketEvents.MessageReceived, handleMessageReceived);
            socket.off(SocketEvents.RoomLeft, handleRoomLeft);
        };
    }, [socket]); // This useEffect runs when the socket instance becomes available

    /**
     * Emits a Socket.IO event to the server with strong typing.
     */
    const emit = useCallback(<EventName extends keyof SocketEventHandlers>(eventName: EventName, ...args: Parameters<SocketEventHandlers[EventName]>) => {
        if (socket && socket.connected) {
            socket.emit(eventName, ...args);
            console.log(`[Socket.emit] Emitted event: ${eventName}`, args);
        } else {
            console.warn(`[Socket.emit] Cannot emit event '${eventName}' - Socket.IO is not connected or not initialized.`);
        }
    }, [socket]);

    /**
     * Registers a handler for a Socket.IO event with strong typing.
     */
    const on = useCallback(<EventName extends keyof SocketEventHandlers>(eventName: EventName, handler: SocketEventHandlers[EventName]) => {
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

    // Specific chat-related event emitters, using the generic 'emit' function
    const joinRoom = useCallback((roomId: string, username: string) => {
        // Clear messages before joining a new room to avoid mixing histories
        setMessages([]);
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
        messages, // ADDED: Provide messages state
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

export function useSocket() {
    const context = useContext(SocketContext);
    if (context === undefined) {
        throw new Error('useSocket must be used within a SocketProvider');
    }
    return context;
}
