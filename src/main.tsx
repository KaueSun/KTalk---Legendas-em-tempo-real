import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { Overlay } from './Overlay';
import './styles.css';

const overlay = window.location.hash === '#overlay';
if (overlay) document.documentElement.classList.add('overlay-page');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{overlay ? <Overlay /> : <App />}</React.StrictMode>,
);
