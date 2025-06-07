import { useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Video, VideoOff, Mic, MicOff, Phone, X, Check } from 'lucide-react'; // Added Check and X for accept/reject icons
import { VideoCallState } from '@/types/chat'; // Ensure VideoCallState is correctly imported from your types

interface VideoCallModalProps {
    isOpen: boolean;
    callState: VideoCallState;
    localVideoRef: React.RefObject<HTMLVideoElement>;
    remoteVideoRef: React.RefObject<HTMLVideoElement>;
    onEndCall: () => void;
    onToggleVideo: () => void;
    onToggleAudio: () => void;
    formatCallDuration: (seconds: number) => string;
    onAcceptCall: () => void; // New prop for accepting incoming calls
    onRejectCall: () => void; // New prop for rejecting incoming calls
}

/**
 * Video call modal component implementing WebRTC video calling
 * Displays local and remote video streams with call controls,
 * and handles incoming call prompts.
 */
export function VideoCallModal({
    isOpen,
    callState,
    localVideoRef,
    remoteVideoRef,
    onEndCall,
    onToggleVideo,
    onToggleAudio,
    formatCallDuration,
    onAcceptCall, // Destructure new prop
    onRejectCall // Destructure new prop
}: VideoCallModalProps) {

    // Determine if it's an incoming call (offer exists but not yet active)
    const isIncomingCall = !!callState.incomingCallOffer && !callState.isActive;
    const isCallActive = callState.isActive;

    /**
     * Handle keyboard shortcuts during video call
     */
    useEffect(() => {
        if (!isOpen || isIncomingCall) return; // Disable shortcuts if modal is not open or if it's an incoming call prompt

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
    }, [isOpen, isIncomingCall, onToggleAudio, onToggleVideo, onEndCall]);

    // Effect to ensure video element attributes are set
    useEffect(() => {
        if (localVideoRef.current) {
            localVideoRef.current.autoplay = true;
            localVideoRef.current.playsInline = true;
            localVideoRef.current.muted = true; // Mute local video to prevent echo
            console.log('VideoCallModal: Local video element attributes set.');
        }
        if (remoteVideoRef.current) {
            remoteVideoRef.current.autoplay = true;
            remoteVideoRef.current.playsInline = true;
            console.log('VideoCallModal: Remote video element attributes set.');
        }
    }, [localVideoRef, remoteVideoRef]);

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onOpenChange={() => {}}>
            <DialogContent
                className="max-w-none h-screen w-screen p-0 bg-black"
                hideCloseButton
            >
                <div className="relative flex h-full w-full flex-col">

                    {/* Conditional Header: Incoming Call vs. Active Call */}
                    <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between bg-black bg-opacity-50 p-4">
                        <div className="text-white">
                            {isIncomingCall ? (
                                <h3 className="font-semibold text-xl">Incoming Call from {callState.incomingCallerUsername}</h3>
                            ) : (
                                <>
                                    <h3 className="font-semibold text-xl">Video Call</h3>
                                    <p className="text-sm text-gray-300">
                                        {formatCallDuration(callState.callDuration)}
                                    </p>
                                </>
                            )}
                        </div>
                        {/* Only show End Call button if it's an active call */}
                        {isCallActive && (
                            <Button
                                onClick={onEndCall}
                                className="bg-red-600 hover:bg-red-700 text-white"
                                size="sm"
                            >
                                <Phone className="mr-2 h-4 w-4 rotate-180" /> {/* Rotated icon for 'end call' */}
                                End Call
                            </Button>
                        )}
                    </div>

                    {/* Video Streams Container (visible only for active calls) */}
                    {!isIncomingCall && (
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
                    )}

                    {/* Call Controls (Conditional: Incoming vs. Active) */}
                    <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-center space-x-4 bg-black bg-opacity-50 p-4">
                        {isIncomingCall ? (
                            // Incoming Call Buttons
                            <>
                                <Button
                                    onClick={onAcceptCall}
                                    className="h-14 w-14 rounded-full bg-green-600 hover:bg-green-700 transition-colors flex items-center justify-center"
                                    title="Accept Call"
                                >
                                    <Check className="h-7 w-7 text-white" />
                                </Button>
                                <Button
                                    onClick={onRejectCall}
                                    className="h-14 w-14 rounded-full bg-red-600 hover:bg-red-700 transition-colors flex items-center justify-center"
                                    title="Decline Call"
                                >
                                    <X className="h-7 w-7 text-white" />
                                </Button>
                            </>
                        ) : (
                            // Active Call Controls
                            <>
                                {/* Microphone Toggle */}
                                <Button
                                    onClick={onToggleAudio}
                                    className={`h-12 w-12 rounded-full transition-colors ${
                                        callState.isLocalAudioEnabled
                                            ? 'bg-gray-600 hover:bg-gray-500'
                                            : 'bg-red-600 hover:bg-red-500'
                                    }`}
                                    title={callState.isLocalAudioEnabled ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
                                    disabled={!isCallActive} // Disable if call is not active
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
                                    disabled={!isCallActive} // Disable if call is not active
                                >
                                    {callState.isLocalVideoEnabled ? (
                                        <Video className="h-5 w-5 text-white" />
                                    ) : (
                                        <VideoOff className="h-5 w-5 text-white" />
                                    )}
                                </Button>

                                {/* End Call Button (for active calls) */}
                                <Button
                                    onClick={onEndCall}
                                    className="h-12 w-12 rounded-full bg-red-600 hover:bg-red-700 transition-colors"
                                    title="End call (Escape)"
                                    disabled={!isCallActive} // Only active calls can be ended via this button
                                >
                                    <Phone className="h-5 w-5 text-white rotate-180" />
                                </Button>
                            </>
                        )}
                    </div>

                    {/* Connection Status (only for active calls) */}
                    {isCallActive && callState.remoteStream && (
                        <div className="absolute top-16 left-4 rounded-lg bg-black bg-opacity-50 px-3 py-2">
                            <p className="text-sm text-white">
                                <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-green-500" />
                                Connected
                            </p>
                        </div>
                    )}

                    {/* Keyboard Shortcuts Help (only for active calls) */}
                    {isCallActive && (
                        <div className="absolute bottom-20 left-4 rounded-lg bg-black bg-opacity-50 px-3 py-2">
                            <p className="text-xs text-gray-300">
                                Press M to mute, V for video, ESC to end call
                            </p>
                        </div>
                    )}

                    {/* Centered Message if no streams for active call (e.g., initial connection state) */}
                    {isCallActive && !callState.localStream && !callState.remoteStream && (
                        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
                            <div className="text-center text-white">
                                <h3 className="text-lg font-medium">Connecting to call...</h3>
                                <p className="text-sm text-gray-400">Please wait for streams to load.</p>
                            </div>
                        </div>
                    )}

                    {/* Full-screen overlay for incoming call when videos aren't needed yet */}
                    {isIncomingCall && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-white">
                            <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-blue-600">
                                <Phone className="h-12 w-12" />
                            </div>
                            <h3 className="text-3xl font-bold mb-2">Incoming Call</h3>
                            <p className="text-xl text-gray-300">from **{callState.incomingCallerUsername}**</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
