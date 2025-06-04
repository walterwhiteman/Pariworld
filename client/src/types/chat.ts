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

// Socket event types
export interface SocketEvents {
  // Client to server events
  'join-room': (data: { roomId: string; username: string }) => void;
  'leave-room': (data: { roomId: string; username: string }) => void;
  'send-message': (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  'typing-start': (data: { roomId: string; username: string }) => void;
  'typing-stop': (data: { roomId: string; username: string }) => void;
  
  // Server to client events
  'room-joined': (data: { roomId: string; participants: string[] }) => void;
  'room-left': (data: { roomId: string; username: string }) => void;
  'message-received': (message: ChatMessage) => void;
  'user-typing': (data: { username: string; isTyping: boolean }) => void;
  'error': (data: { message: string }) => void;
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
