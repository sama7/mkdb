import { Link } from 'react-router-dom';
import type { FilmRanking } from '../types';

interface FilmCardProps {
    film: FilmRanking;
}

const FilmCard = ({ film }: FilmCardProps) => {
    return (
        <div className="film-card">
            <Link to={`/film/${film.slug}`}>
                <img className='film-poster' loading="lazy" src={`/images/posters/${film.slug}.jpg`} alt={`${film.title} (${film.year})`} title={`${film.title} (${film.year})`} style={{ width: '100%' }} />
            </Link>
            <div className="film-info">
                {film.ranking}
            </div>
        </div>
    );
};

export default FilmCard;
