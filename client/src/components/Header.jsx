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

    function PuffinBirthdayBanner() {
        return (
            <div className="puffin-birthday-banner">
                <h2>
                    <img src="/images/icons/catroll.gif" alt="Pixelated cat rolling GIF" title=":catroll:" />
                    Happy birthday, 
                    <img className="puffin-avatar" src="/images/avatars/obligatory.jpg" alt="Puffin's avatar" title="Puffin's avatar" /> 
                    Puffin!
                    <img src="/images/icons/catroll.gif" alt="Pixelated cat rolling GIF" title=":catroll:" />
                </h2>
            </div>
        );
    }

    return (
        <header>
            <PuffinBirthdayBanner />
            <HeaderLink />
        </header>
    );
}