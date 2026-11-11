import '@fontsource/be-vietnam-pro/vietnamese-400.css';
import '@fontsource/be-vietnam-pro/latin-400.css';
import '@fontsource/be-vietnam-pro/vietnamese-500.css';
import '@fontsource/be-vietnam-pro/latin-500.css';
import '@fontsource/be-vietnam-pro/vietnamese-600.css';
import '@fontsource/be-vietnam-pro/latin-600.css';
import '@fontsource/be-vietnam-pro/vietnamese-700.css';
import '@fontsource/be-vietnam-pro/latin-700.css';
import '@fontsource/be-vietnam-pro/vietnamese-800.css';
import '@fontsource/be-vietnam-pro/latin-800.css';
import '@fontsource/baloo-2/vietnamese-500.css';
import '@fontsource/baloo-2/latin-500.css';
import '@fontsource/baloo-2/vietnamese-600.css';
import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/vietnamese-700.css';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/vietnamese-800.css';
import '@fontsource/baloo-2/latin-800.css';
import './styles/style.css';
import './styles/pixel.css';
import { App } from './app.js';
import { lobbyScreen } from './ui/lobby.js';
import { gameScreen } from './ui/gameView.js';
import { editorScreen, decodeMap } from './ui/editor.js';
import { preactScreen } from './ui/components/mount';
import { Menu } from './ui/screens/Menu';
import { Online } from './ui/screens/Online';
import { autoPixelize } from './ui/pixel.js';

autoPixelize(document.body);
App.screens = { menu: preactScreen(Menu), lobby: lobbyScreen, game: gameScreen, editor: editorScreen, online: preactScreen(Online) };

// shared map link: ?mapa=<code>
const params = new URLSearchParams(location.search);
if (params.get('mapa')) {
  try {
    App.go('editor', decodeMap(params.get('mapa')));
  } catch {
    App.go('menu');
  }
} else if (params.get('sala')) App.go('online');
else App.go('menu');

// dev-only perf overlay: open with ?perf
if (import.meta.env.DEV && new URLSearchParams(location.search).has('perf')) {
  import('stats-gl').then(({ default: Stats }) => {
    const stats = new Stats({ trackGPU: true });
    document.body.append(stats.dom);
    let patched = null;
    const tick = () => {
      const b = window.__board3d;
      if (b && b.renderer && patched !== b.renderer) {
        patched = b.renderer;
        stats.init(b.renderer);
      }
      if (patched) stats.update();
      requestAnimationFrame(tick);
    };
    tick();
  });
}
