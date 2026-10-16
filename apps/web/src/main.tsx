import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';
let savedTheme: string | null = null;
try {
  savedTheme = localStorage.getItem('crewbus-theme');
} catch { /* Storage may be blocked. */ }
document.documentElement.classList.toggle('dark',
  savedTheme === 'dark' ||
    (savedTheme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches),
);
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
