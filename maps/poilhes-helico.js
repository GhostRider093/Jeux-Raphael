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
 *
 * **Il se pilote comme l'avion** (Arnaud, 27/09/2026 : « le même comportement
 * que l'avion, juste moins rapide ») : même loi de vol, lue dans
 * `flight-model.js` comme `poilhes-jet.js` — roulis, tangage, virage induit par
 * l'inclinaison, ailes qui reviennent à plat —, avec des vitesses d'hélicoptère.
 * Ce qu'un avion ne sait pas faire et que l'hélico garde : s'arrêter en l'air
 * (S, ou L2), monter et descendre sur place, se poser sur ses patins.
 *
 * Commandes (celles du chasseur) : ←/→ (ou Q/D) incliner, ↑/↓ cabrer / piquer,
 * Z plein gaz, Maj pleine puissance, S s'arrêter, E / Espace monter, Ctrl / C
 * descendre, V caméra, molette : viser plus bas / plus haut.
 * Vitesse réglée, qui reste : + / − au clavier, croix ↑ / ↓ à la manette.
 * Manette : stick gauche = manche (poussé = piquer), R2 gaz, L2 frein, ✕ monter, ○ descendre,
 * stick droit : ↕ la visée (vers le bas), ↔ pivoter sur place ; R1 / L1 tirer.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { creerArmes } from './helico-armes.js?v=20260928a';
import { smoothing, rampKey } from '../input-shaping.js';

export const HELICO_PILOTE = {
  longueur: 17,        // m, nez–queue
  // Vitesses de l'avion (38 / 72 / 92 m/s) ramenées à celles d'un hélico de combat
  croisiere: 22,       // m/s (79 km/h), sans rien toucher
  plein: 42,           // m/s (150 km/h), Z ou R2
  boost: 55,           // m/s (198 km/h), Maj
  montee: 11,          // m/s, E / Espace / ✕
  pivot: 1.1,          // rad/s, stick droit ↔ : pivoter sur place
  pasRegime: 8,        // m/s par seconde (29 km/h) : croix ↑ / ↓ (ou + / −) tenue règle la vitesse
  // part des taux de rotation de l'avion (28/09/2026 : « moins vif »)
  vivacite: { roulis: 0.55, tangage: 0.65 },
  orbite: { rayon: 170, altitude: 60, vitesse: 22 },
  volume: 0.35,
};

/** La loi de vol de l'avion : un script classique, que `rouler.html` ne charge pas. */
function chargerLoiDeVol() {
  if (window.RaphaelFlightModel) return Promise.resolve(window.RaphaelFlightModel);
  return new Promise((ok) => {
    const s = document.createElement('script');
    s.src = './flight-model.js?v=poilhes-20260920';
    s.onload = () => ok(window.RaphaelFlightModel || null);
    s.onerror = () => ok(null);
    document.head.appendChild(s);
  });
}

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
 * Sépare le rotor principal du reste.
 *
 * Mesuré sur le fichier Meshy (26/09/2026) — et c'est là que la 1re version se
 * trompait : le point le plus haut du modèle n'est **pas** le mât, c'est le
 * sommet de la dérive de queue ; « le haut du modèle » faisait tourner un bout
 * de queue. Les pales forment une couche nette au-dessus de 71 % de la hauteur,
 * le fuselage reste dessous sauf au pied du mât ; le mât est au milieu, à 43 %
 * de la longueur (nez en −x) et 55 % de la largeur. Au-delà de 83,5 % de la
 * longueur, c'est la queue : exclue. Tout est exprimé en fractions de la boîte,
 * ce qui reste vrai après quantification par gltf-transform.
 */
export const ROTOR = { hauteur: 0.71, queue: 0.835, mat: { x: 0.431, z: 0.5475 } };

