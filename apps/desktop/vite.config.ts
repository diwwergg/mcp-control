import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  // Served over HTTP by the dashboard server now, not loaded via file://.
  base: '/',
  plugins: [react(), tailwindcss()],
  root: path.join(desktopRoot, 'src', 'renderer'),
  build: {
    outDir: path.join(desktopRoot, 'dist', 'renderer'),
    emptyOutDir: true,
  },
});
