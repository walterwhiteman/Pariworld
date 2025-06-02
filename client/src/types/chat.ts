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

// Socket event types (as an ENUM for runtime usage)
export enum SocketEvents {
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
  UserTyping = 'user-typing',
  Error = 'error',
  ConnectionStatus = 'connection-status',
  ConnectionEstablished = 'connection-established', // Added this as it's emitted in useSocket
  MessageHistory = 'message-history', // Added this as it's used in ChatPage
  // Add any other events you use or plan to use here
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

// WebRTC signaling messages
export interface WebRTCSignal {
  type: 'offer' | 'answer' | 'ice-candidate' | 'call-start' | 'call-end';
  data: any;
  roomId: string;
  sender: string;
}
