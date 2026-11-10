import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  resolve: { tsconfigPaths: true }, // @engine/*, @ui/* ... from tsconfig.json (native in Vite 8)
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
