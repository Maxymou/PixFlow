#!/usr/bin/env node
import http from 'http';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const HOST = process.env.DEBUG_HOST_API_BIND || '127.0.0.1';
const PORT = Number(process.env.DEBUG_HOST_API_PORT || 4877);
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const DEBUG_OUTPUT_MAX_LENGTH = 8000;
const DEBUG_COMMAND_MAX_LENGTH = 500;
const COMMANDS_FILE = process.env.DEBUG_COMMANDS_FILE || '/home/maxymou/PixFlow/data/debug-commands.json';
const PROJECT_DIR = process.env.PIXFLOW_PROJECT_DIR || '/home/maxymou/PixFlow';
const PIXFLOW_SSH_USER = process.env.PIXFLOW_SSH_USER || 'maxymou';

const DEFAULT_COMMANDS = [
  { id: 'update', label: 'Mettre à jour PixFlow', command: 'cd /home/maxymou/PixFlow && ./update.sh' },
  { id: 'restart-kiosk', label: 'Relancer le kiosk', command: 'sudo systemctl restart pixflow-kiosk' },
];

const DEFAULT_BY_ID = new Map(DEFAULT_COMMANDS.map((item) => [item.id, item]));

const trimOutput = (value) => (value.length <= DEBUG_OUTPUT_MAX_LENGTH ? value : value.slice(-DEBUG_OUTPUT_MAX_LENGTH));

const detectShell = async () => {
  const candidates = ['/usr/bin/bash', '/bin/bash'];
  for (const shellPath of candidates) {
    try {
      await fs.access(shellPath);
      return shellPath;
    } catch {
      // continue
    }
  }

  throw new Error('Aucun shell bash absolu trouvé (/usr/bin/bash ou /bin/bash).');
};

const parseBody = async (req) => {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 10000) {
      throw new Error('Payload trop volumineux.');
    }
  }
  if (!raw) return {};
  return JSON.parse(raw);
};

const sendJson = (res, code, payload) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const ensureCommandsFile = async () => {
  await fs.mkdir(path.dirname(COMMANDS_FILE), { recursive: true });
  try {
    await fs.access(COMMANDS_FILE);
  } catch {
    await fs.writeFile(COMMANDS_FILE, JSON.stringify(DEFAULT_COMMANDS, null, 2));
  }
};

const normalizeCommand = (item) => ({
  id: String(item?.id || '').trim(),
  label: String(item?.label || '').trim(),
  command: String(item?.command || '').trim(),
});

const readCommands = async () => {
  await ensureCommandsFile();
  const parsed = JSON.parse(await fs.readFile(COMMANDS_FILE, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('Format de commandes invalide.');

  const commands = parsed.map(normalizeCommand);
  for (const cmd of commands) {
    if (!DEFAULT_BY_ID.has(cmd.id)) throw new Error(`Id inconnu dans le fichier: ${cmd.id}`);
    if (!cmd.command || cmd.command.length > DEBUG_COMMAND_MAX_LENGTH) throw new Error(`Commande invalide pour ${cmd.id}`);
  }

  return DEFAULT_COMMANDS.map((defaults) => commands.find((item) => item.id === defaults.id) || defaults);
};

const writeCommands = async (commands) => {
  await fs.writeFile(COMMANDS_FILE, JSON.stringify(commands, null, 2));
};

const runShellCommand = async (command, shellPath) => new Promise((resolve, reject) => {
  const child = spawn(shellPath, ['-lc', command], { cwd: PROJECT_DIR });
  let stdout = '';
  let stderr = '';
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
  }, COMMAND_TIMEOUT_MS);

  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    const result = { code, timedOut, stdout: trimOutput(stdout), stderr: trimOutput(stderr) };
    if (code === 0 && !timedOut) return resolve(result);
    const error = new Error(timedOut ? 'Commande interrompue : délai dépassé.' : `Commande terminée avec le code ${code}`);
    error.result = result;
    return reject(error);
  });
});

const runShellCommandDetached = (command, shellPath) => {
  const child = spawn(shellPath, ['-lc', command], {
    cwd: PROJECT_DIR,
    detached: true,
    stdio: 'ignore',
  });

  child.unref();
  return { background: true };
};

const isPrivateIpv4 = (ip) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip);

const getNetworkInfo = () => {
  const hostname = os.hostname();
  const network = os.networkInterfaces();
  const ips = [];

  for (const [name, entries] of Object.entries(network)) {
    for (const entry of entries || []) {
      if (!entry || entry.family !== 'IPv4' || entry.internal || entry.address === '127.0.0.1') continue;
      ips.push({ interface: name, address: entry.address, family: 'IPv4' });
    }
  }

  const lanEth = ips.find((item) => (item.interface === 'eth0' || item.interface.startsWith('en')) && isPrivateIpv4(item.address));
  const lanWifi = ips.find((item) => (item.interface === 'wlan0' || item.interface.startsWith('wl')) && isPrivateIpv4(item.address));
  const primaryIp = lanEth?.address || lanWifi?.address || ips[0]?.address || null;

  return {
    hostname,
    sshUser: PIXFLOW_SSH_USER,
    primaryIp,
    sshCommand: primaryIp ? `ssh ${PIXFLOW_SSH_USER}@${primaryIp}` : null,
    ips,
  };
};

const readCpuUsagePercent = async () => {
  const sample = () => os.cpus().reduce((acc, cpu) => {
    const times = cpu.times || {};
    const total = Object.values(times).reduce((sum, value) => sum + value, 0);
    return { idle: acc.idle + (times.idle || 0), total: acc.total + total };
  }, { idle: 0, total: 0 });
  const start = sample();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const end = sample();
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;
  if (!Number.isFinite(totalDelta) || totalDelta <= 0) return null;
  return Math.round(((totalDelta - idleDelta) / totalDelta) * 100);
};

