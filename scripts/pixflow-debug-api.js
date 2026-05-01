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

const DATA_DIR = path.join(PROJECT_DIR, 'data');

const checkService = (name) => new Promise((resolve) => {
  execFile('systemctl', ['is-active', name], { timeout: 5000 }, (_err, stdout) => {
    resolve((stdout || '').trim() || 'unknown');
  });
});

const runDockerExecCat = (filePath) => new Promise((resolve) => {
  execFile('docker', ['exec', 'pixflow-backend', 'cat', filePath], { timeout: 6000 }, (err, stdout) => {
    if (err || !stdout) return resolve(null);
    try {
      resolve(JSON.parse(stdout));
    } catch {
      resolve(null);
    }
  });
});

const getPixflowStatus = async () => {
  const [kioskState, hotspotState] = await Promise.all([
    checkService('pixflow-kiosk').catch(() => 'unknown'),
    checkService('pixflow-hotspot-api').catch(() => 'unknown'),
  ]);

  const kioskStatus = {
    status: kioskState === 'active' ? 'active' : kioskState,
    service: 'pixflow-kiosk',
    message: kioskState === 'active' ? 'Kiosk actif' : `Kiosk ${kioskState}`,
  };

  const hotspotStatus = {
    status: hotspotState === 'active' ? 'active' : hotspotState,
    message: hotspotState === 'active' ? 'Hotspot actif' : `Hotspot ${hotspotState}`,
  };

  let dockerStatus = { status: 'unknown', containers: [] };
  await new Promise((resolve) => {
    execFile('docker', ['ps', '--format', '{{.Names}}|{{.Status}}'], { timeout: 8000 }, (err, stdout) => {
      if (!err && stdout) {
        const containers = stdout.trim().split('\n').filter(Boolean).map((line) => {
          const sep = line.indexOf('|');
          return { name: line.slice(0, sep).trim(), state: line.slice(sep + 1).trim() };
        });
        const px = containers.filter((c) => c.name.startsWith('pixflow'));
        dockerStatus = {
          status: px.length > 0 && px.every((c) => c.state.startsWith('Up')) ? 'active'
            : px.length > 0 ? 'partial' : 'inactive',
          containers: px,
        };
      }
      resolve();
    });
  });

  let gitInfo = { branch: null, commit: null, date: null };
  await new Promise((resolve) => {
    execFile('git', ['-C', PROJECT_DIR, 'log', '-1', '--format=%h %ci'], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) {
        const parts = (stdout || '').trim().split(' ');
        gitInfo.commit = parts[0] || null;
        gitInfo.date = parts.slice(1, 3).join(' ') || null;
      }
      resolve();
    });
  });
  await new Promise((resolve) => {
    execFile('git', ['-C', PROJECT_DIR, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeout: 5000 }, (err, stdout) => {
      if (!err && stdout) gitInfo.branch = (stdout || '').trim() || null;
      resolve();
    });
  });

  let activeProject = null;
  const projects = await runDockerExecCat('/data/projects/projects.json').catch(() => null);
  if (Array.isArray(projects)) {
    const active = projects.find((p) => p.active);
    if (active) {
      activeProject = { id: active.id || null, name: active.name || null, mediaCount: 0 };
      const media = await runDockerExecCat('/data/projects/media.json').catch(() => null);
      if (Array.isArray(media)) {
        activeProject.mediaCount = media.filter((m) => m.projectId === active.id && m.active !== false).length;
      }
    }
  }

  return {
    backend: { status: 'online', message: 'Backend en ligne' },
    frontend: { status: 'unknown', message: 'Statut non vérifié depuis le helper' },
    kiosk: kioskStatus,
    hotspot: hotspotStatus,
    docker: dockerStatus,
    git: gitInfo,
    activeProject,
  };
};

const LOG_COMMANDS = {
  backend: ['docker', ['logs', '--tail=150', 'pixflow-backend']],
  kiosk: ['journalctl', ['-u', 'pixflow-kiosk', '-n', '150', '--no-pager']],
  hotspot: ['journalctl', ['-u', 'pixflow-hotspot-api', '-n', '150', '--no-pager']],
  docker: ['docker', ['ps', '-a', '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}']],
  system: ['journalctl', ['-n', '150', '--no-pager']],
};

const getLogs = (target) => new Promise((resolve) => {
  const entry = LOG_COMMANDS[target];
  if (!entry) return resolve({ ok: false, target, lines: [] });
  const [cmd, args] = entry;
  execFile(cmd, args, { timeout: 15000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
    const raw = (stdout || stderr || (err ? err.message : '') || '').slice(-60000);
    const lines = raw.split('\n').filter(Boolean).slice(-200);
    resolve({ ok: true, target, lines: lines.length ? lines : ['Aucune sortie disponible'] });
  });
});

