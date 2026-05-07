import MemberSortDropdown from './MemberSortDropdown';
import MembersTable from './MembersTable';
import Pagination from './Pagination';
import { useState } from 'react';
import { useEffect } from 'react';
import Spinner from 'react-bootstrap/Spinner';
import type { MemberSort, User } from '../types';

type MemberListRow = User & {
    total_count: string;
    num_films_watched: number;
};

export default function Members() {
    const [members, setMembers] = useState<MemberListRow[]>([]);
    const [page, setPage] = useState(1);
    const membersPerPage = 25;
    const [totalPages, setTotalPages] = useState(12);
    const [sort, setSort] = useState<MemberSort>('Watched');
    const [isLoading, setLoading] = useState(true);

    useEffect(() => {
        const fetchMembers = async () => {
            try {
                const response = await fetch(`/api/members?page=${page}&sort=${sort}`);
                const rows = await response.json() as MemberListRow[];
                setMembers(rows);
                console.log(`Query returned ${rows.length} rows.`);
                if (rows.length === 0) {
                    // empty result, but still show one page rather than zero
                    setTotalPages(1);
                } else {
                    // total_count > 0
                    setTotalPages(Math.ceil(Number(rows[0].total_count) / membersPerPage));
                    console.log(`total_count: ${rows[0].total_count}`);
                }
            } catch (error) {
                console.error('Error fetching members:', error);
            } finally {
                setLoading(false)
            }
        };
        fetchMembers();
    }, [page, sort]);

    const handleSort = (eventKey: string | null) => {
        setSort((eventKey || 'Watched') as MemberSort);
        setPage(1); // Reset to first page when sort changes
    };

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };

    if (isLoading) {
        return (
            <div className="container">
                <h3 className="my-3">Community Members</h3>
                <div className="mb-3 sort-by text-end">
                    Sort by
                    <MemberSortDropdown sort={sort} handleSort={handleSort} />
                </div>
                <Spinner data-bs-theme="dark" animation="border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
            </div>
        );
    }

    return (
        <div className="container">
            <h3 className="my-3">Community Members</h3>
            <div className="mb-3 sort-by text-end">
                Sort by
                <MemberSortDropdown sort={sort} handleSort={handleSort} />
            </div>
            <MembersTable members={members} />
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={handlePageChange} />
        </div>
    );
}
