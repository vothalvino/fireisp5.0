import { defineConfig } from 'tsup';
import { copyFileSync, mkdirSync } from 'fs';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom'],
  outExtension() {
    return { js: '.mjs' };
  },
  // CSS imported from src/index.ts is handled by esbuild; the onSuccess hook
  // also copies tokens.css directly to dist/index.css so the ./styles.css
  // export is always present regardless of bundler CSS-import handling.
  async onSuccess() {
    mkdirSync('dist', { recursive: true });
    copyFileSync('src/tokens.css', 'dist/index.css');
    console.log('tokens.css -> dist/index.css');
  },
});
