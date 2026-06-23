import Nav from 'react-bootstrap/Nav';
import Navbar from 'react-bootstrap/Navbar';
import { useNetworkFromLocation } from '../network';

function NavigationBar() {
  // Sits outside the per-route NetworkProvider, so we read the active
  // network straight off the URL. When on /lank/*, swap to lank-flavored
  // links (and drop Masterlist, which doesn't apply to the lank subset).
  const network = useNetworkFromLocation();
  const isLank = network === 'lank';

  return (
    <Navbar data-bs-theme="dark" expand="lg" className="bg-body-tertiary ps-3 pe-3" sticky="top">
        <Navbar.Brand href={isLank ? '/lank' : '/'}>
          {isLank ? 'Metropolis Kino Database (Lank)' : 'Metropolis Kino Database'}
        </Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto text-start">
            {isLank ? (
              <>
                <Nav.Link href="/lank">Home</Nav.Link>
                <Nav.Link href="/lank/new">What’s New?</Nav.Link>
                <Nav.Link href="/lank/members">Members</Nav.Link>
              </>
            ) : (
              <>
                <Nav.Link href="/">Home</Nav.Link>
                <Nav.Link href="/new">What’s New?</Nav.Link>
                <Nav.Link href="/members">Members</Nav.Link>
                <Nav.Link href="/masterlist">Masterlist</Nav.Link>
              </>
            )}
          </Nav>
        </Navbar.Collapse>
    </Navbar>
  );
}

export default NavigationBar;
