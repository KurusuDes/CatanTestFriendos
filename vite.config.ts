import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  base: './',
  plugins: [preact(), tsconfigPaths()],
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/peerjs/') || id.includes('/node_modules/peerjs-js-binarypack/') || id.includes('/node_modules/webrtc-adapter/') || id.includes('/node_modules/sdp/')) return 'peerjs';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
