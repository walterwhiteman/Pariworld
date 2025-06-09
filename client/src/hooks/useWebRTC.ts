import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Peer from 'simple-peer';
import { io, Socket } from 'socket.io-client';

// Assuming these types are defined elsewhere, e.g., in types/chat.ts
export interface WebRTCSignal {
    signal: Peer.Signal;
    recipientId: string;
    senderId: string;
}

export interface CallState {
    isActive: boolean;
    isCalling: boolean; // True if initiating a call
    isReceivingCall: boolean; // True if an incoming call is ringing
    localStream: MediaStream | null;
    remoteStream: MediaStream | null;
    isLocalAudioEnabled: boolean;
    isLocalVideoEnabled: boolean;
    callDuration: number;
    incomingCallOffer: WebRTCSignal | null;
    incomingCallerUsername: string | null;
    peerConnection: Peer.Instance | null;
}

interface UseWebRTCOptions {
    roomId: string;
    username: string;
    recipientId?: string; // Optional: for direct calls
    onCallAccepted?: (callId: string) => void;
    onCallEnded?: (reason?: string) => void;
    onIncomingCall?: (callerUsername: string, callId: string) => void;
    onCallRejected?: () => void;
    initialCallState?: CallState;
}

const initialCallState: CallState = {
    isActive: false,
    isCalling: false,
    isReceivingCall: false,
    localStream: null,
    remoteStream: null,
    isLocalAudioEnabled: true,
    isLocalVideoEnabled: true,
    callDuration: 0,
    incomingCallOffer: null,
    incomingCallerUsername: null,
    peerConnection: null,
};

