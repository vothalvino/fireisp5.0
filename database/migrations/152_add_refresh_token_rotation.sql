-- Migration: 152_add_refresh_token_rotation
-- Description: Add token_family column to user_sessions for refresh token
--              rotation with reuse detection. When a refresh token is reused
--              (already rotated), all sessions in the same family are revoked
--              to mitigate token theft.

ALTER TABLE user_sessions
    ADD COLUMN token_family VARCHAR(255) NULL AFTER token_hash,
    ADD KEY idx_user_sessions_token_family (token_family);
