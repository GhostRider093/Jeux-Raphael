/**
 * Le quad et son pilote — troisième engin de Poilhes City.
 *
 * Même recette que la trottinette (`trottinette.js`), pour les mêmes raisons :
 * un « quad avec son pilote » demandé d'un seul tenant à Meshy arrive soudé,
 * la tête tournée pour toujours, les roues prises dans le châssis. On assemble
 * donc ici deux modèles qui ne se connaissaient pas : le quad seul
 * (`perso/quad-seul`, 9,6 Mo ramenés à 900 Ko) et un pilote **riggé** qu'on
 * assoit par rotation d'os, mains au guidon.
 *
 * Ce que ce module ajoute par rapport à la trottinette :
 *  - **quatre roues** découpées dans le maillage, les deux de devant montées
 *    sur un pivot qui braque ;
 *  - **l'éclairage complet** voulu par Arnaud le 25/09/2026 (« un max
 *    d'éclairage ») : phares, barre à LED, feux arrière, feux stop, feux de
 *    recul, quatre clignotants — **allumés de jour comme de nuit** depuis le
 *    25/09/2026 (la nuit ajoute les faisceaux au sol). Tout est posé d'après la
 *    boîte englobante du modèle, rien n'est écrit en dur pour ce quad-là ;
 *  - un pilote qui **regarde où il tourne** (os de la tête) et penche un peu
 *    le buste dans le virage.
 *
 * Réglable depuis la console sans recharger :
 *
 *     RaphaelQuad.pose({ cuisse: [-1.3, 0, 0.1] })
 *     RaphaelQuad.placerPilote({ y: 0.72 })
 *     RaphaelQuad.feux            // l'état des feux
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';

const QUAD = 'assets/perso/quad.glb?v=2';
/**
 * Le pilote riggé : l'ado à casquette rouge, lunettes, veste noire à bandes
 * rouges (Meshy, A-pose, riggé Mixamo — `perso/pilote-quad-apose`, compressé).
 * `null` = quad seul.
 */
const PILOTE = 'assets/perso/pilote-quad.glb?v=2';
const PILOTES_POSSIBLES = {
  casquette: 'assets/perso/pilote-quad.glb?v=2',
  ado: 'assets/perso/pilote.glb?v=1',
};

const LONGUEUR = 1.85;         // longueur du quad (m) — c'est elle qui donne l'échelle
const TAILLE = 1.65;           // taille du pilote (m) — un ado sur un quad de taille adulte
const RAYON_PHYSIQUE = 0.26;   // le rayon que la physique utilise (`REGLAGES.quad.rayonRoue`)

/** Pose du pilote assis, en radians, par-dessus la pose de repos du squelette. */
export const POSE = {
  cuisse: [-1.25, 0.00, 0.18],       // hanches fléchies, genoux un peu écartés
  jambe: [1.15, 0.00, 0.00],         // genoux pliés, pieds sur les repose-pieds
  buste: [0.22, 0.00, 0.00],         // penché vers le guidon
  bras: [-0.90, 0.10, -1.10],        // valeurs de départ : les mains vont ensuite chercher les poignées
  avantBras: [-0.35, 0.00, 0.00],
  suiviTete: 0.75,                   // part du braquage que la tête suit (rad/rad)
  suiviBuste: 0.10,                  // roulis du buste dans le virage
};

/** Où se tient le pilote sur le quad (repère du quad, origine au sol sous son centre). */
export const PLACEMENT_DEFAUT = { x: 0, y: 0.72, z: 0.10, rx: 0, ry: 0, rz: 0, taille: TAILLE };
const PLACEMENTS_URL = new URL('quad-placement.json', import.meta.url);

async function placementEnregistre(modele) {
  try {
    const reponse = await fetch(PLACEMENTS_URL, { cache: 'no-store' });
    if (!reponse.ok) return null;
    const json = await reponse.json();
    const table = json && json.placements ? json.placements : {};
    const trouve = table[String(modele || '').split('?')[0]] || table.defaut;
    if (!trouve || typeof trouve !== 'object') return null;
    return { ...PLACEMENT_DEFAUT, ...trouve };
  } catch (err) {
    return null;
  }
}

/** Recopie les positions en flottants (un GLB meshopt arrive en entiers normalisés). */
function enFlottants(geo) {
  const a = geo.attributes.position;
  if (a.array instanceof Float32Array && !a.normalized) return a;
  const v = new THREE.Vector3();
  const sortie = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) {
    v.fromBufferAttribute(a, i);
    sortie[i * 3] = v.x; sortie[i * 3 + 1] = v.y; sortie[i * 3 + 2] = v.z;
  }
  const attr = new THREE.BufferAttribute(sortie, 3);
  geo.setAttribute('position', attr);
  return attr;
}

/** Boîte des sommets réellement affichés, squelette appliqué. */
function boiteSkin(model) {
  model.updateMatrixWorld(true);
  const boite = new THREE.Box3();
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) o.skeleton.update();
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 5) {
      if (o.isSkinnedMesh) o.getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      boite.expandByPoint(v.applyMatrix4(o.matrixWorld));
    }
  });
  return boite;
}

