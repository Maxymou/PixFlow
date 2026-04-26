import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE, api } from '../api';

const PLAYLIST_REFRESH_MS = 30_000;

export function PlayerView() {
  const [playlist, setPlaylist] = useState([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('loading');

  const loadPlaylist = useCallback(async () => {
    try {
      const items = await api('/playlist');
      setPlaylist(Array.isArray(items) ? items : []);
      setStatus('online');
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    loadPlaylist();
    const id = setInterval(loadPlaylist, PLAYLIST_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadPlaylist]);

  useEffect(() => {
    if (playlist.length === 0) {
      setIndex(0);
      return;
    }
    setIndex((prev) => prev % playlist.length);
  }, [playlist]);

  const next = useCallback(() => {
    setIndex((prev) => {
      if (playlist.length === 0) return 0;
      return (prev + 1) % playlist.length;
    });
  }, [playlist.length]);

  const currentItem = playlist[index] ?? null;

  useEffect(() => {
    if (!currentItem || currentItem.type !== 'image') return undefined;

    const durationSeconds = Number(currentItem.duration) > 0 ? Number(currentItem.duration) : 5;
    const id = setTimeout(next, durationSeconds * 1_000);
    return () => clearTimeout(id);
  }, [currentItem, next]);

  const currentUrl = useMemo(() => {
    if (!currentItem?.file) return null;
    if (/^https?:\/\//i.test(currentItem.file)) return currentItem.file;
    return `${API_BASE}${currentItem.file}`;
  }, [currentItem]);

  if (!currentItem || !currentUrl) {
    return (
      <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black px-8 text-center text-slate-200">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-slate-100 md:text-6xl">PixFlow Player</h1>
          <p className="mt-5 text-lg text-slate-400 md:text-2xl">No active project selected</p>
          {status === 'offline' && (
            <p className="mt-4 text-sm text-rose-400/90 md:text-base">Backend is currently offline</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-black">
      {currentItem.type === 'video' ? (
        <video
          key={`${index}-${currentItem.file}`}
          src={currentUrl}
          className="h-full w-full object-contain"
          autoPlay
          muted
          playsInline
          onEnded={next}
        />
      ) : (
        <img
          key={`${index}-${currentItem.file}`}
          src={currentUrl}
          alt=""
          className="h-full w-full object-contain"
          draggable={false}
        />
      )}
    </div>
  );
}
