// ==========================================================================
//  CLASSEMENT DE COURSE  -  client
// --------------------------------------------------------------------------
//  Le classement est rattache a la fente manette (prenom + code) ou au compte
//  Ghost Chat : il n'y a pas de seconde base de joueurs.
//
//  Mode site statique (solo sans Python) : /api/ repond 404. Les appels
//  echouent alors en silence et le jeu continue avec le seul record local,
//  sans erreur en console.
//
//  Aucune de ces fonctions ne doit etre appelee depuis une boucle
//  d'animation : elles allouent et font du reseau.
// ==========================================================================

const BASE = '/api/race-leaderboard';
const NETWORK_TIMEOUT_MS = 3000;

async function call(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE}${path}`, {
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'same-origin',
      ...options
    });
    // Un hebergeur statique renvoie souvent du HTML en 200 sur une route
    // inconnue : sans ce controle on parserait une page comme un classement.
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    if (!response.ok || !isJson) return null;
    return await response.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Classement d'un monde.
 * @returns {Promise<Array<{rank:number, prenom:string, timeMs:number, score:number, me:boolean}>>}
 *   Tableau vide si le serveur est injoignable ou si personne n'a encore couru.
 */
export async function fetchLeaderboard(worldId) {
  const data = await call(`/${encodeURIComponent(worldId)}`, { method: 'GET' });
  return Array.isArray(data?.entries) ? data.entries : [];
}

/**
 * Envoie un resultat. Le serveur ne conserve que le meilleur temps du joueur.
 * @returns {Promise<{ok:boolean, improved?:boolean, rank?:number, prenom?:string}>}
 *   `ok: false` signifie serveur injoignable ou profil non choisi : dans les
 *   deux cas la course reste valable, seul le classement partage est manque.
 */
export async function submitRaceResult(worldId, { timeMs, score, gates }) {
  const data = await call(`/${encodeURIComponent(worldId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      time_ms: Math.round(timeMs),
      score: Math.round(score),
      gates: Math.round(gates)
    })
  });
  return data?.ok ? data : { ok: false };
}
