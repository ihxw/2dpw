import { defineConfig } from 'vite';
import { SERVER_PORT, WS_PATH } from '../shared/src/constants.ts';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      [WS_PATH]: { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
});
