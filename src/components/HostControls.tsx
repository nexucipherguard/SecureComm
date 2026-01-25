import React from 'react';
import { X, Check, UserX, Lock, Unlock } from 'lucide-react';

interface JoinRequest {
  requestId: string;
  userName: string;
  socketId: string;
  requestedAt: string;
}

interface Participant {
  id: string;
  name: string;
  isOnline: boolean;
  joinedAt: number;
  isHost?: boolean;
}

interface HostControlsProps {
  isHost: boolean;
  isPublic: boolean;
  joinRequests: JoinRequest[];
  participants: Participant[];
  currentUserName: string;
  onAcceptRequest: (requestId: string, socketId: string, userName: string) => void;
  onRejectRequest: (requestId: string, socketId: string) => void;
  onRemoveParticipant: (participantSocketId: string) => void;
  onTogglePrivacy: (isPublic: boolean) => void;
}

export default function HostControls({
  isHost,
  isPublic,
  joinRequests,
  participants,
  currentUserName,
  onAcceptRequest,
  onRejectRequest,
  onRemoveParticipant,
  onTogglePrivacy
}: HostControlsProps) {
  if (!isHost) {
    return null;
  }

  const otherParticipants = participants.filter(p => p.name !== currentUserName);

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold flex items-center space-x-2">
            <Lock className="w-4 h-4" />
            <span>Host Controls</span>
          </h3>
        </div>

        <div className="space-y-3">
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {isPublic ? (
                  <Unlock className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-400" />
                )}
                <span className="text-white text-sm">
                  {isPublic ? 'Public Room' : 'Private Room'}
                </span>
              </div>
              <button
                onClick={() => onTogglePrivacy(!isPublic)}
                className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                  isPublic
                    ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                }`}
              >
                Make {isPublic ? 'Private' : 'Public'}
              </button>
            </div>
            <p className="text-slate-400 text-xs mt-2">
              {isPublic
                ? 'Anyone with the link can join'
                : 'You must approve join requests'}
            </p>
          </div>

          {joinRequests.length > 0 && (
            <div className="bg-slate-900/50 rounded-lg p-3">
              <h4 className="text-white text-sm font-medium mb-3">
                Pending Requests ({joinRequests.length})
              </h4>
              <div className="space-y-2">
                {joinRequests.map((request) => (
                  <div
                    key={request.requestId}
                    className="flex items-center justify-between bg-slate-800/50 rounded p-2"
                  >
                    <span className="text-white text-sm">{request.userName}</span>
                    <div className="flex space-x-1">
                      <button
                        onClick={() =>
                          onAcceptRequest(
                            request.requestId,
                            request.socketId,
                            request.userName
                          )
                        }
                        className="p-1 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 rounded transition-all"
                        title="Accept"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() =>
                          onRejectRequest(request.requestId, request.socketId)
                        }
                        className="p-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-all"
                        title="Reject"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {otherParticipants.length > 0 && (
            <div className="bg-slate-900/50 rounded-lg p-3">
              <h4 className="text-white text-sm font-medium mb-3">
                Manage Participants ({otherParticipants.length})
              </h4>
              <div className="space-y-2">
                {otherParticipants.map((participant) => (
                  <div
                    key={participant.id}
                    className="flex items-center justify-between bg-slate-800/50 rounded p-2"
                  >
                    <div className="flex items-center space-x-2">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          participant.isOnline ? 'bg-emerald-400' : 'bg-slate-500'
                        }`}
                      />
                      <span className="text-white text-sm">{participant.name}</span>
                    </div>
                    <button
                      onClick={() => onRemoveParticipant(participant.id)}
                      className="p-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded transition-all"
                      title="Remove from room"
                    >
                      <UserX className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
