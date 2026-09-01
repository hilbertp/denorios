#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const HEARTBEAT_PATH = path.join(REPO_ROOT, 'bridge', 'heartbeat.json');
const DASHBOARD_PORT = process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT, 10) : 4747;

const USAGE = `Usage: denorios <command>

Commands:
  status   Report orchestrator and dashboard liveness
  start    Start orchestrator and dashboard (delegates to scripts/start.sh)
  stop     Stop orchestrator and dashboard (delegates to scripts/stop.sh)
`;

function probePort(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: '/api/bridge', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function cmdStatus() {
  // Orchestrator: read heartbeat file
  let orchStatus = 'unknown';
  let orchAge = null;
  try {
    const hb = JSON.parse(fs.readFileSync(HEARTBEAT_PATH, 'utf8'));
    orchStatus = hb.status ?? 'unknown';
    if (hb.ts) {
      const ageSec = Math.round((Date.now() - new Date(hb.ts).getTime()) / 1000);
      orchAge = ageSec;
    }
  } catch {
    orchStatus = 'no heartbeat file';
  }

  const orchLive = typeof orchAge === 'number' && orchAge < 120;
  const orchLine = orchLive
    ? `orchestrator: ${orchStatus} (heartbeat ${orchAge}s ago)`
    : `orchestrator: ${orchStatus}${orchAge !== null ? ` (heartbeat ${orchAge}s ago — stale)` : ''}`;

  // Dashboard: TCP probe
  const dashLive = await probePort(DASHBOARD_PORT);
  const dashLine = dashLive
    ? `dashboard:    live on port ${DASHBOARD_PORT}`
    : `dashboard:    not responding on port ${DASHBOARD_PORT}`;

  console.log(orchLine);
  console.log(dashLine);
}

function delegateScript(name) {
  const scriptPath = path.join(REPO_ROOT, 'scripts', `${name}.sh`);
  if (!fs.existsSync(scriptPath)) {
    console.error(`ERROR: scripts/${name}.sh not found at ${scriptPath}`);
    process.exit(1);
  }
  try {
    execFileSync('bash', [scriptPath], { stdio: 'inherit', cwd: REPO_ROOT });
  } catch (err) {
    process.exit(err.status ?? 1);
  }
}

const [,, cmd] = process.argv;

switch (cmd) {
  case 'status':
    cmdStatus().then(() => process.exit(0));
    break;
  case 'start':
    delegateScript('start');
    break;
  case 'stop':
    delegateScript('stop');
    break;
  default:
    process.stdout.write(USAGE);
    process.exit(cmd ? 1 : 0);
}
