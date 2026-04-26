import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import path from 'path';

const app = express();
const port = Number(process.env.PORT || 4000);
const dataRoot = process.env.DATA_ROOT || '/data';
const incomingDir = path.join(dataRoot, 'incoming');
const mediaDir = path.join(dataRoot, 'media');
const projectsDir = path.join(dataRoot, 'projects');
const projectsFile = path.join(projectsDir, 'projects.json');
const mediaFile = path.join(projectsDir, 'media.json');
const playlistFile = path.join(dataRoot, 'playlist.json');

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
  }
});
const upload = multer({ storage });

const ensureFiles = async () => {
  await fs.mkdir(incomingDir, { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });
  await fs.mkdir(projectsDir, { recursive: true });
  for (const [filePath, initial] of [[projectsFile, []], [mediaFile, []], [playlistFile, []]]) {
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
  return ['.mp4', '.mov', '.mkv', '.webm'].includes(ext) ? 'video' : 'image';
};

const buildPlaylist = async () => {
  const projects = await readJson(projectsFile);
  const media = await readJson(mediaFile);
  const activeProjectIds = new Set(projects.filter((p) => p.active).map((p) => p.id));
  const playlist = media
    .filter((m) => m.active && activeProjectIds.has(m.projectId))
    .map((m) => ({
      type: m.type,
      file: `/media/${m.file}`,
      ...(m.type === 'image' ? { duration: m.duration || 5 } : {})
    }));

  await writeJson(playlistFile, playlist);
  return playlist;
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

    const media = await readJson(mediaFile);
    const finalName = `${nanoid()}-${req.file.filename}`;
    await fs.rename(path.join(incomingDir, req.file.filename), path.join(mediaDir, finalName));

    const item = {
      id: nanoid(),
      projectId,
      type: mediaTypeFromName(req.file.originalname, req.file.mimetype),
      file: finalName,
      active: true,
      duration: Number(duration || 5)
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

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'internal server error' });
});

ensureFiles().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Backend listening on ${port}`);
  });
});
