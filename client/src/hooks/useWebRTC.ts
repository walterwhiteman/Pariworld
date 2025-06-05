import { useCallback, useEffect, useRef, useState } from 'react';
// Import VideoCallState and WebRTCSignal from types/chat
import { VideoCallState, WebRTCSignal } from '@/types/chat';
// Import SocketContextType from useSocket.ts, as it's defined and exported there now
import { SocketContextType } from '../hooks/useSocket'; // <--- CORRECTED IMPORT

/**
 * Custom hook for WebRTC video calling functionality
 * Implements peer-to-peer video communication for the chat application
 */
export function useWebRTC(
  // Revert to SocketContextType, as it's now imported correctly
  socket: SocketContextType, // <--- CORRECTED: Using SocketContextType
  roomId: string,
  username: string,
  localVideoRef: React.RefObject<HTMLVideoElement>,
  remoteVideoRef: React.RefObject<HTMLVideoElement>
) {
  const [callState, setCallState] = useState<VideoCallState>({
    isActive: false,
    isInitiator: false,
    isRinging: false,
    isAnswered: false,
    isLocalVideoEnabled: true,
    isLocalAudioEnabled: true,
    localStream: null,
    remoteStream: null,
    remoteUser: null,
    hasLocalStream: false,
    hasRemoteStream: false,
    callDuration: 0,
    error: null,
  });

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  const initializePeerConnection = useCallback(() => {
    try {
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = peerConnection;

      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket?.emit) {
          socket.emit('webrtc-signal', {
            type: 'ice-candidate',
            data: event.candidate,
            roomId,
            sender: username,
          });
        }
      };

      peerConnection.ontrack = (event) => {
        console.log('Received remote stream:', event.streams[0]);
        const [remoteStream] = event.streams;
        setCallState(prev => ({ ...prev, remoteStream, hasRemoteStream: true }));

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      };

      peerConnection.onconnectionstatechange = () => {
        console.log('Peer connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed') {
          endCall();
        }
      };

      return peerConnection;
    } catch (error) {
      console.error('Error initializing peer connection:', error);
      setCallState(prev => ({ ...prev, error: 'Failed to initialize peer connection' }));
      return null;
    }
  }, [socket, roomId, username, endCall, remoteVideoRef]);

  const getUserMedia = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      setCallState(prev => ({ ...prev, localStream: stream, hasLocalStream: true }));

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      setCallState(prev => ({ ...prev, error: 'Failed to access camera/microphone. Please ensure permissions are granted.' }));
      return null;
    }
  }, [localVideoRef]);

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

      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

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

      setCallState(prev => ({
        ...prev,
        isActive: true,
        isInitiator: true,
        localStream,
        hasLocalStream: true,
        callDuration: 0,
        error: null,
      }));

      callStartTimeRef.current = Date.now();
      startCallTimer();

      console.log('Video call started successfully.');
    } catch (error) {
      console.error('Error starting call:', error);
      setCallState(prev => ({ ...prev, error: (error as Error).message || 'Failed to start call' }));
      endCall();
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username, endCall, startCallTimer]);

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

      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

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

      setCallState(prev => ({
        ...prev,
        isActive: true,
        isAnswered: true,
        localStream,
        hasLocalStream: true,
        callDuration: 0,
        error: null,
      }));

      callStartTimeRef.current = Date.now();
      startCallTimer();

      console.log('Call answered successfully.');
    } catch (error) {
      console.error('Error answering call:', error);
      setCallState(prev => ({ ...prev, error: (error as Error).message || 'Failed to answer call' }));
      endCall();
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username, endCall, startCallTimer]);

  const endCall = useCallback(() => {
    console.log('Ending video call...');

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (callState.localStream) {
      callState.localStream.getTracks().forEach(track => track.stop());
    }
    if (callState.remoteStream) {
        callState.remoteStream.getTracks().forEach(track => track.stop());
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (socket?.emit && callState.isActive) {
      socket.emit('webrtc-signal', {
        type: 'call-end',
        data: {},
        roomId,
        sender: username
      });
    }

    setCallState({
      isActive: false,
      isInitiator: false,
      isRinging: false,
      isAnswered: false,
      isLocalVideoEnabled: true,
      isLocalAudioEnabled: true,
      localStream: null,
      remoteStream: null,
      remoteUser: null,
      hasLocalStream: false,
      hasRemoteStream: false,
      callDuration: 0,
      error: null,
    });

    callStartTimeRef.current = null;
  }, [callState.localStream, callState.remoteStream, callState.isActive, socket, roomId, username, localVideoRef, remoteVideoRef]);

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

  const startCallTimer = useCallback(() => {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
    }
    callTimerRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
        setCallState(prev => ({ ...prev, callDuration: duration }));
      }
    }, 1000);
  }, []);

  const formatCallDuration = useCallback((seconds: number): string => {
    if (seconds < 0 || isNaN(seconds)) return '00:00';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    if (!socket?.on) return;

    const handleWebRTCSignal = async (signal: WebRTCSignal) => {
      if (signal.roomId !== roomId || signal.sender === username) return;

      const peerConnection = peerConnectionRef.current;
      if (!peerConnection) {
          console.warn('WebRTC signal received but peerConnection is not initialized.');
          setCallState(prev => ({ ...prev, error: 'WebRTC connection not ready for signaling.' }));
          return;
      }

      try {
        switch (signal.type) {
          case 'offer':
            console.log('Received offer from:', signal.sender);
            setCallState(prev => ({ ...prev, remoteUser: signal.sender, isRinging: true }));
            await answerCall(signal.data);
            break;

          case 'answer':
            console.log('Received answer from:', signal.sender);
            if (peerConnection) {
              await peerConnection.setRemoteDescription(
                new RTCSessionDescription(signal.data)
              );
              setCallState(prev => ({ ...prev, isAnswered: true, isRinging: false }));
            }
            break;

          case 'ice-candidate':
            console.log('Received ICE candidate from:', signal.sender);
            if (peerConnection) {
              await peerConnection.addIceCandidate(
                new RTCIceCandidate(signal.data)
              );
            }
            break;

          case 'call-end':
            console.log('Received call-end signal from:', signal.sender);
            endCall();
            break;
        }
      } catch (error) {
        console.error('Error handling WebRTC signal:', error);
        setCallState(prev => ({ ...prev, error: (error as Error).message || 'Error processing WebRTC signal' }));
      }
    };

    const cleanup = socket.on('webrtc-signal', handleWebRTCSignal);
    return cleanup;
  }, [socket, roomId, username, answerCall, endCall]);

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
