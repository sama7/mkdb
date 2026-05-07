import Pagination from './Pagination';
import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Spinner from 'react-bootstrap/Spinner';
import MemberNeighborsTable from './MemberNeighborsTable';
import MemberSortNeighborsDropdown from './MemberSortNeighborsDropdown';
import type { Member, NeighborSort, NeighborSummary } from '../types';

export default function MemberDetails() {
    const { username } = useParams();
    const [member, setMember] = useState<Member | null>(null);
    const [isNotFound, setNotFound] = useState(false);
    const [hasNoRatings, setNoRatings] = useState(false);
    const [memberNeighbors, setMemberNeighbors] = useState<NeighborSummary[]>([]);
    const [page, setPage] = useState(1);
    const membersPerPage = 25;
    const [totalPages, setTotalPages] = useState<number | null>(null);
    const [sort, setSort] = useState<NeighborSort>('Similarity Score');
    const [memberLoading, setMemberLoading] = useState(true);
    const [neighborsLoading, setNeighborsLoading] = useState(true);

    useEffect(() => {
        setMemberLoading(true);
        const fetchMemberDetails = async () => {
            try {
                const response = await fetch(`/api/members/${username}`);
                if (response.ok) {
                    const data = await response.json() as Member | null;
                    if (data) {
                        setMember(data);
                    } else {
                        setNotFound(true); // Member not found
                    }
                } else {
                    setNotFound(true); // Handle non-200 responses as a "not found"
                }
            } catch (error) {
                console.error('Error fetching member details:', error);
                setNotFound(true); // In case of an error, treat it as not found
            } finally {
                setMemberLoading(false);
            }
        };
        fetchMemberDetails();
    }, [username]);

    // When username changes, reset pagination + sort to defaults so the new
    // member always opens at page 1, sorted by similarity. This runs alongside
    // the fetch effect below; it's split because the fetch depends on page+sort
    // too (so the rule needs them in deps), but resetting them only depends on
    // username. Worst case is one wasted fetch with stale page/sort right after
    // navigation; React batches the resets so it's a single extra request.
    useEffect(() => {
        setPage(1);
        setSort('Similarity Score');
        setTotalPages(null);
        setNeighborsLoading(true);
    }, [username]);

    useEffect(() => {
        const fetchMemberNeighbors = async () => {
            try {
                const response = await fetch(`/api/member/${username}?page=${page}&sort=${sort}`);
                const rows = await response.json() as NeighborSummary[];
                setMemberNeighbors(rows);
                console.log(`Query returned ${rows.length} rows.`);
                if (rows.length === 0) {
                    setNoRatings(true);
                } else {
                    // total_count > 0
                    setTotalPages(Math.ceil(Number(rows[0].total_count) / membersPerPage));
                    console.log(`total_count: ${rows[0].total_count}`);
                }
            } catch (error) {
                console.error('Error fetching member neighbors:', error);
            } finally {
                setNeighborsLoading(false);
            }
        };
        fetchMemberNeighbors();
    }, [username, page, sort]);

    const handleSort = (eventKey: string | null) => {
        setNeighborsLoading(true);
        setSort((eventKey || 'Similarity Score') as NeighborSort);
        setPage(1); // Reset to first page when sort changes
    };

    const handlePageChange = (newPage: number) => {
        setNeighborsLoading(true);
        setPage(newPage);
    };

    if (memberLoading && neighborsLoading) {
        return (
            <div className="container">
                <Spinner data-bs-theme="dark" animation="border" role="status" className="mt-3">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
                <h3 className="mt-5 mb-3">Community Neighbors</h3>
                <div className="mb-3 sort-by text-end">
                    Sort by
                    <MemberSortNeighborsDropdown sort={sort} handleSort={handleSort} />
                </div>
                <Spinner data-bs-theme="dark" animation="border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
            </div>
        );
    }

    if (isNotFound) {
        return (
            <div className='member-not-found film-details container'>
                <p>
                    Sorry, ‘{username}’ wasn’t found in our database. Either it’s not a valid username or the account isn’t being tracked by us. Please contact vgrd to get added to our community’s following list.
                    <img src="/images/icons/catbless.png" alt="Blessed by cat" title="Blessed by cat" />
                </p>
            </div>
        );
    }

    if (!memberLoading && member && neighborsLoading && !totalPages) {
        return (
            <div className="container">
                <div className="mt-3 text-center user-title">
                    <img
                        src={`/images/avatars/${member.username}-large.jpg`}
                        alt={`Large avatar of user: ${member.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <a href={`https://letterboxd.com/${member.username}`} target="_blank" rel="noopener noreferrer">
                                {member.display_name}
                            </a>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {member.num_films_watched.toLocaleString()}
                        </div>
                    </div>
                </div>
                <h3 className="mt-5 mb-3">Community Neighbors</h3>
                <div className="mb-3 sort-by text-end">
                    Sort by
                    <MemberSortNeighborsDropdown sort={sort} handleSort={handleSort} />
                </div>
                <Spinner data-bs-theme="dark" animation="border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
            </div >
        );
    }

    if (!memberLoading && member && neighborsLoading && totalPages) {
        return (
            <div className="container">
                <div className="mt-3 text-center user-title">
                    <img
                        src={`/images/avatars/${member.username}-large.jpg`}
                        alt={`Large avatar of user: ${member.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <a href={`https://letterboxd.com/${member.username}`} target="_blank" rel="noopener noreferrer">
                                {member.display_name}
                            </a>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {member.num_films_watched.toLocaleString()}
                        </div>
                    </div>
                </div>
                <h3 className="mt-5 mb-3">Community Neighbors</h3>
                <div className="mb-3 sort-by text-end">
                    Sort by
                    <MemberSortNeighborsDropdown sort={sort} handleSort={handleSort} />
                </div>
                <Spinner data-bs-theme="dark" animation="border" role="status">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={handlePageChange} />
            </div >
        );
    }

    if (hasNoRatings && member) {
        return (
            <div className="container">
                <div className="mt-3 text-center user-title">
                    <img
                        src={`/images/avatars/${member.username}-large.jpg`}
                        alt={`Large avatar of user: ${member.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <a href={`https://letterboxd.com/${member.username}`} target="_blank" rel="noopener noreferrer">
                                {member.display_name}
                            </a>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {member.num_films_watched.toLocaleString()}
                        </div>
                    </div>
                </div>
                <h3 className="mt-5 mb-3">Community Neighbors</h3>
                <div className="mb-3 sort-by text-end">
                    Sort by
                    <MemberSortNeighborsDropdown sort={sort} handleSort={handleSort} />
                </div>
                <p className="text-start">
                    Sorry, we aren’t able to calculate neighbors for this member. It looks like they haven’t rated any films yet.
                </p>
            </div>
        );
    }

    return (
        <div className="container">
            <div className="mt-3 text-center user-title">
                <img
                    src={`/images/avatars/${member?.username}-large.jpg`}
                    alt={`Large avatar of user: ${member?.username}`}
                    className="user-avatar-large"
                />
                <div className="username-and-watched">
                    <div className="username">
                        <a href={`https://letterboxd.com/${member?.username}`} target="_blank" rel="noopener noreferrer">
                            {member?.display_name}
                        </a>
                    </div>
                    <div className="watched-cell">
                        <span className="icon"></span>
                        {member?.num_films_watched.toLocaleString()}
                    </div>
                    <div>
                        Average rating: {Number(member?.avg_rating).toFixed(2)} / 5
                    </div>
                </div>
            </div>
            <h3 className="mt-5 mb-3">Community Neighbors</h3>
            <div className="mb-3 sort-by text-end">
                Sort by
                <MemberSortNeighborsDropdown sort={sort} handleSort={handleSort} />
            </div>
            <MemberNeighborsTable neighbors={memberNeighbors} />
            <Pagination currentPage={page} totalPages={totalPages || 1} onPageChange={handlePageChange} />
        </div>
    );
}
