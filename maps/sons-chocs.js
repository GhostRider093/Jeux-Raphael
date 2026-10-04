/**
 * Les bruitages des chocs — Poilhes City.
 *
 * Arnaud, 01/10/2026 : « blinder les collisions entre voitures, avec chocs,
 * bruitages et compagnie ». Aucun fichier : tout est synthétisé (Web Audio),
 * donc aucun droit à vérifier avant une publication, et chaque choc sonne un
 * peu différemment du précédent.
 *
 *   — `impact(force, distance)` : un choc. `force` de 0 (on se touche) à 1 (la
 *     grosse collision). Quatre couches dosées par la force :
 *       · le **coup sourd** (la caisse encaisse) : une sinusoïde grave qui chute ;
 *       · la **tôle** : du bruit filtré et saturé, bref ;
 *       · le **métal qui sonne** : quelques partiels inharmoniques ;
 *       · le **verre** au-delà de 0,65 : une pluie de petits cliquetis aigus.
 *   — `frottement(niveau)` : la tôle qui racle, en continu (0 = silence) ;
 *     à appeler à chaque image tant que deux engins glissent l'un contre l'autre.
 *
 * **Un vrai enregistrement pour les gros chocs** (Arnaud, 04/10/2026 : « utilise
 * ce son pour l'accident de voiture ») : `assets/sons/accident-court.mp3` (le
 * premier impact, 1,25 s) remplace la tôle, le métal et le verre de synthèse
 * au-delà de `SEUIL_ENREGISTREMENT` ; le coup sourd reste, il donne le poids.
 * En dessous, les accrochages restent synthétisés — un accident entier à chaque
 * frottement serait insupportable. `accident(distance)` joue la version complète
 * (4,5 s, tôle qui roule) : pour une voiture qui explose. Tant que les fichiers
 * ne sont pas décodés, ou s'ils manquent, la synthèse fait tout.
 *
 * Le contexte audio naît au premier choc ; le navigateur l'autorise puisque le
 * joueur a déjà appuyé sur une touche pour conduire.
 */

const VOLUME = 0.7;
const SEUIL_ENREGISTREMENT = 0.55;     // force à partir de laquelle on entend l'enregistrement
const REPIT_ENREGISTREMENT = 0.9;      // s entre deux lectures (sinon : mitraillette)
const GAIN_ENREGISTREMENT = 0.6;       // un mp3 normalisé est bien plus fort qu'une couche de synthèse
const ENREGISTREMENTS = {
  court: 'assets/sons/accident-court.mp3?v=20261004a',
  complet: 'assets/sons/accident-complet.mp3?v=20261004a',
};
const tampons = {};                    // nom → AudioBuffer décodé
let derniereLecture = -1;

let ctx = null, sortie = null, bruit = null;
let racle = null;             // { source, filtre, gain }

function contexte() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { ctx = new AC(); } catch { return null; }
  // un compresseur en sortie : dix chocs d'un coup ne saturent pas
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.2;
  sortie = ctx.createGain(); sortie.gain.value = VOLUME;
  sortie.connect(comp); comp.connect(ctx.destination);
  // deux secondes de bruit blanc, réutilisées par toutes les couches
  bruit = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = bruit.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  for (const [nom, url] of Object.entries(ENREGISTREMENTS)) {
    fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
      .then((a) => ctx.decodeAudioData(a))
      .then((b) => { tampons[nom] = b; })
      .catch(() => { /* pas de fichier : la synthèse reste */ });
  }
  return ctx;
}

/** Joue un enregistrement décodé ; rend false s'il n'est pas (encore) là. */
function lire(nom, gain, bus) {
  const b = tampons[nom];
  if (!b) return false;
  const s = ctx.createBufferSource();
  s.buffer = b;
  s.playbackRate.value = hasard(0.94, 1.06);     // deux chocs ne sonnent pas pareil
  const g = ctx.createGain(); g.gain.value = gain;
  s.connect(g); g.connect(bus);
  s.start();
  s.onended = () => { try { g.disconnect(); } catch { /* déjà fait */ } };
  return true;
}

/**
 * L'accident entier — impact, tôle qui roule, débris (4,5 s) : pour une voiture
 * qui explose. Synthèse à pleine force si le fichier manque.
 * @param {number} [distance=0] m entre l'accident et le joueur
 */
export function accident(distance = 0) {
  if (!contexte()) return;
  const att = 1 / (1 + Math.max(0, distance) / 12);
  if (!lire('complet', GAIN_ENREGISTREMENT * att, sortie)) impact(1, distance);
}

/** Une courbe de saturation : la tôle « croque » au lieu de souffler. */
let courbe = null;
function saturation() {
  if (courbe) return courbe;
  courbe = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; courbe[i] = Math.tanh(x * 4); }
  return courbe;
}

function sourceBruit(t, duree) {
  const s = ctx.createBufferSource();
  s.buffer = bruit;
  s.start(t, Math.random() * 1.5, duree + 0.05);
  return s;
}

