import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoCallState, WebRTCSignal } from '@/types/chat';

/**
 * Custom hook for WebRTC video calling functionality
 * Implements peer-to-peer video communication for the chat application
 */
export function useWebRTC(socket: any, roomId: string, username: string) {
  const [callState, setCallState] = useState<VideoCallState>({
    isActive: false,
    isLocalVideoEnabled: true,
    isLocalAudioEnabled: true,
    localStream: null,
    remoteStream: null,
    callDuration: 0
  });

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  // WebRTC configuration with STUN servers
  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  /**
   * Initialize WebRTC peer connection
   */
  const initializePeerConnection = useCallback(() => {
    try {
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = peerConnection;

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket?.emit) {
          socket.emit('webrtc-signal', {
            type: 'ice-candidate',
            data: event.candidate,
            roomId,
            sender: username
          });
        }
      };

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log('Received remote stream');
        const [remoteStream] = event.streams;
        setCallState(prev => ({ ...prev, remoteStream }));

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed' ||
            peerConnection.connectionState === 'closed') {
          // Only automatically end the call if it was active
          if (callState.isActive) {
            endCall();
          }
        }
      };

      return peerConnection;
    } catch (error) {
      console.error('Error initializing peer connection:', error);
      return null;
    }
  }, [socket, roomId, username, callState.isActive]);

  /**
   * Get user media (camera and microphone)
   */
  const getUserMedia = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      setCallState(prev => ({ ...prev, localStream: stream }));

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      return null;
    }
  }, []);

  /**
   * Start a video call
   */
  const startCall = useCallback(async (userToCall: string) => { // Added userToCall parameter
    try {
      console.log('Starting video call to', userToCall, '...');

      const localStream = await getUserMedia();
      if (!localStream) {
        throw new Error('Failed to access camera/microphone');
      }

      const peerConnection = initializePeerConnection();
      if (!peerConnection) {
        throw new Error('Failed to initialize peer connection');
      }

      // Add local stream to peer connection
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      // Create and send offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      if (socket?.emit) {
        // Emit 'webrtc-signal' event to signal the backend for a specific recipient
        socket.emit('webrtc-signal', {
          type: 'offer',
          data: offer,
          roomId,
          sender: username,
          recipient: userToCall // Specify who the offer is for
        });
        console.log('Offer sent to signaling server for:', userToCall);
      }

      // Update call state
      setCallState(prev => ({
        ...prev,
        isActive: true,
        localStream
      }));

      // Start call timer
      callStartTimeRef.current = Date.now();
      startCallTimer();

      console.log('Video call initiation complete (waiting for answer)');
    } catch (error) {
      console.error('Error starting call:', error);
      endCall(); // Clean up if starting fails
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username, endCall]);

  /**
   * Answer an incoming call
   */
  const answerCall = useCallback(async (offer: RTCSessionDescriptionInit, callerId: string) => { // Added callerId
    try {
      console.log('Answering incoming call from', callerId, '...');

      const localStream = await getUserMedia();
      if (!localStream) {
        throw new Error('Failed to access camera/microphone');
      }

      const peerConnection = initializePeerConnection();
      if (!peerConnection) {
        throw new Error('Failed to initialize peer connection');
      }

      // Add local stream to peer connection
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      // Set remote description and create answer
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      if (socket?.emit) {
        // Emit 'webrtc-signal' event to send answer back to the caller
        socket.emit('webrtc-signal', {
          type: 'answer',
          data: answer,
          roomId,
          sender: username,
          recipient: callerId // Send answer back to the caller
        });
        console.log('Answer sent to signaling server for:', callerId);
      }

      // Update call state
      setCallState(prev => ({
        ...prev,
        isActive: true,
        localStream
      }));

      // Start call timer
      callStartTimeRef.current = Date.now();
      startCallTimer();

      console.log('Call answered successfully');
    } catch (error) {
      console.error('Error answering call:', error);
      endCall(); // Clean up if answering fails
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username, endCall]);

  /**
   * End the current call
   */
  const endCall = useCallback(() => {
    // Only log "Ending video call..." if a call was active or a connection exists
    if (callState.isActive || peerConnectionRef.current || callState.localStream || callState.remoteStream) {
        console.log('Ending video call...');
    } else {
        return; // If nothing is active or connected, just return
    }

    // Stop call timer
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Stop local stream
    if (callState.localStream) {
      callState.localStream.getTracks().forEach(track => track.stop());
      setCallState(prev => ({ ...prev, localStream: null }));
    }

    // Clear video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // Notify other peer (only if a call was actually active when endCall was initiated)
    if (socket?.emit && callState.isActive) {
      socket.emit('webrtc-signal', {
        type: 'call-end',
        data: { reason: 'user_ended' },
        roomId,
        sender: username
      });
    }

    // Reset call state
    setCallState({
      isActive: false,
      isLocalVideoEnabled: true,
      isLocalAudioEnabled: true,
      localStream: null,
      remoteStream: null,
      callDuration: 0
    });

    callStartTimeRef.current = null;
  }, [callState.localStream, callState.isActive, socket, roomId, username]);


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
      }
    }
  }, [callState.localStream]);

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
      }
    }
  }, [callState.localStream]);

  /**
   * Start call duration timer
   */
  const startCallTimer = useCallback(() => {
    callTimerRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
        setCallState(prev => ({ ...prev, callDuration: duration }));
      }
    }, 1000);
  }, []);

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
    if (!socket?.on) return;

    const handleWebRTCSignal = async (signal: WebRTCSignal) => {
      // Basic check for room ID, signals not from this user
      if (signal.roomId !== roomId) return;

      console.log(`Received WebRTC signal of type '${signal.type}' from '${signal.sender}'`);

      try {
        switch (signal.type) {
          case 'offer':
            // Only process offer if it's for us and we're not the sender
            if (signal.recipient === username && signal.sender !== username) {
                console.log('Received offer, attempting to answer...');
                await answerCall(signal.data, signal.sender);
            }
            break;

          case 'answer':
            // Only process answer if it's for us and we are the original sender (caller)
            if (signal.recipient === username && signal.sender !== username && peerConnectionRef.current) {
                console.log('Received answer, setting remote description...');
                await peerConnectionRef.current.setRemoteDescription(
                  new RTCSessionDescription(signal.data)
                );
            }
            break;

          case 'ice-candidate':
            // Process ICE candidate if it's for us and peer connection exists
            if (peerConnectionRef.current) {
              console.log('Received ICE candidate, adding...');
              await peerConnectionRef.current.addIceCandidate(
                new RTCIceCandidate(signal.data)
              );
            }
            break;

          case 'call-end':
            // When the other peer sends a call-end signal
            if (signal.sender !== username) { // Ensure it's not our own broadcasted end signal
                console.log('Other peer ended the call.');
                endCall();
            }
            break;
        }
      } catch (error) {
        console.error('Error handling WebRTC signal:', error);
        endCall(); // Clean up if signal handling causes an error
      }
    };

    const cleanup = socket.on('webrtc-signal', handleWebRTCSignal);
    return cleanup;
  }, [socket, roomId, username, answerCall, endCall]);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      // This will now only log if there was an active call or connection to clean up
      endCall();
    };
  }, [endCall]);

  return {
    callState,
    localVideoRef,
    remoteVideoRef,
    startCall,
    endCall,
    toggleVideo,
    toggleAudio,
    formatCallDuration,
  };
}