const getStorageInfo = async () => {
  const disk = await readDiskStats().catch(() => null);
  let media = { imageCount: null, videoCount: null, totalCount: null };
  const items = await runDockerExecCat('/data/projects/media.json').catch(() => null);
  if (Array.isArray(items)) {
    media.imageCount = items.filter((m) => m.type === 'image').length;
    media.videoCount = items.filter((m) => m.type === 'video').length;
    media.totalCount = items.length;
    const failed = items.filter((m) => m.status === 'failed').length;
    if (failed > 0) media.failedCount = failed;
  }
  return { disk, media };
};

const getDiagnostic = async () => {
  const checks = [];

  checks.push({ label: 'Backend', status: 'ok', message: 'Backend en ligne' });

  const kioskState = await checkService('pixflow-kiosk').catch(() => 'unknown');
  checks.push({
    label: 'Kiosk',
    status: kioskState === 'active' ? 'ok' : kioskState === 'unknown' ? 'unknown' : 'warning',
    message: kioskState === 'active' ? 'Service kiosk actif' : `Service kiosk ${kioskState}`,
  });

  let dockerOk = false;
  await new Promise((resolve) => {
    execFile('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 8000 }, (err, stdout) => {
      dockerOk = !err && Boolean((stdout || '').trim());
      resolve();
    });
  });
  checks.push({ label: 'Docker', status: dockerOk ? 'ok' : 'error', message: dockerOk ? 'Docker actif' : 'Docker indisponible' });

  for (const [label, name] of [['Container backend', 'pixflow-backend'], ['Container frontend', 'pixflow-frontend']]) {
    let running = false;
    await new Promise((resolve) => {
      execFile('docker', ['inspect', '--format', '{{.State.Status}}', name], { timeout: 5000 }, (err, stdout) => {
        running = !err && (stdout || '').trim() === 'running';
        resolve();
      });
    });
    checks.push({ label, status: running ? 'ok' : 'warning', message: running ? `${label} actif` : `${label} non démarré` });
  }

  const hotspotState = await checkService('pixflow-hotspot-api').catch(() => 'unknown');
  checks.push({
    label: 'Hotspot',
    status: hotspotState === 'active' ? 'ok' : hotspotState === 'unknown' ? 'unknown' : 'warning',
    message: hotspotState === 'active' ? 'Service hotspot actif' : `Service hotspot ${hotspotState}`,
  });

  const disk = await readDiskStats().catch(() => null);
  if (disk?.percent != null) {
    checks.push({
      label: 'Disque',
      status: disk.percent >= 95 ? 'error' : disk.percent >= 85 ? 'warning' : 'ok',
      message: `Disque utilisé à ${disk.percent}%`,
    });
  } else {
    checks.push({ label: 'Disque', status: 'unknown', message: 'Information disque indisponible' });
  }

  const temp = await readTemperature().catch(() => null);
  if (temp?.celsius != null) {
    checks.push({
      label: 'Température',
      status: temp.celsius >= 80 ? 'error' : temp.celsius >= 70 ? 'warning' : 'ok',
      message: `Température CPU : ${temp.celsius} °C`,
    });
  } else {
    checks.push({ label: 'Température', status: 'unknown', message: 'Température indisponible' });
  }

  const projects = await runDockerExecCat('/data/projects/projects.json').catch(() => null);
  const activeProject = Array.isArray(projects) ? projects.find((p) => p.active) || null : null;
  checks.push({
    label: 'Projet actif',
    status: activeProject ? 'ok' : 'warning',
    message: activeProject ? `Projet actif : ${activeProject.name || activeProject.id}` : 'Aucun projet actif',
  });

  if (activeProject) {
    const media = await runDockerExecCat('/data/projects/media.json').catch(() => null);
    const mediaCount = Array.isArray(media)
      ? media.filter((m) => m.projectId === activeProject.id && m.active !== false).length
      : null;
    checks.push({
      label: 'Médias du projet',
      status: mediaCount == null ? 'unknown' : mediaCount > 0 ? 'ok' : 'warning',
      message: mediaCount == null ? 'Médias inaccessibles' : `${mediaCount} média(s) actif(s)`,
    });
  }

  return { checks };
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

      if (req.method === 'GET' && url.pathname === '/pixflow-status') {
        try {
          return sendJson(res, 200, await getPixflowStatus());
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: error.message || 'Erreur interne' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/logs') {
        const target = url.searchParams.get('target') || '';
        const allowed = new Set(['backend', 'kiosk', 'hotspot', 'docker', 'system']);
        if (!allowed.has(target)) return sendJson(res, 400, { ok: false, error: 'target invalide' });
        try {
          return sendJson(res, 200, await getLogs(target));
        } catch (error) {
          return sendJson(res, 500, { ok: false, target, lines: [], error: error.message || 'Erreur interne' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/storage') {
        try {
          return sendJson(res, 200, await getStorageInfo());
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: error.message || 'Erreur interne' });
        }
      }

      if (req.method === 'GET' && url.pathname === '/diagnostic') {
        try {
          return sendJson(res, 200, await getDiagnostic());
        } catch (error) {
          return sendJson(res, 500, { checks: [], error: error.message || 'Erreur interne' });
        }
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
