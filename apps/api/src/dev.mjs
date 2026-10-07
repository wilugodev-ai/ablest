import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { watch } from 'node:fs';
const require = createRequire(import.meta.url);
let server;
let timer;
function compile() {
  const build = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc')], { stdio: 'inherit' });
  if (build.status !== 0) return;
  const start = () => { server = spawn(process.execPath, ['dist/main.js'], { stdio: 'inherit' }); };
  if (server && server.exitCode === null) { const previous = server; server = undefined; previous.once('exit',start); previous.kill(); } else start();
}
compile();
watch(new URL('.',import.meta.url), { recursive: true }, (_event, file) => { if (!file?.endsWith('.ts')) return; clearTimeout(timer); timer = setTimeout(compile,250); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server?.kill(); process.exit(); });