/**
 * Détache les quatre roues du châssis.
 *
 * Le modèle est d'un seul tenant. On repère chaque roue par son **empreinte au
 * sol** (les sommets qui touchent y = 0, groupés par quart : avant/arrière,
 * gauche/droite), on ajuste un cercle sur le bas du pneu dans son plan médian,
 * on mesure sa largeur sous l'essieu, puis on emporte les triangles dont les
 * trois sommets tombent dans ce cylindre. Le reste (bras de suspension, moyeux
 * côté châssis) reste au châssis : mieux vaut un anneau de gomme immobile qu'un
 * bout de bras qui tourne.
 *
 * @returns {object|null} { roues: [{ pivot, mesh, essieu }] ordre AVG, AVD, ARG, ARD ; rayon }
 */
function separerRoues(engin, hote) {
  engin.updateMatrixWorld(true);
  hote.updateMatrixWorld(true);
  let mesh = null;
  engin.traverse((o) => { if (o.isMesh && (!mesh || o.geometry.index)) mesh = o; });
  const echec = (raison, detail) => { console.warn('[quad] roues non détachées :', raison, detail || ''); return null; };
  if (!mesh || !mesh.geometry.index) return echec('pas de maillage indexé');

  const geo = mesh.geometry;
  const pos = enFlottants(geo);
  const versHote = new THREE.Matrix4().copy(hote.matrixWorld).invert().multiply(mesh.matrixWorld);
  const v = new THREE.Vector3();
  const pts = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(versHote);
    pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z;
  }

  // ── les empreintes au sol, par quart ─────────────────────────────────────
  const quarts = [[-1, -1], [1, -1], [-1, 1], [1, 1]];      // [signe x, signe z] : AVG, AVD, ARG, ARD
  const centres = quarts.map(() => ({ x: 0, z: 0, n: 0 }));
  for (let i = 0; i < pos.count; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    if (y > 0.02 || Math.abs(x) < 0.15 || Math.abs(z) < 0.15) continue;
    const q = (x < 0 ? 0 : 1) + (z < 0 ? 0 : 2);
    centres[q].x += x; centres[q].z += z; centres[q].n++;
  }
  if (centres.some((c) => c.n < 8)) return echec('empreintes au sol', centres.map((c) => c.n));
  for (const c of centres) { c.x /= c.n; c.z /= c.n; }
  // **Un essieu, deux roues identiques.** Le modèle est symétrique, mais son
  // maillage ne l'est pas : Meshy dessine les deux flancs avec des densités
  // différentes, et un ajustement fait roue par roue échouait d'un côté (0
  // triangle à droite au premier essai). On ajuste donc par essieu, sur les
  // sommets des deux roues repliés par |x|, et on applique des deux côtés.
  const essieuxAx = [0, 1].map((a) => ({
    ax: (Math.abs(centres[a * 2].x) + Math.abs(centres[a * 2 + 1].x)) / 2,
    z: (centres[a * 2].z + centres[a * 2 + 1].z) / 2,
  }));

  /** Ajustement de cercle (Kasa) sur le bas des deux pneus d'un essieu, dans leur plan médian |x| = ax. */
  function cercle(c) {
    let Sz = 0, Sy = 0, Szz = 0, Syy = 0, Szy = 0, Szzz = 0, Syyy = 0, Szyy = 0, Syzz = 0, m = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pts[i * 3]) - c.ax, y = pts[i * 3 + 1], z = pts[i * 3 + 2] - c.z;
      if (Math.abs(x) > 0.05 || y > 0.20 || Math.abs(z) > 0.32) continue;
      Sz += z; Sy += y; Szz += z * z; Syy += y * y; Szy += z * y;
      Szzz += z * z * z; Syyy += y * y * y; Szyy += z * y * y; Syzz += y * z * z; m++;
    }
    if (m < 40) return null;
    const A = [[Szz, Szy, Sz], [Szy, Syy, Sy], [Sz, Sy, m]];
    const B = [-(Szzz + Szyy), -(Syyy + Syzz), -(Szz + Syy)];
    const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
                     - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
                     + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const remplace = (M, col) => M.map((r, i) => r.map((x, j) => (j === col ? B[i] : x)));
    const d = det(A);
    if (Math.abs(d) < 1e-9) return null;
    const a1 = det(remplace(A, 0)) / d, b1 = det(remplace(A, 1)) / d, c1 = det(remplace(A, 2)) / d;
    const z0 = -a1 / 2, y0 = -b1 / 2;
    const r = Math.sqrt(Math.max(1e-6, z0 * z0 + y0 * y0 - c1));
    // L'essieu est à la hauteur du rayon : une roue posée touche le sol.
    return { ax: c.ax, z: c.z + z0, y: r, rayon: r };
  }
  const parEssieu = essieuxAx.map(cercle);
  if (parEssieu.some((e) => !e)) return echec('ajustement de cercle', essieuxAx);

  // demi-largeur du pneu, mesurée sous l'essieu, de part et d'autre du plan médian
  for (const e of parEssieu) {
    let large = 0;
    for (let i = 0; i < pos.count; i++) {
      const dx = Math.abs(pts[i * 3]) - e.ax, dy = pts[i * 3 + 1] - e.y, dz = pts[i * 3 + 2] - e.z;
      const r = Math.hypot(dy, dz);
      if (dy > -e.rayon * 0.4 || r < e.rayon * 0.7 || r > e.rayon * 1.02) continue;
      if (Math.abs(dx) > large) large = Math.abs(dx);
    }
    e.demi = large > 0.03 ? Math.min(large * 1.12, 0.22) : 0.10;
  }
  // AVG, AVD, ARG, ARD : le même essieu des deux côtés
  const essieux = [0, 1, 2, 3].map((k) => ({ ...parEssieu[k >> 1], x: (k & 1 ? 1 : -1) * parEssieu[k >> 1].ax }));

  // étiquetage des sommets : 0 châssis, 1..4 roues
  const marque = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    for (let e = 0; e < 4; e++) {
      const es = essieux[e];
      if (Math.abs(x - es.x) > es.demi) continue;
      if (Math.hypot(y - es.y, z - es.z) > es.rayon * 1.02) continue;
      marque[i] = e + 1;
      break;
    }
  }
  const idx = geo.index;
  const gardes = [];
  const parRoue = [[], [], [], []];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const m = marque[a];
    if (m !== 0 && marque[b] === m && marque[c] === m) parRoue[m - 1].push(a, b, c);
    else gardes.push(a, b, c);
  }
  if (parRoue.some((r) => r.length < 300)) return echec('trop peu de triangles', parRoue.map((r) => r.length / 3).concat(essieux));

  const roues = [];
  const nor = geo.attributes.normal, uv = geo.attributes.uv;
  for (let e = 0; e < 4; e++) {
    const tri = parRoue[e], es = essieux[e];
    const vus = new Map();
    const P = [], N = [], U = [], I = [];
    for (const vi of tri) {
      let n = vus.get(vi);
      if (n === undefined) {
        n = vus.size; vus.set(vi, n);
        // recentrés sur l'essieu : la roue tourne sur elle-même
        P.push(pts[vi * 3] - es.x, pts[vi * 3 + 1] - es.y, pts[vi * 3 + 2] - es.z);
        if (nor) { v.fromBufferAttribute(nor, vi).transformDirection(versHote); N.push(v.x, v.y, v.z); }
        if (uv) U.push(uv.getX(vi), uv.getY(vi));
      }
      I.push(n);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    if (N.length) g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    if (U.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex(I);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mesh.material);
    m.castShadow = true;
    // Le pivot braque (roues avant), la roue tourne dedans.
    const pivot = new THREE.Group();
    pivot.name = ['roue-avg', 'roue-avd', 'roue-arg', 'roue-ard'][e];
    pivot.position.set(es.x, es.y, es.z);
    pivot.add(m);
    hote.add(pivot);
    roues.push({ pivot, mesh: m, essieu: es, avant: e < 2 });
  }
  geo.setIndex(gardes);
  geo.computeBoundingSphere();
  const rayon = essieux.reduce((s, e) => s + e.rayon, 0) / 4;
  return { roues, rayon, essieux };
}

