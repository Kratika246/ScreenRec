import { build } from 'esbuild';
await build({ entryPoints: ['lambda/videos.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: 'dist/lambda/videos.js', sourcemap: true });
