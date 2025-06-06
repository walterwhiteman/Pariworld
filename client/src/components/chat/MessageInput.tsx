// src/components/chat/MessageInput.tsx

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input'; // Note: Input is imported but not used in the provided code.
import { Textarea } from '@/components/ui/textarea';
import { Image, Send, X } from 'lucide-react';
import { ChatMessage } from '@/types/chat';
import { resizeImageAndConvertToBase64 } from '@/lib/utils'; // Import the utility

interface MessageInputProps {
  onSendMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  onTypingStart: () => void;
  onTypingStop: () => void;
  roomId: string;
  username: string;
  disabled?: boolean;
  className?: string;
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
  className
}: MessageInputProps) {
  const [messageText, setMessageText] = useState('');
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null); // This will now hold the resized Base64
  const [isUploading, setIsUploading] = useState(false); // Indicates image processing/upload preparation
  
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
   * Handle image file selection, resize, and create preview
   */
  const handleImageSelect = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      alert('Please select a valid image file (e.g., JPEG, PNG, GIF).');
      return;
    }

    // Check original file size (a reasonable limit before even processing)
    if (file.size > 5 * 1024 * 1024) { // 5MB limit for original file
      alert('Original image size must be less than 5MB before processing. Please select a smaller image.');
      return;
    }

    setIsUploading(true);
    setSelectedImage(file); // Store the original file object

    try {
      console.log('Starting image processing...');
      // Resize and convert the image to Base64 for preview and sending
      const resizedBase64Data = await resizeImageAndConvertToBase64(file, 800, 600, 0.8); // Max 800px width, 600px height, 80% quality

      if (resizedBase64Data) {
        setImagePreview(resizedBase64Data); // Set the resized Base64 as the preview
        console.log('Image resized successfully!');
        console.log('Resized Base64 data length:', resizedBase64Data.length, 'bytes');
        console.log('Resized Base64 data starts with:', resizedBase64Data.substring(0, 50) + '...'); // Log first 50 chars
      } else {
        throw new Error('Image processing failed: resized data is null.');
      }
    } catch (error) {
      console.error('Error processing image in handleImageSelect:', error);
      alert('Error processing image. Please try again.');
      clearImageSelection();
    } finally {
      setIsUploading(false); // Processing finished
      console.log('Image processing finished. isUploading set to false.');
    }
  };

  /**
   * Clear image selection
   */
  const clearImageSelection = () => {
    setSelectedImage(null);
    setImagePreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Reset the file input element
    }
  };

  // Removed convertImageToBase64 as resizeImageAndConvertToBase64 handles it

  /**
   * Send message (text or image)
   */
  const handleSendMessage = async () => {
    const hasText = messageText.trim();
    const hasImage = selectedImage && imagePreview; // Check if an image is selected AND its preview (resized data) exists

    if (!hasText && !hasImage) return; // Don't send empty messages

    try {
      // Stop typing indicator if active
      if (isTypingRef.current) {
        isTypingRef.current = false;
        onTypingStop();
      }

      // Prepare message data
      let message: Omit<ChatMessage, 'id' | 'timestamp'>;

      if (hasImage) {
        // If an image is selected, send it. Optionally include text content.
        console.log('Preparing to send image message...');
        console.log('Image data length from imagePreview:', imagePreview!.length, 'bytes');
        console.log('Image data starts with (from imagePreview):', imagePreview!.substring(0, 50) + '...');

        message = {
          roomId,
          sender: username,
          content: hasText ? messageText.trim() : undefined, // Include text if present
          imageData: imagePreview!, // Use the already processed Base64 string
          messageType: 'image'
        };
      } else if (hasText) {
        // If only text is present
        message = {
          roomId,
          sender: username,
          content: messageText.trim(),
          messageType: 'text'
        };
      } else {
        // Should not happen due to initial check, but for safety
        return;
      }

      // Send the message via prop
      onSendMessage(message);
      console.log('onSendMessage called with message:', message);

      // Reset input fields after sending
      setMessageText('');
      clearImageSelection();

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

    } catch (error) {
      console.error('Error sending message in handleSendMessage:', error);
      alert('Failed to send message. Please try again.');
    }
    // isUploading is controlled by handleImageSelect, not by sending
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
   * Handle file input change event
   */
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
    // Clear the input value so the same file can be selected again if needed
    e.target.value = '';
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
   * Cleanup typing timeout on component unmount
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
    <footer className={`border-t border-gray-200 bg-white p-4 ${className}`}>
      {/* Image Preview */}
      {imagePreview && (
        <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <img
                src={imagePreview} // This is now the resized Base64
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
