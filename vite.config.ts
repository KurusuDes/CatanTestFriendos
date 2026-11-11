import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  resolve: { tsconfigPaths: true }, // @engine/*, @ui/* ... from tsconfig.json (native in Vite 8)
  build: {
    target: 'es2020',
    // three.js lives in its own chunk (~750 kB, loaded lazily with the 3D board): expected, so the
    // limit sits just above it and anything else that grows past 800 kB still warns.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'peerjs', test: /node_modules[\\/](peerjs|peerjs-js-binarypack|webrtc-adapter|sdp)[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
