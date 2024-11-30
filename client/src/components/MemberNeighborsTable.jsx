import Table from 'react-bootstrap/Table';
import MemberNeighborsRows from './MemberNeighborsRows';

export default function MemberNeighborsTable(props) {

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
