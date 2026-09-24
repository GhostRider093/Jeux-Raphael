/**
 * Poilhes (Hérault) — maquette 3D du village à partir des données publiques IGN / OSM.
 *
 * Données : maps/poilhes/ (générées par scripts/poilhes/build_village.py).
 * Trois façons de visiter : Survol (orbite), Balade (à pied, collisions) et Drone (vol libre).
 *
 * Aucune allocation dans la boucle d'animation : vecteurs et tableaux réutilisés.
 */
import * as THREE from 'three';
import { construireSkatepark } from './poilhes-skatepark.js?v=skatepark-20260922';

import {
  facadeMaterial, roofMaterial, groundMaterial, waterMaterial, foliageMaterial, stoneMaterial, skyMaterial,
  roadMaterial, leafMaterial, barkMaterial,
} from './poilhes-shaders.js?v=voiture-20260921';

/** Cartes de feuillage par arbre au niveau Élevé ; les niveaux inférieurs n'en dessinent qu'une partie. */
const CARTES = 84;

// Dossier des données du village courant. La chaîne sait en reconstruire
// plusieurs (scripts/poilhes/sites.py) ; le moteur n'en connaît aucun d'avance.
const DOSSIER = (village) => `maps/${village}/`;
const EYE = 1.68;              // hauteur des yeux du promeneur (m)
const WALK = 1.5, RUN = 4.2;   // vitesses de marche (m/s)
const DRONE = 14, DRONE_FAST = 55;

const $ = (id) => document.getElementById(id);
// f16 : les attributs de texture (murs, toits) sont stockés en demi-précision.
// Uint16Array porte les bits, et THREE.Float16BufferAttribute dit à WebGL de les
// lire comme des demi-flottants — le shader, lui, reçoit des float ordinaires.
const TYPED = { f32: Float32Array, f16: Uint16Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array };
const estF16 = (meta, nom) => meta.tableaux[nom].type === 'f16';

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

// ---------------------------------------------------------------------------- ambiance

const C = (hex) => new THREE.Color(hex);
const PALETTE = {
  dayZenith: C(0x3a78c4), dayHorizon: C(0xc4d9ec),
  goldZenith: C(0x4c6f9e), goldHorizon: C(0xf0b27e),
  duskZenith: C(0x1a2744), duskHorizon: C(0xb8674b),
  sunDay: C(0xfff3de), sunGold: C(0xffae62), sunDusk: C(0xff7a45),
  nightZenith: C(0x03050c), nightHorizon: C(0x121829),
};

/**
 * Ciel, soleil, brouillard et reflets : tout ce qui ne regarde pas un village
 * en particulier.
 *
 * Un village isolé se fabrique la sienne. Un pays — plusieurs villages dans la
 * même carte, à leur écart réel — en fabrique une et la prête à chacun : deux
 * sphères de ciel superposées se battraient pixel par pixel, et deux soleils
 * éclaireraient la scène deux fois.
 *
 * @returns {{sky, skyU, sun, hemi, sunDir, regler(hours): number}} `regler`
 *   renvoie l'allumage de l'éclairage public (0 le jour, 1 la nuit tombée).
 */
