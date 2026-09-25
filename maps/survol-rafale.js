/**
 * Un Rafale qui passe au-dessus du village, de temps en temps — Poilhes City.
 *
 * Arnaud, 26/09/2026 : « on a des Rafale dans le code ; on peut en faire
 * passer un en basse qualité de temps en temps, au-dessus, qu'on le voie un
 * petit peu, avec un petit son d'avion — c'est rigolo ».
 *
 * Un seul appareil (`enemy-rafale-model.js`, 28 000 triangles, déjà dans le
 * jeu), une ligne droite à 110–160 m au-dessus du sol, qui passe à moins de
 * 150 m du joueur, à 170 m/s — trois ou quatre secondes de spectacle. Le son
 * est synthétisé (souffle filtré + grondement), sans fichier : il monte à
 * l'approche, culmine au passage, et son filtre descend quand l'avion
 * s'éloigne (l'effet Doppler, à l'oreille). Rien ne tourne entre deux passages.
 */
import * as THREE from 'three';
import { createEnemyFighterModel } from './enemy-rafale-model.js';

export const SURVOL = {
  attenteMin: 40,      // s entre deux passages
  attenteMax: 85,
  premier: 18,         // s avant le tout premier
  altitude: [110, 160],// m au-dessus du sol du joueur
  vitesse: 170,        // m/s
  demiLongueur: 1400,  // m de part et d'autre du point de passage
  ecart: 150,          // m : distance maxi entre la trajectoire et le joueur
  volume: 0.55,
};

/** Le son : un bruit blanc (souffle) et un grondement grave, chacun filtré. */
function creerSon() {
  let ctx = null, gain = null, filtre = null, grave = null, gainGrave = null, sources = [];
  function demarrer() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    const n = ctx.sampleRate * 2;
    const tampon = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = tampon.getChannelData(0);
    let brun = 0;
    for (let i = 0; i < n; i++) { const b = Math.random() * 2 - 1; brun = (brun + 0.02 * b) / 1.02; d[i] = b * 0.6 + brun * 3; }
    const src = ctx.createBufferSource(); src.buffer = tampon; src.loop = true;
    filtre = ctx.createBiquadFilter(); filtre.type = 'bandpass'; filtre.Q.value = 0.7; filtre.frequency.value = 900;
    gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filtre).connect(gain).connect(ctx.destination);
    const src2 = ctx.createBufferSource(); src2.buffer = tampon; src2.loop = true;
    grave = ctx.createBiquadFilter(); grave.type = 'lowpass'; grave.frequency.value = 160;
    gainGrave = ctx.createGain(); gainGrave.gain.value = 0;
    src2.connect(grave).connect(gainGrave).connect(ctx.destination);
    src.start(); src2.start();
    sources = [src, src2];
    return true;
  }
  function maj(force, approche) {
    if (!gain) return;
    const t = ctx.currentTime;
    gain.gain.setTargetAtTime(force * SURVOL.volume, t, 0.08);
    gainGrave.gain.setTargetAtTime(force * SURVOL.volume * 1.4, t, 0.12);
    // qui approche siffle plus aigu ; qui s'éloigne gronde
    filtre.frequency.setTargetAtTime(approche > 0 ? 2200 : 650, t, 0.35);
  }
  function arreter() {
    for (const s of sources) { try { s.stop(); } catch { /* déjà arrêtée */ } }
    sources = []; gain = gainGrave = filtre = grave = null;
    if (ctx) ctx.suspend();
  }
  return { demarrer, maj, arreter };
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera      la position de l'écouteur et du spectateur
 * @param {Function} o.solAt           (x, z) => altitude du sol
 * @returns {{ passer(): void, arreter(): void }}
 */
export function creerSurvols({ scene, camera, solAt }) {
  let avion = null;
  const son = creerSon();
  let geste = false;                  // l'audio n'a le droit de démarrer qu'après un geste
  const armer = () => { geste = true; };
  addEventListener('pointerdown', armer, { once: true, capture: true });
  addEventListener('keydown', armer, { once: true, capture: true });

  createEnemyFighterModel({ targetLength: 15, thrusters: true })
    .then((m) => { avion = m; avion.visible = false; scene.add(avion); })
    .catch((err) => console.warn('Survol : Rafale indisponible', err));

  const vol = { actif: false, attente: SURVOL.premier, a: new THREE.Vector3(), dir: new THREE.Vector3(), t: 0, duree: 0, sonne: false };
  const tmp = new THREE.Vector3();

  function passer() {
    if (!avion) return;
    const c = camera.position;
    const cap = Math.random() * Math.PI * 2;
    vol.dir.set(Math.sin(cap), 0, Math.cos(cap));
    // un point de passage à côté du joueur, puis on recule d'une demi-longueur
    const lat = (Math.random() * 2 - 1) * SURVOL.ecart;
    const alt = solAt(c.x, c.z) + SURVOL.altitude[0] + Math.random() * (SURVOL.altitude[1] - SURVOL.altitude[0]);
    vol.a.set(c.x + vol.dir.z * lat - vol.dir.x * SURVOL.demiLongueur, alt,
              c.z - vol.dir.x * lat - vol.dir.z * SURVOL.demiLongueur);
    vol.t = 0;
    vol.duree = (2 * SURVOL.demiLongueur) / SURVOL.vitesse;
    vol.actif = true;
    avion.visible = true;
    // le nez du modèle pointe vers −z
    avion.rotation.set(0, Math.atan2(-vol.dir.x, -vol.dir.z), 0);
    vol.sonne = geste && son.demarrer();
  }

  function finir() {
    vol.actif = false;
    if (avion) avion.visible = false;
    if (vol.sonne) son.arreter();
    vol.sonne = false;
    vol.attente = SURVOL.attenteMin + Math.random() * (SURVOL.attenteMax - SURVOL.attenteMin);
  }

  let avant = performance.now();
  function image(maintenant) {
    requestAnimationFrame(image);
    const dt = Math.min(0.1, (maintenant - avant) / 1000);
    avant = maintenant;
    if (document.hidden) return;
    if (!vol.actif) {
      vol.attente -= dt;
      if (vol.attente <= 0) passer();
      return;
    }
    vol.t += dt;
    if (vol.t >= vol.duree) { finir(); return; }
    avion.position.copy(vol.a).addScaledVector(vol.dir, SURVOL.vitesse * vol.t);
    // léger roulis, pour qu'il ait l'air piloté
    avion.rotation.z = Math.sin(vol.t * 0.9) * 0.18;
    if (vol.sonne) {
      tmp.copy(avion.position).sub(camera.position);
      const d = tmp.length();
      const approche = -tmp.dot(vol.dir);          // > 0 : il vient vers nous
      son.maj(Math.min(1, (220 / Math.max(80, d)) ** 2), approche);
    }
  }
  requestAnimationFrame(image);

  return { passer, arreter: finir, reglages: SURVOL };
}
