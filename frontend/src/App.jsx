import React from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api } from './api';
import { Dashboard } from './components/Dashboard';
import { ProjectDetail } from './components/ProjectDetail';

export default function App() {
  const [projects, setProjects] = useState([]);
  const location = useLocation();

  const reload = async () => {
    const data = await api('/projects');
    setProjects(data);
  };

  useEffect(() => { reload(); }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 border-b border-cyan-500/20 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-3">
            <img src="/logo.png" alt="PixFlow" className="h-10 w-10 rounded-lg" />
            <div>
              <h1 className="text-lg font-semibold">PixFlow Signage</h1>
              <p className="text-xs text-cyan-300">Offline Digital Signage Control</p>
            </div>
          </Link>
          <span className="rounded-full border border-violet-400/50 px-3 py-1 text-xs text-violet-200">
            {location.pathname === '/' ? 'Dashboard' : 'Project'}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard projects={projects} onRefresh={reload} />} />
          <Route path="/projects/:id" element={<ProjectDetail projects={projects} onRefresh={reload} />} />
        </Routes>
      </main>
    </div>
  );
}
