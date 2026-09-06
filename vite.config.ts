import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const packageVersion = process.env.npm_package_version ?? 'development';
const buildSha = process.env.VITE_BUILD_SHA ?? process.env.GITHUB_SHA ?? 'development';
const releaseId = process.env.VITE_RELEASE_ID ?? `v${packageVersion}`;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'sinter-build-identity',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'build.json',
          source: JSON.stringify({ release: releaseId, version: packageVersion, commit: buildSha }),
        });
      },
    },
  ],
  define: {
    'import.meta.env.PACKAGE_VERSION': JSON.stringify(packageVersion),
    'import.meta.env.BUILD_SHA': JSON.stringify(buildSha),
    'import.meta.env.RELEASE_ID': JSON.stringify(releaseId),
  },
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
