import { useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Video, VideoOff, Mic, MicOff, Phone } from 'lucide-react';
import { VideoCallState } from '@/types/chat';

interface VideoCallModalProps {
  isOpen: boolean;
  callState: VideoCallState;
  localVideoRef: React.RefObject<HTMLVideoElement>;
  remoteVideoRef: React.RefObject<HTMLVideoElement>;
  onEndCall: () => void;
  onToggleVideo: () => void;
  onToggleAudio: () => void;
  formatCallDuration: (seconds: number) => string;
}

/**
 * Video call modal component implementing WebRTC video calling
 * Displays local and remote video streams with call controls
 */
export function VideoCallModal({
  isOpen,
  callState,
  localVideoRef,
  remoteVideoRef,
  onEndCall,
  onToggleVideo,
  onToggleAudio,
  formatCallDuration
}: VideoCallModalProps) {
  
  /**
   * Handle keyboard shortcuts during video call
   */
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyPress = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'm':
          e.preventDefault();
          onToggleAudio();
          break;
        case 'v':
          e.preventDefault();
          onToggleVideo();
          break;
        case 'escape':
          e.preventDefault();
          onEndCall();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyPress);
    return () => document.removeEventListener('keydown', handleKeyPress);
  }, [isOpen, onToggleAudio, onToggleVideo, onEndCall]);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent 
        className="max-w-none h-screen w-screen p-0 bg-black"
        hideCloseButton
      >
        <div className="relative flex h-full w-full flex-col">
          
          {/* Call Header */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between bg-black bg-opacity-50 p-4">
            <div className="text-white">
              <h3 className="font-semibold">Video Call</h3>
              <p className="text-sm text-gray-300">
                {formatCallDuration(callState.callDuration)}
              </p>
            </div>
            
            <Button
              onClick={onEndCall}
              className="bg-red-600 hover:bg-red-700 text-white"
              size="sm"
            >
              <Phone className="mr-2 h-4 w-4" />
              End Call
            </Button>
          </div>

          {/* Video Streams Container */}
          <div className="relative flex-1 p-4">
            
            {/* Remote Video (Main) */}
            <div className="h-full w-full rounded-lg bg-gray-800 overflow-hidden">
              <video
                ref={remoteVideoRef}
                className="h-full w-full object-cover"
                autoPlay
                playsInline
              />
              
              {/* No Remote Stream Placeholder */}
              {!callState.remoteStream && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                  <div className="text-center text-white">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-700">
                      <Video className="h-8 w-8" />
                    </div>
                    <p className="text-lg font-medium">Waiting for other participant...</p>
                    <p className="text-sm text-gray-300">
                      They will appear here when they join the call
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Local Video (Picture-in-Picture) */}
            <div className="absolute top-8 right-8 h-24 w-32 sm:h-36 sm:w-48 overflow-hidden rounded-xl bg-gray-700 border-2 border-white">
              <video
                ref={localVideoRef}
                className="h-full w-full object-cover"
                autoPlay
                playsInline
                muted
              />
              
              {/* Video Disabled Overlay */}
              {!callState.isLocalVideoEnabled && (
                <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
                  <VideoOff className="h-6 w-6 text-white" />
                </div>
              )}
            </div>
          </div>

          {/* Call Controls */}
          <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center space-x-4 bg-black bg-opacity-50 p-4">
            
            {/* Microphone Toggle */}
            <Button
              onClick={onToggleAudio}
              className={`h-12 w-12 rounded-full transition-colors ${
                callState.isLocalAudioEnabled
                  ? 'bg-gray-600 hover:bg-gray-500'
                  : 'bg-red-600 hover:bg-red-500'
              }`}
              title={callState.isLocalAudioEnabled ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
            >
              {callState.isLocalAudioEnabled ? (
                <Mic className="h-5 w-5 text-white" />
              ) : (
                <MicOff className="h-5 w-5 text-white" />
              )}
            </Button>

            {/* Camera Toggle */}
            <Button
              onClick={onToggleVideo}
              className={`h-12 w-12 rounded-full transition-colors ${
                callState.isLocalVideoEnabled
                  ? 'bg-gray-600 hover:bg-gray-500'
                  : 'bg-red-600 hover:bg-red-500'
              }`}
              title={callState.isLocalVideoEnabled ? 'Turn off camera (V)' : 'Turn on camera (V)'}
            >
              {callState.isLocalVideoEnabled ? (
                <Video className="h-5 w-5 text-white" />
              ) : (
                <VideoOff className="h-5 w-5 text-white" />
              )}
            </Button>

            {/* End Call */}
            <Button
              onClick={onEndCall}
              className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 transition-colors"
              title="End call (Escape)"
            >
              <Phone className="h-5 w-5 text-white" />
            </Button>
          </div>

          {/* Connection Status */}
          {callState.remoteStream && (
            <div className="absolute top-16 left-4 rounded-lg bg-black bg-opacity-50 px-3 py-2">
              <p className="text-sm text-white">
                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
                Connected
              </p>
            </div>
          )}

          {/* Keyboard Shortcuts Help */}
          <div className="absolute bottom-20 left-4 rounded-lg bg-black bg-opacity-50 px-3 py-2">
            <p className="text-xs text-gray-300">
              Press M to mute, V for video, ESC to end call
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
