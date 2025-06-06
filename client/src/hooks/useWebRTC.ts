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
            peerConnection.connectionState === 'failed') {
          endCall();
        }
      };

      return peerConnection;
    } catch (error) {
      console.error('Error initializing peer connection:', error);
      return null;
    }
  }, [socket, roomId, username]);

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
  const startCall = useCallback(async () => {
    try {
      console.log('Starting video call...');
      
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
        socket.emit('webrtc-signal', {
          type: 'offer',
          data: offer,
          roomId,
          sender: username
        });
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

      console.log('Video call started');
    } catch (error) {
      console.error('Error starting call:', error);
      endCall();
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username]);

  /**
   * Answer an incoming call
   */
  const answerCall = useCallback(async (offer: RTCSessionDescriptionInit) => {
    try {
      console.log('Answering incoming call...');
      
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
        socket.emit('webrtc-signal', {
          type: 'answer',
          data: answer,
          roomId,
          sender: username
        });
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

      console.log('Call answered');
    } catch (error) {
      console.error('Error answering call:', error);
      endCall();
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username]);

  /**
   * End the current call
   */
  const endCall = useCallback(() => {
    console.log('Ending video call...');

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
    }

    // Clear video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // Notify other peer
    if (socket?.emit && callState.isActive) {
      socket.emit('webrtc-signal', {
        type: 'call-end',
        data: {},
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
      if (signal.roomId !== roomId || signal.sender === username) return;

      try {
        switch (signal.type) {
          case 'offer':
            await answerCall(signal.data);
            break;
            
          case 'answer':
            if (peerConnectionRef.current) {
              await peerConnectionRef.current.setRemoteDescription(
                new RTCSessionDescription(signal.data)
              );
            }
            break;
            
          case 'ice-candidate':
            if (peerConnectionRef.current) {
              await peerConnectionRef.current.addIceCandidate(
                new RTCIceCandidate(signal.data)
              );
            }
            break;
            
          case 'call-end':
            endCall();
            break;
        }
      } catch (error) {
        console.error('Error handling WebRTC signal:', error);
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
    formatCallDuration
  };
}
