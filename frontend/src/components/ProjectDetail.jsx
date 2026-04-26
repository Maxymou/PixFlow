import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE, api } from '../api';

export function ProjectDetail({ projects, onRefresh }) {
  const { id } = useParams();
  const [media, setMedia] = useState([]);
  const [duration, setDuration] = useState(5);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileRef = useRef(null);

  const project = useMemo(() => projects.find((p) => p.id === id), [projects, id]);

  const loadMedia = useCallback(async () => {
    const items = await api(`/api/media?projectId=${id}`);
    setMedia(items);
  }, [id]);

  useEffect(() => { loadMedia(); }, [loadMedia]);

  const upload = useCallback(
    async (files) => {
      const file = files?.[0];
      if (!file || uploading) return;
      setUploading(true);
      setUploadError('');
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('projectId', id);
        form.append('duration', duration);
        const res = await fetch(`${API_BASE}/api/media/upload`, { method: 'POST', body: form });
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || 'Upload failed');
        }
        await loadMedia();
      } catch (error) {
        setUploadError(error.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [id, duration, uploading, loadMedia],
  );

  const toggle = async (item) => {
    await api(`/api/media/${item.id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !item.active }),
    });
    loadMedia();
  };

  const remove = async (item) => {
    if (!confirm(`Delete "${item.file}"?`)) return;
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

  const activeCount = media.filter((m) => m.active).length;

  return (
    <div className="animate-slide-up space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/" className="btn-ghost flex-shrink-0">
          ← Back
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-semibold text-slate-100">
            {project?.name ?? 'Project'}
          </h2>
          <p className="text-xs text-slate-500">
            {activeCount}/{media.length} media active
          </p>
        </div>
        <span className={project?.active ? 'badge-active' : 'badge-inactive'}>
          {project?.active ? 'Live' : 'Paused'}
        </span>
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

function MediaRow({ item, onToggle, onRemove, onDurationChange }) {
  const [editingDur, setEditingDur] = useState(false);
  const [dur, setDur] = useState(item.duration ?? 5);
  const previewUrl = `${API_BASE}/media/${item.file}`;

  const saveDuration = () => {
    onDurationChange(item, dur);
    setEditingDur(false);
  };

  return (
    <li
      className={`card-interactive flex items-center gap-3 ${
        !item.active ? 'opacity-50' : ''
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
          title={item.file}
        >
          {item.file}
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

          <span className={item.active ? 'badge-active' : 'badge-inactive'}>
            {item.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1.5">
        <button onClick={() => onToggle(item)} className="btn-ghost">
          {item.active ? 'Pause' : 'Enable'}
        </button>
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
