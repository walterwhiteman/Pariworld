// Chat message types
export interface ChatMessage {
    id: string;
    roomId: string;
    sender: string;
    content?: string;
    imageData?: string;
    messageType: 'text' | 'image' | 'system';
    timestamp: string; // MODIFIED: Changed to string to match toISOString()
    isSelf?: boolean;
}

// Define SocketEvents as a const enum for actual event names
export const enum SocketEvents {
    // Client to server events
    JoinRoom = 'join-room',
    LeaveRoom = 'leave-room',
    SendMessage = 'send-message',
    TypingStart = 'typing-start',
    TypingStop = 'typing-stop',

    // Server to client events
    RoomJoined = 'room-joined',
    RoomLeft = 'room-left',
    MessageReceived = 'message-received',
    TypingStatus = 'typing-status',
    Error = 'error',
    ConnectionStatus = 'connection-status',
    MessageHistory = 'message-history',
}

// Room state
export interface RoomState {
    roomId: string;
    username: string;
    isConnected: boolean;
    participants: string[];
    messages: ChatMessage[];
}

// Notification types
export interface NotificationData {
    id: string;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message: string;
    duration?: number;
}
