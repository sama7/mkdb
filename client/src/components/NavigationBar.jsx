import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';

function NavigationBar() {
  return (
    <Navbar data-bs-theme="dark" expand="lg" className="bg-body-tertiary ps-3 pe-3" sticky="top">
        <Navbar.Brand href="/">Metropolis Kino Database</Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto text-start">
            <Nav.Link href="/">Home</Nav.Link>
            <Nav.Link href="/new">What’s New?</Nav.Link>
            <Nav.Link href="/members">Members</Nav.Link>
            <Nav.Link href="/masterlist">Masterlist</Nav.Link>
          </Nav>
        </Navbar.Collapse>
    </Navbar>
  );
}

export default NavigationBar;