import { useRef, useState, useEffect } from 'react';

interface UseWebRTCProps {
  onLocalStream?: (stream: MediaStream) => void;
  onRemoteStream?: (stream: MediaStream) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  sendOffer: (offer: RTCSessionDescriptionInit, targetId: string) => void;
  sendAnswer: (answer: RTCSessionDescriptionInit, targetId: string) => void;
  sendIceCandidate: (candidate: RTCIceCandidateInit, targetId: string) => void;
}

export function useWebRTC({
  onLocalStream,
  onRemoteStream,
  onConnectionStateChange,
  sendOffer,
  sendAnswer,
  sendIceCandidate
}: UseWebRTCProps) {
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [isInitiator, setIsInitiator] = useState(false);
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);
  const pendingIceCandidates = useRef<RTCIceCandidateInit[]>([]);

  const createPeerConnection = () => {
    if (peerConnectionRef.current) {
      return peerConnectionRef.current;
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && remotePeerId) {
        console.log('Sending ICE candidate');
        sendIceCandidate(event.candidate.toJSON(), remotePeerId);
      }
    };

    pc.ontrack = (event) => {
      console.log('Received remote track');
      const remoteStream = event.streams[0];
      remoteStreamRef.current = remoteStream;
      if (onRemoteStream) {
        onRemoteStream(remoteStream);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (onConnectionStateChange) {
        onConnectionStateChange(pc.connectionState);
      }

      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.log('Connection failed, attempting restart');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  const startCall = async (isVideo: boolean, targetId: string) => {
    try {
      console.log('Starting call, isVideo:', isVideo);
      setIsInitiator(true);
      setRemotePeerId(targetId);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true
      });

      console.log('Got local stream');
      localStreamRef.current = stream;
      if (onLocalStream) {
        onLocalStream(stream);
      }

      const pc = createPeerConnection();

      stream.getTracks().forEach(track => {
        console.log('Adding track to peer connection:', track.kind);
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      console.log('Created and set local offer');

      sendOffer(offer, targetId);

      return stream;
    } catch (error) {
      console.error('Error starting call:', error);
      throw error;
    }
  };

  const answerCall = async (isVideo: boolean, callerId: string) => {
    try {
      console.log('Answering call, isVideo:', isVideo);
      setIsInitiator(false);
      setRemotePeerId(callerId);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideo,
        audio: true
      });

      console.log('Got local stream for answer');
      localStreamRef.current = stream;
      if (onLocalStream) {
        onLocalStream(stream);
      }

      const pc = createPeerConnection();

      stream.getTracks().forEach(track => {
        console.log('Adding track to peer connection:', track.kind);
        pc.addTrack(track, stream);
      });

      return stream;
    } catch (error) {
      console.error('Error answering call:', error);
      throw error;
    }
  };

  const handleOffer = async (offer: RTCSessionDescriptionInit, callerId: string) => {
    try {
      console.log('Handling offer from', callerId);
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error('No peer connection when handling offer');
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('Set remote description from offer');

      if (pendingIceCandidates.current.length > 0) {
        console.log('Adding pending ICE candidates:', pendingIceCandidates.current.length);
        for (const candidate of pendingIceCandidates.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingIceCandidates.current = [];
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log('Created and set local answer');

      sendAnswer(answer, callerId);
    } catch (error) {
      console.error('Error handling offer:', error);
    }
  };

  const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
    try {
      console.log('Handling answer');
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.error('No peer connection when handling answer');
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('Set remote description from answer');

      if (pendingIceCandidates.current.length > 0) {
        console.log('Adding pending ICE candidates:', pendingIceCandidates.current.length);
        for (const candidate of pendingIceCandidates.current) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        pendingIceCandidates.current = [];
      }
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  };

  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    try {
      const pc = peerConnectionRef.current;
      if (!pc) {
        console.log('No peer connection yet, queueing ICE candidate');
        return;
      }

      if (!pc.remoteDescription) {
        console.log('No remote description yet, queueing ICE candidate');
        pendingIceCandidates.current.push(candidate);
        return;
      }

      console.log('Adding ICE candidate');
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Error handling ICE candidate:', error);
    }
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        return !audioTrack.enabled;
      }
    }
    return false;
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        return !videoTrack.enabled;
      }
    }
    return false;
  };

  const endCall = () => {
    console.log('Ending call and cleaning up');

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      localStreamRef.current = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      remoteStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    setRemotePeerId(null);
    setIsInitiator(false);
    pendingIceCandidates.current = [];
  };

  useEffect(() => {
    return () => {
      endCall();
    };
  }, []);

  return {
    startCall,
    answerCall,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    toggleAudio,
    toggleVideo,
    endCall,
    localStream: localStreamRef.current,
    remoteStream: remoteStreamRef.current
  };
}
