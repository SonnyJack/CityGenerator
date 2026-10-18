import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App.js';
import { installTestApi } from './testing.js';
import { restored } from './store.js';

installTestApi();

// A share link (?doc=<url>) opens that document once the app is up and the autosaved document
// has been restored (else the restore would replace it); the parameter is then removed.
const shared = new URLSearchParams(window.location.search).get('doc');
if (shared) {
  void Promise.all([import('./import/importFile.js'), restored]).then(([{ importFromUrl }]) => {
    void importFromUrl(shared).then(() => {
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