const readDiskStats = async () => new Promise((resolve) => {
  execFile('df', ['-k', '/'], (error, stdout) => {
    if (error || !stdout) {
      resolve({ percent: null, usedGb: null, totalGb: null, mount: '/' });
      return;
    }
    const lines = stdout.trim().split('\n');
    const row = lines[1] || '';
    const parts = row.trim().split(/\s+/);
    const totalKb = Number(parts[1]);
    const usedKb = Number(parts[2]);
    const percent = Number((parts[4] || '').replace('%', ''));
    resolve({
      percent: Number.isFinite(percent) ? percent : null,
      usedGb: Number.isFinite(usedKb) ? Math.round((usedKb / (1024 * 1024)) * 10) / 10 : null,
      totalGb: Number.isFinite(totalKb) ? Math.round((totalKb / (1024 * 1024)) * 10) / 10 : null,
      mount: parts[5] || '/',
    });
  });
});

const readTemperature = async () => {
  try {
    const raw = await fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8');
    const value = Number(raw.trim());
    if (Number.isFinite(value)) return { celsius: Math.round((value >= 1000 ? value / 1000 : value)) };
  } catch {
    // continue
  }
  const fromVcgencmd = await new Promise((resolve) => {
    execFile('vcgencmd', ['measure_temp'], (error, stdout) => {
      if (error || !stdout) return resolve(null);
      const match = stdout.match(/temp=([0-9.]+)/);
      return resolve(match ? Number(match[1]) : null);
    });
  });
  return { celsius: Number.isFinite(fromVcgencmd) ? Math.round(fromVcgencmd) : null };
};

const formatUptimeFr = (seconds) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts = [];
  if (days > 0) parts.push(`${days}j`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
};

const getSystemInfo = async () => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const disk = await readDiskStats();
  const cpuPercent = await readCpuUsagePercent();
  const temperature = await readTemperature();
  const uptimeSeconds = Math.floor(os.uptime());

  return {
    cpu: { percent: cpuPercent },
    memory: {
      percent: totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : null,
      usedMb: Math.round(usedMem / (1024 * 1024)),
      totalMb: Math.round(totalMem / (1024 * 1024)),
    },
    disk,
    temperature,
    uptime: {
      seconds: uptimeSeconds,
      label: formatUptimeFr(uptimeSeconds),
    },
  };
};

const main = async () => {
  const shellPath = await detectShell();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/commands') {
        return sendJson(res, 200, { commands: await readCommands() });
      }
      if (req.method === 'GET' && url.pathname === '/network') {
        return sendJson(res, 200, getNetworkInfo());
      }
      if (req.method === 'GET' && url.pathname === '/system') {
        return sendJson(res, 200, await getSystemInfo());
      }

      if (req.method === 'PATCH' && url.pathname.startsWith('/commands/')) {
        const id = decodeURIComponent(url.pathname.replace('/commands/', '')).trim();
        if (!DEFAULT_BY_ID.has(id)) return sendJson(res, 404, { ok: false, error: 'Commande introuvable.' });

        const body = await parseBody(req);
        const command = typeof body.command === 'string' ? body.command.trim() : '';
        if (!command) return sendJson(res, 400, { ok: false, error: 'La commande ne peut pas être vide.' });
        if (command.length > DEBUG_COMMAND_MAX_LENGTH) return sendJson(res, 400, { ok: false, error: `La commande dépasse ${DEBUG_COMMAND_MAX_LENGTH} caractères.` });

        const commands = await readCommands();
        const next = commands.map((item) => (item.id === id ? { ...item, command } : item));
        await writeCommands(next);
        return sendJson(res, 200, { ok: true, command: next.find((item) => item.id === id) });
      }

      if (req.method === 'POST' && url.pathname === '/action') {
        const body = await parseBody(req);
        const id = typeof body.id === 'string' ? body.id.trim() : '';
        if (!DEFAULT_BY_ID.has(id)) return sendJson(res, 400, { ok: false, id, message: 'Identifiant de commande invalide.' });

        const commands = await readCommands();
        const target = commands.find((item) => item.id === id);
        const command = String(target?.command || '').trim();
        if (!command) return sendJson(res, 400, { ok: false, id, message: 'Commande vide ou non configurée.' });

        if (id === 'update') {
          runShellCommandDetached(command, shellPath);
          return sendJson(res, 202, {
            ok: true,
            id,
            command,
            background: true,
            message: 'Mise à jour lancée. Le serveur peut être temporairement indisponible.',
          });
        }

        try {
          const result = await runShellCommand(command, shellPath);
          return sendJson(res, 200, { ok: true, id, command, stdout: result.stdout, stderr: result.stderr, message: 'Commande exécutée.' });
        } catch (error) {
          const result = error.result || {};
          return sendJson(res, 500, {
            ok: false,
            id,
            command,
            stdout: result.stdout || '',
            stderr: result.stderr || error.message || '',
            message: `Erreur pendant l’exécution de la commande. ${error.message || ''}`.trim(),
          });
        }
      }

      return sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message || 'Invalid request' });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`[PixFlow Debug Host API] listening on http://${HOST}:${PORT} with shell ${shellPath}`);
  });
};

main().catch((error) => {
  console.error('[PixFlow Debug Host API] startup failure:', error);
  process.exit(1);
});
