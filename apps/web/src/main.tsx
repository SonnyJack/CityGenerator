import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.js';
import { installTestApi } from './testing.js';

installTestApi();

// A share link (?doc=<url>) opens that document once the app is up; the parameter is then removed.
const shared = new URLSearchParams(window.location.search).get('doc');
if (shared) {
  void import('./import/importFile.js').then(({ importFromUrl }) => {
    const wait = (): Promise<unknown> =>
      window.__citygen ? importFromUrl(shared) : new Promise((r) => setTimeout(r, 100)).then(wait);
    void wait().then(() => {
      const u = new URL(window.location.href);
      u.searchParams.delete('doc');
      window.history.replaceState(null, '', u.pathname + u.search + u.hash);
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
