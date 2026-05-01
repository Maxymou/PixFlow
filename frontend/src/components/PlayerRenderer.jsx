import React from 'react';
import { API_BASE } from '../api';

const resolveMediaUrl = (file) => {
  if (!file) return null;
  if (/^https?:\/\//i.test(file)) return file;
  if (file.startsWith('/')) return `${API_BASE}${file}`;
  return `${API_BASE}/media/${file}`;
};

export function PlayerRenderer({
  mode = 'kiosk',
  media,
  mediaUrl,
  kioskState = 'playing',
  offline = false,
  isVideoLoading = false,
  videoLoadMessage = 'Loading video...',
  paused = false,
  videoRef,
  onVideoLoadStart,
  onVideoLoadedData,
  onVideoCanPlay,
  onVideoCanPlayThrough,
  onVideoPlaying,
  onVideoWaiting,
  onVideoStalled,
  onVideoEnded,
  onVideoError,
  onImageLoad,
  onImageError,
  pauseScreen,
}) {
  const isPreview = mode === 'preview';
  const shellClass = isPreview
    ? 'relative aspect-video w-full overflow-hidden rounded-xl border border-slate-700 bg-black'
    : 'relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black';

  const mediaClass = isPreview ? 'h-full w-full object-contain' : 'max-h-full max-w-full object-contain';
  const showStopped = kioskState === 'stopped';

  if (showStopped) {
    return <StoppedScreen mode={mode} pauseScreen={pauseScreen} />;
  }

  if (offline) {
    return <StateView mode={mode} title='PixFlow Player' subtitle='Kiosk offline' />;
  }

  if (!media || !mediaUrl) {
    return <StateView mode={mode} title='PixFlow Player' subtitle='No active project selected' />;
  }

  return (
    <div className={shellClass}>
      {media.type === 'video' ? (
        <video
          ref={videoRef}
          key={`${media.id || media.file}-${mode}`}
          src={mediaUrl}
          className={mediaClass}
          autoPlay
          muted
          playsInline
          preload={isPreview ? 'metadata' : 'auto'}
          loop={isPreview}
          controls={false}
          onLoadStart={onVideoLoadStart}
          onLoadedData={onVideoLoadedData}
          onCanPlay={onVideoCanPlay}
          onCanPlayThrough={onVideoCanPlayThrough}
          onPlaying={onVideoPlaying}
          onWaiting={onVideoWaiting}
          onStalled={onVideoStalled}
          onEnded={onVideoEnded}
          onError={onVideoError}
        />
      ) : (
        <img
          key={`${media.id || media.file}-${mode}`}
          src={mediaUrl}
          alt=''
          className={mediaClass}
          draggable={false}
          onLoad={onImageLoad}
          onError={onImageError}
        />
      )}

      {paused && (
        <Badge text='Paused' className='left-2 top-2 border-amber-400/40 bg-amber-500/20 text-amber-200' />
      )}
      {mode === 'preview' && isVideoLoading && (
        <div className='absolute inset-0 z-10 flex items-center justify-center bg-black/85 px-8 text-center text-slate-100'>
          <p className='text-sm md:text-base'>{videoLoadMessage}</p>
        </div>
      )}
    </div>
  );
}

function StoppedScreen({ mode, pauseScreen }) {
  const isPauseMediaReady = pauseScreen?.mode === 'custom'
    && pauseScreen?.status !== 'processing'
    && pauseScreen?.status !== 'failed'
    && Boolean(pauseScreen?.mediaFile);
  const pauseMediaUrl = resolveMediaUrl(pauseScreen?.mediaFile);
  if (isPauseMediaReady) {
    if (pauseScreen.mediaType === 'video') {
      return <StoppedVideo mode={mode} src={pauseMediaUrl} />;
    }
    if (pauseScreen.mediaType === 'image') {
      const mediaClass = mode === 'preview' ? 'h-full w-full object-contain' : 'max-h-full max-w-full object-contain';
      return (
        <div className={mode === 'preview' ? 'relative aspect-video w-full overflow-hidden rounded-xl border border-slate-700 bg-black' : 'relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black'}>
          <img src={pauseMediaUrl} alt="" className={mediaClass} draggable={false} />
        </div>
      );
    }
  }
  return <StateView mode={mode} title='PixFlow' subtitle='Kiosk stopped' />;
}

function StoppedVideo({ mode, src }) {
  const videoRef = React.useRef(null);
  const [isReady, setIsReady] = React.useState(false);
  const [hasError, setHasError] = React.useState(false);

  React.useEffect(() => {
    setIsReady(false);
    setHasError(false);

    const video = videoRef.current;
    if (!video || !src) return;

    console.log('[PixFlow] Pause screen video resolved src:', src);
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.loop = true;

    const tryPlay = () => {
      const playPromise = video.play();
      if (playPromise?.catch) {
        playPromise.catch((error) => {
          console.warn('[PixFlow] Pause screen video autoplay failed:', error);
        });
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(tryPlay);
    });
  }, [src]);

  React.useEffect(() => {
    if (!src) return;

    const timeout = setTimeout(() => {
      const video = videoRef.current;
      if (!video) return;

      if (video.readyState >= 1) {
        setIsReady(true);
        const playPromise = video.play();
        if (playPromise?.catch) playPromise.catch(() => {});
        return;
      }

      console.warn('[PixFlow] Pause screen video timeout waiting for readiness', {
        src,
        readyState: video.readyState,
        networkState: video.networkState,
        currentSrc: video.currentSrc,
        error: video.error ? {
          code: video.error.code,
          message: video.error.message,
        } : null,
      });

      // Keep kiosk rendering tolerant to slow loads:
      // only mark as error when the browser reports a terminal failure,
      // not when it is still loading data.
      if (video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
        setHasError(true);
      }
    }, 10000);

    return () => clearTimeout(timeout);
  }, [src]);

  if (hasError) {
    return <StateView mode={mode} title='PixFlow' subtitle='Erreur vidéo écran de pause' />;
  }

  return (
    <div className={mode === 'preview' ? 'relative aspect-video w-full overflow-hidden rounded-xl border border-slate-700 bg-black' : 'relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black'}>
      <video
        ref={videoRef}
        key={src}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        preload='auto'
        controls={mode === 'preview'}
        className={mode === 'preview' ? 'h-full w-full object-contain' : 'h-screen w-screen object-contain'}
        onLoadStart={() => console.log('[PixFlow] Pause screen video loadstart')}
        onLoadedMetadata={() => {
          console.log('[PixFlow] Pause screen video loadedmetadata');
          setIsReady(true);
        }}
        onLoadedData={() => {
          console.log('[PixFlow] Pause screen video loadeddata');
          setIsReady(true);
        }}
        onCanPlay={() => {
          console.log('[PixFlow] Pause screen video canplay');
          setIsReady(true);
          const playPromise = videoRef.current?.play?.();
          if (playPromise?.catch) playPromise.catch((error) => {
            console.warn('[PixFlow] Pause screen video play failed on canplay:', error);
          });
        }}
        onPlaying={() => {
          console.log('[PixFlow] Pause screen video playing');
          setIsReady(true);
        }}
        onWaiting={() => console.log('[PixFlow] Pause screen video waiting')}
        onStalled={() => console.warn('[PixFlow] Pause screen video stalled')}
        onError={() => {
          const video = videoRef.current;
          console.warn('[PixFlow] Pause screen video error:', {
            src,
            error: video?.error ? {
              code: video.error.code,
              message: video.error.message,
            } : null,
          });
          setHasError(true);
        }}
      />
      {mode === 'preview' && !isReady && (
        <div className='absolute inset-0 flex items-center justify-center bg-black/80 text-slate-300'>
          <p className='text-sm md:text-base'>Chargement de l’écran de pause…</p>
        </div>
      )}
    </div>
  );
}

function StateView({ mode, title, subtitle }) {
  if (mode === 'preview') {
    return (
      <div className='relative aspect-video w-full rounded-xl border border-slate-700 bg-black'>
        <div className='flex h-full items-center justify-center px-4 text-center text-slate-300'>
          <div>
            <p className='text-sm font-semibold text-slate-100'>{title}</p>
            <p className='mt-1 text-xs text-slate-400'>{subtitle}</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className='flex h-screen w-screen items-center justify-center overflow-hidden bg-black px-8 text-center text-slate-200'>
      <div>
        <h1 className='text-4xl font-semibold tracking-tight text-slate-100 md:text-6xl'>{title}</h1>
        <p className='mt-5 text-lg text-slate-400 md:text-2xl'>{subtitle}</p>
      </div>
    </div>
  );
}

function Badge({ text, className }) {
  return <span className={`absolute rounded-full border px-2 py-0.5 text-xs ${className}`}>{text}</span>;
}
