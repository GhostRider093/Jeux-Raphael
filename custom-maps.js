// ==========================================================================
//  CARTES PERSO  -  stockage
// --------------------------------------------------------------------------
//  Meme mecanique que gamepad-profile.js : le serveur fait autorite, le
//  navigateur sert de cache et de repli. En site statique (sans Python), /api/
//  repond 404 et tout retombe silencieusement sur localStorage.
//
//  Aucune de ces fonctions ne doit etre appelee depuis une boucle d'animation.
// ==========================================================================

const BASE = '/api/custom-maps';
const LOCAL_KEY = 'raphael.customMaps.v1';
const NETWORK_TIMEOUT_MS = 4000;

async function call(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: controller.signal, cache: 'no-store', credentials: 'same-origin', ...options
    });
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    if (!response.ok || !isJson) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(maps) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(maps)); return true; }
  catch { return false; }
}

/** Identifiant court, lisible dans une URL. */
export function slugify(name) {
  const base = (name || 'carte').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'carte';
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Toutes les cartes connues, serveur et local fusionnes.
 * En cas de doublon d'identifiant, la version la plus recente gagne.
 */
export async function listCustomMaps() {
  const local = readLocal();
  const remote = await call('', { method: 'GET' });
  const merged = { ...local };
  if (remote?.maps) {
    Object.entries(remote.maps).forEach(([id, map]) => {
      const known = merged[id];
      if (!known || Date.parse(map.savedAt || 0) >= Date.parse(known.savedAt || 0)) merged[id] = map;
    });
    writeLocal(merged);
  }
  return merged;
}

/** Lecture d'une carte : le cache local d'abord, pour un demarrage immediat. */
export async function loadCustomMap(id) {
  const local = readLocal()[id];
  const remote = await call(`/${encodeURIComponent(id)}`, { method: 'GET' });
  if (!remote) return local || null;
  if (!local) return remote;
  return Date.parse(remote.savedAt || 0) >= Date.parse(local.savedAt || 0) ? remote : local;
}

/**
 * Enregistre en local puis sur le serveur.
 * @returns {Promise<{local:boolean, server:boolean}>} l'ecriture locale reussit
 *   meme sans serveur : le travail n'est jamais perdu.
 */
export async function saveCustomMap(map) {
  const maps = readLocal();
  maps[map.id] = map;
  const local = writeLocal(maps);
  const remote = await call(`/${encodeURIComponent(map.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(map)
  });
  return { local, server: !!remote?.ok };
}

export async function deleteCustomMap(id) {
  const maps = readLocal();
  delete maps[id];
  writeLocal(maps);
  const remote = await call(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { server: !!remote?.ok };
}

/** Telechargement direct : un filet de securite independant du serveur. */
export function downloadCustomMap(map) {
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${map.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
