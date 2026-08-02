import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        /**
         * Split the two dependencies that dominate the bundle into their own
         * chunks. Beyond the on-demand loading above, this is a caching win:
         * three.js and React change when they are upgraded, application code
         * changes every deploy, and shipping them in one file means every
         * deploy invalidates 620 kB of vendor code that did not change.
         */
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
