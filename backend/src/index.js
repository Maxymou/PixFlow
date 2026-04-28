import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const app = express();
const port = Number(process.env.PORT || 4000);
const dataRoot = process.env.DATA_ROOT || '/data';
const incomingDir = path.join(dataRoot, 'incoming');
const mediaDir = path.join(dataRoot, 'media');
const projectsDir = path.join(dataRoot, 'projects');
const projectsFile = path.join(projectsDir, 'projects.json');
const mediaFile = path.join(projectsDir, 'media.json');
const playlistFile = path.join(dataRoot, 'playlist.json');
const settingsFile = path.join(dataRoot, 'settings.json');

const DEFAULT_MAX_UPLOAD_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_UPLOAD_SIZE_BYTES = Number(process.env.MAX_UPLOAD_SIZE_BYTES || DEFAULT_MAX_UPLOAD_SIZE_BYTES);
const MAX_MEDIA_FILES = Number(process.env.MAX_MEDIA_FILES || 2000);
const DEFAULT_VIDEO_MAX_WIDTH = 1920;
const DEFAULT_VIDEO_MAX_FPS = 30;
const VIDEO_MAX_WIDTH = Number(process.env.VIDEO_MAX_WIDTH || DEFAULT_VIDEO_MAX_WIDTH);
const VIDEO_MAX_FPS = Number(process.env.VIDEO_MAX_FPS || DEFAULT_VIDEO_MAX_FPS);
const safeVideoMaxWidth = Number.isFinite(VIDEO_MAX_WIDTH) && VIDEO_MAX_WIDTH > 0 ? Math.round(VIDEO_MAX_WIDTH) : DEFAULT_VIDEO_MAX_WIDTH;
const safeVideoMaxFps = Number.isFinite(VIDEO_MAX_FPS) && VIDEO_MAX_FPS > 0 ? VIDEO_MAX_FPS : DEFAULT_VIDEO_MAX_FPS;
const ALLOWED_UPLOAD_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/avi',
  'video/x-matroska',
  'video/webm',
  'application/octet-stream',
]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov', '.mkv', '.webm']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', ...VIDEO_EXTENSIONS]);
const hotspotConnectionName = process.env.HOTSPOT_CONNECTION_NAME || 'PixFlow-Hotspot';
let hotspotEnabledRuntime = true;

app.use(cors());
app.use(express.json());
app.use('/media', express.static(mediaDir, {
  maxAge: '7d',
  immutable: true,
  setHeaders: (res, filePath) => {
    res.setHeader('Accept-Ranges', 'bytes');

    if (VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    cb(null, incomingDir);
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const isAllowedUpload = (file) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return false;

  if (file.mimetype.startsWith('image/')) return true;
  if (file.mimetype.startsWith('video/')) return ALLOWED_UPLOAD_TYPES.has(file.mimetype);
  if (file.mimetype === 'application/octet-stream') return VIDEO_EXTENSIONS.has(ext);

  return false;
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedUpload(file)) {
      cb(new Error('unsupported file type'));
      return;
    }
    cb(null, true);
  },
});

const ensureFiles = async () => {
  await fs.mkdir(incomingDir, { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.mkdir(projectsDir, { recursive: true });
  for (const [filePath, initial] of [[projectsFile, []], [mediaFile, []], [playlistFile, []], [settingsFile, { wifi: { ssid: 'PixFlow', password: 'pixflow1234' } }]]) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, JSON.stringify(initial, null, 2));
    }
  }
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));
const writeJson = async (filePath, payload) => fs.writeFile(filePath, JSON.stringify(payload, null, 2));

const mediaTypeFromName = (filename, mimetype = '') => {
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('image/')) return 'image';
  const ext = path.extname(filename).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext) ? 'video' : 'image';
};

