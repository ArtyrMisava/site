import React from 'react';
import ReactDOM from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import App from './App';
import { preloadMapGeography } from './mapGeography';
import { initializeSiteStorage } from './siteStorage';

async function startApplication() {
  await initializeSiteStorage();
  preloadMapGeography();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void startApplication();
