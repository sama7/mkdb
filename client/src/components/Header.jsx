export default function Header(props) {
    const production = 'https://mkdb.co';
    const development = 'http://localhost:5173';

    function HeaderLink(props) {
        if (import.meta.env.MODE === 'production') {
            return (
                <h1>
                    <a href={production} className="header-link">
                        Metropolis Kino Database
                    </a>
                </h1>
            );
        }
        // otherwise, we're in dev
        return (
            <h1>
                <a href={development} className="header-link">
                    Metropolis Kino Database
                </a>
            </h1>
        );
    }

    return (
        <header>
            <HeaderLink />
        </header>
    );
}