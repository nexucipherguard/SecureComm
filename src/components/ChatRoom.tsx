import React, { useState, useEffect, useRef } from 'react';
import {
  Send, Phone, Video, Paperclip, Shield, Users,
  Settings, MoreVertical, Mic, MicOff, VideoOff,
  Download, X, Copy, CheckCircle2, LogOut, Wifi, WifiOff,
  AlertTriangle, RefreshCw, MessageSquare, ExternalLink,
  Eye, EyeOff, Lock
} from 'lucide-react';
import { Message, Participant, CallState } from '../types';
import { EncryptionManager } from '../utils/encryption';
import { useSocket } from '../hooks/useSocket';
import { useWebRTC } from '../hooks/useWebRTC';
import HostControls from './HostControls';

interface ChatRoomProps {
  roomId: string;
  onLeave: () => void;
  isHost?: boolean;
  isPublic?: boolean;
}

interface JoinRequest {
  requestId: string;
  userName: string;
  socketId: string;
  requestedAt: string;
}

export default function ChatRoom({ roomId, onLeave, isHost: initialIsHost = false, isPublic: initialIsPublic = true }: ChatRoomProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [userName, setUserName] = useState('');
  const [isNameSet, setIsNameSet] = useState(false);
  const [isHost, setIsHost] = useState(initialIsHost);
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [joinStatus, setJoinStatus] = useState<'pending' | 'accepted' | 'rejected' | null>(null);
  const [callState, setCallState] = useState<CallState>({ isActive: false, isVideo: false, isIncoming: false });
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [incomingCall, setIncomingCall] = useState<{ from: string; isVideo: boolean; callerId: string } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [showFilePreferenceModal, setShowFilePreferenceModal] = useState(false);
  const [viewedMessages, setViewedMessages] = useState<Set<string>>(new Set());
  const [removedMessages, setRemovedMessages] = useState<Set<string>>(new Set());
  const [messageTimers, setMessageTimers] = useState<Map<string, number>>(new Map());
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const encryptionManager = EncryptionManager.getInstance();
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const {
    isConnected,
    connectionError,
    sendMessage,
    startTyping,
    stopTyping,
    startCall: socketStartCall,
    acceptCall,
    rejectCall,
    endCall: socketEndCall,
    sendWebRTCOffer,
    sendWebRTCAnswer,
    sendWebRTCIceCandidate,
    acceptJoinRequest,
    rejectJoinRequest,
    removeParticipant,
    toggleRoomPrivacy
  } = useSocket({
    roomId,
    userName: isNameSet ? userName : '', // Only pass userName when it's actually set
    isHost,
    isPublic,
    onNewMessage: (message) => {
      setMessages(prev => {
        // Avoid duplicate messages
        if (prev.some(m => m.id === message.id)) return prev;
        return [...prev, message];
      });
    },
    onParticipantsUpdate: (newParticipants) => {
      setParticipants(newParticipants);
    },
    onUserTyping: ({ userId, userName: typingUserName, isTyping }) => {
      setTypingUsers(prev => {
        if (isTyping) {
          return prev.includes(typingUserName) ? prev : [...prev, typingUserName];
        } else {
          return prev.filter(name => name !== typingUserName);
        }
      });
    },
    onIncomingCall: (callData) => {
      setIncomingCall(callData);
    },
    onCallAccepted: async (data) => {
      console.log('Call accepted, starting WebRTC connection');
      setCallState(prev => ({ ...prev, isActive: true }));
      setIncomingCall(null);
    },
    onCallRejected: () => {
      setCallState({ isActive: false, isVideo: false, isIncoming: false });
      setIncomingCall(null);
      setLocalStream(null);
      setRemoteStream(null);
      webRTCEndCall();
    },
    onCallEnded: () => {
      setCallState({ isActive: false, isVideo: false, isIncoming: false });
      setIncomingCall(null);
      setIsMuted(false);
      setIsVideoOff(false);
      setLocalStream(null);
      setRemoteStream(null);
      webRTCEndCall();
    },
    onWebRTCOffer: async (data) => {
      console.log('Received WebRTC offer');
      await handleWebRTCOffer(data.offer, data.callerId);
    },
    onWebRTCAnswer: async (data) => {
      console.log('Received WebRTC answer');
      await handleWebRTCAnswer(data.answer);
    },
    onWebRTCIceCandidate: async (data) => {
      console.log('Received ICE candidate');
      await handleWebRTCIceCandidate(data.candidate);
    },
    onJoinPending: (data) => {
      setJoinStatus('pending');
    },
    onJoinRequestAccepted: (data) => {
      setJoinStatus('accepted');
    },
    onJoinRequestRejected: (data) => {
      setJoinStatus('rejected');
    },
    onJoinRequest: (data) => {
      setJoinRequests(prev => [...prev, data]);
    },
    onRemovedFromRoom: (data) => {
      alert(data.message);
      onLeave();
    },
    onRoomPrivacyUpdated: (data) => {
      setIsPublic(data.isPublic);
    },
    onRoomJoined: (data) => {
      setIsHost(data.isHost);
      setIsPublic(data.isPublic);
      setJoinStatus(null);
    }
  });

  const {
    startCall: webRTCStartCall,
    answerCall: webRTCAnswerCall,
    handleOffer: handleWebRTCOffer,
    handleAnswer: handleWebRTCAnswer,
    handleIceCandidate: handleWebRTCIceCandidate,
    toggleAudio: webRTCToggleAudio,
    toggleVideo: webRTCToggleVideo,
    endCall: webRTCEndCall
  } = useWebRTC({
    onLocalStream: (stream) => {
      console.log('Got local stream with tracks:', stream.getTracks().map(t => t.kind));
      setLocalStream(stream);
    },
    onRemoteStream: (stream) => {
      console.log('Got remote stream with tracks:', stream.getTracks().map(t => t.kind));
      setRemoteStream(stream);
    },
    onConnectionStateChange: (state) => {
      console.log('WebRTC connection state:', state);
    },
    sendOffer: sendWebRTCOffer,
    sendAnswer: sendWebRTCAnswer,
    sendIceCandidate: sendWebRTCIceCandidate
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const preventScreenshot = (e: KeyboardEvent) => {
      if (
        (e.key === 'PrintScreen') ||
        (e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === '5')) ||
        (e.ctrlKey && e.shiftKey && e.key === 'S') ||
        (e.metaKey && e.shiftKey && e.key === 'S')
      ) {
        e.preventDefault();
        alert('Screenshots are disabled for security reasons');
        return false;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('Window hidden - potential screenshot attempt');
      }
    };

    document.addEventListener('keydown', preventScreenshot);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('keydown', preventScreenshot);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    if (!localStream) return;

    const hasVideo = localStream.getVideoTracks().length > 0;
    console.log('Attaching local stream, hasVideo:', hasVideo);

    if (hasVideo && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(e => console.error('Error playing local video:', e));
    } else if (!hasVideo && localAudioRef.current) {
      localAudioRef.current.srcObject = localStream;
      localAudioRef.current.play().catch(e => console.error('Error playing local audio:', e));
    }
  }, [localStream, callState.isVideo]);

  useEffect(() => {
    if (!remoteStream) return;

    const hasVideo = remoteStream.getVideoTracks().length > 0;
    console.log('Attaching remote stream, hasVideo:', hasVideo);

    if (hasVideo && remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(e => console.error('Error playing remote video:', e));
    } else if (!hasVideo && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.volume = 1.0;
      remoteAudioRef.current.play().catch(e => console.error('Error playing remote audio:', e));
    }
  }, [remoteStream, callState.isVideo]);

  const handleSetName = () => {
    if (userName.trim()) {
      setIsNameSet(true);
    }
  };

  const handleSendMessage = async () => {
    if (newMessage.trim() && isNameSet && isConnected) {
      const message: Omit<Message, 'id' | 'timestamp'> = {
        content: newMessage.trim(),
        sender: userName,
        type: 'text',
        encrypted: true
      };
      
      sendMessage(message);
      setNewMessage('');
      stopTyping();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    
    // Handle typing indicators
    if (e.target.value.trim()) {
      startTyping();
      
      // Clear existing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // Set new timeout to stop typing
      typingTimeoutRef.current = setTimeout(() => {
        stopTyping();
      }, 1000);
    } else {
      stopTyping();
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && isNameSet && isConnected) {
      setPendingFile(file);
      setShowFilePreferenceModal(true);
    }
    if (event.target) {
      event.target.value = '';
    }
  };

  const readFileAsBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleSendFileWithPreference = async (preference: 'download' | 'preview' | 'one-time') => {
    if (pendingFile) {
      try {
        const fileContent = await readFileAsBase64(pendingFile);

        let messageType: 'text' | 'image' | 'video' | 'file' | 'system' = 'file';
        if (pendingFile.type.startsWith('image/')) {
          messageType = 'image';
        } else if (pendingFile.type.startsWith('video/')) {
          messageType = 'video';
        }

        const message: Omit<Message, 'id' | 'timestamp'> = {
          content: `Shared ${messageType}: ${pendingFile.name}`,
          sender: userName,
          type: messageType,
          fileName: pendingFile.name,
          fileSize: pendingFile.size,
          fileType: pendingFile.type,
          fileContent: fileContent,
          encrypted: true,
          fileViewPreference: preference,
          viewedBy: []
        };

        sendMessage(message);
        setPendingFile(null);
        setShowFilePreferenceModal(false);
      } catch (error) {
        console.error('Error reading file:', error);
        alert('Failed to read file. Please try again.');
      }
    }
  };

  const handleDownloadFile = (message: Message) => {
    if (!message.fileContent || !message.fileName) return;

    const link = document.createElement('a');
    link.href = message.fileContent;
    link.download = message.fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const markMessageAsViewed = (messageId: string) => {
    setViewedMessages(prev => new Set([...prev, messageId]));

    // Start countdown from 30 seconds
    let timeLeft = 30;
    setMessageTimers(prev => new Map(prev).set(messageId, timeLeft));

    const countdownInterval = setInterval(() => {
      timeLeft--;
      setMessageTimers(prev => new Map(prev).set(messageId, timeLeft));

      if (timeLeft <= 0) {
        clearInterval(countdownInterval);
        setRemovedMessages(prev => new Set([...prev, messageId]));
        setMessageTimers(prev => {
          const newMap = new Map(prev);
          newMap.delete(messageId);
          return newMap;
        });
      }
    }, 1000);
  };

  const handleStartCall = async (isVideo: boolean) => {
    if (isConnected && incomingCall === null) {
      try {
        const otherParticipants = participants.filter(p => p.name !== userName);
        if (otherParticipants.length === 0) {
          alert('No other participants in the room');
          return;
        }

        const targetId = otherParticipants[0].id;
        setCallState({ isActive: true, isVideo, isIncoming: false });
        socketStartCall(isVideo);

        await webRTCStartCall(isVideo, targetId);
      } catch (error) {
        console.error('Error starting call:', error);
        alert('Failed to start call. Please check camera/microphone permissions.');
        setCallState({ isActive: false, isVideo: false, isIncoming: false });
      }
    }
  };

  const handleAcceptCall = async () => {
    if (incomingCall) {
      const callData = incomingCall;
      setIncomingCall(null);

      try {
        acceptCall(callData.callerId);
        setCallState({ isActive: true, isVideo: callData.isVideo, isIncoming: true });

        await webRTCAnswerCall(callData.isVideo, callData.callerId);
      } catch (error) {
        console.error('Error accepting call:', error);
        alert('Failed to accept call. Please check camera/microphone permissions.');
        setCallState({ isActive: false, isVideo: false, isIncoming: false });
      }
    }
  };

  const handleRejectCall = () => {
    if (incomingCall) {
      rejectCall(incomingCall.callerId);
      setIncomingCall(null);
    }
  };

  const handleEndCall = () => {
    socketEndCall();
    webRTCEndCall();
    setCallState({ isActive: false, isVideo: false, isIncoming: false });
    setIsMuted(false);
    setIsVideoOff(false);
    setLocalStream(null);
    setRemoteStream(null);
  };

  const handleToggleMute = () => {
    const muted = webRTCToggleAudio();
    setIsMuted(muted);
  };

  const handleToggleVideo = () => {
    const videoOff = webRTCToggleVideo();
    setIsVideoOff(videoOff);
  };

  const copyRoomLink = () => {
    const baseUrl = window.location.origin + window.location.pathname;
    const roomLink = `${baseUrl}?room=${roomId}`;
    
    navigator.clipboard.writeText(roomLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }).catch(err => {
      console.error('Failed to copy link:', err);
    });
  };

  const handleLeave = () => {
    const confirmLeave = window.confirm(
      'Are you sure you want to leave? This room will self-destruct when all participants leave.'
    );
    if (confirmLeave) {
      onLeave();
    }
  };

  const handleRetryConnection = () => {
    window.location.reload();
  };

  const openServerStatus = () => {
    const serverUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://localhost:3001'
      : 'https://securecomm-rzc6.onrender.com';
    window.open(serverUrl, '_blank');
  };

  if (!isNameSet) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-8 border border-white/20 max-w-md w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500/20 rounded-full mb-4">
              <Shield className="w-8 h-8 text-blue-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Join Secure Room</h2>
            <p className="text-slate-300">Room ID: <span className="font-mono text-blue-400">{roomId}</span></p>
            {connectionError && (
              <div className="mt-4 p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                <div className="flex items-center space-x-2 text-red-300 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  <p className="text-sm">{connectionError}</p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={handleRetryConnection}
                    className="flex items-center space-x-1 text-red-300 hover:text-red-200 text-sm px-2 py-1 bg-red-500/20 rounded"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                  <button
                    onClick={openServerStatus}
                    className="flex items-center space-x-1 text-red-300 hover:text-red-200 text-sm px-2 py-1 bg-red-500/20 rounded"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Check Server</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            <input
              type="text"
              placeholder="Enter your display name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20"
              onKeyPress={(e) => e.key === 'Enter' && handleSetName()}
              autoFocus
            />
            <button
              onClick={handleSetName}
              disabled={!userName.trim()}
              className="w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 px-6 rounded-xl font-semibold hover:from-blue-600 hover:to-blue-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join Room
            </button>

            {joinStatus === 'pending' && (
              <div className="p-4 bg-amber-500/20 border border-amber-500/30 rounded-lg">
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin mt-1"></div>
                  <div>
                    <h4 className="text-amber-300 font-semibold">Waiting for Approval</h4>
                    <p className="text-amber-200/80 text-sm mt-1">
                      Your request to join this private room has been sent to the host. Please wait...
                    </p>
                  </div>
                </div>
              </div>
            )}

            {joinStatus === 'rejected' && (
              <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg">
                <div>
                  <h4 className="text-red-300 font-semibold">Request Rejected</h4>
                  <p className="text-red-200/80 text-sm mt-1">
                    Your request to join this room was rejected by the host.
                  </p>
                  <button
                    onClick={onLeave}
                    className="mt-3 w-full bg-red-500/20 hover:bg-red-500/30 text-red-300 py-2 px-4 rounded-lg transition-all"
                  >
                    Leave Room
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col">
      {/* Header */}
      <div className="bg-slate-800/50 backdrop-blur-md border-b border-slate-700/50 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`}></div>
              <span className="text-white font-semibold">SecureComm Chat</span>
              {!isConnected && <WifiOff className="w-4 h-4 text-red-400" />}
            </div>
            <div className="flex items-center space-x-2 text-sm text-slate-400">
              <Shield className="w-4 h-4" />
              <span>E2E Encrypted</span>
              <span className="text-xs">({encryptionManager.getKeyFingerprint()})</span>
            </div>
            <div className="text-xs text-slate-500">
              Room: <span className="font-mono text-blue-400">{roomId}</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={copyRoomLink}
              className="flex items-center space-x-1 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
              title="Copy room link to share with others"
            >
              {linkCopied ? <CheckCircle2 className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              <span className="text-sm">{linkCopied ? 'Copied!' : 'Share Link'}</span>
            </button>
            
            <button
              onClick={() => setShowParticipants(!showParticipants)}
              className="flex items-center space-x-1 px-3 py-2 bg-slate-700/50 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            >
              <Users className="w-4 h-4" />
              <span className="text-sm">{participants.length}</span>
            </button>
            
            <button
              onClick={handleLeave}
              className="flex items-center space-x-1 px-3 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm">Leave</span>
            </button>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      {!isConnected && (
        <div className="bg-red-500/20 border-b border-red-500/30 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-red-300">
              <WifiOff className="w-4 h-4" />
              <span className="text-sm">
                {connectionError || 'Disconnected from server. Trying to reconnect...'}
              </span>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleRetryConnection}
                className="flex items-center space-x-1 px-3 py-1 bg-red-500/30 hover:bg-red-500/40 text-red-300 rounded text-sm transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Retry</span>
              </button>
              <button
                onClick={openServerStatus}
                className="flex items-center space-x-1 px-3 py-1 bg-red-500/30 hover:bg-red-500/40 text-red-300 rounded text-sm transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Server Status</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Incoming Call Modal */}
      {incomingCall && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700 max-w-md w-full mx-4">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/20 rounded-full mb-4">
                {incomingCall.isVideo ? <Video className="w-8 h-8 text-green-400" /> : <Phone className="w-8 h-8 text-green-400" />}
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Incoming {incomingCall.isVideo ? 'Video' : 'Voice'} Call</h3>
              <p className="text-slate-300 mb-8">From: {incomingCall.from}</p>
              <div className="flex space-x-4">
                <button
                  onClick={handleRejectCall}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white py-3 px-6 rounded-xl font-semibold transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={handleAcceptCall}
                  className="flex-1 bg-green-500 hover:bg-green-600 text-white py-3 px-6 rounded-xl font-semibold transition-colors"
                >
                  Accept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Call Interface */}
      {callState.isActive && (
        <div className="fixed inset-0 bg-gradient-to-br from-slate-900 to-slate-800 z-40 flex flex-col">
          {callState.isVideo ? (
            <div className="relative flex-1 flex items-center justify-center">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-contain bg-black"
              />

              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="absolute bottom-20 right-4 w-48 h-36 object-cover rounded-xl border-2 border-white/20 shadow-2xl bg-slate-800"
              />

              <div className="absolute top-6 left-1/2 transform -translate-x-1/2 flex items-center space-x-2 bg-black/60 backdrop-blur-lg px-4 py-2 rounded-full">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-white text-sm font-medium">Video Call</span>
              </div>

              <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex items-center space-x-4 bg-black/60 backdrop-blur-lg px-8 py-4 rounded-full">
                <button
                  onClick={handleToggleMute}
                  className={`p-4 rounded-full transition-all ${
                    isMuted ? 'bg-red-500 text-white' : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
                </button>
                <button
                  onClick={handleToggleVideo}
                  className={`p-4 rounded-full transition-all ${
                    isVideoOff ? 'bg-red-500 text-white' : 'bg-white/20 text-white hover:bg-white/30'
                  }`}
                  title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
                >
                  {isVideoOff ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
                </button>
                <button
                  onClick={handleEndCall}
                  className="p-4 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors"
                  title="End call"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
          ) : (
            <div className="relative flex-1 flex flex-col items-center justify-center">
              <div className="flex flex-col items-center space-y-8">
                <div className="relative">
                  <div className="w-32 h-32 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center">
                    <Phone className="w-16 h-16 text-white" />
                  </div>
                  <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20"></div>
                </div>

                <div className="text-center">
                  <h3 className="text-3xl font-bold text-white mb-2">Voice Call</h3>
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                    <p className="text-slate-300 text-lg">Connected</p>
                  </div>
                </div>

                <div className="flex items-center space-x-4 mt-12">
                  <button
                    onClick={handleToggleMute}
                    className={`p-5 rounded-full transition-all ${
                      isMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                  </button>
                  <button
                    onClick={handleEndCall}
                    className="p-5 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors"
                    title="End call"
                  >
                    <X className="w-7 h-7" />
                  </button>
                </div>
              </div>

              <audio ref={remoteAudioRef} autoPlay playsInline style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
              <audio ref={localAudioRef} autoPlay playsInline muted style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
            </div>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div
        className="flex-1 p-4 overflow-y-auto select-none relative"
        onContextMenu={(e) => e.preventDefault()}
        style={{ userSelect: 'none', WebkitUserSelect: 'none', MozUserSelect: 'none' }}
      >
        {/* Security Watermark */}
        <div className="absolute inset-0 pointer-events-none z-10 opacity-5 flex items-center justify-center">
          <div className="text-white text-6xl font-bold transform rotate-[-45deg] select-none">
            {userName} • {roomId.slice(0, 8)}
          </div>
        </div>
        <div className="max-w-4xl mx-auto space-y-4 relative z-20">
          {messages.length === 0 && isConnected && (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-500/20 rounded-full mb-4">
                <MessageSquare className="w-8 h-8 text-blue-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Welcome to SecureComm Chat</h3>
              <p className="text-slate-400">Your messages are end-to-end encrypted and secure.</p>
              <p className="text-slate-500 text-sm mt-2">Start typing to begin the conversation...</p>
            </div>
          )}
          
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.sender === userName ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs lg:max-w-md px-4 py-3 rounded-2xl shadow-lg ${
                  message.type === 'system'
                    ? 'bg-blue-500/20 text-blue-300 text-center text-sm border border-blue-500/30'
                    : message.sender === userName
                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white'
                    : 'bg-slate-700 text-white border border-slate-600'
                }`}
              >
                {message.type !== 'system' && (
                  <div className="text-xs opacity-70 mb-1 font-medium">{message.sender}</div>
                )}
                <div className="break-words leading-relaxed">
                  {message.content}
                </div>
                {(message.type === 'image' || message.type === 'video' || message.type === 'file') && message.fileName && (() => {
                  const preference = message.fileViewPreference || 'download';
                  const isViewed = viewedMessages.has(message.id);
                  const isRemoved = removedMessages.has(message.id);
                  const isOwn = message.sender === userName;

                  let showContent = false;
                  if (isOwn) {
                    showContent = true;
                  } else if (preference === 'preview') {
                    showContent = true;
                  } else if (preference === 'one-time' && isViewed && !isRemoved) {
                    showContent = true;
                  }

                  if (preference === 'one-time' && isRemoved && !isOwn) {
                    return (
                      <div className="mt-2 p-3 bg-black/30 rounded-lg border border-white/10 text-center">
                        <Lock className="w-4 h-4 mx-auto mb-1 opacity-50" />
                        <div className="text-xs opacity-60">File has been viewed and removed</div>
                      </div>
                    );
                  }

                  return (
                    <div className="mt-2">
                      {preference === 'one-time' && isViewed && !isRemoved && !isOwn && (
                        <div className="mb-2 p-2 bg-amber-500/20 border border-amber-500/30 rounded-lg text-center">
                          <div className="text-xs text-amber-300">
                            Content will disappear in {messageTimers.get(message.id) || 0} seconds
                          </div>
                        </div>
                      )}
                      {showContent && message.fileContent && (
                        <div
                          className="mb-2 rounded-lg overflow-hidden border border-white/10 bg-black/30"
                          onContextMenu={(e) => e.preventDefault()}
                        >
                          {message.type === 'image' ? (
                            <img
                              src={message.fileContent}
                              alt={message.fileName}
                              className="max-w-full h-auto"
                              style={{ maxHeight: '300px', objectFit: 'contain' }}
                              onContextMenu={(e) => e.preventDefault()}
                            />
                          ) : message.fileType?.startsWith('video/') ? (
                            <video
                              src={message.fileContent}
                              controls
                              controlsList="nodownload"
                              disablePictureInPicture
                              className="max-w-full h-auto"
                              style={{ maxHeight: '300px' }}
                              onContextMenu={(e) => e.preventDefault()}
                            />
                          ) : message.fileType?.startsWith('audio/') ? (
                            <audio
                              src={message.fileContent}
                              controls
                              controlsList="nodownload"
                              className="w-full"
                              onContextMenu={(e) => e.preventDefault()}
                            />
                          ) : message.fileType === 'application/pdf' ? (
                            <div className="p-4 text-center">
                              <div className="text-sm text-slate-300 mb-2">PDF Preview</div>
                              <iframe
                                src={`${message.fileContent}#toolbar=0&navpanes=0`}
                                className="w-full"
                                style={{ height: '300px' }}
                                title={message.fileName}
                              />
                            </div>
                          ) : (
                            <div className="p-4 text-center text-slate-400 text-sm">
                              Preview not available for this file type
                            </div>
                          )}
                        </div>
                      )}

                      <div className="p-2 bg-black/20 rounded-lg border border-white/10">
                        <div className="flex items-center justify-between text-xs mb-2">
                          <span className="truncate flex-1 mr-2">{message.fileName}</span>
                          <div className="flex items-center space-x-2">
                            {preference === 'one-time' && (
                              <span className="flex items-center space-x-1 text-amber-400 text-xs">
                                <EyeOff className="w-3 h-3" />
                              </span>
                            )}
                            {preference === 'preview' && (
                              <span className="flex items-center space-x-1 text-green-400 text-xs">
                                <Eye className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                        </div>

                        {message.fileSize && (
                          <div className="text-xs opacity-60 mb-2">
                            {(message.fileSize / 1024).toFixed(1)} KB
                          </div>
                        )}

                        <div className="flex items-center space-x-2">
                          {preference === 'download' && message.fileContent && !isOwn && (
                            <button
                              onClick={() => handleDownloadFile(message)}
                              className="flex items-center space-x-1 px-3 py-1 bg-blue-500 hover:bg-blue-600 rounded text-xs transition-colors"
                            >
                              <Download className="w-3 h-3" />
                              <span>Download</span>
                            </button>
                          )}

                          {preference === 'download' && isOwn && (
                            <span className="text-xs text-slate-400">Download mode</span>
                          )}

                          {preference === 'preview' && !isOwn && (
                            <span className="text-xs text-green-400">Preview Only - No Downloads</span>
                          )}

                          {preference === 'preview' && isOwn && (
                            <span className="text-xs text-green-400">Preview mode</span>
                          )}

                          {preference === 'one-time' && !isOwn && !isViewed && message.fileContent && (
                            <button
                              onClick={() => markMessageAsViewed(message.id)}
                              className="flex items-center space-x-1 px-3 py-1 bg-amber-500 hover:bg-amber-600 rounded text-xs transition-colors"
                            >
                              <Eye className="w-3 h-3" />
                              <span>View Once</span>
                            </button>
                          )}

                          {preference === 'one-time' && isOwn && (
                            <span className="text-xs text-amber-400">One-time view only</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
                <div className="text-xs opacity-50 mt-2">
                  {new Date(message.timestamp).toLocaleTimeString([], { 
                    hour: '2-digit', 
                    minute: '2-digit' 
                  })}
                </div>
              </div>
            </div>
          ))}
          
          {/* Typing Indicator */}
          {typingUsers.length > 0 && (
            <div className="flex justify-start">
              <div className="bg-slate-700/50 px-4 py-2 rounded-2xl border border-slate-600/50">
                <div className="flex items-center space-x-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                    <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  </div>
                  <span className="text-xs text-slate-400">
                    {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...
                  </span>
                </div>
              </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-slate-800/50 backdrop-blur-md border-t border-slate-700/50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center space-x-4">
            {/* Call Buttons */}
            <div className="flex space-x-2">
              <button
                onClick={() => handleStartCall(false)}
                disabled={callState.isActive || !isConnected}
                className="p-3 bg-green-500/20 hover:bg-green-500/30 text-green-400 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Start voice call"
              >
                <Phone className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleStartCall(true)}
                disabled={callState.isActive || !isConnected}
                className="p-3 bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Start video call"
              >
                <Video className="w-5 h-5" />
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!isConnected}
                className="p-3 bg-purple-500/20 hover:bg-purple-500/30 text-purple-400 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="Share file"
              >
                <Paperclip className="w-5 h-5" />
              </button>
            </div>

            {/* Message Input */}
            <div className="flex-1 flex items-center space-x-3">
              <input
                type="text"
                value={newMessage}
                onChange={handleInputChange}
                placeholder={isConnected ? "Type an encrypted message..." : "Connecting..."}
                className="flex-1 bg-slate-700/50 border border-slate-600 rounded-full px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all disabled:opacity-50"
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                disabled={!isConnected}
              />
              <button
                onClick={handleSendMessage}
                disabled={!newMessage.trim() || !isConnected}
                className="p-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-blue-500/25"
                title="Send message"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        onChange={handleFileUpload}
        className="hidden"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
      />

      {/* Participants Sidebar */}
      {showParticipants && (
        <div className="fixed right-0 top-0 h-full w-80 bg-slate-800/95 backdrop-blur-md border-l border-slate-700 p-4 z-50 overflow-y-auto">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-white font-semibold">Participants ({participants.length})</h3>
            <button
              onClick={() => setShowParticipants(false)}
              className="text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <HostControls
            isHost={isHost}
            isPublic={isPublic}
            joinRequests={joinRequests}
            participants={participants}
            currentUserName={userName}
            onAcceptRequest={(requestId, socketId, userName) => {
              acceptJoinRequest(requestId, socketId, userName);
              setJoinRequests(prev => prev.filter(req => req.requestId !== requestId));
            }}
            onRejectRequest={(requestId, socketId) => {
              rejectJoinRequest(requestId, socketId);
              setJoinRequests(prev => prev.filter(req => req.requestId !== requestId));
            }}
            onRemoveParticipant={removeParticipant}
            onTogglePrivacy={toggleRoomPrivacy}
          />

          <div className="space-y-3 mt-4">
            {participants.map((participant) => (
              <div key={participant.id} className="flex items-center space-x-3 p-3 bg-slate-700/50 rounded-lg border border-slate-600/50">
                <div className={`w-3 h-3 rounded-full ${participant.isOnline ? 'bg-green-400' : 'bg-slate-500'}`}></div>
                <div className="flex-1">
                  <div className="text-white font-medium flex items-center">
                    {participant.name}
                    {participant.name === userName && <span className="text-xs text-slate-400 ml-1">(You)</span>}
                    {participant.isHost && <span className="text-xs text-blue-400 ml-1">(Host)</span>}
                  </div>
                  <div className="text-xs text-slate-400">
                    {participant.isOnline ? 'Online' : 'Offline'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* File Preference Modal */}
      {showFilePreferenceModal && pendingFile && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-2xl border border-slate-700 p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">File Sharing Options</h3>
              <button
                onClick={() => {
                  setShowFilePreferenceModal(false);
                  setPendingFile(null);
                }}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-6 p-3 bg-slate-700/50 rounded-lg border border-slate-600">
              <div className="text-sm text-slate-300 truncate">{pendingFile.name}</div>
              <div className="text-xs text-slate-400 mt-1">
                {(pendingFile.size / 1024).toFixed(2)} KB
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => handleSendFileWithPreference('download')}
                className="w-full p-4 bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-blue-500 rounded-xl transition-all text-left group"
              >
                <div className="flex items-start space-x-3">
                  <Download className="w-5 h-5 text-blue-400 mt-0.5" />
                  <div>
                    <div className="text-white font-semibold mb-1">Downloadable</div>
                    <div className="text-sm text-slate-400">Recipients can download and save this file</div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleSendFileWithPreference('preview')}
                className="w-full p-4 bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-green-500 rounded-xl transition-all text-left group"
              >
                <div className="flex items-start space-x-3">
                  <Eye className="w-5 h-5 text-green-400 mt-0.5" />
                  <div>
                    <div className="text-white font-semibold mb-1">Preview Only</div>
                    <div className="text-sm text-slate-400">Recipients can view but not download</div>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleSendFileWithPreference('one-time')}
                className="w-full p-4 bg-slate-700 hover:bg-slate-600 border border-slate-600 hover:border-amber-500 rounded-xl transition-all text-left group"
              >
                <div className="flex items-start space-x-3">
                  <EyeOff className="w-5 h-5 text-amber-400 mt-0.5" />
                  <div>
                    <div className="text-white font-semibold mb-1">One-Time View</div>
                    <div className="text-sm text-slate-400">Self-destructs after being viewed once</div>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
