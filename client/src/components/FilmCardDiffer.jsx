import React from 'react';
import { Link } from 'react-router-dom';

const FilmCardDiffer = ({ film }) => {

    // Function to convert rating to stars with symbols
    const getStarSymbols = (rating) => {
        const fullStars = Math.floor(rating);
        const halfStar = rating % 1 === 0.5 ? '½' : '';
        return '★'.repeat(fullStars) + halfStar;
    };

    return (
        <div className="film-card">
            <Link to={`/film/${film.slug}`}>
                <img className='film-poster' loading="lazy" src={`/images/posters/${film.slug}.jpg`} alt={`${film.title} (${film.year})`} title={`${film.title} (${film.year})`} style={{ width: '100%' }} />
            </Link>
            <div className="film-info star-rating-card">
                <p className="mb-0">{getStarSymbols(film.user_a_rating)}</p>
                <p className="mb-0">{getStarSymbols(film.user_b_rating)}</p>
            </div>
        </div>
    );
};

export default FilmCardDiffer;