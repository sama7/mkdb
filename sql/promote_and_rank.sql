-- promote_and_rank.sql
-- Run after the API sync has populated users_stg + ratings_stg.
-- Promotes staging into live, recomputes user_similarity_scores per network,
-- appends weekly ranking snapshots per network, trims rankings history to 3
-- weeks per network, and deletes orphan films. The trailing SELECT returns
-- slugs of films just deleted, so the caller (scripts/promote.ts) can unlink
-- the corresponding poster files on disk.

BEGIN;

-- 1. Swap staging into live tables. is_metro / is_lycan flags carry over
-- via SELECT *.
TRUNCATE TABLE ratings;
TRUNCATE TABLE user_similarity_scores;
TRUNCATE TABLE users CASCADE;

INSERT INTO users SELECT * FROM users_stg;
INSERT INTO ratings SELECT * FROM ratings_stg;

-- 2. Recompute user_similarity_scores per network. Same overlap-weighted
-- average-distance score as before; we just run it twice with the user pool
-- restricted to that network's members.

-- 2a. Metro similarity scores.
WITH metro_users AS (
    SELECT user_id FROM users WHERE is_metro
),
user_pair_data AS (
    SELECT
        r1.user_id AS user_a,
        r2.user_id AS user_b,
        COUNT(*)                              AS overlap_count,
        AVG(ABS(r1.rating - r2.rating))       AS avg_rating_distance
    FROM ratings r1
    JOIN metro_users m1 ON r1.user_id = m1.user_id
    JOIN ratings r2     ON r1.film_id = r2.film_id AND r1.user_id < r2.user_id
    JOIN metro_users m2 ON r2.user_id = m2.user_id
    GROUP BY r1.user_id, r2.user_id
),
normalized_data AS (
    SELECT
        user_a, user_b, overlap_count, avg_rating_distance,
        avg_rating_distance * 1.0 / NULLIF(MAX(avg_rating_distance) OVER (), 0) AS normalized_distance
    FROM user_pair_data
),
similarity_calculated AS (
    SELECT
        user_a, user_b, overlap_count, avg_rating_distance,
        (1 - normalized_distance) * (overlap_count * 1.0 / (overlap_count + 50)) AS similarity_score
    FROM normalized_data
),
symmetrized_data AS (
    SELECT user_a, user_b, overlap_count, avg_rating_distance, similarity_score FROM similarity_calculated
    UNION ALL
    SELECT user_b AS user_a, user_a AS user_b, overlap_count, avg_rating_distance, similarity_score FROM similarity_calculated
)
INSERT INTO user_similarity_scores (user_a, user_b, overlap_count, avg_rating_distance, similarity_score, network, time_computed)
SELECT user_a, user_b, overlap_count, avg_rating_distance, similarity_score, 'metro', NOW()
  FROM symmetrized_data;

-- 2b. Lank similarity scores (same recipe, scoped to is_lycan users).
WITH lank_users AS (
    SELECT user_id FROM users WHERE is_lycan
),
user_pair_data AS (
    SELECT
        r1.user_id AS user_a,
        r2.user_id AS user_b,
        COUNT(*)                              AS overlap_count,
        AVG(ABS(r1.rating - r2.rating))       AS avg_rating_distance
    FROM ratings r1
    JOIN lank_users m1 ON r1.user_id = m1.user_id
    JOIN ratings r2    ON r1.film_id = r2.film_id AND r1.user_id < r2.user_id
    JOIN lank_users m2 ON r2.user_id = m2.user_id
    GROUP BY r1.user_id, r2.user_id
),
normalized_data AS (
    SELECT
        user_a, user_b, overlap_count, avg_rating_distance,
        avg_rating_distance * 1.0 / NULLIF(MAX(avg_rating_distance) OVER (), 0) AS normalized_distance
    FROM user_pair_data
),
similarity_calculated AS (
    SELECT
        user_a, user_b, overlap_count, avg_rating_distance,
        (1 - normalized_distance) * (overlap_count * 1.0 / (overlap_count + 50)) AS similarity_score
    FROM normalized_data
),
symmetrized_data AS (
    SELECT user_a, user_b, overlap_count, avg_rating_distance, similarity_score FROM similarity_calculated
    UNION ALL
    SELECT user_b AS user_a, user_a AS user_b, overlap_count, avg_rating_distance, similarity_score FROM similarity_calculated
)
INSERT INTO user_similarity_scores (user_a, user_b, overlap_count, avg_rating_distance, similarity_score, network, time_computed)
SELECT user_a, user_b, overlap_count, avg_rating_distance, similarity_score, 'lank', NOW()
  FROM symmetrized_data;

-- 3. Append two ranking snapshots — one per network. Both reuse the next
-- monotonic week number so a given week always has rows for every network.
-- Metro requires >= 10 raters (community is ~340 users); lank lowers the
-- floor to >= 5 since the lycan pool is ~10x smaller and >= 10 would yield
-- only ~230 films.
WITH next_week AS (
    SELECT COALESCE(MAX(week), 0) + 1 AS w FROM film_rankings_history
)
INSERT INTO film_rankings_history (film_id, ranking, week, network, week_computed_at)
SELECT
    f.film_id,
    ROW_NUMBER() OVER (ORDER BY AVG(r.rating) DESC, COUNT(r.rating) DESC, f.film_id ASC) AS ranking,
    (SELECT w FROM next_week),
    'metro',
    NOW()
  FROM films f
  JOIN ratings r ON f.film_id = r.film_id
  JOIN users   u ON r.user_id = u.user_id AND u.is_metro
 WHERE f.tmdb LIKE 'https://www.themoviedb.org/movie/%'
 GROUP BY f.film_id
HAVING COUNT(r.rating) >= 10
LIMIT 1000;

WITH next_week AS (
    SELECT COALESCE(MAX(week), 0) AS w FROM film_rankings_history
    -- already incremented by the metro insert above; promote always inserts
    -- both networks in lockstep so MAX(week) IS the current week here
)
INSERT INTO film_rankings_history (film_id, ranking, week, network, week_computed_at)
SELECT
    f.film_id,
    ROW_NUMBER() OVER (ORDER BY AVG(r.rating) DESC, COUNT(r.rating) DESC, f.film_id ASC) AS ranking,
    (SELECT w FROM next_week),
    'lank',
    NOW()
  FROM films f
  JOIN ratings r ON f.film_id = r.film_id
  JOIN users   u ON r.user_id = u.user_id AND u.is_lycan
 WHERE f.tmdb LIKE 'https://www.themoviedb.org/movie/%'
 GROUP BY f.film_id
HAVING COUNT(r.rating) >= 5
LIMIT 1000;

-- 4. Trim ranking history to the current week + previous 2 weeks, per network.
-- We can use a single threshold (max week minus 2) because both networks share
-- the week numbering and are appended together each cycle.
DELETE FROM film_rankings_history
 WHERE week < (SELECT MAX(week) - 2 FROM film_rankings_history);

-- 5. Empty staging so orphan films are no longer referenced by ratings_stg.
TRUNCATE TABLE ratings_stg;
TRUNCATE TABLE users_stg CASCADE;

-- 6. Delete orphan films (no current rating, not in last 3 weeks of either
-- network's rankings) and return their slugs so the wrapper can unlink the
-- poster files.
WITH orphans AS (
    DELETE FROM films
     WHERE film_id NOT IN (SELECT DISTINCT film_id FROM ratings WHERE film_id IS NOT NULL)
       AND film_id NOT IN (SELECT DISTINCT film_id FROM film_rankings_history)
    RETURNING slug
)
SELECT slug FROM orphans;

COMMIT;
