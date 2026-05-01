import React, { useEffect, useState } from 'react';
import { api } from '../api';

const INITIAL_FORM = {
  ssid: '',
  password: '',
};
const DEFAULT_PAUSE_SCREEN = { mode: 'default', mediaType: null, mediaFile: null };

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
    ? (pauseScreen.mediaType === 'video' ? 'Vidéo perso' : 'Image perso')
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
  const handlePauseScreenFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setPauseUploadFile(file);
    const url = URL.createObjectURL(file);
    setPausePreviewUrl(url);
    setPauseScreenDraft((prev) => ({ ...prev, mode: 'custom', mediaType: file.type.startsWith('video/') ? 'video' : 'image' }));
  };

  const handlePauseScreenCancel = () => {
    setPauseScreenDraft(pauseScreen);
    setPausePreviewUrl(pauseScreen.mediaFile || '');
    setPauseUploadFile(null);
    setActivePanel('main');
  };

  const handlePauseScreenSave = async (event) => {
    event.preventDefault();
    setIsPauseSaving(true);
    setStatusMessage('');
    setErrorMessage('');
    try {
      if (pauseScreenDraft.mode === 'default') {
        const updated = await api('/api/settings/pause-screen', { method: 'PATCH', body: JSON.stringify({ mode: 'default' }) });
        const nextPauseScreen = { ...DEFAULT_PAUSE_SCREEN, ...(updated?.pauseScreen || {}) };
        setPauseScreen(nextPauseScreen);
        setPauseScreenDraft(nextPauseScreen);
        setPausePreviewUrl('');
      } else {
        if (pauseUploadFile) {
          const formData = new FormData();
          formData.append('file', pauseUploadFile);
          const updated = await api('/api/settings/pause-screen/upload', { method: 'POST', body: formData });
          const nextPauseScreen = { ...DEFAULT_PAUSE_SCREEN, ...(updated?.pauseScreen || {}) };
          setPauseScreen(nextPauseScreen);
          setPauseScreenDraft(nextPauseScreen);
          setPausePreviewUrl(nextPauseScreen.mediaFile || '');
          setPauseUploadFile(null);
        } else {
          await api('/api/settings/pause-screen', { method: 'PATCH', body: JSON.stringify({ mode: 'custom' }) });
        }
      }
      setStatusMessage('Écran de pause enregistré.');
      setActivePanel('main');
    } catch (error) {
      setErrorMessage(parseApiError(error));
    } finally {
      setIsPauseSaving(false);
    }
  };

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
        aria-label={activePanel === 'hotspot' ? 'HotSpot Wi-Fi' : activePanel === 'pauseScreen' ? 'Écran de pause' : 'Paramètres PixFlow'}
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
          ) : (
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
                    {pausePreviewUrl && (pauseScreenDraft.mediaType === 'video' ? <video src={pausePreviewUrl} controls muted loop playsInline className="max-h-64 w-full rounded-lg border border-slate-700 bg-black object-contain" /> : <img src={pausePreviewUrl} alt="" className="max-h-64 w-full rounded-lg border border-slate-700 bg-black object-contain" />)}
                    <p className="text-sm text-slate-400">{pauseScreenDraft.mediaType === 'video' ? 'Vidéo perso' : 'Image perso'}</p>
                  </div>
                )}
                {statusMessage && !errorMessage && <p className="text-sm text-emerald-400">{statusMessage}</p>}
                {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}
              </div>
              <div className="mt-auto flex items-center justify-end gap-3 border-t border-slate-800 px-4 py-4 md:px-6">
                <button type="button" onClick={handlePauseScreenCancel} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800">Annuler</button>
                <button type="submit" disabled={isPauseSaving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60">{isPauseSaving ? 'Enregistrement…' : 'Enregistrer'}</button>
              </div>
            </form>
          )}
        </div>
      </aside>
    </>
  );
}
