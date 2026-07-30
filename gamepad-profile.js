// ==========================================================================
//  PROFIL MANETTE  -  stockage partage entre test_manette.html et les Mondes
// --------------------------------------------------------------------------
//  Probleme resolu : localStorage est cloisonne par origine, donc un profil
//  regle sur le PC n'existait pas sur le telephone. Le profil transite
//  desormais par /api/gamepad-profile (voir app.py), rattache a une « fente »
//  identifiee par prenom + code a 4 chiffres, ou par le compte Ghost Chat
//  quand le SSO est branche. localStorage sert de cache et de repli.
//
//  Mode site statique (solo sans Python) : /api/ repond 404. Toutes les
//  fonctions reseau echouent alors en silence et on retombe sur localStorage,
//  sans erreur en console.
//
//  Aucune de ces fonctions ne doit etre appelee depuis une boucle
//  d'animation : elles allouent et font du reseau.
// ==========================================================================

export const GAMEPAD_PROFILE_KEY = 'raphael.flightGamepadBindings.v1';
export const GAMEPAD_PROFILE_LEGACY_KEY = 'raphael.chasseur.gamepad.v1';

const BASE = '/api/gamepad-profile';
const NETWORK_TIMEOUT_MS = 2500;

// Etats renvoyes par les appels reseau, pour que l'interface distingue
// « pas de serveur » (site statique) de « pas encore de profil choisi ».
export const SERVER_UNREACHABLE = 'unreachable';
export const SERVER_NO_SLOT = 'no-slot';
export const SERVER_OK = 'ok';

function isUsableProfile(profile) {
  return !!profile && typeof profile === 'object' && Object.keys(profile).length > 0;
}

function savedAtMs(profile) {
  const parsed = Date.parse(profile?.savedAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * @returns {Promise<{state: string, status: number, data: any, detail: string}>}
 */
async function call(path, options = {}) {
  // AbortController evite qu'un serveur injoignable fige le demarrage du jeu.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
      ...options
    });
    // Un hebergeur statique renvoie souvent une page HTML en 200 sur une route
    // inconnue : sans ce controle on parserait du HTML comme un profil.
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await response.json().catch(() => null) : null;
    if (response.status === 401) return { state: SERVER_NO_SLOT, status: 401, data: null, detail: '' };
    if (!response.ok || !isJson) {
      return { state: SERVER_UNREACHABLE, status: response.status, data: null, detail: data?.detail || '' };
    }
    return { state: SERVER_OK, status: response.status, data, detail: '' };
  } catch {
    return { state: SERVER_UNREACHABLE, status: 0, data: null, detail: '' };
  } finally {
    clearTimeout(timer);
  }
}

/** Lecture synchrone du cache local. Ne fait aucun reseau. */
export function readLocalProfile() {
  try {
    const raw = localStorage.getItem(GAMEPAD_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isUsableProfile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocalProfile(profile) {
  try {
    localStorage.setItem(GAMEPAD_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    /* quota plein ou navigation privee : le profil serveur reste la reference */
  }
}

/**
 * Ouvre ou cree la fente du joueur.
 * @returns {Promise<{ok: boolean, created?: boolean, prenom?: string, taken?: boolean, message: string}>}
 */
export async function claimSlot(prenom, code) {
  const result = await call('/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prenom, code })
  });
  if (result.state === SERVER_OK) {
    return {
      ok: true,
      created: !!result.data?.created,
      prenom: result.data?.prenom || '',
      message: result.data?.created
        ? `Profil « ${result.data.prenom} » créé. Retiens bien ton code.`
        : `Bon retour, ${result.data?.prenom}. Tes commandes sont chargées.`
    };
  }
  if (result.status === 409) return { ok: false, taken: true, message: result.detail };
  if (result.status === 429 || result.status === 400) return { ok: false, message: result.detail };
  return { ok: false, message: 'Serveur injoignable : réglages enregistrés sur cet appareil uniquement.' };
}

/** Fente courante, ou null si aucune (site statique ou profil non choisi). */
export async function whoami() {
  const result = await call('/whoami', { method: 'GET' });
  return result.state === SERVER_OK ? result.data : null;
}

/** Oublie la fente sur cet appareil, sans effacer le profil serveur. */
export async function logout() {
  await call('/logout', { method: 'POST' });
}

/** Profil serveur, ou null si indisponible. */
export async function fetchServerProfile() {
  const result = await call('', { method: 'GET' });
  return result.state === SERVER_OK && isUsableProfile(result.data) ? result.data : null;
}

/**
 * Profil effectif : le plus recent entre serveur et local, compare sur savedAt.
 * Le gagnant est recopie dans localStorage pour que le prochain demarrage soit
 * immediat meme sans reseau.
 */
export async function loadMergedProfile() {
  const local = readLocalProfile();
  const server = await fetchServerProfile();
  if (!server) return local;
  if (!local) {
    writeLocalProfile(server);
    return server;
  }
  // A egalite de date on privilegie le serveur : c'est la source partagee.
  const winner = savedAtMs(local) > savedAtMs(server) ? local : server;
  if (winner === server) writeLocalProfile(server);
  return winner;
}

/**
 * Enregistre en local puis sur le serveur.
 * @returns {Promise<{local: boolean, server: boolean, state: string}>}
 */
export async function persistProfile(profile) {
  let local = true;
  try {
    localStorage.setItem(GAMEPAD_PROFILE_KEY, JSON.stringify(profile));
    localStorage.removeItem(GAMEPAD_PROFILE_LEGACY_KEY);
  } catch {
    local = false;
  }
  const result = await call('', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile)
  });
  return { local, server: result.state === SERVER_OK, state: result.state };
}

/** Efface le profil local et, si joignable, le profil serveur. */
export async function clearProfile() {
  try {
    localStorage.removeItem(GAMEPAD_PROFILE_KEY);
    localStorage.removeItem(GAMEPAD_PROFILE_LEGACY_KEY);
  } catch {
    /* rien a faire : l'effacement serveur reste tente */
  }
  const result = await call('', { method: 'DELETE' });
  return { server: result.state === SERVER_OK };
}
