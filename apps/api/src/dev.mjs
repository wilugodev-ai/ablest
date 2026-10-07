import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const build = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status || 1);
const server = spawn(process.execPath, ['dist/main.js'], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.kill(); process.exit(); });
server.on('exit', code => process.exit(code || 0));
