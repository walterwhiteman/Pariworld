// src/lib/utils.ts

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Resizes an image file and converts it to a Base64 data URL (JPEG format).
 * This helps reduce the size of images sent over the network.
 *
 * @param file The original image File object.
 * @param maxWidth The maximum width for the resized image (default: 800px).
 * @param maxHeight The maximum height for the resized image (default: 600px).
 * @param quality The image quality for JPEG compression (0 to 1, default: 0.8).
 * @returns A Promise that resolves with the Base64 data URL of the resized image, or null if an error occurs.
 */
export const resizeImageAndConvertToBase64 = (
  file: File,
  maxWidth: number = 800,
  maxHeight: number = 600,
  quality: number = 0.8
): Promise<string | null> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);

    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;

      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Calculate new dimensions while maintaining aspect ratio
        if (width > height) {
          if (width > maxWidth) {
            height = height * (maxWidth / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = width * (maxHeight / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          console.error('2D rendering context not available.');
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        // Convert to Base64, defaulting to JPEG for better compression
        // You can use 'image/png' if transparency is required, but JPEG is usually smaller.
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };

      img.onerror = () => {
        console.error('Error loading image for resizing.');
        resolve(null);
      };
    };

    reader.onerror = () => {
      console.error('Error reading file.');
      resolve(null);
    };
  });
};
