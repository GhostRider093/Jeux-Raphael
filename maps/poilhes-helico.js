/**
 * L'hélicoptère d'Arnaud — le « Desert Viper Gunship » Meshy, qu'on prend.
 *
 * Arnaud, 26/09/2026 : « cet hélicoptère [construit en volumes] il est
 * dégueulasse, je veux qu'on puisse prendre l'hélicoptère que je t'ai donné en
 * modèle 3D ». Le modèle (`assets/fun/helicoptere.glb`, 27,6 Mo → 1 Mo) est un
 * seul maillage : on en **découpe le rotor** au chargement — les triangles du
 * haut du modèle, autour du mât — pour le faire tourner (même tampon de
 * sommets, deux index : rien n'est copié).
 *
 * Deux vies :
 *   — **au repos** : il tourne au-dessus de la boucle de course (`setOrbite`) ;
 *   — **piloté** (mode « helico » du village) : on le prend là où il est.
 *     Loi arcade d'hélicoptère : on avance ou recule, on pivote, on monte ou
 *     descend ; il se penche dans le sens où il va, et se pose sur ses patins.
 *
 * Commandes : Z/↑ avancer, S/↓ reculer, Q/D ou ←/→ pivoter, Espace monter,
 * Maj (ou Ctrl, C) descendre, V caméra. Manette : stick gauche, R2 monter,
 * L2 descendre.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';

export const HELICO_PILOTE = {
  longueur: 17,        // m, nez–queue
  vitesse: 42,         // m/s en avant (150 km/h)
  recul: 12,           // m/s en arrière
  montee: 11,          // m/s
  rotation: 1.25,      // rad/s de pivot
  inertie: 1.6,        // 1/s : vitesse à laquelle il rejoint la vitesse voulue
  orbite: { rayon: 170, altitude: 60, vitesse: 22 },
  volume: 0.35,
};

const LIMITE = 2900;

/** Le son des pales : souffle grave battu à ~11 Hz. */
function creerSon() {
  let ctx = null, gain = null;
  function demarrer() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const n = ctx.sampleRate * 2;
    const tampon = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = tampon.getChannelData(0);
    let brun = 0;
    for (let i = 0; i < n; i++) { brun = (brun + 0.03 * (Math.random() * 2 - 1)) / 1.03; d[i] = brun * 4; }
    const src = ctx.createBufferSource(); src.buffer = tampon; src.loop = true;
    const filtre = ctx.createBiquadFilter(); filtre.type = 'lowpass'; filtre.frequency.value = 420;
    const battement = ctx.createGain(); battement.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 11;
    const prof = ctx.createGain(); prof.gain.value = 0.5;
    lfo.connect(prof).connect(battement.gain);
    gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filtre).connect(battement).connect(gain).connect(ctx.destination);
    src.start(); lfo.start();
    return true;
  }
  function maj(force) { if (gain) gain.gain.setTargetAtTime(force * HELICO_PILOTE.volume, ctx.currentTime, 0.2); }
  function pause() { if (ctx) ctx.suspend(); }
  return { demarrer, maj, pause };
}

/**
 * Sépare le rotor principal du reste : triangles dont les trois sommets sont
 * dans le haut du modèle. Renvoie le pivot (à faire tourner) ou null.
 */
function decouperRotor(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  if (!g.index) g.setIndex([...Array(pos.count).keys()]);
  g.computeBoundingBox();
  const b = g.boundingBox;
  const seuil = b.max.y - (b.max.y - b.min.y) * 0.13;
  const idx = g.index.array;
  const corps = [], rotor = [];
  let sx = 0, sz = 0, n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], c = idx[t + 1], d = idx[t + 2];
    if (pos.getY(a) > seuil && pos.getY(c) > seuil && pos.getY(d) > seuil) {
      rotor.push(a, c, d);
      sx += pos.getX(a); sz += pos.getZ(a); n++;
    } else corps.push(a, c, d);
  }
  if (n < 50) return null;                        // rien de reconnaissable : on laisse tel quel
  const hx = sx / n, hz = sz / n;
  const geoRotor = new THREE.BufferGeometry();
  for (const nom of Object.keys(g.attributes)) geoRotor.setAttribute(nom, g.attributes[nom]);
  geoRotor.setIndex(rotor);
  g.setIndex(corps);
  const pivot = new THREE.Group();
  pivot.position.set(hx, 0, hz);
  const pales = new THREE.Mesh(geoRotor, mesh.material);
  pales.position.set(-hx, 0, -hz);
  pales.castShadow = true;
  pivot.add(pales);
  mesh.add(pivot);
  return pivot;
}

