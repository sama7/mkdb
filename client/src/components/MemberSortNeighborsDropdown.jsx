import Dropdown from 'react-bootstrap/Dropdown';

export default function MemberSortNeighborsDropdown(props) {
    return (
        <Dropdown data-bs-theme="dark" onSelect={props.handleSort} className="ms-2">
            <Dropdown.Toggle variant="secondary" id="dropdown-basic" size="sm">
                {props.sort || 'Select an option'}
            </Dropdown.Toggle>

            <Dropdown.Menu>
                <Dropdown.Item eventKey="Similarity Score">Similarity Score</Dropdown.Item>
                <Dropdown.Item eventKey="Name">Name</Dropdown.Item>
            </Dropdown.Menu>
        </Dropdown>
    );
}