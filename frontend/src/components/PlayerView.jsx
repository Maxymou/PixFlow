import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, api } from '../api';

const PLAYLIST_REFRESH_MS = 30_000;
const PLAYLIST_RETRY_MS = 10_000;

export function PlayerView() {
  const [playlist, setPlaylist] = useState([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('loading');
  const [failedMedia, setFailedMedia] = useState({});
  const retryTimeoutRef = useRef(null);
  const videoRef = useRef(null);

  const clearRetry = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const loadPlaylist = useCallback(async () => {
    try {
      const items = await api('/api/playlist');
      const nextPlaylist = Array.isArray(items) ? items : [];
      setPlaylist(nextPlaylist);
      localStorage.setItem('playlist', JSON.stringify(nextPlaylist));
      setStatus('online');
      clearRetry();
    } catch {
      const cached = localStorage.getItem('playlist');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPlaylist((current) => (current.length > 0 ? current : parsed));
          }
        } catch {
          // Ignore invalid cache values.
        }
      }
      setStatus('offline');
      if (!retryTimeoutRef.current) {
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          loadPlaylist();
        }, PLAYLIST_RETRY_MS);
      }
    }
  }, [clearRetry]);

  useEffect(() => {
    loadPlaylist();
    const id = setInterval(loadPlaylist, PLAYLIST_REFRESH_MS);
    return () => {
      clearInterval(id);
      clearRetry();
    };
  }, [clearRetry, loadPlaylist]);

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

  const activePlaylist = useMemo(() => (
    playlist.filter((item, itemIndex) => !failedMedia[`${item.file}-${itemIndex}`])
  ), [failedMedia, playlist]);

  const currentItem = activePlaylist[index] ?? null;

  useEffect(() => {
    if (!currentItem || currentItem.type !== 'image') return undefined;

    const durationSeconds = Number(currentItem.duration) > 0 ? Number(currentItem.duration) : 5;
    const id = setTimeout(next, durationSeconds * 1_000);
    return () => clearTimeout(id);
  }, [currentItem, next]);

  const currentUrl = useMemo(() => {
    if (!currentItem?.file) return null;
    if (/^https?:\/\//i.test(currentItem.file)) return currentItem.file;
    if (currentItem.file.startsWith('/')) return `${API_BASE}${currentItem.file}`;
    return `${API_BASE}/media/${currentItem.file}`;
  }, [currentItem]);

  useEffect(() => {
    if (currentItem?.type !== 'video') return;

    const video = videoRef.current;
    if (!video) return;

    // Keep muted by default because Chromium autoplay can block unmuted videos.
    // A future setting can enable sound after kiosk policy/audio configuration is confirmed.
    video.muted = true;
    video.playsInline = true;

    const playPromise = video.play();
    if (playPromise?.catch) {
      playPromise.catch((error) => {
        console.warn('Video autoplay failed:', error);
      });
    }
  }, [currentItem, currentUrl]);

  const nextUrl = useMemo(() => {
    if (activePlaylist.length < 2) return null;
    const nextItem = activePlaylist[(index + 1) % activePlaylist.length];
    if (!nextItem?.file || nextItem.type !== 'image') return null;
    if (/^https?:\/\//i.test(nextItem.file)) return nextItem.file;
    if (nextItem.file.startsWith('/')) return `${API_BASE}${nextItem.file}`;
    return `${API_BASE}/media/${nextItem.file}`;
  }, [activePlaylist, index]);

  useEffect(() => {
    if (!nextUrl) return;
    const img = new Image();
    img.src = nextUrl;
  }, [nextUrl]);

  const markCurrentFailed = useCallback(() => {
    if (!currentItem) return;
    const key = `${currentItem.file}-${index}`;
    setFailedMedia((current) => ({ ...current, [key]: true }));
    next();
  }, [currentItem, index, next]);

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
    <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
      {currentItem.type === 'video' ? (
        <video
          ref={videoRef}
          key={`${index}-${currentItem.file}`}
          src={currentUrl}
          className="max-h-full max-w-full object-contain"
          autoPlay
          muted
          playsInline
          preload="auto"
          controls={false}
          onLoadedData={() => console.log('Video loaded data:', currentUrl)}
          onCanPlay={() => {
            console.log('Video can play:', currentUrl);
            const playPromise = videoRef.current?.play();
            if (playPromise?.catch) {
              playPromise.catch((error) => {
                console.warn('Video autoplay failed:', error);
              });
            }
          }}
          onPlaying={() => console.log('Video playing:', currentUrl)}
          onWaiting={() => console.warn('Video waiting/buffering:', currentUrl)}
          onStalled={() => console.warn('Video stalled:', currentUrl)}
          onEnded={next}
          onError={(event) => {
            const video = event.currentTarget;
            console.error('Video error:', {
              url: currentUrl,
              error: video.error,
              networkState: video.networkState,
              readyState: video.readyState,
            });
            markCurrentFailed();
          }}
        />
      ) : (
        <img
          key={`${index}-${currentItem.file}`}
          src={currentUrl}
          alt=""
          className="max-h-full max-w-full object-contain"
          draggable={false}
          onError={markCurrentFailed}
        />
      )}
    </div>
  );
}