/** Texture de halo : un point lumineux qui se voit de loin, additif. */
function texHalo() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const d = g.createRadialGradient(32, 32, 0, 32, 32, 31);
  d.addColorStop(0, 'rgba(255,255,255,1)');
  d.addColorStop(0.25, 'rgba(255,248,225,.75)');
  d.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = d;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * L'éclairage du quad, posé d'après la forme du modèle.
 *
 * Le modèle Meshy n'a pas de feux : ses optiques sont peintes, donc éteintes.
 * On pose les nôtres là où la carrosserie s'arrête : le point le plus avancé à
 * hauteur de phare devant, le plus reculé derrière, mesurés sur les sommets.
 *
 * @returns {object} { setNuit, setFreinage, setRecul, setClignotant, animer, etat }
 */
function installerFeux(engin, hote) {
  engin.updateMatrixWorld(true);
  const boite = new THREE.Box3().setFromObject(engin);
  const largeur = boite.max.x - boite.min.x, hauteur = boite.max.y;
  const v = new THREE.Vector3();

  /** z extrême (min si `devant`) parmi les sommets d'une tranche de hauteur et de largeur. */
  function bord(devant, yMin, yMax, xMax) {
    let z = devant ? Infinity : -Infinity;
    engin.traverse((o) => {
      if (!o.isMesh) return;
      const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i += 2) {
        v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
        if (v.y < yMin || v.y > yMax || Math.abs(v.x) > xMax) continue;
        if (devant ? v.z < z : v.z > z) z = v.z;
      }
    });
    return Number.isFinite(z) ? z : (devant ? boite.min.z : boite.max.z);
  }
  const yPhare = hauteur * 0.58, yFeu = hauteur * 0.48;
  const nez = bord(true, yPhare - 0.08, yPhare + 0.08, largeur * 0.30);
  const poupe = bord(false, yFeu - 0.08, yFeu + 0.10, largeur * 0.30);
  const halo = texHalo();

  const matPhare = new THREE.MeshBasicMaterial({ color: 0xfff4d8, transparent: true, opacity: 0 });
  const matLed = new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.25 });
  const matFeu = new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0 });
  const matRecul = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
  const matCligno = [new THREE.MeshBasicMaterial({ color: 0xffa21f, transparent: true, opacity: 0 }),
                     new THREE.MeshBasicMaterial({ color: 0xffa21f, transparent: true, opacity: 0 })];   // gauche, droite
  const halos = [];
  const faisceaux = [];
  const sprite = (couleur, p, taille, role) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: halo, color: couleur, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.position.set(p[0], p[1], p[2]);
    sp.scale.setScalar(taille);
    sp.userData.role = role;
    hote.add(sp);
    halos.push(sp);
    return sp;
  };
  // Chaque optique a son **boîtier sombre** derrière la lentille : un feu rouge
  // posé sur un garde-boue rouge ne se voyait pas de jour (constat du 25/09/2026).
  const matBoitier = new THREE.MeshBasicMaterial({ color: 0x0e0e10 });
  const poser = (geom, mat, p, versAvant) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(p[0], p[1], p[2]);
    if (versAvant) m.rotation.y = Math.PI;
    hote.add(m);
    const boitier = new THREE.Mesh(geom.clone(), matBoitier);
    boitier.scale.set(1.28, 1.35, 1);
    boitier.position.set(p[0], p[1], p[2] + (versAvant ? 0.006 : -0.006));
    if (versAvant) boitier.rotation.y = Math.PI;
    hote.add(boitier);
    return m;
  };

  // ── devant : deux phares, une barre à LED, deux clignotants ──────────────
  for (const cote of [-1, 1]) {
    const x = cote * largeur * 0.19;
    poser(new THREE.CircleGeometry(0.062, 18), matPhare, [x, yPhare, nez - 0.015], true);
    sprite(0xfff0cc, [x, yPhare, nez - 0.05], 0.7, 'phare');
    const spot = new THREE.SpotLight(0xfff2d6, 0, 60, 0.50, 0.55, 1.1);
    spot.position.set(x, yPhare - 0.05, nez - 0.22);
    spot.target.position.set(cote * 0.8, -0.5, nez - 16);
    spot.castShadow = false;
    hote.add(spot); hote.add(spot.target);
    faisceaux.push(spot);
    // clignotant avant, au coin du garde-boue
    poser(new THREE.PlaneGeometry(0.075, 0.045), matCligno[cote < 0 ? 0 : 1], [cote * largeur * 0.40, yPhare - 0.06, nez + 0.02], true);
    sprite(0xffa21f, [cote * largeur * 0.40, yPhare - 0.06, nez - 0.01], 0.38, cote < 0 ? 'clignoG' : 'clignoD');
  }
  poser(new THREE.BoxGeometry(largeur * 0.34, 0.024, 0.02), matLed, [0, yPhare + 0.09, nez - 0.005], false);
  sprite(0xdff6ff, [0, yPhare + 0.09, nez - 0.04], 0.55, 'led');

  // ── derrière : deux feux rouges, un feu de recul, deux clignotants ────────
  for (const cote of [-1, 1]) {
    poser(new THREE.PlaneGeometry(0.17, 0.075), matFeu, [cote * largeur * 0.22, yFeu, poupe + 0.015], false);
    sprite(0xff2a14, [cote * largeur * 0.22, yFeu, poupe + 0.05], 0.5, 'arriere');
    poser(new THREE.PlaneGeometry(0.075, 0.045), matCligno[cote < 0 ? 0 : 1], [cote * largeur * 0.40, yFeu, poupe - 0.02], false);
    sprite(0xffa21f, [cote * largeur * 0.40, yFeu, poupe + 0.02], 0.38, cote < 0 ? 'clignoG' : 'clignoD');
  }
  poser(new THREE.PlaneGeometry(0.10, 0.05), matRecul, [0, yFeu - 0.03, poupe + 0.015], false);
  sprite(0xffffff, [0, yFeu - 0.03, poupe + 0.05], 0.38, 'recul');

  const etat = { nuit: false, freinage: false, recul: false, clignotant: 0, allume: false };
  const opac = (role, o) => { for (const h of halos) if (h.userData.role === role) h.material.opacity = o; };

  function peindre() {
    const { nuit, freinage, recul, clignotant, allume } = etat;
    // **Tout allumé, de jour comme de nuit** (Arnaud, 25/09/2026 : « faut lui
    // mettre des feux, feu arrière, feu de recul, phare »). Le jour, les
    // optiques sont allumées et se voient ; la nuit s'ajoutent les faisceaux
    // sur la route et des halos plus francs.
    matPhare.opacity = 1;
    for (const s of faisceaux) s.intensity = nuit ? 80 : 0;
    opac('phare', nuit ? 0.55 : 0.35);
    // La barre à LED : feu de jour, pleine puissance la nuit.
    matLed.opacity = 1;
    opac('led', nuit ? 0.6 : 0.25);
    // Feux arrière toujours allumés ; feux stop : au freinage, plus francs.
    matFeu.opacity = freinage ? 1 : (nuit ? 0.7 : 0.8);
    opac('arriere', freinage ? 0.85 : (nuit ? 0.35 : 0.22));
    matRecul.opacity = recul ? 0.95 : 0;
    opac('recul', recul ? 0.7 : 0);
    // Clignotants : -1 gauche, 1 droite, 2 les deux (détresse).
    const g = allume && (clignotant === -1 || clignotant === 2);
    const d = allume && (clignotant === 1 || clignotant === 2);
    matCligno[0].opacity = g ? 0.95 : 0; opac('clignoG', g ? 0.75 : 0);
    matCligno[1].opacity = d ? 0.95 : 0; opac('clignoD', d ? 0.75 : 0);
  }
  peindre();

  return {
    etat,
    setNuit(a) { if (etat.nuit !== !!a) { etat.nuit = !!a; peindre(); } },
    setFreinage(a) { if (etat.freinage !== !!a) { etat.freinage = !!a; peindre(); } },
    setRecul(a) { if (etat.recul !== !!a) { etat.recul = !!a; peindre(); } },
    setClignotant(s) { s = s | 0; if (etat.clignotant !== s) { etat.clignotant = s; peindre(); } },
    /** À chaque image : le clignotement (1,4 Hz, comme un vrai relais). */
    animer(t) {
      const allume = etat.clignotant !== 0 && (t * 1.4) % 1 < 0.5;
      if (allume !== etat.allume) { etat.allume = allume; peindre(); }
    },
  };
}

