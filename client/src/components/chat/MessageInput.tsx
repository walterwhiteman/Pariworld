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
    const [isProcessingImage, setIsProcessingImage] = useState(false); // Renamed from isUploading for clarity on client-side process

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
    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value;
        setMessageText(value);

        // If content becomes empty or only whitespace, stop typing immediately
        if (!value.trim()) {
            if (isTypingRef.current) {
                isTypingRef.current = false;
                onTypingStop();
            }
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
                typingTimeoutRef.current = null;
            }
            // No need to set timeout, as there's no text to indicate typing
            return;
        }

        // If typing started, emit it
        if (!isTypingRef.current) {
            isTypingRef.current = true;
            onTypingStart();
        }

        // Clear previous timeout for stopping typing
        if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
        }

        // Set a new timeout to stop typing indicator after a period of inactivity
        typingTimeoutRef.current = setTimeout(() => {
            if (isTypingRef.current) {
                isTypingRef.current = false;
                onTypingStop();
            }
            typingTimeoutRef.current = null; // Clear the ref after timeout fires
        }, 1000); // 1 second of inactivity to stop typing

        // Adjust textarea height
        // Using setTimeout(0) to ensure height adjustment happens after DOM updates from value change
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
        if (file.size > 10 * 1024 * 1024) { // 10MB limit for original file
            alert('Original image size must be less than 10MB before processing. Please select a smaller image.');
            return;
        }

        setIsProcessingImage(true); // Indicate that image processing has started
        setSelectedImage(file); // Store the original file object

        try {
            console.log('Starting image processing...');
            // Resize and convert the image to Base64 for preview and sending
            const resizedBase64Data = await resizeImageAndConvertToBase64(file, 800, 600, 0.8); // Max 800px width, 600px height, 80% quality

            if (resizedBase64Data) {
                setImagePreview(resizedBase64Data); // Set the resized Base64 as the preview
                console.log('Image resized successfully!');
                console.log('Resized Base64 data length:', resizedBase64Data.length, 'bytes');
                // console.log('Resized Base64 data starts with:', resizedBase64Data.substring(0, 50) + '...'); // Log first 50 chars for debugging
            } else {
                throw new Error('Image processing failed: resized data is null.');
            }
        } catch (error) {
            console.error('Error processing image in handleImageSelect:', error);
            alert('Error processing image. Please try again.');
            clearImageSelection(); // Clear selection on error
        } finally {
            setIsProcessingImage(false); // Processing finished
            console.log('Image processing finished. setIsProcessingImage set to false.');
        }
    };

    /**
     * Clear image selection
     */
    const clearImageSelection = useCallback(() => {
        setSelectedImage(null);
        setImagePreview(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = ''; // Reset the file input element to allow selecting the same file again
        }
    }, []);

    /**
     * Send message (text or image)
     */
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault(); // Prevent default form submission

        const hasText = messageText.trim().length > 0;
        const hasImage = selectedImage && imagePreview; // Check if an image is selected AND its preview (resized data) exists

        if (!hasText && !hasImage) {
            return; // Don't send empty messages or if no image is present
        }

        if (disabled || isProcessingImage) {
            // Prevent sending if disabled or still processing image
            return;
        }

        try {
            // Stop typing indicator if active
            if (isTypingRef.current) {
                isTypingRef.current = false;
                onTypingStop();
            }
            if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
                typingTimeoutRef.current = null;
            }

            let message: Omit<ChatMessage, 'id' | 'timestamp'>;

            if (hasImage) {
                console.log('Preparing to send image message...');
                message = {
                    roomId,
                    sender: username,
                    content: hasText ? messageText.trim() : undefined, // Include text if present
                    imageData: imagePreview!, // Use the already processed Base64 string
                    messageType: 'image'
                };
            } else { // Must have text if it gets here (due to initial `if (!hasText && !hasImage)` check)
                console.log('Preparing to send text message...');
                message = {
                    roomId,
                    sender: username,
                    content: messageText.trim(),
                    messageType: 'text'
                };
            }

            onSendMessage(message); // Send the message via prop
            console.log('onSendMessage called with message:', message);

            // Reset input fields after sending
            setMessageText('');
            clearImageSelection();

            // Reset textarea height
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }

        } catch (error) {
            console.error('Error sending message in handleSubmit:', error);
            alert('Failed to send message. Please try again.');
        }
    };

    /**
     * Handle Enter key press within the textarea
     * Only submit if Enter is pressed without Shift
     */
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); // Prevent new line
            handleSubmit(e); // Trigger the form submission directly
        }
    }, [handleSubmit]); // handleSubmit is now a dependency

    /**
     * Handle file input change event
     */
    const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            handleImageSelect(file);
        }
        // Clear the input value so the same file can be selected again if needed
        e.target.value = '';
    }, [handleImageSelect]);

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
                            disabled={isProcessingImage}
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* Input Area - Now wrapped in a form */}
            <form onSubmit={handleSubmit} className="flex items-end space-x-3">
                {/* Image Upload Button */}
                <div className="relative">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleFileInputChange}
                        className="hidden"
                        disabled={disabled || isProcessingImage}
                    />
                    <Button
                        type="button" // Important: Prevent this button from submitting the form itself
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-gray-600 hover:text-blue-600 hover:bg-gray-100"
                        disabled={disabled || isProcessingImage}
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
                        onChange={handleTextChange}
                        onKeyDown={handleKeyDown} // This now calls handleSubmit
                        className="min-h-[44px] resize-none pr-12 focus:ring-blue-500"
                        disabled={disabled || isProcessingImage}
                        rows={1}
                    />

                    {/* Send Button */}
                    <Button
                        type="submit" // This button will now correctly trigger the form's onSubmit
                        disabled={disabled || isProcessingImage || (!messageText.trim() && !selectedImage)}
                        className="absolute bottom-2 right-2 h-8 w-8 bg-blue-600 p-0 hover:bg-blue-700 focus:ring-blue-500 disabled:opacity-50"
                        title="Send message"
                    >
                        {isProcessingImage ? (
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        ) : (
                            <Send className="h-4 w-4" />
                        )}
                    </Button>
                </div>
            </form>
        </footer>
    );
}
