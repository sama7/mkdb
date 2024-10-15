import React, { useState } from 'react';

const genresList = [
    "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama",
    "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance",
    "Science Fiction", "Thriller", "TV Movie", "War", "Western"
];

const Filters = ({ filters, onFiltersChange }) => {
    const [minYear, setMinYear] = useState(filters.minYear);
    const [maxYear, setMaxYear] = useState(filters.maxYear);
    const [minRatings, setMinRatings] = useState(filters.minRatings);
    const [maxRatings, setMaxRatings] = useState(filters.maxRatings);
    const [selectedGenres, setSelectedGenres] = useState({}); // store the selected genres state
    const [isGenreListOpen, setIsGenreListOpen] = useState(false);

    // This function will toggle between "include", "exclude", and "neutral" for genres
    const toggleGenre = (genre) => {
        const currentState = selectedGenres[genre];

        // Determine the next state and handle deletion on third click
        const newState = currentState === "include"
            ? "exclude"
            : currentState === "exclude"
                ? undefined
                : "include";

        // If the newState is undefined (i.e., third click), remove the genre from the selectedGenres object
        const updatedGenres = { ...selectedGenres };
        if (newState) {
            updatedGenres[genre] = newState;
        } else {
            delete updatedGenres[genre]; // Remove genre on third click
        }

        setSelectedGenres(updatedGenres);

        // Trigger filter update with new genre selection
        const newFilters = {
            ...filters,
            genres: updatedGenres,
        };

        onFiltersChange(newFilters);
    };

    const handleApplyFilters = () => {
        const newFilters = {
            minYear: minYear || undefined,
            maxYear: maxYear || undefined,
            minRatings: minRatings || undefined,
            maxRatings: maxRatings || undefined,
            genres: selectedGenres,
        };
        onFiltersChange(newFilters);
    };

    return (
        <div className="filters">
            <input type="number" pattern="[0-9]*" inputMode="numeric" placeholder="Min Release Year" value={minYear} onChange={(e) => setMinYear(e.target.value)} />
            <input type="number" pattern="[0-9]*" inputMode="numeric" placeholder="Max Release Year" value={maxYear} onChange={(e) => setMaxYear(e.target.value)} />
            <input type="number" pattern="[0-9]*" inputMode="numeric" placeholder="Min Rating Count" value={minRatings} onChange={(e) => setMinRatings(e.target.value)} />
            <input type="number" pattern="[0-9]*" inputMode="numeric" placeholder="Max Rating Count" value={maxRatings} onChange={(e) => setMaxRatings(e.target.value)} />
            <button onClick={handleApplyFilters}>Apply Filters</button>
            <div className="genre-filter">
                <button onClick={() => setIsGenreListOpen(!isGenreListOpen)} className="genre-dropdown-button">
                    Genre {isGenreListOpen ? '▲' : '▼'}
                </button>
                {isGenreListOpen && (
                    <ul className="genre-dropdown">
                        {genresList.map((genre) => (
                            <li
                                key={genre}
                                className={`genre-item ${selectedGenres[genre]}`}
                                onClick={() => toggleGenre(genre)}
                            >
                                {genre} {selectedGenres[genre] === 'include' ? '✔️' : selectedGenres[genre] === 'exclude' ? '🚫' : ''}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
};

export default Filters;