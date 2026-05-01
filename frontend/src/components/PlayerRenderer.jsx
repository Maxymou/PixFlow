import React from 'react';

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
      {isVideoLoading && (
        <div className='absolute inset-0 z-10 flex items-center justify-center bg-black/85 px-8 text-center text-slate-100'>
          <p className='text-sm md:text-base'>{videoLoadMessage}</p>
        </div>
      )}
    </div>
  );
}

function StoppedScreen({ mode, pauseScreen }) {
  if (pauseScreen?.mode === 'custom' && pauseScreen?.mediaFile) {
    const mediaClass = mode === 'preview' ? 'h-full w-full object-contain' : 'max-h-full max-w-full object-contain';
    if (pauseScreen.mediaType === 'video') {
      return (
        <div className={mode === 'preview' ? 'relative aspect-video w-full overflow-hidden rounded-xl border border-slate-700 bg-black' : 'relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black'}>
          <video src={pauseScreen.mediaFile} autoPlay muted loop playsInline preload="auto" controls className={mediaClass} />
        </div>
      );
    }
    if (pauseScreen.mediaType === 'image') {
      return (
        <div className={mode === 'preview' ? 'relative aspect-video w-full overflow-hidden rounded-xl border border-slate-700 bg-black' : 'relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black'}>
          <img src={pauseScreen.mediaFile} alt="" className={mediaClass} draggable={false} />
        </div>
      );
    }
  }
  return <StateView mode={mode} title='PixFlow' subtitle='Kiosk stopped' />;
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
