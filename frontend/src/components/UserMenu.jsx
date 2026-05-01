import React, { useEffect, useState } from 'react';
import { api } from '../api';

const INITIAL_FORM = {
  ssid: '',
  password: '',
};
const DEFAULT_PAUSE_SCREEN = { mode: 'default', mediaType: null, mediaFile: null, status: 'ready', progress: 100, originalName: null, error: null };

const OFFLINE_ERROR = 'Impossible de contacter PixFlow. Vérifiez que le serveur est en ligne.';
const DEBUG_COMMAND_MAX_LENGTH = 500;

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

function MetricBar({ label, value }) {
  const number = Number(value);
  const safeValue = Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="text-slate-400">{safeValue === null ? '—' : `${safeValue}%`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${safeValue ?? 0}%` }} />
      </div>
    </div>
  );
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
  const [runningCommandId, setRunningCommandId] = useState(null);
  const [runningCommandLabel, setRunningCommandLabel] = useState('');
  const [debugResult, setDebugResult] = useState(null);
  const [debugError, setDebugError] = useState('');
  const [debugStatus, setDebugStatus] = useState({ type: 'idle', message: '', id: '', stdout: '', stderr: '' });
  const [debugCommands, setDebugCommands] = useState([]);
  const [editingCommandId, setEditingCommandId] = useState('');
  const [editingCommandValue, setEditingCommandValue] = useState('');
  const [isDebugSaving, setIsDebugSaving] = useState(false);
  const [debugNetwork, setDebugNetwork] = useState(null);
  const [debugSystem, setDebugSystem] = useState(null);
  const [debugNetworkError, setDebugNetworkError] = useState('');
  const [debugSystemError, setDebugSystemError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [isDebugNetworkLoading, setIsDebugNetworkLoading] = useState(false);

  useEffect(() => {
    if (!open) {
      setActivePanel('main');
      return;
    }

    setActivePanel('main');
  }, [open]);

  useEffect(() => {
    if (!open || (activePanel !== 'debug' && activePanel !== 'hotspot')) return undefined;
    let cancelled = false;
    let intervalId = null;

    const loadNetwork = async () => {
      if (!cancelled) setIsDebugNetworkLoading(true);
      try {
        const payload = await api('/api/debug/network');
        if (!cancelled) {
          setDebugNetwork(payload || null);
          setDebugNetworkError('');
        }
      } catch {
        if (!cancelled) {
          setDebugNetwork(null);
          setDebugNetworkError('IP SSH indisponible');
        }
      } finally {
        if (!cancelled) setIsDebugNetworkLoading(false);
      }
    };

    const loadSystem = async () => {
      try {
        const payload = await api('/api/debug/system');
        if (!cancelled) {
          setDebugSystem(payload || null);
          setDebugSystemError('');
        }
      } catch {
        if (!cancelled) {
          setDebugSystem(null);
          setDebugSystemError('Stats Raspberry indisponibles');
        }
      }
    };

    loadNetwork();
    if (activePanel === 'debug') {
      loadSystem();
      intervalId = setInterval(loadSystem, 5000);
    }
    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [open, activePanel]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [open]);

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
        const debugPayload = await api('/api/debug/commands');
        setDebugCommands(debugPayload?.commands || []);

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

  const handlePauseScreenSave = async (event) => {
    event.preventDefault();

    setIsPauseSaving(true);
    setStatusMessage('');
    setErrorMessage('');

    try {
      if (pauseScreenDraft.mode === 'default') {
        const updated = await api('/api/settings/pause-screen', {
          method: 'PATCH',
          body: JSON.stringify({ mode: 'default' }),
        });

        const nextPauseScreen = {
          ...DEFAULT_PAUSE_SCREEN,
          ...(updated?.pauseScreen || {}),
        };

        setPauseScreen(nextPauseScreen);
        setPauseScreenDraft(nextPauseScreen);
        setPausePreviewUrl('');
        setPauseUploadFile(null);
        setPauseUploadProgress(0);
        setPauseUploadPhase('idle');
        setStatusMessage('Écran de pause enregistré.');
        setActivePanel('main');
        return;
      }

      const currentCustom = pauseScreenDraft;

      if (pauseUploadPhase === 'uploading' || pauseUploadPhase === 'processing' || isPauseAutoUploading) {
        setErrorMessage('Le média est encore en préparation.');
        return;
      }

      if (!currentCustom.mediaFile) {
        setErrorMessage('Sélectionnez d’abord une image ou une vidéo.');
        return;
      }

      if (currentCustom.status === 'processing') {
        setErrorMessage('Le média est encore en préparation.');
        return;
      }

      if (currentCustom.status === 'failed') {
        setErrorMessage(currentCustom.error || 'Le média personnalisé est en erreur.');
        return;
      }

      const updated = await api('/api/settings/pause-screen', {
        method: 'PATCH',
        body: JSON.stringify({ mode: 'custom' }),
      });

      const nextPauseScreen = {
        ...DEFAULT_PAUSE_SCREEN,
        ...(updated?.pauseScreen || {}),
      };

      setPauseScreen(nextPauseScreen);
      setPauseScreenDraft(nextPauseScreen);
      setPausePreviewUrl(nextPauseScreen.mediaFile || '');
      setPauseUploadFile(null);
      setPauseUploadProgress(100);
      setPauseUploadPhase('ready');
      setStatusMessage('Écran de pause enregistré.');
      setActivePanel('main');
    } catch (error) {
      setErrorMessage(parseApiError(error));
    } finally {
      setIsPauseSaving(false);
    }
  };

  const runDebugAction = async (commandItem) => {
    if (!commandItem?.id) return;

    const confirmed = window.confirm('Voulez-vous exécuter cette commande sur le Raspberry Pi ?');
    if (!confirmed) return;

    const runningMessageByCommandId = {
      update: 'Mise à jour en cours. Le serveur peut être temporairement indisponible.',
      'restart-kiosk': 'Redémarrage du kiosk en cours…',
    };

    setRunningCommandId(commandItem.id);
    setRunningCommandLabel(commandItem.label || commandItem.id);
    setDebugResult(null);
    setDebugError('');
    setDebugStatus({ type: 'running', id: commandItem.id, message: runningMessageByCommandId[commandItem.id] || 'Commande en cours…', stdout: '', stderr: '' });

    try {
      const result = await api('/api/debug/action', {
        method: 'POST',
        body: JSON.stringify({ id: commandItem.id }),
      });
      if (commandItem.id === 'update' && result?.background) {
        const infoPayload = {
          type: 'success',
          id: commandItem.id,
          message: result?.message || 'Mise à jour lancée. Le serveur peut être temporairement indisponible.',
          stdout: '',
          stderr: '',
        };
        setDebugStatus(infoPayload);
        setDebugResult(infoPayload);
        setDebugError('');
        return;
      }
      const statusPayload = {
        type: result?.ok ? 'success' : 'error',
        id: commandItem.id,
        message: result?.message || (result?.ok ? 'Commande exécutée.' : 'Erreur pendant l’exécution de la commande.'),
        stdout: result?.stdout || '',
        stderr: result?.stderr || '',
      };
      setDebugStatus(statusPayload);
      setDebugResult(statusPayload);
      if (!result?.ok) {
        setDebugError(statusPayload.message);
      }
    } catch (error) {
      const parsedError = parseApiError(error);
      if (commandItem.id === 'update' && (parsedError.includes('502 Bad Gateway') || parsedError === OFFLINE_ERROR)) {
        const infoPayload = {
          type: 'success',
          id: commandItem.id,
          message: 'Mise à jour lancée. La connexion au serveur peut avoir été interrompue pendant le redémarrage. Rafraîchissez la page dans quelques instants.',
          stdout: '',
          stderr: '',
        };
        setDebugStatus(infoPayload);
        setDebugResult(infoPayload);
        setDebugError('');
        return;
      }
      const errorPayload = { type: 'error', id: commandItem.id, message: 'Erreur pendant l’exécution de la commande.', stdout: '', stderr: parsedError };
      setDebugStatus(errorPayload);
      setDebugResult(errorPayload);
      setDebugError(parsedError);
    } finally {
      setRunningCommandId(null);
      setRunningCommandLabel('');
    }
  };

  const startEditDebugCommand = (commandItem) => {
    setEditingCommandId(commandItem.id);
    setEditingCommandValue(commandItem.command || '');
  };

  const cancelEditDebugCommand = () => {
    setEditingCommandId('');
    setEditingCommandValue('');
  };

  const saveDebugCommand = async (commandItem) => {
    const value = editingCommandValue.trim();
    if (!value) {
      setErrorMessage('La commande ne peut pas être vide.');
      return;
    }
    if (value.length > DEBUG_COMMAND_MAX_LENGTH) {
      setErrorMessage(`La commande dépasse ${DEBUG_COMMAND_MAX_LENGTH} caractères.`);
      return;
    }

    setIsDebugSaving(true);
    setErrorMessage('');

    try {
      const result = await api(`/api/debug/commands/${encodeURIComponent(commandItem.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ command: value }),
      });

      const updated = result?.command;
      if (updated?.id) {
        setDebugCommands((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      }
      setStatusMessage('Commande enregistrée.');
      cancelEditDebugCommand();
    } catch (error) {
      setErrorMessage(parseApiError(error));
    } finally {
      setIsDebugSaving(false);
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
  const networkIps = Array.isArray(debugNetwork?.ips) ? debugNetwork.ips : [];
  const otherIps = networkIps.map((item) => `${item.interface} ${item.address}`).join(' · ');
  const sshIpFromCommand = (() => {
    if (!debugNetwork?.sshCommand) return '';
    const match = debugNetwork.sshCommand.match(/@([^\s]+)/);
    return match?.[1] || '';
  })();
  const fallbackIp = networkIps.find((item) => item?.address)?.address || '';
  const displaySshIp = sshIpFromCommand || fallbackIp;

  const handleCopySsh = async () => {
    if (!debugNetwork?.sshCommand) return;
    if (!navigator?.clipboard?.writeText) {
      setCopyStatus('Copie impossible');
      return;
    }
    try {
      await navigator.clipboard.writeText(debugNetwork.sshCommand);
      setCopyStatus('Copié');
    } catch {
      setCopyStatus('Copie impossible');
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
        aria-label={activePanel === 'hotspot' ? 'HotSpot Wi-Fi' : activePanel === 'pauseScreen' ? 'Écran de pause' : activePanel === 'debug' ? 'Débug' : 'Paramètres PixFlow'}
        className="fixed left-0 top-0 z-50 h-dvh w-[86vw] max-w-sm overflow-hidden border-r border-slate-800 bg-slate-950 shadow-2xl md:max-w-md"
      >
        <div className="flex h-full min-h-0 flex-col">
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
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2.5">
                  <p className="text-sm font-medium text-indigo-300">Connexion SSH</p>
                  {isDebugNetworkLoading ? (
                    <p className="mt-2 text-sm text-slate-300">Recherche de l’IP…</p>
                  ) : debugNetworkError ? (
                    <p className="mt-2 text-sm text-slate-300">IP SSH indisponible</p>
                  ) : displaySshIp ? (
                    <>
                      <p className="mt-2 text-sm text-slate-100">IP : {displaySshIp}</p>
                      {debugNetwork?.sshCommand && <p className="mt-1 text-xs text-slate-400">{debugNetwork.sshCommand}</p>}
                      {debugNetwork?.sshCommand && (
                        <button type="button" onClick={handleCopySsh} className="mt-3 rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-100">
                          Copier
                        </button>
                      )}
                      {copyStatus && <p className="mt-1 text-xs text-slate-400">{copyStatus}</p>}
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-slate-300">Aucune IP détectée</p>
                  )}
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
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b border-slate-800 px-4 py-4 md:px-6">
                <button type="button" onClick={() => setActivePanel('main')} className="mb-2 text-sm text-slate-300 transition hover:text-slate-100">&lt; Retour</button>
                <h2 className="text-lg font-semibold text-slate-100">Débug</h2>
                <p className="text-sm text-slate-400">Commandes système Raspberry</p>
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y px-4 py-5 pb-8 md:px-6"
                onWheel={(event) => event.stopPropagation()}
                onTouchMove={(event) => event.stopPropagation()}
              >
                <div className="space-y-5">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-slate-100">
                  <p className="text-sm font-medium text-indigo-300">Connexion SSH</p>
                  <p className="mt-2 text-sm">{debugNetwork?.sshCommand || debugNetworkError || 'IP SSH indisponible'}</p>
                  {otherIps && <p className="mt-1 text-xs text-slate-400">Autres IP : {otherIps}</p>}
                  <button type="button" onClick={handleCopySsh} className="mt-3 rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-100 disabled:opacity-50" disabled={!debugNetwork?.sshCommand}>Copier</button>
                  {copyStatus && <p className="mt-1 text-xs text-slate-400">{copyStatus}</p>}
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 text-slate-100">
                  <p className="text-sm font-medium text-indigo-300">État du Raspberry Pi</p>
                  {debugSystemError ? (
                    <p className="mt-2 text-sm text-slate-400">{debugSystemError}</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      <MetricBar label="CPU" value={debugSystem?.cpu?.percent} />
                      <MetricBar label="RAM" value={debugSystem?.memory?.percent} />
                      <MetricBar label="Disque" value={debugSystem?.disk?.percent} />
                      <div className="flex items-center justify-between text-xs"><span className="text-slate-300">Temp.</span><span className="text-slate-400">{Number.isFinite(Number(debugSystem?.temperature?.celsius)) ? `${Math.round(Number(debugSystem?.temperature?.celsius))} °C` : '—'}</span></div>
                      <div className="flex items-center justify-between text-xs"><span className="text-slate-300">Uptime</span><span className="text-slate-400">{debugSystem?.uptime?.label || '—'}</span></div>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">Attention : ces commandes sont exécutées sur le Raspberry Pi. Une mauvaise commande peut bloquer PixFlow.</div>

                {runningCommandId && (
                  <div className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-3">
                    <p className="text-sm font-medium text-indigo-100">Commande en cours…</p>
                    <p className="mt-1 text-xs text-indigo-200/80">{runningCommandLabel} en cours…</p>
                    <p className="mt-1 text-xs text-indigo-200/70">{debugStatus.message}</p>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
                      <div className="debug-progress-bar h-full rounded-full bg-indigo-500" />
                    </div>
                  </div>
                )}

                {debugCommands.map((cmd) => {
                  const isEditing = editingCommandId === cmd.id;
                  return (
                    <div key={cmd.id} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3 space-y-3">
                      <button type="button" disabled={Boolean(runningCommandId) || isDebugSaving} onClick={() => runDebugAction(cmd)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-left text-sm text-slate-100 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60">
                        <p className="font-medium">{cmd.label}</p>
                      </button>
                      <div>
                        <p className="text-xs text-slate-400">Commande exécutée :</p>
                        {isEditing ? (
                          <textarea value={editingCommandValue} onChange={(e) => setEditingCommandValue(e.target.value)} maxLength={DEBUG_COMMAND_MAX_LENGTH} rows={3} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-100" />
                        ) : (
                          <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-slate-800 bg-black/50 p-2 text-xs text-slate-200">{cmd.command}</pre>
                        )}
                      </div>
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button type="button" onClick={() => saveDebugCommand(cmd)} disabled={Boolean(runningCommandId) || isDebugSaving} className="rounded bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-60">Enregistrer</button>
                          <button type="button" onClick={cancelEditDebugCommand} disabled={Boolean(runningCommandId) || isDebugSaving} className="rounded border border-slate-700 px-3 py-2 text-xs">Annuler</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => startEditDebugCommand(cmd)} disabled={Boolean(runningCommandId) || isDebugSaving} className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-100">Modifier</button>
                      )}
                    </div>
                  );
                })}

                {debugStatus.type !== 'idle' && (
                  <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3 text-xs">
                    <p className={`font-medium ${debugStatus.type === 'error' ? 'text-rose-400' : debugStatus.type === 'running' ? 'text-slate-300' : 'text-emerald-400'}`}>{debugStatus.message}</p>
                    {debugStatus.stdout && <pre className="mt-2 max-h-32 overflow-auto rounded border border-slate-800 bg-black/60 p-2 text-slate-300">{debugStatus.stdout}</pre>}
                    {debugStatus.stderr && <pre className="mt-2 max-h-32 overflow-auto rounded border border-slate-800 bg-black/60 p-2 text-rose-300">{debugStatus.stderr}</pre>}
                  </div>
                )}
                {statusMessage && !errorMessage && <p className="text-sm text-emerald-400">{statusMessage}</p>}
                {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
