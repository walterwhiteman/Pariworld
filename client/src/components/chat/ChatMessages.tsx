// src/components/chat/ChatMessages.tsx
import { useEffect, useRef, memo } from 'react'; // NEW: Import memo
import { ChatMessage } from '@/types/chat';
import { User, Check, CheckCheck } from 'lucide-react'; // NEW: Import Check and CheckCheck icons

interface ChatMessagesProps {
  messages: ChatMessage[];
  currentUsername: string;
  typingUser?: string;
  onImageClick: (imageUrl: string) => void;
  className?: string;
  // NEW: Callback to provide message element refs back to the parent (chat.tsx)
  onMessageRender: (messageId: string, element: HTMLDivElement | null) => void;
}

/**
 * Chat messages container component that displays all messages in a scrollable area
 * Handles message rendering, auto-scrolling, and typing indicators
 */
export const ChatMessages = memo(function ChatMessages({ // NEW: Wrap in memo
  messages,
  currentUsername,
  typingUser,
  onImageClick,
  className,
  onMessageRender // NEW: Destructure onMessageRender
}: ChatMessagesProps) {
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
        <div key={message.id} className="flex justify-center" ref={(el) => onMessageRender(message.id, el)}>
          <div className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
            {message.content}
          </div>
        </div>
      );
    }

    // Regular messages
    return (
      // NEW: Attach ref to the message container for IntersectionObserver
      <div
        key={message.id}
        ref={(el) => onMessageRender(message.id, el)}
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
        <div
          className={`max-w-[75%] ${ // Changed max-w-* to max-w-[75%]
            isSelf ? 'ml-auto' : 'mr-auto'
          }`}
        >
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
              <>
                <span className="text-xs text-gray-500">You</span>
                {/* Message Status Icons */}
                {/* NEW: Conditional rendering for status icons */}
                {message.status === 'sent' && (
                  <Check className="h-3 w-3 text-gray-400" />
                )}
                {message.status === 'delivered' && (
                  <CheckCheck className="h-3 w-3 text-gray-400" />
                )}
                {message.status === 'seen' && (
                  <CheckCheck className="h-3 w-3 text-blue-500" />
                )}
              </>
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
    <main className={`flex flex-1 flex-col ${className}`}>
      <div
        ref={containerRef}
        className="flex-1 space-y-4"
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
}); // NEW: Close memo