/**
 * @param {object} o { scene, camera, groundAt, surfaceAt, keys }
 */
export function createHelico({ scene, camera, groundAt, surfaceAt, keys }) {
  const P = HELICO_PILOTE;
  const root = new THREE.Group();
  root.name = 'helico-gunship';
  root.rotation.order = 'YXZ';
  scene.add(root);
  let pret = false, pivot = null, disque = null;

  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('assets/fun/helicoptere.glb').then((gltf) => {
    const objet = gltf.scene;
    objet.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (!pivot) pivot = decouperRotor(o);
    });
    // le nez du modèle regarde −x : un quart de tour l'envoie vers −z
    objet.rotation.y = -Math.PI / 2;
    const boite = new THREE.Box3().setFromObject(objet);
    const t = boite.getSize(new THREE.Vector3());
    objet.scale.setScalar(P.longueur / Math.max(t.x, t.z));
    objet.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(objet);
    const c = b.getCenter(new THREE.Vector3());
    objet.position.set(-c.x, -b.min.y, -c.z);     // les patins à zéro
    root.add(objet);
    // un disque flou sous les pales, qui dit « ça tourne » même de loin
    if (pivot) {
      disque = new THREE.Mesh(new THREE.CircleGeometry(P.longueur * 0.42, 40),
        new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
      disque.rotation.x = -Math.PI / 2;
      root.updateMatrixWorld(true);
      const w = new THREE.Vector3(); pivot.getWorldPosition(w); root.worldToLocal(w);
      disque.position.copy(w);
      root.add(disque);
    }
    pret = true;
  }).catch((e) => console.warn('Hélicoptère :', e));

  // ── l'état ──────────────────────────────────────────────────────────────
  const s = {
    pilote: false, vx: 0, vz: 0, vy: 0, cap: 0, capVit: 0, large: false, t: 0,
    orbite: null, angle: Math.random() * Math.PI * 2,
  };
  const son = creerSon();
  let sonne = false;
  addEventListener('pointerdown', () => { sonne = son.demarrer(); }, { once: true, capture: true });
  addEventListener('keydown', () => { sonne = son.demarrer(); }, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) son.pause(); else if (sonne) son.demarrer(); });

  const tenu = (code) => keys.has(code);
  const plancher = (x, z) => Math.max(groundAt(x, z), surfaceAt ? surfaceAt(x, z) : -1e9);
  const voulue = new THREE.Vector3(), regard = new THREE.Vector3(), d = new THREE.Vector3();

  function manette() {
    const m = (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).find((g) => g && g.mapping === 'standard');
    if (!m) return null;
    const z = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    return { x: z(m.axes[0] || 0), y: z(m.axes[1] || 0), haut: m.buttons[7]?.value || 0, bas: m.buttons[6]?.value || 0 };
  }

  function enter() {
    s.pilote = true;
    s.cap = root.rotation.y;
    s.vx = s.vz = s.vy = 0;
    s.large = false;
  }
  function exit() { s.pilote = false; }

  function update(dt) {
    if (!pret) return;
    s.t += dt;
    if (pivot) pivot.rotation.y += dt * 34;
    const p = root.position;

    if (!s.pilote) {
      // au repos : l'orbite au-dessus de la course
      const o = s.orbite || { x: 0, z: 0 };
      const R = P.orbite.rayon;
      s.angle += (P.orbite.vitesse / R) * dt;
      const x = o.x + Math.cos(s.angle) * R, z = o.z + Math.sin(s.angle) * R;
      p.set(x, Math.max(plancher(x, z), plancher(o.x, o.z)) + P.orbite.altitude + Math.sin(s.t * 0.4) * 4, z);
      const tx = -Math.sin(s.angle), tz = Math.cos(s.angle);
      root.rotation.set(-0.1, Math.atan2(-tx, -tz), 0.2);
    } else {
      // ── piloté ─────────────────────────────────────────────────────────
      const m = manette();
      const avance = ((tenu('KeyW') || tenu('KeyZ') || tenu('ArrowUp')) ? 1 : 0) - ((tenu('KeyS') || tenu('ArrowDown')) ? 1 : 0) - (m ? m.y : 0);
      const pivote = ((tenu('KeyA') || tenu('KeyQ') || tenu('ArrowLeft')) ? 1 : 0) - ((tenu('KeyD') || tenu('ArrowRight')) ? 1 : 0) - (m ? m.x : 0);
      const monte = (tenu('Space') ? 1 : 0) - ((tenu('ShiftLeft') || tenu('ShiftRight') || tenu('ControlLeft') || tenu('KeyC')) ? 1 : 0)
        + (m ? m.haut - m.bas : 0);
      const cl = (v) => Math.max(-1, Math.min(1, v));
      const k = 1 - Math.exp(-P.inertie * dt);
      // vitesse voulue dans le repère de l'appareil, puis au monde
      const vAvant = cl(avance) >= 0 ? cl(avance) * P.vitesse : cl(avance) * P.recul;
      const fx = -Math.sin(s.cap), fz = -Math.cos(s.cap);
      s.vx += (fx * vAvant - s.vx) * k;
      s.vz += (fz * vAvant - s.vz) * k;
      s.vy += (cl(monte) * P.montee - s.vy) * (1 - Math.exp(-3 * dt));
      s.capVit += (cl(pivote) * P.rotation - s.capVit) * (1 - Math.exp(-4 * dt));
      s.cap += s.capVit * dt;
      p.x = Math.max(-LIMITE, Math.min(LIMITE, p.x + s.vx * dt));
      p.z = Math.max(-LIMITE, Math.min(LIMITE, p.z + s.vz * dt));
      p.y += s.vy * dt;
      const sol = plancher(p.x, p.z);
      if (p.y < sol) { p.y = sol; if (s.vy < 0) s.vy = 0; }
      p.y = Math.min(p.y, sol + 600);
      // il se penche vers là où il va, et dans ses pivots
      const vLocale = s.vx * fx + s.vz * fz;
      const auSol = p.y - sol < 0.3;
      root.rotation.set(auSol ? 0 : -vLocale / P.vitesse * 0.28, s.cap, auSol ? 0 : s.capVit * 0.18);
      // caméra de poursuite
      const recul = s.large ? 45 : 24, haut = s.large ? 16 : 8;
      voulue.set(p.x - fx * recul, p.y + haut, p.z - fz * recul);
      const mini = plancher(voulue.x, voulue.z) + 2;
      if (voulue.y < mini) voulue.y = mini;
      camera.up.set(0, 1, 0);
      camera.position.lerp(voulue, 1 - Math.exp(-6 * dt));
      regard.set(p.x + fx * 18, p.y + 3, p.z + fz * 18);
      camera.lookAt(regard);
    }
    if (sonne) {
      d.copy(p).sub(camera.position);
      son.maj(s.pilote ? 0.8 : Math.min(1, (90 / Math.max(40, d.length())) ** 2));
    }
  }

  function telemetrie() {
    const p = root.position;
    return {
      vitesse: Math.round(Math.hypot(s.vx, s.vz) * 3.6),
      hauteur: Math.max(0, Math.round(p.y - plancher(p.x, p.z))),
    };
  }

  return {
    root, enter, exit, update, telemetrie,
    basculerVue() { s.large = !s.large; return s.large; },
    /** Le centre de l'orbite au repos (la boucle de course). */
    setOrbite(centre) { s.orbite = centre; },
    get pilote() { return s.pilote; },
  };
}
