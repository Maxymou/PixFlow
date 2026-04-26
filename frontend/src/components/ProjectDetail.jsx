import React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { API_BASE, api } from '../api';

export function ProjectDetail({ projects }) {
  const { id } = useParams();
  const [media, setMedia] = useState([]);
  const [duration, setDuration] = useState(5);
  const project = useMemo(() => projects.find((p) => p.id === id), [projects, id]);

  const loadMedia = async () => setMedia(await api(`/media?projectId=${id}`));
  useEffect(() => { loadMedia(); }, [id]);

  const upload = async (files) => {
    const file = files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('projectId', id);
    form.append('duration', duration);
    await fetch(`${API_BASE}/media/upload`, { method: 'POST', body: form });
    await loadMedia();
  };

  const toggle = async (item) => {
    await api(`/media/${item.id}/active`, { method: 'PATCH', body: JSON.stringify({ active: !item.active }) });
    loadMedia();
  };

  const remove = async (item) => {
    await api(`/media/${item.id}`, { method: 'DELETE' });
    loadMedia();
  };

  return (
    <section className="space-y-4">
      <Link to="/" className="text-cyan-300">← Back</Link>
      <h2 className="text-xl font-semibold">{project?.name || 'Project'}</h2>

      <div
        className="rounded-xl border-2 border-dashed border-violet-500/40 bg-card p-6 text-center"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          upload(e.dataTransfer.files);
        }}
      >
        <p className="mb-2">Drag & drop media files here</p>
        <input type="file" accept="image/*,video/*" onChange={(e) => upload(e.target.files)} className="mx-auto" />
        <label className="mt-3 block text-sm text-slate-300">
          Image duration (seconds)
          <input type="number" min="1" value={duration} onChange={(e) => setDuration(Number(e.target.value))}
            className="ml-2 w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1" />
        </label>
      </div>

      <div className="space-y-2">
        {media.map((item) => (
          <article key={item.id} className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/70 p-3">
            <div>
              <p className="font-medium">{item.file}</p>
              <p className="text-xs text-slate-400">{item.type} • {item.active ? 'active' : 'inactive'}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => toggle(item)} className="rounded border border-cyan-400/40 px-2 py-1 text-xs">Toggle</button>
              <button onClick={() => remove(item)} className="rounded border border-rose-400/40 px-2 py-1 text-xs text-rose-300">Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
