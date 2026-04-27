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

app.use(cors());
app.use(express.json());
app.use('/media', express.static(mediaDir));

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

const runFfmpeg = (inputPath, outputPath) => new Promise((resolve, reject) => {
  let stderr = '';
  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'main',
    '-level', '4.0',
    '-vf', "scale='min(1920,iw)':-2",
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  ]);

  ffmpeg.stderr.on('data', (data) => {
    const text = data.toString();
    stderr += text;
    console.log(`[ffmpeg] ${text}`);
  });

  ffmpeg.on('error', reject);

  ffmpeg.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
  });
});

const buildPlaylist = async () => {
  const projects = await readJson(projectsFile);
  const media = await readJson(mediaFile);
  const activeProjectIds = new Set(projects.filter((p) => p.active).map((p) => p.id));
  const playlist = media
    .filter((m) => m.active && activeProjectIds.has(m.projectId))
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
      await fs.rm(path.join(mediaDir, item.file), { force: true });
    }

    await buildPlaylist();
    res.status(204).send();
  } catch (error) { next(error); }
});

app.get('/media', async (req, res, next) => {
  try {
    const media = await readJson(mediaFile);
    const filtered = req.query.projectId ? media.filter((m) => m.projectId === req.query.projectId) : media;
    res.json(filtered);
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

    let finalName;

    try {
      if (isVideo) {
        finalName = `${nanoid()}-${path.basename(req.file.filename, path.extname(req.file.filename))}.mp4`;
        const outputPath = path.join(mediaDir, finalName);
        await runFfmpeg(inputPath, outputPath);
        await fs.rm(inputPath, { force: true });
      } else {
        finalName = `${nanoid()}-${req.file.filename}`;
        await fs.rename(inputPath, path.join(mediaDir, finalName));
      }
    } catch (error) {
      await fs.rm(inputPath, { force: true });
      console.error('media processing failed:', error);
      return res.status(500).json({
        error: isVideo ? 'video conversion failed' : 'media processing failed',
        details: error.message,
      });
    }

    const item = {
      id: nanoid(),
      projectId,
      type: isVideo ? 'video' : 'image',
      file: finalName,
      active: true,
      duration: Number(duration || 5),
    };

    media.push(item);
    await writeJson(mediaFile, media);
    await buildPlaylist();
    res.status(201).json(item);
  } catch (error) { next(error); }
});

app.patch('/media/:id/active', async (req, res, next) => {
  try {
    const media = await readJson(mediaFile);
    const item = media.find((m) => m.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'media not found' });
    item.active = Boolean(req.body.active);
    await writeJson(mediaFile, media);
    await buildPlaylist();
    res.json(item);
  } catch (error) { next(error); }
});

app.patch('/media/:id', async (req, res, next) => {
  try {
    const media = await readJson(mediaFile);
    const item = media.find((m) => m.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'media not found' });
    if (req.body.duration !== undefined) item.duration = Number(req.body.duration);
    if (req.body.active !== undefined) item.active = Boolean(req.body.active);
    await writeJson(mediaFile, media);
    await buildPlaylist();
    res.json(item);
  } catch (error) { next(error); }
});

app.delete('/media/:id', async (req, res, next) => {
  try {
    const media = await readJson(mediaFile);
    const idx = media.findIndex((m) => m.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'media not found' });
    const [item] = media.splice(idx, 1);
    await writeJson(mediaFile, media);
    await fs.rm(path.join(mediaDir, item.file), { force: true });
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
    const settings = await readJson(settingsFile);
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

    res.json(settings);
  } catch (error) { next(error); }
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
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend listening on ${port}`);
  });
});