export const useWebRTC = ({
    roomId,
    username,
    recipientId,
    onCallAccepted,
    onCallEnded,
    onIncomingCall,
    onCallRejected,
    initialCallState: propInitialCallState = initialCallState,
}: UseWebRTCOptions) => {
    const [callState, setCallState] = useState<CallState>(propInitialCallState);
    const localVideoRef = useRef<HTMLVideoElement>(null);
    const remoteVideoRef = useRef<HTMLVideoElement>(null);
    const callDurationIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Using useMemo to ensure socket object is stable across renders
    const socket = useMemo<Socket | null>(() => {
        if (!process.env.NEXT_PUBLIC_WS_URL) {
            console.error("NEXT_PUBLIC_WS_URL is not defined.");
            return null;
        }
        const newSocket = io(process.env.NEXT_PUBLIC_WS_URL, {
            query: { roomId, username },
            transports: ['websocket'],
        });

        newSocket.on('connect', () => {
            console.log('Socket connected:', newSocket.id);
        });

        newSocket.on('disconnect', (reason) => {
            console.log('Socket disconnected:', reason);
            // Optionally handle cleanup or re-connection here
        });

        newSocket.on('connect_error', (error) => {
            console.error('Socket connection error:', error);
        });

        return newSocket;
    }, [roomId, username]); // Dependencies to re-create socket only if roomId or username changes

    // Ref to hold endCall function to avoid stale closure issues in useEffect
    const endCallRef = useRef(onCallEnded);
    useEffect(() => {
        endCallRef.current = onCallEnded;
    }, [onCallEnded]);

    const startCall = useCallback(async (targetRecipientId: string) => {
        if (!socket) {
            console.error('Socket not initialized for calling.');
            return;
        }
        if (callState.isActive || callState.isCalling || callState.isReceivingCall) {
            console.warn('Already in a call or attempting to call.');
            return;
        }

        setCallState(prev => ({ ...prev, isCalling: true }));

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }
            setCallState(prev => ({ ...prev, localStream: stream }));

            console.log('Initiating peer connection...');
            const peer = new Peer({ initiator: true, stream: stream, trickle: false });

            peer.on('signal', (data) => {
                console.log('Peer: Signal generated (initiator)', data);
                socket.emit('webrtc-signal', {
                    signal: data,
                    recipientId: targetRecipientId,
                    senderId: socket.id,
                });
            });

            peer.on('stream', (stream) => {
                console.log('Peer: Remote stream received (initiator)');
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = stream;
                }
                setCallState(prev => ({ ...prev, remoteStream: stream, isActive: true, isCalling: false }));
                onCallAccepted?.(targetRecipientId); // Notify parent component
                startCallDurationTimer();
            });

            peer.on('connect', () => {
                console.log('Peer: Connection established (initiator)');
            });

            peer.on('close', () => {
                console.log('Peer: Connection closed (initiator)');
                endCall('peer-closed');
            });

            peer.on('error', (err) => {
                console.error('Peer error (initiator):', err);
                endCall('peer-error');
            });

            setCallState(prev => ({ ...prev, peerConnection: peer }));

            // Emit 'call-request' to the server for the recipient
            socket.emit('call-request', {
                recipientId: targetRecipientId,
                callerUsername: username,
                callerSocketId: socket.id,
            });
            console.log(`Call request sent to ${targetRecipientId}`);

        } catch (error) {
            console.error('Failed to get media devices or start call:', error);
            setCallState(prev => ({ ...prev, isCalling: false }));
            endCall('media-error');
        }
    }, [socket, username, callState.isActive, callState.isCalling, callState.isReceivingCall, onCallAccepted]);


    const acceptCall = useCallback(async () => {
        const { incomingCallOffer, peerConnection, localStream } = callState;
        if (!incomingCallOffer || !socket) {
            console.error('No incoming call offer or socket not ready.');
            return;
        }
        if (peerConnection && localStream) {
            console.warn('Call already active or media already obtained.');
            return;
        }

        setCallState(prev => ({ ...prev, isReceivingCall: false, isActive: true })); // Set active immediately on accept

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = stream;
            }
            setCallState(prev => ({ ...prev, localStream: stream }));

            console.log('Accepting call, creating peer connection...');
            const peer = new Peer({ initiator: false, stream: stream, trickle: false });

            peer.on('signal', (data) => {
                console.log('Peer: Signal generated (receiver)', data);
                socket.emit('webrtc-signal', {
                    signal: data,
                    recipientId: incomingCallOffer.senderId, // Send signal back to the caller
                    senderId: socket.id,
                });
            });

            peer.on('stream', (stream) => {
                console.log('Peer: Remote stream received (receiver)');
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = stream;
                }
                setCallState(prev => ({ ...prev, remoteStream: stream }));
                startCallDurationTimer();
            });

            peer.on('connect', () => {
                console.log('Peer: Connection established (receiver)');
            });

            peer.on('close', () => {
                console.log('Peer: Connection closed (receiver)');
                endCall('peer-closed');
            });

            peer.on('error', (err) => {
                console.error('Peer error (receiver):', err);
                endCall('peer-error');
            });

            setCallState(prev => ({ ...prev, peerConnection: peer }));

            // Process the incoming offer signal
            peer.signal(incomingCallOffer.signal);
            console.log('Processed incoming offer signal.');

            onCallAccepted?.(incomingCallOffer.senderId); // Notify parent component

        } catch (error) {
            console.error('Failed to get media devices or accept call:', error);
            endCall('media-error');
        }
    }, [socket, callState.incomingCallOffer, callState.peerConnection, callState.localStream, onCallAccepted]);


    const rejectCall = useCallback(() => {
        if (!socket || !callState.incomingCallOffer) return;
        console.log(`Rejecting call from ${callState.incomingCallOffer.senderId}`);
        socket.emit('call-rejected', {
            recipientId: callState.incomingCallOffer.senderId,
            senderId: socket.id,
        });
        setCallState(initialCallState); // Reset state
        onCallRejected?.(); // Notify parent
    }, [socket, callState.incomingCallOffer, onCallRejected]);


    const endCall = useCallback((reason?: string) => {
        console.log(`Ending call. Reason: ${reason || 'User initiated'}`);
        // Stop all tracks on local media stream
        if (callState.localStream) {
            callState.localStream.getTracks().forEach(track => track.stop());
            console.log('Stopped local stream tracks.');
        }

        // Destroy peer connection
        if (callState.peerConnection) {
            callState.peerConnection.destroy();
            console.log('Destroyed peer connection.');
        }

        // Clear call duration timer
        if (callDurationIntervalRef.current) {
            clearInterval(callDurationIntervalRef.current);
            callDurationIntervalRef.current = null;
            console.log('Cleared call duration timer.');
        }

        // Emit call ended signal to the other party
        if (socket && callState.isActive && callState.peerConnection) {
            const remotePartyId = callState.incomingCallOffer?.senderId || recipientId; // Determine who to notify
            if (remotePartyId) {
                socket.emit('call-ended', {
                    recipientId: remotePartyId,
                    senderId: socket.id,
                });
                console.log(`Emitted 'call-ended' to ${remotePartyId}`);
            }
        }

        setCallState(initialCallState); // Reset all call state to initial
        console.log('Call state reset to initial.');
        endCallRef.current?.(reason); // Call the provided onCallEnded callback
    }, [callState.localStream, callState.peerConnection, socket, recipientId, callState.isActive, callState.incomingCallOffer]);


    const toggleLocalAudio = useCallback(() => {
        setCallState(prev => {
            const isEnabled = !prev.isLocalAudioEnabled;
            if (prev.localStream) {
                prev.localStream.getAudioTracks().forEach(track => (track.enabled = isEnabled));
                console.log(`Local audio ${isEnabled ? 'enabled' : 'disabled'}.`);
            }
            return { ...prev, isLocalAudioEnabled: isEnabled };
        });
    }, [callState.localStream]);


    const toggleLocalVideo = useCallback(() => {
        setCallState(prev => {
            const isEnabled = !prev.isLocalVideoEnabled;
            if (prev.localStream) {
                prev.localStream.getVideoTracks().forEach(track => (track.enabled = isEnabled));
                console.log(`Local video ${isEnabled ? 'enabled' : 'disabled'}.`);
            }
            return { ...prev, isLocalVideoEnabled: isEnabled };
        });
    }, [callState.localStream]);


    const startCallDurationTimer = useCallback(() => {
        if (callDurationIntervalRef.current) {
            clearInterval(callDurationIntervalRef.current);
        }
        setCallState(prev => ({ ...prev, callDuration: 0 })); // Reset timer
        callDurationIntervalRef.current = setInterval(() => {
            setCallState(prev => ({ ...prev, callDuration: prev.callDuration + 1 }));
        }, 1000);
        console.log('Call duration timer started.');
    }, []);

    // Socket.IO event listeners
    useEffect(() => {
        console.log('useEffect: Setting up WebRTC signal listener.');
        if (!socket) {
            console.warn('useEffect: Socket is not ready to set up WebRTC signal listener.');
            return;
        }

        // Listener for WebRTC signaling data
        const handleWebRTCSignal = async (signal: WebRTCSignal) => {
            console.log('Socket: Received WebRTC signal.', signal);
            if (!callState.peerConnection && !callState.isActive && signal.signal.type === 'offer') {
                // This is an incoming call offer, and we don't have an active peer connection
                console.log(`Incoming call offer from ${signal.senderId}.`);
                // Need to get caller's username. In a real app, you'd fetch this from your backend
                // For now, assume it's part of the signal or a lookup is done
                socket.emit('request-username', { senderId: socket.id, targetId: signal.senderId });
                setCallState(prev => ({
                    ...prev,
                    incomingCallOffer: signal,
                    isReceivingCall: true,
                    incomingCallerUsername: 'Unknown User', // Placeholder, will be updated
                }));
                onIncomingCall?.('Unknown User', signal.senderId); // Notify parent of incoming call
            } else if (callState.peerConnection) {
                // If peer connection exists, apply the signal
                try {
                    await callState.peerConnection.signal(signal.signal);
                    console.log('Applied WebRTC signal to peer connection.');
                } catch (error) {
                    console.error('Error applying WebRTC signal:', error);
                }
            } else {
                console.warn('Received WebRTC signal but no peer connection or it\'s not an initial offer. Skipping.');
            }
        };

        const handleCallRequest = ({ callerUsername, callerSocketId }: { callerUsername: string; callerSocketId: string }) => {
            console.log(`Socket: Incoming call request from ${callerUsername} (${callerSocketId})`);
            if (callState.isActive || callState.isCalling || callState.isReceivingCall) {
                console.log('Already in a call, rejecting incoming call.');
                socket.emit('call-rejected', { recipientId: callerSocketId, senderId: socket.id });
                return;
            }
            // The actual offer signal will come via 'webrtc-signal'
            // This 'call-request' is just to show the UI prompt
            setCallState(prev => ({
                ...prev,
                isReceivingCall: true,
                incomingCallerUsername: callerUsername,
                incomingCallOffer: null, // Offer will be filled by handleWebRTCSignal
            }));
            onIncomingCall?.(callerUsername, callerSocketId);
        };

        const handleCallAccepted = ({ acceptedBy }: { acceptedBy: string }) => {
            console.log(`Socket: Call accepted by ${acceptedBy}`);
            setCallState(prev => ({ ...prev, isCalling: false, isActive: true }));
            onCallAccepted?.(acceptedBy);
            startCallDurationTimer();
        };

        const handleCallRejected = () => {
            console.log('Socket: Call rejected by recipient.');
            endCall('rejected');
            onCallRejected?.();
        };

        const handleCallEnded = () => {
            console.log('Socket: Call ended by other participant.');
            endCall('remote-ended');
        };

        // For getting the username of the incoming caller
        const handleRequestUsername = ({ senderId, targetId }: { senderId: string, targetId: string }) => {
            if (targetId === socket.id) {
                socket.emit('send-username', { recipientId: senderId, username: username });
            }
        };

        const handleSendUsername = ({ recipientId, username: receivedUsername }: { recipientId: string, username: string }) => {
            if (callState.incomingCallOffer?.senderId === recipientId) {
                setCallState(prev => ({ ...prev, incomingCallerUsername: receivedUsername }));
                console.log(`Updated incoming caller username to: ${receivedUsername}`);
            }
        };


        socket.on('webrtc-signal', handleWebRTCSignal);
        socket.on('call-request', handleCallRequest);
        socket.on('call-accepted', handleCallAccepted);
        socket.on('call-rejected', handleCallRejected);
        socket.on('call-ended', handleCallEnded);
        socket.on('request-username', handleRequestUsername);
        socket.on('send-username', handleSendUsername);

        console.log('useEffect: All Socket.IO listeners attached.');

        // Cleanup function - CRITICAL FIX for TypeError: e.off is not a function
        return () => {
            console.log('useEffect cleanup: Attempting to clean up Socket.IO listeners.');
            console.log('useEffect cleanup: Current socket value:', socket);
            console.log('useEffect cleanup: Type of socket:', typeof socket);
            console.log('useEffect cleanup: Does socket have .off?', Object.prototype.hasOwnProperty.call(socket || {}, 'off'));
            console.log('useEffect cleanup: Type of socket.off:', typeof socket?.off);

            if (socket && typeof socket.off === 'function') {
                socket.off('webrtc-signal', handleWebRTCSignal);
                socket.off('call-request', handleCallRequest);
                socket.off('call-accepted', handleCallAccepted);
                socket.off('call-rejected', handleCallRejected);
                socket.off('call-ended', handleCallEnded);
                socket.off('request-username', handleRequestUsername);
                socket.off('send-username', handleSendUsername);
                console.log('useEffect cleanup: Successfully cleaned up Socket.IO listeners.');
            } else {
                console.warn('useEffect cleanup: Socket is invalid or does not have .off method. Skipping listener cleanup.');
                console.error('useEffect cleanup: Problematic socket (might be null/undefined/non-socket object):', socket);
            }

            // Also clean up local media streams and peer connections if the component unmounts
            if (callState.localStream) {
                callState.localStream.getTracks().forEach(track => track.stop());
                console.log('Cleanup: Stopped local stream tracks on unmount.');
            }
            if (callState.peerConnection) {
                callState.peerConnection.destroy();
                console.log('Cleanup: Destroyed peer connection on unmount.');
            }
            if (callDurationIntervalRef.current) {
                clearInterval(callDurationIntervalRef.current);
                callDurationIntervalRef.current = null;
                console.log('Cleanup: Cleared call duration timer on unmount.');
            }
        };
    }, [socket, roomId, username, recipientId, setCallState, callState.isActive, callState.incomingCallOffer, onIncomingCall, onCallAccepted, onCallRejected, endCall, callState.peerConnection, callState.localStream]);


    // Effect to handle incoming call offer when it updates
    useEffect(() => {
        if (callState.incomingCallOffer && !callState.isActive && !callState.isCalling && callState.isReceivingCall) {
            console.log('Incoming call offer detected. Displaying prompt.');
            // This useEffect handles the side effect of showing the modal
            // The actual peer.signal() is done in acceptCall
        }
    }, [callState.incomingCallOffer, callState.isActive, callState.isCalling, callState.isReceivingCall]);


    return {
        callState,
        localVideoRef,
        remoteVideoRef,
        startCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleLocalAudio,
        toggleLocalVideo,
        setCallState // Expose setCallState for external manipulation if needed (e.g., initial state from prop)
    };
};
