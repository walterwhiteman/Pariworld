// src/pages/chat.tsx (ChatPage.tsx)
import { useState, useCallback, useEffect, useRef } from 'react'; // Import useRef
import { useLocation } from 'wouter'; // Import useLocation from wouter

import { RoomJoinModal } from '@/components/chat/RoomJoinModal';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { MessageInput } from '@/components/chat/MessageInput';
import { VideoCallModal } from '@/components/chat/VideoCallModal';
import { VideoCallOverlay } from '@/components/chat/VideoCallOverlay'; // We will create this
import { NotificationToast } from '@/components/chat/NotificationToast';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { ChatMessage, NotificationData, RoomState } from '@/types/chat';

export default function ChatPage() {
  // ... (existing state variables)

  // New state for managing video call view mode
  const [isCallMinimized, setIsCallMinimized] = useState(false);
  const [location, setLocation] = useLocation(); // Hook to get current path

  // Use current roomId and username from roomState for useWebRTC hook
  const { roomId, username } = roomState;
  const socket = useSocket();
  const webRTC = useWebRTC(socket, roomId, username); // Pass directly

  // ... (existing utility functions like addNotification, dismissNotification, generateMessageId)

  // ... (existing handleJoinRoom, handleLeaveRoom, handleSendMessage, handleTypingStart, handleTypingStop)

  // Function to minimize the call
  const minimizeCall = useCallback(() => {
    if (webRTC.callState.isActive) {
      setIsCallMinimized(true);
    }
  }, [webRTC.callState.isActive]);

  // Function to expand the call back to full screen
  const expandCall = useCallback(() => {
    setIsCallMinimized(false);
  }, []);

  // Effect to handle navigation changes and minimize the call
  useEffect(() => {
    // If the call is active and we navigate away from the chat path ('/'), minimize it.
    // Adjust this logic based on your specific routing needs.
    // For a single-page app where chat is '/', navigating away means changing path.
    // If your chat has sub-routes like '/chat/room/:id', adjust this condition.
    if (webRTC.callState.isActive) {
      // This effect runs on component mount and on location change.
      // If the current path is NOT the root chat path (assuming / is chat)
      // and the call is active, minimize it.
      if (location !== '/') { // Assuming '/' is your main chat path
        minimizeCall();
      } else {
        // If we navigate back to the chat path, ensure it's not minimized
        expandCall();
      }
    }
  }, [location, webRTC.callState.isActive, minimizeCall, expandCall]);


  // ... (existing useEffect for socket event listeners)

  // ... (existing useEffect for socket.connectionError)

  // ... (existing useEffect for isCallActiveOverride)

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Room Join Modal */}
      <RoomJoinModal
        isOpen={isRoomModalOpen}
        onJoinRoom={handleJoinRoom}
        isConnecting={isConnecting}
      />

      {/* Main Chat Interface */}
      {!isRoomModalOpen && (
        <>
          {/* Chat Header */}
          <ChatHeader
            roomId={roomState.roomId}
            isConnected={roomState.isConnected}
            participantCount={roomState.participants.length}
            onStartVideoCall={webRTC.startCall}
            onLeaveRoom={handleLeaveRoom}
          />

          {/* Chat Messages */}
          <ChatMessages
            messages={roomState.messages}
            currentUsername={roomState.username}
            typingUser={typingUser}
          />

          {/* Message Input */}
          <MessageInput
            onSendMessage={handleSendMessage}
            onTypingStart={handleTypingStart}
            onTypingStop={handleTypingStop}
            roomId={roomState.roomId}
            username={roomState.username}
            disabled={!roomState.isConnected}
          />

          {/* Conditional Rendering of Video Call UI */}
          {webRTC.callState.isActive && !isCallMinimized && (
            <VideoCallModal
              isOpen={true} // Only open if call is active and not minimized
              callState={webRTC.callState}
              localVideoRef={webRTC.localVideoRef}
              remoteVideoRef={webRTC.remoteVideoRef}
              onEndCall={webRTC.endCall}
              onToggleVideo={webRTC.toggleVideo}
              onToggleAudio={webRTC.toggleAudio}
              formatCallDuration={webRTC.formatCallDuration}
            />
          )}

          {/* Video Call Overlay (Minimized View) */}
          {webRTC.callState.isActive && isCallMinimized && (
            <VideoCallOverlay
              callState={webRTC.callState}
              localVideoRef={webRTC.localVideoRef}
              remoteVideoRef={webRTC.remoteVideoRef}
              onExpandCall={expandCall}
              onEndCall={webRTC.endCall}
            />
          )}
        </>
      )}

      {/* Notification Toasts */}
      <NotificationToast
        notifications={notifications}
        onDismiss={dismissNotification}
      />
    </div>
  );
}
