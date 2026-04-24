import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export function Dashboard({ projects, onRefresh }) {
  const [name, setName] = useState('');

  const createProject = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await api('/projects', { method: 'POST', body: JSON.stringify({ name }) });
    setName('');
    onRefresh();
  };

  const toggleProject = async (project) => {
    await api(`/projects/${project.id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !project.active })
    });
    onRefresh();
  };

  return (
    <section className="space-y-6">
      <form onSubmit={createProject} className="rounded-xl border border-cyan-500/30 bg-card p-4 shadow-lg shadow-cyan-950/30">
        <label className="mb-2 block text-sm text-cyan-200">Create new project</label>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
            placeholder="Event Hall Screens"
          />
          <button className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950">Add</button>
        </div>
      </form>

      <div className="space-y-3">
        {projects.map((p) => (
          <article key={p.id} className="flex items-center justify-between rounded-xl border border-violet-500/20 bg-card p-4">
            <div>
              <h3 className="font-semibold">{p.name}</h3>
              <p className="text-xs text-slate-400">{p.active ? 'Active in playlist' : 'Inactive'}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleProject(p)} className="rounded-md border border-cyan-400/50 px-3 py-1 text-sm">
                {p.active ? 'Deactivate' : 'Activate'}
              </button>
              <Link to={`/projects/${p.id}`} className="rounded-md bg-violet-500 px-3 py-1 text-sm">Manage</Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
