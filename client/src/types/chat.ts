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

// MODIFIED: Define SocketEvents as a const enum for actual event names
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
    // It's good practice to use consistent casing like 'typing-status'
    // in your backend and frontend. Assuming 'typing-status' from previous discussion.
    TypingStatus = 'typing-status', // Changed from 'user-typing' to 'typing-status' for consistency
    Error = 'error',
    ConnectionStatus = 'connection-status',
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
    status: 'idle' | 'calling' | 'incoming' | 'active' | 'ended'; // Add call status
    callingUser: string | null; // User initiating the call
}

// WebRTC signaling messages
export interface WebRTCSignal {
    type: 'offer' | 'answer' | 'ice-candidate' | 'call-start' | 'call-end' | 'call-accepted' | 'call-rejected' | 'call-hangup'; // Expanded types
    data: any;
    roomId: string;
    sender: string; // The user who sent the signal
    recipient?: string; // The intended recipient for 1-on-1 calls
}
