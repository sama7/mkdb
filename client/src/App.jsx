import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import './App.css';
import NavigationBar from './components/NavigationBar';
import FilmGrid from './components/FilmGrid';
import FilmDetails from './components/FilmDetails';
import WhatsNew from './components/WhatsNew';
import FilmGridEvilMank from './components/FilmGridEvilMank';

export default function App() {
  return (
    <Router>
        <NavigationBar />
        <div>
          <Routes>
            <Route path="/" element={<FilmGrid />} />
            <Route path="/film/:slug" element={<FilmDetails />} />
            <Route path="/new" element={<WhatsNew />} />
            <Route path="/evil-mank" element={<FilmGridEvilMank />} />
          </Routes>
        </div>
    </Router>
  );
}