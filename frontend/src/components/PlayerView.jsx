import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, api } from '../api';

const PLAYLIST_REFRESH_MS = 30_000;
const PLAYLIST_RETRY_MS = 10_000;
const VIDEO_START_TIMEOUT_MS = 60_000;
const VIDEO_MAX_RECOVERIES = 2;
const KIOSK_HEARTBEAT_INTERVAL_MS = 5_000;
const KIOSK_PREVIEW_INTERVAL_MS = 1_000;
const KIOSK_IMAGE_REFRESH_INTERVAL_MS = 30_000;
const KIOSK_PREVIEW_WIDTH = 360;
const KIOSK_PREVIEW_QUALITY = 0.55;

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
  const videoBufferingTimeoutRef = useRef(null);
  const videoLoadingOverlayTimeoutRef = useRef(null);
  const previewIntervalRef = useRef(null);
  const isSendingPreviewRef = useRef(false);
  const heartbeatPayloadRef = useRef({
    status: 'idle',
    projectId: null,
    projectName: null,
    mediaId: null,
    mediaName: null,
    mediaType: null,
    message: null,
  });

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

  const clearVideoBufferingTimeout = useCallback(() => {
    if (videoBufferingTimeoutRef.current) {
      clearTimeout(videoBufferingTimeoutRef.current);
      videoBufferingTimeoutRef.current = null;
    }
  }, []);

  const clearVideoLoadingOverlayTimeout = useCallback(() => {
    if (videoLoadingOverlayTimeoutRef.current) {
      clearTimeout(videoLoadingOverlayTimeoutRef.current);
      videoLoadingOverlayTimeoutRef.current = null;
    }
  }, []);

  const markVideoReady = useCallback(() => {
    setVideoReady(true);
    setIsVideoLoading(false);
    setVideoLoadMessage('');
    videoRecoveryAttemptsRef.current = 0;
    clearVideoLoadTimeout();
    clearVideoBufferingTimeout();
    clearVideoLoadingOverlayTimeout();
  }, [clearVideoBufferingTimeout, clearVideoLoadTimeout, clearVideoLoadingOverlayTimeout]);

  const markMediaFailed = useCallback((item, itemSourceIndex) => {
    if (!item || itemSourceIndex < 0) return;
    clearVideoLoadTimeout();
    clearVideoBufferingTimeout();
    const key = `${item.file}-${itemSourceIndex}`;
    setFailedMedia((current) => ({ ...current, [key]: true }));
  }, [clearVideoBufferingTimeout, clearVideoLoadTimeout]);

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

      if (video.readyState >= 2 && !video.paused && !video.ended) {
        markVideoReady();
        return;
      }

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
  }, [clearVideoLoadTimeout, markMediaFailed, markVideoReady, next]);

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
      clearVideoBufferingTimeout();
      clearVideoLoadingOverlayTimeout();
    };
  }, [clearRetry, clearVideoBufferingTimeout, clearVideoLoadTimeout, clearVideoLoadingOverlayTimeout, loadPlaylist]);

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
      clearVideoBufferingTimeout();
      clearVideoLoadingOverlayTimeout();
      return;
    }

    setVideoReady(false);
    setVideoLoadMessage('Chargement de la vidéo...');
    setIsVideoLoading(false);
    videoRecoveryAttemptsRef.current = 0;
    clearVideoBufferingTimeout();
    clearVideoLoadingOverlayTimeout();

    videoLoadingOverlayTimeoutRef.current = setTimeout(() => {
      const video = videoRef.current;

      if (video?.readyState >= 2 && !video.paused && !video.ended) {
        markVideoReady();
        return;
      }

      setIsVideoLoading(true);
      setVideoLoadMessage('Chargement de la vidéo...');
    }, 400);
    startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
  }, [activePlaylist.length, clearVideoBufferingTimeout, clearVideoLoadTimeout, clearVideoLoadingOverlayTimeout, currentItem, currentSourceIndex, markVideoReady, startVideoLoadTimeout]);

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

  const sendHeartbeat = useCallback(async (partial = {}) => {
    heartbeatPayloadRef.current = {
      ...heartbeatPayloadRef.current,
      ...partial,
    };
    try {
      await api('/api/kiosk/heartbeat', {
        method: 'POST',
        body: JSON.stringify(heartbeatPayloadRef.current),
      });
    } catch {
      // Best effort only: never block player.
    }
  }, []);

  const sendPreview = useCallback(async (partial = {}) => {
    if (isSendingPreviewRef.current) return;
    const mediaElement = partial.mediaElement || videoRef.current;
    if (!mediaElement) return;
    isSendingPreviewRef.current = true;
    try {
      const sourceWidth = mediaElement.videoWidth || mediaElement.naturalWidth || mediaElement.clientWidth || 480;
      const sourceHeight = mediaElement.videoHeight || mediaElement.naturalHeight || mediaElement.clientHeight || 270;
      if (!sourceWidth || !sourceHeight) return;

      const width = Math.min(KIOSK_PREVIEW_WIDTH, sourceWidth);
      const ratio = sourceHeight / sourceWidth;
      const height = Math.max(1, Math.round(width * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(mediaElement, 0, 0, width, height);

      const imageDataUrl = canvas.toDataURL('image/jpeg', KIOSK_PREVIEW_QUALITY);
      const payload = {
        imageDataUrl,
        mediaId: partial.mediaId ?? currentItem?.id ?? null,
        mediaName: partial.mediaName ?? currentItem?.originalName ?? currentItem?.file ?? null,
        mediaType: partial.mediaType ?? currentItem?.type ?? null,
        status: partial.status ?? heartbeatPayloadRef.current.status ?? 'idle',
      };
      await api('/api/kiosk/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch {
      // Best effort only: ignore canvas/CORS/network errors.
    } finally {
      isSendingPreviewRef.current = false;
    }
  }, [currentItem]);

  const clearPreviewInterval = useCallback(() => {
    if (previewIntervalRef.current) {
      clearInterval(previewIntervalRef.current);
      previewIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    sendHeartbeat({ status: 'idle', message: 'Kiosk loaded' });
    const id = setInterval(() => {
      sendHeartbeat();
    }, KIOSK_HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sendHeartbeat]);

  useEffect(() => () => clearPreviewInterval(), [clearPreviewInterval]);

  useEffect(() => {
    if (!currentItem || !currentUrl) {
      clearPreviewInterval();
      if (status === 'offline') {
        sendHeartbeat({ status: 'idle', message: 'Backend offline' });
      } else {
        sendHeartbeat({
          status: 'no_active_project',
          projectId: null,
          projectName: null,
          mediaId: null,
          mediaName: null,
          mediaType: null,
          message: 'No active project selected',
        });
      }
      return;
    }
    sendHeartbeat({
      projectId: currentItem.projectId || null,
      projectName: currentItem.projectName || null,
      mediaId: currentItem.id || null,
      mediaName: currentItem.originalName || currentItem.file || null,
      mediaType: currentItem.type || null,
      status: currentItem.type === 'video' ? 'loading' : 'playing',
      message: currentItem.type === 'video' ? 'Loading media' : null,
    });
    return () => {
      clearPreviewInterval();
    };
  }, [clearPreviewInterval, currentItem, currentUrl, sendHeartbeat, status]);

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
            setVideoReady(false);
            setVideoLoadMessage('Chargement de la vidéo...');
            clearVideoBufferingTimeout();
            clearVideoLoadingOverlayTimeout();
            videoLoadingOverlayTimeoutRef.current = setTimeout(() => {
              const video = videoRef.current;

              if (video?.readyState >= 2 && !video.paused && !video.ended) {
                markVideoReady();
                return;
              }

              setIsVideoLoading(true);
              setVideoLoadMessage('Chargement de la vidéo...');
            }, 400);
            startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
          }}
          onLoadedData={() => {
            console.log('Video loadeddata:', currentUrl);
            markVideoReady();
            sendHeartbeat({ status: 'loading', message: 'Media ready' });
          }}
          onCanPlay={() => {
            console.log('Video canplay:', currentUrl);
            markVideoReady();
            const playPromise = videoRef.current?.play();
            if (playPromise?.catch) {
              playPromise.catch((error) => {
                console.warn('Video autoplay failed:', error);
              });
            }
          }}
          onCanPlayThrough={() => {
            console.log('Video canplaythrough:', currentUrl);
            markVideoReady();
          }}
          onPlaying={() => {
            console.log('Video playing:', currentUrl);
            markVideoReady();
            sendHeartbeat({ status: 'playing', message: null });
            sendPreview({ mediaElement: videoRef.current, status: 'playing' });
            clearPreviewInterval();
            previewIntervalRef.current = setInterval(() => {
              sendPreview({ mediaElement: videoRef.current, status: 'playing' });
            }, KIOSK_PREVIEW_INTERVAL_MS);
          }}
          onWaiting={() => {
            console.warn('Video waiting/buffering:', currentUrl);
            const video = videoRef.current;
            if (video?.readyState >= 2) {
              markVideoReady();
              return;
            }
            clearVideoBufferingTimeout();
            videoBufferingTimeoutRef.current = setTimeout(() => {
              const currentVideo = videoRef.current;
              if (!currentVideo || currentVideo.readyState >= 2) {
                markVideoReady();
                return;
              }
              setIsVideoLoading(true);
              setVideoLoadMessage('Mise en mémoire tampon de la vidéo...');
              startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
            }, 3_000);
          }}
          onStalled={() => {
            console.warn('Video stalled:', currentUrl);
            setIsVideoLoading(true);
            setVideoLoadMessage('Le chargement vidéo est ralenti...');
            startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
          }}
          onEnded={() => {
            clearVideoLoadTimeout();
            clearVideoBufferingTimeout();
            clearVideoLoadingOverlayTimeout();
            setIsVideoLoading(false);
            setVideoReady(false);
            setVideoLoadMessage('Chargement de la vidéo...');
            sendHeartbeat({ status: 'idle', message: 'Media ended' });
            clearPreviewInterval();
            next(activePlaylist.length);
          }}
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
            sendHeartbeat({ status: 'error', message: 'Failed to load media' });
            clearPreviewInterval();
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
          onLoad={(event) => {
            sendPreview({ mediaElement: event.currentTarget, status: 'playing' });
            clearPreviewInterval();
            previewIntervalRef.current = setInterval(() => {
              sendPreview({ mediaElement: event.currentTarget, status: 'playing' });
            }, KIOSK_IMAGE_REFRESH_INTERVAL_MS);
          }}
        />
      )}

      {currentItem.type === 'video' && isVideoLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/85 px-8 text-center text-slate-100">
          <div className="flex flex-col items-center">
            <p className="text-2xl font-semibold tracking-wide md:text-3xl">PixFlow</p>
            <p className="mt-3 text-base text-slate-200 md:text-lg">{videoLoadMessage || 'Chargement de la vidéo...'}</p>
            <div className="mt-4 w-64 max-w-[70vw]">
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div className="animate-video-loading-bar h-full w-1/2 rounded-full bg-cyan-400" />
              </div>
            </div>
            {currentItem.file && (
              <p className="mt-2 text-xs text-slate-400 md:text-sm break-all">{currentItem.file}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