const toHmsSeconds = (value) => {
  const [hours, minutes, seconds] = String(value).split(':');
  const h = Number(hours || 0);
  const m = Number(minutes || 0);
  const s = Number(seconds || 0);
  return (h * 3600) + (m * 60) + s;
};

const ffprobeDuration = (inputPath) => new Promise((resolve, reject) => {
  let stdout = '';
  let stderr = '';
  const probe = spawn('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    inputPath,
  ]);

  probe.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  probe.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  probe.on('error', reject);
  probe.on('close', (code) => {
    if (code !== 0) {
      reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      return;
    }
    const duration = Number.parseFloat(stdout.trim());
    resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
  });
});

const runFfmpeg = (inputPath, outputPath, { onProgress } = {}) => new Promise((resolve, reject) => {
  let stderr = '';
  const videoFilter = `fps=${safeVideoMaxFps},scale='min(${safeVideoMaxWidth},iw)':-2`;
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'main',
    '-level', '4.0',
    '-vf', videoFilter,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  ]);

  ffmpeg.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      console.log(`[ffmpeg] ${line}`);
      if (onProgress) onProgress(line);
    }
  });

  ffmpeg.on('error', reject);
  ffmpeg.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
  });
});

const normalizeMedia = (item) => ({
  ...item,
  status: item.status || 'ready',
  progress: item.progress ?? 100,
});

const updateMediaItem = async (mediaId, updater) => {
  const media = await readJson(mediaFile);
  const item = media.find((entry) => entry.id === mediaId);
  if (!item) return null;
  updater(item);
  await writeJson(mediaFile, media);
  return item;
};

const processVideoInBackground = async (mediaId, inputPath, outputPath, finalName) => {
  let durationSeconds = null;
  try {
    durationSeconds = await ffprobeDuration(inputPath);
  } catch (error) {
    console.warn('ffprobe failed, conversion progress will be approximate:', error.message);
  }

  let lastStoredProgress = 0;
  let lastStoredAt = 0;
  const storeProgress = async (progress) => {
    const bounded = Math.min(99, Math.max(0, Number(progress) || 0));
    const now = Date.now();
    if (bounded <= lastStoredProgress && now - lastStoredAt < 1_500) return;
    lastStoredProgress = bounded;
    lastStoredAt = now;
    await updateMediaItem(mediaId, (item) => {
      item.progress = bounded;
      item.status = 'processing';
      item.error = null;
    });
  };

  try {
    await runFfmpeg(inputPath, outputPath, {
      onProgress: (line) => {
        const match = line.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
        if (!match || !durationSeconds) return;
        const current = toHmsSeconds(match[1]);
        const percent = Math.round((current / durationSeconds) * 100);
        storeProgress(percent).catch((error) => {
          console.warn('failed to persist ffmpeg progress:', error.message);
        });
      },
    });

    await updateMediaItem(mediaId, (item) => {
      item.file = finalName;
      item.status = 'ready';
      item.progress = 100;
      item.error = null;
      item.incomingFile = null;
      item.sourceFile = null;
    });

    await fs.rm(inputPath, { force: true });
    await buildPlaylist();
  } catch (error) {
    await fs.rm(outputPath, { force: true });
    await updateMediaItem(mediaId, (item) => {
      item.status = 'failed';
      item.progress = Math.max(item.progress ?? 0, 1);
      item.error = error.message;
    });
    await buildPlaylist();
    throw error;
  }
};

const buildPlaylist = async () => {
  const projects = await readJson(projectsFile);
  const media = await readJson(mediaFile);
  const activeProjectIds = new Set(projects.filter((p) => p.active).map((p) => p.id));
  const playlist = media
    .filter((m) => {
      const status = m.status || 'ready';
      return m.active && status === 'ready' && m.file && activeProjectIds.has(m.projectId);
    })
    .map((m) => ({
      type: m.type,
      file: `/media/${m.file}`,
      ...(m.type === 'image' ? { duration: m.duration || 5 } : {}),
    }));

  await writeJson(playlistFile, playlist);
  return playlist;
};

