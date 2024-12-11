import React from 'react';
import { Link } from 'react-router-dom';

const FilmCardAgreed = ({ film }) => {

    // Function to convert rating to stars with symbols
    const getStarSymbols = (rating) => {
        const fullStars = Math.floor(rating);
        const halfStar = rating % 1 === 0.5 ? '½' : '';
        return '★'.repeat(fullStars) + halfStar;
    };

    return (
        <div className="film-card">
            <Link to={`/film/${film.slug}`}>
                <img className='film-poster' src={`/images/posters/${film.slug}.jpg`} alt={`${film.title} (${film.year})`} title={`${film.title} (${film.year})`} style={{ width: '100%' }} />
            </Link>
            <div className="film-info star-rating-card">
                {getStarSymbols(film.user_a_rating)}
            </div>
        </div>
    );
};

export default FilmCardAgreed;