import { Link } from 'react-router-dom';
import type { RankChangeFilm } from '../types';
import { useNetwork } from '../network';

interface FilmCardNewEntriesProps {
    film: RankChangeFilm;
}

const FilmCardNewEntries = ({ film }: FilmCardNewEntriesProps) => {
    const { urlBase } = useNetwork();
    return (
        <div className="film-card">
            <Link to={`${urlBase}/film/${film.slug}`}>
                <img className='film-poster' loading="lazy" src={`/images/posters/${film.slug}.jpg`} alt={`${film.title} (${film.year})`} title={`${film.title} (${film.year})`} style={{ width: '100%' }} />
            </Link>
            <div className="film-info">
                {film.current_rank}
            </div>
        </div>
    );
};

export default FilmCardNewEntries;
