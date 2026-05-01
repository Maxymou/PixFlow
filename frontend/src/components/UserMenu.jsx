import React, { useEffect, useState } from 'react';
import { api } from '../api';

const INITIAL_FORM = {
  ssid: '',
  password: '',
};
const DEFAULT_PAUSE_SCREEN = { mode: 'default', mediaType: null, mediaFile: null, status: 'ready', progress: 100, originalName: null, error: null };

const OFFLINE_ERROR = 'Impossible de contacter PixFlow. Vérifiez que le serveur est en ligne.';

function parseApiError(error) {
  if (!error?.message) return OFFLINE_ERROR;

  try {
    const parsed = JSON.parse(error.message);
    if (parsed?.error) return parsed.error;
  } catch {
    // Fallback to raw message below.
  }

  if (error.message.toLowerCase().includes('failed to fetch')) {
    return OFFLINE_ERROR;
  }

  return error.message;
}

function uploadPauseScreenFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/settings/pause-screen/upload');

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress(Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100))));
    };

    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
        else reject(new Error(payload.error || xhr.responseText || `Upload failed with status ${xhr.status}`));
      } catch {
        reject(new Error(xhr.responseText || `Upload failed with status ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.send(formData);
  });
}

export function UserMenu({ open, onClose }) {
  const [activePanel, setActivePanel] = useState('main');
  const [form, setForm] = useState(INITIAL_FORM);
  const [hotspot, setHotspot] = useState({
    enabled: true,
    ethernetConnected: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isHotspotSaving, setIsHotspotSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pauseScreen, setPauseScreen] = useState(DEFAULT_PAUSE_SCREEN);
  const [pauseScreenDraft, setPauseScreenDraft] = useState(DEFAULT_PAUSE_SCREEN);
  const [pausePreviewUrl, setPausePreviewUrl] = useState('');
  const [pauseUploadFile, setPauseUploadFile] = useState(null);
  const [isPauseSaving, setIsPauseSaving] = useState(false);
  const [pauseUploadProgress, setPauseUploadProgress] = useState(0);
  const [pauseUploadPhase, setPauseUploadPhase] = useState('idle');
  const [isPauseAutoUploading, setIsPauseAutoUploading] = useState(false);
  const [isDebugRunning, setIsDebugRunning] = useState(false);
  const [debugStatus, setDebugStatus] = useState({ type: 'idle', message: '', action: '', stdout: '', stderr: '' });

  useEffect(() => {
    if (!open) {
      setActivePanel('main');
      return;
    }

    setActivePanel('main');
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;

    let mounted = true;

    const loadSettings = async () => {
      setIsLoading(true);
      setStatusMessage('Chargement des paramètres…');
      setErrorMessage('');

      try {
        const settings = await api('/api/settings');
        if (!mounted) return;

        setForm({
          ssid: settings?.wifi?.ssid || '',
          password: settings?.wifi?.password || '',
        });
        setHotspot({
          enabled: settings?.wifi?.hotspotEnabled ?? true,
          ethernetConnected: settings?.wifi?.ethernetConnected ?? false,
        });
        setStatusMessage('');
        const resolvedPauseScreen = {
          ...DEFAULT_PAUSE_SCREEN,
          ...(settings?.pauseScreen || {}),
        };
        setPauseScreen(resolvedPauseScreen);
        setPauseScreenDraft(resolvedPauseScreen);
        setPausePreviewUrl(resolvedPauseScreen.mediaFile || '');
        setPauseUploadFile(null);
        if (resolvedPauseScreen.status === 'processing') {
          setPauseUploadPhase('processing');
          setPauseUploadProgress(Number(resolvedPauseScreen.progress) || 0);
        } else if (resolvedPauseScreen.status === 'ready' && resolvedPauseScreen.mediaFile) {
          setPauseUploadPhase('ready');
          setPauseUploadProgress(100);
        } else if (resolvedPauseScreen.status === 'failed') {
          setPauseUploadPhase('failed');
          setPauseUploadProgress(0);
        } else {
          setPauseUploadPhase('idle');
          setPauseUploadProgress(0);
        }
      } catch (error) {
        if (!mounted) return;
        setStatusMessage('');
        setErrorMessage(parseApiError(error));
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    loadSettings();

    return () => {
      mounted = false;
    };
  }, [open]);

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleCancel = () => setActivePanel('main');
  const pauseScreenLabel = pauseScreen.mode === 'custom'
    ? (pauseScreen.mediaFile ? (pauseScreen.mediaType === 'video' ? 'Vidéo perso' : 'Image perso') : 'Aucun fichier sélectionné')
    : 'Par défaut';

  const handleHotspotToggle = async (event) => {
    const nextEnabled = event.target.checked;

    setStatusMessage('');
    setErrorMessage('');

    if (!nextEnabled && !hotspot.ethernetConnected) {
      const confirmDisable = window.confirm(
        'Aucun câble RJ45 n’est détecté.\n\nSi vous coupez le hotspot Wi-Fi maintenant, vous risquez de perdre la connexion avec PixFlow.\n\nVoulez-vous vraiment désactiver le hotspot ?',
      );

      if (!confirmDisable) return;
    }

    setIsHotspotSaving(true);

    try {
      const previousHotspotState = hotspot;
      const updated = await api('/api/settings/hotspot', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled }),
      });

      const realEnabled = updated?.wifi?.hotspotEnabled ?? previousHotspotState.enabled;
      const ethernetConnected = updated?.wifi?.ethernetConnected ?? previousHotspotState.ethernetConnected;
      setHotspot({
        enabled: realEnabled,
        ethernetConnected,
      });

      if (!nextEnabled && realEnabled) {
        setStatusMessage('');
        setErrorMessage('Le hotspot est toujours actif. Désactivation impossible.');
      } else if (nextEnabled) {
        setStatusMessage('Hotspot Wi-Fi activé.');
      } else if (ethernetConnected) {
        setStatusMessage('Hotspot Wi-Fi désactivé.');
      } else {
        setStatusMessage('Hotspot Wi-Fi désactivé. La connexion peut être perdue.');
      }
    } catch (error) {
      setErrorMessage(parseApiError(error));
    } finally {
      setIsHotspotSaving(false);
    }
  };

  const handleSave = async (event) => {
    event.preventDefault();
    setStatusMessage('');
    setErrorMessage('');

    const ssid = form.ssid.trim();
    const password = form.password;

    if (!ssid) {
      setErrorMessage('Le nom du réseau Wi-Fi est obligatoire.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Le mot de passe Wi-Fi doit contenir au moins 8 caractères.');
      return;
    }

    setIsSaving(true);
    setStatusMessage('Sauvegarde en cours…');

    try {
      const updated = await api('/api/settings/wifi', {
        method: 'PATCH',
        body: JSON.stringify({ ssid, password }),
      });

      setForm({
        ssid: updated?.wifi?.ssid || ssid,
        password: updated?.wifi?.password || password,
      });
      setStatusMessage('Paramètres Wi-Fi enregistrés.');
    } catch (error) {
      setStatusMessage('');
      setErrorMessage(parseApiError(error));
    } finally {
      setIsSaving(false);
    }
  };
  const uploadSelectedPauseScreenFile = async (file) => {
    const isVideo = file.type.startsWith('video/');
    setStatusMessage('');
    setErrorMessage('');
    setIsPauseAutoUploading(true);
    setPauseUploadPhase('uploading');
    setPauseUploadProgress(0);

    try {
      const updated = await uploadPauseScreenFile(file, setPauseUploadProgress);
      const nextPauseScreen = {
        ...DEFAULT_PAUSE_SCREEN,
        ...(updated?.pauseScreen || {}),
      };

      setPauseScreen(nextPauseScreen);
      setPauseScreenDraft(nextPauseScreen);
      setPausePreviewUrl(nextPauseScreen.mediaFile || '');

      if (isVideo && nextPauseScreen.status === 'processing') {
        setPauseUploadPhase('processing');

        let done = false;
        while (!done) {
          await new Promise((resolve) => setTimeout(resolve, 1200));

          const polled = await api('/api/settings');
          const polledPause = {
            ...DEFAULT_PAUSE_SCREEN,
            ...(polled?.pauseScreen || {}),
          };

          setPauseScreen(polledPause);
          setPauseScreenDraft(polledPause);
          setPauseUploadProgress(Math.max(0, Math.min(100, Number(polledPause.progress) || 0)));

          if (polledPause.status === 'ready') {
            setPauseUploadPhase('ready');
            setPauseUploadProgress(100);
            setPausePreviewUrl(polledPause.mediaFile || '');
            done = true;
          } else if (polledPause.status === 'failed') {
            setPauseUploadPhase('failed');
            throw new Error(polledPause.error || 'La conversion vidéo a échoué.');
          }
        }
      } else {
        setPauseUploadPhase('ready');
        setPauseUploadProgress(100);
      }

      setPauseUploadFile(null);
      setStatusMessage(isVideo ? 'Vidéo prête.' : 'Image prête.');
    } catch (error) {
      setPauseUploadPhase('failed');
      setErrorMessage(parseApiError(error));
    } finally {
      setIsPauseAutoUploading(false);
    }
  };

  const handlePauseScreenFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith('video/');

    setPauseUploadFile(file);
    setPausePreviewUrl(isVideo ? '' : URL.createObjectURL(file));
    setPauseScreenDraft((prev) => ({
      ...prev,
      mode: 'custom',
      mediaType: isVideo ? 'video' : 'image',
      originalName: file.name,
      status: 'uploading',
      progress: 0,
      error: null,
    }));

    setPauseUploadPhase('uploading');
    setPauseUploadProgress(0);

    uploadSelectedPauseScreenFile(file);
  };

  const handlePauseScreenCancel = () => {
    setPauseScreenDraft(pauseScreen);
    setPausePreviewUrl(pauseScreen.mediaFile || '');
    setPauseUploadFile(null);
    setPauseUploadProgress(0);
    setPauseUploadPhase('idle');
    setActivePanel('main');
  };

  const runDebugAction = async (action) => {
    setIsDebugRunning(true);
    setDebugStatus({
      type: 'running',
      action,
      message: 'Commande en cours…',
      stdout: '',
      stderr: '',
    });

    try {
      const result = await api('/api/debug/action', {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setDebugStatus({
        type: 'success',
        action,
        message: result?.message || 'Commande exécutée.',
        stdout: result?.stdout || '',
        stderr: result?.stderr || '',
      });
    } catch (error) {
      if (action === 'update') {
        setDebugStatus({
          type: 'warning',
          action,
          message: 'Mise à jour lancée. Le serveur peut être temporairement indisponible.',
          stdout: '',
          stderr: parseApiError(error),
        });
      } else {
        setDebugStatus({
          type: 'error',
          action,
          message: 'Erreur pendant l’exécution de la commande.',
          stdout: '',
          stderr: parseApiError(error),
        });
      }
    } finally {
      setIsDebugRunning(false);
    }
  };

  const handlePauseScreenSave = async (event) => {
    event.preventDefault();
    setStatusMessage('');
    setErrorMessage('');

    if (pauseUploadPhase === 'uploading' || pauseUploadPhase === 'processing') {
      setErrorMessage('La vidéo est encore en préparation.');
      return;
    }

    try {
      setIsPauseSaving(true);
      if (pauseScreenDraft.mode === 'default') {
        const updated = await api('/api/settings/pause-screen', { method: 'PATCH', body: JSON.stringify({ mode: 'default' }) });
        const nextPauseScreen = { ...DEFAULT_PAUSE_SCREEN, ...(updated?.pauseScreen || {}) };
        setPauseScreen(nextPauseScreen);
        setPauseScreenDraft(nextPauseScreen);
        setPausePreviewUrl('');
      } else {
        const isReadyCustom = pauseScreenDraft.status === 'ready' && pauseScreenDraft.mediaFile;
        if (!isReadyCustom) {
          setErrorMessage('Sélectionnez d’abord une image ou une vidéo.');
          return;
        }

        const updated = await api('/api/settings/pause-screen', { method: 'PATCH', body: JSON.stringify({ mode: 'custom' }) });
        const nextPauseScreen = { ...DEFAULT_PAUSE_SCREEN, ...(updated?.pauseScreen || {}) };
        setPauseScreen(nextPauseScreen);
        setPauseScreenDraft(nextPauseScreen);
        setPausePreviewUrl(nextPauseScreen.mediaFile || '');
      }
      setStatusMessage('Écran de pause enregistré.');
      setActivePanel('main');
    } catch (error) {
      setPauseUploadPhase('failed');
      setErrorMessage(parseApiError(error));
    } finally {
      setIsPauseSaving(false);
    }
  };

  const pauseDisplayStatus = (() => {
    if (pauseUploadPhase === 'uploading') return 'Upload en cours';
    if (pauseUploadPhase === 'processing') return 'Conversion en cours';
    if (pauseUploadPhase === 'failed') return 'Échec';

    if (pauseScreenDraft.status === 'processing') return 'Conversion en cours';
    if (pauseScreenDraft.status === 'failed') return 'Échec';
    if (pauseScreenDraft.status === 'ready' && pauseScreenDraft.mediaFile) return 'Prête';

    return 'Aucun fichier sélectionné';
  })();


  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={activePanel === 'hotspot' ? 'HotSpot Wi-Fi' : activePanel === 'pauseScreen' ? 'Écran de pause' : activePanel === 'debug' ? 'Débug' : 'Paramètres PixFlow'}
        className="fixed left-0 top-0 z-50 h-full w-[86vw] max-w-sm border-r border-slate-800 bg-slate-950 shadow-2xl md:max-w-md"
      >
        <div className="flex h-full flex-col">
          {activePanel === 'main' ? (
            <>
              <div className="border-b border-slate-800 px-4 py-4 md:px-6">
                <h2 className="text-lg font-semibold text-slate-100">Paramètres PixFlow</h2>
                <p className="text-sm text-slate-400">Configuration locale</p>
              </div>
              <div className="flex flex-1 flex-col">
                <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 md:px-6">
                  <button
                    type="button"
                    onClick={() => setActivePanel('hotspot')}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-left transition hover:bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-100">HotSpot Wi-Fi</p>
                        <p className="text-xs text-slate-400">Réseau local et accès Wi-Fi</p>
                      </div>
                      <span className="text-lg text-slate-400">›</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanel('pauseScreen')}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-left transition hover:bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-100">Écran de pause</p>
                        <p className="text-xs text-slate-400">{pauseScreenLabel}</p>
                      </div>
                      <span className="text-lg text-slate-400">›</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActivePanel('debug')}
                    className="w-full rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3 text-left transition hover:bg-slate-900"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-100">Débug</p>
                        <p className="text-xs text-slate-400">Commandes système Raspberry</p>
                      </div>
                      <span className="text-lg text-slate-400">›</span>
                    </div>
                  </button>
                </div>
                <div className="mt-auto flex items-center justify-end border-t border-slate-800 px-4 py-4 md:px-6">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                  >
                    Fermer
                  </button>
                </div>
              </div>
            </>
          ) : activePanel === 'hotspot' ? (
            <form onSubmit={handleSave} className="flex flex-1 flex-col">
              <div className="border-b border-slate-800 px-4 py-4 md:px-6">
                <button
                  type="button"
                  onClick={() => setActivePanel('main')}
                  className="mb-2 text-sm text-slate-300 transition hover:text-slate-100"
                >
                  &lt; Retour
                </button>
                <h2 className="text-lg font-semibold text-slate-100">HotSpot Wi-Fi</h2>
                <p className="text-sm text-slate-400">Réglages du réseau local</p>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 md:px-6">
                <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
                  <div>
                    <p className="text-sm text-slate-200">Hotspot Wi-Fi</p>
                    <p className={`text-xs ${hotspot.enabled ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {hotspot.enabled ? 'Activé' : 'Désactivé'}
                    </p>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={hotspot.enabled}
                      onChange={handleHotspotToggle}
                      disabled={isHotspotSaving || isLoading || isSaving}
                    />
                    <span className="slider"></span>
                  </label>
                </div>

                <label className="block text-sm text-slate-200">
                  Nom du réseau Wi-Fi
                  <input
                    type="text"
                    value={form.ssid}
                    onChange={handleChange('ssid')}
                    placeholder="PixFlow"
                    maxLength={32}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-slate-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-600/40"
                  />
                </label>

                <label className="block text-sm text-slate-200">
                  Mot de passe Wi-Fi
                  <input
                    type="text"
                    value={form.password}
                    onChange={handleChange('password')}
                    placeholder="Minimum 8 caractères"
                    minLength={8}
                    maxLength={63}
                    className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 text-slate-100 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-600/40"
                  />
                </label>

                {isLoading && <p className="text-sm text-slate-400">Chargement des paramètres…</p>}
                {statusMessage && !errorMessage && <p className="text-sm text-emerald-400">{statusMessage}</p>}
                {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}
              </div>

              <div className="mt-auto flex items-center justify-end gap-3 border-t border-slate-800 px-4 py-4 md:px-6">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </form>
          ) : activePanel === 'pauseScreen' ? (
            <form onSubmit={handlePauseScreenSave} className="flex flex-1 flex-col">
              <div className="border-b border-slate-800 px-4 py-4 md:px-6">
                <button type="button" onClick={() => setActivePanel('main')} className="mb-2 text-sm text-slate-300 transition hover:text-slate-100">&lt; Retour</button>
                <h2 className="text-lg font-semibold text-slate-100">Écran de pause</h2>
                <p className="text-sm text-slate-400">Contenu affiché quand le kiosque est arrêté</p>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-slate-200"><input type="radio" name="pauseMode" checked={pauseScreenDraft.mode === 'default'} onChange={() => setPauseScreenDraft((prev) => ({ ...prev, mode: 'default' }))} /> Par défaut</label>
                  <label className="flex items-center gap-2 text-sm text-slate-200"><input type="radio" name="pauseMode" checked={pauseScreenDraft.mode === 'custom'} onChange={() => setPauseScreenDraft((prev) => ({ ...prev, mode: 'custom' }))} /> Personnaliser</label>
                </div>
                {pauseScreenDraft.mode === 'default' ? (
                  <div className="flex aspect-video items-center justify-center rounded-lg border border-slate-700 bg-black text-center">
                    <div><p className="text-lg font-semibold text-slate-100">PixFlow</p><p className="text-sm text-slate-400">Kiosk stopped</p></div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <input type="file" accept="image/*,video/*" onChange={handlePauseScreenFileChange} className="block w-full text-sm text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200 hover:file:bg-slate-700" />
                    {pausePreviewUrl && pauseScreenDraft.mediaType !== 'video' && <img src={pausePreviewUrl} alt="" className="max-h-64 w-full rounded-lg border border-slate-700 bg-black object-contain" />}
                    {pauseScreenDraft.mediaType === 'video' && (
                      <div className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-5 text-sm text-slate-300">
                        <p className="font-medium text-slate-100">Vidéo sélectionnée</p>
                        <p className="mt-1 text-xs text-slate-400">Nom : {pauseUploadFile?.name || pauseScreenDraft.originalName || 'vidéo'}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          Statut : {pauseDisplayStatus}
                        </p>
                      </div>
                    )}
                    {(pauseUploadPhase === 'uploading' || pauseUploadPhase === 'processing') && (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-300">{pauseUploadPhase === 'uploading' ? `Téléchargement de la vidéo… ${pauseUploadProgress}%` : `Conversion de la vidéo… ${pauseUploadProgress}%`}</p>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div className="h-full bg-indigo-500 transition-all" style={{ width: `${pauseUploadProgress}%` }} />
                        </div>
                      </div>
                    )}
                    <p className="text-sm text-slate-400">{pauseScreenDraft.mediaType === 'video' ? 'Vidéo perso' : 'Image perso'}</p>
                  </div>
                )}
                {statusMessage && !errorMessage && <p className="text-sm text-emerald-400">{statusMessage}</p>}
                {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}
              </div>
              <div className="mt-auto flex items-center justify-end gap-3 border-t border-slate-800 px-4 py-4 md:px-6">
                <button type="button" onClick={handlePauseScreenCancel} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800">Annuler</button>
                <button type="submit" disabled={isPauseSaving || isPauseAutoUploading || pauseUploadPhase === 'uploading' || pauseUploadPhase === 'processing'} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">{isPauseSaving ? 'Enregistrement…' : (pauseUploadPhase === 'uploading' || pauseUploadPhase === 'processing') ? 'Préparation…' : 'Enregistrer'}</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-1 flex-col">
              <div className="border-b border-slate-800 px-4 py-4 md:px-6">
                <button type="button" onClick={() => setActivePanel('main')} className="mb-2 text-sm text-slate-300 transition hover:text-slate-100">&lt; Retour</button>
                <h2 className="text-lg font-semibold text-slate-100">Débug</h2>
                <p className="text-sm text-slate-400">Commandes système Raspberry</p>
              </div>
              <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6">
                <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                  Ces commandes agissent directement sur le Raspberry Pi. À utiliser uniquement en maintenance.
                </div>

                <button
                  type="button"
                  disabled={isDebugRunning}
                  onClick={() => runDebugAction('update')}
                  className="w-full rounded-lg border border-slate-800 bg-indigo-600 px-4 py-3 text-left text-sm text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="font-medium">Mettre à jour PixFlow</p>
                  <p className="text-xs text-indigo-100/90">Lance ./update.sh sur le Raspberry.</p>
                </button>

                <button
                  type="button"
                  disabled={isDebugRunning}
                  onClick={() => runDebugAction('restart-kiosk')}
                  className="w-full rounded-lg border border-slate-800 bg-slate-900 px-4 py-3 text-left text-sm text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <p className="font-medium">Relancer le kiosk</p>
                  <p className="text-xs text-slate-400">Redémarre le service pixflow-kiosk.</p>
                </button>

                {debugStatus.type !== 'idle' && (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs">
                    <p className={`font-medium ${debugStatus.type === 'error' ? 'text-rose-400' : debugStatus.type === 'warning' ? 'text-amber-300' : debugStatus.type === 'running' ? 'text-slate-300' : 'text-emerald-400'}`}>
                      {debugStatus.message}
                    </p>
                    {debugStatus.stdout && <pre className="mt-2 max-h-32 overflow-auto rounded border border-slate-800 bg-black/60 p-2 text-slate-300">{debugStatus.stdout}</pre>}
                    {debugStatus.stderr && <pre className="mt-2 max-h-32 overflow-auto rounded border border-slate-800 bg-black/60 p-2 text-rose-300">{debugStatus.stderr}</pre>}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
