import React, { useState, useEffect } from 'react';
import FilmCardRisers from './FilmCardRisers'; // A component to display each film's poster
import Spinner from 'react-bootstrap/Spinner';

const FilmGridRisers = (props) => {
    const [films, setFilms] = useState([]);
    const [columns, setColumns] = useState(5);
    const [isLoading, setLoading] = useState(true);

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
        if (props.id === 'greatest-risers') {
            fetchFilmRisers();
        }
    }, [props.id]);

    const fetchFilmRisers = async () => {
        try {
            const response = await fetch(`/api/risers`);
            const rows = await response.json();
            setFilms(rows);
            console.log(`Query returned ${rows.length} rows.`);
        } catch (error) {
            console.error("Error fetching film risers' rankings:", error);
        } finally {
            setLoading(false);
        }
    };

    if (isLoading) {
        return (
            <div>
                <Spinner data-bs-theme="dark" animation="border" role="status" className="mt-3">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
            </div>
        );
    }

    return (
        <div className="film-grid container mt-2 mb-4" style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            gap: '5px'  /* reduce gap between items */
        }}>
            {films.map((film) => (
                <FilmCardRisers key={film.slug} film={film} />
            ))}
        </div>
    );
};

export default FilmGridRisers;