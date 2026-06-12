import { useState, useEffect } from 'react';
import FilmCard from './FilmCard';
import Filters from './Filters';
import Pagination from './Pagination';
import Spinner from 'react-bootstrap/Spinner';
import type { FilmRanking, FiltersState } from '../types';

// Top-ranked films restricted to the "lank" subset of metrodb followers.
// Mirrors FilmGridEvilMank but points at /api/lank.
const FilmGridLank = () => {
    const [films, setFilms] = useState<FilmRanking[]>([]);
    const [filters, setFilters] = useState<FiltersState>({
        minYear: undefined,
        maxYear: undefined,
        minRatings: undefined,
        maxRatings: undefined,
        genres: undefined,
    });
    const [page, setPage] = useState(1);
    const filmsPerPage = 100;
    const [totalPages, setTotalPages] = useState(10);
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
        handleResize();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useEffect(() => {
        const fetchLankFilms = async () => {
            try {
                const response = await fetch(`/api/lank?page=${page}&filters=${JSON.stringify(filters)}`);
                const rows = await response.json() as FilmRanking[];
                setFilms(rows);
                console.log(`Query returned ${rows.length} rows.`);
                if (rows.length === 0) {
                    setTotalPages(1);
                } else if (Number(rows[0].total_count) > 1000) {
                    setTotalPages(10);
                    console.log(`total_count: ${rows[0].total_count}`);
                } else {
                    setTotalPages(Math.ceil(Number(rows[0].total_count) / filmsPerPage));
                    console.log(`total_count: ${rows[0].total_count}`);
                }
            } catch (error) {
                console.error('Error fetching lank film rankings:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchLankFilms();
    }, [filters, page]);

    const handleFiltersChange = (newFilters: FiltersState) => {
        setFilters({ ...filters, ...newFilters });
        setPage(1);
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };

    if (isLoading) {
        return (
            <div className="mb-4">
                <h3 className="my-3">Top Lanked Films</h3>
                <Filters filters={filters} onFiltersChange={handleFiltersChange} />
                <Spinner data-bs-theme="dark" animation="border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
            </div>
        );
    }

    return (
        <div className="mb-4">
            <h3 className="my-3">Top Lanked Films</h3>
            <Filters filters={filters} onFiltersChange={handleFiltersChange} />
            <div className="film-grid container" style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: '5px'
            }}>
                {films.map((film) => (
                    <FilmCard key={film.slug} film={film} />
                ))}
            </div>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={handlePageChange} />
        </div>
    );
};

export default FilmGridLank;
