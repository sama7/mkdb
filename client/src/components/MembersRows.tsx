import { Link } from "react-router-dom";
import type { User } from '../types';
import { useNetwork } from '../network';
import { formatCount } from '../format';

type MemberRow = User & {
    num_films_watched: number | null;
};

interface MembersRowsProps {
    members: MemberRow[];
}

export default function MembersRows(props: MembersRowsProps) {
    const { urlBase } = useNetwork();

    const members = props.members?.map((member, index: number) => {
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
                            <Link to={`${urlBase}/members/${member.username}`}>
                                {member.display_name}
                            </Link>
                        </span>
                    </div>
                </td>
                <td className="align-middle icon-watched">
                    <div className="watched-cell">
                        <span className="icon"></span>
                        {formatCount(member.num_films_watched)}
                    </div>
                </td>
            </tr>
        )
    });
    return (
        <tbody>
            {members}
        </tbody>
    );
}
