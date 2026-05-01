import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ToggleSwitch } from './ToggleSwitch';

export function Dashboard({ projects, onRefresh }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyProjectIds, setBusyProjectIds] = useState(new Set());
  const [kioskStatus, setKioskStatus] = useState({
    online: false,
    status: 'offline',
    message: 'No kiosk heartbeat received',
    lastSeenAt: null,
  });
  const [kioskPreview, setKioskPreview] = useState({
    available: false,
    message: 'No preview available',
  });
  const [kioskCommandLoading, setKioskCommandLoading] = useState(false);

  const activeCount = projects.filter((p) => p.active).length;
  const inactiveCount = projects.length - activeCount;

  const previewAgeSeconds = useMemo(() => {
    if (!kioskPreview?.capturedAt) return null;
    const ts = new Date(kioskPreview.capturedAt).getTime();
    if (!Number.isFinite(ts)) return null;
    return Math.max(0, Math.floor((Date.now() - ts) / 1000));
  }, [kioskPreview?.capturedAt]);
  const previewIsStale = (previewAgeSeconds ?? 0) > 30;
  const kioskIsOffline = kioskStatus.status === 'offline' || kioskStatus.online === false;
  const pausePlayCommand = ['paused', 'stopped'].includes(kioskStatus.status) ? 'play' : 'pause';
  const pausePlayLabel = pausePlayCommand === 'play' ? 'Play' : 'Pause';

  useEffect(() => {
    let active = true;
    const fetchKioskStatusAndPreview = async () => {
      try {
        const [statusPayload, previewPayload] = await Promise.all([
          api('/api/kiosk/status'),
          api('/api/kiosk/preview'),
        ]);
        if (!active) return;
        setKioskStatus(statusPayload);
        setKioskPreview(previewPayload);
      } catch {
        if (!active) return;
        setKioskStatus((current) => ({
          ...current,
          online: false,
          status: 'offline',
          message: 'Kiosk status unavailable',
        }));
      }
    };

    fetchKioskStatusAndPreview();
    const id = setInterval(fetchKioskStatusAndPreview, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const createProject = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
      setName('');
      onRefresh();
    } finally {
      setCreating(false);
    }
  };

  const toggleProject = async (project) => {
    if (busyProjectIds.has(project.id)) return;

    setBusyProjectIds((prev) => new Set(prev).add(project.id));
    try {
      await api(`/api/projects/${project.id}/active`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !project.active }),
      });
      await onRefresh();
    } finally {
      setBusyProjectIds((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });
    }
  };

  const deleteProject = async (project) => {
    if (!confirm(`Delete "${project.name}" and all its media?`)) return;
    await api(`/api/projects/${project.id}`, { method: 'DELETE' });
    onRefresh();
  };

  const sendKioskCommand = async (command) => {
    if (kioskCommandLoading || kioskIsOffline) return;
    setKioskCommandLoading(true);
    try {
      await api('/api/kiosk/command', { method: 'POST', body: JSON.stringify({ command }) });
    } catch {
      // Keep the dashboard non-blocking on control call failures.
    } finally {
      setKioskCommandLoading(false);
    }
  };

  return (
    <div className="animate-slide-up space-y-6">
      {/* ── Projects overview ─────────────────────────── */}
      <div className="card border-slate-800/90">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Projects overview
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="space-y-2">
            <div className="flex items-center justify-end gap-2">
              {kioskStatus.online === false && (
                <span className="rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-xs text-rose-300">Offline</span>
              )}
              {kioskPreview.available && previewIsStale && kioskStatus.online && (
                <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">Stale</span>
              )}
            </div>
            {kioskPreview.available ? (
              <div className="overflow-hidden rounded-xl border border-slate-700 bg-black/40">
                <img src={kioskPreview.imageDataUrl} alt="Kiosk live preview" className="h-44 w-full object-contain" />
              </div>
            ) : (
              <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-950/20 px-3 text-center text-sm text-slate-400">
                {kioskStatus.online ? 'No preview available' : 'Kiosk offline'}
              </div>
            )}
          </div>

          <div className="space-y-3 sm:w-44">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <button
                type="button"
                disabled={kioskIsOffline || kioskCommandLoading}
                onClick={() => sendKioskCommand(pausePlayCommand)}
                className="rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-sm font-medium text-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {kioskCommandLoading ? '…' : pausePlayLabel}
              </button>
              <button
                type="button"
                disabled={kioskIsOffline || kioskCommandLoading}
                onClick={() => sendKioskCommand('stop')}
                className="rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {kioskCommandLoading ? '…' : 'Arrêter'}
              </button>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-slate-300">
                <span>Total</span>
                <span className="font-semibold text-slate-100">{projects.length}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-emerald-300">
                <span>Active</span>
                <span className="font-semibold text-emerald-200">{activeCount}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-slate-400">
                <span>Inactive</span>
                <span className="font-semibold text-slate-300">{inactiveCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Create project ─────────────────────────────────── */}
      <form
        onSubmit={createProject}
        className="card border-cyan-500/20 shadow-glow-cyan/5"
      >
        <label className="mb-3 block text-sm font-medium text-cyan-300">
          New Project
        </label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input flex-1"
            placeholder="e.g. Event Hall Screens"
          />
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="btn-primary"
          >
            {creating ? '…' : '+ Add'}
          </button>
        </div>
      </form>

      {/* ── Project list ───────────────────────────────────── */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-600">
          Projects ({projects.length})
        </p>

        {projects.length === 0 ? (
          <EmptyProjects />
        ) : (
          <ul className="space-y-2">
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                isToggling={busyProjectIds.has(p.id)}
                onToggle={toggleProject}
                onDelete={deleteProject}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ProjectRow({ project, isToggling, onToggle, onDelete }) {
  return (
    <li className="card-interactive flex items-center justify-between gap-3">
      {/* Status dot + name */}
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`h-2 w-2 flex-shrink-0 rounded-full transition-all ${
            project.active
              ? 'bg-emerald-400 shadow-glow-green'
              : 'bg-slate-600'
          }`}
        />
        <div className="min-w-0">
          <h3 className="truncate font-medium text-slate-100">{project.name}</h3>
          <span className={project.active ? 'badge-active' : 'badge-inactive'}>
            {project.active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-shrink-0 items-center gap-1.5">
        <div className="mr-2">
          <ToggleSwitch
            checked={project.active}
            disabled={isToggling}
            ariaLabel={`Set project ${project.name} as ${project.active ? 'inactive' : 'active'}`}
            onChange={() => onToggle(project)}
          />
        </div>
        <Link to={`/projects/${project.id}`} className="btn-violet">
          Manage
        </Link>
        <button
          onClick={() => onDelete(project)}
          className="btn-danger"
          title="Delete project"
        >
          ✕
        </button>
      </div>
    </li>
  );
}

function EmptyProjects() {
  return (
    <div className="card flex flex-col items-center py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-2xl opacity-50">
        📁
      </div>
      <p className="text-sm font-medium text-slate-400">No projects yet</p>
      <p className="mt-1 text-xs text-slate-600">
        Create your first project above to get started.
      </p>
    </div>
  );
}