const ensureMediaCapacity = async () => {
  const media = await readJson(mediaFile);
  if (media.length >= MAX_MEDIA_FILES) {
    const err = new Error(`media storage limit reached (${MAX_MEDIA_FILES} files)`);
    err.status = 400;
    throw err;
  }
};

const runCommand = (command, args = []) => new Promise((resolve, reject) => {
  const child = spawn(command, args);
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve({ stdout, stderr });
      return;
    }
    reject(new Error(`${command} ${args.join(' ')} failed with code ${code}: ${stderr || stdout}`));
  });
});

const hasCommand = async (command) => {
  try {
    await runCommand('which', [command]);
    return true;
  } catch {
    return false;
  }
};

const detectHotspotControlBackend = async () => {
  if (await hasCommand('nmcli')) return 'nmcli';
  if (await hasCommand('systemctl')) return 'systemctl';
  return null;
};

async function isEthernetConnected() {
  try {
    const interfaces = await fs.readdir('/sys/class/net');
    const ethernetCandidates = interfaces.filter((iface) => iface === 'eth0' || iface.startsWith('enx') || iface.startsWith('en'));

    for (const iface of ethernetCandidates) {
      const carrierPath = `/sys/class/net/${iface}/carrier`;
      try {
        const carrier = (await fs.readFile(carrierPath, 'utf8')).trim();
        if (carrier === '1') return true;
      } catch {
        // Ignore missing carrier files for virtual/unsupported interfaces.
      }
    }
  } catch (error) {
    console.warn('[PixFlow] Failed to detect ethernet state:', error.message);
  }

  return false;
}

async function enableHotspot() {
  const backend = await detectHotspotControlBackend();
  if (!backend) throw new Error('No hotspot control backend available');

  if (backend === 'nmcli') {
    await runCommand('nmcli', ['connection', 'up', hotspotConnectionName]);
  } else {
    try {
      await runCommand('systemctl', ['start', 'hostapd']);
      await runCommand('systemctl', ['start', 'dnsmasq']);
    } catch {
      await runCommand('sudo', ['systemctl', 'start', 'hostapd']);
      await runCommand('sudo', ['systemctl', 'start', 'dnsmasq']);
    }
  }
}

async function disableHotspot() {
  const backend = await detectHotspotControlBackend();
  if (!backend) throw new Error('No hotspot control backend available');

  if (backend === 'nmcli') {
    await runCommand('nmcli', ['connection', 'down', hotspotConnectionName]);
  } else {
    try {
      await runCommand('systemctl', ['stop', 'hostapd']);
      await runCommand('systemctl', ['stop', 'dnsmasq']);
    } catch {
      await runCommand('sudo', ['systemctl', 'stop', 'hostapd']);
      await runCommand('sudo', ['systemctl', 'stop', 'dnsmasq']);
    }
  }
}

const buildSettingsResponse = async () => {
  const settings = await readJson(settingsFile);
  const ethernetConnected = await isEthernetConnected();
  const wifi = settings.wifi || {};
  return {
    ...settings,
    wifi: {
      ...wifi,
      hotspotEnabled: hotspotEnabledRuntime,
      ethernetConnected,
    },
  };
};

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/projects', async (_req, res, next) => {
  try {
    const projects = await readJson(projectsFile);
    res.json(projects);
  } catch (error) { next(error); }
});

app.post('/projects', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const projects = await readJson(projectsFile);
    const project = { id: nanoid(), name, active: true };
    projects.push(project);
    await writeJson(projectsFile, projects);
    await buildPlaylist();
    res.status(201).json(project);
  } catch (error) { next(error); }
});

app.patch('/projects/:id/active', async (req, res, next) => {
  try {
    const projects = await readJson(projectsFile);
    const project = projects.find((p) => p.id === req.params.id);
    if (!project) return res.status(404).json({ error: 'project not found' });
    project.active = Boolean(req.body.active);
    await writeJson(projectsFile, projects);
    await buildPlaylist();
    res.json(project);
  } catch (error) { next(error); }
});

