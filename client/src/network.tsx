import { createContext, useContext, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

// Network discriminator: 'metro' for the default mkdb experience, 'lank' for
// the lycandb subset surfaced under /lank/*. Context propagates the active
// network from App.tsx's <Route> tree down to leaf components so each can
// build the correct API URL (/api/... vs /api/lank/...) and the correct link
// target (/film/x vs /lank/film/x) without prop-drilling.
export type Network = 'metro' | 'lank';

interface NetworkPaths {
    network: Network;
    apiBase: string;     // prepend to API paths — '/api' or '/api/lank'
    urlBase: string;     // prepend to internal links — '' or '/lank'
    homeUrl: string;     // top-of-this-network URL — '/' or '/lank'
    homeApi: string;     // top-of-this-network rankings API — '/api/rankings' or '/api/lank'
}

const NetworkContext = createContext<Network>('metro');

export function NetworkProvider({ network, children }: { network: Network; children: ReactNode }) {
    return <NetworkContext.Provider value={network}>{children}</NetworkContext.Provider>;
}

export function useNetwork(): NetworkPaths {
    const network = useContext(NetworkContext);
    if (network === 'lank') {
        return {
            network,
            apiBase: '/api/lank',
            urlBase: '/lank',
            homeUrl: '/lank',
            homeApi: '/api/lank',
        };
    }
    return {
        network,
        apiBase: '/api',
        urlBase: '',
        homeUrl: '/',
        homeApi: '/api/rankings',
    };
}

// NavigationBar sits outside the per-route NetworkProvider, so it has to
// derive context from the URL itself.
export function useNetworkFromLocation(): Network {
    const loc = useLocation();
    return loc.pathname === '/lank' || loc.pathname.startsWith('/lank/') ? 'lank' : 'metro';
}
