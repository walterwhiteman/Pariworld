// src/hooks/useWebRTC.ts

import { useState, useRef, useEffect, useCallback } from 'react';
import { Socket } from '@/hooks/useSocket'; // Adjust path if necessary
// Ensure you have `webrtc-types` installed or define these types if not
// For example, you can add 'webrtc-types' to your devDependencies: `npm install --save-dev webrtc-types`
import { RTCIceCandidate, RTCSessionDescription } from 'webrtc-types';


// Define the shape of the WebRTC call state
export interface VideoCallState {
    isActive: boolean;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    isLocalAudioEnabled: boolean;
    isLocalVideoEnabled: boolean;
    callDuration: number;
    incomingCallOffer: RTCSessionDescription | null; // Stores the SDP offer for an incoming call
    incomingCallerUsername: string | null; // Stores the username of the incoming caller
}

// Configuration for WebRTC peer connection
const peerConnectionConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        // Add more STUN/TURN servers for robustness in production
        // { urls: 'turn:YOUR_TURN_SERVER_ADDRESS:YOUR_TURN_SERVER_PORT', username: 'YOUR_USERNAME', credential: 'YOUR_PASSWORD' },
    ],
};

export const useWebRTC = (
    socket: Socket,
    roomId: string,
    currentUsername: string,
    recipientUsername: string | undefined // The user to call in a 1-on-1 chat
) => {
    console.log('useWebRTC: Hook initialized with recipient:', recipientUsername);

    const [callState, setCallState] = useState<VideoCallState>({
        isActive: false,
        localStream: null,
        remoteStream: null,
        isLocalAudioEnabled: true,
        isLocalVideoEnabled: true,
        callDuration: 0,
        incomingCallOffer: null,
        incomingCallerUsername: null,
    });

    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const callTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Refs for video elements (to be passed to components)
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);

    // --- Helper function to reset call state ---
    const resetCallState = useCallback(() => {
        console.log('useWebRTC: resetCallState called.');

        if (callTimerRef.current) {
            clearInterval(callTimerRef.current);
            callTimerRef.current = null;
            console.log('useWebRTC: Call timer cleared.');
        }

        // Stop all tracks on local stream and close peer connection
        if (callState.localStream) {
            callState.localStream.getTracks().forEach(track => track.stop());
            console.log('useWebRTC: Local stream tracks stopped.');
        }
        if (peerConnectionRef.current) {
            console.log('useWebRTC: Closing peer connection.');
            peerConnectionRef.current.ontrack = null;
            peerConnectionRef.current.onicecandidate = null;
            peerConnectionRef.current.onnegotiationneeded = null;
            peerConnectionRef.current.oniceconnectionstatechange = null;
            peerConnectionRef.current.onconnectionstatechange = null;
            peerConnectionRef.current.ondatachannel = null;
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
            console.log('useWebRTC: Peer connection closed and ref cleared.');
        }

        // Clear video elements srcObject
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
            console.log('useWebRTC: Local video ref srcObject cleared.');
        }
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
            console.log('useWebRTC: Remote video ref srcObject cleared.');
        }

        setCallState({
            isActive: false,
            localStream: null,
            remoteStream: null,
            isLocalAudioEnabled: true,
            isLocalVideoEnabled: true,
            callDuration: 0,
            incomingCallOffer: null,
            incomingCallerUsername: null,
        });
        console.log('useWebRTC: Call state fully reset.');
    }, [callState.localStream]);


    // --- Media Acquisition ---
    const getMedia = useCallback(async () => {
        console.log('useWebRTC: Attempting to get local media...');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            console.log('useWebRTC: Successfully got local media stream:', stream);
            setCallState(prev => ({
                ...prev,
                localStream: stream,
                isLocalAudioEnabled: stream.getAudioTracks().length > 0,
                isLocalVideoEnabled: stream.getVideoTracks().length > 0,
            }));
            // Attach stream to local video ref immediately
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
                console.log('useWebRTC: Local stream attached to localVideoRef.current.');
            } else {
                console.warn('useWebRTC: localVideoRef.current is null when trying to attach stream.');
            }
            return stream;
        } catch (error) {
            console.error('useWebRTC: Error accessing media devices:', error);
            // Add notification for user
            socket.emit('client-error', { type: 'media-access', message: `Failed to access camera/microphone: ${error instanceof Error ? error.message : String(error)}` });
            resetCallState(); // Reset state on media access error
            return null;
        }
    }, [socket, resetCallState]);


    // --- Peer Connection Setup ---
    const createPeerConnection = useCallback((isCaller: boolean) => {
        console.log(`useWebRTC: Creating new RTCPeerConnection (isCaller: ${isCaller}).`);
        const pc = new RTCPeerConnection(peerConnectionConfig);
        peerConnectionRef.current = pc;

        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('useWebRTC: ICE candidate found:', event.candidate);
                socket.emit('webrtc-ice-candidate', {
                    roomId,
                    sender: currentUsername,
                    // Determine receiver based on whether it's an outgoing call or accepting an incoming one
                    receiver: isCaller ? recipientUsername : callState.incomingCallerUsername,
                    candidate: event.candidate,
                });
            } else {
                console.log('useWebRTC: ICE gathering finished. All candidates sent.');
            }
        };

        pc.ontrack = (event) => {
            console.log('useWebRTC: Remote track received:', event.track);
            // Make sure there's at least one stream and that remoteVideoRef is available
            if (remoteVideoRef.current && event.streams && event.streams.length > 0) {
                // Check if the srcObject is already set to the same stream to avoid re-setting
                if (remoteVideoRef.current.srcObject !== event.streams[0]) {
                    remoteVideoRef.current.srcObject = event.streams[0];
                    setCallState(prev => ({ ...prev, remoteStream: event.streams[0] }));
                    console.log('useWebRTC: Remote stream attached to remoteVideoRef.current.');
                } else {
                    console.log('useWebRTC: Remote stream already attached, skipping.');
                }
            } else {
                console.warn('useWebRTC: Remote video ref or stream not ready when track received.');
            }
        };

        pc.onnegotiationneeded = async () => {
            console.log('useWebRTC: onnegotiationneeded event triggered.');
            if (isCaller) { // Only the caller creates the initial offer
                console.log('useWebRTC: Caller: Creating offer...');
                try {
                    await pc.setLocalDescription(await pc.createOffer());
                    console.log('useWebRTC: Caller: Local description (offer) created.');
                    socket.emit('webrtc-offer', {
                        roomId,
                        sender: currentUsername,
                        receiver: recipientUsername,
                        offer: pc.localDescription,
                    });
                    console.log('useWebRTC: Caller: WebRTC offer sent.');
                } catch (error) {
                    console.error('useWebRTC: Caller: Error creating or sending offer:', error);
                }
            } else {
                console.log('useWebRTC: Callee: Skipping offer creation (waiting for remote offer).');
            }
        };

        pc.oniceconnectionstatechange = () => {
            if (peerConnectionRef.current) {
                console.log('useWebRTC: ICE connection state changed to:', peerConnectionRef.current.iceConnectionState);
            }
        };

        pc.onconnectionstatechange = () => {
            if (peerConnectionRef.current) {
                console.log('useWebRTC: Peer connection state changed to:', peerConnectionRef.current.connectionState);
                if (peerConnectionRef.current.connectionState === 'connected') {
                    console.log('useWebRTC: Peer connection is CONNECTED.');
                    // Start call duration timer when connection is established
                    if (!callTimerRef.current) {
                        callTimerRef.current = setInterval(() => {
                            setCallState(prev => ({ ...prev, callDuration: prev.callDuration + 1 }));
                        }, 1000);
                        console.log('useWebRTC: Call duration timer started.');
                    }
                    // Set isActive to true once truly connected
                    setCallState(prev => ({ ...prev, isActive: true }));
                } else if (['disconnected', 'failed', 'closed'].includes(peerConnectionRef.current.connectionState)) {
                    console.warn('useWebRTC: Peer connection disconnected, failed, or closed. Ending call.');
                    endCall(); // Automatically end call on disconnection/failure
                }
            }
        };

        // Add local stream tracks to peer connection
        if (callState.localStream) {
            callState.localStream.getTracks().forEach(track => {
                pc.addTrack(track, callState.localStream!);
                console.log(`useWebRTC: Added local ${track.kind} track to peer connection.`);
            });
        } else {
            console.warn('useWebRTC: No local stream available when creating peer connection.');
        }

        return pc;
    }, [socket, roomId, currentUsername, recipientUsername, callState.localStream, callState.incomingCallerUsername, endCall]);


    // --- Call Actions ---
    const startCall = useCallback(async () => {
        console.log('useWebRTC: Initiating call...');
        if (!recipientUsername) {
            console.warn('useWebRTC: No recipient to call.');
            socket.emit('client-error', { type: 'call', message: 'No recipient to call.' });
            return;
        }

        // Check current call state before proceeding
        if (callState.isActive || callState.incomingCallOffer) {
            console.warn('useWebRTC: Already in an active call or has an incoming offer. Cannot start new call.');
            socket.emit('client-notification', { type: 'warning', title: 'Call in Progress', message: 'You are already in a call or have an incoming call.' });
            return;
        }

        resetCallState(); // Ensure state is clean before starting new call

        const localMediaStream = await getMedia();
        if (!localMediaStream) {
            console.error('useWebRTC: Failed to get local media, cannot start call.');
            return;
        }
        // localStream is already set in state by getMedia, and attached to ref
        // setCallState(prev => ({ ...prev, isActive: true, localStream: localMediaStream })); // isActive set by onconnectionstatechange

        const pc = createPeerConnection(true); // true because this is the caller
        if (!pc) {
            console.error('useWebRTC: Failed to create peer connection for starting call.');
            return;
        }

        // Tracks are added inside createPeerConnection using callState.localStream
        console.log('useWebRTC: Call initiation process complete. Waiting for offer/answer.');
    }, [recipientUsername, callState.isActive, callState.incomingCallOffer, resetCallState, getMedia, createPeerConnection, socket]);


    const endCall = useCallback(() => {
        console.log('useWebRTC: Ending call...');
        // Notify the other participant if there was one involved
        const targetReceiver = recipientUsername || callState.incomingCallerUsername;
        if (targetReceiver) {
            socket.emit('webrtc-end-call', {
                roomId,
                sender: currentUsername,
                receiver: targetReceiver,
            });
            console.log(`useWebRTC: End call signal sent to ${targetReceiver}.`);
        } else {
            console.log('useWebRTC: No active recipient to send end-call signal to.');
        }

        resetCallState(); // Clean up all resources
        console.log('useWebRTC: Call ended and state reset.');
    }, [socket, roomId, currentUsername, recipientUsername, callState.incomingCallerUsername, resetCallState]);


    const acceptIncomingCall = useCallback(async () => {
        console.log('useWebRTC: Accepting incoming call...');
        if (!callState.incomingCallOffer || !callState.incomingCallerUsername) {
            console.error('useWebRTC: No incoming call offer or caller username to accept.');
            socket.emit('client-error', { type: 'call-accept', message: 'No incoming call offer to accept.' });
            return;
        }

        resetCallState(); // Ensure state is clean before accepting

        const localMediaStream = await getMedia();
        if (!localMediaStream) {
            console.error('useWebRTC: Failed to get local media, cannot accept call.');
            return;
        }
        // localStream is already set in state by getMedia, and attached to ref

        const pc = createPeerConnection(false); // false because this is the callee
        if (!pc) {
            console.error('useWebRTC: Failed to create peer connection for accepting call.');
            return;
        }

        // Tracks are added inside createPeerConnection using callState.localStream

        try {
            console.log('useWebRTC: Callee: Setting remote description (offer).');
            await pc.setRemoteDescription(new RTCSessionDescription(callState.incomingCallOffer));
            console.log('useWebRTC: Callee: Remote description (offer) set.');

            console.log('useWebRTC: Callee: Creating answer...');
            await pc.setLocalDescription(await pc.createAnswer());
            console.log('useWebRTC: Callee: Local description (answer) created.');

            socket.emit('webrtc-answer', {
                roomId,
                sender: currentUsername,
                receiver: callState.incomingCallerUsername,
                answer: pc.localDescription,
            });
            console.log('useWebRTC: Callee: WebRTC answer sent.');

        } catch (error) {
            console.error('useWebRTC: Error accepting call:', error);
            socket.emit('client-error', { type: 'call-accept', message: `Error accepting call: ${error instanceof Error ? error.message : String(error)}` });
            endCall(); // End call process on error
        }
    }, [socket, currentUsername, callState.incomingCallOffer, callState.incomingCallerUsername, resetCallState, getMedia, createPeerConnection, endCall]);


    const rejectIncomingCall = useCallback(() => {
        console.log('useWebRTC: Rejecting incoming call...');
        if (callState.incomingCallerUsername && callState.incomingCallOffer) {
            socket.emit('webrtc-reject-call', {
                roomId,
                sender: currentUsername,
                receiver: callState.incomingCallerUsername,
            });
            console.log(`useWebRTC: Rejected call from ${callState.incomingCallerUsername}.`);
        } else {
            console.warn('useWebRTC: No incoming call to reject or caller unknown.');
        }
        resetCallState();
    }, [socket, roomId, currentUsername, callState.incomingCallerUsername, callState.incomingCallOffer, resetCallState]);


    const toggleVideo = useCallback(() => {
        console.log('useWebRTC: Toggling local video.');
        if (callState.localStream) {
            const videoTrack = callState.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setCallState(prev => ({ ...prev, isLocalVideoEnabled: videoTrack.enabled }));
                console.log(`useWebRTC: Video track enabled: ${videoTrack.enabled}`);
            } else {
                console.warn('useWebRTC: No video track found in local stream.');
            }
        } else {
            console.warn('useWebRTC: No local stream available to toggle video.');
        }
    }, [callState.localStream]);


    const toggleAudio = useCallback(() => {
        console.log('useWebRTC: Toggling local audio.');
        if (callState.localStream) {
            const audioTrack = callState.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setCallState(prev => ({ ...prev, isLocalAudioEnabled: audioTrack.enabled }));
                console.log(`useWebRTC: Audio track enabled: ${audioTrack.enabled}`);
            } else {
                console.warn('useWebRTC: No audio track found in local stream.');
            }
        } else {
            console.warn('useWebRTC: No local stream available to toggle audio.');
        }
    }, [callState.localStream]);


    // --- Socket Event Listeners for WebRTC Signaling ---
    useEffect(() => {
        if (!socket.on) {
            console.warn('useWebRTC: Socket instance not ready for event listeners.');
            return;
        }

        console.log('useWebRTC: Setting up WebRTC socket listeners.');

        const unsubscribeOffer = socket.on('webrtc-offer', async (data: { sender: string; offer: RTCSessionDescription }) => {
            console.log('useWebRTC: Received WebRTC offer:', data);
            // Check if already in a call or already have an incoming offer
            if (callState.isActive) {
                console.warn(`useWebRTC: Already in an active call. Rejecting offer from ${data.sender}.`);
                socket.emit('webrtc-reject-call', {
                    roomId,
                    sender: currentUsername,
                    receiver: data.sender, // Reject the offer
                    reason: 'already_active_call'
                });
                return;
            }
             if (callState.incomingCallOffer) {
                console.warn(`useWebRTC: Already has a pending incoming offer. Rejecting offer from ${data.sender}.`);
                socket.emit('webrtc-reject-call', {
                    roomId,
                    sender: currentUsername,
                    receiver: data.sender, // Reject the offer
                    reason: 'already_pending_offer'
                });
                return;
            }


            setCallState(prev => ({
                ...prev,
                incomingCallOffer: new RTCSessionDescription(data.offer),
                incomingCallerUsername: data.sender,
            }));
            console.log('useWebRTC: Incoming call offer stored. Ready to accept/reject.');
        });

        const unsubscribeAnswer = socket.on('webrtc-answer', async (data: { sender: string; answer: RTCSessionDescription }) => {
            console.log('useWebRTC: Received WebRTC answer:', data);
            if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'stable') {
                try {
                    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
                    console.log('useWebRTC: Remote description (answer) set successfully.');
                } catch (error) {
                    console.error('useWebRTC: Error setting remote description (answer):', error);
                }
            } else {
                console.warn('useWebRTC: Peer connection not ready to set remote description (answer) or already stable.');
            }
        });

        const unsubscribeIceCandidate = socket.on('webrtc-ice-candidate', async (data: { sender: string; candidate: RTCIceCandidate }) => {
            console.log('useWebRTC: Received ICE candidate:', data);
            if (peerConnectionRef.current && data.candidate) { // Ensure candidate is not null
                try {
                    await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
                    console.log('useWebRTC: ICE candidate added.');
                } catch (error) {
                    console.error('useWebRTC: Error adding ICE candidate:', error);
                }
            } else {
                console.warn('useWebRTC: Peer connection not initialized or candidate is null, cannot add ICE candidate.');
            }
        });

        const unsubscribeEndCall = socket.on('webrtc-end-call', (data: { sender: string }) => {
            console.log(`useWebRTC: Received end call signal from ${data.sender}.`);
            // Only show notification if it's the other person ending the call
            if (data.sender !== currentUsername) {
                socket.emit('client-notification', { type: 'info', title: 'Call Ended', message: `${data.sender} has ended the call.` });
            }
            resetCallState(); // This will also handle local cleanup
        });

        const unsubscribeRejectCall = socket.on('webrtc-reject-call', (data: { sender: string }) => {
            console.log(`useWebRTC: Received reject call signal from ${data.sender}.`);
            // If the call was rejected by the recipient
            if (data.sender === (recipientUsername || callState.incomingCallerUsername)) {
                if (!callState.isActive) { // Only show notification if we are the caller and call isn't active yet
                    socket.emit('client-notification', { type: 'info', title: 'Call Rejected', message: `${data.sender} declined your call.` });
                }
            }
            resetCallState(); // Reset state for the caller (or just clear incoming offer for callee if they rejected)
        });

        return () => {
            console.log('useWebRTC: Cleaning up WebRTC socket listeners.');
            unsubscribeOffer();
            unsubscribeAnswer();
            unsubscribeIceCandidate();
            unsubscribeEndCall();
            unsubscribeRejectCall();
        };
    }, [socket, roomId, currentUsername, recipientUsername, callState.isActive, callState.incomingCallOffer, resetCallState]);


    // Cleanup on unmount
    useEffect(() => {
        return () => {
            console.log('useWebRTC: Hook unmounting. Ensuring full cleanup.');
            resetCallState();
        };
    }, [resetCallState]); // Depends on resetCallState

    // Utility to format call duration
    const formatCallDuration = (seconds: number): string => {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        return [h, m, s]
            .map(v => v < 10 ? '0' + v : v)
            .filter((v, i) => v !== '00' || i > 0 || h > 0) // Hide hours if zero, unless minutes/seconds are also zero
            .join(':');
    };

    return {
        callState,
        localVideoRef,
        remoteVideoRef,
        startCall,
        endCall,
        acceptIncomingCall,
        rejectIncomingCall,
        toggleVideo,
        toggleAudio,
        formatCallDuration,
    };
};
