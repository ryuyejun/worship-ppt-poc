import { defineConfig, type ProxyOptions } from 'vite';

const apiTarget = process.env.VITE_API_TARGET || 'http://127.0.0.1:8080';
const backend: ProxyOptions = {
  target: apiTarget,
  changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq', (outgoing, incoming) => {
      const origin = incoming.headers.origin;
      if (origin === `http://${incoming.headers.host}` || origin === `https://${incoming.headers.host}`) {
        outgoing.setHeader('origin', new URL(apiTarget).origin);
      }
    });
  },
};

export default defineConfig({
  server: {
    proxy: {
      '/api/auto-melody/jobs': process.env.VITE_AUTO_MELODY_TARGET || 'http://127.0.0.1:8090',
      '/auth': backend,
      '/search': backend,
      '/songs': backend,
      '^/song(?:$|\\?)': backend,
      '/ppt-songs': backend,
      '/requests': backend,
      '/ppt': backend,
      '/song-artwork': backend,
      '/youtube-videos': backend,
      '/youtube-thumbnail': backend,
      '/local-token.js': backend,
    },
  },
});
