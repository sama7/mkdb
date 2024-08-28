import React from 'react';

const FilmCard = ({ film }) => {
    return (
        <div className="film-card">
            <img src={`/images/posters/${film.slug}.jpg`} alt={`${film.title} (${film.year})`} title={`${film.title} (${film.year})`} style={{ width: '100%' }} />
            <div className="film-info">
                {film.ranking}
            </div>
        </div>
    );
};

export default FilmCard;