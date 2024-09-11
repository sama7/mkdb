import React, { useState, useEffect } from 'react';
import Header from './Header'; // Header component
import FilmCard from './FilmCard'; // A component to display each film's poster
import Filters from './Filters'; // A component to handle filtering options
import Pagination from './Pagination'; // A component to handle pagination of films

const FilmGrid = () => {
    const [films, setFilms] = useState([]);
    const [filters, setFilters] = useState({
        minYear: undefined,
        maxYear: undefined,
        minRatings: undefined,
        maxRatings: undefined,
    });
    const [page, setPage] = useState(1);
    const filmsPerPage = 100;
    const [totalPages, setTotalPages] = useState(10);
    const [columns, setColumns] = useState(5);

    useEffect(() => {
        const handleResize = () => {
            const width = window.innerWidth;
            if (width <= 1024) {
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
        fetchFilms();
    }, [filters, page]);

    const fetchFilms = async () => {
        try {
            // You will replace this with the actual fetch from your backend
            const response = await fetch(`/api/rankings?page=${page}&filters=${JSON.stringify(filters)}`);
            const rows = await response.json();
            setFilms(rows);
            console.log(`Query returned ${rows.length} rows.`);
            if (rows.length === 0) {
                // empty result, but still show one page rather than zero
                setTotalPages(1);
            } else if (rows[0].total_count > 1000) {
                // don't want to display more than 10 pages even if 1,001 results
                setTotalPages(10);
                console.log(`total_count: ${rows[0].total_count}`);
            } else {
                // total_count > 0 and <= 1000
                setTotalPages(Math.ceil(rows[0].total_count / filmsPerPage));
                console.log(`total_count: ${rows[0].total_count}`);
            }
        } catch (error) {
            console.error('Error fetching film rankings:', error);
        }
    };

    const handleFiltersChange = (newFilters) => {
        setFilters({ ...filters, ...newFilters });
        setPage(1); // Reset to first page when filters change
    };

    const handlePageChange = (newPage) => {
        setPage(newPage);
    };

    return (
        <div>
            <Header />
            <h2>Top Ranked Films</h2>
            <Filters filters={filters} onFiltersChange={handleFiltersChange} />
            <div className="film-grid" style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: '5px'  /* reduce gap between items */
            }}>
                {films.map((film) => (
                    <FilmCard key={film.slug} film={film} />
                ))}
            </div>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={handlePageChange} />
        </div>
    );
};

export default FilmGrid;