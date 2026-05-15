
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    status VARCHAR(20) DEFAULT 'offline'
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);


CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    type VARCHAR(10) NOT NULL,
    host_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_link VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now(),
    ended_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_rooms_host_id ON rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);
CREATE INDEX IF NOT EXISTS idx_rooms_invite_link ON rooms(invite_link);


CREATE TABLE IF NOT EXISTS participants (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    joined_at TIMESTAMPTZ DEFAULT now(),
    left_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_active ON participants(room_id, user_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_participants_room_id ON participants(room_id);
CREATE INDEX IF NOT EXISTS idx_participants_user_id ON participants(user_id);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ,
    is_edited BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user_id ON messages(user_id);

-- View for active participants (eliminates need for application-level checks)
CREATE OR REPLACE VIEW active_participants AS
SELECT id, room_id, user_id, role, joined_at
FROM participants
WHERE left_at IS NULL;

-- Function to ensure only active participants can send messages
CREATE OR REPLACE FUNCTION check_active_participant()
RETURNS TRIGGER AS $$
BEGIN
    -- Verify user is an active participant in the room
    IF NOT EXISTS (
        SELECT 1 FROM participants 
        WHERE room_id = NEW.room_id 
        AND user_id = NEW.user_id 
        AND left_at IS NULL
    ) THEN
        RAISE EXCEPTION 'User is not an active participant in this room';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to enforce participant check at DB level (atomic with INSERT)
DROP TRIGGER IF EXISTS enforce_active_participant_on_message ON messages;
CREATE TRIGGER enforce_active_participant_on_message
BEFORE INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION check_active_participant();
