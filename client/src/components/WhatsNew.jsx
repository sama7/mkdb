import { useState } from 'react';
import Tab from 'react-bootstrap/Tab';
import Tabs from 'react-bootstrap/Tabs';
import FilmGridRisers from './FilmGridRisers';
import FilmGridFallers from './FilmGridFallers';
import FilmGridNewEntries from './FilmGridNewEntries';
import FilmGridNewDepartures from './FilmGridNewDepartures';


export default function WhatsNew() {
    const [key, setKey] = useState('greatest-risers');

    return (
        <Tabs
            data-bs-theme="dark"
            id="whats-new-tabs"
            activeKey={key}
            onSelect={(k) => setKey(k)}
            className="mb-3 container"
            fill
        >
            <Tab eventKey="greatest-risers" title="Risers">
                <div className="container">
                    <h3>Greatest Risers in Rank</h3>
                    <FilmGridRisers id={key} />
                </div>
            </Tab>
            <Tab eventKey="greatest-fallers" title="Fallers">
                <div className="container">
                    <h3>Greatest Fallers in Rank</h3>
                    <FilmGridFallers id={key} />
                </div>
            </Tab>
            <Tab eventKey="new-entries" title="Entries">
                <div className="container">
                    <h3>
                        Just Entered the Top 1000
                        <img src="/images/icons/new_mank.png" alt="New entry in the MKDb Top 1000" title="New entry in the MKDb Top 1000" />
                    </h3>
                    <FilmGridNewEntries id={key} />
                </div>
            </Tab>
            <Tab eventKey="new-departures" title="Departures">
                <div className="container">
                    <h3>
                        Just Left the Top 1000
                        <img src="/images/icons/former_mank.png" alt="Newly departed from the MKDb Top 1000" title="Newly departed from the MKDb Top 1000" />
                    </h3>
                    <FilmGridNewDepartures id={key} />
                </div>
            </Tab>
        </Tabs>
    );
}