function decouperRotor(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  if (!g.index) g.setIndex([...Array(pos.count).keys()]);
  g.computeBoundingBox();
  const b = g.boundingBox;
  const fx = (v) => (pos.getX(v) - b.min.x) / (b.max.x - b.min.x);
  const fy = (v) => (pos.getY(v) - b.min.y) / (b.max.y - b.min.y);
  const pale = (v) => fy(v) > ROTOR.hauteur && fx(v) < ROTOR.queue;
  const idx = g.index.array;
  const corps = [], rotor = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], c = idx[t + 1], d = idx[t + 2];
    if (pale(a) && pale(c) && pale(d)) rotor.push(a, c, d); else corps.push(a, c, d);
  }
  if (rotor.length < 150) return null;            // rien de reconnaissable : on laisse tel quel
  const hx = b.min.x + (b.max.x - b.min.x) * ROTOR.mat.x;
  const hz = b.min.z + (b.max.z - b.min.z) * ROTOR.mat.z;
  const geoRotor = new THREE.BufferGeometry();
  for (const nom of Object.keys(g.attributes)) geoRotor.setAttribute(nom, g.attributes[nom]);
  geoRotor.setIndex(rotor);
  g.setIndex(corps);
  const hy = b.min.y + (b.max.y - b.min.y) * 0.76;  // à la hauteur des pales (pour le disque flou)
  const pivot = new THREE.Group();
  pivot.position.set(hx, hy, hz);
  const pales = new THREE.Mesh(geoRotor, mesh.material);
  pales.position.set(-hx, -hy, -hz);
  pales.castShadow = true;
  pivot.add(pales);
  mesh.add(pivot);
  console.info(`[hélico] rotor : ${rotor.length / 3} triangles sur ${idx.length / 3}`);
  return pivot;
}

/**
 * @param {object} o { scene, camera, groundAt, surfaceAt, keys }
 */
