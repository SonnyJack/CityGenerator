import { GenerateDock } from './components/GenerateDock.js';
import { MapView } from './components/MapView.js';
import { Toolbar } from './components/Toolbar.js';
import { VariationsStrip } from './components/VariationsStrip.js';

export function App() {
  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <GenerateDock />
        <main className="min-h-0 min-w-0 flex-1">
          <MapView />
        </main>
      </div>
      <VariationsStrip />
    </div>
  );
}
