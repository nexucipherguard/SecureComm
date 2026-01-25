/*
  # Room Access Control System

  1. New Tables
    - `rooms`
      - `id` (text, primary key) - Room ID
      - `host_name` (text) - Name of the room host
      - `host_socket_id` (text) - Socket ID of the host
      - `is_public` (boolean) - Whether the room is public or requires approval
      - `created_at` (timestamptz) - When the room was created
      - `last_active` (timestamptz) - Last activity timestamp
    
    - `room_participants`
      - `id` (uuid, primary key)
      - `room_id` (text, foreign key) - Reference to rooms table
      - `user_name` (text) - Name of the participant
      - `socket_id` (text) - Current socket ID of the participant
      - `is_host` (boolean) - Whether this participant is the host
      - `joined_at` (timestamptz) - When they joined
    
    - `join_requests`
      - `id` (uuid, primary key)
      - `room_id` (text, foreign key) - Reference to rooms table
      - `user_name` (text) - Name of the user requesting to join
      - `socket_id` (text) - Socket ID of the requester
      - `status` (text) - 'pending', 'accepted', 'rejected'
      - `requested_at` (timestamptz) - When the request was made
      - `responded_at` (timestamptz) - When host responded

  2. Security
    - Enable RLS on all tables
    - Public read access for rooms (anyone can see room info)
    - Public write access for room creation and join requests
    - No authentication required (matches current socket-based approach)
*/

-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  host_name text NOT NULL,
  host_socket_id text NOT NULL,
  is_public boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  last_active timestamptz DEFAULT now()
);

-- Create room_participants table
CREATE TABLE IF NOT EXISTS room_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  socket_id text NOT NULL,
  is_host boolean DEFAULT false,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(room_id, socket_id)
);

-- Create join_requests table
CREATE TABLE IF NOT EXISTS join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_name text NOT NULL,
  socket_id text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  requested_at timestamptz DEFAULT now(),
  responded_at timestamptz
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_rooms_host_socket ON rooms(host_socket_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_socket ON room_participants(socket_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_room ON join_requests(room_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status);

-- Enable RLS
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;

-- Public access policies (no authentication required)
CREATE POLICY "Anyone can read rooms"
  ON rooms FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create rooms"
  ON rooms FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update rooms"
  ON rooms FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete rooms"
  ON rooms FOR DELETE
  USING (true);

CREATE POLICY "Anyone can read participants"
  ON room_participants FOR SELECT
  USING (true);

CREATE POLICY "Anyone can add participants"
  ON room_participants FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update participants"
  ON room_participants FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can remove participants"
  ON room_participants FOR DELETE
  USING (true);

CREATE POLICY "Anyone can read join requests"
  ON join_requests FOR SELECT
  USING (true);

CREATE POLICY "Anyone can create join requests"
  ON join_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update join requests"
  ON join_requests FOR UPDATE
  USING (true);

CREATE POLICY "Anyone can delete join requests"
  ON join_requests FOR DELETE
  USING (true);