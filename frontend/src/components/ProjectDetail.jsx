import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE, api } from '../api';
import { ToggleSwitch } from './ToggleSwitch';

export function ProjectDetail({ projects, onRefresh }) {
  const { id } = useParams();
  const [media, setMedia] = useState([]);
  const [duration, setDuration] = useState(5);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [togglingMediaIds, setTogglingMediaIds] = useState(new Set());
  const [togglingProject, setTogglingProject] = useState(false);
  const fileRef = useRef(null);

  const project = useMemo(() => projects.find((p) => p.id === id), [projects, id]);

  const loadMedia = useCallback(async () => {
    const items = await api(`/api/media?projectId=${id}`);
    setMedia(items);
  }, [id]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  const hasProcessingMedia = useMemo(
    () => media.some((item) => (item.status || 'ready') === 'processing'),
    [media],
  );

  useEffect(() => {
    if (!hasProcessingMedia) return undefined;
    const timer = setInterval(() => {
      loadMedia();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasProcessingMedia, loadMedia]);

  const upload = useCallback(
    async (files) => {
      const file = files?.[0];
      if (!file || uploading) return;
      setUploading(true);
      setUploadComplete(false);
      setUploadFileName(file.name || '');
      setUploadProgress(1);
      setUploadError('');
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('projectId', id);
        form.append('duration', duration);
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', `${API_BASE}/api/media/upload`);
          xhr.responseType = 'json';

          xhr.upload.onprogress = (event) => {
            if (!event.lengthComputable) return;
            const percent = Math.max(1, Math.round((event.loaded / event.total) * 100));
            setUploadProgress(percent);
          };

          xhr.onload = () => {
            const payload = xhr.response || {};
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadProgress(100);
              setUploadComplete(true);
              resolve(payload);
              return;
            }
            if (xhr.status === 413) {
              reject(new Error('Fichier trop volumineux. La limite actuelle est de 500 MB.'));
              return;
            }
            reject(new Error(payload.error || `Erreur serveur pendant l’upload (${xhr.status}).`));
          };

          xhr.onerror = () => reject(new Error('Erreur réseau pendant l’upload.'));
          xhr.send(form);
        });
        await loadMedia();
      } catch (error) {
        setUploadError(error.message || 'Upload failed');
      } finally {
        setTimeout(() => {
          setUploading(false);
          setUploadComplete(false);
          setUploadProgress(0);
          setUploadFileName('');
        }, 1500);
      }
    },
    [id, duration, uploading, loadMedia],
  );

  const toggle = async (item) => {
    if (togglingMediaIds.has(item.id)) return;

    setTogglingMediaIds((prev) => new Set(prev).add(item.id));
    try {
      await api(`/api/media/${item.id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !item.active }),
      });
      await loadMedia();
    } finally {
      setTogglingMediaIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const remove = async (item) => {
    const label = item.originalName || item.file || item.sourceFile || item.id;
    if (!confirm(`Delete "${label}"?`)) return;
    await api(`/api/media/${item.id}`, { method: 'DELETE' });
    loadMedia();
  };

  const updateDuration = async (item, newDuration) => {
    await api(`/api/media/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ duration: newDuration }),
    });
    loadMedia();
  };

  const activeCount = media.filter((m) => m.active && (m.status || 'ready') === 'ready').length;

  const toggleProject = async () => {
    if (!project || togglingProject) return;

    setTogglingProject(true);
    try {
      await api(`/api/projects/${project.id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !project.active }),
      });
      await onRefresh();
    } finally {
      setTogglingProject(false);
    }
  };

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="btn-ghost flex-shrink-0">
          ← Back
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-xl font-semibold text-slate-100">
              {project?.name ?? 'Project'}
            </h2>
            <span className={project?.active ? 'badge-active' : 'badge-inactive'}>
              {project?.active ? 'Live' : 'Inactive'}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            {activeCount}/{media.length} media active
          </p>
        </div>
        <div className="ml-auto flex flex-shrink-0 items-center">
          <ToggleSwitch
            checked={Boolean(project?.active)}
            disabled={!project || togglingProject}
            ariaLabel={`Set project ${project?.name ?? 'project'} as ${project?.active ? 'inactive' : 'active'}`}
            onChange={toggleProject}
          />
        </div>
      </div>

      <div
        className={`relative cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-all
          ${isDragging
            ? 'border-cyan-400 bg-cyan-950/25 shadow-glow-cyan'
            : 'border-slate-700 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-900/70'}
          ${uploading ? 'pointer-events-none opacity-60' : ''}
        `}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          upload(e.dataTransfer.files);
        }}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => upload(e.target.files)}
        />

        <div className="mb-3 text-3xl opacity-60">
          {uploading ? '⏳' : isDragging ? '📥' : '⬆'}
        </div>
        <p className="text-sm font-medium text-slate-300">
          {uploading
            ? 'Uploading…'
            : isDragging
            ? 'Drop to upload'
            : 'Drag & drop or click to upload'}
        </p>
        <p className="mt-1 text-xs text-slate-500">Images and videos supported</p>

        {uploadError && (
          <p className="mt-2 text-sm text-rose-400">{uploadError}</p>
        )}

        {(uploading || uploadComplete) && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>{uploadComplete ? 'Upload terminé' : 'Upload en cours…'}</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-cyan-400 transition-all"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
            {uploadFileName && (
              <p className="mt-1 truncate text-xs text-slate-500">{uploadFileName}</p>
            )}
          </div>
        )}

        <div
          className="mt-5 inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="text-xs text-slate-400">Image display time</span>
          <input
            type="number"
            min="1"
            max="3600"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="input-sm w-14"
          />
          <span className="text-xs text-slate-500">sec</span>
        </div>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-600">
          Media Files ({media.length})
        </p>

        {media.length === 0 ? (
          <EmptyMedia />
        ) : (
          <ul className="space-y-2">
            {media.map((item) => (
              <MediaRow
                key={item.id}
                item={item}
                onToggle={toggle}
                isToggling={togglingMediaIds.has(item.id)}
                onRemove={remove}
                onDurationChange={updateDuration}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MediaRow({ item, isToggling, onToggle, onRemove, onDurationChange }) {
  const [editingDur, setEditingDur] = useState(false);
  const [dur, setDur] = useState(item.duration ?? 5);
  const status = item.status || 'ready';
  const isReady = status === 'ready';
  const previewUrl = item.file ? `${API_BASE}/media/${item.file}` : '';
  const fileLabel = item.originalName || item.file || item.sourceFile || 'pending';

  const saveDuration = () => {
    onDurationChange(item, dur);
    setEditingDur(false);
  };

  return (
    <li
      className={`card-interactive flex items-center gap-3 ${
        !item.active || !isReady ? 'opacity-50' : ''
      }`}
    >
      <div className="h-12 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-slate-800">
        {item.type === 'image' ? (
          <img
            src={previewUrl}
            alt=""
            className="h-full w-full object-cover"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-500">
            <span className="text-lg">▶</span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p
          className="truncate text-sm font-medium text-slate-200"
          title={fileLabel}
        >
          {fileLabel}
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <span className="text-xs capitalize text-slate-500">{item.type}</span>

          {item.type === 'image' && (
            <span className="text-xs text-slate-500">
              {editingDur ? (
                <span
                  className="inline-flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    autoFocus
                    type="number"
                    min="1"
                    value={dur}
                    onChange={(e) => setDur(Number(e.target.value))}
                    onBlur={saveDuration}
                    onKeyDown={(e) => e.key === 'Enter' && saveDuration()}
                    className="input-sm w-12"
                  />
                  <span>s</span>
                </span>
              ) : (
                <button
                  className="transition-colors hover:text-cyan-400"
                  title="Click to edit duration"
                  onClick={() => setEditingDur(true)}
                >
                  {item.duration ?? 5}s
                </button>
              )}
            </span>
          )}

          <span className={item.active && isReady ? 'badge-active' : 'badge-inactive'}>
            {item.active && isReady ? 'Active' : 'Inactive'}
          </span>
          {status === 'processing' && (
            <span className="text-xs text-amber-300">Conversion en cours…</span>
          )}
          {status === 'failed' && (
            <span className="text-xs text-rose-400">Conversion échouée</span>
          )}
        </div>
        {item.type === 'video' && status === 'processing' && (
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-xs text-amber-300">
              <span>Conversion en cours…</span>
              <span>{item.progress ?? 0}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-amber-400 transition-all"
                style={{ width: `${item.progress ?? 0}%` }}
              />
            </div>
          </div>
        )}
        {status === 'failed' && item.error && (
          <p className="mt-1 text-xs text-rose-300">{item.error}</p>
        )}
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        <ToggleSwitch
          checked={item.active}
          disabled={!isReady || isToggling}
          ariaLabel={
            status === 'processing'
              ? 'Media processing in progress'
              : status === 'failed'
              ? 'Media conversion failed'
              : `Set media ${fileLabel} as ${item.active ? 'inactive' : 'active'}`
          }
          onChange={() => isReady && onToggle(item)}
        />
        <button onClick={() => onRemove(item)} className="btn-danger" title="Delete">
          ✕
        </button>
      </div>
    </li>
  );
}

function EmptyMedia() {
  return (
    <div className="card flex flex-col items-center py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-2xl opacity-50">
        🖼
      </div>
      <p className="text-sm font-medium text-slate-400">No media files yet</p>
      <p className="mt-1 text-xs text-slate-600">Upload images or videos above.</p>
    </div>
  );
}
