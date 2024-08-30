import React from 'react';

const FilmCard = ({ film }) => {
    return (
        <div className="film-card">
            <a href={`https://letterboxd.com/film/${film.slug}`} target="_blank" rel="noopener noreferrer">
                <img src={`/images/posters/${film.slug}.jpg`} alt={`${film.title} (${film.year})`} title={`${film.title} (${film.year})`} style={{ width: '100%' }} />
            </a>
            <div className="film-info">
                {film.ranking}
            </div>
        </div>
    );
};

export default FilmCard;