const hasard = (a, b) => a + Math.random() * (b - a);

/**
 * Un choc.
 * @param {number} force     0…1
 * @param {number} [distance=0]  m entre le choc et le joueur (atténuation)
 */
export function impact(force, distance = 0) {
  if (!contexte()) return;
  const f = Math.max(0, Math.min(1, force));
  const att = 1 / (1 + Math.max(0, distance) / 12);
  if (f * att < 0.02) return;
  const t = ctx.currentTime + 0.005;
  const bus = ctx.createGain(); bus.gain.value = att; bus.connect(sortie);

  // ── le coup sourd ──
  {
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = hasard(70, 105) * (1.2 - f * 0.4);
    o.frequency.setValueAtTime(f0 * 1.8, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.55, t + 0.18 + f * 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 + f * 0.65, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22 + f * 0.35);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + 0.7);
  }

  // ── un gros choc : l'enregistrement remplace tout le reste ──
  if (f >= SEUIL_ENREGISTREMENT && ctx.currentTime - derniereLecture > REPIT_ENREGISTREMENT) {
    const dose = 0.45 + 0.55 * (f - SEUIL_ENREGISTREMENT) / (1 - SEUIL_ENREGISTREMENT);
    if (lire('court', GAIN_ENREGISTREMENT * dose, bus)) {
      derniereLecture = ctx.currentTime;
      setTimeout(() => { try { bus.disconnect(); } catch { /* déjà fait */ } }, 2000);
      return;
    }
  }

  // ── la tôle : bruit filtré, saturé ──
  {
    const duree = 0.08 + f * 0.45;
    const s = sourceBruit(t, duree);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(hasard(900, 1800) + f * 900, t);
    bp.frequency.exponentialRampToValueAtTime(hasard(350, 600), t + duree);
    bp.Q.value = 0.9;
    const sat = ctx.createWaveShaper(); sat.curve = saturation();
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + f * 0.75, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    s.connect(bp); bp.connect(sat); sat.connect(g); g.connect(bus);
  }

  // ── le métal qui sonne ──
  if (f > 0.15) {
    const base = hasard(380, 520);
    for (const r of [1, 2.71, 5.18, 7.9]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * r * hasard(0.97, 1.03);
      const g = ctx.createGain();
      const duree = (0.25 + f * 0.7) / Math.sqrt(r);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((0.05 + f * 0.09) / r, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      o.connect(g); g.connect(bus);
      o.start(t); o.stop(t + duree + 0.05);
    }
  }

  // ── les débris, puis le verre ──
  const debris = f > 0.35 ? Math.round(3 + f * 6) : 0;
  const verre = f > 0.65 ? Math.round(10 + (f - 0.65) * 50) : 0;
  for (let i = 0; i < debris + verre; i++) {
    const estVerre = i >= debris;
    const ti = t + (estVerre ? hasard(0.03, 0.55) : hasard(0.02, 0.3));
    const s = sourceBruit(ti, 0.04);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = estVerre ? hasard(3500, 8000) : hasard(500, 1400);
    bp.Q.value = estVerre ? 12 : 3;
    const g = ctx.createGain();
    const v = estVerre ? hasard(0.15, 0.45) : hasard(0.1, 0.25);
    g.gain.setValueAtTime(0.0001, ti);
    g.gain.exponentialRampToValueAtTime(v, ti + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, ti + (estVerre ? hasard(0.02, 0.07) : hasard(0.03, 0.08)));
    s.connect(bp); bp.connect(g); g.connect(bus);
  }
  setTimeout(() => { try { bus.disconnect(); } catch { /* déjà fait */ } }, 2000);
}

/**
 * La tôle qui racle : à appeler à chaque image, 0 pour se taire.
 * @param {number} niveau 0…1
 */
export function frottement(niveau) {
  if (!ctx) { if (niveau <= 0) return; if (!contexte()) return; }
  if (!racle) {
    if (niveau <= 0) return;
    const source = ctx.createBufferSource(); source.buffer = bruit; source.loop = true;
    const filtre = ctx.createBiquadFilter(); filtre.type = 'bandpass'; filtre.frequency.value = 1800; filtre.Q.value = 1.4;
    const sat = ctx.createWaveShaper(); sat.curve = saturation();
    const gain = ctx.createGain(); gain.gain.value = 0;
    source.connect(filtre); filtre.connect(sat); sat.connect(gain); gain.connect(sortie);
    source.start();
    racle = { source, filtre, gain };
  }
  const t = ctx.currentTime;
  const n = Math.max(0, Math.min(1, niveau));
  racle.gain.gain.setTargetAtTime(n * 0.45, t, n > 0 ? 0.03 : 0.08);
  // le grain du raclement bouge : la fréquence suit la vitesse, avec un peu de hasard
  racle.filtre.frequency.setTargetAtTime(1100 + n * 1900 + hasard(-250, 250), t, 0.05);
}
