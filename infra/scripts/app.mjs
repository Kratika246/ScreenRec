import { execFileSync } from 'node:child_process';
execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['--import', 'tsx', 'bin/infra.ts'], { stdio: 'inherit' });