export function creerAmbiance({ scene, renderer, cible = scene, leger = false,
                                lat = 43.3077, lon = 3.0797 }) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(8000, 48, 24), skyMaterial(THREE));
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  cible.add(sky);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTarget = null;

  const sun = new THREE.DirectionalLight(0xfff1d6, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(leger ? 2048 : 4096, leger ? 2048 : 4096);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.04;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 1400;
  cible.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x8a7a5e, 0.9);
  cible.add(hemi);

  const sunDir = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const skyU = sky.material.uniforms;

  function regler(hours) {
    sunDirection(lat, lon, new Date(), hours, sunDir);
    const e = THREE.MathUtils.radToDeg(Math.asin(sunDir.y));
    const gold = THREE.MathUtils.smoothstep(e, 2, 28);          // 0 au couchant, 1 en journée
    const dusk = THREE.MathUtils.smoothstep(e, -6, 3);           // 0 la nuit tombée
    const nightF = 1 - THREE.MathUtils.smoothstep(e, -9, -1);    // 1 en pleine nuit
    const lampsOn = 1 - THREE.MathUtils.smoothstep(e, -3, 4);    // l'éclairage public s'allume au crépuscule
    skyU.uSun.value.copy(sunDir);
    skyU.uNight.value = nightF;
    skyU.uZenith.value.copy(PALETTE.duskZenith).lerp(PALETTE.goldZenith, dusk).lerp(PALETTE.dayZenith, gold).lerp(PALETTE.nightZenith, nightF);
    skyU.uHorizon.value.copy(PALETTE.duskHorizon).lerp(PALETTE.goldHorizon, dusk).lerp(PALETTE.dayHorizon, gold).lerp(PALETTE.nightHorizon, nightF);
    skyU.uSunColor.value.copy(PALETTE.sunDusk).lerp(PALETTE.sunGold, dusk).lerp(PALETTE.sunDay, gold);
    sun.color.copy(skyU.uSunColor.value);
    sun.intensity = 3.4 * THREE.MathUtils.smoothstep(e, -1, 10) * (0.75 + 0.25 * gold);
    hemi.intensity = 0.3 + 0.9 * dusk - 0.1 * nightF;
    hemi.color.copy(skyU.uZenith.value).lerp(tmpColor.set(0xffffff), 0.68);
    // lumière renvoyée par le sol et les murs ensoleillés : chaude, suit la couleur du soleil
    hemi.groundColor.set(0x9c8466).lerp(skyU.uSunColor.value, 0.25);
    if (scene.fog) scene.fog.color.copy(skyU.uHorizon.value).multiplyScalar(0.92);
    renderer.toneMappingExposure = 0.75 + 0.35 * dusk + 0.45 * nightF;
    // reflets (eau, vitres) : environnement recalculé depuis le ciel
    if (envTarget) envTarget.dispose();
    envTarget = pmrem.fromScene(envScene, 0.02);
    scene.environment = envTarget.texture;
    return lampsOn;
  }

  return { sky, skyU, sun, hemi, sunDir, regler };
}

// ---------------------------------------------------------------------------- horizon

/**
 * Le grand plan qui ferme l'horizon, drapé de la photo aérienne.
 *
 * Un village isolé en pose un de 6 km autour de lui. Un pays en pose un seul,
 * plus grand, commun à tous ses villages — d'où cette fonction partagée.
 */
