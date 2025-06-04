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
    TypingStatus = 'typing-status', // Consistent with backend
    Error = 'error',
    ConnectionStatus = 'connection-status',
    MessageHistory = 'message-history', // Added for clarity
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

// REMOVED: VideoCallState and WebRTCSignal interfaces for debugging
/*
export interface VideoCallState {
    isActive: boolean;
    isLocalVideoEnabled: boolean;
    isLocalAudioEnabled: boolean;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    callDuration: number;
    status: 'idle' | 'calling' | 'incoming' | 'active' | 'ended';
    callingUser: string | null;
    isModalOpen: boolean;
}

export interface WebRTCSignal {
    type: 'offer' | 'answer' | 'ice-candidate' | 'call-start' | 'call-end' | 'call-accepted' | 'call-rejected' | 'call-hangup';
    data: any;
    roomId: string;
    sender: string;
    recipient?: string;
}
*/
