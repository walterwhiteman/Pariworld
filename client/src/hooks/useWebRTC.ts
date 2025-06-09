// src/hooks/useWebRTC.ts

import { useCallback, useEffect, useRef, useState } from 'react';
import { WebRTCSignal } from '@/types/chat'; // Assuming WebRTCSignal is defined like { type: string, data: any, roomId: string, sender: string, recipient?: string }

/**
 * Interface for the video call state.
 * Expanded to include incoming call details for UI management.
 */
export interface VideoCallState {
    isActive: boolean; // True if a call is currently active (in progress)
    isLocalVideoEnabled: boolean;
    isLocalAudioEnabled: boolean;
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    callDuration: number; // In seconds
    incomingCallOffer: RTCSessionDescriptionInit | null; // Stores the offer if an incoming call is pending
    incomingCallerUsername: string | null; // Stores the username of the person calling
}

/**
 * Custom hook for WebRTC video calling functionality
 * Implements peer-to-peer video communication for the chat application
 */
export function useWebRTC(socket: any, roomId: string, username: string, recipientId: string | undefined) {
    // 1. State and Ref declarations
    const [callState, setCallState] = useState<VideoCallState>({
        isActive: false,
        isLocalVideoEnabled: true,
        isLocalAudioEnabled: true,
        localStream: null,
        remoteStream: null,
        callDuration: 0,
        incomingCallOffer: null, // Initial state for incoming call
        incomingCallerUsername: null, // Initial state for incoming caller
    });

    const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
    const localVideoRef = useRef<HTMLVideoElement | null>(null);
    const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
    const callStartTimeRef = useRef<number | null>(null);
    const callTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Using a ref to hold the current `endCall` function to avoid stale closures
    // when `endCall` is called from inside `useEffect` or `onconnectionstatechange`.
    const endCallRef = useRef<(() => void) | null>(null);


    // 2. Constants like rtcConfig
    // IMPORTANT: For better call quality and reliability across different network types (e.g., behind strict NATs),
    // you should add TURN servers here. STUN servers are for direct peer-to-peer connections.
    const rtcConfig: RTCConfiguration = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            // // Example TURN server (replace with your actual TURN server details)
            // {
            //     urls: 'turn:YOUR_TURN_SERVER_IP:3478',
            //     username: 'YOUR_TURN_USERNAME',
            //     credential: 'YOUR_TURN_PASSWORD'
            // }
        ]
    };

    /**
     * Defines the endCall function as a useCallback to stabilize its reference.
     * Dependencies are carefully chosen to prevent unnecessary re-creations.
     */
    const endCall = useCallback(() => {
        console.log('endCall: Ending video call sequence...');

        // Stop call timer
        if (callTimerRef.current) {
            clearInterval(callTimerRef.current);
            callTimerRef.current = null;
            console.log('endCall: Call timer cleared.');
        }

        // Close peer connection
        if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
            peerConnectionRef.current = null;
            console.log('endCall: Peer connection closed.');
        }

        // Stop local stream tracks
        if (callState.localStream) {
            callState.localStream.getTracks().forEach(track => {
                track.stop();
                console.log(`endCall: Stopped local stream track: ${track.kind}`);
            });
            console.log('endCall: Local stream tracks stopped.');
        }

        // Clear video elements srcObject
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = null;
            console.log('endCall: Local video ref srcObject cleared.');
        }
        if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null;
            console.log('endCall: Remote video ref srcObject cleared.');
        }

        // Notify other peer that call has ended (only if call was active and there was a recipient)
        // Ensure recipientId exists and is the correct peer to notify
        // This is important because `recipientId` is for the OUTGOING call,
        // but if we were the receiver, we should notify the INCOMING caller.
        const activePeerId = callState.incomingCallerUsername || recipientId;

        if (socket?.emit && callState.isActive && activePeerId) {
            console.log(`endCall: Emitting call-end signal to ${activePeerId}.`);
            socket.emit('webrtc-signal', {
                type: 'call-end',
                data: {},
                roomId,
                sender: username,
                recipient: activePeerId
            });
        } else {
            console.warn('endCall: Not emitting call-end signal (socket not ready, call not active, or no activePeerId).');
        }

        // Reset call state - this WILL cause a re-render
        setCallState({
            isActive: false,
            isLocalVideoEnabled: true,
            isLocalAudioEnabled: true,
            localStream: null,
            remoteStream: null,
            callDuration: 0,
            incomingCallOffer: null, // Clear any pending incoming call
            incomingCallerUsername: null, // Clear any pending incoming caller
        });
        console.log('endCall: Call state reset.');

        callStartTimeRef.current = null;
        console.log('endCall: Video call sequence ended.');
    }, [
        socket,
        roomId,
        username,
        setCallState,
        callState.localStream,
        callState.isActive,
        recipientId,
        callState.incomingCallerUsername // Added to dependencies
    ]);

    // Update the ref to the latest `endCall` function whenever `endCall` is re-created.
    useEffect(() => {
        endCallRef.current = endCall;
    }, [endCall]);


    /**
     * Initialize WebRTC peer connection
     */
    const initializePeerConnection = useCallback(() => {
        console.log('initializePeerConnection: Attempting to create RTCPeerConnection...');
        try {
            const peerConnection = new RTCPeerConnection(rtcConfig);
            peerConnectionRef.current = peerConnection;
            console.log('initializePeerConnection: RTCPeerConnection created.');

            // Handle ICE candidates
            peerConnection.onicecandidate = (event) => {
                // Determine the correct recipient for the ICE candidate
                // If we are making an outgoing call, recipientId is the target.
                // If we are answering an incoming call, callState.incomingCallerUsername is the target.
                const currentCallRecipient = callState.incomingCallerUsername || recipientId;

                if (event.candidate && socket?.emit && currentCallRecipient) {
                    console.log(`onicecandidate: Sending ICE candidate to ${currentCallRecipient}.`);
                    socket.emit('webrtc-signal', {
                        type: 'ice-candidate',
                        data: event.candidate,
                        roomId,
                        sender: username,
                        recipient: currentCallRecipient
                    });
                } else {
                    console.log('onicecandidate: No more ICE candidates, event.candidate is null, or socket/recipient not ready.');
                }
            };

            // Handle remote stream
            peerConnection.ontrack = (event) => {
                console.log('ontrack: Received remote stream/track.');
                // Note: event.streams is an array, typically it contains one MediaStream
                const [remoteStream] = event.streams;
                if (remoteStream) {
                    setCallState(prev => ({ ...prev, remoteStream }));

                    if (remoteVideoRef.current) {
                        remoteVideoRef.current.srcObject = remoteStream;
                        console.log('ontrack: Remote stream set on video element.');
                    }
                } else {
                    console.warn('ontrack: Received event but no remote stream found.');
                }
            };

            // Handle connection state changes
            peerConnection.onconnectionstatechange = () => {
                const pc = peerConnectionRef.current;
                if (!pc) return;

                console.log('onconnectionstatechange: Connection state:', pc.connectionState);
                if (pc.connectionState === 'disconnected' ||
                    pc.connectionState === 'failed' ||
                    pc.connectionState === 'closed') { // Added 'closed' state
                    console.log('onconnectionstatechange: Peer connection disconnected, failed, or closed. Ending call locally via ref.');
                    endCallRef.current?.(); // Use the ref
                } else if (pc.connectionState === 'connected') {
                    console.log('onconnectionstatechange: Peer connection established!');
                    // This is a good point to start the call timer if it hasn't already.
                    if (!callStartTimeRef.current) {
                         callStartTimeRef.current = Date.now();
                         startCallTimer();
                    }
                }
            };

            return peerConnection;
        } catch (error) {
            console.error('initializePeerConnection: Error initializing peer connection:', error);
            endCallRef.current?.(); // Use the ref to ensure cleanup
            return null;
        }
    }, [socket, roomId, username, recipientId, setCallState, callState.incomingCallerUsername]);


    /**
     * Get user media (camera and microphone)
     * Optional: Add more specific video constraints for quality.
     */
    const getUserMedia = useCallback(async (): Promise<MediaStream | null> => {
        console.log('getUserMedia: Requesting media devices (video & audio)... [Step 1]');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640, max: 1280 },  // Try to get 640x480, max 1280x720
                    height: { ideal: 480, max: 720 },
                    frameRate: { ideal: 30 }          // Try for 30 frames per second
                },
                audio: true
            });

            setCallState(prev => ({ ...prev, localStream: stream }));

            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
                // Add autoplay and playsInline attributes for mobile compatibility
                localVideoRef.current.autoplay = true;
                localVideoRef.current.playsInline = true;
                localVideoRef.current.muted = true; // Mute local video to prevent echo
                console.log('getUserMedia: Local stream set on video element. [Step 2]');
            }
            console.log('getUserMedia: Media stream successfully obtained. [Step 3]');
            return stream;
        } catch (error: any) {
            console.error('getUserMedia: !!! CRITICAL ERROR accessing media devices:', error);
            if (error.name) {
                console.error('getUserMedia: Error Name:', error.name);
            }
            if (error.message) {
                console.error('getUserMedia: Error Message:', error.message);
            }
            alert(`Failed to access camera/microphone. Please ensure permissions are granted. Error: ${error.name}`);
            console.log('getUserMedia: Invoking endCall due to media access error. [Step 4]');
            endCallRef.current?.(); // Use the ref for immediate cleanup
            return null;
        }
    }, [setCallState]);


    /**
     * Start call duration timer
     */
    const startCallTimer = useCallback(() => {
        console.log('startCallTimer: Starting call duration timer.');
        if (callTimerRef.current) clearInterval(callTimerRef.current); // Clear any existing timer
        callTimerRef.current = setInterval(() => {
            if (callStartTimeRef.current) {
                const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
                setCallState(prev => ({ ...prev, callDuration: duration }));
            }
        }, 1000);
    }, [setCallState]);


    /**
     * Function to start a video call (initiator)
     */
    const startCall = useCallback(async () => {
        console.log('startCall: Initiating video call sequence.');
        if (!recipientId) { // Check if recipient is available
            console.error('startCall: Cannot initiate call, recipient is undefined. Please ensure another user is in the room.');
            alert('Cannot initiate call. No recipient found in the room. Please wait for another user to join.');
            return;
        }

        // Prevent starting a call if one is already active or incoming
        if (callState.isActive || callState.incomingCallOffer) {
            console.warn('startCall: Call already active or incoming call pending. Aborting new call initiation.');
            return;
        }

        try {
            const localStream = await getUserMedia();
            if (!localStream) {
                console.error('startCall: No local stream obtained. Aborting call.');
                return;
            }
            console.log('startCall: Local stream obtained successfully.');

            const peerConnection = initializePeerConnection();
            if (!peerConnection) {
                console.error('startCall: Failed to initialize peer connection. Aborting call.');
                endCallRef.current?.();
                return;
            }
            console.log('startCall: Peer connection initialized.');

            // Add local stream to peer connection
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
                console.log(`startCall: Added local track: ${track.kind}`);
            });

            // Create and send offer
            console.log('startCall: Creating offer...');
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            console.log('startCall: Local description set (offer).');

            if (socket?.emit) {
                console.log('startCall: Emitting WebRTC offer signal to', recipientId);
                socket.emit('webrtc-signal', {
                    type: 'offer',
                    data: offer,
                    roomId,
                    sender: username,
                    recipient: recipientId
                });
            }

            // Update call state to active
            setCallState(prev => ({
                ...prev,
                isActive: true,
                localStream
            }));
            console.log('startCall: Call state updated to isActive: true.');

            callStartTimeRef.current = Date.now();
            startCallTimer();
            console.log('startCall: Call timer started.');

            console.log('startCall: Video call sequence complete.');
        } catch (error) {
            console.error('startCall: Uncaught error during call initiation:', error);
            endCallRef.current?.();
        }
    }, [getUserMedia, initializePeerConnection, socket, roomId, username, startCallTimer, setCallState, recipientId, callState.isActive, callState.incomingCallOffer]);


    /**
     * Function to accept an incoming call (receiver action triggered by user click)
     */
    const acceptIncomingCall = useCallback(async () => {
        // Ensure there is a pending incoming call to accept
        if (!callState.incomingCallOffer || !callState.incomingCallerUsername) {
            console.warn('acceptIncomingCall: No pending incoming call to accept.');
            return;
        }

        console.log(`acceptIncomingCall: User accepting incoming call from ${callState.incomingCallerUsername}.`);
        const offerToAnswer = callState.incomingCallOffer;
        const callerUsername = callState.incomingCallerUsername;

        // Immediately clear incoming call state to prevent re-acceptance or UI issues
        setCallState(prev => ({
            ...prev,
            incomingCallOffer: null,
            incomingCallerUsername: null,
        }));

        try {
            const localStream = await getUserMedia();
            if (!localStream) {
                console.error('acceptIncomingCall: No local stream obtained. Aborting answer.');
                return;
            }
            console.log('acceptIncomingCall: Local stream obtained successfully for answer.');

            const peerConnection = initializePeerConnection();
            if (!peerConnection) {
                console.error('acceptIncomingCall: Failed to initialize peer connection for answer. Aborting.');
                endCallRef.current?.();
                return;
            }
            console.log('acceptIncomingCall: Peer connection initialized for answer.');

            // Add local stream to peer connection
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
                console.log(`acceptIncomingCall: Added local track for answer: ${track.kind}`);
            });

            // Set remote description (offer) and create answer
            console.log('acceptIncomingCall: Setting remote description (offer) and creating answer...');
            await peerConnection.setRemoteDescription(new RTCSessionDescription(offerToAnswer));
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            console.log('acceptIncomingCall: Local description set (answer).');

            if (socket?.emit) {
                console.log('acceptIncomingCall: Emitting WebRTC answer signal to', callerUsername);
                socket.emit('webrtc-signal', {
                    type: 'answer',
                    data: answer,
                    roomId,
                    sender: username,
                    recipient: callerUsername // Send answer back to the actual caller
                });
            }

            // Update call state to active
            setCallState(prev => ({
                ...prev,
                isActive: true,
                localStream
            }));
            console.log('acceptIncomingCall: Call state updated to isActive: true.');

            callStartTimeRef.current = Date.now();
            startCallTimer();
            console.log('acceptIncomingCall: Call timer started.');

            console.log('acceptIncomingCall: Call answer sequence complete.');
        } catch (error) {
            console.error('acceptIncomingCall: Uncaught error during call answering:', error);
            endCallRef.current?.();
        }
    }, [callState.incomingCallOffer, callState.incomingCallerUsername, getUserMedia, initializePeerConnection, socket, roomId, username, startCallTimer, setCallState]);


    /**
     * Function to reject an incoming call (receiver action triggered by user click)
     */
    const rejectIncomingCall = useCallback(() => {
        if (callState.incomingCallerUsername) {
            console.log(`rejectIncomingCall: User rejected incoming call from ${callState.incomingCallerUsername}.`);
            // Send a signal to the caller that the call was rejected
            if (socket?.emit) {
                socket.emit('webrtc-signal', {
                    type: 'call-rejected', // Custom signal type for rejection
                    data: {},
                    roomId,
                    sender: username,
                    recipient: callState.incomingCallerUsername,
                });
            }
        }
        // Clear incoming call state regardless of whether a signal was sent
        setCallState(prev => ({
            ...prev,
            incomingCallOffer: null,
            incomingCallerUsername: null,
        }));
        console.log('rejectIncomingCall: Incoming call state cleared.');
    }, [callState.incomingCallerUsername, socket, roomId, username, setCallState]);


    /**
     * Toggle local video
     */
    const toggleVideo = useCallback(() => {
        if (callState.localStream) {
            const videoTrack = callState.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setCallState(prev => ({
                    ...prev,
                    isLocalVideoEnabled: videoTrack.enabled
                }));
                console.log(`toggleVideo: Local video enabled: ${videoTrack.enabled}`);
            } else {
                console.warn('toggleVideo: No video track found in local stream.');
            }
        } else {
            console.warn('toggleVideo: No local stream to toggle video.');
        }
    }, [callState.localStream, setCallState]);

    /**
     * Toggle local audio
     */
    const toggleAudio = useCallback(() => {
        if (callState.localStream) {
            const audioTrack = callState.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setCallState(prev => ({
                    ...prev,
                    isLocalAudioEnabled: audioTrack.enabled
                }));
                console.log(`toggleAudio: Local audio enabled: ${audioTrack.enabled}`);
            } else {
                console.warn('toggleAudio: No audio track found in local stream.');
            }
        } else {
            console.warn('toggleAudio: No local stream to toggle audio.');
        }
    }, [callState.localStream, setCallState]);


    /**
     * Format call duration for display
     */
    const formatCallDuration = useCallback((seconds: number): string => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }, []);

    /**
     * Handle WebRTC signaling messages
     */
    useEffect(() => {
        console.log('useEffect: Setting up WebRTC signal listener.');
        if (!socket?.on) {
            console.warn('useEffect: Socket is not ready to set up WebRTC signal listener.');
            return;
        }

        const handleWebRTCSignal = async (signal: WebRTCSignal) => {
            console.log(`handleWebRTCSignal: Received signal type: ${signal.type} from ${signal.sender}`);
            console.log(`handleWebRTCSignal DEBUG: Current client username: ${username}`);
            console.log(`handleWebRTCSignal DEBUG: Current client roomId: ${roomId}`);
            console.log(`handleWebRTCSignal DEBUG: Signal sender: ${signal.sender}`);
            console.log(`handleWebRTCSignal DEBUG: Signal roomId: ${signal.roomId}`);
            console.log(`handleWebRTCSignal DEBUG: Signal recipient: ${signal.recipient}`);


            // Ensure signal is for this room and not from self
            if (signal.roomId !== roomId) {
                console.log(`handleWebRTCSignal: Signal ignored (roomId mismatch: signal.roomId='${signal.roomId}', client.roomId='${roomId}').`);
                return;
            }
            if (signal.sender === username) {
                console.log(`handleWebRTCSignal: Signal ignored (from self: signal.sender='${signal.sender}', client.username='${username}').`);
                return;
            }
            // CRITICAL CHECK: If the signal has a 'recipient' field, ensure it's for *this* client.
            // This prevents clients from processing signals not intended for them in multi-user rooms.
            if (signal.recipient && signal.recipient !== username) {
                console.log(`handleWebRTCSignal: Signal ignored (intended for '${signal.recipient}', not '${username}').`);
                return;
            }


            try {
                switch (signal.type) {
                    case 'offer':
                        console.log('handleWebRTCSignal: Received offer. Setting incoming call state.');
                        // If a call is already active, reject new offers
                        if (callState.isActive) {
                            console.warn('handleWebRTCSignal: Call already active, rejecting new offer.');
                            socket.emit('webrtc-signal', {
                                type: 'call-rejected',
                                data: { reason: 'busy' },
                                roomId,
                                sender: username,
                                recipient: signal.sender,
                            });
                            return;
                        }
                        // Set incoming call state instead of immediately answering
                        setCallState(prev => ({
                            ...prev,
                            incomingCallOffer: signal.data,
                            incomingCallerUsername: signal.sender,
                        }));
                        break;

                    case 'answer':
                        console.log('handleWebRTCSignal: Processing answer.');
                        if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'closed') { // Check signaling state
                            await peerConnectionRef.current.setRemoteDescription(
                                new RTCSessionDescription(signal.data)
                            );
                            console.log('handleWebRTCSignal: Remote description set (answer).');
                        } else {
                            console.warn('handleWebRTCSignal: Peer connection not initialized or closed when receiving answer.');
                        }
                        break;

                    case 'ice-candidate':
                        console.log('handleWebRTCSignal: Processing ICE candidate.');
                        if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription && peerConnectionRef.current.signalingState !== 'closed') {
                            await peerConnectionRef.current.addIceCandidate(
                                new RTCIceCandidate(signal.data)
                            );
                            console.log('handleWebRTCSignal: ICE candidate added.');
                        } else {
                            console.warn('handleWebRTCSignal: Peer connection not initialized, remote description not set, or closed when receiving ICE candidate.');
                        }
                        break;

                    case 'call-end':
                        console.log(`handleWebRTCSignal: Received call-end signal from ${signal.sender}. Ending call locally.`);
                        endCallRef.current?.(); // Use the ref to trigger cleanup
                        break;

                    case 'call-rejected': // New case for call rejection
                        console.log(`handleWebRTCSignal: Received call-rejected signal from ${signal.sender}.`);
                        // If we initiated a call to this sender, clear the pending state
                        if (recipientId === signal.sender) { // Check if the rejection is for our outgoing call
                            alert(`${signal.sender} rejected your call.`);
                            endCallRef.current?.(); // End the call sequence from our side
                        } else if (callState.incomingCallerUsername === signal.sender) { // If it was an incoming call we ignored/didn't pick up
                            setCallState(prev => ({
                                ...prev,
                                incomingCallOffer: null,
                                incomingCallerUsername: null,
                            }));
                        }
                        break;

                    default:
                        console.warn(`handleWebRTCSignal: Unknown signal type: ${signal.type}`);
                }
            } catch (error) {
                console.error('handleWebRTCSignal: Error handling WebRTC signal:', error);
            }
        };

        // Attach the listener
        socket.on('webrtc-signal', handleWebRTCSignal);
        console.log('useEffect: WebRTC signal listener attached.');

        // Cleanup function - CRITICAL FIX for TypeError: e.off is not a function
        return () => {
            if (socket && typeof socket.off === 'function') {
                socket.off('webrtc-signal', handleWebRTCSignal);
                console.log('useEffect: Cleaned up WebRTC signal listener.');
            } else {
                console.warn('useEffect cleanup: Socket is null or does not have .off method. Skipping listener cleanup.');
            }
        };
    }, [socket, roomId, username, recipientId, setCallState, callState.isActive, callState.incomingCallerUsername, endCallRef]); // Add setCallState to deps

    /**
     * Cleanup on component unmount
     */
    useEffect(() => {
        return () => {
            console.log('useEffect cleanup: Component unmounting, ensuring call is ended.');
            endCallRef.current?.(); // Use the ref to ensure cleanup
        };
    }, []);


    return {
        callState,                 // Now includes incomingCallOffer and incomingCallerUsername
        localVideoRef,
        remoteVideoRef,
        startCall,
        endCall,
        acceptIncomingCall,        // New function to accept call
        rejectIncomingCall,        // New function to reject call
        toggleVideo,
        toggleAudio,
        formatCallDuration
    };
}