export function reliefLointain(F, hauteurs, texture) {
  const g = new THREE.PlaneGeometry(F.demi_cote * 2, F.demi_cote * 2, F.n - 1, F.n - 1);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let k = 0; k < p.count; k++) {
    const i = Math.round((p.getX(k) + F.demi_cote) / F.pas), j = Math.round((p.getZ(k) + F.demi_cote) / F.pas);
    p.setY(k, hauteurs[j * F.n + i]);
  }
  g.computeVertexNormals();
  // même correction que le sol détaillé : albédo plausible, saturation légèrement relevée
  const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: 1, envMapIntensity: 0.35 });
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
{ float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, 1.25) * 0.72; }`);
  };
  return new THREE.Mesh(g, mat);
}

/**
 * Où poser le skatepark, par village.
 *
 * Le point du relevé OSM est le **centre du terrain de sport**, pas celui de la
 * zone libre autour : à Poilhes, il tombe à 18 m du bord d'un talus. Le centre
 * retenu a été mesuré en sondant `groundAt` et `blockedAt` — 52 × 56 m sans un
 * seul obstacle et 76 cm de dénivelé. Un village sans entrée ici retombe sur le
 * point du relevé.
 */
const PARCS = { poilhes: { x: 6.75, z: 133 } };

// ---------------------------------------------------------------------------- décor

/**
 * Construit le village dans une scène : relief, bâtiments, eau, arbres, vignes,
 * cheminées, lanternes, ciel et soleil — et les fonctions qui interrogent tout cela.
 *
 * Ce module ne connaît ni HUD, ni modes de jeu, ni boucle de rendu : il pose le
 * décor et rend les clés. C'est ce qui permet de le charger aussi bien dans
 * `poilhes.html` (la visite) que dans le moteur des Mondes, où Poilhes devient
 * un monde comme les autres — avec le chasseur, le cockpit et le combat.
 *
 * @returns {Promise<object>} meta, groundAt, walkableAt, blockedAt, surfaceAt,
 *   setTime, clock, sun, sunDir, skyU, bounds, root.
 */
export async function construireVillage({ scene, renderer, camera, onProgress = () => {},
                                         leger = false, onHeure = null, root = null,
                                         village = 'poilhes',
                                         ambiance: ambiancePartagee = null, lointain = true }) {
  const BASE = DOSSIER(village);
  const setProgress = onProgress;
  const isTouch = leger;
  // Le décor peut être posé dans un groupe plutôt que directement dans la scène :
  // c'est ce que demande le moteur des Mondes, qui veut un `root` à lui.
  const cible = root || scene;
  if (root && !root.parent) scene.add(root);
  setProgress(0.02, 'Lecture de l’index…');
  const meta = await (await fetch(BASE + 'village.json', { cache: 'no-cache' })).json();
  const buffer = await fetchWithProgress(BASE + 'village.bin', (f) => setProgress(0.05 + f * 0.6, 'Géométrie du village…'));
  const arr = (name) => {
    const e = meta.tableaux[name];
    return new TYPED[e.type](buffer, e.offset, e.count);
  };

  const V = `?v=${meta.version || 0}`;      // estampille : évite les tuiles périmées en cache
  const clock = { value: 0 };
  const loader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // --------------------------------------------------------------------- ciel et lumière
  // Le village se fabrique une ambiance, ou emprunte celle qu'on lui prête :
  // dans un pays, les villages partagent un seul ciel et un seul soleil.
  const ambiance = ambiancePartagee || creerAmbiance({
    scene, renderer, cible, leger: isTouch, lat: meta.origine.lat, lon: meta.origine.lon,
  });
  const { sky, skyU, sun, hemi, sunDir } = ambiance;

  /** Éclairage nocturne partagé par les matériaux (fenêtres, lanternes, flaques de lumière). */
  const night = { uNight: { value: 0 }, nightMap: { value: null }, uHalf: { value: 500 } };
  const nightHooks = [];

  /** Allumage de l'éclairage de ce village seul : le ciel, lui, suit l'ambiance. */
  function setNight(lampsOn) {
    night.uNight.value = lampsOn;
    for (const hook of nightHooks) hook(lampsOn);
  }

  function setTime(hours) {
    setNight(ambiance.regler(hours));
    if (onHeure) onHeure(hours);
  }

  // --------------------------------------------------------------------- terrain
  setProgress(0.68, 'Relief LiDAR et photo aérienne…');
  const Z = meta.zone;
  const H = Z.demi_cote, STEP = Z.pas, N = Z.n;
  const heights = arr('terrain');

  /** Altitude du sol (bilinéaire) au point (x, z) du repère Three.js. */
  function groundAt(x, z) {
    const c = THREE.MathUtils.clamp((x + H) / STEP, 0, N - 1.001);
    const r = THREE.MathUtils.clamp((z + H) / STEP, 0, N - 1.001);
    const i = c | 0, j = r | 0, fx = c - i, fz = r - j;
    const a = heights[j * N + i] * (1 - fx) + heights[j * N + i + 1] * fx;
    const b = heights[(j + 1) * N + i] * (1 - fx) + heights[(j + 1) * N + i + 1] * fx;
    return a * (1 - fz) + b * fz;
  }

  night.uHalf.value = H;
  night.nightMap.value = await loadTexture(loader, BASE + 'nuit.png' + V, false);
  const T = meta.tuiles_par_cote;
  const per = (N - 1) / T;
  const tileTextures = await Promise.all(meta.tuiles.map(async (t) => {
    const [photo, mask] = await Promise.all([
      loadTexture(loader, `${BASE}ortho_${t.i}_${t.j}.jpg${V}`, true),
      loadTexture(loader, `${BASE}sol_${t.i}_${t.j}.png${V}`, false),
    ]);
    photo.anisotropy = maxAniso;
    mask.anisotropy = maxAniso;
    return { t, photo, mask };
  }));
  const terrainMeshes = [];
  for (const { t, photo, mask } of tileTextures) {
    const cnt = per + 1;
    const pos = new Float32Array(cnt * cnt * 3), nor = new Float32Array(cnt * cnt * 3), uv = new Float32Array(cnt * cnt * 2);
    for (let jj = 0; jj < cnt; jj++) {
      for (let ii = 0; ii < cnt; ii++) {
        const gi = t.i * per + ii, gj = t.j * per + jj, k = jj * cnt + ii;
        const y = heights[gj * N + gi];
        pos.set([-H + gi * STEP, y, -H + gj * STEP], k * 3);
        const hl = heights[gj * N + Math.max(gi - 1, 0)], hr = heights[gj * N + Math.min(gi + 1, N - 1)];
        const hu = heights[Math.max(gj - 1, 0) * N + gi], hd = heights[Math.min(gj + 1, N - 1) * N + gi];
        const nx = hl - hr, nz = hu - hd, ny = 2 * STEP;
        const l = Math.hypot(nx, ny, nz);
        nor.set([nx / l, ny / l, nz / l], k * 3);
        uv.set([ii / per, 1 - jj / per], k * 2);
      }
    }
    const idx = new Uint32Array(per * per * 6);
    let o = 0;
    for (let jj = 0; jj < per; jj++) {
      for (let ii = 0; ii < per; ii++) {
        const a = jj * cnt + ii, b = a + 1, c = a + cnt, d = c + 1;
        idx.set([a, c, b, b, c, d], o);
        o += 6;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, groundMaterial(THREE, photo, mask, night));
    m.receiveShadow = true;
    cible.add(m);
    terrainMeshes.push(m);
  }

  // Relief lointain (6 km) pour un horizon réel. Un pays fournit le sien, commun
  // à ses villages : deux plans à la même altitude se battraient pixel par pixel.
  if (lointain) {
    const tex = await loadTexture(loader, BASE + 'ortho_lointain.jpg' + V, true);
    tex.anisotropy = maxAniso;
    cible.add(reliefLointain(meta.lointain, arr('lointain'), tex));
  }

  // --------------------------------------------------------------------- chaussée
  // Rubans de bitume posés sur le relief (scripts/poilhes/roads.py) : bombement,
  // caniveau, accotement. La photo aérienne reste dessous, pour les cours et les
  // seuils ; la rue, elle, est un vrai volume.
  const routePos = arr('routes_pos');
  if (routePos.length) {
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.BufferAttribute(routePos, 3));
    roadGeo.setAttribute('normal', new THREE.BufferAttribute(arr('routes_nor'), 3));
    roadGeo.setAttribute('aInfo', new THREE.BufferAttribute(arr('routes_info'), 4));
    roadGeo.setAttribute('aFin', new THREE.BufferAttribute(arr('routes_fin'), 1));
    roadGeo.setIndex(new THREE.BufferAttribute(arr('routes_idx'), 1));
    const roads = new THREE.Mesh(roadGeo, roadMaterial(THREE, night));
    roads.receiveShadow = true;
    roads.renderOrder = 1;               // au-dessus du sol photographique
    cible.add(roads);
    nightHooks.push(() => {});
  }

  // --------------------------------------------------------------------- bâtiments
  setProgress(0.8, 'Bâtiments et toits…');
  const wallGeo = new THREE.BufferGeometry();
  wallGeo.setAttribute('position', new THREE.BufferAttribute(arr('murs_pos'), 3));
  const attr = (nom, taille) => (estF16(meta, nom)
    ? new THREE.Float16BufferAttribute(arr(nom), taille)
    : new THREE.BufferAttribute(arr(nom), taille));
  wallGeo.setAttribute('aFac', attr('murs_fac', 4));
  wallGeo.setAttribute('aInfo', attr('murs_info', 4));
  wallGeo.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeo, facadeMaterial(THREE, night));
  walls.material.envMapIntensity = 0.6;
  walls.castShadow = walls.receiveShadow = true;
  cible.add(walls);

  const roofGeo = new THREE.BufferGeometry();
  roofGeo.setAttribute('position', new THREE.BufferAttribute(arr('toits_pos'), 3));
  roofGeo.setAttribute('aRoof', attr('toits_uv', 4));
  roofGeo.setAttribute('aTint', new THREE.BufferAttribute(arr('toits_teinte'), 3, true));
  roofGeo.computeVertexNormals();
  const roofs = new THREE.Mesh(roofGeo, roofMaterial(THREE));
  roofs.castShadow = roofs.receiveShadow = true;
  cible.add(roofs);

  // --------------------------------------------------------------------- eau, piscines, ponts, murs
  function colored(name, material, shadows = true) {
    const pos = arr(name + '_pos');
    if (!pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const rgb = arr(name + '_rgb');
    const col = new Float32Array(rgb.length);
    for (let k = 0; k < rgb.length; k++) col[k] = Math.pow(rgb[k] / 255, 2.2);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.castShadow = shadows;
    m.receiveShadow = true;
    cible.add(m);
    return m;
  }
  colored('eau', waterMaterial(THREE, false, clock), false);
  colored('piscines', waterMaterial(THREE, true, clock), false);
  const stone = stoneMaterial(THREE);
  colored('margelles', stone);
  const bridges = colored('ponts', stone);
  colored('soutenements', stone);

  // --------------------------------------------------------------------- arbres réels
  setProgress(0.88, 'Arbres…');
  // Densité du feuillage réglable à chaud (niveaux de qualité, `maps/qualite.js`) :
  // les cartes sont dessinées dans l'ordre où elles ont été tirées, on n'en
  // dessine que les n premières — `setDrawRange`, pas de reconstruction.
  let feuillage = null;
  {
    const data = arr('arbres'), rgb = arr('arbres_rgb');
    const count = data.length / 5;
    const leafTex = leafTexture();
    // houppier = cœur opaque sombre + nuée de touffes de feuilles (cartes détourées)
    const cores = [0, 1, 2].map((v) => lumpySphere(v));
    const cards = [0, 1, 2].map((v) => leafCards(v));
    feuillage = {
      max: CARTES,
      regler(n) {
        const k = Math.max(4, Math.min(CARTES, Math.round(n)));
        for (const g of cards) g.setDrawRange(0, k * 6);
      },
    };
    const coreMat = foliageMaterial(THREE);
    const leafMat = leafMaterial(THREE, leafTex);
    const leafDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex, alphaTest: 0.42 });
    const byVariant = [[], [], []];
    for (let k = 0; k < count; k++) byVariant[k % 3].push(k);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.55, 0.85, 1, 9);
    const trunks = new THREE.InstancedMesh(trunkGeo, barkMaterial(THREE), count);
    trunks.castShadow = true;
    const col = new THREE.Color(), dark = new THREE.Color();
    const hsl = {};
    byVariant.forEach((list, v) => {
      const core = new THREE.InstancedMesh(cores[v], coreMat, list.length);
      const leaves = new THREE.InstancedMesh(cards[v], leafMat, list.length);
      leaves.customDepthMaterial = leafDepth;
      core.castShadow = leaves.castShadow = true;
      core.receiveShadow = leaves.receiveShadow = true;
      list.forEach((k, n) => {
        const x = data[k * 5], y = data[k * 5 + 1], z = data[k * 5 + 2], h = data[k * 5 + 3], r = data[k * 5 + 4];
        const cypress = r < 0.3 * h && h > 5;
        const crownH = cypress ? h * 0.9 : Math.min(h * 0.7, r * 2.3);
        const rr = cypress ? Math.max(r * 0.9, h * 0.12) : r;
        q.setFromAxisAngle(up, (k * 2.399) % (Math.PI * 2));
        p.set(x, y + h - crownH / 2, z);
        s.set(rr, crownH / 2, rr);
        m4.compose(p, q, s);
        leaves.setMatrixAt(n, m4);
        s.multiplyScalar(0.8);
        core.setMatrixAt(n, m4.compose(p, q, s));
        // couleur réelle (orthophoto), recalée vers le vert : l'ombre bleuit les houppiers sur la photo
        col.setRGB(rgb[k * 3] / 255, rgb[k * 3 + 1] / 255, rgb[k * 3 + 2] / 255, THREE.SRGBColorSpace);
        col.getHSL(hsl);
        const hue = hsl.h > 0.36 && hsl.h < 0.7 ? THREE.MathUtils.lerp(hsl.h, 0.27, 0.6) : hsl.h;
        col.setHSL(hue, THREE.MathUtils.clamp(hsl.s * 1.35, 0.25, 0.6), THREE.MathUtils.clamp(hsl.l * 1.2, 0.13, 0.32));
        leaves.setColorAt(n, col);
        core.setColorAt(n, dark.copy(col).multiplyScalar(0.55));
        const th = Math.max(0.8, h - crownH * 0.75), tr = 0.08 + 0.02 * h;
        p.set(x, y + th / 2 - 0.2, z);
        s.set(tr, th, tr);
        trunks.setMatrixAt(k, m4.compose(p, q, s));
      });
      for (const inst of [core, leaves]) {
        inst.instanceMatrix.needsUpdate = true;
        inst.instanceColor.needsUpdate = true;
        inst.computeBoundingSphere();
        cible.add(inst);
      }
    });
    trunks.computeBoundingSphere();
    cible.add(trunks);
  }

  // --------------------------------------------------------------------- cheminées (détectées dans le LiDAR)
  {
    const ch = arr('cheminees');
    const count = ch.length / 7;
    if (count) {
      const body = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const cap = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ color: 0xd9c9ad, roughness: 0.95 }), count);
      const caps = new THREE.InstancedMesh(cap, new THREE.MeshStandardMaterial({ color: 0x9a4a30, roughness: 0.8 }), count);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      for (let k = 0; k < count; k++) {
        const [x, n, base, top, w, d, ang] = ch.subarray(k * 7, k * 7 + 7);
        q.setFromAxisAngle(up, ang);
        p.set(x, base, -n);
        s.set(w, Math.max(0.3, top - base - 0.12), d);
        bodies.setMatrixAt(k, m4.compose(p, q, s));
        p.set(x, top - 0.12, -n);
        s.set(w + 0.12, 0.12, d + 0.12);
        caps.setMatrixAt(k, m4.compose(p, q, s));
      }
      for (const m of [bodies, caps]) {
        m.castShadow = m.receiveShadow = true;
        m.computeBoundingSphere();
        cible.add(m);
      }
    }
  }

  // --------------------------------------------------------------------- lanternes (éclairage public)
  {
    const L = arr('lanternes');
    const count = L.length / 5;
    if (count) {
      const lantern = new THREE.CylinderGeometry(0.13, 0.09, 0.38, 6).translate(0, -0.12, 0);
      const bracket = new THREE.BoxGeometry(0.05, 0.05, 1).translate(0, 0, -0.5);
      const glass = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xffd49a, emissiveIntensity: 0, roughness: 0.4 });
      const iron = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.6, metalness: 0.4 });
      const heads = new THREE.InstancedMesh(lantern, glass, count);
      const arms = new THREE.InstancedMesh(bracket, iron, count);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      const glowPos = new Float32Array(count * 3);
      for (let k = 0; k < count; k++) {
        const [x, y, z, dx, dz] = L.subarray(k * 5, k * 5 + 5);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz));
        p.set(x + dx * 0.35, y, z + dz * 0.35);
        heads.setMatrixAt(k, m4.compose(p, q, one));
        arms.setMatrixAt(k, m4.compose(p.set(x + dx * 0.35, y + 0.07, z + dz * 0.35), q, one.set(1, 1, 0.55)));
        one.set(1, 1, 1);
        glowPos.set([x + dx * 0.35, y - 0.12, z + dz * 0.35], k * 3);
      }
      for (const m of [heads, arms]) { m.computeBoundingSphere(); cible.add(m); }
      // halo : sprites additifs, visibles seulement la nuit
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g2 = c.getContext('2d');
      const grd = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,230,190,1)');
      grd.addColorStop(0.25, 'rgba(255,190,110,.55)');
      grd.addColorStop(1, 'rgba(255,160,80,0)');
      g2.fillStyle = grd;
      g2.fillRect(0, 0, 64, 64);
      const halo = new THREE.Points(
        new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(glowPos, 3)),
        new THREE.PointsMaterial({ size: 2.6, map: new THREE.CanvasTexture(c), transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffc27a }),
      );
      halo.frustumCulled = false;
      cible.add(halo);
      nightHooks.push((on) => {
        glass.emissiveIntensity = on * 5;
        halo.material.opacity = on * 0.9;
        halo.visible = on > 0.02;
      });
    }
  }

  // --------------------------------------------------------------------- vignes (rangs réels)
  {
    const rows = arr('vignes');
    const count = rows.length / 6;
    if (count) {
      // haie de feuillage : de 0,45 à 1,35 m, 0,6 m d'épaisseur, déformée pour casser la boîte
      const g = new THREE.BoxGeometry(1, 0.9, 0.6, 8, 1, 1).translate(0.5, 0.9, 0);
      const mat = vineMaterial();
      const vines = new THREE.InstancedMesh(g, mat, count);
      const m4 = new THREE.Matrix4(), ax = new THREE.Vector3(), ay = new THREE.Vector3(0, 1, 0), az = new THREE.Vector3();
      for (let k = 0; k < count; k++) {
        const o = k * 6;
        ax.set(rows[o + 3] - rows[o], rows[o + 4] - rows[o + 1], rows[o + 5] - rows[o + 2]);
        az.set(-ax.z, 0, ax.x).normalize();
        m4.makeBasis(ax, ay, az).setPosition(rows[o], rows[o + 1], rows[o + 2]);
        vines.setMatrixAt(k, m4);
      }
      vines.castShadow = vines.receiveShadow = true;
      vines.computeBoundingSphere();
      cible.add(vines);
    }
  }

  /** Feuillage de vigne : touffes par cep (1 m), teintes de fin d'été, silhouette irrégulière. */
  function vineMaterial() {
    const mat = new THREE.MeshStandardMaterial({ color: 0x55702e, roughness: 0.85 });
    mat.onBeforeCompile = (sh) => {
      const noise = 'float vh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\n'
        + 'float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(vh(i),vh(i+vec2(1,0)),f.x),mix(vh(i+vec2(0,1)),vh(i+vec2(1,1)),f.x),f.y);}\n';
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\n${noise}varying vec3 vWPos; varying float vAlong; varying float vH;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
float L = length(instanceMatrix[0].xyz);
vAlong = position.x * L;
vH = position.y;
vec4 w0 = modelMatrix * instanceMatrix * vec4(position, 1.0);
float cep = 0.5 + 0.5 * cos(6.2831 * vAlong / 1.05);
float bulge = 0.65 + 0.45 * vn(w0.xz * 1.7) + 0.2 * cep;
transformed.z *= bulge;
transformed.y += (position.y > 1.3 ? 1.0 : 0.0) * (vn(w0.xz * 2.3) - 0.5) * 0.35;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\n${noise}varying vec3 vWPos; varying float vAlong; varying float vH;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float leaf = vn(vWPos.xz * 6.0 + vWPos.y * 5.0) * 0.6 + vn(vWPos.xz * 17.0 - vWPos.y * 11.0) * 0.4;
  float autumn = smoothstep(0.55, 0.85, vn(vWPos.xz * 0.05));
  vec3 green = pow(vec3(0.34, 0.45, 0.16), vec3(2.2));
  vec3 gold = pow(vec3(0.62, 0.55, 0.20), vec3(2.2));
  diffuseColor.rgb = mix(green, gold, autumn * 0.6) * (0.55 + 0.7 * leaf) * mix(0.6, 1.0, smoothstep(0.45, 1.1, vH));
}`);
    };
    mat.customProgramCacheKey = () => 'poilhes-vine';
    return mat;
  }

  /** Texture de touffe de feuilles (dessinée une fois, teintée ensuite par arbre). */
  /**
   * Ramille de feuillage : trois brindilles en éventail, une trentaine de folioles.
   *
   * L'ancienne texture remplissait tout le carré de taches vertes : chaque carte
   * devenait un aplat, et de près l'arbre ressemblait à un bouquet de papier.
   * Une ramille a une silhouette — c'est elle qui donne le grain du houppier,
   * puisque le reste du carré est transparent.
   */
  function leafTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    const foliole = (x, y, ang, L, teinte) => {
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.fillStyle = teinte;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(L * 0.35, -L * 0.34, L * 0.8, -L * 0.28, L, 0);
      g.bezierCurveTo(L * 0.8, L * 0.28, L * 0.35, L * 0.34, 0, 0);
      g.fill();
      // nervure : sans elle, la foliole est un pétale de plastique
      g.strokeStyle = 'rgba(30,50,24,0.35)';
      g.lineWidth = Math.max(0.8, L * 0.045);
      g.beginPath();
      g.moveTo(L * 0.05, 0);
      g.lineTo(L * 0.92, 0);
      g.stroke();
      g.restore();
    };

    for (let b = 0; b < 3; b++) {
      const base = 0.5 + (b - 1) * 0.28;          // les brindilles partent du bas du carré
      const cap = -Math.PI / 2 + (b - 1) * 0.42 + (rnd() - 0.5) * 0.2;
      let x = 128 + (base - 0.5) * 150, y = 248;
      const pas = 14 + rnd() * 4;
      g.strokeStyle = '#4c4131';
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(x, y);
      const pts = [];
      for (let k = 0; k < 13; k++) {
        const a = cap + Math.sin(k * 0.5 + b) * 0.09;
        x += Math.cos(a) * pas;
        y += Math.sin(a) * pas;
        pts.push([x, y, a]);
        g.lineTo(x, y);
      }
      g.stroke();
      pts.forEach(([px, py, a], k) => {
        const t = k / pts.length;
        const L = (34 - t * 14) * (0.8 + rnd() * 0.45);
        const clair = 26 + rnd() * 22 + t * 8;
        for (const cote of [-1, 1]) {
          const teinte = `hsl(${88 + rnd() * 26}, ${28 + rnd() * 22}%, ${clair}%)`;
          foliole(px, py, a + cote * (0.75 + rnd() * 0.5), L, teinte);
        }
      });
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  function leafCards(seed) {
    let st = 1234 + seed * 97;
    const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
    const CARDS = CARTES;             // plus nombreuses et plus petites qu'avant :
    // une carte de 2,5 m sur un platane, cela se voyait comme un drap vert
    const pos = [], nor = [], uv = [], idx = [], graine = [];
    const center = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), nrm = new THREE.Vector3();
    for (let k = 0; k < CARDS; k++) {
      // plutôt en périphérie du houppier
      const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, rad = 0.55 + 0.45 * Math.cbrt(rnd());
      center.set(Math.sqrt(1 - u * u) * Math.cos(th), u, Math.sqrt(1 - u * u) * Math.sin(th)).multiplyScalar(rad);
      nrm.copy(center).normalize();
      a.set(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).cross(nrm).normalize();
      b.copy(nrm).cross(a).normalize();
      const size = 0.24 + rnd() * 0.16;
      const g0 = rnd();                 // une graine par carte : teinte et orientation propres
      const base = pos.length / 3;
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(center.x + (a.x * sx + b.x * sy) * size, center.y + (a.y * sx + b.y * sy) * size, center.z + (a.z * sx + b.z * sy) * size);
        nor.push(nrm.x, nrm.y, nrm.z);
        uv.push((sx + 1) / 2, (sy + 1) / 2);
        graine.push(g0);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aGraine', new THREE.Float32BufferAttribute(graine, 1));
    g.setIndex(idx);
    return g;
  }

  /** Houppier : sphère bosselée, légèrement aplatie dessous (3 variantes). */
  function lumpySphere(seed) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      const n = Math.sin(v.x * 3.1 + seed * 1.7) * Math.sin(v.y * 2.7 + seed) * Math.sin(v.z * 3.3 + seed * 2.3);
      const n2 = Math.sin(v.x * 7.3 + seed * 3.1 + v.y * 5.1) * Math.sin(v.z * 6.7 - seed);
      v.multiplyScalar(1 + 0.2 * n + 0.07 * n2);
      if (v.y < 0) v.y *= 0.75;
      p.setXYZ(k, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    return g;
  }

  // --------------------------------------------------------------------- collisions (à pied)
  const coll = meta.collision;
  const bitsBuilt = arr('collision_bati'), bitsWater = arr('collision_eau');
  function blockedAt(x, z) {
    const c = Math.floor((x + H) / coll.px), r = Math.floor((z + H) / coll.px);
    if (c < 0 || r < 0 || c >= coll.taille || r >= coll.taille) return true;
    const i = r * coll.taille + c, mask = 128 >> (i & 7);
    return (bitsBuilt[i >> 3] & mask) !== 0 || (bitsWater[i >> 3] & mask) !== 0;
  }
  const rayDown = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 400);
  const rayOrigin = new THREE.Vector3();
  const hits = [];

  // ------------------------------------------------------------------- skatepark
  // Le circuit de trottinette, posé sur le terrain de sport quand le village en
  // a un. Il entre dans `walkableAt` et nulle part ailleurs : le village, le
  // moteur des Mondes et les pays interrogent tous cette fonction-là, donc tous
  // les trois roulent dessus sans qu'on ait touché à leur code.
  //
  // **Le parc ne se pose que là où l'on a mesuré.** Prendre le premier « Terrain
  // de sport » du relevé aurait suffi... jusqu'à Capestang, qui en compte sept,
  // dont un à 450 m du centre. Un parc de 52 × 56 m posé sans vérifier tombe à
  // cheval sur un talus ou sur des maisons. Un village absent de `PARCS` n'a
  // donc pas de skatepark, et c'est le bon comportement.
  let parc = null;
  if (PARCS[village]) {
    parc = construireSkatepark({ decor: { groundAt }, centre: PARCS[village] });
    cible.add(parc.root);
  }

  /** Sol praticable : terrain, béton du skatepark, ou tablier de pont s'il est au-dessus. */
  function walkableAt(x, z) {
    let y = groundAt(x, z);
    if (parc) {
      const p = parc.hauteurAt(x, z);
      if (p > y) y = p;
    }
    if (bridges) {
      rayOrigin.set(x, y + 30, z);
      rayDown.set(rayOrigin, rayDown.ray.direction);
      hits.length = 0;
      bridges.raycast(rayDown, hits);
      for (const h of hits) if (h.point.y > y && h.point.y < y + 25) y = h.point.y;
    }
    return y;
  }


  // --------------------------------------------------------------------- surfaces (toits, houppiers)
  const SURF = meta.surface;
  const surface = arr('surface');
  /** Altitude de la surface (toits, houppiers) au point (x, z), grille de 2 m. */
  function surfaceAt(x, z) {
    const c = Math.floor((x + H) / SURF.px), r = Math.floor((z + H) / SURF.px);
    if (c < 0 || r < 0 || c >= SURF.n || r >= SURF.n) return -1e9;
    return surface[r * SURF.n + c] / 10;
  }

  return {
    meta, arr, V, clock, loader, maxAniso, parc,
    groundAt, walkableAt, blockedAt, surfaceAt, setTime, setNight,
    sun, sunDir, skyU, hemi, sky, ambiance, root: cible, feuillage,
    // Murs et toits : ce qu'on interroge au rayon (devanture d'un commerce à
    // accrocher sur sa façade, fiche du bâtiment pointé en survol).
    murs: walls, toits: roofs,
    bounds: (meta.lointain && meta.lointain.demi_cote) || 3000,
    detail: (meta.zone && meta.zone.demi_cote) || 500,
  };
}
