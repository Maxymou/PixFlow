import React, { useEffect, useState } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { api } from './api';
import { Dashboard } from './components/Dashboard';
import { ProjectDetail } from './components/ProjectDetail';
import { PlayerView } from './components/PlayerView';
import { UserMenu } from './components/UserMenu';

export default function App() {
  const [projects, setProjects] = useState([]);
  const [status, setStatus] = useState('loading');
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const location = useLocation();

  const reload = async () => {
    try {
      const data = await api('/api/projects');
      setProjects(data);
      setStatus('online');
    } catch {
      setStatus('offline');
    }
  };

  useEffect(() => {
    reload();
    const id = setInterval(reload, 30_000);
    return () => clearInterval(id);
  }, []);

  const activeCount = projects.filter((p) => p.active).length;
  const isPlayerRoute = location.pathname.startsWith('/player');

  if (isPlayerRoute) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-black text-slate-100">
        <Routes>
          <Route path="/player" element={<PlayerView />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950/20 to-slate-950 text-slate-100">
      {/* ── Header ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <button
            type="button"
            onClick={() => setIsUserMenuOpen(true)}
            aria-label="Open settings menu"
            aria-expanded={isUserMenuOpen}
            className="flex items-center gap-3 text-left transition-opacity hover:opacity-80"
          >
            <img src="/logo.png" alt="PixFlow" className="h-9 w-9 rounded-lg" />
            <div>
              <h1 className="text-base font-semibold leading-tight tracking-tight">
                PixFlow Signage
              </h1>
              <p className="text-xs text-slate-500">Offline Digital Signage</p>
            </div>
          </button>

          <div className="flex items-center gap-3">
            {status === 'online' && activeCount > 0 && (
              <span className="hidden items-center gap-1.5 text-xs text-emerald-400 sm:flex">
                <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400" />
                {activeCount} active
              </span>
            )}

            <StatusPill status={status} />
          </div>
        </div>
      </header>

      {/* ── Main ───────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Dashboard projects={projects} onRefresh={reload} />} />
          <Route
            path="/projects/:id"
            element={<ProjectDetail projects={projects} onRefresh={reload} />}
          />
          <Route path="/player" element={<PlayerView />} />
        </Routes>
      </main>

      <UserMenu open={isUserMenuOpen} onClose={() => setIsUserMenuOpen(false)} />
    </div>
  );
}

function StatusPill({ status }) {
  if (status === 'loading') {
    return (
      <span className="badge-loading">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
        Connecting…
      </span>
    );
  }
  if (status === 'offline') {
    return (
      <span className="badge-offline">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
        Offline
      </span>
    );
  }
  return (
    <span className="badge-live">
      <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-400" />
      Online
    </span>
  );
}