/**
 * Construit l'ensemble quad + pilote.
 *
 * @param {object} o { scene, x, z, cap, decor, pilote }
 * @returns {Promise<object>} { root, engin, roues, feux, pose, placerPilote, ... }
 */
export async function construireQuad({ scene, x = 0, z = 0, cap = 0, decor = null, pilote } = {}) {
  const root = new THREE.Group();
  root.name = 'quad';
  root.position.set(x, decor ? decor.groundAt(x, z) : 0, z);
  root.rotation.y = cap;
  scene.add(root);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const modelePilote = pilote === undefined ? PILOTE : (PILOTES_POSSIBLES[pilote] || pilote);
  const [gQuad, gPilote] = await Promise.all([
    loader.loadAsync(QUAD),
    modelePilote ? loader.loadAsync(modelePilote).catch((err) => { console.warn('Pilote du quad indisponible', err); return null; }) : Promise.resolve(null),
  ]);

  // ── le quad ──────────────────────────────────────────────────────────────
  const engin = gQuad.scene;
  // Le modèle a son guidon vers −x (mesuré : les sommets les plus hauts sont à
  // x ≈ −0,28) ; l'avant du jeu est −z. Un quart de tour.
  engin.rotation.y = -Math.PI / 2;
  engin.updateMatrixWorld(true);
  let boite = new THREE.Box3().setFromObject(engin);
  const echelle = LONGUEUR / (boite.max.z - boite.min.z);
  engin.scale.setScalar(echelle);
  engin.updateMatrixWorld(true);
  boite = new THREE.Box3().setFromObject(engin);
  const centre = boite.getCenter(new THREE.Vector3());
  engin.position.set(-centre.x, -boite.min.y, -centre.z);
  engin.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    // Meshy cuit metalness = 1 : sans cela, le quad devient un miroir.
    if (o.material) { o.material.metalness = 0.30; o.material.roughness = 0.45; }
  });
  root.add(engin);
  engin.updateMatrixWorld(true);
  boite = new THREE.Box3().setFromObject(engin);
  const dimensions = {
    longueur: boite.max.z - boite.min.z, largeur: boite.max.x - boite.min.x, hauteur: boite.max.y,
  };

  const rouage = separerRoues(engin, root);
  if (rouage) {
    const es = rouage.essieux;
    dimensions.empattement = (es[2].z + es[3].z - es[0].z - es[1].z) / 2;
    dimensions.voie = (es[1].x + es[3].x - es[0].x - es[2].x) / 2;
    dimensions.rayonRoue = rouage.rayon;
  }
  const feux = installerFeux(engin, root);

  // ── les poignées : les sommets les plus hauts du quad, à leurs extrêmes en largeur
  const poignees = (() => {
    const haut = boite.max.y;
    const v = new THREE.Vector3();
    let gy = 0, gz = 0, n = 0, xg = 0, xd = 0;
    engin.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y < haut - 0.10) continue;
        gy += v.y; gz += v.z; n++;
        if (v.x < xg) xg = v.x;
        if (v.x > xd) xd = v.x;
      }
    });
    if (!n) return null;
    return { y: gy / n, z: gz / n, demi: Math.max(0.20, (xd - xg) / 2 - 0.04) };
  })();

  // ── la selle : le haut de la carrosserie dans l'axe, derrière le guidon ──
  const selle = (() => {
    const v = new THREE.Vector3();
    let y = 0, n = 0;
    engin.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (Math.abs(v.x) > 0.08 || v.z < 0.05 || v.z > 0.45) continue;
        if (v.y > y - 0.03) { y = Math.max(y, v.y); n++; }
      }
    });
    return n ? { y, z: 0.25 } : null;
  })();

  const base = {
    root, engin, feux, poignees, selle, dimensions, pilote: null, os: {}, membres: {},
    roues: rouage ? rouage.roues : [],
    rayonRoue: rouage ? rouage.rayon : RAYON_PHYSIQUE,
    rapportRoue: rouage ? RAYON_PHYSIQUE / rouage.rayon : 1,
    pose: () => POSE,
    reglages: () => JSON.parse(JSON.stringify(POSE)),
    animer() {},
    placer: (nx, nz, ncap = root.rotation.y) => {
      root.position.set(nx, decor ? decor.groundAt(nx, nz) : 0, nz);
      root.rotation.y = ncap;
    },
  };
  if (!gPilote) { window.RaphaelQuad = base; return base; }

  // ── le pilote ────────────────────────────────────────────────────────────
  const bonhomme = gPilote.scene;
  bonhomme.rotation.y = Math.PI;                 // le modèle regarde +z, l'avant du jeu est −z
  bonhomme.updateMatrixWorld(true);
  const bp = boiteSkin(bonhomme);
  bonhomme.scale.setScalar(TAILLE / (bp.max.y - bp.min.y));
  bonhomme.updateMatrixWorld(true);
  const bp2 = boiteSkin(bonhomme);
  const centrePilote = bp2.getCenter(new THREE.Vector3());
  bonhomme.position.set(-centrePilote.x, -bp2.min.y, -centrePilote.z);
  const socle = new THREE.Group();
  socle.name = 'pilote';
  socle.add(bonhomme);
  bonhomme.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;      // un squelette posé loin du repos garde sa vieille sphère englobante
    if (o.material && o.material.metalness > 0.6) { o.material.metalness = 0.2; o.material.roughness = 0.6; }
  });
  root.add(socle);

  const PLACEMENT = { ...PLACEMENT_DEFAUT };
  function placerPilote(modif = {}) {
    Object.assign(PLACEMENT, modif);
    socle.position.set(PLACEMENT.x, PLACEMENT.y, PLACEMENT.z);
    socle.rotation.set(PLACEMENT.rx, PLACEMENT.ry, PLACEMENT.rz);
    socle.scale.setScalar(PLACEMENT.taille / TAILLE);
    socle.updateMatrixWorld(true);
    return { ...PLACEMENT };
  }
  placerPilote();

  const os = {};
  bonhomme.traverse((o) => {
    if (!o.isBone) return;
    os[o.name] = o;
    o.userData.repos = o.quaternion.clone();     // la pose de repos, dont on part toujours
  });
  function trouver(motif, cote) {
    const droite = cote === 'd';
    const marques = droite ? [/right/i, /_r$/i, /\.r$/i, /_r_/i] : [/left/i, /_l$/i, /\.l$/i, /_l_/i];
    let simple = null;
    for (const nom of Object.keys(os)) {
      if (!motif.test(nom)) continue;
      if (marques.some((m) => m.test(nom))) return os[nom];
      if (!simple) simple = os[nom];
    }
    return simple;
  }
  const membres = {
    // Le bras (humérus), pas l'épaule (clavicule) : `RightArm` et non `RightShoulder`.
    brasD: trouver(/(upperarm|upper_arm|(^|[^e])arm$)/i, 'd') || trouver(/shoulder/i, 'd'),
    brasG: trouver(/(upperarm|upper_arm|(^|[^e])arm$)/i, 'g') || trouver(/shoulder/i, 'g'),
    avantD: trouver(/(lowerarm|forearm|lower_arm|elbow)/i, 'd'),
    avantG: trouver(/(lowerarm|forearm|lower_arm|elbow)/i, 'g'),
    mainD: trouver(/hand(?!.*(thumb|index|middle|ring|pinky))/i, 'd'),
    mainG: trouver(/hand(?!.*(thumb|index|middle|ring|pinky))/i, 'g'),
    buste: trouver(/(spine_?0?2|spine_?0?1|spine|chest)/i, 'd'),
    tete: trouver(/^head$/i, 'd') || trouver(/^(?!.*(top|end|front)).*head/i, 'd'),
    cuisseD: trouver(/(thigh|upleg|upper_?leg)/i, 'd'),
    cuisseG: trouver(/(thigh|upleg|upper_?leg)/i, 'g'),
    jambeD: trouver(/(calf|shin|lowerleg|lower_leg|(?<!up)leg$)/i, 'd'),
    jambeG: trouver(/(calf|shin|lowerleg|lower_leg|(?<!up)leg$)/i, 'g'),
    hanches: trouver(/(hips|pelvis)/i, 'd'),
  };

  // **Assis, c'est le bassin qui compte.** L'origine du socle est sous les pieds
  // du pilote debout ; sur une selle, ce sont ses hanches qu'on pose. On mesure
  // donc, en pose de repos, la hauteur des hanches au-dessus des pieds, et on
  // descend le socle d'autant sous la selle.
  const hanchesRepos = new THREE.Vector3();
  if (membres.hanches) {
    socle.updateMatrixWorld(true);
    membres.hanches.getWorldPosition(hanchesRepos);
    socle.worldToLocal(hanchesRepos);
  } else hanchesRepos.set(0, TAILLE * 0.52, 0);
  if (selle) {
    PLACEMENT.y = selle.y + 0.02 - hanchesRepos.y;
    PLACEMENT.z = selle.z - hanchesRepos.z;
  }
  placerPilote();

  const tampon = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const mettre = (b, r, miroir = false) => {
    if (!b) return;
    euler.set(r[0], miroir ? -r[1] : r[1], miroir ? -r[2] : r[2]);
    tampon.setFromEuler(euler);
    b.quaternion.copy(b.userData.repos).multiply(tampon);
  };
  /** Applique la pose assise par-dessus la pose de repos. */
  function pose(modif = {}) {
    Object.assign(POSE, modif);
    mettre(membres.cuisseD, POSE.cuisse);
    mettre(membres.cuisseG, POSE.cuisse, true);
    mettre(membres.jambeD, POSE.jambe);
    mettre(membres.jambeG, POSE.jambe, true);
    mettre(membres.buste, POSE.buste);
    mettre(membres.bras, POSE.bras);
    mettre(membres.brasD, POSE.bras);
    mettre(membres.brasG, POSE.bras, true);
    mettre(membres.avantD, POSE.avantBras);
    mettre(membres.avantG, POSE.avantBras, true);
    socle.updateMatrixWorld(true);
    return POSE;
  }

  // Les mains vont chercher les poignées : on tourne l'os pour que le segment
  // os → enfant pointe vers la cible (même mécanique que la trottinette).
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const cible = new THREE.Vector3();
  function viserUnBras(bras, avant, main, cote) {
    if (!bras || !avant || !main || !poignees) return null;
    cible.set(cote * poignees.demi, poignees.y, poignees.z);
    root.localToWorld(cible);
    for (const [b, enfant] of [[bras, avant], [avant, main]]) {
      b.updateMatrixWorld(true);
      enfant.getWorldPosition(v1);
      b.getWorldPosition(v2);
      v3.subVectors(v1, v2);
      if (v3.lengthSq() < 1e-6) continue;
      v3.normalize();
      qa.setFromUnitVectors(v3, cible.clone().sub(v2).normalize());
      b.getWorldQuaternion(qb);
      qc.copy(qa).multiply(qb);
      b.parent.getWorldQuaternion(qb).invert();
      qc.premultiply(qb);
      b.quaternion.copy(qc);
      b.updateMatrixWorld(true);
    }
    main.getWorldPosition(v1);
    return v1.distanceTo(cible);
  }
  /** Longueur du bras (épaule → coude → poignet), en mètres monde. */
  function longueurBras(bras, avant, main) {
    if (!bras || !avant || !main) return 0.55;
    bras.getWorldPosition(v1); avant.getWorldPosition(v2); main.getWorldPosition(v3);
    return v1.distanceTo(v2) + v2.distanceTo(v3);
  }
  function viserGuidon() {
    if (!poignees) return null;
    let reste = 0;
    // Le pilote glisse sur la selle jusqu'à ce que l'épaule soit à un bras
    // (légèrement fléchi) de la poignée : trop près il recule, trop loin il
    // avance. Sur une selle, c'est le cas « trop près » qui arrive.
    for (let passe = 0; passe < 3; passe++) {
      pose();
      if (!membres.brasD) break;
      const L = longueurBras(membres.brasD, membres.avantD, membres.mainD);
      membres.brasD.getWorldPosition(v2);
      cible.set(poignees.demi, poignees.y, poignees.z);
      root.localToWorld(cible);
      const ecart = v2.distanceTo(cible) - L * 0.92;
      if (Math.abs(ecart) < 0.015) break;
      socle.position.z -= ecart * 0.8;
      PLACEMENT.z = socle.position.z;
      socle.updateMatrixWorld(true);
    }
    {
      const d = viserUnBras(membres.brasD, membres.avantD, membres.mainD, 1);
      const g = viserUnBras(membres.brasG, membres.avantG, membres.mainG, -1);
      reste = Math.max(d || 0, g || 0);
    }
    // Les bras visés, on mémorise leur quaternion comme nouvelle base : le
    // suivi de la tête et du buste se pose par-dessus sans les défaire.
    for (const b of [membres.brasD, membres.brasG, membres.avantD, membres.avantG]) if (b) b.userData.vise = b.quaternion.clone();
    return reste;
  }
  const enregistre = await placementEnregistre(modelePilote);
  if (enregistre) placerPilote(enregistre);
  viserGuidon();
  if (membres.buste) membres.buste.userData.vise = membres.buste.quaternion.clone();

  /** Le pilote suit le volant : la tête regarde où l'on va, le buste penche un peu. */
  const eulerSuivi = new THREE.Euler();
  function animer(braquage) {
    if (membres.tete) {
      eulerSuivi.set(0, braquage * POSE.suiviTete, 0);
      tampon.setFromEuler(eulerSuivi);
      membres.tete.quaternion.copy(membres.tete.userData.repos).multiply(tampon);
    }
    if (membres.buste && membres.buste.userData.vise) {
      eulerSuivi.set(0, braquage * POSE.suiviBuste * 0.5, -braquage * POSE.suiviBuste);
      tampon.setFromEuler(eulerSuivi);
      membres.buste.quaternion.copy(membres.buste.userData.vise).multiply(tampon);
    }
  }

  const api = {
    ...base, pilote: bonhomme, socle, os, membres, pose, viserGuidon, placerPilote, animer,
    placement: () => ({ ...PLACEMENT }),
    /** Ce qu'on ne juge pas à l'œil, dans le repère du quad (origine au sol sous son centre). */
    mesures: () => {
      socle.updateMatrixWorld(true);
      const b = boiteSkin(socle);
      const local = (o) => { if (!o) return null; const p = o.getWorldPosition(new THREE.Vector3()); root.worldToLocal(p); return [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]; };
      const bas = b.min.clone(), haut = b.max.clone();
      root.worldToLocal(bas); root.worldToLocal(haut);
      return { pieds: +bas.y.toFixed(3), tete: +haut.y.toFixed(3), selle, poignees, hanchesRepos: hanchesRepos.toArray().map((x) => +x.toFixed(3)),
               hanches: local(membres.hanches), genouD: local(membres.jambeD), piedD: local(os.RightFoot || null), mainD: local(membres.mainD), tete2: local(membres.tete) };
    },
  };
  window.RaphaelQuad = api;
  return api;
}

