import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Header from './Header'; // Header component

const FilmDetails = () => {
    const { slug } = useParams();
    const [film, setFilm] = useState(null);
    const [ratings, setRatings] = useState([]);
    const [isLoading, setLoading] = useState(true); // New state for loading
    const [isNotFound, setNotFound] = useState(false); // New state for 404

    useEffect(() => {
        // Fetch film details from the backend
        const fetchFilmDetails = async () => {
            try {
                const response = await fetch(`/api/film/${slug}`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.film) {
                        setFilm(data.film);
                        setRatings(data.ratings);
                    } else {
                        setNotFound(true); // Film not found
                    }
                } else {
                    setNotFound(true); // Handle non-200 responses as a "not found"
                }
            } catch (error) {
                setNotFound(true); // In case of an error, treat it as not found
            } finally {
                setLoading(false); // Stop loading when response is received
            }
        };

        fetchFilmDetails();
    }, [slug]);

    if (isLoading) {
        return <div>Loading...</div>;
    }

    if (isNotFound) {
        return (
            <div className='film-not-found'>
                <Header />
                <p>
                    Sorry, ‘{slug}’ wasn’t found in our database. Either it’s not a valid film or none of us have rated it yet.
                    <img src="/images/icons/cat_thinking.png" alt="Cat thinking..." title="Cat thinking..." />
                </p>
            </div>
        );
    }

    // Determine the rank change
    let rankChange = null;
    if (film.current_rank && film.previous_rank) {
        const change = film.previous_rank - film.current_rank;
        if (change > 0) {
            rankChange = <span className="rank-up">▲ {change}</span>;
        } else if (change < 0) {
            rankChange = <span className="rank-down">▼ {-change}</span>;
        }
    }

    // Determine if the film is a new entry or a departure
    let rankIndicator = null;
    if (film.current_rank && !film.previous_rank) {
        rankIndicator = <img src="/images/icons/new_mank.png" alt="New entry in the MKDb Top 1000" title="New entry in the MKDb Top 1000" />;
    } else if (!film.current_rank && film.previous_rank) {
        rankIndicator = <img src="/images/icons/former_mank.png" alt="Newly departed from the MKDb Top 1000" title="Newly departed from the MKDb Top 1000" />;
    }

    // Function to convert rating to stars with symbols
    const getStarSymbols = (rating) => {
        const fullStars = Math.floor(rating);
        const halfStar = rating % 1 === 0.5 ? '½' : '';
        return '★'.repeat(fullStars) + halfStar;
    };

    return (
        <>
            <Header />
            <div className="film-details">
                <h2>{film.title} ({film.year})</h2>
                <a href={`https://letterboxd.com/film/${slug}`} target="_blank" rel="noopener noreferrer">
                    <img className='film-poster' src={`/images/posters/${slug}.jpg`} alt={`${film.title} (${film.year})`} title={`${film.title} (${film.year})`} />
                </a>
                <p><strong>Synopsis:</strong> {film.synopsis}</p>
                {/* MKDb Rank */}
                <div className="rank-section">

                    <p><span className='big-rank'>MKDb Rank: {film.current_rank ? film.current_rank : 'N/A'}</span> {rankChange}</p>
                    {rankIndicator}
                </div>
                <p><strong>Average Rating:</strong> {Number(film.average_rating).toFixed(2)}</p>
                <p><strong>Rating Count:</strong> {film.rating_count}</p>

                <h2>Community Ratings:</h2>
                {[5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5].map(star => {
                    // Filter out ratings for the current star value
                    const filteredRatings = ratings.filter(userRating => Math.round(userRating.rating * 10) / 10 === star);

                    // If there are no ratings for this star value, do not render the header and the list
                    if (filteredRatings.length === 0) {
                        return null;
                    }

                    return (
                        <div key={star}>
                            <h3 className='star-rating'>{getStarSymbols(star)}</h3>
                            <ul>
                                {filteredRatings.map(userRating => (
                                    <li key={userRating.username} className="user-list-item">
                                        <div className="user-info">
                                            <img
                                                src={`/images/avatars/${userRating.username}.jpg`}
                                                alt={`Avatar of user: ${userRating.username}`}
                                                className="user-avatar"
                                            />
                                            <span className="username">
                                                <a href={`https://letterboxd.com/${userRating.username}/film/${slug}/activity/`} target="_blank" rel="noopener noreferrer">
                                                    {userRating.username}
                                                </a>
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
            </div>
        </>
    );
};

export default FilmDetails;