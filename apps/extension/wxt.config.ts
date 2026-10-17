import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';
import extension from '../../config/extension.json';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({ plugins: [tailwindcss()] }),
  manifest: {
    name: 'ScreenRec – Screen Recorder', description: 'Record your screen and camera. Share instantly.', version: '1.0.0',
    key: extension.key,
    permissions: ['desktopCapture', 'storage', 'identity', 'activeTab', 'clipboardWrite', 'tabs', 'offscreen'],
    host_permissions: ['https://*/*', 'http://localhost/*'],
    commands: { 'toggle-recording': { suggested_key: { default: 'Alt+Shift+R', mac: 'Alt+Shift+R' }, description: 'Open recorder or stop recording' } },
    action: { default_popup: 'popup.html' },
    web_accessible_resources: [{ resources: ['camera.html', 'chunks/*'], matches: ['http://*/*', 'https://*/*'] }],
  },
});
