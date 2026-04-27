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

  const startVideoLoadTimeout = useCallback(() => {
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
        startVideoLoadTimeout();
      } else {
        console.error('Video startup timeout after maximum recovery attempts; skipping media', {
          src: video.currentSrc,
          attempts: videoRecoveryAttemptsRef.current,
        });
        clearVideoLoadTimeout();
      }
    }, VIDEO_START_TIMEOUT_MS);
  }, [clearVideoLoadTimeout]);

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
    startVideoLoadTimeout();
  }, [clearVideoLoadTimeout, currentItem, startVideoLoadTimeout]);

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

  const nextItem = useMemo(() => {
    if (activePlaylist.length < 2) return null;
    return activePlaylist[(index + 1) % activePlaylist.length] ?? null;
  }, [activePlaylist, index]);

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
    if (!currentItem) return;
    clearVideoLoadTimeout();
    const key = `${currentItem.file}-${index}`;
    setFailedMedia((current) => ({ ...current, [key]: true }));
    next();
  }, [clearVideoLoadTimeout, currentItem, index, next]);

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
            startVideoLoadTimeout();
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
            startVideoLoadTimeout();
          }}
          onStalled={() => {
            console.warn('Video stalled:', currentUrl);
            setIsVideoLoading(true);
            setVideoLoadMessage('Le chargement vidéo est ralenti...');
            startVideoLoadTimeout();
          }}
          onEnded={next}
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
