import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';

import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal';
import { VideoCallOverlay } from '@/components/chat/VideoCallOverlay';
import { NotificationToast } from '@/components/chat/NotificationToast';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { ChatMessage, NotificationData, RoomState, VideoCallState } from '@/types/chat';

export default function ChatPage() {
  const [roomState, setRoomState] = useState<RoomState>({
    roomId: '',
    username: '',
    isConnected: false,
    participants: [],
    messages: []
  });

  const [isRoomModalOpen, setIsRoomModalOpen] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [typingUser, setTypingUser] = useState<string | undefined>();
  const [notifications, setNotifications] = useState<NotificationData[]>([]);

  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const [location] = useLocation();

  const socket = useSocket(); // Get socket context here

  // Call useWebRTC without passing 'socket' as a parameter
  const webRTC = useWebRTC(roomState.roomId, roomState.username, localVideoRef, remoteVideoRef); // <--- CORRECTED CALL

  const addNotification = useCallback((
    type: NotificationData['type'],
    title: string,
    message: string,
    duration?: number
  ) => {
    const notification: NotificationData = {
      id: Date.now().toString(),
      type,
      title,
      message,
      duration
    };

    setNotifications(prev => [...prev, notification]);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const generateMessageId = useCallback((): string => {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  const handleJoinRoom = useCallback((roomId: string, username: string) => {
    if (!socket.isConnected || !socket.socket) {
      addNotification('error', 'Connection Error', 'Unable to connect to chat server (Socket not ready)');
      return;
    }

    setIsConnecting(true);

    setRoomState(prev => ({
      ...prev,
      roomId,
      username,
      isConnected: false,
      messages: []
    }));

    socket.joinRoom(roomId, username);
  }, [socket, addNotification]);

  const handleLeaveRoom = useCallback(() => {
    if (roomState.roomId && roomState.username) {
      socket.leaveRoom(roomState.roomId, roomState.username);
    }

    if (webRTC.callState.isActive) {
      webRTC.endCall();
    }

    setRoomState({
      roomId: '',
      username: '',
      isConnected: false,
      participants: [],
      messages: []
    });

    setIsRoomModalOpen(true);
    setIsConnecting(false);
    setTypingUser(undefined);
    setIsCallMinimized(false);

    addNotification('info', 'Left Room', 'You have left the chat room');
  }, [roomState, socket, webRTC, addNotification]);

  const handleSendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    if (!roomState.isConnected || !socket.socket) {
      addNotification('error', 'Connection Error', 'Not connected to chat room (Socket not ready)');
      return;
    }

    const completeMessage: ChatMessage = {
      ...message,
      id: generateMessageId(),
      timestamp: new Date(),
      isSelf: true
    };

    setRoomState(prev => ({
      ...prev,
      messages: [...prev.messages, completeMessage]
    }));

    socket.sendMessage(message);
  }, [roomState.isConnected, socket, addNotification, generateMessageId]);

  const handleTypingStart = useCallback(() => {
    if (roomState.isConnected && socket.socket) {
      socket.sendTypingStatus(roomState.roomId, roomState.username, true);
    }
  }, [roomState, socket]);

  const handleTypingStop = useCallback(() => {
    if (roomState.isConnected && socket.socket) {
      socket.sendTypingStatus(roomState.roomId, roomState.username, false);
    }
  }, [roomState, socket]);

  const minimizeCall = useCallback(() => {
    if (webRTC.callState.isActive) {
      setIsCallMinimized(true);
    }
  }, [webRTC.callState.isActive]);

  const expandCall = useCallback(() => {
    setIsCallMinimized(false);
  }, []);

  useEffect(() => {
    if (!socket.socket) {
        console.warn('Socket instance not yet available for event listeners.');
        return;
    }

    const unsubscribeRoomJoined = socket.on('room-joined', (data: { roomId: string; participants: string[] }) => {
      console.log('Room joined successfully:', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: true,
        participants: data.participants
      }));

      setIsRoomModalOpen(false);
      setIsConnecting(false);

      const systemMessage: ChatMessage = {
        id: generateMessageId(),
        roomId: data.roomId,
        sender: 'System',
        content: 'You joined the chat',
        messageType: 'system',
        timestamp: new Date()
      };

      setRoomState(prev => ({
        ...prev,
        messages: [...prev.messages, systemMessage]
      }));
    });

    const unsubscribeRoomLeft = socket.on('room-left', (data: { roomId: string; username: string }) => {
      console.log('User left room:', data);

      if (data.username !== roomState.username) {
        setRoomState(prev => ({
          ...prev,
          participants: prev.participants.filter(p => p !== data.username)
        }));

        const systemMessage: ChatMessage = {
          id: generateMessageId(),
          roomId: data.roomId,
          sender: 'System',
          content: `${data.username} left the chat`,
          messageType: 'system',
          timestamp: new Date()
        };

        setRoomState(prev => ({
          ...prev,
          messages: [...prev.messages, systemMessage]
        }));
      }
    });

    const unsubscribeMessageReceived = socket.on('message-received', (message: ChatMessage) => {
      console.log('Message received:', message);

      if (message.sender === roomState.username) {
        return;
      }

      const receivedMessage: ChatMessage = {
        ...message,
        timestamp: new Date(message.timestamp),
        isSelf: false
      };

      setRoomState(prev => ({
        ...prev,
        messages: [...prev.messages, receivedMessage]
      }));
    });

    const unsubscribeMessageHistory = socket.on('message-history', (data: { roomId: string; messages: ChatMessage[] }) => {
      console.log('Message history received:', data);
      setRoomState(prev => ({
        ...prev,
        messages: data.messages.map(msg => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
          isSelf: msg.sender === roomState.username
        }))
      }));
    });

    const unsubscribeUserTyping = socket.on('user-typing', (data: { username: string; isTyping: boolean }) => {
      console.log('User typing:', data);

      if (data.username !== roomState.username) {
        setTypingUser(data.isTyping ? data.username : undefined);
      }
    });

    const unsubscribeConnectionStatus = socket.on('connection-status', (data: { connected: boolean; participantCount: number; username: string }) => {
      console.log('Connection status:', data);

      setRoomState(prev => ({
        ...prev,
        isConnected: data.connected,
        participants: data.username ? [...new Set([...prev.participants, data.username])] : prev.participants
      }));
    });

    const unsubscribeError = socket.on('error', (data: { message: string }) => {
      console.error('Socket error:', data);
      addNotification('error', 'Error', data.message);
      setIsConnecting(false);
    });

    return () => {
      unsubscribeRoomJoined();
      unsubscribeRoomLeft();
      unsubscribeMessageReceived();
      unsubscribeMessageHistory();
      unsubscribeUserTyping();
      unsubscribeConnectionStatus();
      unsubscribeError();
    };
  }, [socket.socket, roomState.username, generateMessageId, addNotification]);

  useEffect(() => {
    if (socket.connectionError) {
      addNotification('error', 'Connection Failed', socket.connectionError);
      setIsConnecting(false);
    }
  }, [socket.connectionError, addNotification]);

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      <RoomJoinModal
        isOpen={isRoomModalOpen}
        onJoinRoom={handleJoinRoom}
        isConnecting={isConnecting}
      />

      {!isRoomModalOpen && (
        <>
          <ChatHeader
            roomId={roomState.roomId}
            isConnected={roomState.isConnected}
            participantCount={roomState.participants.length}
            onStartVideoCall={webRTC.startCall}
            onLeaveRoom={handleLeaveRoom}
          />

          <ChatMessages
            messages={roomState.messages}
            currentUsername={roomState.username}
            typingUser={typingUser}
          />

          <MessageInput
            onSendMessage={handleSendMessage}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            roomId={roomState.roomId}
            username={roomState.username}
            disabled={!roomState.isConnected}
          />

          {webRTC.callState.isActive && !isCallMinimized && (
            <VideoCallModal
              isOpen={true}
              callState={webRTC.callState}
              localVideoRef={localVideoRef}
              remoteVideoRef={remoteVideoRef}
              onEndCall={webRTC.endCall}
              onToggleVideo={webRTC.toggleVideo}
              onToggleAudio={webRTC.toggleAudio}
              formatCallDuration={webRTC.formatCallDuration}
              onMinimizeCall={minimizeCall}
            />
          )}

          {webRTC.callState.isActive && isCallMinimized && (
            <VideoCallOverlay
              callState={webRTC.callState}
              localVideoRef={localVideoRef}
              remoteVideoRef={remoteVideoRef}
              onExpandCall={expandCall}
              onEndCall={webRTC.endCall}
            />
          )}
        </>
      )}

      <NotificationToast
        notifications={notifications}
        onDismiss={dismissNotification}
      />
    </div>
  );
}
