import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScoreLab } from './score-lab';
import { WorshipApp } from './worship-app';
import './worship-app.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(window.location.search).has('score') ? <ScoreLab /> : <WorshipApp />}
  </React.StrictMode>,
);
