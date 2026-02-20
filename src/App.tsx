import React from 'react';
import Home from './routes/Home';
import Layout from './routes/Layout';
import { Routes, Route, BrowserRouter } from 'react-router-dom';
import Log from './routes/Log';

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/log" element={<Log />} />
        <Route path="/" element={<Home />} />
      </Routes>
    </Layout>
  );
}

export default App;
