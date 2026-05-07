export type PgNumeric = string;
export type PgCount = string;
export type Genre = string;

export type GenreFilterMode = 'include' | 'exclude';
export type GenreFilters = Record<string, GenreFilterMode>;

export interface RankingFilters {
  page?: string | number;
  minYear?: string | number;
  maxYear?: string | number;
  minRatings?: string | number;
  maxRatings?: string | number;
  limit?: string | number;
  genres?: GenreFilters;
}

export interface FilmRanking {
  total_count: PgCount;
  ranking: PgCount;
  title: string;
  year: number | null;
  slug: string;
  genres: Genre[];
  average_rating: PgNumeric;
  rating_count: PgCount;
}

export interface Film {
  title: string;
  year: number | null;
  slug?: string;
  directors?: string[];
  genres?: Genre[];
  countries?: string[];
  languages?: string[];
  runtime?: number | null;
  synopsis?: string | null;
  average_rating?: PgNumeric;
  rating_count?: PgCount;
  current_rank?: number | PgCount | null;
  previous_rank?: number | PgCount | null;
}

export interface Rating {
  username: string;
  display_name: string;
  rating: PgNumeric;
}

export interface FilmDetailsResponse {
  film: Film;
  ratings: Rating[];
}

export interface User {
  user_id: number;
  username: string;
  display_name: string;
  num_films_watched: number | null;
}

export interface MemberDetails extends User {
  avg_rating: PgNumeric | null;
}

export interface SearchResult {
  slug: string;
  film: Film;
}
