import React, { useRef, useEffect, useState, useCallback } from 'react';
import { VideoCallState } from '@/types/chat';
import { Maximize2, X } from 'lucide-react';
import { Button } from '@/components/ui/button'; // Assuming this exists

interface VideoCallOverlayProps {
  callState: VideoCallState;
  localVideoRef: React.RefObject<HTMLVideoElement>;
  remoteVideoRef: React.RefObject<HTMLVideoElement>;
  onExpandCall: () => void;
  onEndCall: () => void;
}

/**
 * Floating overlay component for a minimized video call.
 * Mimics WhatsApp-like overlay behavior.
 */
export function VideoCallOverlay({
  callState,
  localVideoRef,
  remoteVideoRef,
  onExpandCall,
  onEndCall,
}: VideoCallOverlayProps) {
  // State for draggable position
  // Initial position (bottom-rightish) - adjust as needed
  const [position, setPosition] = useState({ x: window.innerWidth - 200 - 20, y: 20 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const overlayRef = useRef<HTMLDivElement>(null);

  // Initialize position to be responsive
  useEffect(() => {
    if (overlayRef.current) {
      const initialX = window.innerWidth - (overlayRef.current.offsetWidth || 180) - 20; // 180 is default width, 20px padding
      const initialY = 20; // 20px from top
      setPosition({ x: initialX, y: initialY });
    }
  }, []);

  // Handle drag start
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only allow drag if not on a button, to prevent accidental drags when clicking controls
    if (e.target instanceof HTMLElement && e.target.closest('button')) {
      return;
    }
    if (overlayRef.current) {
      setIsDragging(true);
      dragStartPos.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };
      e.stopPropagation(); // Prevent text selection during drag
      e.preventDefault(); // Prevent default browser behavior
    }
  }, [position]);

  // Handle dragging movement
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      let newX = e.clientX - dragStartPos.current.x;
      let newY = e.clientY - dragStartPos.current.y;

      // Keep within viewport bounds
      const minX = 0;
      const minY = 0;
      const maxX = window.innerWidth - (overlayRef.current?.offsetWidth || 0);
      const maxY = window.innerHeight - (overlayRef.current?.offsetHeight || 0);

      newX = Math.max(minX, Math.min(newX, maxX));
      newY = Math.max(minY, Math.min(newY, maxY));

      setPosition({ x: newX, y: newY });
    }
  }, [isDragging]);

  // Handle drag end
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Add/remove mouse event listeners for dragging
  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={overlayRef}
      className="fixed z-50 overflow-hidden rounded-lg shadow-xl border border-gray-200 bg-black flex flex-col cursor-grab active:cursor-grabbing"
      style={{
        width: '180px', // WhatsApp-like size
        height: '240px', // Adjust aspect ratio as needed
        left: position.x,
        top: position.y,
        // Smooth transition for movement, but only when not dragging
        transition: isDragging ? 'none' : 'left 0.1s ease-out, top 0.1s ease-out',
      }}
      onMouseDown={handleMouseDown} // Make entire overlay draggable
      // Add touch events for mobile dragging
      onTouchStart={(e) => handleMouseDown(e.touches[0] as any)} // Use first touch
      onTouchMove={(e) => handleMouseMove(e.touches[0] as any)}
      onTouchEnd={handleMouseUp}
    >
      {/* Remote Video Stream */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover rounded-lg"
        muted={callState.isLocalVideoMuted} // Adjust muting as per your UX
      />
      {/* Local Video Stream (small overlay within overlay) */}
      <video
        ref={localVideoRef}
        autoPlay
        playsInline
        muted // Mute local video to prevent echo
        className="absolute bottom-2 right-2 w-1/3 h-1/3 object-cover rounded-md border border-gray-500"
      />

      {/* Controls Overlay - Visible on hover/tap */}
      <div
        className="absolute top-0 left-0 w-full h-full bg-black bg-opacity-30 flex flex-col justify-between items-center p-2
                   opacity-0 hover:opacity-100 transition-opacity duration-200"
        // For mobile, ensure controls appear on tap and stay for a moment
        // You might need a more sophisticated tap-to-toggle visibility for mobile
        onClick={onExpandCall} // Tapping anywhere on overlay expands the call
      >
        {/* Top Right Controls (e.g., expand) */}
        <div className="flex justify-end w-full">
          <Button
            onClick={(e) => { e.stopPropagation(); onExpandCall(); }} // Prevent expanding on button click
            variant="ghost"
            size="sm"
            className="text-white hover:bg-gray-700 hover:text-white"
            title="Expand call"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Call Info / Status (optional) */}
        <div className="text-white text-xs text-center">
            {callState.isConnected ? 'Connected' : 'Connecting...'}
            {callState.callDuration && <p>{callState.callDuration}</p>}
        </div>

        {/* Bottom Center Controls (e.g., end call) */}
        <div className="flex justify-center w-full space-x-2">
          <Button
            onClick={(e) => { e.stopPropagation(); onEndCall(); }} // Prevent expanding on button click
            variant="ghost"
            size="sm"
            className="bg-red-500 hover:bg-red-600 text-white rounded-full p-2"
            title="End call"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
