import { Link } from 'react-router-dom';
import CircleProgress from './CircleProgress';

export default function MemberNeighborsRows(props) {

    const neighbors = props.neighbors?.map((neighbor, index) => {
        return (
            <tr key={index}>
                <td className="align-middle">
                    <div className="user-info">
                        <img
                            src={`/images/avatars/${neighbor.neighbor_username}.jpg`}
                            alt={`Avatar of user: ${neighbor.neighbor_username}`}
                            className="user-avatar"
                        />
                        <span className="username">
                            <Link to={`/members/${neighbor.user_a}/${neighbor.neighbor_username}`}>
                                {neighbor.neighbor_display_name}
                            </Link>
                        </span>
                    </div>
                </td>
                <td className="align-middle">
                    <div className="watched-cell">
                        <CircleProgress percentage={Math.round(Number(neighbor.similarity_score).toFixed(2) * 100)} />
                    </div>
                </td>
            </tr>
        )
    });
    return (
        <tbody>
            {neighbors}
        </tbody>
    );
}