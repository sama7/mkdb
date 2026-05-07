import Table from 'react-bootstrap/Table';
import MembersRows from './MembersRows';
import type { User } from '../types';

type MemberRow = User & {
    num_films_watched: number;
};

interface MembersTableProps {
    members: MemberRow[];
}

export default function MembersTable(props: MembersTableProps) {

    return (
        <Table responsive className="table table-dark">
            <thead>
                <tr>
                    <th className="name text-start" scope="col">Name</th>
                    <th className="watched" scope="col">Watched</th>
                </tr>
            </thead>
            <MembersRows
                members={props.members}
            />
        </Table>
    );
}
