import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { ToggleSwitch } from './ToggleSwitch';

export function Dashboard({ projects, onRefresh }) {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyProjectIds, setBusyProjectIds] = useState(new Set());

  const activeCount = projects.filter((p) => p.active).length;
  const inactiveCount = projects.length - activeCount;

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

  return (
    <div className="animate-slide-up space-y-6">
      {/* ── Stats ──────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="stat-card">
          <span className="text-2xl font-bold text-slate-100">{projects.length}</span>
          <span className="text-xs text-slate-500">Projects</span>
        </div>
        <div className="stat-card">
          <span className="text-2xl font-bold text-emerald-400">{activeCount}</span>
          <span className="text-xs text-slate-500">Active</span>
        </div>
        <div className="stat-card">
          <span className="text-2xl font-bold text-slate-400">{inactiveCount}</span>
          <span className="text-xs text-slate-500">Inactive</span>
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
