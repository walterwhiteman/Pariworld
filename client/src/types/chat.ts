// Chat message types
export interface ChatMessage {
    id: string; // CORRECT: This is now correctly 'string'
    roomId: string;
    username: string; // Changed from 'sender' to 'username' for consistency
    content?: string;
    imageData?: string;
    messageType: 'text' | 'image' | 'system';
    timestamp: Date;
    isSelf?: boolean; // Your new addition, which is fine for frontend state
}

// Socket event NAMES (as an enum for runtime usage)
export enum SocketEvents {
    // Client to server events
    JoinRoom = 'room:join',
    LeaveRoom = 'room:leave',
    SendMessage = 'chat:message',
    TypingStart = 'chat:typing_start',
    TypingStop = 'chat:typing_stop',
    WebRTCSignal = 'webrtc-signal', // ADDED: WebRTC signaling event

    // Server to client events
    ConnectionEstablished = 'connection-established', // ADDED: Event emitted on successful socket connection
    RoomJoined = 'room:joined',
    RoomLeft = 'room:left',
    MessageReceived = 'chat:message_received',
    // RENAMED from MessageHistory for consistency with backend:
    RoomMessagesLoaded = 'room:messages_loaded',
    TypingStatus = 'chat:typing_status', // Renamed from UserTyping for consistency
    ParticipantUpdate = 'room:participant_update', // Added for participant count updates
    Error = 'error',
    // ConnectionStatus removed as its role is largely handled by other events/useSocket internal state
}

// Socket event HANDLERS (as an interface for type checking)
export interface SocketEventHandlers {
    // Client emits (to server)
    'room:join': (data: { roomId: string; username: string }) => void;
    'room:leave': (data: { roomId: string; username: string }) => void;
    // Corrected SendMessage payload to match backend expectation
    'chat:message': (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
    'chat:typing_start': (data: { roomId: string; username: string }) => void;
    'chat:typing_stop': (data: { roomId: string; username: string }) => void;
    'webrtc-signal': (payload: { roomId: string; sender: string; recipient: string; type: string; data: any }) => void; // ADDED: WebRTC signal payload

    // Server emits (to client)
    'connection-established': (payload: { connected: boolean }) => void; // ADDED: Event signature
    'room:joined': (data: { roomId: string; username: string }) => void; // Payload simplified from participants: string[]
    'room:left': (data: { roomId: string; username: string }) => void;
    'chat:message_received': (message: ChatMessage) => void;
    // Corrected event name and payload for historical messages
    'room:messages_loaded': (messages: ChatMessage[]) => void;
    'chat:typing_status': (data: { roomId: string; username: string; isTyping: boolean }) => void; // Corrected payload
    'room:participant_update': (data: { roomId: string; count: number }) => void; // Added signature for participant updates
    'error': (data: { message: string }) => void;
    // 'connection-status' removed from handlers as it's not directly emitted by backend for client consumption in this way
    'webrtc-signal': (payload: { roomId: string; sender: string; recipient: string; type: string; data: any }) => void; // ADDED: WebRTC signal payload

    // Generic fallback for other events if needed, though specific is better
    [key: string]: (...args: any[]) => void;
}

// Room state
export interface RoomState {
    roomId: string;
    username: string;
    isConnected: boolean;
    participants: { id: string, username: string, isTyping: boolean }[]; // Changed to objects to track typing status
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

// WebRTC signaling messages
export interface WebRTCSignal {
    type: 'offer' | 'answer' | 'ice-candidate' | 'call-start' | 'call-end';
    data: any;
    roomId: string;
    sender: string;
    recipient?: string;
}
