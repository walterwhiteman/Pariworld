// src/components/chat/ChatMessages.tsx
import { useEffect, useRef } from 'react';
import { ChatMessage } from '@/types/chat';
import { User } from 'lucide-react';

interface ChatMessagesProps {
  messages: ChatMessage[];
  currentUsername: string;
  typingUser?: string;
  onImageClick: (imageUrl: string) => void;
  className?: string; // IMPORTANT: Ensure this prop is defined
}

/**
 * Chat messages container component that displays all messages in a scrollable area
 * Handles message rendering, auto-scrolling, and typing indicators
 */
export function ChatMessages({ messages, currentUsername, typingUser, onImageClick, className }: ChatMessagesProps) { // IMPORTANT: Add className to destructuring
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  /**
   * Auto-scroll to bottom when new messages arrive
   */
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, typingUser]);

  /**
   * Format timestamp for display
   */
  const formatTime = (timestamp: Date): string => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  /**
   * Get initials from username
   */
  const getInitials = (username: string): string => {
    return username
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  /**
   * Render a message bubble
   */
  const renderMessage = (message: ChatMessage) => {
    const isSelf = message.sender === currentUsername;
    const isSystem = message.messageType === 'system';

    // System messages (join/leave notifications)
    if (isSystem) {
      return (
        <div key={message.id} className="flex justify-center">
          <div className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
            {message.content}
          </div>
        </div>
      );
    }

    // Regular messages
    return (
      <div
        key={message.id}
        // Outer message wrapper. 'flex-row-reverse' for self moves avatar to the right.
        className={`flex items-start space-x-3 ${isSelf ? 'flex-row-reverse space-x-reverse' : ''}`}
      >
        {/* Avatar */}
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
            isSelf ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          {getInitials(message.sender) ? (
            <span className={`text-sm font-medium ${isSelf ? 'text-white' : 'text-gray-600'}`}>
              {getInitials(message.sender)}
            </span>
          ) : (
            <User className={`h-4 w-4 ${isSelf ? 'text-white' : 'text-gray-600'}`} />
          )}
        </div>

        {/* Message Content & Info Wrapper */}
        {/* MODIFIED: Changed max-w-* to max-w-[75%] to ensure a consistent gap on the opposite side. */}
        <div
          className={`max-w-[75%] ${ // THIS IS THE MODIFIED LINE
            isSelf ? 'ml-auto' : 'mr-auto' // 'ml-auto' pushes it to the right for self, 'mr-auto' pushes it to the left for others
          }`}
        >
          <div
            className={`shadow-sm ${
              isSelf
                ? 'bg-blue-600 text-white rounded-2xl rounded-tr-md'
                : 'bg-white border border-gray-200 text-gray-900 rounded-2xl rounded-tl-md'
            } px-4 py-2`} // The actual message bubble
          >
            {/* Image Message */}
            {message.messageType === 'image' && message.imageData && (
              <div className="mb-2">
                <img
                  src={message.imageData}
                  alt="Shared image"
                  className="w-40 h-40 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => onImageClick(message.imageData!)}
                />
              </div>
            )}

            {/* Text Content */}
            {message.content && (
              <p className="break-words">{message.content}</p>
            )}
          </div>

          {/* Message Info */}
          <div className={`mt-1 flex items-center space-x-2 ${isSelf ? 'justify-end' : 'justify-start'}`}>
            {!isSelf && (
              <span className="text-xs text-gray-500">{message.sender}</span>
            )}
            <span className="text-xs text-gray-400">
              {formatTime(message.timestamp)}
            </span>
            {isSelf && (
              <span className="text-xs text-gray-500">You</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  /**
   * Render typing indicator
   */
  const renderTypingIndicator = () => {
    if (!typingUser || typingUser === currentUsername) return null;

    return (
      <div className="flex items-start space-x-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-300">
          <span className="text-sm font-medium text-gray-600">
            {getInitials(typingUser)}
          </span>
        </div>
        <div className="rounded-2xl rounded-tl-md bg-white border border-gray-200 px-4 py-3 shadow-sm">
          <div className="flex space-x-1">
            <div className="h-2 w-2 animate-bounce rounded-full bg-gray-400"></div>
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
              style={{ animationDelay: '0.1s' }}
            ></div>
            <div
              className="h-2 w-2 animate-bounce rounded-full bg-gray-400"
              style={{ animationDelay: '0.2s' }}
            ></div>
          </div>
        </div>
      </div>
    );
  };

  return (
    // Apply the passed 'className' prop here.
    // This allows chat.tsx to control overflow and padding directly on this component.
    <main className={`flex flex-1 flex-col ${className}`}>
      <div
        ref={containerRef}
        // These classes are now handled by the 'className' prop from chat.tsx
        className="flex-1 space-y-4" // 'flex-1' ensures it grows, 'space-y-4' provides spacing between messages
        style={{ scrollBehavior: 'smooth' }}
      >
        {/* Render all messages */}
        {messages.map(renderMessage)}

        {/* Typing indicator */}
        {renderTypingIndicator()}

        {/* Empty state */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="rounded-full bg-gray-100 p-4 mb-4">
              <User className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No messages yet</h3>
            <p className="text-gray-500">Start the conversation by sending a message!</p>
          </div>
        )}

        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>
    </main>
  );
}
