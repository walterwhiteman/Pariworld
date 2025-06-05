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
// This enum provides the actual string values for your event names
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
  Error = 'error', // Renamed from 'error' to avoid potential conflicts with global Error object
  ConnectionStatus = 'connection-status',
}

// Socket event HANDLERS (as an interface for type checking)
// This interface describes the *signature* of the event listeners/emitters
export interface SocketEventHandlers {
  'join-room': (data: { roomId: string; username: string }) => void;
  'leave-room': (data: { roomId: string; username: string }) => void;
  'send-message': (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  'typing-start': (data: { roomId: string; username: string }) => void;
  'typing-stop': (data: { roomId: string; username: string }) => void;

  'room-joined': (data: { roomId: string; participants: string[] }) => void;
  'room-left': (data: { roomId: string; username: string }) => void;
  'message-received': (message: ChatMessage) => void;
  'user-typing': (data: { username: string; isTyping: boolean }) => void;
  'error': (data: { message: string }) => void; // Using the original string literal
  'connection-status': (data: { connected: boolean; participantCount: number }) => void;
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
