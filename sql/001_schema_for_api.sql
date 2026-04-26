-- Migration 001: prepare schema for the Letterboxd API ingester.
--
-- letterboxd_id becomes the canonical identity for films and users.
-- films.details_fetched_at gates the per-film detail fetch (NULL = needs fetch).
-- film_rankings_history.week_computed_at records when each weekly snapshot was taken.

BEGIN;

ALTER TABLE films
    ADD COLUMN IF NOT EXISTS letterboxd_id      varchar(32) UNIQUE,
    ADD COLUMN IF NOT EXISTS details_fetched_at timestamptz;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS letterboxd_id varchar(32) UNIQUE;

ALTER TABLE users_stg
    ADD COLUMN IF NOT EXISTS letterboxd_id varchar(32) UNIQUE;

ALTER TABLE film_rankings_history
    ADD COLUMN IF NOT EXISTS week_computed_at timestamptz;

COMMIT;