/**
 * Le quad **conduisible**, présenté comme une voiture à `voiture-pilote.js` :
 * `root`, `caisse` qui se penche, `ombre` de contact, `majRoues`, les feux.
 *
 * @returns {object} l'API attendue par le pilote
 */
export function construireEnginQuad({ renderer = null, pilote } = {}) {
  const root = new THREE.Group();
  root.name = 'engin-quad';
  const caisse = new THREE.Group();
  root.add(caisse);

  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  rad.addColorStop(0, 'rgba(0,0,0,.5)');
  rad.addColorStop(0.55, 'rgba(0,0,0,.24)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 64, 64);
  const ombre = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 2.4),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.8 }),
  );
  ombre.rotation.x = -Math.PI / 2;
  ombre.renderOrder = 2;

  let kit = null, rapportRoue = 1;
  const enAttente = { nuit: false, freinage: false, recul: false, clignotant: 0 };
  const pret = construireQuad({ scene: caisse, x: 0, z: 0, cap: 0, pilote })
    .then((k) => {
      kit = k; rapportRoue = k.rapportRoue;
      k.feux.setNuit(enAttente.nuit);
      return { engin: k, roues: k.roues.map((r) => r.mesh) };
    })
    .catch((err) => { console.warn('Quad indisponible', err); return null; });

  const dimensions = { longueur: 1.85, largeur: 1.23, empattement: 1.23, rayonRoue: RAYON_PHYSIQUE };

  return {
    root, caisse, ombre, roues: [], pret, dimensions,
    /**
     * Les roues tournent, les deux de devant braquent, chacune suit le sol
     * (débattement, en mètres, ordre AVG AVD ARG ARD). Le clignotement des
     * feux et le suivi de la tête du pilote passent par ici aussi : c'est le
     * seul appel que le pilote fait à chaque image.
     */
    majRoues(braquage, rotation, debattement) {
      if (!kit) return;
      const roues = kit.roues;
      for (let i = 0; i < roues.length; i++) {
        const r = roues[i];
        r.mesh.rotation.x = -rotation * rapportRoue;
        if (r.avant) r.pivot.rotation.y = braquage;
        if (debattement) r.pivot.position.y = r.essieu.y + debattement[i];
      }
      kit.feux.animer(performance.now() / 1000);
      kit.animer(braquage);
    },
    setFreinage(a) { if (kit) kit.feux.setFreinage(a); else enAttente.freinage = a; },
    setRecul(a) { if (kit) kit.feux.setRecul(a); else enAttente.recul = a; },
    setNuit(a) { if (kit) kit.feux.setNuit(a); else enAttente.nuit = a; },
    /** -1 gauche, 1 droite, 2 détresse, 0 rien. */
    setClignotant(s) { if (kit) kit.feux.setClignotant(s); else enAttente.clignotant = s; },
    setTeinte() { return 'quad'; },
    setCouleur() {},
    materiaux: {},
  };
}