app.delete('/projects/:id', async (req, res, next) => {
  try {
    let projects = await readJson(projectsFile);
    const idx = projects.findIndex((p) => p.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'project not found' });
    projects.splice(idx, 1);
    await writeJson(projectsFile, projects);

    let media = await readJson(mediaFile);
    const orphaned = media.filter((m) => m.projectId === req.params.id);
    media = media.filter((m) => m.projectId !== req.params.id);
    await writeJson(mediaFile, media);
    for (const item of orphaned) {
      if (item.file) await fs.rm(path.join(mediaDir, item.file), { force: true });
      if (item.incomingFile) await fs.rm(path.join(incomingDir, item.incomingFile), { force: true });
      if (item.sourceFile) await fs.rm(path.join(incomingDir, item.sourceFile), { force: true });
    }

    await buildPlaylist();
    res.status(204).send();
  } catch (error) { next(error); }
});

app.get('/media', async (req, res, next) => {
  try {
    const media = await readJson(mediaFile);
    const filtered = req.query.projectId ? media.filter((m) => m.projectId === req.query.projectId) : media;
    res.json(filtered.map(normalizeMedia));
  } catch (error) { next(error); }
});

app.post('/media/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { projectId, duration } = req.body;
    if (!projectId || !req.file) return res.status(400).json({ error: 'projectId and file are required' });
    await ensureMediaCapacity();

    const media = await readJson(mediaFile);
    const inputPath = path.join(incomingDir, req.file.filename);
    const isVideo = mediaTypeFromName(req.file.originalname, req.file.mimetype) === 'video';

    const item = {
      id: nanoid(),
      projectId,
      type: isVideo ? 'video' : 'image',
      file: null,
      active: true,
      duration: Number(duration || 5),
      status: isVideo ? 'processing' : 'ready',
      progress: isVideo ? 0 : 100,
      error: null,
      incomingFile: isVideo ? req.file.filename : null,
      sourceFile: isVideo ? req.file.filename : null,
    };

    if (isVideo) {
      const finalName = `${nanoid()}-${path.basename(req.file.filename, path.extname(req.file.filename))}.mp4`;
      const outputPath = path.join(mediaDir, finalName);
      item.file = finalName;
      media.push(item);
      await writeJson(mediaFile, media);
      await buildPlaylist();
      processVideoInBackground(item.id, inputPath, outputPath, finalName)
        .catch((error) => console.error('background video processing crashed:', error));
      return res.status(201).json(normalizeMedia(item));
    }

    const finalName = `${nanoid()}-${req.file.filename}`;
    await fs.rename(inputPath, path.join(mediaDir, finalName));
    item.file = finalName;
    item.incomingFile = null;
    item.sourceFile = null;
    media.push(item);
    await writeJson(mediaFile, media);
    await buildPlaylist();
    res.status(201).json(normalizeMedia(item));
  } catch (error) { next(error); }
});

app.patch('/media/:id/active', async (req, res, next) => {
  try {
    const media = await readJson(mediaFile);
    const item = media.find((m) => m.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'media not found' });
    const status = item.status || 'ready';
    if (req.body.active && status !== 'ready') {
      return res.status(400).json({ error: 'media is not ready' });
    }
    item.active = Boolean(req.body.active);
    await writeJson(mediaFile, media);
    await buildPlaylist();
    res.json(normalizeMedia(item));
  } catch (error) { next(error); }
});

