import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "https://securecomm.netlify.app"],
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.VITE_SUPABASE_URL || 'https://wodynbsoznvqfvznxwuz.supabase.co',
  process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvZHluYnNvem52cWZ2em54d3V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMDg3ODMsImV4cCI6MjA4NDg4NDc4M30.FVC24D6uw5myEJiYQxOZWhEIJeOWMCi02WM2wvvyUHM'
);

// Add a basic route handler for the root path
app.get('/', (req, res) => {
  res.json({
    message: 'SecureComm Chat Server is running',
    status: 'online',
    timestamp: new Date().toISOString()
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Store room data in memory (in production, use a database)
const rooms = new Map();
const userSockets = new Map();

// Helper function to get or create room
function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      participants: new Map(),
      messages: [],
      createdAt: Date.now()
    });
  }
  return rooms.get(roomId);
}

// Helper function to check if user is host of a room
async function isRoomHost(roomId, socketId) {
  const { data, error } = await supabase
    .from('room_participants')
    .select('is_host')
    .eq('room_id', roomId)
    .eq('socket_id', socketId)
    .maybeSingle();

  return data?.is_host || false;
}

// Helper function to get room settings
async function getRoomSettings(roomId) {
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', roomId)
    .maybeSingle();

  return data;
}

// Helper function to create room in database
async function createRoomInDB(roomId, hostName, hostSocketId, isPublic) {
  const { data, error } = await supabase
    .from('rooms')
    .insert({
      id: roomId,
      host_name: hostName,
      host_socket_id: hostSocketId,
      is_public: isPublic,
      last_active: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating room:', error);
    return null;
  }
  return data;
}

// Helper function to add participant to database
async function addParticipantToDB(roomId, userName, socketId, isHost) {
  const { data, error } = await supabase
    .from('room_participants')
    .insert({
      room_id: roomId,
      user_name: userName,
      socket_id: socketId,
      is_host: isHost
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding participant:', error);
    return null;
  }
  return data;
}

// Helper function to remove participant from database
async function removeParticipantFromDB(roomId, socketId) {
  const { error } = await supabase
    .from('room_participants')
    .delete()
    .eq('room_id', roomId)
    .eq('socket_id', socketId);

  if (error) {
    console.error('Error removing participant:', error);
  }
}

// Helper function to create join request
async function createJoinRequest(roomId, userName, socketId) {
  const { data, error } = await supabase
    .from('join_requests')
    .insert({
      room_id: roomId,
      user_name: userName,
      socket_id: socketId,
      status: 'pending'
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating join request:', error);
    return null;
  }
  return data;
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join room with access control
  socket.on('join-room', async ({ roomId, userName, isHost = false, isPublic = true }) => {
    console.log(`User ${userName} attempting to join room ${roomId}`);

    try {
      // Check if room exists in database
      let roomSettings = await getRoomSettings(roomId);

      // If room doesn't exist and this is the first user, create it
      if (!roomSettings && isHost) {
        console.log(`Creating new room ${roomId} with host ${userName}`);
        roomSettings = await createRoomInDB(roomId, userName, socket.id, isPublic);

        if (!roomSettings) {
          socket.emit('join-error', { message: 'Failed to create room' });
          return;
        }

        // Create room in memory
        const room = getOrCreateRoom(roomId);

        // Add host as participant in database
        await addParticipantToDB(roomId, userName, socket.id, true);

        // Add host to room
        const participant = {
          id: socket.id,
          name: userName,
          isOnline: true,
          joinedAt: Date.now(),
          isHost: true
        };

        room.participants.set(socket.id, participant);
        userSockets.set(socket.id, { roomId, userName, isHost: true });

        socket.join(roomId);

        // Send room info to host
        socket.emit('room-joined', { roomId, isHost: true, isPublic });
        socket.emit('room-messages', room.messages);
        socket.emit('participants-updated', Array.from(room.participants.values()));

        console.log(`Room ${roomId} created with host ${userName}`);
        return;
      }

      // If room doesn't exist, create it as public (for custom room IDs)
      if (!roomSettings) {
        console.log(`Creating new public room ${roomId} via custom join`);
        roomSettings = await createRoomInDB(roomId, userName, socket.id, true); // Always public for custom joins

        if (!roomSettings) {
          socket.emit('join-error', { message: 'Failed to create room' });
          return;
        }

        // Create room in memory
        const room = getOrCreateRoom(roomId);

        // Add first participant (not explicitly marked as host)
        await addParticipantToDB(roomId, userName, socket.id, false);

        const participant = {
          id: socket.id,
          name: userName,
          isOnline: true,
          joinedAt: Date.now(),
          isHost: false
        };

        room.participants.set(socket.id, participant);
        userSockets.set(socket.id, { roomId, userName, isHost: false });

        socket.join(roomId);

        // Send room info
        socket.emit('room-joined', { roomId, isHost: false, isPublic: true });
        socket.emit('room-messages', room.messages);
        socket.emit('participants-updated', Array.from(room.participants.values()));

        console.log(`Public room ${roomId} created via custom join by ${userName}`);
        return;
      }

      // Check if room is public or requires approval
      if (!roomSettings.is_public && !isHost) {
        // Check if user is already approved
        const { data: existingParticipant } = await supabase
          .from('room_participants')
          .select('*')
          .eq('room_id', roomId)
          .eq('user_name', userName)
          .maybeSingle();

        if (!existingParticipant) {
          // Create join request
          const joinRequest = await createJoinRequest(roomId, userName, socket.id);

          if (joinRequest) {
            // Notify host about the join request
            const hostParticipant = Array.from(userSockets.entries())
              .find(([_, info]) => info.roomId === roomId && info.isHost);

            if (hostParticipant) {
              io.to(hostParticipant[0]).emit('join-request', {
                requestId: joinRequest.id,
                userName,
                socketId: socket.id,
                requestedAt: joinRequest.requested_at
              });
            }

            socket.emit('join-pending', {
              message: 'Your request to join has been sent to the host',
              roomId
            });
            console.log(`Join request created for ${userName} to room ${roomId}`);
            return;
          }
        }
      }

      // User is approved or room is public, proceed with join
      const room = getOrCreateRoom(roomId);

      // Check if user is reconnecting
      const existingParticipant = Array.from(room.participants.values())
        .find(p => p.name === userName);

      if (existingParticipant) {
        // Update socket ID
        room.participants.delete(existingParticipant.id);
        room.participants.set(socket.id, {
          id: socket.id,
          name: userName,
          isOnline: true,
          joinedAt: existingParticipant.joinedAt,
          isHost: existingParticipant.isHost
        });

        userSockets.set(socket.id, {
          roomId,
          userName,
          isHost: existingParticipant.isHost
        });
        socket.join(roomId);

        socket.emit('room-joined', {
          roomId,
          isHost: existingParticipant.isHost,
          isPublic: roomSettings.is_public
        });
        socket.emit('room-messages', room.messages);

        const participantsList = Array.from(room.participants.values());
        io.to(roomId).emit('participants-updated', participantsList);

        console.log(`User ${userName} reconnected to room ${roomId}`);
        return;
      }

      // Add new participant
      await addParticipantToDB(roomId, userName, socket.id, false);

      const participant = {
        id: socket.id,
        name: userName,
        isOnline: true,
        joinedAt: Date.now(),
        isHost: false
      };

      room.participants.set(socket.id, participant);
      userSockets.set(socket.id, { roomId, userName, isHost: false });

      socket.join(roomId);

      socket.emit('room-joined', {
        roomId,
        isHost: false,
        isPublic: roomSettings.is_public
      });
      socket.emit('room-messages', room.messages);

      const participantsList = Array.from(room.participants.values());
      io.to(roomId).emit('participants-updated', participantsList);

      // Send join notification
      const joinMessage = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        content: `${userName} joined the room`,
        timestamp: Date.now(),
        sender: 'System',
        type: 'system',
        encrypted: false
      };

      room.messages.push(joinMessage);
      io.to(roomId).emit('new-message', joinMessage);

      console.log(`User ${userName} joined room ${roomId}`);
    } catch (error) {
      console.error('Error in join-room:', error);
      socket.emit('join-error', { message: 'Failed to join room' });
    }
  });

  // Handle new messages
  socket.on('send-message', (messageData) => {
    const userInfo = userSockets.get(socket.id);
    if (!userInfo) return;
    
    const room = rooms.get(userInfo.roomId);
    if (!room) return;
    
    const message = {
      ...messageData,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now()
    };
    
    room.messages.push(message);
    
    // Broadcast message to all users in the room
    io.to(userInfo.roomId).emit('new-message', message);
    
    console.log(`Message sent in room ${userInfo.roomId}:`, message.content);
  });

  // Handle typing indicators
  socket.on('typing-start', () => {
    const userInfo = userSockets.get(socket.id);
    if (userInfo) {
      socket.to(userInfo.roomId).emit('user-typing', {
        userId: socket.id,
        userName: userInfo.userName,
        isTyping: true
      });
    }
  });

  socket.on('typing-stop', () => {
    const userInfo = userSockets.get(socket.id);
    if (userInfo) {
      socket.to(userInfo.roomId).emit('user-typing', {
        userId: socket.id,
        userName: userInfo.userName,
        isTyping: false
      });
    }
  });

  // Handle call events
  socket.on('start-call', ({ isVideo }) => {
    const userInfo = userSockets.get(socket.id);
    if (userInfo) {
      socket.to(userInfo.roomId).emit('incoming-call', {
        from: userInfo.userName,
        isVideo,
        callerId: socket.id
      });
    }
  });

  socket.on('accept-call', ({ callerId }) => {
    socket.to(callerId).emit('call-accepted', {
      accepterId: socket.id
    });
  });

  socket.on('reject-call', ({ callerId }) => {
    socket.to(callerId).emit('call-rejected');
  });

  socket.on('end-call', () => {
    const userInfo = userSockets.get(socket.id);
    if (userInfo) {
      socket.to(userInfo.roomId).emit('call-ended');
    }
  });

  // WebRTC signaling events
  socket.on('webrtc-offer', ({ offer, targetId }) => {
    socket.to(targetId).emit('webrtc-offer', {
      offer,
      callerId: socket.id
    });
  });

  socket.on('webrtc-answer', ({ answer, targetId }) => {
    socket.to(targetId).emit('webrtc-answer', {
      answer,
      accepterId: socket.id
    });
  });

  socket.on('webrtc-ice-candidate', ({ candidate, targetId }) => {
    socket.to(targetId).emit('webrtc-ice-candidate', {
      candidate,
      senderId: socket.id
    });
  });

  // Accept join request (host only)
  socket.on('accept-join-request', async ({ requestId, socketId, userName }) => {
    try {
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) return;

      const isHost = await isRoomHost(userInfo.roomId, socket.id);
      if (!isHost) {
        socket.emit('error', { message: 'Only the host can accept join requests' });
        return;
      }

      // Update join request status
      await supabase
        .from('join_requests')
        .update({
          status: 'accepted',
          responded_at: new Date().toISOString()
        })
        .eq('id', requestId);

      // Add participant to database
      await addParticipantToDB(userInfo.roomId, userName, socketId, false);

      // Add participant to in-memory room
      const room = rooms.get(userInfo.roomId);
      if (room) {
        const participant = {
          id: socketId,
          name: userName,
          isOnline: true,
          joinedAt: Date.now(),
          isHost: false
        };

        room.participants.set(socketId, participant);
        userSockets.set(socketId, {
          roomId: userInfo.roomId,
          userName,
          isHost: false
        });

        // Get the requester's socket and join them to the room
        const requesterSocket = io.sockets.sockets.get(socketId);
        if (requesterSocket) {
          requesterSocket.join(userInfo.roomId);

          // Send room data to the accepted user
          requesterSocket.emit('room-joined', {
            roomId: userInfo.roomId,
            isHost: false,
            isPublic: false
          });
          requesterSocket.emit('room-messages', room.messages);
        }

        // Notify all participants
        const participantsList = Array.from(room.participants.values());
        io.to(userInfo.roomId).emit('participants-updated', participantsList);

        // Send join notification
        const joinMessage = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          content: `${userName} joined the room`,
          timestamp: Date.now(),
          sender: 'System',
          type: 'system',
          encrypted: false
        };

        room.messages.push(joinMessage);
        io.to(userInfo.roomId).emit('new-message', joinMessage);
      }

      console.log(`Join request accepted for ${userName} by host`);
    } catch (error) {
      console.error('Error accepting join request:', error);
      socket.emit('error', { message: 'Failed to accept join request' });
    }
  });

  // Reject join request (host only)
  socket.on('reject-join-request', async ({ requestId, socketId }) => {
    try {
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) return;

      const isHost = await isRoomHost(userInfo.roomId, socket.id);
      if (!isHost) {
        socket.emit('error', { message: 'Only the host can reject join requests' });
        return;
      }

      // Update join request status
      await supabase
        .from('join_requests')
        .update({
          status: 'rejected',
          responded_at: new Date().toISOString()
        })
        .eq('id', requestId);

      // Notify the requester
      io.to(socketId).emit('join-request-rejected', {
        message: 'Your request to join was rejected by the host'
      });

      console.log(`Join request rejected for user ${socketId}`);
    } catch (error) {
      console.error('Error rejecting join request:', error);
      socket.emit('error', { message: 'Failed to reject join request' });
    }
  });

  // Remove participant (host only)
  socket.on('remove-participant', async ({ participantSocketId }) => {
    try {
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) return;

      const isHost = await isRoomHost(userInfo.roomId, socket.id);
      if (!isHost) {
        socket.emit('error', { message: 'Only the host can remove participants' });
        return;
      }

      const room = rooms.get(userInfo.roomId);
      if (!room) return;

      const participantInfo = userSockets.get(participantSocketId);
      if (!participantInfo) return;

      // Remove from database
      await removeParticipantFromDB(userInfo.roomId, participantSocketId);

      // Remove from in-memory room
      room.participants.delete(participantSocketId);

      // Notify the removed participant
      io.to(participantSocketId).emit('removed-from-room', {
        message: 'You have been removed from the room by the host'
      });

      // Force disconnect from room
      io.sockets.sockets.get(participantSocketId)?.leave(userInfo.roomId);

      // Update participants list
      const participantsList = Array.from(room.participants.values());
      io.to(userInfo.roomId).emit('participants-updated', participantsList);

      // Send notification message
      const leaveMessage = {
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        content: `${participantInfo.userName} was removed from the room`,
        timestamp: Date.now(),
        sender: 'System',
        type: 'system',
        encrypted: false
      };

      room.messages.push(leaveMessage);
      io.to(userInfo.roomId).emit('new-message', leaveMessage);

      console.log(`Participant ${participantInfo.userName} removed by host`);
    } catch (error) {
      console.error('Error removing participant:', error);
      socket.emit('error', { message: 'Failed to remove participant' });
    }
  });

  // Toggle room privacy (host only)
  socket.on('toggle-room-privacy', async ({ isPublic }) => {
    try {
      const userInfo = userSockets.get(socket.id);
      if (!userInfo) return;

      const isHost = await isRoomHost(userInfo.roomId, socket.id);
      if (!isHost) {
        socket.emit('error', { message: 'Only the host can change room settings' });
        return;
      }

      // Update room settings in database
      await supabase
        .from('rooms')
        .update({ is_public: isPublic })
        .eq('id', userInfo.roomId);

      // Notify all participants
      io.to(userInfo.roomId).emit('room-privacy-updated', { isPublic });

      console.log(`Room ${userInfo.roomId} privacy toggled to ${isPublic ? 'public' : 'private'}`);
    } catch (error) {
      console.error('Error toggling room privacy:', error);
      socket.emit('error', { message: 'Failed to update room settings' });
    }
  });

  // Handle disconnect
  socket.on('disconnect', async () => {
    console.log('User disconnected:', socket.id);

    const userInfo = userSockets.get(socket.id);
    if (userInfo) {
      const room = rooms.get(userInfo.roomId);
      if (room) {
        // Remove participant from database
        await removeParticipantFromDB(userInfo.roomId, socket.id);

        // Remove participant from memory
        room.participants.delete(socket.id);

        // Send leave notification only if there are still participants
        if (room.participants.size > 0) {
          const leaveMessage = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            content: `${userInfo.userName} left the room`,
            timestamp: Date.now(),
            sender: 'System',
            type: 'system',
            encrypted: false
          };

          room.messages.push(leaveMessage);
          io.to(userInfo.roomId).emit('new-message', leaveMessage);
        }

        // Update participants list
        const participantsList = Array.from(room.participants.values());
        io.to(userInfo.roomId).emit('participants-updated', participantsList);

        // Clean up empty rooms
        if (room.participants.size === 0) {
          console.log(`Room ${userInfo.roomId} is empty, cleaning up`);
          rooms.delete(userInfo.roomId);

          // Delete room from database
          await supabase.from('rooms').delete().eq('id', userInfo.roomId);
        }

        console.log(`Room ${userInfo.roomId} now has ${room.participants.size} participants`);
      }

      userSockets.delete(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
