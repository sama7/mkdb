import type {
  Film as ApiFilm,
  FilmRanking,
  FilterOptions,
  GenreFilters,
  MemberDetails,
  MultiSelectFilters,
  Rating,
  User,
} from '../../types/api';

export type { FilmRanking, FilterOptions, GenreFilters, MemberDetails, MultiSelectFilters, Rating, User };

export type Film = ApiFilm & {
  slug: string;
  title: string;
  year: number | null;
};

export interface RankChangeFilm {
  title: string;
  year: number | null;
  slug: string;
  current_rank?: number | string | null;
  previous_rank?: number | string | null;
  rank_change: number;
}

export interface NeighborFilm {
  total_count: string;
  slug: string;
  title: string;
  year: number | null;
  user_a_username: string;
  user_a_rating: number | string;
  user_b_username: string;
  user_b_rating: number | string;
}

export interface NeighborSummary {
  total_count: string;
  user_a: string;
  neighbor_username: string;
  neighbor_display_name: string;
  similarity_score: string | number;
  overlap_count: string | number;
  avg_rating_distance: string | number;
}

// num_films_watched is nullable at the source (see MemberDetails); a member
// whose sync leg failed has no count until the next run. Render paths must
// go through formatCount() rather than assume a number.
export type Member = MemberDetails;

export interface FiltersState {
  minYear?: string;
  maxYear?: string;
  minRatings?: string;
  maxRatings?: string;
  minRuntime?: string;
  maxRuntime?: string;
  genres?: MultiSelectFilters;
  directors?: MultiSelectFilters;
  countries?: MultiSelectFilters;
  languages?: MultiSelectFilters;
}

/** The multi-select filter fields, used to drive the filter UI generically. */
export type MultiSelectField = 'genres' | 'directors' | 'countries' | 'languages';

export type MemberSort = 'Watched' | 'Name';
export type NeighborSort = 'Similarity Score' | 'Name';

export interface TabPanelProps {
  id: string;
}
