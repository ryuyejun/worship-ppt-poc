import { defineConfig } from 'vite';

const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8080';

export default defineConfig({
  server: {
    proxy: {
      '/search': apiTarget,
      '/songs': apiTarget,
      '/ppt-songs': apiTarget,
      '/requests': apiTarget,
      '/batch-import': apiTarget,
      '/ppt': apiTarget,
      '/song-artwork': apiTarget,
      '/local-token.js': apiTarget,
      '/logo.png': apiTarget,
    },
  },
});
