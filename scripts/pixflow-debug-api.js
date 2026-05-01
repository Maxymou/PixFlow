#!/usr/bin/env node
import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const HOST = process.env.DEBUG_HOST_API_BIND || '127.0.0.1';
const PORT = Number(process.env.DEBUG_HOST_API_PORT || 4877);
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const DEBUG_OUTPUT_MAX_LENGTH = 8000;
const DEBUG_COMMAND_MAX_LENGTH = 500;
const COMMANDS_FILE = process.env.DEBUG_COMMANDS_FILE || '/home/maxymou/PixFlow/data/debug-commands.json';
const PROJECT_DIR = process.env.PIXFLOW_PROJECT_DIR || '/home/maxymou/PixFlow';

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

const main = async () => {
  const shellPath = await detectShell();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (req.method === 'GET' && url.pathname === '/commands') {
        return sendJson(res, 200, { commands: await readCommands() });
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
