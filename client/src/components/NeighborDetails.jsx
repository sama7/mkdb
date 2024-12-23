import { Link } from 'react-router-dom';
import Pagination from './Pagination';
import { useParams } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
import Spinner from 'react-bootstrap/Spinner';
import CircleProgress from './CircleProgress';
import FilmCardAgreed from './FilmCardAgreed';
import FilmCardDiffer from './FilmCardDiffer';

export function usePrevious(value) {
    const ref = useRef();
    useEffect(() => {
        ref.current = value;
    }, [value]);
    return ref.current;
}

export default function NeighborDetails() {
    const { username_a, username_b } = useParams();
    const [firstMember, setFirstMember] = useState(null);
    const [firstMemberNotFound, setFirstMemberNotFound] = useState(false);
    const [firstMemberNoRatings, setFirstMemberNoRatings] = useState(false);
    const [secondMember, setSecondMember] = useState(null);
    const [secondMemberNotFound, setSecondMemberNotFound] = useState(false);
    const [secondMemberNoRatings, setSecondMemberNoRatings] = useState(false);
    const [similarityScore, setSimilarityScore] = useState(null);
    const [overlapCount, setOverlapCount] = useState(null);
    const [avgRatingDistance, setAvgRatingDistance] = useState(null);
    const [agreedFilms, setAgreedFilms] = useState([]);
    const [agreedPage, setAgreedPage] = useState(1);
    const [differFilms, setDifferFilms] = useState([]);
    const [differPage, setDifferPage] = useState(1);
    const filmsPerPage = 20;
    const [agreedTotalPages, setAgreedTotalPages] = useState(null);
    const [differTotalPages, setDifferTotalPages] = useState(null);
    const [columns, setColumns] = useState(5);
    const [firstMemberLoading, setFirstMemberLoading] = useState(true);
    const [secondMemberLoading, setSecondMemberLoading] = useState(true);
    const [neighborDetailsLoading, setNeighborDetailsLoading] = useState(true);
    const [neighborAgreedFilmsLoading, setNeighborAgreedFilmsLoading] = useState(true);
    const [neighborDifferFilmsLoading, setNeighborDifferFilmsLoading] = useState(true);

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
        setFirstMemberLoading(true);
        fetchFirstMemberDetails();
    }, [username_a]);

    useEffect(() => {
        setSecondMemberLoading(true);
        fetchSecondMemberDetails();
    }, [username_b]);

    useEffect(() => {
        setNeighborDetailsLoading(true);
        fetchNeighborDetails();
    }, [username_a, username_b]);

    useEffect(() => {
        fetchNeighborAgreedFilms();
    }, [username_a, username_b, agreedPage]);

    useEffect(() => {
        fetchNeighborDifferFilms();
    }, [username_a, username_b, differPage])

    const fetchFirstMemberDetails = async () => {
        try {
            const response = await fetch(`/api/members/${username_a}`);
            if (response.ok) {
                const data = await response.json();
                if (data) {
                    setFirstMember(data);
                    if (!data.avg_rating) {
                        setFirstMemberNoRatings(true);
                    }
                } else {
                    setFirstMemberNotFound(true); // Member not found
                }
            } else {
                setFirstMemberNotFound(true); // Handle non-200 responses as a "not found"
            }
        } catch (error) {
            console.error('Error fetching first member details:', error);
            setFirstMemberNotFound(true); // In case of an error, treat it as not found
        } finally {
            setFirstMemberLoading(false);
        }
    };

    const fetchSecondMemberDetails = async () => {
        try {
            const response = await fetch(`/api/members/${username_b}`);
            if (response.ok) {
                const data = await response.json();
                if (data) {
                    setSecondMember(data);
                    if (!data.avg_rating) {
                        setSecondMemberNoRatings(true);
                    }
                } else {
                    setSecondMemberNotFound(true); // Member not found
                }
            } else {
                setSecondMemberNotFound(true); // Handle non-200 responses as a "not found"
            }
        } catch (error) {
            console.error('Error fetching second member details:', error);
            setSecondMemberNotFound(true); // In case of an error, treat it as not found
        } finally {
            setSecondMemberLoading(false);
        }
    };

    const fetchNeighborDetails = async () => {
        try {
            const response = await fetch(`/api/neighbors/${username_a}/${username_b}`);
            const data = await response.json();
            if (data.similarity_score) {
                setSimilarityScore(data.similarity_score);
                setOverlapCount(data.overlap_count);
                setAvgRatingDistance(data.avg_rating_distance);
            }
        } catch (error) {
            console.error('Error fetching neighbor details:', error);
        } finally {
            setNeighborDetailsLoading(false);
        }
    };

    const fetchNeighborAgreedFilms = async () => {
        try {
            const response = await fetch(`/api/neighbors-agreed/${username_a}/${username_b}?page=${agreedPage}`);
            const rows = await response.json();
            setAgreedFilms(rows);
            console.log(`Agreed films query returned ${rows.length} rows.`);
            if (rows.length === 0) {
                // empty result, but still show one page rather than zero
                setAgreedTotalPages(1);
            } else {
                // total_count > 0
                setAgreedTotalPages(Math.ceil(rows[0].total_count / filmsPerPage));
                console.log(`Agreed films total_count: ${rows[0].total_count}`);
            }
        } catch (error) {
            console.error('Error fetching neighbor agreed films:', error);
        } finally {
            setNeighborAgreedFilmsLoading(false);
        }
    };

    const fetchNeighborDifferFilms = async () => {
        try {
            const response = await fetch(`/api/neighbors-differ/${username_a}/${username_b}?page=${differPage}`);
            const rows = await response.json();
            setDifferFilms(rows);
            console.log(`Differ films query returned ${rows.length} rows.`);
            if (rows.length === 0) {
                // empty result, but still show one page rather than zero
                setDifferTotalPages(1);
            } else {
                // total_count > 0
                setDifferTotalPages(Math.ceil(rows[0].total_count / filmsPerPage));
                console.log(`Differ films total_count: ${rows[0].total_count}`);
            }
        } catch (error) {
            console.error('Error fetching neighbor differ films:', error);
        } finally {
            setNeighborDifferFilmsLoading(false);
        }
    };

    const handleAgreedPageChange = (newPage) => {
        setAgreedPage(newPage);
    };

    const handleDifferPageChange = (newPage) => {
        setDifferPage(newPage);
    };

    const getSimilarityString = (similarity_score) => {
        if (similarity_score > 100 || similarity_score < 0) {
            return null; // invalid
        } else if (similarity_score >= 90) {
            return 'extremely similar!';
        } else if (similarity_score >= 70) {
            return 'very similar!';
        } else if (similarity_score >= 50) {
            return 'moderately similar.';
        } else if (similarity_score >= 30) {
            return 'slightly similar.';
        } else if (similarity_score >= 0) {
            return 'hardly similar.';
        }
        return null;
    };

    const avgRatingString = (avg_rating) => {
        if (avg_rating > 0) {
            return `Average rating: ${avg_rating} / 5`;
        }
        return '';
    }

    const areString = (number) => {
        if (number === 1) {
            return 'is';
        }
        return 'are';
    }

    const filmString = (number) => {
        if (number === 1) {
            return 'film';
        }
        return 'films';
    }

    const thoseString = (number) => {
        if (number === 1) {
            return 'that 1';
        }
        return 'those';
    }

    if (firstMemberLoading || secondMemberLoading || neighborDetailsLoading || neighborAgreedFilmsLoading || neighborDifferFilmsLoading) {
        return (
            <div className="container">
                <Spinner data-bs-theme="dark" animation="border" role="status" className="mt-3">
                    <span className="visually-hidden">Loading...</span>
                </Spinner>
            </div>
        );
    }

    if (firstMemberNotFound && secondMemberNotFound) {
        return (
            <div className='member-not-found film-details container'>
                <p>
                    Sorry, ‘{username_a}’ and ‘{username_b}’ weren’t found in our database. Either they’re not valid usernames or the accounts aren’t being tracked by us. Please contact vgrd to get added to our community’s following list.
                    <img src="/images/icons/catbless.png" alt="Blessed by cat" title="Blessed by cat" />
                </p>
            </div>
        );
    }

    if (firstMemberNotFound) {
        return (
            <div className='member-not-found film-details container'>
                <p>
                    Sorry, ‘{username_a}’ wasn’t found in our database. Either it’s not a valid username or the account isn’t being tracked by us. Please contact vgrd to get added to our community’s following list.
                    <img src="/images/icons/catbless.png" alt="Blessed by cat" title="Blessed by cat" />
                </p>
            </div>
        );
    }

    if (secondMemberNotFound) {
        return (
            <div className='member-not-found film-details container'>
                <p>
                    Sorry, ‘{username_b}’ wasn’t found in our database. Either it’s not a valid username or the account isn’t being tracked by us. Please contact vgrd to get added to our community’s following list.
                    <img src="/images/icons/catbless.png" alt="Blessed by cat" title="Blessed by cat" />
                </p>
            </div>
        );
    }

    if (firstMemberNoRatings || secondMemberNoRatings) {
        return (
            <div className="container">
                <div className="my-4 text-start">
                    <p>Let’s compare:</p>
                </div>
                <div className="mt-5 mb-4 text-center user-title">
                    <img
                        src={`/images/avatars/${firstMember?.username}-large.jpg`}
                        alt={`Large avatar of user: ${firstMember?.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <Link to={`/members/${firstMember?.username}`}>
                                {firstMember?.display_name}
                            </Link>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {firstMember?.num_films_watched.toLocaleString()}
                        </div>
                        <div>
                            {avgRatingString(Number(firstMember?.avg_rating).toFixed(2))}
                        </div>
                    </div>
                </div>
                <div>
                    <p>+</p>
                </div>
                <div className="mt-4 mb-5 text-center user-title">
                    <img
                        src={`/images/avatars/${secondMember?.username}-large.jpg`}
                        alt={`Large avatar of user: ${secondMember?.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <Link to={`/members/${secondMember?.username}`}>
                                {secondMember?.display_name}
                            </Link>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {secondMember?.num_films_watched.toLocaleString()}
                        </div>
                        <div>
                            {avgRatingString(Number(secondMember?.avg_rating).toFixed(2))}
                        </div>
                    </div>
                </div>
                <div className="mt-4 mb-5 text-start">
                    <p>
                        Sorry, at least one of the members above have not rated any films. We won’t be able to calculate a similarity score or compare the films they rated.
                    </p>
                </div>
            </div>
        );
    }

    if (agreedFilms.length === 0) {
        return (
            <div className="container">
                <div className="my-4 text-start">
                    <p>Let’s compare:</p>
                </div>
                <div className="mt-5 mb-4 text-center user-title">
                    <img
                        src={`/images/avatars/${firstMember?.username}-large.jpg`}
                        alt={`Large avatar of user: ${firstMember?.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <Link to={`/members/${firstMember?.username}`}>
                                {firstMember?.display_name}
                            </Link>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {firstMember?.num_films_watched.toLocaleString()}
                        </div>
                        <div>
                            {avgRatingString(Number(firstMember?.avg_rating).toFixed(2))}
                        </div>
                    </div>
                </div>
                <div>
                    <p>+</p>
                </div>
                <div className="mt-4 mb-5 text-center user-title">
                    <img
                        src={`/images/avatars/${secondMember?.username}-large.jpg`}
                        alt={`Large avatar of user: ${secondMember?.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <Link to={`/members/${secondMember?.username}`}>
                                {secondMember?.display_name}
                            </Link>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {secondMember?.num_films_watched.toLocaleString()}
                        </div>
                        <div>
                            {avgRatingString(Number(secondMember?.avg_rating).toFixed(2))}
                        </div>
                    </div>
                </div>
                <div className="my-4 text-start">
                    <p>
                        There {areString(Number(overlapCount))} {Number(overlapCount)?.toLocaleString()} {filmString(Number(overlapCount))} that both of them have seen and rated. Out of {thoseString(Number(overlapCount))}, they didn’t agree on the rating of any.
                    </p>
                </div>
                <div className="my-4 text-start">
                    <p>
                        Let’s look at the remaining {Number(differFilms[0]?.total_count)?.toLocaleString()} {filmString(Number(differFilms[0]?.total_count))}, sorted from smallest rating difference to largest rating difference. The rating on top belongs
                        to <strong>{firstMember?.display_name}</strong> and the rating on the bottom belongs to <strong>{secondMember?.display_name}</strong>:
                    </p>
                </div>
                <div>
                    <div className="film-grid container" style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                        gap: '5px'  /* reduce gap between items */
                    }}>
                        {differFilms.map((film) => (
                            <FilmCardDiffer key={film.slug} film={film} />
                        ))}
                    </div>
                    <Pagination currentPage={differPage} totalPages={differTotalPages} onPageChange={handleDifferPageChange} />
                </div>
                <div className="my-4 text-start">
                    <p>
                        On average, their difference in ratings of films they have both seen is {Number(avgRatingDistance).toFixed(2)} stars.
                    </p>
                </div>
                <div className="my-4 score-details">
                    Similarity Score:
                    <span>
                        <CircleProgress percentage={Math.round(Number(similarityScore).toFixed(2) * 100)} />
                    </span>
                </div>
                <div className="mt-4 mb-5 text-start">
                    <p>
                        According to their Letterboxd ratings, their tastes in film are {getSimilarityString(Number(similarityScore).toFixed(2) * 100)}
                    </p>
                </div>
            </div>
        );
    }

    if (differFilms.length === 0) {
        return (
            <div className="container">
                <div className="my-4 text-start">
                    <p>Let’s compare:</p>
                </div>
                <div className="mt-5 mb-4 text-center user-title">
                    <img
                        src={`/images/avatars/${firstMember?.username}-large.jpg`}
                        alt={`Large avatar of user: ${firstMember?.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <Link to={`/members/${firstMember?.username}`}>
                                {firstMember?.display_name}
                            </Link>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {firstMember?.num_films_watched.toLocaleString()}
                        </div>
                        <div>
                            {avgRatingString(Number(firstMember?.avg_rating).toFixed(2))}
                        </div>
                    </div>
                </div>
                <div>
                    <p>+</p>
                </div>
                <div className="mt-4 mb-5 text-center user-title">
                    <img
                        src={`/images/avatars/${secondMember?.username}-large.jpg`}
                        alt={`Large avatar of user: ${secondMember?.username}`}
                        className="user-avatar-large"
                    />
                    <div className="username-and-watched">
                        <div className="username">
                            <Link to={`/members/${secondMember?.username}`}>
                                {secondMember?.display_name}
                            </Link>
                        </div>
                        <div className="watched-cell">
                            <span className="icon"></span>
                            {secondMember?.num_films_watched.toLocaleString()}
                        </div>
                        <div>
                            {avgRatingString(Number(secondMember?.avg_rating).toFixed(2))}
                        </div>
                    </div>
                </div>
                <div className="my-4 text-start">
                    <p>
                        There {areString(Number(overlapCount))} {Number(overlapCount)?.toLocaleString()} {filmString(Number(overlapCount))} that both of them have seen and rated. Out of {thoseString(Number(overlapCount))}, they agreed on the rating
                        of {Number(agreedFilms[0]?.total_count)?.toLocaleString()} {filmString(Number(agreedFilms[0]?.total_count))}:
                    </p>
                </div>
                <div>
                    <div className="film-grid container" style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                        gap: '5px'  /* reduce gap between items */
                    }}>
                        {agreedFilms.map((film) => (
                            <FilmCardAgreed key={film.slug} film={film} />
                        ))}
                    </div>
                    <Pagination currentPage={agreedPage} totalPages={agreedTotalPages} onPageChange={handleAgreedPageChange} />
                </div>
                <div className="my-4 text-start">
                    <p>
                        On average, their difference in ratings of films they have both seen is {Number(avgRatingDistance).toFixed(2)} stars.
                    </p>
                </div>
                <div className="my-4 score-details">
                    Similarity Score:
                    <span>
                        <CircleProgress percentage={Math.round(Number(similarityScore).toFixed(2) * 100)} />
                    </span>
                </div>
                <div className="mt-4 mb-5 text-start">
                    <p>
                        According to their Letterboxd ratings, their tastes in film are {getSimilarityString(Number(similarityScore).toFixed(2) * 100)}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <div className="my-4 text-start">
                <p>Let’s compare:</p>
            </div>
            <div className="mt-5 mb-4 text-center user-title">
                <img
                    src={`/images/avatars/${firstMember?.username}-large.jpg`}
                    alt={`Large avatar of user: ${firstMember?.username}`}
                    className="user-avatar-large"
                />
                <div className="username-and-watched">
                    <div className="username">
                        <Link to={`/members/${firstMember?.username}`}>
                            {firstMember?.display_name}
                        </Link>
                    </div>
                    <div className="watched-cell">
                        <span className="icon"></span>
                        {firstMember?.num_films_watched.toLocaleString()}
                    </div>
                    <div>
                        {avgRatingString(Number(firstMember?.avg_rating).toFixed(2))}
                    </div>
                </div>
            </div>
            <div>
                <p>+</p>
            </div>
            <div className="mt-4 mb-5 text-center user-title">
                <img
                    src={`/images/avatars/${secondMember?.username}-large.jpg`}
                    alt={`Large avatar of user: ${secondMember?.username}`}
                    className="user-avatar-large"
                />
                <div className="username-and-watched">
                    <div className="username">
                        <Link to={`/members/${secondMember?.username}`}>
                            {secondMember?.display_name}
                        </Link>
                    </div>
                    <div className="watched-cell">
                        <span className="icon"></span>
                        {secondMember?.num_films_watched.toLocaleString()}
                    </div>
                    <div>
                        {avgRatingString(Number(secondMember?.avg_rating).toFixed(2))}
                    </div>
                </div>
            </div>
            <div className="my-4 text-start">
                <p>
                    There {areString(Number(overlapCount))} {Number(overlapCount)?.toLocaleString()} {filmString(Number(overlapCount))} that both of them have seen and rated. Out of {thoseString(Number(overlapCount))}, they agreed on the rating
                    of {Number(agreedFilms[0]?.total_count)?.toLocaleString()} {filmString(Number(agreedFilms[0]?.total_count))}:
                </p>
            </div>
            <div>
                <div className="film-grid container" style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: '5px'  /* reduce gap between items */
                }}>
                    {agreedFilms.map((film) => (
                        <FilmCardAgreed key={film.slug} film={film} />
                    ))}
                </div>
                <Pagination currentPage={agreedPage} totalPages={agreedTotalPages} onPageChange={handleAgreedPageChange} />
            </div>
            <div className="my-4 text-start">
                <p>
                    Let’s look at the remaining {Number(differFilms[0]?.total_count)?.toLocaleString()} {filmString(Number(overlapCount))}, sorted from smallest rating difference to largest rating difference. The rating on top belongs to <strong>{firstMember?.display_name}</strong> and
                    the rating on the bottom belongs to <strong>{secondMember?.display_name}</strong>:
                </p>
            </div>
            <div>
                <div className="film-grid container" style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                    gap: '5px'  /* reduce gap between items */
                }}>
                    {differFilms.map((film) => (
                        <FilmCardDiffer key={film.slug} film={film} />
                    ))}
                </div>
                <Pagination currentPage={differPage} totalPages={differTotalPages} onPageChange={handleDifferPageChange} />
            </div>
            <div className="my-4 text-start">
                <p>
                    On average, their difference in ratings of films they have both seen is {Number(avgRatingDistance).toFixed(2)} stars.
                </p>
            </div>
            <div className="my-4 score-details">
                Similarity Score:
                <span>
                    <CircleProgress percentage={Math.round(Number(similarityScore).toFixed(2) * 100)} />
                </span>
            </div>
            <div className="mt-4 mb-5 text-start">
                <p>
                    According to their Letterboxd ratings, their tastes in film are {getSimilarityString(Number(similarityScore).toFixed(2) * 100)}
                </p>
            </div>
        </div>
    );
}