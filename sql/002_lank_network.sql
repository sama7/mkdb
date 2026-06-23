-- 002_lank_network.sql
-- One-time migration adding multi-network support so /lank can ride alongside
-- the existing metro rankings. After this runs, the same `users` / `ratings` /
-- `films` tables serve both communities — a user followed by both metrodb and
-- lycandb is stored once with is_metro = is_lycan = true, ratings stored once.
--
-- Apply once:   psql mkdb -f sql/002_lank_network.sql

BEGIN;

-- 1. users / users_stg get two boolean flags. Existing users were discovered
-- via metrodb's follows so default is_metro = true for live data; users_stg
-- is rebuilt each sync, so its default is false (each discover call sets the
-- relevant flag).
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_metro boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS is_lycan boolean NOT NULL DEFAULT false;

ALTER TABLE users_stg
    ADD COLUMN IF NOT EXISTS is_metro boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS is_lycan boolean NOT NULL DEFAULT false;

-- 2. film_rankings_history gains a network discriminator. Existing rows are
-- the metro snapshots, so default 'metro' backfills them correctly. PK widens
-- to (film_id, week, network) so each (week, network) pair can coexist.
ALTER TABLE film_rankings_history
    ADD COLUMN IF NOT EXISTS network varchar(16) NOT NULL DEFAULT 'metro';

ALTER TABLE film_rankings_history
    DROP CONSTRAINT IF EXISTS film_rankings_history_pkey;
ALTER TABLE film_rankings_history
    ADD CONSTRAINT film_rankings_history_pkey PRIMARY KEY (film_id, week, network);

-- 3. user_similarity_scores likewise — metro pairs default, lank pairs added
-- alongside on each promote. PK widens to (user_a, user_b, network).
ALTER TABLE user_similarity_scores
    ADD COLUMN IF NOT EXISTS network varchar(16) NOT NULL DEFAULT 'metro';

ALTER TABLE user_similarity_scores
    DROP CONSTRAINT IF EXISTS user_similarity_scores_pkey;
ALTER TABLE user_similarity_scores
    ADD CONSTRAINT user_similarity_scores_pkey PRIMARY KEY (user_a, user_b, network);

COMMIT;
