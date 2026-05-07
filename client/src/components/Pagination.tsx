import type { ChangeEvent } from 'react';

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
}

const Pagination = ({ currentPage, totalPages, onPageChange }: PaginationProps) => {
    const handlePrev = () => {
        if (currentPage > 1) onPageChange(currentPage - 1);
    };

    const handleNext = () => {
        if (currentPage < totalPages) onPageChange(currentPage + 1);
    };

    const handlePageSelect = (e: ChangeEvent<HTMLSelectElement>) => {
        const selectedPage = parseInt(e.target.value, 10);
        onPageChange(selectedPage);
    };

    return (
        <div className="pagination-section">
            <button onClick={handlePrev} disabled={currentPage === 1}>
                Back
            </button>
            <span>
                Page 
                <select
                    name="current-page-select"
                    id="current-page-select"
                    value={currentPage}
                    onChange={handlePageSelect}
                    className="page-dropdown" 
                >
                    {[...Array(totalPages).keys()].map((page) => (
                        <option key={page + 1} value={page + 1}>
                            {page + 1}
                        </option>
                    ))}
                </select>
                of {totalPages} 
            </span>
            <button onClick={handleNext} disabled={currentPage === totalPages}>
                Next
            </button>
        </div>
    );
};

export default Pagination;
