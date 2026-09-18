import { MapView } from './components/MapView.js';
import { Toolbar } from './components/Toolbar.js';

export function App() {
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <main className="min-h-0 flex-1">
        <MapView />
      </main>
    </div>
  );
}
