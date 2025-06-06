// src/components/chat/ImageViewerModal.tsx

import React from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog'; // Assuming you are using Shadcn UI's Dialog component

interface ImageViewerModalProps {
  isOpen: boolean;
  imageUrl: string | null;
  onClose: () => void;
}

/**
 * A modal component to display an image in its full size.
 * Assumes usage of Shadcn UI's Dialog component.
 */
export function ImageViewerModal({ isOpen, imageUrl, onClose }: ImageViewerModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-full h-full p-0 flex items-center justify-center bg-transparent border-none shadow-none">
        <div className="relative max-h-[90vh] max-w-[90vw] flex items-center justify-center">
          {imageUrl && (
            // Using a simple img tag for direct display of base64 image data
            // You might want to optimize this for very large images or use Next.js Image component
            <img
              src={imageUrl}
              alt="Full size chat image"
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-xl"
            />
          )}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-full bg-black bg-opacity-50 text-white hover:bg-opacity-75 transition-all duration-200 z-50"
            aria-label="Close image viewer"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
