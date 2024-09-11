import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import FilmGrid from './components/FilmGrid';
import FilmDetails from './components/FilmDetails';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<FilmGrid />} />
        <Route path="/film/:slug" element={<FilmDetails />} />
      </Routes>
    </Router>
  );
}

export default App