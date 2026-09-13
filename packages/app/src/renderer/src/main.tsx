import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { wireEvents } from './store';
import './styles.css';

wireEvents();
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
