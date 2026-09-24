/**
 * Poilhes (Hérault) — maquette 3D du village à partir des données publiques IGN / OSM.
 *
 * Données : maps/poilhes/ (générées par scripts/poilhes/build_village.py).
 * Trois façons de visiter : Survol (orbite), Balade (à pied, collisions) et Drone (vol libre).
 *
 * Aucune allocation dans la boucle d'animation : vecteurs et tableaux réutilisés.
 */
import * as THREE from 'three';
import { OrbitControls } from '../libs/OrbitControls.module.js';
import {
  facadeMaterial, roofMaterial, groundMaterial, waterMaterial, foliageMaterial, stoneMaterial, skyMaterial,
} from './poilhes-shaders.js';
import { construireVillage } from './poilhes-scene.js?v=qualite-20260924';
import { createRobot } from './poilhes-robot.js?v=voiture-20260921';
import { createEnemies } from './poilhes-enemies.js?v=voiture-20260921';
import { createJet } from './poilhes-jet.js?v=voiture-20260921';
import { creerPilote, creerAdherence } from './voiture-pilote.js?v=figures-20260924';
import { poserEpicerie, poserBlasonClub, EPICERIE } from './poilhes-commerces.js?v=voiture-20260921';
import { construireTrottinette } from './trottinette.js?v=pilote-20260922';

const BASE = 'maps/poilhes/';
const EYE = 1.68;              // hauteur des yeux du promeneur (m)
const WALK = 1.5, RUN = 4.2;   // vitesses de marche (m/s)
const DRONE = 14, DRONE_FAST = 55;

const $ = (id) => document.getElementById(id);
const TYPED = { f32: Float32Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array };

// ---------------------------------------------------------------------------- chargement

async function fetchWithProgress(url, onChunk) {
  // 'no-cache' : on revalide toujours (ETag). Index et géométrie doivent rester
  // de la même génération — un JSON périmé avec un .bin neuf fait tout échouer.
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    onChunk(total ? got / total : 0);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out.buffer;
}

function loadTexture(loader, url, srgb) {
  return new Promise((resolve, reject) => {
    loader.load(url, (t) => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; resolve(t); }, undefined, reject);
  });
}

// ---------------------------------------------------------------------------- soleil

/** Direction du soleil (repère Three.js : x est, y haut, z sud) pour Poilhes à une heure légale donnée. */
function sunDirection(lat, lon, date, hours, out) {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const day = Math.floor((date - start) / 864e5);
  const decl = THREE.MathUtils.degToRad(23.44) * Math.sin(2 * Math.PI * (284 + day) / 365);
  const utcOffset = -new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12).getTimezoneOffset() / 60 || 2;
  const solar = hours - utcOffset + lon / 15;
  const H = THREE.MathUtils.degToRad((solar - 12) * 15);
  const phi = THREE.MathUtils.degToRad(lat);
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.cos(H) * Math.sin(phi);
  const up = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  return out.set(east, up, -north).normalize();
}

// ---------------------------------------------------------------------------- village

/**
 * @param {object} [options]
 * @param {string[]} [options.modes] modes offerts (boutons `[data-mode]`) ; les
 *   autres sont cachés et leurs moteurs (robot, gobelins, chasseur) ne sont pas
 *   créés — rien n'est téléchargé pour eux. Par défaut : tous.
 * @param {object} [options.qualite] niveau de `maps/qualite.js` appliqué à la
 *   création du rendu (anticrénelage, définition, ombres). Par défaut : le
 *   comportement historique, plein régime sur ordinateur, léger en tactile.
 * @param {string} [options.voitureUnique] 'rouge' | 'bleue' : une seule voiture,
 *   sans panneau de choix ni touche C.
 * @param {boolean} [options.ouvrir] false : la page lève l'écran de chargement
 *   elle-même (`loader.classList.add('done')`), par exemple après une mesure.
 * @returns {Promise<object>} ce qui est aussi exposé dans `window.RaphaelPoilhes`
 */
