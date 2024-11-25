import React, { useState, useEffect } from 'react';
import FilmCardFallers from './FilmCardFallers'; // A component to display each film's poster

const FilmGridFallers = (props) => {
    const [films, setFilms] = useState([]);
    const [columns, setColumns] = useState(5);

    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth;
            if (width <= 991) {
                setColumns(4);
            } else {
                setColumns(5);
            }
        };
        handleResize(); // Set initial columns count
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        if (props.id === 'greatest-fallers') {
            fetchFilmFallers();
        }
    }, [props.id]);

    const fetchFilmFallers = async () => {
        try {
            const response = await fetch(`/api/fallers`);
            const rows = await response.json();
            setFilms(rows);
            console.log(`Query returned ${rows.length} rows.`);
        } catch (error) {
            console.error("Error fetching film fallers' rankings:", error);
        }
    };

    return (
        <div className="film-grid container mt-2 mb-4" style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: '5px'  /* reduce gap between items */
        }}>
            {films.map((film) => (
                <FilmCardFallers key={film.slug} film={film} />
            ))}
        </div>
    );
};

export default FilmGridFallers;