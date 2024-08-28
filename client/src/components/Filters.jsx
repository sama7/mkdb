import React, { useState } from 'react';

const Filters = ({ filters, onFiltersChange }) => {
    const [minYear, setMinYear] = useState(filters.minYear);
    const [maxYear, setMaxYear] = useState(filters.maxYear);
    const [minRatings, setMinRatings] = useState(filters.minRatings);
    const [maxRatings, setMaxRatings] = useState(filters.maxRatings);

    const handleApplyFilters = () => {
        const newFilters = {
            minYear: minYear || undefined,
            maxYear: maxYear || undefined,
            minRatings: minRatings || undefined,
            maxRatings: maxRatings || undefined,
        };
        onFiltersChange(newFilters);
    };

    return (
        <div className="filters">
            <input type="number" pattern="[0-9]*" inputMode="numeric" placeholder="Min Year" value={minYear} onChange={(e) => setMinYear(e.target.value)} />
            <input type="number" pattern="[0-9]*" inputMode="numeric" placeholder="Max Year" value={maxYear} onChange={(e) => setMaxYear(e.target.value)} />
            <input type="number" pattern="[0-9]*" inputMode="numeric" placeholder="Min Ratings" value={minRatings} onChange={(e) => setMinRatings(e.target.value)} />
            <input type="number" pattern="[0-9]*" inputMode="numeric" placeholder="Max Ratings" value={maxRatings} onChange={(e) => setMaxRatings(e.target.value)} />
            <button onClick={handleApplyFilters}>Apply Filters</button>
        </div>
    );
};

export default Filters;