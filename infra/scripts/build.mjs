import { build } from 'esbuild';
await build({ entryPoints: ['lambda/videos.ts', 'lambda/ai.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outdir: 'dist/lambda', sourcemap: true });
