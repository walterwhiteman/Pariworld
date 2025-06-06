import { useEffect, useRef } from 'react';
import { ChatMessage } from '@/types/chat';
import { User } from 'lucide-react';

interface ChatMessagesProps {
  messages: ChatMessage[];
  currentUsername: string;
  typingUser?: string;
}

/**
 * Chat messages container component that displays all messages in a scrollable area
 * Handles message rendering, auto-scrolling, and typing indicators
 */
export function ChatMessages({ messages, currentUsername, typingUser }: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLHTMLDivElement>(null); // Corrected type to HTMLDivElement

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
    // Ensure timestamp is a Date object, even if it comes as a string from JSON
    const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    return date.toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  /**
   * Get initials from username
   */
  const getInitials = (username: string): string => {
    if (!username) return ''; // Handle empty username gracefully
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
    // Corrected to use message.username instead of message.sender
    const isSelf = message.username === currentUsername;
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
        className={`flex items-start space-x-3 ${isSelf ? 'flex-row-reverse space-x-reverse' : ''}`}
      >
        {/* Avatar */}
        <div 
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
            isSelf ? 'bg-blue-600' : 'bg-gray-300'
          }`}
        >
          {/* Corrected to use message.username */}
          {getInitials(message.username) ? (
            <span className={`text-sm font-medium ${isSelf ? 'text-white' : 'text-gray-600'}`}>
              {getInitials(message.username)}
            </span>
          ) : (
            <User className={`h-4 w-4 ${isSelf ? 'text-white' : 'text-gray-600'}`} />
          )}
        </div>

        {/* Message Content */}
        <div className={`flex-1 max-w-xs sm:max-w-sm lg:max-w-md ${isSelf ? 'items-end' : 'items-start'}`}>
          <div
            className={`shadow-sm ${
              isSelf
                ? 'bg-blue-600 text-white rounded-2xl rounded-tr-md'
                : 'bg-white border border-gray-200 text-gray-900 rounded-2xl rounded-tl-md'
            } px-4 py-2`}
          >
            {/* Image Message */}
            {message.messageType === 'image' && message.imageData && (
              <div className="mb-2">
                <img
                  src={message.imageData}
                  alt="Shared image"
                  className="max-w-full h-auto rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => {
                    // Open image in modal (could be implemented later)
                    window.open(message.imageData, '_blank');
                  }}
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
              // Corrected to use message.username
              <span className="text-xs text-gray-500">{message.username}</span>
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
    // You might need to adjust the `pt-` (padding-top) here or in the parent component
    // that wraps ChatMessages, if your fixed header is overlapping content.
    // Example: <main className="flex flex-1 flex-col overflow-hidden pt-16"> if header is h-16
    <main className="flex flex-1 flex-col overflow-hidden">
      <div 
        ref={containerRef}
        className="flex-1 space-y-4 overflow-y-auto p-4"
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
