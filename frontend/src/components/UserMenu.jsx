import React, { useEffect, useState } from 'react';
import { api } from '../api';

const INITIAL_FORM = {
  ssid: '',
  password: '',
};

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

  const handleCancel = () => {
    onClose();
  };

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
      const updated = await api('/api/settings/hotspot', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: nextEnabled }),
      });

      setHotspot({
        enabled: updated?.wifi?.hotspotEnabled ?? nextEnabled,
        ethernetConnected: updated?.wifi?.ethernetConnected ?? hotspot.ethernetConnected,
      });

      if (nextEnabled) {
        setStatusMessage('Hotspot Wi-Fi activé.');
      } else if (hotspot.ethernetConnected) {
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
        aria-label="Paramètres PixFlow"
        className="fixed left-0 top-0 z-50 h-full w-[86vw] max-w-sm border-r border-slate-800 bg-slate-950 shadow-2xl md:max-w-md"
      >
        <div className="flex h-full flex-col">
          <div className="border-b border-slate-800 px-4 py-4 md:px-6">
            <h2 className="text-lg font-semibold text-slate-100">Paramètres PixFlow</h2>
            <p className="text-sm text-slate-400">Configuration locale</p>
          </div>

          <form onSubmit={handleSave} className="flex flex-1 flex-col">
            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 md:px-6">
              <section>
                <h3 className="text-sm font-medium text-indigo-300">Hotspot Wi-Fi</h3>

                <div className="mt-4 space-y-4">
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
                        disabled={isHotspotSaving || isLoading}
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
                </div>
              </section>

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
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                Fermer
              </button>
            </div>
          </form>
        </div>
      </aside>
    </>
  );
}
