-- promote_and_rank.sql
-- Run after the API sync has populated users_stg + ratings_stg.
-- Promotes staging into live, recomputes user_similarity_scores, appends a new
-- weekly ranking, trims rankings history to 3 weeks, and deletes orphan films.
-- The trailing SELECT returns slugs of films just deleted, so the caller
-- (scripts/promote.js) can unlink the corresponding poster files on disk.

BEGIN;

-- 1. Swap staging into live tables.
TRUNCATE TABLE ratings;
TRUNCATE TABLE user_similarity_scores;
TRUNCATE TABLE users CASCADE;

INSERT INTO users SELECT * FROM users_stg;
INSERT INTO ratings SELECT * FROM ratings_stg;

-- 2. Recompute user_similarity_scores from the freshly-loaded ratings.
WITH user_pair_data AS (
    SELECT
        r1.user_id AS user_a,
        r2.user_id AS user_b,
        COUNT(*)             AS overlap_count,
        AVG(ABS(r1.rating - r2.rating)) AS avg_rating_distance
    FROM ratings r1
    INNER JOIN ratings r2
        ON r1.film_id = r2.film_id
       AND r1.user_id < r2.user_id
    GROUP BY r1.user_id, r2.user_id
),
normalized_data AS (
    SELECT
        user_a,
        user_b,
        overlap_count,
        avg_rating_distance,
        avg_rating_distance * 1.0 / NULLIF(MAX(avg_rating_distance) OVER (), 0) AS normalized_distance
    FROM user_pair_data
),
similarity_calculated AS (
    SELECT
        user_a,
        user_b,
        overlap_count,
        avg_rating_distance,
        (1 - normalized_distance) * (overlap_count * 1.0 / (overlap_count + 50)) AS similarity_score
    FROM normalized_data
),
symmetrized_data AS (
    SELECT user_a, user_b, overlap_count, avg_rating_distance, similarity_score
      FROM similarity_calculated
    UNION ALL
    SELECT user_b AS user_a, user_a AS user_b, overlap_count, avg_rating_distance, similarity_score
      FROM similarity_calculated
)
INSERT INTO user_similarity_scores (
    user_a, user_b, overlap_count, avg_rating_distance, similarity_score, time_computed
)
SELECT user_a, user_b, overlap_count, avg_rating_distance, similarity_score, NOW()
  FROM symmetrized_data
ON CONFLICT (user_a, user_b) DO UPDATE
   SET overlap_count       = EXCLUDED.overlap_count,
       avg_rating_distance = EXCLUDED.avg_rating_distance,
       similarity_score    = EXCLUDED.similarity_score,
       time_computed       = NOW();

-- 3. Append the next weekly ranking snapshot.
INSERT INTO film_rankings_history (film_id, ranking, week, week_computed_at)
SELECT
    f.film_id,
    ROW_NUMBER() OVER (ORDER BY AVG(r.rating) DESC, COUNT(r.rating) DESC) AS ranking,
    COALESCE((SELECT MAX(week) FROM film_rankings_history), 0) + 1        AS week,
    NOW()
  FROM films f
  JOIN ratings r ON f.film_id = r.film_id
 WHERE f.tmdb LIKE 'https://www.themoviedb.org/movie/%'  -- exclude TV
 GROUP BY f.film_id, f.title, f.year, f.slug, f.genres
HAVING COUNT(r.rating) >= 10
LIMIT 1000;

-- 4. Trim ranking history to the current week + previous 2 weeks.
DELETE FROM film_rankings_history
 WHERE week < (SELECT MAX(week) - 2 FROM film_rankings_history);

-- 5. Empty staging so orphan films are no longer referenced by ratings_stg.
TRUNCATE TABLE ratings_stg;
TRUNCATE TABLE users_stg CASCADE;

-- 6. Delete orphan films (no current rating, not in last 3 weeks of rankings)
--    and return their slugs so the wrapper can unlink poster files.
WITH orphans AS (
    DELETE FROM films
     WHERE film_id NOT IN (SELECT DISTINCT film_id FROM ratings WHERE film_id IS NOT NULL)
       AND film_id NOT IN (SELECT DISTINCT film_id FROM film_rankings_history)
    RETURNING slug
)
SELECT slug FROM orphans;

COMMIT;
