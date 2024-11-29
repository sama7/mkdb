import Table from 'react-bootstrap/Table';
import MembersRows from './MembersRows';

export default function MembersTable(props) {

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