app.patch('/media/:id', async (req, res, next) => {
  try {
    const media = await readJson(mediaFile);
    const item = media.find((m) => m.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'media not found' });
    if (req.body.duration !== undefined) item.duration = Number(req.body.duration);
    if (req.body.active !== undefined) {
      const status = item.status || 'ready';
      if (req.body.active && status !== 'ready') {
        return res.status(400).json({ error: 'media is not ready' });
      }
      item.active = Boolean(req.body.active);
    }
    await writeJson(mediaFile, media);
    await buildPlaylist();
    res.json(normalizeMedia(item));
  } catch (error) { next(error); }
});

app.delete('/media/:id', async (req, res, next) => {
  try {
    const media = await readJson(mediaFile);
    const idx = media.findIndex((m) => m.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'media not found' });
    const [item] = media.splice(idx, 1);
    await writeJson(mediaFile, media);
    if (item.file) await fs.rm(path.join(mediaDir, item.file), { force: true });
    if (item.incomingFile) await fs.rm(path.join(incomingDir, item.incomingFile), { force: true });
    if (item.sourceFile) await fs.rm(path.join(incomingDir, item.sourceFile), { force: true });
    await buildPlaylist();
    res.status(204).send();
  } catch (error) { next(error); }
});

app.get('/playlist', async (_req, res, next) => {
  try {
    const playlist = await buildPlaylist();
    res.json(playlist);
  } catch (error) { next(error); }
});

app.get('/settings', async (_req, res, next) => {
  try {
    const settings = await buildSettingsResponse();
    res.json(settings);
  } catch (error) { next(error); }
});

app.patch('/settings/wifi', async (req, res, next) => {
  try {
    const { ssid, password } = req.body || {};

    if (typeof ssid !== 'string') {
      return res.status(400).json({ error: 'ssid must be a string' });
    }

    const trimmedSsid = ssid.trim();
    if (!trimmedSsid) {
      return res.status(400).json({ error: 'ssid is required' });
    }

    if (trimmedSsid.length > 32) {
      return res.status(400).json({ error: 'ssid must be 32 characters or fewer' });
    }

    if (typeof password !== 'string') {
      return res.status(400).json({ error: 'password must be a string' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'password must be at least 8 characters' });
    }

    if (password.length > 63) {
      return res.status(400).json({ error: 'password must be 63 characters or fewer' });
    }

    const settings = await readJson(settingsFile);

    settings.wifi = {
      ...(settings.wifi || {}),
      ssid: trimmedSsid,
      password,
    };

    // TODO: Apply Wi-Fi hotspot settings to the Raspberry Pi host system through a controlled host-side service.
    // For now, PixFlow only stores the desired hotspot configuration in /data/settings.json.
    await writeJson(settingsFile, settings);

    res.json(await buildSettingsResponse());
  } catch (error) { next(error); }
});

app.patch('/settings/hotspot', async (req, res, next) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    if (enabled) {
      await enableHotspot();
    } else {
      await disableHotspot();
    }

    hotspotEnabledRuntime = enabled;
    res.json(await buildSettingsResponse());
  } catch (error) {
    console.error('[PixFlow] Failed to toggle hotspot:', error);
    res.status(500).json({ error: 'Impossible de modifier l’état du hotspot Wi-Fi.' });
  }
});


app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const maxSizeMb = Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024));
      return res.status(400).json({ error: `file too large (max ${maxSizeMb}MB)` });
    }
    return res.status(400).json({ error: error.message });
  }
  if (error.message === 'unsupported file type') {
    return res.status(400).json({ error: 'unsupported file type. allowed extensions: .jpg, .jpeg, .png, .webp, .mp4, .avi' });
  }
  if (error.status) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error(error);
  res.status(500).json({ error: 'internal server error' });
});

ensureFiles().then(() => {
  console.log('[PixFlow] Ensuring hotspot is enabled on startup');
  enableHotspot()
    .then(() => {
      hotspotEnabledRuntime = true;
      console.log('[PixFlow] Hotspot enabled on startup');
    })
    .catch((error) => {
      console.warn('[PixFlow] Unable to enable hotspot on startup:', error.message);
    });

  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend listening on ${port}`);
  });
});
