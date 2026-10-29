import { spawn } from 'node:child_process';
import process from 'node:process';
import { config } from './config.mjs';

// The same script the deploy job runs, against the same public URL. The demo
// does not re-implement the assertions; it runs scripts/smoke.sh verbatim and
// keeps its transcript.
export function runSmoke() {
  return new Promise((resolve) => {
    const child = spawn('bash', ['scripts/smoke.sh', config.invoiceApiUrl], {
      cwd: process.cwd(),
      env: { ...process.env, SMOKE_TOKEN: config.smokeToken },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let timedOut = false;
    const timer = globalThis.setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      globalThis.setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
    }, config.smokeTimeoutMs);

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      globalThis.clearTimeout(timer);
      resolve({
        ok: false,
        code: null,
        lines: [`smoke could not start: ${error.message}`],
        failureLine: `smoke could not start: ${error.message}`,
        timedOut,
      });
    });
    child.on('close', (code) => {
      globalThis.clearTimeout(timer);
      const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const failureLine = lines.find((line) => line.startsWith('FAIL ')) ?? null;
      resolve({ ok: code === 0 && !timedOut, code, lines, failureLine, timedOut });
    });
  });
}
