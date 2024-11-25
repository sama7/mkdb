import React, { useState, useEffect } from 'react';
import FilmCardNewEntries from './FilmCardNewEntries'; // A component to display each film's poster
import FilmCard from './FilmCard';

const FilmGridNewEntries = (props) => {
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
        if (props.id === 'new-entries') {
            fetchFilmNewEntries();
        }
    }, [props.id]);

    const fetchFilmNewEntries = async () => {
        try {
            const response = await fetch(`/api/new-entries`);
            const rows = await response.json();
            setFilms(rows);
            console.log(`Query returned ${rows.length} rows.`);
        } catch (error) {
            console.error("Error fetching film new entries' rankings:", error);
        }
    };

    return (
        <div className="film-grid container mt-2 mb-4" style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: '5px'  /* reduce gap between items */
        }}>
            {films.map((film) => (
                <FilmCardNewEntries key={film.slug} film={film} />
            ))}
        </div>
    );
};

export default FilmGridNewEntries;