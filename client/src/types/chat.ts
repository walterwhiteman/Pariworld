// Chat message types
export interface ChatMessage {
    id: string;
    roomId: string;
    sender: string;
    content?: string;
    imageData?: string;
    messageType: 'text' | 'image' | 'system';
    timestamp: Date;
    isSelf?: boolean;
}

// Socket event NAMES (as an enum for runtime usage)
export enum SocketEvents {
    // Client to server events
    JoinRoom = 'join-room',
    LeaveRoom = 'leave-room',
    SendMessage = 'send-message',
    TypingStart = 'typing-start',
    TypingStop = 'typing-stop',
    WebRTCSignal = 'webrtc-signal',

    // Server to client events
    ConnectionEstablished = 'connection-established',
    RoomJoined = 'room-joined',
    RoomLeft = 'room-left',
    MessageReceived = 'message-received',
    MessageHistory = 'message-history',
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
    'webrtc-signal': (payload: { roomId: string; sender: string; recipient: string; type: string; data: any }) => void;

    // Server emits (to client)
    'connection-established': (payload: { connected: boolean }) => void;
    'room-joined': (data: { roomId: string; participants: string[] }) => void;
    'room-left': (data: { roomId: string; username: string }) => void;
    'message-received': (message: ChatMessage) => void;
    'message-history': (payload: { roomId: string; messages: ChatMessage[] }) => void;
    'user-typing': (data: { username: string; isTyping: boolean }) => void;
    'error': (data: { message: string }) => void;
    'connection-status': (data: { connected: boolean; participantCount: number; username: string }) => void;
    'webrtc-signal': (payload: { roomId: string; sender: string; recipient: string; type: string; data: any }) => void;

    // Generic fallback for other events if needed, though specific is better
    [key: string]: (...args: any[]) => void;
}

// REMOVED: SocketContextType definition from here. It will be in useSocket.ts

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

// Video call types (for WebRTC hook and components)
export interface VideoCallState {
    isActive: boolean;
    isInitiator: boolean;
    isRinging: boolean;
    isAnswered: boolean;
    isLocalVideoEnabled: boolean;
    isLocalAudioEnabled: boolean;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    remoteUser: string | null;
    hasLocalStream: boolean;
    hasRemoteStream: boolean;
    callDuration: number;
    error: string | null;
}

// WebRTC signaling messages
export interface WebRTCSignal {
    type: 'offer' | 'answer' | 'ice-candidate' | 'call-start' | 'call-end';
    data: any;
    roomId: string;
    sender: string;
    recipient?: string;
}
