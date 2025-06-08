// src/types/chat.ts

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
    // NEW: Add message status
    status?: 'sent' | 'delivered' | 'seen'; // 'sent': single tick, 'delivered': double tick (gray), 'seen': double tick (blue)
}

// Socket event NAMES (as an enum for runtime usage)
export enum SocketEvents {
    // Client to server events
    JoinRoom = 'join-room',
    LeaveRoom = 'leave-room',
    SendMessage = 'send-message',
    TypingStart = 'typing-start',
    TypingStop = 'typing-stop',
    // NEW: Message status acknowledgments
    MessageDelivered = 'message-delivered',
    MessagesSeen = 'messages-seen',

    // WebRTC related client-to-server events (specific, not generic 'webrtc-signal')
    CallUser = 'call-user', // Initiating a call
    MakeAnswer = 'make-answer', // Answering a call
    SendIceCandidate = 'send-ice-candidate', // Exchanging ICE candidates
    RejectCall = 'reject-call', // Rejecting an incoming call
    EndCall = 'end-call', // Ending an active call
    AcceptCall = 'accept-call', // Accepting an incoming call

    // Server to client events
    ConnectionEstablished = 'connection-established',
    RoomJoined = 'room-joined',
    RoomLeft = 'room-left',
    MessageReceived = 'message-received',
    MessageHistory = 'message-history',
    UserTyping = 'user-typing',
    Error = 'error',
    ConnectionStatus = 'connection-status',
    // NEW: Message status updates from server
    MessageStatusUpdate = 'message-status-update',

    // WebRTC related server-to-client events (specific, not generic 'webrtc-signal')
    CallOffer = 'call-offer', // Incoming call offer
    CallAnswer = 'call-answer', // Incoming call answer
    IceCandidate = 'ice-candidate', // Incoming ICE candidate
    CallRejected = 'call-rejected', // Call rejected by recipient
    CallEnded = 'call-ended', // Call ended by remote user
    CallBusy = 'call-busy', // Recipient is busy
    CallRinging = 'call-ringing', // Recipient's device is ringing
    CallAccepted = 'call-accepted', // Recipient accepted call
    CallParticipantJoined = 'call-participant-joined', // Other peer joined WebRTC connection
}

// Socket event HANDLERS (as an interface for type checking)
export interface SocketEventHandlers {
    // Client emits (to server)
    // MODIFIED: join-room now expects a single data object as the first argument
    [SocketEvents.JoinRoom]: (data: { roomId: string; username: string }, callback: (response: { success: boolean; message?: string }) => void) => void;
    [SocketEvents.LeaveRoom]: (roomId: string, username: string) => void;
    [SocketEvents.SendMessage]: (message: ChatMessage) => void; // MODIFIED: Now sends full ChatMessage object
    [SocketEvents.TypingStart]: (roomId: string, username: string, isTyping: boolean) => void; // MODIFIED: Added isTyping
    [SocketEvents.TypingStop]: (roomId: string, username: string, isTyping: boolean) => void; // MODIFIED: Added isTyping
    // NEW: Message status acknowledgments
    [SocketEvents.MessageDelivered]: (roomId: string, messageId: string, recipientUsername: string) => void; // Corrected to match emit in useSocket.ts
    [SocketEvents.MessagesSeen]: (data: { roomId: string; messageIds: string[]; username: string }[]) => void; // Array of seen messages

    // WebRTC related client-to-server events
    [SocketEvents.CallUser]: (targetUser: string, offer: RTCSessionDescriptionInit, roomId: string) => void; // Corrected to match emit in useSocket.ts
    [SocketEvents.MakeAnswer]: (to: string, answer: RTCSessionDescriptionInit, roomId: string) => void; // Corrected to match emit in useSocket.ts
    [SocketEvents.SendIceCandidate]: (to: string, candidate: RTCIceCandidateInit, roomId: string) => void; // Corrected to match emit in useSocket.ts
    [SocketEvents.RejectCall]: (to: string, roomId: string) => void; // Corrected to match emit in useSocket.ts
    [SocketEvents.EndCall]: (to: string, roomId: string) => void; // Corrected to match emit in useSocket.ts
    [SocketEvents.AcceptCall]: (to: string, roomId: string) => void; // Corrected to match emit in useSocket.ts


    // Server emits (to client)
    [SocketEvents.ConnectionEstablished]: (payload: { connected: boolean }) => void;
    [SocketEvents.RoomJoined]: (data: { roomId: string; participants: string[] }) => void;
    [SocketEvents.RoomLeft]: (data: { roomId: string; username: string }) => void;
    [SocketEvents.MessageReceived]: (message: ChatMessage) => void;
    [SocketEvents.MessageHistory]: (payload: { roomId: string; messages: ChatMessage[] }) => void;
    [SocketEvents.UserTyping]: (data: { username: string; isTyping: boolean }) => void;
    [SocketEvents.Error]: (data: { message: string }) => void;
    [SocketEvents.ConnectionStatus]: (data: { connected: boolean; participantCount: number; username: string }) => void;
    // NEW: Message status updates from server
    [SocketEvents.MessageStatusUpdate]: (data: { messageId: string; status: 'delivered' | 'seen' }) => void;

    // WebRTC related server-to-client events
    [SocketEvents.CallOffer]: (data: { sender: string; offer: RTCSessionDescriptionInit }) => void;
    [SocketEvents.CallAnswer]: (data: { sender: string; answer: RTCSessionDescriptionInit }) => void;
    [SocketEvents.IceCandidate]: (data: { sender: string; candidate: RTCIceCandidateInit }) => void;
    [SocketEvents.CallRejected]: (data: { sender: string }) => void;
    [SocketEvents.CallEnded]: (data: { sender: string }) => void;
    [SocketEvents.CallBusy]: (data: { sender: string }) => void;
    [SocketEvents.CallRinging]: (data: { sender: string }) => void;
    [SocketEvents.CallAccepted]: (data: { sender: string }) => void;
    [SocketEvents.CallParticipantJoined]: (data: { username: string }) => void;

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
    // NEW: Add incoming call state
    incomingCallOffer: RTCSessionDescriptionInit | null;
    incomingCallerUsername: string | null;
    callStartTime: number | null; // Timestamp when call started
}

// WebRTC signaling messages - Your provided interface is perfect for this.
export interface WebRTCSignal {
    type: 'offer' | 'answer' | 'ice-candidate' | 'call-start' | 'call-end';
    data: any;
    roomId: string;
    sender: string;
    recipient?: string; // ADDED: Recipient is used in the backend signal forwarding
}
