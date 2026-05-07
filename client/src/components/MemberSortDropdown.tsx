import Dropdown from 'react-bootstrap/Dropdown';
import type { MemberSort } from '../types';

interface MemberSortDropdownProps {
    sort: MemberSort;
    handleSort: (eventKey: string | null) => void;
}

export default function MemberSortDropdown(props: MemberSortDropdownProps) {
    return (
        <Dropdown data-bs-theme="dark" onSelect={props.handleSort} className="ms-2">
            <Dropdown.Toggle variant="secondary" id="dropdown-basic" size="sm">
                {props.sort || 'Select an option'}
            </Dropdown.Toggle>

            <Dropdown.Menu>
                <Dropdown.Item eventKey="Watched">Watched</Dropdown.Item>
                <Dropdown.Item eventKey="Name">Name</Dropdown.Item>
            </Dropdown.Menu>
        </Dropdown>
    );
}
