import { Link } from 'react-router-dom';
import type { RankChangeFilm } from '../types';

interface FilmCardRisersProps {
    film: RankChangeFilm;
}

const FilmCardRisers = ({ film }: FilmCardRisersProps) => {
    return (
        <div className="film-card">
            <Link to={`/film/${film.slug}`}>
                <img className='film-poster' loading="lazy" src={`/images/posters/${film.slug}.jpg`} alt={`${film.title} (${film.year})`} title={`${film.title} (${film.year})`} style={{ width: '100%' }} />
            </Link>
            <div className="film-info">
                {film.current_rank} <span className="rank-up-risers">▲ {film.rank_change}</span>
            </div>
        </div>
    );
};

export default FilmCardRisers;
