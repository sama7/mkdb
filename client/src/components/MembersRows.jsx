export default function MembersRows(props) {

    const tracks = props.members?.map((member, index) => {
        return (
            <tr key={index}>
                <td className="align-middle">
                    <div className="user-info">
                        <img
                            src={`/images/avatars/${member.username}.jpg`}
                            alt={`Avatar of user: ${member.username}`}
                            className="user-avatar"
                        />
                        <span className="username">
                            <a href={`https://letterboxd.com/${member.username}`} target="_blank" rel="noopener noreferrer">
                                {member.display_name}
                            </a>
                        </span>
                    </div>
                </td>
                <td className="align-middle icon-watched">
                    <div className="watched-cell">
                        <span className="icon"></span>
                        {member.num_films_watched.toLocaleString()}
                    </div>
                </td>
            </tr>
        )
    });
    return (
        <tbody>
            {tracks}
        </tbody>
    );
}
