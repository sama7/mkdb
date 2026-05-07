import Table from 'react-bootstrap/Table';
import MemberNeighborsRows from './MemberNeighborsRows';
import type { NeighborSummary } from '../types';

interface MemberNeighborsTableProps {
    neighbors: NeighborSummary[];
}

export default function MemberNeighborsTable(props: MemberNeighborsTableProps) {

    return (
        <Table responsive className="table table-dark">
            <thead>
                <tr>
                    <th className="name text-start" scope="col">Name</th>
                    <th className="similarity-score" scope="col">Similarity Score</th>
                </tr>
            </thead>
            <MemberNeighborsRows
                neighbors={props.neighbors}
            />
        </Table>
    );
}
