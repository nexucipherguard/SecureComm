import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, Participant } from '../types';

interface UseSocketProps {
  roomId: string;
  userName: string;
  isHost?: boolean;
  isPublic?: boolean;
  onNewMessage: (message: Message) => void;
  onParticipantsUpdate: (participants: Participant[]) => void;
  onUserTyping: (data: { userId: string; userName: string; isTyping: boolean }) => void;
  onIncomingCall: (data: { from: string; isVideo: boolean; callerId: string }) => void;
  onCallAccepted: (data: { accepterId: string }) => void;
  onCallRejected: () => void;
  onCallEnded: () => void;
  onWebRTCOffer?: (data: { offer: RTCSessionDescriptionInit; callerId: string }) => void;
  onWebRTCAnswer?: (data: { answer: RTCSessionDescriptionInit; accepterId: string }) => void;
  onWebRTCIceCandidate?: (data: { candidate: RTCIceCandidateInit; senderId: string }) => void;
  onJoinPending?: (data: { message: string; roomId: string }) => void;
  onJoinRequestAccepted?: (data: { roomId: string }) => void;
  onJoinRequestRejected?: (data: { message: string }) => void;
  onJoinRequest?: (data: { requestId: string; userName: string; socketId: string; requestedAt: string }) => void;
  onRemovedFromRoom?: (data: { message: string }) => void;
  onRoomPrivacyUpdated?: (data: { isPublic: boolean }) => void;
  onRoomJoined?: (data: { roomId: string; isHost: boolean; isPublic: boolean }) => void;
}

