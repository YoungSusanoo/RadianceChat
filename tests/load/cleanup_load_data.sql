BEGIN;

CREATE TEMP TABLE load_test_users AS
SELECT id
FROM users
WHERE email LIKE '%@load.radiance.local'
   OR email LIKE 'create-host-%@example.com'
   OR email LIKE 'join-host-%@example.com'
   OR email LIKE 'join-guest-%@example.com'
   OR email LIKE 'chat-user-%@example.com';

CREATE TEMP TABLE load_test_rooms AS
SELECT DISTINCT r.id
FROM rooms r
LEFT JOIN room_participants rp ON rp.room_id = r.id
WHERE r.host_id IN (SELECT id FROM load_test_users)
   OR rp.user_id IN (SELECT id FROM load_test_users)
   OR r.description LIKE 'Load test room %'
   OR r.name LIKE 'Room create-room-%'
   OR r.name LIKE 'Room join-room-%'
   OR r.name LIKE 'Room chat-room-%';

DELETE FROM audit_events
WHERE actor_id IN (SELECT id FROM load_test_users)
   OR room_id IN (SELECT id FROM load_test_rooms);

DELETE FROM rooms
WHERE id IN (SELECT id FROM load_test_rooms);

DELETE FROM sessions
WHERE user_id IN (SELECT id FROM load_test_users);

DELETE FROM users
WHERE id IN (SELECT id FROM load_test_users);

COMMIT;
