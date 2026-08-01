-- Rollback 439 — drop the deploy request queue and the agent heartbeat.
--
-- Order matters: deploy_requests carries an FK to users, so it goes first.
-- Dropping these strands nothing — the host agent simply finds no table and
-- exits, and the GUI button disappears with the routes.
DROP TABLE IF EXISTS deploy_requests;
DROP TABLE IF EXISTS deploy_agent_status;
