import React from 'react';
import { createRoot } from 'react-dom/client';
import { WorshipApp } from './worship-app';
import './worship-app.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorshipApp />
  </React.StrictMode>,
);
