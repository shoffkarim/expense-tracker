import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@mantine/core/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/dropzone/styles.css';
import { UIProvider } from './UIProvider';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UIProvider><App /></UIProvider>
  </StrictMode>,
);
