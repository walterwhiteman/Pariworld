import { useEffect, useRef, useState, useCallback } from 'react';
import { ChatMessage, SocketEvents, RoomState } from '@/types/chat';

/**
 * Custom hook for managing WebSocket connection and Socket.IO-like events
 * Handles real-time communication for the private chat application
 */
export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const eventHandlersRef = useRef<Map<string, Set<Function>>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  /**
   * Initialize WebSocket connection
   */
  const connect = useCallback(() => {
    try {
      // Determine the correct WebSocket protocol and URL
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      console.log('Connecting to WebSocket:', wsUrl);
      
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        console.log('WebSocket connected successfully');
        setIsConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;
        
        // Emit connection established event
        emit('connection-established', {});
      };

      socket.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        setIsConnected(false);
        socketRef.current = null;
        
        // Attempt to reconnect if not a normal closure
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 10000);
          console.log(`Attempting to reconnect in ${delay}ms... (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setConnectionError('Unable to connect to chat server. Please refresh the page.');
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionError('Connection error occurred');
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const { event: eventName, payload } = data;
          
          // Emit the received event to all registered handlers
          const handlers = eventHandlersRef.current.get(eventName);
          if (handlers) {
            handlers.forEach(handler => {
              try {
                handler(payload);
              } catch (err) {
                console.error(`Error in event handler for ${eventName}:`, err);
              }
            });
          }
        } catch (err) {
          console.error('Error parsing WebSocket message:', err);
        }
      };

    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setConnectionError('Failed to create connection');
    }
  }, []);

  /**
   * Disconnect from WebSocket
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.close(1000, 'Client disconnecting');
    }
    
    setIsConnected(false);
    socketRef.current = null;
  }, []);

  /**
   * Emit an event to the server
   */
  const emit = useCallback((eventName: string, payload: any) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({
        event: eventName,
        payload: payload
      });
      socketRef.current.send(message);
    } else {
      console.warn('Cannot emit event - WebSocket is not connected:', eventName);
    }
  }, []);

  /**
   * Register an event handler
   */
  const on = useCallback((eventName: string, handler: Function) => {
    if (!eventHandlersRef.current.has(eventName)) {
      eventHandlersRef.current.set(eventName, new Set());
    }
    eventHandlersRef.current.get(eventName)!.add(handler);
    
    // Return cleanup function
    return () => {
      const handlers = eventHandlersRef.current.get(eventName);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          eventHandlersRef.current.delete(eventName);
        }
      }
    };
  }, []);

  /**
   * Remove an event handler
   */
  const off = useCallback((eventName: string, handler: Function) => {
    const handlers = eventHandlersRef.current.get(eventName);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        eventHandlersRef.current.delete(eventName);
      }
    }
  }, []);

  /**
   * Join a chat room
   */
  const joinRoom = useCallback((roomId: string, username: string) => {
    emit('join-room', { roomId, username });
  }, [emit]);

  /**
   * Leave a chat room
   */
  const leaveRoom = useCallback((roomId: string, username: string) => {
    emit('leave-room', { roomId, username });
  }, [emit]);

  /**
   * Send a message
   */
  const sendMessage = useCallback((message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    emit('send-message', message);
  }, [emit]);

  /**
   * Send typing status
   */
  const sendTypingStatus = useCallback((roomId: string, username: string, isTyping: boolean) => {
    emit(isTyping ? 'typing-start' : 'typing-stop', { roomId, username });
  }, [emit]);

  /**
   * Initialize connection on mount
   */
  useEffect(() => {
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    isConnected,
    connectionError,
    connect,
    disconnect,
    emit,
    on,
    off,
    joinRoom,
    leaveRoom,
    sendMessage,
    sendTypingStatus
  };
}