export function useSocket({
  roomId,
  userName,
  isHost = false,
  isPublic = true,
  onNewMessage,
  onParticipantsUpdate,
  onUserTyping,
  onIncomingCall,
  onCallAccepted,
  onCallRejected,
  onCallEnded,
  onWebRTCOffer,
  onWebRTCAnswer,
  onWebRTCIceCandidate,
  onJoinPending,
  onJoinRequestAccepted,
  onJoinRequestRejected,
  onJoinRequest,
  onRemovedFromRoom,
  onRoomPrivacyUpdated,
  onRoomJoined
}: UseSocketProps) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const hasJoinedRef = useRef(false);

  useEffect(() => {
    // Only connect if we have a valid userName
    if (!userName.trim()) {
      return;
    }

    // Determine server URL based on environment
    const getServerUrl = () => {
      // In development, use localhost
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:3001';
      }

      // In production, use the deployed server
      return 'https://securecomm-rzc6.onrender.com';
    };

    const serverUrl = getServerUrl();
    console.log(`Connecting to server: ${serverUrl}`);
    
    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      timeout: 15000,
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });

    socketRef.current = socket;

    // Connection events
    socket.on('connect', () => {
      console.log(`Connected to server: ${serverUrl}`);
      setIsConnected(true);
      setConnectionError(null);
      
      // Only join the room once per connection
      if (!hasJoinedRef.current) {
        console.log(`Joining room ${roomId} with username ${userName}, isHost: ${isHost}, isPublic: ${isPublic}`);
        socket.emit('join-room', { roomId, userName, isHost, isPublic });
        hasJoinedRef.current = true;
      }
    });

    socket.on('connect_error', (error) => {
      console.error(`Connection error to ${serverUrl}:`, error);
      setIsConnected(false);
      hasJoinedRef.current = false;
      setConnectionError('Unable to connect to server. Please check your internet connection and try again.');
    });

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      setIsConnected(false);
      hasJoinedRef.current = false;
      
      // Show appropriate error message based on disconnect reason
      if (reason === 'io server disconnect') {
        setConnectionError('Server disconnected. Attempting to reconnect...');
      } else if (reason === 'transport close' || reason === 'transport error') {
        setConnectionError('Connection lost. Attempting to reconnect...');
      }
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log(`Reconnected after ${attemptNumber} attempts`);
      setIsConnected(true);
      setConnectionError(null);
      hasJoinedRef.current = false; // Allow rejoining the room
    });

    socket.on('reconnect_error', (error) => {
      console.error('Reconnection failed:', error);
      setConnectionError('Reconnection failed. Please refresh the page.');
    });

    socket.on('reconnect_failed', () => {
      console.error('All reconnection attempts failed');
      setConnectionError('Unable to reconnect to server. Please refresh the page.');
    });

    // Room events
    socket.on('room-messages', (messages: Message[]) => {
      console.log('Received room messages:', messages);
      messages.forEach(onNewMessage);
    });

    socket.on('new-message', (message: Message) => {
      console.log('Received new message:', message);
      onNewMessage(message);
    });

    socket.on('participants-updated', (participants: Participant[]) => {
      console.log('Participants updated:', participants);
      onParticipantsUpdate(participants);
    });

    socket.on('user-typing', onUserTyping);

    // Call events
    socket.on('incoming-call', onIncomingCall);
    socket.on('call-accepted', onCallAccepted);
    socket.on('call-rejected', onCallRejected);
    socket.on('call-ended', onCallEnded);

    // WebRTC signaling events
    if (onWebRTCOffer) socket.on('webrtc-offer', onWebRTCOffer);
    if (onWebRTCAnswer) socket.on('webrtc-answer', onWebRTCAnswer);
    if (onWebRTCIceCandidate) socket.on('webrtc-ice-candidate', onWebRTCIceCandidate);

    // Room access control events
    if (onJoinPending) socket.on('join-pending', onJoinPending);
    if (onJoinRequestAccepted) socket.on('join-request-accepted', onJoinRequestAccepted);
    if (onJoinRequestRejected) socket.on('join-request-rejected', onJoinRequestRejected);
    if (onJoinRequest) socket.on('join-request', onJoinRequest);
    if (onRemovedFromRoom) socket.on('removed-from-room', onRemovedFromRoom);
    if (onRoomPrivacyUpdated) socket.on('room-privacy-updated', onRoomPrivacyUpdated);
    if (onRoomJoined) socket.on('room-joined', onRoomJoined);

    return () => {
      console.log('Cleaning up socket connection');
      hasJoinedRef.current = false;
      socket?.disconnect();
    };
  }, [roomId, userName]); // Only reconnect when roomId or userName changes

  const sendMessage = (message: Omit<Message, 'id' | 'timestamp'>) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('send-message', message);
    }
  };

  const startTyping = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('typing-start');
    }
  };

  const stopTyping = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('typing-stop');
    }
  };

  const startCall = (isVideo: boolean) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('start-call', { isVideo });
    }
  };

  const acceptCall = (callerId: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('accept-call', { callerId });
    }
  };

  const rejectCall = (callerId: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('reject-call', { callerId });
    }
  };

  const endCall = () => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('end-call');
    }
  };

  const sendWebRTCOffer = (offer: RTCSessionDescriptionInit, targetId: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('webrtc-offer', { offer, targetId });
    }
  };

  const sendWebRTCAnswer = (answer: RTCSessionDescriptionInit, targetId: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('webrtc-answer', { answer, targetId });
    }
  };

  const sendWebRTCIceCandidate = (candidate: RTCIceCandidateInit, targetId: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('webrtc-ice-candidate', { candidate, targetId });
    }
  };

  const acceptJoinRequest = (requestId: string, socketId: string, userName: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('accept-join-request', { requestId, socketId, userName });
    }
  };

  const rejectJoinRequest = (requestId: string, socketId: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('reject-join-request', { requestId, socketId });
    }
  };

  const removeParticipant = (participantSocketId: string) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('remove-participant', { participantSocketId });
    }
  };

  const toggleRoomPrivacy = (isPublic: boolean) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit('toggle-room-privacy', { isPublic });
    }
  };

  return {
    isConnected,
    connectionError,
    sendMessage,
    startTyping,
    stopTyping,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    sendWebRTCOffer,
    sendWebRTCAnswer,
    sendWebRTCIceCandidate,
    acceptJoinRequest,
    rejectJoinRequest,
    removeParticipant,
    toggleRoomPrivacy
  };
}