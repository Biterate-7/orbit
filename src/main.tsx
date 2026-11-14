import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';
import '@fontsource/vt323/400.css';
import './styles.css';
import './missions.css';
import { App } from './App';

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

// Set by electron/preload.cjs in the Windows desktop build, which has no Vercel deployment to report to.
const isDesktopApp = 'lostOrbitDesktop' in window;

createRoot(root).render(
  <StrictMode>
    <App />
    {!isDesktopApp && <Analytics />}
  </StrictMode>,
);
