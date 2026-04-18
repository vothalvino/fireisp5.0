-- Rollback: 152_add_refresh_token_rotation
-- Removes the token_family column and index from user_sessions.

ALTER TABLE user_sessions
    DROP KEY idx_user_sessions_token_family,
    DROP COLUMN token_family;
