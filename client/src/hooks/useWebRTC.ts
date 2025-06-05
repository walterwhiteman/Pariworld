import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoCallState, WebRTCSignal, SocketContextType } from '@/types/chat'; // Import SocketContextType

/**
 * Custom hook for WebRTC video calling functionality
 * Implements peer-to-peer video communication for the chat application
 */
export function useWebRTC(
  socket: SocketContextType, // Use the typed SocketContextType
  roomId: string,
  username: string
) {
  // State for the video call's current status and properties
  const [callState, setCallState] = useState<VideoCallState>({
    isActive: false,
    isInitiator: false, // Will be set to true if this peer initiates the call
    isRinging: false,   // Set to true when an incoming call is received
    isAnswered: false,  // Set to true once the call is answered
    isLocalVideoEnabled: true,
    isLocalAudioEnabled: true,
    localStream: null,
    remoteStream: null,
    remoteUser: null,
    hasLocalStream: false,
    hasRemoteStream: false,
    callDuration: 0, // Initialized as a number, formatted to string for display
    error: null,
  });

  // Refs for WebRTC components and video elements
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null); // Internal ref, returned by hook
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null); // Internal ref, returned by hook
  const callStartTimeRef = useRef<number | null>(null);
  const callTimerRef = useRef<NodeJS.Timeout | null>(null);

  // WebRTC configuration with STUN (Session Traversal Utilities for NAT) servers
  // STUN servers help establish a direct connection between peers
  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  /**
   * Initializes a new WebRTC peer connection.
   * Sets up event listeners for ICE candidates and remote tracks.
   */
  const initializePeerConnection = useCallback(() => {
    try {
      const peerConnection = new RTCPeerConnection(rtcConfig);
      peerConnectionRef.current = peerConnection;

      // Event: onicecandidate
      // Called when an ICE candidate is generated (network information about the local peer)
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && socket?.emit) {
          // Send ICE candidate to the remote peer via Socket.IO
          socket.emit('webrtc-signal', {
            type: 'ice-candidate',
            data: event.candidate,
            roomId,
            sender: username,
            // Recipient can be added here if known, but not strictly required for direct peer-to-peer
          });
        }
      };

      // Event: ontrack
      // Called when a remote peer adds a media track to the connection (e.g., video, audio)
      peerConnection.ontrack = (event) => {
        console.log('Received remote stream:', event.streams[0]);
        const [remoteStream] = event.streams;
        setCallState(prev => ({ ...prev, remoteStream, hasRemoteStream: true }));

        // Attach the remote stream to the remote video element
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      };

      // Event: onconnectionstatechange
      // Monitors the overall connection state of the RTCPeerConnection
      peerConnection.onconnectionstatechange = () => {
        console.log('Peer connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' ||
            peerConnection.connectionState === 'failed') {
          // If connection fails or disconnects, end the call
          endCall();
        }
      };

      return peerConnection;
    } catch (error) {
      console.error('Error initializing peer connection:', error);
      setCallState(prev => ({ ...prev, error: 'Failed to initialize peer connection' }));
      return null;
    }
  }, [socket, roomId, username, endCall]); // endCall added to dependencies

  /**
   * Accesses the user's media devices (camera and microphone).
   * Returns a MediaStream object or null if access is denied/fails.
   */
  const getUserMedia = useCallback(async (): Promise<MediaStream | null> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      setCallState(prev => ({ ...prev, localStream: stream, hasLocalStream: true }));

      // Attach the local stream to the local video element
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      return stream;
    } catch (error) {
      console.error('Error accessing media devices:', error);
      setCallState(prev => ({ ...prev, error: 'Failed to access camera/microphone. Please ensure permissions are granted.' }));
      return null;
    }
  }, []);

  /**
   * Initiates a new video call.
   * Gets local media, creates an offer, and sends it via Socket.IO.
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

      // Add local media tracks to the peer connection
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      // Create and set local SDP offer
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      // Send the offer to the remote peer via Socket.IO
      if (socket?.emit) {
        socket.emit('webrtc-signal', {
          type: 'offer',
          data: offer,
          roomId,
          sender: username
        });
      }

      // Update call state to active and mark as initiator
      setCallState(prev => ({
        ...prev,
        isActive: true,
        isInitiator: true,
        localStream,
        hasLocalStream: true,
        callDuration: 0, // Reset duration
        error: null, // Clear any previous errors
      }));

      // Start call duration timer
      callStartTimeRef.current = Date.now();
      startCallTimer();

      console.log('Video call started successfully.');
    } catch (error) {
      console.error('Error starting call:', error);
      setCallState(prev => ({ ...prev, error: (error as Error).message || 'Failed to start call' }));
      endCall();
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username, endCall, startCallTimer]);

  /**
   * Answers an incoming video call.
   * Gets local media, sets remote offer, creates an answer, and sends it via Socket.IO.
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

      // Add local media tracks to the peer connection
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });

      // Set the received offer as the remote description
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      // Create and set local SDP answer
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      // Send the answer to the remote peer via Socket.IO
      if (socket?.emit) {
        socket.emit('webrtc-signal', {
          type: 'answer',
          data: answer,
          roomId,
          sender: username
        });
      }

      // Update call state to active and mark as answered
      setCallState(prev => ({
        ...prev,
        isActive: true,
        isAnswered: true,
        localStream,
        hasLocalStream: true,
        callDuration: 0, // Reset duration
        error: null, // Clear any previous errors
      }));

      // Start call duration timer
      callStartTimeRef.current = Date.now();
      startCallTimer();

      console.log('Call answered successfully.');
    } catch (error) {
      console.error('Error answering call:', error);
      setCallState(prev => ({ ...prev, error: (error as Error).message || 'Failed to answer call' }));
      endCall();
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username, endCall, startCallTimer]);

  /**
   * Ends the current video call.
   * Stops media tracks, closes peer connection, clears video elements, and notifies peer.
   */
  const endCall = useCallback(() => {
    console.log('Ending video call...');

    // Stop call duration timer
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    // Close RTCPeerConnection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Stop all tracks on the local media stream
    if (callState.localStream) {
      callState.localStream.getTracks().forEach(track => track.stop());
    }
    // Stop all tracks on the remote media stream (important for cleanup)
    if (callState.remoteStream) {
        callState.remoteStream.getTracks().forEach(track => track.stop());
    }

    // Clear srcObject of video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    // Notify the other peer about call end (only if call was active)
    if (socket?.emit && callState.isActive) {
      socket.emit('webrtc-signal', {
        type: 'call-end',
        data: {},
        roomId,
        sender: username
      });
    }

    // Reset all call-related state
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
  }, [callState.localStream, callState.remoteStream, callState.isActive, socket, roomId, username]);

  /**
   * Toggles the local video track's enabled state.
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
   * Toggles the local audio track's enabled state.
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
   * Starts or restarts the call duration timer.
   */
  const startCallTimer = useCallback(() => {
    // Clear any existing timer to prevent multiple timers running
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

  /**
   * Formats call duration from seconds into a "MM:SS" string.
   */
  const formatCallDuration = useCallback((seconds: number): string => {
    if (seconds < 0 || isNaN(seconds)) return '00:00'; // Handle invalid or negative duration
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }, []);

  /**
   * useEffect hook to handle incoming WebRTC signaling messages from Socket.IO.
   * Processes offers, answers, ICE candidates, and call-end signals.
   */
  useEffect(() => {
    if (!socket?.on) return;

    const handleWebRTCSignal = async (signal: WebRTCSignal) => {
      // Ignore signals not for the current room or from self
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
            setCallState(prev => ({ ...prev, remoteUser: signal.sender, isRinging: true })); // Set remote user and ringing
            // Auto-answer for simplicity, or implement user prompt
            await answerCall(signal.data);
            break;

          case 'answer':
            console.log('Received answer from:', signal.sender);
            if (peerConnection) {
              await peerConnection.setRemoteDescription(
                new RTCSessionDescription(signal.data)
              );
              setCallState(prev => ({ ...prev, isAnswered: true, isRinging: false })); // Mark as answered
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
  }, [socket, roomId, username, answerCall, endCall]); // Dependencies

  /**
   * Cleanup when the component using this hook unmounts.
   * Ensures all WebRTC connections and media streams are properly closed.
   */
  useEffect(() => {
    return () => {
      endCall(); // Ensure call is ended on component unmount
    };
  }, [endCall]);

  // Return the call state, video refs, and control functions for parent component
  return {
    callState,
    localVideoRef, // Return internal ref
    remoteVideoRef, // Return internal ref
    startCall,
    endCall,
    toggleVideo,
    toggleAudio,
    formatCallDuration
  };
}
