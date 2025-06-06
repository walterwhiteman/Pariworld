import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input'; // Note: Input is imported but not used in the provided code.
import { Textarea } from '@/components/ui/textarea';
import { Image, Send, X } from 'lucide-react';
import { ChatMessage } from '@/types/chat';

interface MessageInputProps {
  onSendMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  roomId: string;
  username: string;
  disabled?: boolean;
  className?: string; // <-- ADDED THIS LINE
}

/**
 * Message input component with text input and image upload functionality
 * Handles message composition, image preview, and typing indicators
 */
export function MessageInput({
  onSendMessage,
  onTypingStart,
  onTypingStop,
  roomId,
  username,
  disabled = false,
  className // <-- ADDED THIS LINE
}: MessageInputProps) {
  const [messageText, setMessageText] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingRef = useRef(false);

  /**
   * Auto-resize textarea based on content
   */
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }
  }, []);

  /**
   * Handle text input changes and typing indicators
   */
  const handleTextChange = (value: string) => {
    setMessageText(value);
    
    // Handle typing indicators
    if (value.trim() && !isTypingRef.current) {
      isTypingRef.current = true;
      onTypingStart();
    }

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set new timeout to stop typing indicator
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop();
      }
    }, 1000);

    // Adjust textarea height
    setTimeout(adjustTextareaHeight, 0);
  };

  /**
   * Handle image file selection
   */
  const handleImageSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file');
      return;
    }

    // Check file size (limit to 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size must be less than 5MB');
      return;
    }

    setIsUploading(true);
    setSelectedImage(file);

    try {
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setImagePreview(e.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error processing image:', error);
      alert('Error processing image. Please try again.');
      clearImageSelection();
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Clear image selection
   */
  const clearImageSelection = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Convert image to Base64 for transmission
   */
  const convertImageToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result) {
          resolve(reader.result as string);
        } else {
          reject(new Error('Failed to read file'));
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  /**
   * Send message (text or image)
   */
  const handleSendMessage = async () => {
    const hasText = messageText.trim();
    const hasImage = selectedImage;

    if (!hasText && !hasImage) return;

    try {
      // Stop typing indicator
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop();
      }

      // Send text message
      if (hasText && !hasImage) {
        const message: Omit<ChatMessage, 'id' | 'timestamp'> = {
          roomId,
          sender: username,
          content: messageText.trim(),
          messageType: 'text'
        };
        
        onSendMessage(message);
        setMessageText('');
      }
      
      // Send image message
      if (hasImage) {
        setIsUploading(true);
        
        const base64Data = await convertImageToBase64(hasImage);
        
        const message: Omit<ChatMessage, 'id' | 'timestamp'> = {
          roomId,
          sender: username,
          content: hasText ? messageText.trim() : undefined,
          imageData: base64Data,
          messageType: 'image'
        };
        
        onSendMessage(message);
        setMessageText('');
        clearImageSelection();
      }

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  /**
   * Handle Enter key press
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  /**
   * Handle file input change
   */
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
  };

  /**
   * Format file size for display
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  /**
   * Cleanup typing timeout on unmount
   */
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  return (
    // Apply the className to the root footer element
    <footer className={`border-t border-gray-200 bg-white p-4 ${className}`}> {/* <-- MODIFIED THIS LINE */}
      {/* Image Preview */}
      {imagePreview && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img
                src={imagePreview}
                alt="Image preview"
                className="h-12 w-12 rounded-lg object-cover"
              />
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {selectedImage?.name}
                </p>
                <p className="text-xs text-gray-500">
                  {selectedImage ? formatFileSize(selectedImage.size) : ''}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearImageSelection}
              className="text-gray-400 hover:text-red-600"
              disabled={isUploading}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="flex items-end space-x-3">
        {/* Image Upload Button */}
        <div className="relative">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileInputChange}
            className="hidden"
            disabled={disabled || isUploading}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="text-gray-600 hover:text-blue-600 hover:bg-gray-100"
            disabled={disabled || isUploading}
            title="Upload image"
          >
            <Image className="h-5 w-5" />
          </Button>
        </div>

        {/* Message Input */}
        <div className="relative flex-1">
          <Textarea
            ref={textareaRef}
            placeholder="Type your message..."
            value={messageText}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="min-h-[44px] resize-none pr-12 focus:ring-blue-500"
            disabled={disabled || isUploading}
            rows={1}
          />
          
          {/* Send Button */}
          <Button
            onClick={handleSendMessage}
            disabled={disabled || isUploading || (!messageText.trim() && !selectedImage)}
            className="absolute bottom-2 right-2 h-8 w-8 bg-blue-600 p-0 hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50"
            title="Send message"
          >
            {isUploading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </footer>
  );
}
