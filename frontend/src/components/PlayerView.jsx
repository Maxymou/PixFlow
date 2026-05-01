import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE, api } from '../api';
import { PlayerRenderer } from './PlayerRenderer';

const PLAYLIST_REFRESH_MS = 30_000;
const PLAYLIST_RETRY_MS = 10_000;
const VIDEO_START_TIMEOUT_MS = 60_000;
const VIDEO_MAX_RECOVERIES = 2;
const KIOSK_HEARTBEAT_INTERVAL_MS = 5_000;
const KIOSK_COMMAND_POLL_INTERVAL_MS = 1_000;
const SETTINGS_REFRESH_MS = 15_000;

const toMediaUrl = (item) => {
  if (!item?.file) return null;
  if (/^https?:\/\//i.test(item.file)) return item.file;
  if (item.file.startsWith('/')) return `${API_BASE}${item.file}`;
  return `${API_BASE}/media/${item.file}`;
};

const toPauseMediaUrl = (file) => {
  if (!file) return null;
  if (/^https?:\/\//i.test(file)) return file;
  if (file.startsWith('/')) return `${API_BASE}${file}`;
  return `${API_BASE}/media/${file}`;
};

export function PlayerView() {
  const [playlist, setPlaylist] = useState([]);
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState('loading');
  const [failedMedia, setFailedMedia] = useState({});
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [videoLoadMessage, setVideoLoadMessage] = useState('Chargement de la vidéo...');
  const [videoReady, setVideoReady] = useState(false);
  const [kioskControlState, setKioskControlState] = useState('playing');
  const [pauseScreen, setPauseScreen] = useState(null);
  const retryTimeoutRef = useRef(null);
  const videoRef = useRef(null);
  const videoLoadTimeoutRef = useRef(null);
  const videoRecoveryAttemptsRef = useRef(0);
  const videoBufferingTimeoutRef = useRef(null);
  const videoLoadingOverlayTimeoutRef = useRef(null);
  const pausePreloadVideoRef = useRef(null);
  const pausePreloadImageRef = useRef(null);
  const lastAppliedCommandIdRef = useRef(0);
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
    if (kioskControlState !== 'playing') return;
    setIndex((prev) => {
      if (activePlaylistLength === 0) return 0;
      return (prev + 1) % activePlaylistLength;
    });
  }, [kioskControlState]);

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

  const loadPauseScreenSettings = useCallback(async () => {
    try {
      const settings = await api('/api/settings');
      const nextPauseScreen = settings?.pauseScreen || null;
      setPauseScreen(nextPauseScreen);
    } catch {
      // Best effort only: keep the previous pause screen config.
    }
  }, []);

  useEffect(() => {
    loadPauseScreenSettings();
    const id = setInterval(loadPauseScreenSettings, SETTINGS_REFRESH_MS);
    return () => clearInterval(id);
  }, [loadPauseScreenSettings]);

  useEffect(() => {
    if (!pauseScreen || pauseScreen.mode !== 'custom') return undefined;
    if (pauseScreen.status && pauseScreen.status !== 'ready') return undefined;
    if (!pauseScreen.mediaFile) return undefined;
    const pauseMediaUrl = toPauseMediaUrl(pauseScreen.mediaFile);
    if (!pauseMediaUrl) return undefined;

    if (pauseScreen.mediaType === 'image') {
      const img = new Image();
      img.src = pauseMediaUrl;
      pausePreloadImageRef.current = img;
      if (pausePreloadVideoRef.current) {
        pausePreloadVideoRef.current.pause();
        pausePreloadVideoRef.current.removeAttribute('src');
        pausePreloadVideoRef.current.load();
        pausePreloadVideoRef.current = null;
      }
      return undefined;
    }

    if (pauseScreen.mediaType === 'video') {
      console.log('[PixFlow kiosk] Preloading pause screen video:', pauseMediaUrl);
      if (pausePreloadImageRef.current) {
        pausePreloadImageRef.current = null;
      }

      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.src = pauseMediaUrl;

      video.onloadeddata = () => console.log('[PixFlow kiosk] Pause screen video loadeddata');
      video.oncanplay = () => console.log('[PixFlow kiosk] Pause screen video canplay');
      video.oncanplaythrough = () => console.log('[PixFlow kiosk] Pause screen video canplaythrough');
      video.onerror = () => console.warn('[PixFlow kiosk] Pause screen video preload error');

      video.load();
      console.log('[PixFlow kiosk] Pause screen video preload started');

      const previousVideo = pausePreloadVideoRef.current;
      pausePreloadVideoRef.current = video;
      if (previousVideo && previousVideo !== video) {
        previousVideo.pause();
        previousVideo.removeAttribute('src');
        previousVideo.load();
      }

      return () => {
        if (pausePreloadVideoRef.current === video) {
          video.pause();
          video.removeAttribute('src');
          video.load();
          pausePreloadVideoRef.current = null;
        }
      };
    }

    return undefined;
  }, [pauseScreen?.mode, pauseScreen?.mediaType, pauseScreen?.mediaFile, pauseScreen?.status]);

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


  const applyKioskCommand = useCallback((command) => {
    console.log('[PixFlow kiosk] Applying command:', command);
    if (command === 'pause') {
      setKioskControlState('paused');
      videoRef.current?.pause?.();
      sendHeartbeat({ status: 'paused', message: 'Kiosk paused' });
      return;
    }

    if (command === 'stop') {
      setKioskControlState('stopped');
      const video = videoRef.current;
      if (video) {
        video.pause();
        try {
          video.currentTime = 0;
        } catch {
          // Ignore seek errors.
        }
      }
      sendHeartbeat({ status: 'stopped', message: 'Kiosk stopped' });
      return;
    }

    if (command === 'play') {
      setKioskControlState('playing');
      const playPromise = videoRef.current?.play?.();
      if (playPromise?.catch) {
        playPromise.catch(() => {});
      }
      sendHeartbeat({ status: 'playing', message: 'Kiosk resumed' });
    }
  }, [sendHeartbeat]);


  useEffect(() => {
    sendHeartbeat({ status: 'idle', message: 'Kiosk loaded' });
    const id = setInterval(() => {
      sendHeartbeat();
    }, KIOSK_HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sendHeartbeat]);

  useEffect(() => {
    let mounted = true;

    const fetchCommand = async () => {
      try {
        const commandPayload = await api('/api/kiosk/command');
        console.log('[PixFlow kiosk] Received command:', commandPayload);
        if (!mounted || !commandPayload) return;
        if (
          typeof commandPayload.id === 'number'
          && commandPayload.id > lastAppliedCommandIdRef.current
        ) {
          lastAppliedCommandIdRef.current = commandPayload.id;
          applyKioskCommand(commandPayload.command);
        }
      } catch {
        // Best effort only: never block player.
      }
    };

    fetchCommand();
    const id = setInterval(fetchCommand, KIOSK_COMMAND_POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [applyKioskCommand]);

  useEffect(() => {
    if (kioskControlState === 'stopped') {
      sendHeartbeat({ status: 'stopped', message: 'Kiosk stopped' });
      return;
    }
    if (!currentItem || !currentUrl) {
      if (status === 'offline') sendHeartbeat({ status: 'idle', message: 'Backend offline' });
      else sendHeartbeat({ status: 'no_active_project', projectId: null, projectName: null, mediaId: null, mediaName: null, mediaType: null, message: 'No active project selected' });
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
  }, [currentItem, currentUrl, kioskControlState, sendHeartbeat, status]);

  return (
    <PlayerRenderer
      mode="kiosk"
      media={currentItem}
      mediaUrl={currentUrl}
      kioskState={kioskControlState}
      offline={status === 'offline' && !currentItem}
      isVideoLoading={currentItem?.type === 'video' && isVideoLoading}
      videoLoadMessage={videoLoadMessage || 'Chargement de la vidéo...'}
      paused={kioskControlState === 'paused'}
      videoRef={videoRef}
      onVideoLoadStart={() => {
        setVideoReady(false);
        setVideoLoadMessage('Chargement de la vidéo...');
        clearVideoBufferingTimeout();
        clearVideoLoadingOverlayTimeout();
        videoLoadingOverlayTimeoutRef.current = setTimeout(() => {
          const video = videoRef.current;
          if (video?.readyState >= 2 && !video.paused && !video.ended) { markVideoReady(); return; }
          setIsVideoLoading(true);
          setVideoLoadMessage('Chargement de la vidéo...');
        }, 400);
        startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length);
      }}
      onVideoLoadedData={() => { markVideoReady(); sendHeartbeat({ status: 'loading', message: 'Media ready' }); }}
      onVideoCanPlay={() => { markVideoReady(); if (kioskControlState !== 'playing') return; const playPromise = videoRef.current?.play(); if (playPromise?.catch) playPromise.catch(() => {}); }}
      onVideoCanPlayThrough={markVideoReady}
      onVideoPlaying={() => { markVideoReady(); sendHeartbeat({ status: kioskControlState === 'paused' ? 'paused' : 'playing', message: null }); }}
      onVideoWaiting={() => { const video = videoRef.current; if (video?.readyState >= 2) { markVideoReady(); return; } clearVideoBufferingTimeout(); videoBufferingTimeoutRef.current = setTimeout(() => { const currentVideo = videoRef.current; if (!currentVideo || currentVideo.readyState >= 2) { markVideoReady(); return; } setIsVideoLoading(true); setVideoLoadMessage('Mise en mémoire tampon de la vidéo...'); startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length); }, 3000); }}
      onVideoStalled={() => { setIsVideoLoading(true); setVideoLoadMessage('Le chargement vidéo est ralenti...'); startVideoLoadTimeout(currentItem, currentSourceIndex, activePlaylist.length); }}
      onVideoEnded={() => { if (kioskControlState !== 'playing') return; clearVideoLoadTimeout(); clearVideoBufferingTimeout(); clearVideoLoadingOverlayTimeout(); setIsVideoLoading(false); setVideoReady(false); setVideoLoadMessage('Chargement de la vidéo...'); sendHeartbeat({ status: 'idle', message: 'Media ended' }); next(activePlaylist.length); }}
      onVideoError={() => { setIsVideoLoading(true); setVideoLoadMessage('Erreur vidéo, passage au média suivant...'); sendHeartbeat({ status: 'error', message: 'Failed to load media' }); markCurrentFailed(); }}
      onImageLoad={() => { sendHeartbeat({ status: kioskControlState === 'paused' ? 'paused' : 'playing', message: null }); }}
      onImageError={markCurrentFailed}
      pauseScreen={pauseScreen}
    />
  );
}
