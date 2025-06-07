// src/hooks/useWebRTC.ts

import { useCallback, useEffect, useRef, useState } from 'react';
import { VideoCallState, WebRTCSignal } from '@/types/chat';

/**
 * Custom hook for WebRTC video calling functionality
 * Implements peer-to-peer video communication for the chat application
 */
export function useWebRTC(socket: any, roomId: string, username: string) {
  // 1. State and Ref declarations
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

  // New ref to hold the latest endCall function
  const endCallRef = useRef<(() => void) | null>(null);


  // 2. Constants like rtcConfig
  const rtcConfig: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  /**
   * Defines the endCall function as a useCallback to stabilize its reference.
   * Dependencies are carefully chosen to prevent unnecessary re-creations,
   * especially to avoid circular dependencies that cause loops.
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
    // Access localStream directly from the state for safety
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

    // Notify other peer (only if call was active to avoid sending spurious end signals)
    // Access isActive directly from the state for safety
    if (socket?.emit && callState.isActive) {
      console.log('endCall: Emitting call-end signal to other peer.');
      socket.emit('webrtc-signal', {
        type: 'call-end',
        data: {},
        roomId,
        sender: username
      });
    }

    // Reset call state - this WILL cause a re-render
    setCallState({
      isActive: false,
      isLocalVideoEnabled: true,
      isLocalAudioEnabled: true,
      localStream: null,
      remoteStream: null,
      callDuration: 0
    });
    console.log('endCall: Call state reset.');

    callStartTimeRef.current = null;
    console.log('endCall: Video call sequence ended.');
  }, [
    socket,           // Stable prop from ChatPage
    roomId,           // Stable prop from ChatPage
    username,         // Stable prop from ChatPage
    setCallState,     // Stable state setter
    // Crucially, we exclude callState.localStream and callState.isActive from dependencies here
    // because `endCall` *itself* changes them. Including them would create a loop.
    // We access their *current* value directly within the function.
    callState.localStream, // Include as dependency because it's read
    callState.isActive // Include as dependency because it's read
  ]);

  // Update the ref to the latest `endCall` function whenever `endCall` is re-created.
  // This effect runs whenever `endCall`'s dependencies change.
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
        if (event.candidate && socket?.emit) {
          console.log('onicecandidate: Sending ICE candidate.');
          socket.emit('webrtc-signal', {
            type: 'ice-candidate',
            data: event.candidate,
            roomId,
            sender: username
          });
        } else {
          console.log('onicecandidate: No more ICE candidates or event.candidate is null.');
        }
      };

      // Handle remote stream
      peerConnection.ontrack = (event) => {
        console.log('ontrack: Received remote stream/track.');
        const [remoteStream] = event.streams;
        setCallState(prev => ({ ...prev, remoteStream }));
        
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          console.log('ontrack: Remote stream set on video element.');
        }
      };

      // Handle connection state changes
      peerConnection.onconnectionstatechange = () => {
        console.log('onconnectionstatechange: Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'disconnected' || 
            peerConnection.connectionState === 'failed') {
          console.log('onconnectionstatechange: Peer connection disconnected or failed, calling endCall.');
          // Call endCall using the ref to get the latest stable function
          endCallRef.current?.(); 
        }
      };

      return peerConnection;
    } catch (error) {
      console.error('initializePeerConnection: Error initializing peer connection:', error);
      // Call endCall using the ref
      endCallRef.current?.(); 
      return null;
    }
  }, [socket, roomId, username]);


  /**
   * Get user media (camera and microphone)
   */
  const getUserMedia = useCallback(async (): Promise<MediaStream | null> => {
    console.log('getUserMedia: Requesting media devices (video & audio)... [Step 1]');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      
      setCallState(prev => ({ ...prev, localStream: stream }));
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        console.log('getUserMedia: Local stream set on video element. [Step 2]');
      }
      console.log('getUserMedia: Media stream successfully obtained. [Step 3]');
      return stream;
    } catch (error: any) { // Explicitly type error as 'any' for full access
      console.error('getUserMedia: !!! CRITICAL ERROR accessing media devices:', error); // More explicit error log
      if (error.name) {
          console.error('getUserMedia: Error Name:', error.name);
      }
      if (error.message) {
          console.error('getUserMedia: Error Message:', error.message);
      }
      console.log('getUserMedia: Invoking endCall due to media access error. [Step 4]'); // NEW LOG BEFORE ENDCALL
      // Call endCall using the ref
      endCallRef.current?.(); 
      return null;
    }
  }, [setCallState]);


  /**
   * Start call duration timer (kept as useCallback for stability)
   */
  const startCallTimer = useCallback(() => {
    console.log('startCallTimer: Starting call duration timer.');
    callTimerRef.current = setInterval(() => {
      if (callStartTimeRef.current) {
        const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
        setCallState(prev => ({ ...prev, callDuration: duration }));
      }
    }, 1000);
  }, [setCallState]); // setCallState is a stable setter, so this useCallback is stable


  /**
   * Start a video call
   */
  const startCall = useCallback(async () => {
    console.log('startCall: Initiating video call sequence.');
    try {
      const localStream = await getUserMedia();
      if (!localStream) {
        console.error('startCall: No local stream obtained. Aborting call.');
        // getUserMedia already calls endCall, so no need to throw here or call again
        return; 
      }
      console.log('startCall: Local stream obtained successfully.');

      const peerConnection = initializePeerConnection();
      if (!peerConnection) {
        console.error('startCall: Failed to initialize peer connection. Aborting call.');
        endCallRef.current?.(); // Call endCall using the ref
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
        console.log('startCall: Emitting WebRTC offer signal.');
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
        localStream // Ensure localStream is correctly passed to state
      }));
      console.log('startCall: Call state updated to isActive: true.');

      // Start call timer
      callStartTimeRef.current = Date.now();
      startCallTimer();
      console.log('startCall: Call timer started.');

      console.log('startCall: Video call sequence complete.');
    } catch (error) {
      console.error('startCall: Uncaught error during call initiation:', error);
      endCallRef.current?.(); // Call endCall using the ref
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username, startCallTimer, setCallState]);


  /**
   * Answer an incoming call
   */
  const answerCall = useCallback(async (offer: RTCSessionDescriptionInit) => {
    console.log('answerCall: Answering incoming call sequence.');
    try {
      const localStream = await getUserMedia();
      if (!localStream) {
        console.error('answerCall: No local stream obtained. Aborting answer.');
        return;
      }
      console.log('answerCall: Local stream obtained successfully for answer.');

      const peerConnection = initializePeerConnection();
      if (!peerConnection) {
        console.error('answerCall: Failed to initialize peer connection for answer. Aborting.');
        endCallRef.current?.(); // Call endCall using the ref
        return;
      }
      console.log('answerCall: Peer connection initialized for answer.');

      // Add local stream to peer connection
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
        console.log(`answerCall: Added local track for answer: ${track.kind}`);
      });

      // Set remote description and create answer
      console.log('answerCall: Setting remote description (offer) and creating answer...');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      console.log('answerCall: Local description set (answer).');

      if (socket?.emit) {
        console.log('answerCall: Emitting WebRTC answer signal.');
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
        localStream // Ensure localStream is correctly passed to state
      }));
      console.log('answerCall: Call state updated to isActive: true.');

      // Start call timer
      callStartTimeRef.current = Date.now();
      startCallTimer();
      console.log('answerCall: Call timer started.');

      console.log('answerCall: Call answer sequence complete.');
    } catch (error) {
      console.error('answerCall: Uncaught error during call answering:', error);
      endCallRef.current?.(); // Call endCall using the ref
    }
  }, [getUserMedia, initializePeerConnection, socket, roomId, username, startCallTimer, setCallState]);


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
  }, [callState.localStream, setCallState]); // Add setCallState to dependencies


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
  }, [callState.localStream, setCallState]); // Add setCallState to dependencies


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
      // Ensure signal is for this room and not from self
      if (signal.roomId !== roomId || signal.sender === username) {
        console.log('handleWebRTCSignal: Signal ignored (not for this room or from self).');
        return;
      }

      try {
        switch (signal.type) {
          case 'offer':
            console.log('handleWebRTCSignal: Processing offer.');
            // This is an incoming call offer, so answer it
            await answerCall(signal.data);
            break;
            
          case 'answer':
            console.log('handleWebRTCSignal: Processing answer.');
            if (peerConnectionRef.current) {
              await peerConnectionRef.current.setRemoteDescription(
                new RTCSessionDescription(signal.data)
              );
              console.log('handleWebRTCSignal: Remote description set (answer).');
            } else {
              console.warn('handleWebRTCSignal: Peer connection not initialized when receiving answer.');
            }
            break;
            
          case 'ice-candidate':
            console.log('handleWebRTCSignal: Processing ICE candidate.');
            if (peerConnectionRef.current) {
              await peerConnectionRef.current.addIceCandidate(
                new RTCIceCandidate(signal.data)
              );
              console.log('handleWebRTCSignal: ICE candidate added.');
            } else {
              console.warn('handleWebRTCSignal: Peer connection not initialized when receiving ICE candidate.');
            }
            break;
            
          case 'call-end':
            console.log('handleWebRTCSignal: Received call-end signal. Ending call locally.');
            endCallRef.current?.(); // Call endCall using the ref
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
      // ONLY call .off() if socket exists and has an .off method
      if (socket && typeof socket.off === 'function') { 
        socket.off('webrtc-signal', handleWebRTCSignal);
        console.log('useEffect: Cleaned up WebRTC signal listener.');
      } else {
        console.warn('useEffect cleanup: Socket is null or does not have .off method. Skipping listener cleanup.');
      }
    };
  }, [socket, roomId, username, answerCall]); // Dependencies for this useEffect
    
  /**
   * Cleanup on component unmount
   * This useEffect uses an empty dependency array to ensure its cleanup runs only once on unmount.
   * It accesses the latest `endCall` via the `endCallRef`.
   */
  useEffect(() => {
    return () => {
      console.log('useEffect cleanup: Component unmounting, ensuring call is ended.');
      // Use the ref to call the latest endCall function when the component truly unmounts
      endCallRef.current?.(); 
    };
  }, []); // EMPTY dependency array! This effect runs its setup once on mount, and cleanup once on unmount.


  return {
    callState,
    localVideoRef,
    remoteVideoRef,
    startCall,
    endCall, // Expose the useCallback function
    toggleVideo,
    toggleAudio,
    formatCallDuration
  };
}
