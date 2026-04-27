import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, api } from '../api';

const PLAYLIST_REFRESH_MS = 30_000;
const PLAYLIST_RETRY_MS = 10_000;
const VIDEO_START_TIMEOUT_MS = 60_000;
const VIDEO_MAX_RECOVERIES = 2;

const toMediaUrl = (item) => {
  if (!item?.file) return null;
  if (/^https?:\/\//i.test(item.file)) return item.file;
  if (item.file.startsWith('/')) return `${API_BASE}${item.file}`;
  return `${API_BASE}/media/${item.file}`;
};

export function PlayerView() {
  const [playlist, setPlaylist] = useState([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('loading');
  const [failedMedia, setFailedMedia] = useState({});
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoLoadMessage, setVideoLoadMessage] = useState('Chargement de la vidéo...');
  const [videoReady, setVideoReady] = useState(false);
  const retryTimeoutRef = useRef(null);
  const videoRef = useRef(null);
  const videoLoadTimeoutRef = useRef(null);
  const videoRecoveryAttemptsRef = useRef(0);

  const clearRetry = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const clearVideoLoadTimeout = useCallback(() => {
    if (videoLoadTimeoutRef.current) {
      clearTimeout(videoLoadTimeoutRef.current);
      videoLoadTimeoutRef.current = null;
    }
  }, []);

  const markMediaFailed = useCallback((item, itemSourceIndex) => {
    if (!item || itemSourceIndex < 0) return;
    clearVideoLoadTimeout();
    const key = `${item.file}-${itemSourceIndex}`;
    setFailedMedia((current) => ({ ...current, [key]: true }));
  }, [clearVideoLoadTimeout]);

  const next = useCallback((activePlaylistLength) => {
    setIndex((prev) => {
      if (activePlaylistLength === 0) return 0;
      return (prev + 1) % activePlaylistLength;
    });
  }, []);

  const startVideoLoadTimeout = useCallback((item, itemSourceIndex, activePlaylistLength) => {
    clearVideoLoadTimeout();
    videoLoadTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;

      setIsVideoLoading(true);
      setVideoLoadMessage('La vidéo met trop de temps à démarrer...');

      if (videoRecoveryAttemptsRef.current < VIDEO_MAX_RECOVERIES) {
        videoRecoveryAttemptsRef.current += 1;
        console.warn('Video startup timeout, attempting recovery', {
          src: video.currentSrc,
          attempt: videoRecoveryAttemptsRef.current,
        });
        video.load();
        const playPromise = video.play();
        if (playPromise?.catch) {
          playPromise.catch((error) => {
            console.warn('Video replay attempt failed:', error);
          });
        }
        startVideoLoadTimeout(item, itemSourceIndex, activePlaylistLength);
      } else {
        console.error('Video failed after recovery attempts, marking media as failed', {
          file: item?.file,
          index: itemSourceIndex,
          src: video.currentSrc,
          attempts: VIDEO_MAX_RECOVERIES,
        });
        clearVideoLoadTimeout();
        markMediaFailed(item, itemSourceIndex);
        next(activePlaylistLength);
      }
    }, VIDEO_START_TIMEOUT_MS);
  }, [clearVideoLoadTimeout, markMediaFailed, next]);

  const loadPlaylist = useCallback(async () => {
    try {
      const items = await api('/api/playlist');
      const nextPlaylist = Array.isArray(items)
        ? items.filter((item) => (item.status || 'ready') === 'ready')
        : [];
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
      clearVideoLoadTimeout();
    };
  }, [clearRetry, clearVideoLoadTimeout, loadPlaylist]);

  useEffect(() => {
    setFailedMedia((current) => {
      const validKeys = new Set(playlist.map((item, itemIndex) => `${item.file}-${itemIndex}`));
      const filteredEntries = Object.entries(current).filter(([key]) => validKeys.has(key));
      if (filteredEntries.length === Object.keys(current).length) return current;
      return Object.fromEntries(filteredEntries);
    });
  }, [playlist]);

  const activePlaylist = useMemo(() => (
    playlist
      .map((item, sourceIndex) => ({ item, sourceIndex }))
      .filter(({ item, sourceIndex }) => !failedMedia[`${item.file}-${sourceIndex}`])
  ), [failedMedia, playlist]);

  useEffect(() => {
    if (activePlaylist.length === 0) {
      if (index !== 0) setIndex(0);
      return;
    }
    if (index >= activePlaylist.length) {
      console.warn('Player index out of range, resetting', {
        index,
        playlistLength: playlist.length,
        activePlaylistLength: activePlaylist.length,
      });
      setIndex(0);
    }
  }, [activePlaylist.length, index, playlist.length]);

  const currentEntry = activePlaylist[index] ?? null;
  const currentItem = currentEntry?.item ?? null;
  const currentSourceIndex = currentEntry?.sourceIndex ?? -1;

  useEffect(() => {
    if (!currentItem || currentItem.type !== 'image') return undefined;

    const durationSeconds = Number(currentItem.duration) > 0 ? Number(currentItem.duration) : 5;
    const id = setTimeout(() => next(activePlaylist.length), durationSeconds * 1_000);
    return () => clearTimeout(id);
  }, [activePlaylist.length, currentItem, next]);

  const currentUrl = useMemo(() => toMediaUrl(currentItem), [currentItem]);

  useEffect(() => {
    const isVideo = currentItem?.type === 'video';
    if (!isVideo) {
      setIsVideoLoading(false);
      setVideoReady(false);
      setVideoLoadMessage('Chargement de la vidéo...');
      videoRecoveryAttemptsRef.current = 0;
      clearVideoLoadTimeout();
      return;
    }

    setIsVideoLoading(true);
    setVideoReady(false);
    setVideoLoadMessage('Chargement de la vidéo...');
    videoRecoveryAttemptsRef.current = 0;
    startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
  }, [activePlaylist.length, clearVideoLoadTimeout, currentItem, currentSourceIndex, startVideoLoadTimeout]);

  useEffect(() => {
    if (currentItem?.type !== 'video') return;

    const video = videoRef.current;
    if (!video) return;

    video.muted = true;
    video.playsInline = true;

    const playPromise = video.play();
    if (playPromise?.catch) {
      playPromise.catch((error) => {
        console.warn('Video autoplay failed:', error);
      });
    }
  }, [currentItem, currentUrl]);

  const nextEntry = useMemo(() => {
    if (activePlaylist.length < 2) return null;
    return activePlaylist[(index + 1) % activePlaylist.length] ?? null;
  }, [activePlaylist, index]);

  const nextItem = nextEntry?.item ?? null;
  const nextUrl = useMemo(() => toMediaUrl(nextItem), [nextItem]);

  useEffect(() => {
    if (!nextItem || !nextUrl) return undefined;

    if (nextItem.type === 'image') {
      const img = new Image();
      img.src = nextUrl;
      return undefined;
    }

    if (nextItem.type === 'video') {
      const preloadVideo = document.createElement('video');
      preloadVideo.preload = 'auto';
      preloadVideo.muted = true;
      preloadVideo.playsInline = true;
      preloadVideo.src = nextUrl;
      preloadVideo.load();

      return () => {
        preloadVideo.removeAttribute('src');
        preloadVideo.load();
      };
    }

    return undefined;
  }, [nextItem, nextUrl]);

  const markCurrentFailed = useCallback(() => {
    if (!currentItem || currentSourceIndex < 0) return;
    markMediaFailed(currentItem, currentSourceIndex);
    next(activePlaylist.length);
  }, [activePlaylist.length, currentItem, currentSourceIndex, markMediaFailed, next]);

  if (!currentItem || !currentUrl) {
    if (playlist.length > 0 && activePlaylist.length > 0) {
      return (
        <div className="flex h-screen w-screen items-center justify-center overflow-hidden bg-black px-8 text-center text-slate-200">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-slate-100 md:text-6xl">PixFlow Player</h1>
            <p className="mt-5 text-lg text-slate-400 md:text-2xl">Loading media...</p>
          </div>
        </div>
      );
    }

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
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
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
          onLoadStart={() => {
            console.log('Video loadstart:', currentUrl);
            setIsVideoLoading(true);
            setVideoReady(false);
            setVideoLoadMessage('Chargement de la vidéo...');
            startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
          }}
          onCanPlay={() => {
            console.log('Video canplay:', currentUrl);
            const playPromise = videoRef.current?.play();
            if (playPromise?.catch) {
              playPromise.catch((error) => {
                console.warn('Video autoplay failed:', error);
              });
            }
          }}
          onCanPlayThrough={() => {
            console.log('Video canplaythrough:', currentUrl);
          }}
          onPlaying={() => {
            console.log('Video playing:', currentUrl);
            setVideoReady(true);
            setIsVideoLoading(false);
            setVideoLoadMessage('');
            videoRecoveryAttemptsRef.current = 0;
            clearVideoLoadTimeout();
          }}
          onWaiting={() => {
            console.warn('Video waiting/buffering:', currentUrl);
            setIsVideoLoading(true);
            setVideoLoadMessage('Mise en mémoire tampon de la vidéo...');
            startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
          }}
          onStalled={() => {
            console.warn('Video stalled:', currentUrl);
            setIsVideoLoading(true);
            setVideoLoadMessage('Le chargement vidéo est ralenti...');
            startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
          }}
          onEnded={() => next(activePlaylist.length)}
          onError={(event) => {
            const video = event.currentTarget;
            console.error('Video error:', {
              url: currentUrl,
              error: video.error,
              networkState: video.networkState,
              readyState: video.readyState,
            });
            setIsVideoLoading(true);
            setVideoLoadMessage('Erreur vidéo, passage au média suivant...');
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

      {currentItem.type === 'video' && (isVideoLoading || !videoReady) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/85 px-8 text-center text-slate-100">
          <div>
            <p className="text-2xl font-semibold tracking-wide md:text-3xl">PixFlow</p>
            <p className="mt-3 text-base text-slate-200 md:text-lg">{videoLoadMessage || 'Chargement de la vidéo...'}</p>
            {currentItem.file && (
              <p className="mt-2 text-xs text-slate-400 md:text-sm break-all">{currentItem.file}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
