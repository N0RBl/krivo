import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],

  server: {
    host: 'localhost',

    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },

  define: {
    global: 'globalThis',
    'process.env': {},
  },

  resolve: {
    alias: {
      buffer: 'buffer',
      util: 'util',
      process: 'process/browser',
    },
  },
});