export function createHelico({ scene, camera, groundAt, surfaceAt, keys, renderer = null }) {
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
    pilote: false, vitesse: 0, regime: 22, vy: 0, large: false, t: 0,
    orbite: null, angle: Math.random() * Math.PI * 2,
    // la visée : de combien les tirs plongent sous le nez (rad) — le stick
    // droit (ou la molette) la règle, elle reste où on l'a mise
    plongee: 0.31,
  };
  // La loi de vol de l'avion, et l'orientation qu'elle fait tourner.
  let vol = null;
  chargerLoiDeVol().then((v) => { vol = v; });
  const orientation = new THREE.Quaternion();
  const avant = new THREE.Vector3(), haut = new THREE.Vector3(), hautMonde = new THREE.Vector3(0, 1, 0);
  const aPlat = new THREE.Quaternion(), eulerCap = new THREE.Euler(0, 0, 0, 'YXZ');
  const qPivot = new THREE.Quaternion();
  let keyRoulis = 0, keyTangage = 0;
  // molette : viser plus bas (vers soi) ou plus haut
  addEventListener('wheel', (e) => {
    if (!s.pilote) return;
    s.plongee = THREE.MathUtils.clamp(s.plongee + Math.sign(e.deltaY) * 0.05, -0.15, 1.25);
  }, { passive: true });
  const son = creerSon();
  let sonne = false;
  addEventListener('pointerdown', () => { sonne = son.demarrer(); }, { once: true, capture: true });
  addEventListener('keydown', () => { sonne = son.demarrer(); }, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) son.pause(); else if (sonne) son.demarrer(); });

  const tenu = (code) => keys.has(code);
  const plancher = (x, z) => Math.max(groundAt(x, z), surfaceAt ? surfaceAt(x, z) : -1e9);
  const voulue = new THREE.Vector3(), regard = new THREE.Vector3(), d = new THREE.Vector3();

  // ── les armes (26/09/2026) : F / clic gauche / R1 mitrailleuse, G / clic droit / L1 missiles
  const armes = creerArmes({ scene, camera, root, plancher, renderer });
  const souris = { gauche: false, droit: false };
  addEventListener('pointerdown', (e) => { if (!s.pilote) return; if (e.button === 0) souris.gauche = true; if (e.button === 2) souris.droit = true; });
  addEventListener('pointerup', (e) => { if (e.button === 0) souris.gauche = false; if (e.button === 2) souris.droit = false; });
  addEventListener('contextmenu', (e) => { if (s.pilote) e.preventDefault(); });
  function commandesTir() {
    if (!s.pilote) return null;
    const m = (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).find((g) => g && g.mapping === 'standard');
    return {
      mitrailleuse: tenu('KeyF') || souris.gauche || !!(m && m.buttons[5]?.pressed),
      missile: tenu('KeyG') || souris.droit || !!(m && m.buttons[4]?.pressed),
      plongee: s.plongee,
    };
  }

  function manette() {
    const m = (navigator.getGamepads ? Array.from(navigator.getGamepads()) : []).find((g) => g && g.mapping === 'standard');
    if (!m) return null;
    const z = (v) => (Math.abs(v) < 0.12 ? 0 : v);
    return {
      x: z(m.axes[0] || 0), y: z(m.axes[1] || 0),       // stick gauche : le manche
      rx: z(m.axes[2] || 0), ry: z(m.axes[3] || 0),     // stick droit : pivot, visée
      gaz: m.buttons[7]?.value || 0, frein: m.buttons[6]?.value || 0,
      monte: !!m.buttons[0]?.pressed, descend: !!m.buttons[1]?.pressed,
      // croix ↑ / ↓ : la vitesse réglée, qui reste (28/09/2026)
      plusVite: !!m.buttons[12]?.pressed, moinsVite: !!m.buttons[13]?.pressed,
    };
  }

  function enter() {
    s.pilote = true;
    armes.prechauffer();
    // on repart du cap qu'il avait, ailes à plat
    orientation.setFromEuler(eulerCap.set(0, root.rotation.y, 0));
    const sol = plancher(root.position.x, root.position.z);
    s.vitesse = root.position.y - sol < 1 ? 0 : P.croisiere;
    s.regime = P.croisiere;
    s.vy = 0;
    s.large = false;
    keyRoulis = keyTangage = 0;
  }
  // La verticale de la caméra revient au monde, sinon tout penche en sortant.
  function exit() { s.pilote = false; camera.up.copy(hautMonde); }

  function update(dt) {
    if (!pret) return;
    s.t += dt;
    armes.update(dt, commandesTir());
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
    } else if (vol) {
      // ── piloté : la loi de l'avion (`poilhes-jet.js`), à vitesse d'hélico ──
      const m = manette();
      keyRoulis = rampKey(keyRoulis, ((tenu('ArrowLeft') || tenu('KeyA') || tenu('KeyQ')) ? -1 : 0)
        + ((tenu('ArrowRight') || tenu('KeyD')) ? 1 : 0), dt);
      keyTangage = rampKey(keyTangage, (tenu('ArrowUp') ? 1 : 0) + (tenu('ArrowDown') ? -1 : 0), dt);
      // Moins vif que l'avion (Arnaud, 28/09/2026 : « un peu violent pour un
      // hélicoptère ») : le manche ne donne que `vivacite` du taux de l'avion.
      const roulis = vol.clamp(keyRoulis + (m ? m.x : 0), -1, 1) * P.vivacite.roulis;
      // Stick poussé vers l'avant = nez en bas, comme un manche d'avion
      // (inversé le 28/09 à la demande d'Arnaud) ; les flèches ne changent pas.
      const tangage = vol.clamp(keyTangage + (m ? m.y : 0), -1, 1) * P.vivacite.tangage;
      const montee = vol.clamp(((tenu('KeyE') || tenu('PageUp') || tenu('Space') || (m && m.monte)) ? 1 : 0)
        - ((tenu('ControlLeft') || tenu('ControlRight') || tenu('PageDown') || tenu('KeyC') || (m && m.descend)) ? 1 : 0), -1, 1);
      // La visée au stick droit (Arnaud : « orienter la cible vers le bas ») :
      // tiré vers soi, les tirs plongent davantage ; elle reste où on la laisse.
      if (m && m.ry) s.plongee = THREE.MathUtils.clamp(s.plongee + m.ry * 1.1 * dt, -0.15, 1.25);

      // ── régime ─────────────────────────────────────────────────────────
      const auSol = p.y - plancher(p.x, p.z) < 0.5;
      // La vitesse réglée (« un bouton pour monter ou descendre la vitesse ») :
      // croix ↑ / ↓ à la manette, + / − au clavier ; elle reste où on la met.
      const reglePlus = (m && m.plusVite) || tenu('NumpadAdd') || tenu('Equal') || tenu('BracketRight');
      const regleMoins = (m && m.moinsVite) || tenu('NumpadSubtract') || tenu('Minus') || tenu('Digit6');
      if (reglePlus) s.regime = Math.min(P.boost, s.regime + P.pasRegime * dt);
      if (regleMoins) s.regime = Math.max(0, s.regime - P.pasRegime * dt);
      let consigne = s.regime;
      if (tenu('KeyW') || tenu('KeyZ')) consigne = Math.max(consigne, P.plein);
      if (tenu('ShiftLeft') || tenu('ShiftRight')) consigne = P.boost;
      if (m && m.gaz > 0.05) consigne = Math.max(consigne, s.regime + (P.plein - s.regime) * m.gaz);
      if (tenu('KeyS')) consigne = 0;                          // l'hélico, lui, s'arrête en l'air
      if (m && m.frein > 0.05) consigne *= 1 - m.frein;
      // posé, il attend qu'on monte ou qu'on mette les gaz (pas de départ dans un mur)
      if (auSol && montee <= 0 && !reglePlus && !tenu('KeyW') && !tenu('KeyZ') && !(m && m.gaz > 0.05)) consigne = 0;
      s.vitesse = vol.advanceSpeed(s.vitesse, consigne, dt);

      // ── pilotage ───────────────────────────────────────────────────────
      vol.tourner(orientation, -roulis, tangage, 0, dt);
      // stick droit ↔ : pivoter sur place autour de la verticale (le rotor de queue)
      if (m && m.rx) { qPivot.setFromAxisAngle(hautMonde, -m.rx * P.pivot * dt); orientation.premultiply(qPivot); }
      avant.set(0, 0, -1).applyQuaternion(orientation);
      haut.set(0, 1, 0).applyQuaternion(orientation);
      vol.virageInduit(orientation, haut, avant, dt);
      vol.stabiliser(orientation, haut, avant, Math.max(Math.abs(roulis), Math.abs(tangage)), dt);

      // ── déplacement ────────────────────────────────────────────────────
      s.vy += (montee * P.montee - s.vy) * (1 - Math.exp(-3 * dt));
      p.x = Math.max(-LIMITE, Math.min(LIMITE, p.x + avant.x * s.vitesse * dt));
      p.z = Math.max(-LIMITE, Math.min(LIMITE, p.z + avant.z * s.vitesse * dt));
      p.y += (avant.y * s.vitesse + s.vy) * dt;
      const sol = plancher(p.x, p.z);
      if (p.y < sol) {
        p.y = sol;
        if (s.vy < 0) s.vy = 0;
        if (s.vitesse > 8 && avant.y < 0.02) {
          // lancé contre le sol : il se cabre, comme l'avion
          vol.tourner(orientation, 0, 1, 0, dt * 2.2);
        } else {
          // posé : il se remet à plat sur ses patins, cap gardé
          eulerCap.setFromQuaternion(orientation, 'YXZ');
          aPlat.setFromEuler(eulerCap.set(0, eulerCap.y, 0));
          orientation.slerp(aPlat, 1 - Math.exp(-6 * dt));
        }
      }
      p.y = Math.min(p.y, sol + 600);
      root.quaternion.copy(orientation);

      // ── caméra de poursuite de l'avion, rapprochée ─────────────────────
      // Le regard plonge un peu devant le nez : on voit le réticule et les tirs.
      const ratio = Math.min(1, s.vitesse / P.plein);
      const recul = s.large ? 50 : 26 + ratio * 8, hauteur = s.large ? 18 : 9 + ratio * 2;
      camera.up.copy(haut);
      voulue.copy(p).addScaledVector(avant, -recul).addScaledVector(haut, hauteur);
      const mini = plancher(voulue.x, voulue.z) + 2;
      if (voulue.y < mini) voulue.y = mini;
      camera.position.lerp(voulue, smoothing(8, dt));
      regard.copy(p).addScaledVector(avant, 30).addScaledVector(haut, -5);
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
      vitesse: Math.round(s.vitesse * 3.6),
      hauteur: Math.max(0, Math.round(p.y - plancher(p.x, p.z))),
    };
  }

  return {
    root, enter, exit, update, telemetrie,
    basculerVue() { s.large = !s.large; return s.large; },
    /** Le centre de l'orbite au repos (la boucle de course). */
    setOrbite(centre) { s.orbite = centre; },
    /** Les figurants qu'une explosion peut renverser. */
    setCibles(f) { armes.setCibles(f); },
    /** Les ennemis en l'air (mission, 27/09/2026) : voir `helico-armes.js`. */
    setCiblesAir(f) { armes.setCiblesAir(f); },
    verrou: () => armes.verrou(),
    exploser: (p) => armes.exploser(p),
    get pilote() { return s.pilote; },
    /** La visée : plongée des tirs sous le nez (rad), réglée au stick droit / à la molette. */
    get plongee() { return s.plongee; },
    /** Vitesse (m/s) et ce que la loi de vol a fait de l'appareil : pour le HUD et les essais. */
    get vitesse() { return s.vitesse; },
    get regime() { return s.regime; },
  };
}