export async function startVillage({ modes = null, qualite = null, voitureUnique = null, ouvrir = true } = {}) {
  const veut = (m) => !modes || modes.includes(m);
  const setProgress = (f, msg) => {
    $('load-bar').style.width = `${Math.round(f * 100)}%`;
    if (msg) $('load-msg').textContent = msg;
  };

  // --------------------------------------------------------------------- moteur
  const isTouch = matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('tactile', isTouch);
  const renderer = new THREE.WebGLRenderer({ antialias: qualite ? qualite.aa : true, powerPreference: 'high-performance' });
  // Téléphone : moitié moins de pixels à remplir, et pas d'ombres portées.
  // Le village pèse deux millions de triangles ; c'est le prix du rendu par
  // pixel qui fait la différence entre jouable et diaporama.
  // Un niveau de qualité (`maps/qualite.js`), s'il est donné, décide à la place.
  renderer.setPixelRatio(Math.min(devicePixelRatio, qualite ? qualite.ratio : (isTouch ? 1.25 : 2)));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = qualite ? qualite.ombres > 0 : !isTouch;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('scene').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xc9dcec, 0.00015);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.2, 16000);



  // --------------------------------------------------------------------- décor
  // Le village lui-même — relief, bâtiments, arbres, vignes, ciel — est construit
  // par `poilhes-scene.js`, que le moteur des Mondes charge aussi de son côté.
  // ?village=capestang ouvre l'autre village avec le même moteur.
  const params = new URLSearchParams(location.search);
  const village = (params.get('village') || 'poilhes').replace(/[^a-z-]/g, '');
  const decor = await construireVillage({
    scene, renderer, camera, onProgress: setProgress, leger: isTouch, village,
    onHeure: (h) => {
      $('clock').textContent = `${String(Math.floor(h)).padStart(2, '0')} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
    },
  });
  const { meta, V, clock, groundAt, walkableAt, blockedAt, surfaceAt, setTime, sun, sunDir, skyU, sky } = decor;
  // Le titre suit le village chargé : la même page sert Poilhes et Capestang.
  if (meta.nom) {
    const [ville, dep] = meta.nom.replace(')', '').split(' (');
    $('hud-title').innerHTML = `${ville} <small>${dep || ''}</small>`;
    document.title = `${ville} en 3D`;
    const titre = document.querySelector('#loader h2');
    if (titre) titre.textContent = `${ville} en 3D`;
  }
  const H = decor.detail;                 // demi-côté de la zone détaillée, pour la mini-carte
  // Modes non offerts par la page : boutons cachés, moteurs jamais créés.
  if (modes) document.querySelectorAll('[data-mode]').forEach((b) => { b.hidden = !veut(b.dataset.mode); });

  // --------------------------------------------------------------------- étiquettes
  const labelsEl = $('labels');
  const labels = [];
  const buildingTop = (x, z) => {
    let best = null, d = 20;
    for (const b of meta.batiments) {
      const dd = Math.hypot(b.x - x, -b.n - z);
      if (dd < d) { d = dd; best = b; }
    }
    return best ? best.toit : null;
  };
  for (const p of meta.lieux) {
    const el = document.createElement('div');
    el.className = 'label poi';
    // OSM appelle l'épicerie « Epicerie du Canal » ; sur place, c'est Ostal Louis.
    const nom = p.genre === EPICERIE.cle ? EPICERIE.nom : p.nom;
    const genre = p.genre === EPICERIE.cle ? EPICERIE.genre : p.genre;
    el.innerHTML = `<b>${nom}</b>${nom !== genre ? `<small>${genre}</small>` : ''}`;
    labelsEl.appendChild(el);
    const top = buildingTop(p.x, p.z);
    labels.push({ el, pos: new THREE.Vector3(p.x, (top ?? p.y) + 4, p.z), max: 900, kind: 'poi', slot: labels.length });
  }
  for (const r of meta.rues) {
    const el = document.createElement('div');
    el.className = 'label street';
    el.textContent = r.nom;
    labelsEl.appendChild(el);
    labels.push({ el, pos: new THREE.Vector3(r.x, r.y + 2.2, r.z), max: 240, kind: 'street', slot: labels.length });
  }
  // --------------------------------------------------------------------- commerces
  // L'épicerie du village, avec sa vraie devanture et son affiche. La façade
  // est trouvée au rayon : rien n'est placé à la main.
  const epicerie = poserEpicerie({ scene, decor, loader: decor.loader });
  // Le blason du club, devant le stade — chargé sans bloquer l'entrée au village.
  poserBlasonClub({ scene, decor }).catch((err) => console.warn('Blason du club :', err));
  // La trottinette et son pilote, garées devant l'épicerie. Le groupe de la
  // devanture donne l'orientation : on se range le long de la façade, pas en
  // travers de la rue.
  if (epicerie) {
    const cap = epicerie.root.rotation.y;
    const gx = epicerie.root.position.x + Math.sin(cap) * 2.6 + Math.cos(cap) * 2.2;
    const gz = epicerie.root.position.z + Math.cos(cap) * 2.6 - Math.sin(cap) * 2.2;
    construireTrottinette({ scene, decor, x: gx, z: gz, cap: cap + Math.PI / 2 })
      .catch((err) => console.warn('Trottinette :', err));
  }

  let showLabels = true;
  let frame = 0;
  const proj = new THREE.Vector3();
  /** Vrai si un toit ou un arbre coupe la ligne de visée caméra -> point. */
  function occluded(target) {
    const dx = target.x - camera.position.x, dy = target.y - camera.position.y, dz = target.z - camera.position.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.min(160, Math.ceil(len / 2));
    // on ignore les 12 derniers mètres : le lieu étiqueté ne se masque pas lui-même
    const last = Math.max(0, 1 - 12 / Math.max(len, 1e-3));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (t > last) break;
      if (surfaceAt(camera.position.x + dx * t, camera.position.z + dz * t) > camera.position.y + dy * t + 0.4) return true;
    }
    return false;
  }
  function updateLabels() {
    const w = innerWidth / 2, h = innerHeight / 2;
    for (const L of labels) {
      const d = camera.position.distanceTo(L.pos);
      proj.copy(L.pos).project(camera);
      let visible = showLabels && d < L.max && proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1;
      if (visible && ((frame + L.slot) % 12 === 0 || L.hidden === undefined)) L.hidden = occluded(L.pos);
      if (visible && L.hidden) visible = false;
      if (!visible) { if (L.shown !== false) { L.el.style.display = 'none'; L.shown = false; } continue; }
      if (L.shown !== true) { L.el.style.display = ''; L.shown = true; }
      L.el.style.transform = `translate(-50%, -100%) translate(${(proj.x * w + w).toFixed(1)}px, ${(-proj.y * h + h).toFixed(1)}px)`;
      L.el.style.opacity = String(Math.min(1, (L.max - d) / (L.max * 0.35)));
    }
  }

  // --------------------------------------------------------------------- navigation
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 4;
  controls.maxDistance = 3200;
  controls.zoomToCursor = true;
  const church = meta.lieux.find((p) => p.genre === 'Église') || { x: 0, y: 30, z: 0 };
  controls.target.set(church.x, church.y + 4, church.z);
  camera.position.set(church.x + 190, church.y + 150, church.z + 230);

  let mode = 'survol';
  const walker = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, vy: 0, ground: 0 };
  const keys = new Set();
  const move = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const capJet = new THREE.Vector3();          // direction de l'appareil, pour la minicarte
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const touchMove = { x: 0, y: 0, active: false, run: false };
  const robot = veut('robot') ? createRobot({ scene, camera, groundAt, walkableAt, blockedAt, surfaceAt, keys }) : null;
  const ennemis = veut('robot') ? createEnemies({ scene, walkableAt, blockedAt }) : null;
  const jet = veut('chasseur') ? createJet({ scene, camera, groundAt, surfaceAt, keys }) : null;
  if (robot) robot.setEnemies(ennemis);
  // cible passee aux gobelins : construite une fois, jamais dans la boucle
  const proie = robot ? { position: robot.root.position, hurt: (d) => robot.hurt(d) } : null;

  // --------------------------------------------------------------------- voiture
  // Construite au premier passage dans le mode, pas au chargement de la page :
  // la grille d'adhérence rasterise les rubans de chaussée (une centaine de
  // milliers de triangles), et il n'y a aucune raison de faire attendre
  // quelqu'un qui vient seulement survoler le village.
  let auto = null, deuxRoues = null;
  /** La trottinette : même pilote, même physique, autre engin. */
  function piloteTrottinette() {
    if (deuxRoues) return deuxRoues;
    const routes = creerAdherence([{ decor }]);
    deuxRoues = creerPilote({
      scene, camera, renderer, keys, engin: 'trottinette',
      solAt: walkableAt, blockedAt, adherenceAt: routes.adherenceAt, surRoute: routes.surRoute,
      bounds: decor.bounds - 60,
      turboAt: decor.parc ? decor.parc.turboAt : null,   // les bandes bleues du skatepark
    });
    return deuxRoues;
  }

  function pilote() {
    if (auto) return auto;
    const routes = creerAdherence([{ decor }]);
    auto = creerPilote({
      scene, camera, renderer, keys,
      solAt: walkableAt,              // tablier du pont du canal compris
      blockedAt, adherenceAt: routes.adherenceAt, surRoute: routes.surRoute,
      bounds: decor.bounds - 60,
    });
    auto.setNuit(+timeInput.value < 7.4 || +timeInput.value > 20.2);
    return auto;
  }

  // --------------------------------------------------------------------- HUD de vol
  const volEl = $('vol'), vitEl = $('vit'), hautEl = $('haut');
  let vitVue = -1, hautVue = -1;
  /** Vitesse et hauteur-sol ; le chiffre passe à l'orange quand on rase. */
  function majVol() {
    const t = jet.telemetrie();
    if (t.vitesse !== vitVue) { vitVue = t.vitesse; vitEl.textContent = t.vitesse; }
    if (t.hauteur !== hautVue) {
      hautVue = t.hauteur;
      hautEl.textContent = t.hauteur;
      volEl.classList.toggle('rase', t.hauteur < 25);
    }
  }

  // --------------------------------------------------------------------- HUD de la voiture
  const autoEl = $('auto'), kmhEl = $('kmh'), rapportEl = $('rapport');
  const regimeEl = $('regime').firstElementChild;
  const figureEl = $('figure');            // bannière des figures (facultative dans la page)
  let kmhVu = -1, rapportVu = '', figureVue = -1;
  /** Compteur, rapport engagé et barre de régime — relus, jamais réécrits pour rien. */
  function majAuto(qui = auto) {
    const t = qui.telemetrie();
    if (t.kmh !== kmhVu) { kmhVu = t.kmh; kmhEl.textContent = t.kmh; }
    if (t.rapport !== rapportVu) { rapportVu = t.rapport; rapportEl.textContent = t.rapport; }
    regimeEl.style.width = `${Math.min(100, (t.regime / t.regimeMax) * 100)}%`;
    autoEl.classList.toggle('rouge', t.regime > t.regimeMax - 700);
    autoEl.classList.toggle('glisse', t.glisse > 0.5);
    // Une figure réussie (ou une chute) : la bannière repart de zéro à chaque fois.
    if (figureEl && t.figure && t.figure.n !== figureVue) {
      figureVue = t.figure.n;
      figureEl.innerHTML = `<b>${t.figure.nom}</b>${t.figure.detail ? `<small>${t.figure.detail}</small>` : ''}`;
      figureEl.classList.toggle('chute', t.figure.nom === 'Chute !');
      figureEl.hidden = false;
      figureEl.classList.remove('vue');
      void figureEl.offsetWidth;             // relance l'animation CSS
      figureEl.classList.add('vue');
    }
  }

  // --------------------------------------------------------------------- HUD de combat
  const combatEl = $('combat'), coqueEl = $('coque'), restantsEl = $('restants'), viseurEl = $('viseur');
  const jaugeEl = $('jauge').firstElementChild;
  let vieVue = -1, restantsVus = -1, prochaineVague = 0, numVague = 0;
  /** Jauge de coque et compte des gobelins ; enchaine les vagues quand la place est nette. */
  function majCombat() {
    const actif = mode === 'robot';
    if (combatEl.hidden === actif) { combatEl.hidden = !actif; viseurEl.hidden = !actif; }
    if (!actif) return;
    viseurEl.classList.toggle('lock', robot.state.verrou);
    const vie = Math.round(robot.state.vie);
    if (vie !== vieVue) {
      vieVue = vie;
      coqueEl.textContent = vie;
      jaugeEl.style.width = `${100 * vie / robot.state.vieMax}%`;
      combatEl.classList.toggle('mal', vie < 40);
    }
    combatEl.classList.toggle('touche', robot.state.blesse > 0);
    combatEl.classList.toggle('ko', robot.state.detruit > 0);
    const reste = ennemis.restants;
    if (reste !== restantsVus) {
      restantsVus = reste;
      restantsEl.textContent = reste;
      if (!reste) prochaineVague = clock.value + 7;
    }
    if (!reste && prochaineVague && clock.value > prochaineVague) {
      prochaineVague = 0;
      numVague++;
      // un Chevalier d'Enfer de plus toutes les deux vagues, a partir de la deuxieme
      ennemis.vague(robot.root.position.x, robot.root.position.z, 6 + numVague, 52,
        Math.ceil(numVague / 2));
    }
  }

  function setMode(next) {
    const prev = mode;
    mode = next;
    // le robot laisse le promeneur là où il s'est arrêté
    if (prev === 'chasseur' && next !== 'chasseur') {
      jet.exit();
      placeWalker(jet.root.position.x, jet.root.position.z);
      volEl.hidden = true;
    }
    if (prev === 'trottinette' && next !== 'trottinette') {
      deuxRoues.exit();
      placeWalker(deuxRoues.position.x, deuxRoues.position.z);
      walker.yaw = deuxRoues.etat.yaw;
      autoEl.hidden = true;
    }
    if (prev === 'voiture' && next !== 'voiture') {
      auto.exit();
      placeWalker(auto.position.x, auto.position.z);
      walker.yaw = auto.etat.yaw;
      autoEl.hidden = true;
    }
    if (prev === 'robot' && next !== 'robot') {
      robot.exit();
      ennemis.clear();
      combatEl.hidden = true;
      viseurEl.hidden = true;
      placeWalker(robot.root.position.x, robot.root.position.z);
      walker.yaw = robot.state.yaw;
    }
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('choix-auto').hidden = mode !== 'voiture';
    majTactile();
    controls.enabled = mode === 'survol';
    $('help-walk').hidden = mode === 'survol';
    $('help-walk').innerHTML = isTouch && mode === 'robot'
      ? 'Pouce gauche : avancer · glisser à droite : viser · '
        + `<button class="mini" id="btn-laser">Laser</button> <button class="mini" data-robot="titan">Titan</button> <button class="mini" data-robot="mech">Mech</button>`
      : isTouch && mode === 'voiture'
      ? 'Pouce gauche : haut pour accélérer, bas pour freiner, côtés pour tourner · <b>MAIN</b> : frein à main'
      : isTouch
      ? 'Pouce gauche : avancer · glisser à droite : regarder'
      : mode === 'trottinette'
        ? 'Flèches ou <b>ZQSD</b> : conduire · <b>Espace</b> sauter · en l’air : <b>F</b> looping, <b>G</b> 360, '
          + 'flèches haut / bas pour incliner · <b>V</b> caméra · <b>R</b> se remettre en selle · '
          + '<b>P</b> au skatepark · bandes bleues = lancement à 41 km/h'
      : mode === 'voiture'
        ? (voitureUnique ? '' : '<b>C</b> : changer de voiture · ')
          + 'Flèches ou <b>ZQSD</b> : conduire · <b>Espace</b> frein à main · '
          + '<b>V</b> caméra · <b>R</b> remettre sur la route · <b>M</b> son du moteur · '
          + 'frein maintenu à l’arrêt : marche arrière'
          + (voitureUnique ? '' : ' · (choix de la voiture dans le panneau, en haut à gauche)')
      : mode === 'chasseur'
        ? 'Flèches : piloter · <b>Z</b> plein gaz · <b>Maj</b> post-combustion · <b>S</b> ralentir · '
          + '<b>E</b> / <b>Ctrl</b> monter, descendre · <b>V</b> caméra'
      : mode === 'robot'
        ? 'Souris : viser · <b>clic</b> ou <b>F</b> : laser · <b>ZQSD</b> · <b>Maj</b> courir · molette : recul · '
          + `<button class="mini" data-robot="titan">Titan bleu</button> <button class="mini" data-robot="mech">Mech rouge</button>`
        : mode === 'balade'
        ? 'Cliquer pour prendre la souris · <b>ZQSD</b> / flèches · <b>Maj</b> courir · <b>Échap</b> libérer'
        : 'Cliquer pour prendre la souris · <b>ZQSD</b> · <b>Espace</b> / <b>C</b> monter, descendre · <b>Maj</b> vite';
    if (mode === 'survol') {
      if (document.pointerLockElement) document.exitPointerLock();
      if (prev !== 'survol') {
        const t = walker.pos;
        controls.target.set(t.x, groundAt(t.x, t.z) + 2, t.z);
        camera.position.set(t.x + 60, controls.target.y + 55, t.z + 70);
      }
      return;
    }
    if (mode === 'chasseur') {
      // décollage au-dessus du point visé, cap dans la direction du regard
      const from = prev === 'survol' ? controls.target : walker.pos;
      const cap = prev === 'survol'
        ? Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z)
        : (prev === 'robot' ? robot.state.yaw : walker.yaw);
      placeWalker(from.x, from.z);
      if (document.pointerLockElement) document.exitPointerLock();
      if (ennemis) ennemis.clear();
      jet.enter(from.x, from.z, cap + Math.PI);
      volEl.hidden = false;
      return;
    }
    if (mode === 'trottinette') {
      const from = prev === 'survol' ? controls.target : walker.pos;
      const cap = prev === 'survol'
        ? Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z) + Math.PI
        : walker.yaw;
      placeWalker(from.x, from.z);
      if (document.pointerLockElement) document.exitPointerLock();
      if (ennemis) ennemis.clear();
      piloteTrottinette().enter(from.x, from.z, cap);
      autoEl.hidden = false;
      return;
    }
    if (mode === 'voiture') {
      // on se gare sur la chaussée la plus proche du point visé, dans le sens de la rue
      const from = prev === 'survol' ? controls.target : walker.pos;
      const cap = prev === 'survol'
        ? Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z) + Math.PI
        : (prev === 'robot' ? robot.state.yaw : walker.yaw);
      placeWalker(from.x, from.z);
      if (document.pointerLockElement) document.exitPointerLock();
      if (ennemis) ennemis.clear();
      pilote().enter(from.x, from.z, cap);
      // le bouton ♪ Moteur dit l'état réel du son, pas l'inverse
      majChoixAuto();
      autoEl.hidden = false;
      return;
    }
    if (mode === 'robot') {
      // largage du robot au point visé (survol) ou là où l'on se trouve
      const from = prev === 'survol' ? controls.target : walker.pos;
      const yaw = prev === 'survol'
        ? Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z) : walker.yaw;
      placeWalker(from.x, from.z);
      // le largage est asynchrone (chargement du modele) : on retient le point d'entree,
      // sinon la vague se poserait la ou le robot se trouvait encore, c'est-a-dire nulle part
      const px = walker.pos.x, pz = walker.pos.z;
      robot.enter(px, pz, yaw);
      // premiere vague : le temps que les gobelins chargent, le robot a touche le sol
      ennemis.load().then(() => {
        if (mode !== 'robot') return;
        ennemis.clear();
        numVague = 0;
        prochaineVague = 0;
        ennemis.vague(px, pz, 7, 48);
        majCombat();
      });
      return;
    }
    if (prev === 'survol') {
      // départ au point visé, sur un endroit praticable, dans la direction du regard
      placeWalker(controls.target.x, controls.target.z);
      walker.yaw = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
      if (mode === 'drone') walker.pos.y = Math.max(camera.position.y, walker.ground + 40);
    } else if (mode === 'balade') {
      placeWalker(walker.pos.x, walker.pos.z);        // le drone se pose
    } else {
      walker.pos.y = walker.ground + 25;              // le promeneur s'envole
    }
    walker.pitch = mode === 'drone' ? -0.35 : 0;
  }

  function placeWalker(x, z) {
    // cherche la cellule libre la plus proche (spirale)
    for (let r = 0; r < 60; r += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += r ? 0.5 / r : 7) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!blockedAt(px, pz)) {
          walker.pos.set(px, 0, pz);
          walker.ground = walkableAt(px, pz);
          walker.pos.y = walker.ground + EYE;
          return;
        }
      }
    }
    walker.pos.set(x, groundAt(x, z) + EYE, z);
  }

  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    // Entrer en voiture, c'est d'abord choisir laquelle : les deux ne se
    // conduisent pas pareil, et l'apprendre au premier virage est trop tard.
    if (b.dataset.mode === 'voiture' && mode !== 'voiture') {
      if (voitureUnique) { setMode('voiture'); majChoixAuto(pilote().choisirVoiture(voitureUnique)); return; }
      $('depart-auto').hidden = false;
      return;
    }
    setMode(b.dataset.mode);
  }));
  $('depart-auto').addEventListener('click', (e) => {
    const b = e.target.closest('[data-depart]');
    if (!b) return;
    $('depart-auto').hidden = true;
    setMode('voiture');
    majChoixAuto(pilote().choisirVoiture(b.dataset.depart));
  });
  // Choix de la voiture et son du moteur, dans le panneau : c'est là qu'on les cherche.
  $('choix-auto').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !auto) return;
    if (b.hasAttribute('data-son')) { b.classList.toggle('on', auto.basculerSon()); return; }
    const choisie = auto.choisirVoiture(b.dataset.auto);
    majChoixAuto(choisie);
  });

  /** Met les boutons du panneau d'accord avec l'état réel de la voiture. */
  function majChoixAuto(choisie = auto && auto.voitureChoisie()) {
    $('choix-auto').querySelectorAll('[data-auto]').forEach((b) => b.classList.toggle('on', b.dataset.auto === choisie));
    $('choix-auto').querySelector('[data-son]')?.classList.toggle('on', !!(auto && auto.state.son));
  }
  for (const [ev, on] of [['touchstart', true], ['touchend', false], ['touchcancel', false]]) {
    $('help-walk').addEventListener(ev, (e) => {
      if (!e.target.closest('#btn-laser')) return;
      e.preventDefault();
      robot.setTrigger(on);
    });
  }
  $('help-walk').addEventListener('click', (e) => {
    const son = e.target.closest('[data-son]');
    if (son) { e.stopPropagation(); son.classList.toggle('on', auto.basculerSon()); return; }
    const b = e.target.closest('[data-robot]');
    if (!b) return;
    e.stopPropagation();
    robot.setModel(b.dataset.robot);
    $('help-walk').querySelectorAll('[data-robot]').forEach((x) => x.classList.toggle('on', x === b));
  });
  renderer.domElement.addEventListener('click', () => {
    if (mode !== 'survol' && !isTouch && !document.pointerLockElement) renderer.domElement.requestPointerLock();
  });
  addEventListener('mousemove', (e) => {
    if (mode === 'survol' || document.pointerLockElement !== renderer.domElement) return;
    if (mode === 'robot') { robot.look(e.movementX * 0.0022, e.movementY * 0.0022); return; }
    walker.yaw -= e.movementX * 0.0022;
    walker.pitch = THREE.MathUtils.clamp(walker.pitch - e.movementY * 0.0022, -1.45, 1.45);
  });
  renderer.domElement.addEventListener('mousedown', (e) => {
    if (mode === 'robot' && e.button === 0) robot.setTrigger(true);
  });
  addEventListener('mouseup', (e) => { if (e.button === 0 && robot) robot.setTrigger(false); });
  renderer.domElement.addEventListener('wheel', (e) => {
    if (mode !== 'robot') return;             // en survol, c'est OrbitControls qui zoome
    e.preventDefault();
    robot.zoom(e.deltaY);
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (e.code === 'KeyN') toggleLabels();
    if (e.code === 'KeyV' && mode === 'chasseur') jet.basculerVue();
    if (mode === 'voiture') {
      if (e.code === 'KeyV') auto.basculerVue();
      if (e.code === 'KeyR') auto.redresser();
      // Le moteur est muet par défaut : on l'allume si on le veut.
      // C : on passe de la GT rouge (propulsion) à la berline bleue (traction).
      if (e.code === 'KeyC' && !voitureUnique) {
        majChoixAuto(auto.choisirVoiture(auto.voitureChoisie() === 'rouge' ? 'bleue' : 'rouge'));
      }
      if (e.code === 'KeyM') {
        auto.basculerSon();
        majChoixAuto();
      }
      // le frein à main ne doit pas faire défiler la page
      if (e.code === 'Space') e.preventDefault();
    }
    // les flèches pilotent l'appareil : elles ne doivent pas faire défiler la page
    if (mode === 'trottinette') {
      if (e.code === 'KeyV') deuxRoues.basculerVue();
      if (e.code === 'KeyR') deuxRoues.redresser();
      // Le skatepark est à 150 m du centre : trente secondes de trottinette
      // avant de commencer à jouer, à chaque essai. La touche y dépose.
      if (e.code === 'KeyP' && decor.parc) {
        const d = decor.parc.depart;
        deuxRoues.placer(d.x, d.z, d.cap);
      }
      if (e.code === 'KeyM') { deuxRoues.basculerSon(); }
      if (e.code === 'Space') e.preventDefault();
    }
    if ((mode === 'chasseur' || mode === 'voiture' || mode === 'trottinette')
        && e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // ───────────────────────────────────── TACTILE ─────────────────────────────
  // Téléphone en portrait. Trois choses comptent, et elles se sont toutes
  // révélées fausses au premier essai sur un vrai appareil :
  //
  //  1. `touch-action: none` sur le canevas. Sans lui, le navigateur confisque
  //     le glissé pour faire défiler la page : la caméra semble « ne pas
  //     répondre » alors qu'elle ne reçoit tout simplement plus les événements.
  //  2. Un manche VISIBLE, qui naît là où le pouce se pose. Un manche invisible
  //     au centre d'une moitié d'écran ne se trouve pas.
  //  3. Une sensibilité de regard pensée pour un pouce, pas pour une souris :
  //     un pouce parcourt 150 px, pas 800.
  const touches = new Map();
  const toile = renderer.domElement;
  toile.style.touchAction = 'none';
  const tactileEl = $('tactile'), mancheEl = $('manche'), pastilleEl = mancheEl.firstElementChild;
  const REGARD = 0.010;              // radians par pixel glissé
  const MANCHE = 52;                 // course du manche, en pixels
  let pince = 0;                     // écart des deux doigts, pour le zoom caméra

  /** Le manche s'affiche au point (x, y) et sa pastille suit le pouce. */
  function poserManche(x, y, dx = 0, dy = 0) {
    mancheEl.style.left = `${x}px`;
    mancheEl.style.top = `${y}px`;
    pastilleEl.style.transform = `translate(${dx * MANCHE}px, ${dy * MANCHE}px)`;
    mancheEl.classList.add('on');
  }

  function rangerManche() {
    mancheEl.classList.remove('on');
    pastilleEl.style.transform = 'translate(0px, 0px)';
    touchMove.active = false;
    touchMove.x = touchMove.y = 0;
  }

  /** Vrai si ce point tombe dans le coin réservé au déplacement. */
  const zoneManche = (x, y) => x < innerWidth * 0.55 && y > innerHeight * 0.45;

  toile.addEventListener('touchstart', (e) => {
    if (mode === 'survol') return;
    for (const t of e.changedTouches) {
      const gauche = zoneManche(t.clientX, t.clientY) && !touchMove.active;
      touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, left: gauche });
      if (gauche) {
        touchMove.active = true;
        poserManche(t.clientX, t.clientY);
      }
    }
    if (e.touches.length === 2) {
      pince = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                         e.touches[0].clientY - e.touches[1].clientY);
    }
    e.preventDefault();
  }, { passive: false });

  toile.addEventListener('touchmove', (e) => {
    if (mode === 'survol') return;
    // deux doigts : pincement = recul de la caméra du robot
    if (e.touches.length === 2 && pince) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX,
                           e.touches[0].clientY - e.touches[1].clientY);
      if (mode === 'robot') robot.zoom((pince - d) * 6);
      pince = d;
      e.preventDefault();
      return;
    }
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      if (!s) continue;
      if (s.left) {
        const dx = THREE.MathUtils.clamp((t.clientX - s.x0) / MANCHE, -1, 1);
        const dy = THREE.MathUtils.clamp((t.clientY - s.y0) / MANCHE, -1, 1);
        touchMove.x = dx;
        touchMove.y = dy;
        touchMove.active = true;
        poserManche(s.x0, s.y0, dx, dy);
      } else if (mode === 'robot') {
        robot.look((t.clientX - s.x) * REGARD, (t.clientY - s.y) * REGARD);
      } else if (mode === 'chasseur') {
        // en vol, le glissé tient lieu de manche : droite = roulis, haut = cabrer
        jet.commande((t.clientX - s.x0) / 90, (t.clientY - s.y0) / 90);
      } else {
        walker.yaw -= (t.clientX - s.x) * REGARD;
        walker.pitch = THREE.MathUtils.clamp(walker.pitch - (t.clientY - s.y) * REGARD, -1.4, 1.4);
      }
      s.x = t.clientX; s.y = t.clientY;
    }
    e.preventDefault();
  }, { passive: false });

  const finTouche = (e) => {
    for (const t of e.changedTouches) {
      const s = touches.get(t.identifier);
      if (s && s.left) rangerManche();
      if (s && !s.left && mode === 'chasseur') jet.commande(0, 0);
      touches.delete(t.identifier);
    }
    if (e.touches.length < 2) pince = 0;
  };
  toile.addEventListener('touchend', finTouche, { passive: true });
  toile.addEventListener('touchcancel', finTouche, { passive: true });

  // ── Boutons d'action ──────────────────────────────────────────────────────
  const btnFeu = $('btn-feu'), btnCourse = $('btn-course'), btnVue = $('btn-vue');
  const presser = (el, debut, fin) => {
    el.addEventListener('pointerdown', (ev) => { ev.preventDefault(); el.setPointerCapture(ev.pointerId); debut(); });
    el.addEventListener('pointerup', () => fin && fin());
    el.addEventListener('pointercancel', () => fin && fin());
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  };
  presser(btnFeu,
    () => {
      if (mode === 'robot') robot.setTrigger(true);
      else if (mode === 'voiture') auto.setMain(true);
      else if (mode === 'trottinette') deuxRoues.setMain(true);      // SAUT
    },
    () => {
      if (mode === 'robot') robot.setTrigger(false);
      else if (mode === 'voiture') auto.setMain(false);
      else if (mode === 'trottinette') deuxRoues.setMain(false);
    });
  btnCourse.addEventListener('click', () => {
    // En trottinette, ce bouton demande un looping (au prochain saut, ou en l'air).
    if (mode === 'trottinette') { deuxRoues.figure('flip'); return; }
    touchMove.run = !touchMove.run;
    btnCourse.classList.toggle('on', touchMove.run);
  });
  btnVue.addEventListener('click', () => {
    if (mode === 'chasseur') jet.basculerVue();
    else if (mode === 'voiture') auto.basculerVue();
    else if (mode === 'trottinette') deuxRoues.basculerVue();
    else if (mode === 'robot') robot.zoom(robot.state.dist > 22 ? -4000 : 4000);
  });

  /** Affiche les commandes dans les modes pilotés, et adapte les boutons au mode. */
  function majTactile() {
    if (!isTouch) return;
    const actif = mode !== 'survol';
    if (tactileEl.hidden === actif) tactileEl.hidden = !actif;
    // En voiture, le gros bouton devient le frein à main : c'est la commande
    // qu'on garde sous le pouce, comme le tir en robot.
    btnFeu.style.display = (mode === 'robot' || mode === 'voiture' || mode === 'trottinette') ? '' : 'none';
    btnFeu.textContent = mode === 'voiture' ? 'MAIN' : mode === 'trottinette' ? 'SAUT' : 'TIR';
    btnCourse.style.display = (mode === 'robot' || mode === 'balade' || mode === 'drone' || mode === 'trottinette') ? '' : 'none';
    btnCourse.textContent = mode === 'trottinette' ? 'Flip' : 'Cours';
    btnCourse.classList.toggle('on', mode !== 'trottinette' && touchMove.run);
    btnVue.style.display = (mode === 'robot' || mode === 'chasseur' || mode === 'voiture' || mode === 'trottinette') ? '' : 'none';
    if (!actif) rangerManche();
  }

  function stepWalker(dt) {
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') || touchMove.run;
    let ix = 0, iz = 0, iy = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    if (keys.has('Space')) iy += 1;
    if (keys.has('KeyC') || keys.has('ControlLeft')) iy -= 1;
    if (touchMove.active) { ix += touchMove.x; iz += touchMove.y; }
    fwd.set(-Math.sin(walker.yaw), 0, -Math.cos(walker.yaw));
    right.set(-fwd.z, 0, fwd.x);
    move.set(0, 0, 0).addScaledVector(fwd, -iz).addScaledVector(right, ix);
    const len = move.length();
    if (len > 1) move.multiplyScalar(1 / len);

    if (mode === 'drone') {
      const speed = fast ? DRONE_FAST : DRONE;
      // en drone, « avancer » suit aussi l'inclinaison du regard
      walker.pos.addScaledVector(move, speed * dt);
      walker.pos.y += (iy * speed + (-iz) * Math.sin(walker.pitch) * speed) * dt;
      const floor = Math.max(groundAt(walker.pos.x, walker.pos.z), surfaceAt(walker.pos.x, walker.pos.z)) + 1.5;
      if (walker.pos.y < floor) walker.pos.y = floor;
      walker.pos.x = THREE.MathUtils.clamp(walker.pos.x, -2900, 2900);
      walker.pos.z = THREE.MathUtils.clamp(walker.pos.z, -2900, 2900);
      return;
    }
    const speed = fast ? RUN : WALK;
    const dx = move.x * speed * dt, dz = move.z * speed * dt;
    const R = 0.3;
    // glissement le long des murs : on teste chaque axe séparément
    const nx = walker.pos.x + dx;
    if (!blockedAt(nx + Math.sign(dx) * R, walker.pos.z) && Math.abs(walkableAt(nx, walker.pos.z) - walker.ground) < 1.2) walker.pos.x = nx;
    const nz = walker.pos.z + dz;
    if (!blockedAt(walker.pos.x, nz + Math.sign(dz) * R) && Math.abs(walkableAt(walker.pos.x, nz) - walker.ground) < 1.2) walker.pos.z = nz;
    if (blockedAt(walker.pos.x, walker.pos.z)) {
      // coincé (téléportation, décor mal fermé) : on repousse vers la sortie la plus proche
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const ex = Math.cos(a), ez = Math.sin(a);
        if (!blockedAt(walker.pos.x + ex * 1.2, walker.pos.z + ez * 1.2)) {
          walker.pos.x += ex * Math.min(2.5 * dt, 0.15);
          walker.pos.z += ez * Math.min(2.5 * dt, 0.15);
          break;
        }
      }
    }
    const g = walkableAt(walker.pos.x, walker.pos.z);
    walker.ground += (g - walker.ground) * Math.min(1, dt * 12);
    // léger balancement de la marche
    walker.bob = (walker.bob || 0) + (len > 0.1 ? dt * speed * 5.5 : 0);
    walker.pos.y = walker.ground + EYE + (len > 0.1 ? Math.sin(walker.bob) * 0.025 : 0);
  }

  // --------------------------------------------------------------------- recherche, mini-carte
  const places = [
    ...meta.lieux.map((p) => ({ nom: p.nom, genre: p.genre, x: p.x, z: p.z })),
    ...meta.rues.map((r) => ({ nom: r.nom, genre: 'Rue', x: r.x, z: r.z })),
  ];
  const list = $('places');
  for (const p of places) {
    const o = document.createElement('option');
    o.value = p.nom;
    o.label = p.genre;
    list.appendChild(o);
  }
  function goTo(x, z) {
    if (mode === 'survol') {
      const y = groundAt(x, z);
      const dir = proj.copy(camera.position).sub(controls.target);
      dir.y = 0;
      dir.setLength(75);
      controls.target.set(x, y + 3, z);
      camera.position.set(x + dir.x, y + 60, z + dir.z);
    } else {
      placeWalker(x, z);
      if (mode === 'drone') walker.pos.y = walker.ground + 35;
      if (mode === 'robot') robot.enter(walker.pos.x, walker.pos.z, robot.state.yaw);
      if (mode === 'voiture') auto.enter(walker.pos.x, walker.pos.z, auto.etat.yaw);
    }
  }
  $('search').addEventListener('change', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const p = places.find((pl) => pl.nom.toLowerCase() === q) || places.find((pl) => pl.nom.toLowerCase().includes(q));
    if (p) goTo(p.x, p.z);
    e.target.blur();
  });

  const mini = $('minimap');
  const mctx = mini.getContext('2d');
  const plan = new Image();
  plan.src = BASE + 'plan.jpg' + V;
  const MINI_SPAN = 2 * H;
  mini.addEventListener('click', (e) => {
    const r = mini.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * MINI_SPAN - H;
    const z = ((e.clientY - r.top) / r.height) * MINI_SPAN - H;
    goTo(x, z);
  });
  function drawMinimap() {
    const s = mini.width;
    if (plan.complete) mctx.drawImage(plan, 0, 0, s, s);
    const focus = mode === 'survol' ? controls.target
      : mode === 'chasseur' ? jet.root.position
      : mode === 'voiture' ? auto.position
      : mode === 'trottinette' ? deuxRoues.position
      : mode === 'robot' ? robot.root.position : walker.pos;
    const px = ((focus.x + H) / MINI_SPAN) * s, py = ((focus.z + H) / MINI_SPAN) * s;
    const yaw = mode === 'survol'
      ? Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z)
      : mode === 'chasseur' ? (jet.root.getWorldDirection(capJet), Math.atan2(-capJet.x, -capJet.z))
      : mode === 'voiture' ? auto.etat.yaw
      : mode === 'trottinette' ? deuxRoues.etat.yaw
      : mode === 'robot' ? robot.state.yaw : walker.yaw;
    // l'épicerie : un point doré, pour la retrouver d'un coup d'œil
    if (epicerie) {
      const ex = ((epicerie.position.x + H) / MINI_SPAN) * s, ez = ((epicerie.position.z + H) / MINI_SPAN) * s;
      mctx.beginPath();
      mctx.arc(ex, ez, 4, 0, Math.PI * 2);
      mctx.fillStyle = '#ffcf4a';
      mctx.strokeStyle = 'rgba(0,0,0,.75)';
      mctx.lineWidth = 1.5;
      mctx.fill(); mctx.stroke();
    }
    mctx.save();
    mctx.translate(px, py);
    mctx.rotate(-yaw);
    mctx.fillStyle = 'rgba(255, 220, 60, .95)';
    mctx.strokeStyle = 'rgba(0,0,0,.7)';
    mctx.lineWidth = 1.5;
    mctx.beginPath();
    mctx.moveTo(0, -9); mctx.lineTo(6, 7); mctx.lineTo(0, 3); mctx.lineTo(-6, 7); mctx.closePath();
    mctx.fill(); mctx.stroke();
    mctx.restore();
  }

  function toggleLabels() {
    showLabels = !showLabels;
    $('btn-labels').classList.toggle('on', showLabels);
  }
  $('btn-labels').addEventListener('click', toggleLabels);

  const timeInput = $('time');
  let pendingTime = null;
  timeInput.addEventListener('input', () => { pendingTime = +timeInput.value; });
  document.querySelectorAll('[data-time]').forEach((b) => b.addEventListener('click', () => {
    timeInput.value = b.dataset.time;
    pendingTime = +b.dataset.time;
  }));
  setTime(+timeInput.value);

  // --------------------------------------------------------------------- visite guidée
  let tour = null;
  const tourCam = new THREE.Vector3(), tourLook = new THREE.Vector3();
  function startTour() {
    setMode('survol');
    const order = ['Église', 'Mairie', 'Lavoir', 'Château', 'École', "Château d'eau"];
    const stops = order.map((g) => meta.lieux.find((l) => l.genre === g)).filter(Boolean);
    const cams = [camera.position.clone()], looks = [controls.target.clone()];
    stops.forEach((p, i) => {
      const a = i * 1.3 + 0.6;
      const y = groundAt(p.x, p.z);
      cams.push(new THREE.Vector3(p.x + Math.cos(a) * 48, y + 30, p.z + Math.sin(a) * 48));
      looks.push(new THREE.Vector3(p.x, y + 6, p.z));
    });
    const c = church || { x: 0, z: 0 };
    cams.push(new THREE.Vector3(c.x + 520, 330, c.z + 480));
    looks.push(new THREE.Vector3(c.x, 30, c.z));
    tour = {
      cam: new THREE.CatmullRomCurve3(cams, false, 'centripetal'),
      look: new THREE.CatmullRomCurve3(looks, false, 'centripetal'),
      t: 0, duration: 16 * stops.length + 14,
    };
    controls.enabled = false;
    $('btn-tour').classList.add('on');
  }
  function stopTour() {
    if (!tour) return;
    tour = null;
    controls.enabled = mode === 'survol';
    $('btn-tour').classList.remove('on');
  }
  $('btn-tour').addEventListener('click', () => (tour ? stopTour() : startTour()));
  for (const ev of ['pointerdown', 'wheel', 'keydown']) {
    addEventListener(ev, (e) => { if (tour && e.target !== $('btn-tour')) stopTour(); }, { passive: true });
  }

  // informations sur le bâtiment pointé (clic simple en survol)
  const pick = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downAt = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (mode !== 'survol' || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    pick.setFromCamera(ndc, camera);
    // `walls` et `roofs` étaient des variables locales de l'ancien constructeur
    // de décor ; depuis que le village est bâti par `poilhes-scene.js`, elles
    // n'existent plus et le clic levait une erreur. On interroge le décor.
    const hit = pick.intersectObject(decor.root, true)[0];
    const card = $('card');
    if (!hit) { card.hidden = true; return; }
    let best = null, d = 1e9;
    for (const b of meta.batiments) {
      const dd = Math.hypot(b.x - hit.point.x, -b.n - hit.point.z);
      if (dd < d) { d = dd; best = b; }
    }
    if (!best) return;
    const STYLE = ['Enduit à la chaux', 'Moellons de pierre', 'Pierre de taille', 'Bâtiment d’activité', 'Annexe', 'Construction récente'];
    const METHOD = { pans: 'pans détectés dans le LiDAR', lidar: 'surface LiDAR', bdtopo: 'hauteurs BD TOPO (après le relevé LiDAR)' };
    card.innerHTML = `<b>${best.nom || best.usage || 'Bâtiment'}</b>
      <span>Hauteur au faîtage : ${(best.toit - best.sol).toFixed(1)} m</span>
      <span>Façade : ${STYLE[best.style]}</span>
      <span>Toit : ${METHOD[best.methode]}</span>
      ${best.rnb ? `<small>RNB ${best.rnb}</small>` : ''}`;
    card.hidden = false;
  });
  renderer.domElement.addEventListener('dblclick', () => {
    if (mode !== 'survol') return;
    const hit = pick.intersectObject(decor.root, true)[0];
    if (hit) goTo(hit.point.x, hit.point.z);
  });

  $('stats').textContent =
    `${meta.stats.batiments} bâtiments · ${meta.stats.arbres} arbres · ${meta.rues.length} rues · ${meta.stats.piscines} piscines`;

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // --------------------------------------------------------------------- boucle
  setProgress(1, 'Prêt');
  if (ouvrir) setTimeout(() => $('loader').classList.add('done'), 250);

  // Mode demandé par l'URL : le catalogue des Mondes envoie ici avec ?mode=chasseur
  // ou ?mode=robot. On attend que le décor soit posé pour basculer.
  const modeDemande = params.get('mode');
  if (modeDemande && veut(modeDemande) && ['balade', 'drone', 'robot', 'chasseur', 'voiture', 'trottinette'].includes(modeDemande)) {
    setTimeout(() => setMode(modeDemande), 400);
  }
  const timer = new THREE.Clock();
  const focus = new THREE.Vector3();
  const lookDir = new THREE.Vector3();

  /** Une image : navigation, ombres cadrées sur le point regardé, étiquettes, rendu. */
  function tick() {
    const dt = Math.min(timer.getDelta(), 0.1);
    clock.value += dt;
    skyU.uTime.value = clock.value;
    if (pendingTime !== null) {
      setTime(pendingTime);
      // phares et feux de la voiture : ils suivent l'heure du village
      if (auto) auto.setNuit(pendingTime < 7.4 || pendingTime > 20.2);
      pendingTime = null;
    }

    if (tour) {
      tour.t = Math.min(1, tour.t + dt / tour.duration);
      const e = tour.t * tour.t * (3 - 2 * tour.t);
      tour.cam.getPoint(e, tourCam);
      tour.look.getPoint(e, tourLook);
      camera.position.copy(tourCam);
      controls.target.copy(tourLook);
      camera.lookAt(tourLook);
      focus.copy(tourLook);
      if (tour.t >= 1) stopTour();
    } else if (mode === 'chasseur') {
      jet.update(dt);
      majVol();
      focus.copy(jet.root.position);
    } else if (mode === 'voiture') {
      auto.update(dt, touchMove);
      majAuto();
      focus.copy(auto.position);
    } else if (mode === 'trottinette') {
      deuxRoues.update(dt, touchMove);
      majAuto(deuxRoues);
      focus.copy(deuxRoues.position);
    } else if (mode === 'robot') {
      robot.update(dt, touchMove);
      ennemis.update(dt, proie);
      majCombat();
      focus.copy(robot.root.position);
    } else if (mode === 'survol') {
      controls.update();
      const floor = groundAt(camera.position.x, camera.position.z) + 1.5;
      if (camera.position.y < floor) camera.position.y = floor;
      focus.copy(controls.target);
    } else {
      stepWalker(dt);
      camera.position.copy(walker.pos);
      euler.set(walker.pitch, walker.yaw, 0);
      camera.quaternion.setFromEuler(euler);
      lookDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
      focus.copy(walker.pos).addScaledVector(lookDir, mode === 'drone' ? 80 : 25);
    }

    // ombres : cadrées autour du point regardé, alignées sur les texels (pas de scintillement)
    const dist = camera.position.distanceTo(focus);
    const half = THREE.MathUtils.clamp(dist * 0.9, 45, 520);
    const cam = sun.shadow.camera;
    if (Math.abs(cam.right - half) > half * 0.15) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
      cam.updateProjectionMatrix();
    }
    const texel = (2 * half) / sun.shadow.mapSize.x;
    focus.x = Math.round(focus.x / texel) * texel;
    focus.z = Math.round(focus.z / texel) * texel;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(sunDir, 600);

    sky.position.copy(camera.position);
    if ((frame++ & 1) === 0) updateLabels();
    if ((frame & 7) === 0) drawMinimap();
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(tick);

  window.RaphaelPoilhes = {
    meta, scene, camera, controls, renderer, decor, sun, setMode, goTo, setTime, groundAt, walker,
    blockedAt, walkableAt, surfaceAt, keys, step: stepWalker, startTour, stopTour, tick, robot, ennemis, jet,
    get voiture() { return auto; },
    get trottinette() { return deuxRoues; },
    get mode() { return mode; },
  };
  return window.RaphaelPoilhes;
}
