// Chat message types
export interface ChatMessage {
    id: string; // CORRECT: This is now correctly 'string'
    roomId: string;
    sender: string;
    content?: string;
    imageData?: string;
    messageType: 'text' | 'image' | 'system';
    timestamp: Date;
    isSelf?: boolean; // Your new addition, which is fine for frontend state
}

// Socket event NAMES (as an enum for runtime usage)
export enum SocketEvents {
    // Client to server events
    JoinRoom = 'join-room',
    LeaveRoom = 'leave-room',
    SendMessage = 'send-message',
    TypingStart = 'typing-start',
    TypingStop = 'typing-stop',
    WebRTCSignal = 'webrtc-signal', // ADDED: WebRTC signaling event

    // Server to client events
    ConnectionEstablished = 'connection-established', // ADDED: Event emitted on successful socket connection
    RoomJoined = 'room-joined',
    RoomLeft = 'room-left',
    MessageReceived = 'message-received',
    MessageHistory = 'message-history', // ADDED: From previous backend code, for initial messages
    UserTyping = 'user-typing',
    Error = 'error',
    ConnectionStatus = 'connection-status',
}

// Socket event HANDLERS (as an interface for type checking)
export interface SocketEventHandlers {
    // Client emits (to server)
    'join-room': (data: { roomId: string; username: string }) => void;
    'leave-room': (data: { roomId: string; username: string }) => void;
    'send-message': (message: Omit<ChatMessage, 'id' | 'timestamp' | 'roomId' | 'sender'>) => void;
    'typing-start': (data: { roomId: string; username: string }) => void;
    'typing-stop': (data: { roomId: string; username: string }) => void;
    'webrtc-signal': (payload: { roomId: string; sender: string; recipient: string; type: string; data: any }) => void; // ADDED: WebRTC signal payload

    // Server emits (to client)
    'connection-established': (payload: { connected: boolean }) => void; // ADDED: Event signature
    'room-joined': (data: { roomId: string; participants: string[] }) => void;
    'room-left': (data: { roomId: string; username: string }) => void;
    'message-received': (message: ChatMessage) => void;
    'message-history': (payload: { roomId: string; messages: ChatMessage[] }) => void; // ADDED: Event signature
    'user-typing': (data: { username: string; isTyping: boolean }) => void;
    'error': (data: { message: string }) => void;
    'connection-status': (data: { connected: boolean; participantCount: number; username: string }) => void; // MODIFIED: Added username
    'webrtc-signal': (payload: { roomId: string; sender: string; recipient: string; type: string; data: any }) => void; // ADDED: WebRTC signal payload

    // Generic fallback for other events if needed, though specific is better
    [key: string]: (...args: any[]) => void;
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

// Video call types (for WebRTC stretch goal)
export interface VideoCallState {
    isActive: boolean;
    isLocalVideoEnabled: boolean;
    isLocalAudioEnabled: boolean;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    callDuration: number;
}

// WebRTC signaling messages - Your provided interface is perfect for this.
export interface WebRTCSignal {
    type: 'offer' | 'answer' | 'ice-candidate' | 'call-start' | 'call-end';
    data: any;
    roomId: string;
    sender: string;
    recipient?: string; // ADDED: Recipient is used in the backend signal forwarding
}
