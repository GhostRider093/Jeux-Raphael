/**
 * La trottinette et son pilote.
 *
 * Deux modèles qui ne se connaissaient pas : la trottinette (Meshy, 33 Mo
 * ramenés à 622 Ko) et l'humain **riggé** déjà présent dans le jeu
 * (`perso/Meshy_AI_Pinstripe_Shadows`, celui du mode au sol des Mondes).
 *
 * Pourquoi ne pas avoir demandé un « bonhomme sur une trottinette » d'un seul
 * tenant : un tel modèle arrive soudé, sans squelette. Il ne peut ni se
 * pencher, ni tourner le guidon, ni descendre, et ses roues ne tournent pas.
 * En les assemblant ici, le pilote garde ses os — donc ses animations — et la
 * trottinette garde sa géométrie propre.
 *
 * La pose n'est pas une animation : c'est une rotation d'os, appliquée une fois
 * sur la pose de repos (mains au guidon, buste penché, jambes décalées sur le
 * plateau). Elle se règle depuis la console sans recharger :
 *
 *     RaphaelTrottinette.pose({ bras: [-1.2, 0, -1.3], buste: [0.2, 0, 0] })
 *     RaphaelTrottinette.reglages()
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';

const TROTTINETTE = 'assets/perso/trottinette.glb?v=1';
// Le pilote. `null` = trottinette seule.
//
// **Attention au modèle « Pinstripe Shadows »** : ce n'est pas un personnage
// mais un DUO — deux hommes en costume dans un seul maillage peau, partageant
// vingt os. Il fait très bien l'affaire comme figurant du mode au sol des
// Mondes, mais monté sur une trottinette, ils s'y tiennent à deux. Tant qu'on
// n'a pas un humain riggé seul, la trottinette reste garée sans personne.
const PILOTE = 'assets/perso/pilote.glb?v=1';
const PILOTES_POSSIBLES = {
  ado: 'assets/perso/pilote.glb?v=1',
  costume: 'perso/Meshy_AI_Pinstripe_Shadows/Meshy_AI_Pinstripe_Shadows_rigged_animations.glb',  // duo !
  chevalier: 'assets/knight/knight.glb',
  titan: 'perso/Meshy_AI_Azure_Titan_biped/Meshy_AI_Azure_Titan_biped_Meshy_AI_Meshy_Merged_Animations.glb',
};

const GUIDON = 1.02;        // hauteur du guidon au-dessus du sol (m) — c'est elle qui donne l'échelle
const TAILLE = 1.74;        // taille du pilote (m)
const PLATEAU = 0.15;       // hauteur du plateau où il pose les pieds (m)
const GUIDON_LARGEUR = 0.58;   // largeur du guidon une fois rétréci (m) — mesure d'une vraie trottinette
const RAYON_PHYSIQUE = 0.13;   // le rayon que la physique utilise (`REGLAGES.trottinette.rayonRoue`)

/** Pose du pilote, en radians. Réglable en jeu (voir l'en-tête). */
export const POSE = {
  bras: [-1.05, 0.15, -1.30],        // épaules : bras ramenés devant, vers le guidon
  avantBras: [-0.40, 0.00, 0.00],    // coudes à peine fléchis
  buste: [0.16, 0.00, 0.00],         // léger penché vers l'avant
  jambeAvant: [-0.10, 0.00, 0.03],   // pied avant sur le plateau
  jambeArriere: [0.12, 0.00, -0.03], // pied arrière en retrait
  recul: -0.18,                      // position du pilote sur le plateau (m, + vers l'avant)
};

/**
 * **Où se tient le pilote sur l'engin.** C'est ce que l'outil
 * `placer-pilote.html` écrit, et que le jeu relit tel quel.
 *
 * Le repère est fait pour être lu : l'origine est au sol, au milieu de
 * l'engin, l'avant est −z, et `y` est la hauteur des **semelles**. `y: 0.15`
 * veut donc dire « debout sur le plateau », `z: 0.06` « six centimètres
 * derrière le milieu ». C'est tout l'intérêt du socle (plus bas) : sans lui on
 * réglerait l'origine que l'exportateur a bien voulu donner au GLB — souvent
 * le bassin, parfois rien de repérable — et aucun de ces chiffres ne voudrait
 * dire quoi que ce soit.
 */
export const PLACEMENT_DEFAUT = { x: 0, y: PLATEAU, z: 0.06, rx: 0, ry: 0, rz: 0, taille: TAILLE };

/** Le fichier que l'outil enregistre : un placement par modèle de pilote. */
const PLACEMENTS_URL = new URL('trottinette-placement.json', import.meta.url);

/**
 * Le placement réglé à la main pour ce modèle, s'il en existe un.
 *
 * Deux modèles n'ont ni la même taille, ni le même bassin, ni la même pose de
 * repos : le réglage est donc rangé **par chemin de GLB**, estampille `?v=`
 * retirée pour que la clé survive au prochain vidage de cache.
 */
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
    return null;          // pas de fichier, pas de réglage : on retombe sur l'automatique
  }
}

/**
 * Recopie les positions en **flottants**.
 *
 * Un GLB compressé meshopt arrive en entiers courts normalisés, la vraie
 * échelle vivant dans la matrice du nœud. On ne peut donc ni y écrire une
 * coordonnée en mètres, ni la lire sans passer par cette matrice. Même piège
 * que pour la voiture (`enFlottants` dans `voiture-model.js`) : toute
 * modification de sommets commence ici.
 */
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

/**
 * Rétrécit le guidon, qui sort du modèle à **1,12 m de large** — deux fois la
 * largeur d'une vraie trottinette, et près du double de l'engin lui-même.
 *
 * On ne met pas simplement le guidon à l'échelle : les poignées deviendraient
 * des moignons de cinq centimètres sous des mains qui en font neuf. La barre
 * est donc **comprimée** entre la potence et les poignées, et les poignées,
 * elles, sont **déplacées** vers l'intérieur sans changer de taille. Le tube
 * ayant son axe sur x, le raccourcir ne déforme pas sa section : les normales
 * restent bonnes, il n'y a rien à recalculer.
 *
 * Rien n'est écrit en dur : la largeur de départ, la hauteur de la barre et le
 * début des poignées sont mesurés sur le maillage.
 *
 * **Tout se mesure dans le repère de l'engin, jamais dans celui du monde.**
 * Le GLB finit de charger quand le véhicule est déjà garé quelque part : en
 * coordonnées du monde, `|x|` ne vaut plus la demi-largeur du guidon mais la
 * distance à l'origine de la carte. Mesuré à 22 m du centre, la barre partait
 * à 150 m — un long fil tendu entre la trottinette et l'horizon, et des mains
 * qui ne tenaient plus rien. C'est le même choix que pour les roues.
 *
 * @returns {object|null} ce qui a été mesuré, ou null si le guidon est déjà fin
 */
function affinerGuidon(engin, repere, largeurVoulue = GUIDON_LARGEUR) {
  engin.updateMatrixWorld(true);
  repere.updateMatrixWorld(true);
  const maillages = [];
  engin.traverse((o) => { if (o.isMesh) maillages.push(o); });
  if (!maillages.length) return null;

  const versRepere = new THREE.Matrix4();
  const versMaillage = new THREE.Matrix4();
  const cadre = (m) => versRepere.copy(repere.matrixWorld).invert().multiply(m.matrixWorld);

  const v = new THREE.Vector3();
  let haut = -Infinity;
  for (const m of maillages) {
    const a = m.geometry.attributes.position;
    const T = cadre(m).clone();
    for (let i = 0; i < a.count; i++) {
      const y = v.fromBufferAttribute(a, i).applyMatrix4(T).y;
      if (y > haut) haut = y;
    }
  }
  // La barre et ses poignées tiennent dans les seize derniers centimètres ; la
  // potence qui monte en dessous est trop fine pour être concernée.
  const seuil = haut - 0.16;
  let demi = 0;
  for (const m of maillages) {
    const a = m.geometry.attributes.position;
    const T = cadre(m).clone();
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(T);
      if (v.y > seuil && Math.abs(v.x) > demi) demi = Math.abs(v.x);
    }
  }
  const cible = largeurVoulue / 2;
  if (demi <= cible + 0.01) return null;

  const noyau = demi * 0.18;          // potence, compteur, colliers : on n'y touche pas
  const xg = demi * 0.80;             // au-delà, ce sont les poignées
  const poignee = demi - xg;
  const finBarre = cible - poignee;   // où la poignée commence, une fois rapprochée
  const k = (finBarre - noyau) / (xg - noyau);

  for (const m of maillages) {
    const a = enFlottants(m.geometry);
    const T = cadre(m).clone();
    versMaillage.copy(T).invert();
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(T);
      if (v.y <= seuil) continue;
      const ax = Math.abs(v.x);
      if (ax <= noyau) continue;
      const signe = v.x < 0 ? -1 : 1;
      v.x = ax <= xg
        ? signe * (noyau + (ax - noyau) * k)          // la barre se comprime
        : signe * (finBarre + (ax - xg));             // la poignée se déplace, entière
      v.applyMatrix4(versMaillage);
      a.setXYZ(i, v.x, v.y, v.z);
    }
    a.needsUpdate = true;
    m.geometry.computeBoundingBox();
    m.geometry.computeBoundingSphere();
  }
  return { avant: +(demi * 2).toFixed(3), apres: +(cible * 2).toFixed(3), poignee: +poignee.toFixed(3) };
}

/**
 * Détache les deux roues du châssis pour qu'elles puissent tourner.
 *
 * Le modèle est **d'un seul tenant** : un maillage, une seule pièce connexe
 * (vérifié — 43 132 triangles soudés). Contrairement à la voiture, dont deux
 * roues sortaient entières, il n'y a rien à cueillir : il faut couper.
 *
 * On coupe au **cylindre**, comme pour l'essieu resté soudé de la voiture, et
 * les trois chiffres du cylindre sont mesurés :
 *  - l'essieu est à l'aplomb de l'**empreinte au sol** (les sommets qui touchent
 *    y = 0) — une roue porte là où elle touche ;
 *  - le rayon vient d'un **ajustement de cercle** sur le bas du pneu, seul
 *    endroit où ni garde-boue ni fourche ne viennent se mêler au nuage ;
 *  - la demi-largeur est prise sous l'essieu, pour la même raison.
 *
 * Le rayon est volontairement un peu court (1,02) et la largeur un peu juste :
 * mieux vaut laisser un anneau de gomme sur le châssis que d'emporter un bout
 * de fourche qui se mettrait à tourner.
 *
 * @returns {object|null} { roues: [Mesh, Mesh], rayon } — les roues sont ajoutées à `hote`
 */
function separerRoues(engin, hote) {
  engin.updateMatrixWorld(true);
  hote.updateMatrixWorld(true);
  let mesh = null;
  engin.traverse((o) => { if (o.isMesh && (!mesh || o.geometry.index)) mesh = o; });
  if (!mesh || !mesh.geometry.index) return null;

  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const versHote = new THREE.Matrix4().copy(hote.matrixWorld).invert().multiply(mesh.matrixWorld);
  const v = new THREE.Vector3();
  // Les sommets, une fois pour toutes, dans le repère de l'engin.
  const pts = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(versHote);
    pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z;
  }

  /** Ajustement de cercle (Kasa) sur le bas d'un pneu, dans son plan médian. */
  function cercle(cote) {
    let sz = 0, n = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pts[i * 3 + 1], z = pts[i * 3 + 2];
      if (y > 0.015 || z * cote <= 0) continue;
      sz += z; n++;
    }
    if (!n) return null;
    const zc = sz / n;                                  // l'empreinte au sol
    let Sz = 0, Sy = 0, Szz = 0, Syy = 0, Szy = 0, Szzz = 0, Syyy = 0, Szyy = 0, Syzz = 0, m = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2] - zc;
      if (Math.abs(x) > 0.03 || y > 0.13 || Math.abs(z) > 0.22) continue;
      Sz += z; Sy += y; Szz += z * z; Syy += y * y; Szy += z * y;
      Szzz += z * z * z; Syyy += y * y * y; Szyy += z * y * y; Syzz += y * z * z; m++;
    }
    if (m < 40) return null;
    const A = [[Szz, Szy, Sz], [Szy, Syy, Sy], [Sz, Sy, m]];
    const B = [-(Szzz + Szyy), -(Syyy + Syzz), -(Szz + Syy)];
    const det = (M) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
                     - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
                     + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const remplace = (M, c) => M.map((r, i) => r.map((x, j) => (j === c ? B[i] : x)));
    const d = det(A);
    if (Math.abs(d) < 1e-9) return null;
    const a1 = det(remplace(A, 0)) / d, b1 = det(remplace(A, 1)) / d, c1 = det(remplace(A, 2)) / d;
    const z0 = -a1 / 2, y0 = -b1 / 2;
    const r = Math.sqrt(Math.max(1e-6, z0 * z0 + y0 * y0 - c1));
    // L'essieu est à la hauteur du rayon : une roue posée touche le sol.
    return { z: zc + z0, y: r, rayon: r };
  }

  const essieux = [cercle(-1), cercle(1)];
  if (!essieux[0] || !essieux[1]) return null;

  // demi-largeur du pneu, mesurée **sous** l'essieu
  for (const e of essieux) {
    let large = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pts[i * 3], dy = pts[i * 3 + 1] - e.y, dz = pts[i * 3 + 2] - e.z;
      const r = Math.hypot(dy, dz);
      if (dy > -e.rayon * 0.4 || r < e.rayon * 0.7 || r > e.rayon * 1.02) continue;
      if (Math.abs(x) > large) large = Math.abs(x);
    }
    e.demi = large > 0.02 ? large * 1.15 : 0.07;
  }

  // étiquetage des sommets : 0 châssis, 1 roue avant, 2 roue arrière
  const marque = new Uint8Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pts[i * 3], y = pts[i * 3 + 1], z = pts[i * 3 + 2];
    for (let e = 0; e < 2; e++) {
      const es = essieux[e];
      if (Math.abs(x) > es.demi) continue;
      if (Math.hypot(y - es.y, z - es.z) > es.rayon * 1.02) continue;
      marque[i] = e + 1;
      break;
    }
  }

  // Un triangle ne part avec la roue que si ses **trois** sommets y sont :
  // sinon on emporte la jonction avec la fourche, qui se mettrait à tourner.
  const idx = geo.index;
  const gardes = [];
  const parRoue = [[], []];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    const m = marque[a];
    if (m !== 0 && marque[b] === m && marque[c] === m) parRoue[m - 1].push(a, b, c);
    else gardes.push(a, b, c);
  }
  if (parRoue[0].length < 300 || parRoue[1].length < 300) return null;

  const roues = [];
  for (let e = 0; e < 2; e++) {
    const tri = parRoue[e], es = essieux[e];
    const vus = new Map();
    const P = [], N = [], U = [], I = [];
    const nor = geo.attributes.normal, uv = geo.attributes.uv;
    for (const vi of tri) {
      let n = vus.get(vi);
      if (n === undefined) {
        n = vus.size; vus.set(vi, n);
        // les sommets sont recentrés sur l'essieu : la roue tourne sur elle-même
        P.push(pts[vi * 3], pts[vi * 3 + 1] - es.y, pts[vi * 3 + 2] - es.z);
        if (nor) {
          v.fromBufferAttribute(nor, vi).transformDirection(versHote);
          N.push(v.x, v.y, v.z);
        }
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
    const roue = new THREE.Mesh(g, mesh.material);
    roue.name = e === 0 ? 'roue-avant' : 'roue-arriere';
    roue.position.set(0, es.y, es.z);
    roue.castShadow = true;
    hote.add(roue);
    roues.push(roue);
  }
  geo.setIndex(gardes);
  geo.computeBoundingSphere();
  return { roues, rayon: (essieux[0].rayon + essieux[1].rayon) / 2, essieux };
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
 * Construit l'ensemble trottinette + pilote.
 *
 * @param {object} o { scene, x, z, cap, decor }
 * @returns {Promise<object>} { root, pose, reglages, os }
 */
export async function construireTrottinette({ scene, x = 0, z = 0, cap = 0, decor = null, pilote }) {
  const root = new THREE.Group();
  root.name = 'trottinette';
  root.position.set(x, decor ? decor.groundAt(x, z) : 0, z);
  root.rotation.y = cap;
  scene.add(root);

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const modelePilote = pilote === undefined ? PILOTE : (PILOTES_POSSIBLES[pilote] || pilote);
  const [gTrot, gPilote] = await Promise.all([
    loader.loadAsync(TROTTINETTE),
    modelePilote ? loader.loadAsync(modelePilote) : Promise.resolve(null),
  ]);

  // ── la trottinette ───────────────────────────────────────────────────────
  const engin = gTrot.scene;
  // Le modèle a son guidon vers −x ; l'avant du jeu est −z. Un quart de tour,
  // mesuré dans `apercu-glb.html` et pas deviné.
  engin.rotation.y = -Math.PI / 2;
  engin.updateMatrixWorld(true);
  let boite = new THREE.Box3().setFromObject(engin);
  const echelle = GUIDON / (boite.max.y - boite.min.y);
  engin.scale.setScalar(echelle);
  engin.updateMatrixWorld(true);
  boite = new THREE.Box3().setFromObject(engin);
  const centre = boite.getCenter(new THREE.Vector3());
  engin.position.set(-centre.x, -boite.min.y, -centre.z);
  engin.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    // Meshy cuit metalness = 1 : sans cela, la trottinette devient un miroir.
    if (o.material) { o.material.metalness = 0.35; o.material.roughness = 0.5; }
  });
  root.add(engin);

  // ── le guidon, ramené à une largeur de trottinette ───────────────────────
  // Avant la mesure des poignées : elles se mesurent sur le guidon final, donc
  // les mains du pilote tombent sur les poignées rapprochées et non là où elles
  // étaient. L'ordre compte.
  const guidonAffine = affinerGuidon(engin, root);

  // ── les roues, détachées pour tourner ────────────────────────────────────
  const rouage = separerRoues(engin, root);

  // ── où sont les poignées ? ───────────────────────────────────────────────
  // On les mesure sur le maillage plutôt que de les écrire en dur : ce sont les
  // sommets les plus hauts de la trottinette, et leurs extrêmes en largeur.
  // Changer de modèle ne demandera pas de reprendre un seul chiffre.
  const poignees = (() => {
    const haut = new THREE.Box3().setFromObject(engin).max.y;
    const v = new THREE.Vector3();
    let gx = 0, gy = 0, gz = 0, dx = 0, n = 0, m = 0;
    engin.updateMatrixWorld(true);
    engin.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 3) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y < haut - 0.10) continue;              // seulement le haut du guidon
        gy += v.y; gz += v.z; n++;
        if (v.x < 0) { gx += v.x; m++; } else { dx += v.x; }
      }
    });
    if (!n) return null;
    const demi = Math.max(0.16, Math.abs(gx / Math.max(1, m)));
    return { y: gy / n, z: gz / n, demi };
  })();

  // ── le pilote ────────────────────────────────────────────────────────────
  if (!gPilote) {
    const vide = { root, engin, pilote: null, os: {}, pose: () => POSE,
      roues: rouage ? rouage.roues : [],
      rayonRoue: rouage ? rouage.rayon : RAYON_PHYSIQUE,
      rapportRoue: rouage ? RAYON_PHYSIQUE / rouage.rayon : 1,
      guidon: guidonAffine,
      reglages: () => JSON.parse(JSON.stringify(POSE)),
      placer: (nx, nz, ncap = root.rotation.y) => {
        root.position.set(nx, decor ? decor.groundAt(nx, nz) : 0, nz);
        root.rotation.y = ncap;
      } };
    window.RaphaelTrottinette = vide;
    return vide;
  }
  const bonhomme = gPilote.scene;
  // Le modèle regarde vers +z ; l'avant du jeu est −z. Sans ce demi-tour, le
  // pilote conduit dos à la route — ce qui se voit tout de suite, et seulement
  // une fois monté sur l'engin.
  bonhomme.rotation.y = Math.PI;
  bonhomme.updateMatrixWorld(true);
  const bp = boiteSkin(bonhomme);
  bonhomme.scale.setScalar(TAILLE / (bp.max.y - bp.min.y));
  bonhomme.updateMatrixWorld(true);
  const bp2 = boiteSkin(bonhomme);
  // **Le socle.** Un groupe dont l'origine tombe exactement sous les pieds du
  // pilote, au milieu de sa silhouette : c'est lui qu'on déplace, jamais le
  // modèle. Le modèle, lui, est recalé une fois pour toutes dans le socle et
  // ne bouge plus — sans quoi régler « la hauteur du pilote » reviendrait à
  // régler la hauteur de son bassin, ou de son nombril, selon l'exportateur.
  const centrePilote = bp2.getCenter(new THREE.Vector3());
  bonhomme.position.set(-centrePilote.x, -bp2.min.y, -centrePilote.z);
  const socle = new THREE.Group();
  socle.name = 'pilote';
  socle.add(bonhomme);
  bonhomme.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    // Poser un squelette loin de sa pose de repos laisse la sphère englobante
    // là où elle était : le moteur croit le personnage hors champ et ne le
    // dessine plus. Un pilote invisible sur sa trottinette, c'est cela.
    o.frustumCulled = false;
  });
  root.add(socle);

  /** Le placement courant : parti du défaut, corrigé ensuite. */
  const PLACEMENT = { ...PLACEMENT_DEFAUT };

  /** Pose le pilote d'après `PLACEMENT` — une seule voie, quelle que soit l'origine du réglage. */
  function placerPilote(modif = {}) {
    Object.assign(PLACEMENT, modif);
    socle.position.set(PLACEMENT.x, PLACEMENT.y, PLACEMENT.z);
    socle.rotation.set(PLACEMENT.rx, PLACEMENT.ry, PLACEMENT.rz);
    socle.scale.setScalar(PLACEMENT.taille / TAILLE);
    socle.updateMatrixWorld(true);
    return { ...PLACEMENT };
  }

  /** L'inverse : relève dans `PLACEMENT` ce que l'alignement automatique a fait du socle. */
  function lirePlacement() {
    PLACEMENT.x = socle.position.x; PLACEMENT.y = socle.position.y; PLACEMENT.z = socle.position.z;
    PLACEMENT.rx = socle.rotation.x; PLACEMENT.ry = socle.rotation.y; PLACEMENT.rz = socle.rotation.z;
    PLACEMENT.taille = TAILLE * socle.scale.y;
    return { ...PLACEMENT };
  }
  placerPilote();

  // Les os qu'on manipule. Un rig Meshy suit la nomenclature Mixamo : si un nom
  // manque, on n'applique rien plutôt que de planter.
  const os = {};
  bonhomme.traverse((o) => {
    if (!o.isBone) return;
    os[o.name] = o;
    // **La pose de repos est mémorisée.** Un squelette n'a pas ses os à zéro :
    // écraser leur rotation, au lieu d'en partir, replie le personnage en boule
    // — c'est exactement ce qui s'est passé au premier essai.
    o.userData.repos = o.quaternion.clone();
  });

  /**
   * Retrouve les os utiles **quel que soit le rig**.
   *
   * Meshy nomme à la Mixamo (`RightArm`, `RightForeArm`, `RightHand`), le
   * Chevalier d'Enfer à la Unreal (`upperarm_r`, `lowerarm_r`, `hand_r`), et le
   * prochain modèle nommera encore autrement. Chercher un nom exact revient à
   * ne marcher qu'avec un seul fournisseur : on cherche donc un motif, et le
   * côté (droite / gauche) par son suffixe ou son préfixe.
   */
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
    brasD: trouver(/(upperarm|upper_arm|shoulder|arm)(?!.*fore)/i, 'd'),
    brasG: trouver(/(upperarm|upper_arm|shoulder|arm)(?!.*fore)/i, 'g'),
    avantD: trouver(/(lowerarm|forearm|lower_arm|elbow)/i, 'd'),
    avantG: trouver(/(lowerarm|forearm|lower_arm|elbow)/i, 'g'),
    mainD: trouver(/hand/i, 'd'),
    mainG: trouver(/hand/i, 'g'),
    buste: trouver(/(spine_?0?2|spine_?0?1|spine|chest)/i, 'd'),
    cuisseD: trouver(/(thigh|upleg|upper_?leg)/i, 'd'),
    cuisseG: trouver(/(thigh|upleg|upper_?leg)/i, 'g'),
  };

  const tampon = new THREE.Quaternion();
  const euler = new THREE.Euler();

  /** Applique la pose (mains au guidon, buste penché) par-dessus celle de repos. */
  function pose(modif = {}) {
    Object.assign(POSE, modif);
    const mettre = (b, r, miroir = false) => {
      if (!b) return;
      euler.set(r[0], miroir ? -r[1] : r[1], miroir ? -r[2] : r[2]);
      tampon.setFromEuler(euler);
      b.quaternion.copy(b.userData.repos).multiply(tampon);
    };
    mettre(membres.brasD, POSE.bras);
    mettre(membres.brasG, POSE.bras, true);
    mettre(membres.avantD, POSE.avantBras);
    mettre(membres.avantG, POSE.avantBras, true);
    mettre(membres.buste, POSE.buste);
    mettre(membres.cuisseD, POSE.jambeAvant);
    mettre(membres.cuisseG, POSE.jambeArriere);
    socle.position.z = POSE.recul;
    // Les pieds se reposent sur le plateau APRÈS la pose : une jambe qui bouge
    // déplace le bas du personnage, et il finissait en lévitation.
    socle.updateMatrixWorld(true);
    const b = boiteSkin(socle);
    socle.position.y += PLATEAU - b.min.y;
    return POSE;
  }
  pose();

  /**
   * Aligne un pilote **sans squelette** sur le guidon.
   *
   * Le modèle livré est un maillage figé, déjà en position de conduite : pas
   * d'os, donc rien à faire pivoter. En revanche on peut le mesurer : les points
   * les plus avancés à hauteur de bras sont ses poings. On place ce point sur
   * les poignées, et le personnage tombe juste — sans une seule coordonnée
   * écrite à la main, et sans rien supposer du modèle suivant.
   *
   * @returns {boolean} vrai si l'alignement a pu se faire
   */
  function alignerSansOs(objet, poignees) {
    if (!poignees) return false;
    const mesurer = () => {
      objet.updateMatrixWorld(true);
      const v = new THREE.Vector3();
      let bas = Infinity, haut = -Infinity;
      objet.traverse((o) => {
        if (!o.isMesh) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i += 4) {
          v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
          if (v.y < bas) bas = v.y;
          if (v.y > haut) haut = v.y;
        }
      });
      const h = haut - bas;
      let zAvant = Infinity, yPoings = 0, n = 0;
      objet.traverse((o) => {
        if (!o.isMesh) return;
        const a = o.geometry.attributes.position;
        for (let i = 0; i < a.count; i += 2) {
          v.fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld);
          if (v.y < bas + h * 0.50 || v.y > bas + h * 0.70) continue;
          if (v.z < zAvant - 0.02) { zAvant = v.z; yPoings = v.y; n = 1; }
          else if (v.z < zAvant + 0.04) { yPoings += v.y; n++; }
        }
      });
      return { pieds: bas, hauteur: h, poingsZ: zAvant, poingsY: yPoings / Math.max(1, n) };
    };

    let m = mesurer();
    if (!Number.isFinite(m.poingsZ)) return false;
    // Deux passes, et dans cet ordre : **les pieds d'abord**. Un pilote dont on
    // ne règle que les mains finit à califourchon au-dessus du plateau, trente
    // centimètres plus bas — c'est ce qu'on avait.
    for (let passe = 0; passe < 2; passe++) {
      objet.position.y += PLATEAU - m.pieds;            // debout sur le plateau
      objet.position.z += (poignees.z + 0.02) - m.poingsZ;   // poings sur les poignées
      m = mesurer();
      // Ce qui reste en hauteur ne peut plus se rattraper par une translation
      // sans décoller les pieds : on penche le pilote sur ses appuis, comme il
      // le ferait vraiment. Borné à huit degrés — au-delà, il tombe en avant.
      const reste = poignees.y - m.poingsY;        // < 0 : les mains sont trop hautes
      const levier = Math.max(0.45, m.poingsY - m.pieds);
      // **Sens** : dans ce repère, une rotation X positive bascule le haut du
      // corps vers +z, c'est-à-dire en arrière — elle REMONTE les mains. Pour
      // les descendre, il faut donc un angle négatif. L'erreur de signe penchait
      // le pilote à la renverse et éloignait encore ses poings du guidon.
      const angle = THREE.MathUtils.clamp(Math.atan2(reste, levier), -0.20, 0.20);
      if (Math.abs(angle) > 0.005) {
        objet.rotation.x = THREE.MathUtils.clamp(objet.rotation.x + angle, -0.22, 0.22);
        m = mesurer();
      }
    }
    // Ce qui reste après deux passes ne se rattrape plus proprement : on partage
    // l'écart, en laissant les semelles s'enfoncer de quelques centimètres dans
    // le plateau plutôt que de laisser les mains flotter au-dessus du guidon.
    const reste = poignees.y - m.poingsY;
    if (Math.abs(reste) > 0.02) objet.position.y += THREE.MathUtils.clamp(reste, -0.07, 0.07);
    return true;
  }

  // ── les mains vont chercher le guidon ────────────────────────────────────
  // Même mécanique que le bras du Titan qui vise au laser : on tourne l'os pour
  // que le segment os → enfant pointe vers la cible. Cela marche sur n'importe
  // quel squelette, sans connaître l'axe local des bras — et c'est justement ce
  // qu'on ne peut pas deviner d'un rig à l'autre.
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
    return v1.distanceTo(cible);       // ce qu'il reste entre la main et la poignée
  }

  /**
   * Met les deux mains au guidon, et **avance le pilote** de ce qui manque :
   * un bras a une longueur, on ne l'étire pas. Deux passes suffisent.
   */
  function viserGuidon() {
    if (!poignees) return null;
    let reste = 0;
    for (let passe = 0; passe < 2; passe++) {
      pose();
      const d = viserUnBras(membres.brasD, membres.avantD, membres.mainD, 1);
      const g = viserUnBras(membres.brasG, membres.avantG, membres.mainG, -1);
      reste = Math.max(d || 0, g || 0);
      if (reste < 0.03) break;
      // le pilote se rapproche du guidon d'une bonne part de ce qui manque
      socle.position.z -= reste * 0.8;
      POSE.recul = socle.position.z;
      socle.updateMatrixWorld(true);
    }
    return reste;
  }
  /** Ce qu'on ne juge pas à l'œil : semelles, sommet du crâne, écart au plateau. */
  function mesures() {
    socle.updateMatrixWorld(true);
    const b = boiteSkin(socle);
    return {
      pieds: b.min.y, tete: b.max.y, taille: b.max.y - b.min.y,
      plateau: PLATEAU, ecartPlateau: b.min.y - PLATEAU,
      guidon: poignees ? { y: poignees.y, z: poignees.z, demi: poignees.demi } : null,
    };
  }

  /** Repose le pilote là où l'automatique le met : le point de départ du réglage. */
  function aligner() {
    placerPilote(PLACEMENT_DEFAUT);
    if (membres.brasD && membres.mainD) viserGuidon();
    else alignerSansOs(socle, poignees);
    return lirePlacement();
  }

  // Trois façons de poser le pilote, dans cet ordre de confiance :
  //   1. le placement réglé à la main (`placer-pilote.html`) — il gagne toujours ;
  //   2. les bras qui vont chercher le guidon, si le modèle a un squelette ;
  //   3. la mesure des poings, pour un maillage figé.
  // Le pilote livré n'a **aucun os** : c'est la troisième voie qui s'appliquait,
  // et elle prend de mauvais sommets pour des poings — d'où le réglage à la main.
  const enregistre = await placementEnregistre(modelePilote);
  if (enregistre) placerPilote(enregistre);
  else aligner();

  const api = {
    root, engin, pilote: bonhomme, socle, os, membres, pose, viserGuidon, poignees,
    // Les roues détachées, et de combien il faut corriger leur rotation : la
    // physique compte les tours avec un rayon de 13 cm, celles-ci en font 10.
    // Sans ce rapport, la roue patine à l'œil — ce qui se voit tout de suite.
    roues: rouage ? rouage.roues : [],
    rayonRoue: rouage ? rouage.rayon : RAYON_PHYSIQUE,
    rapportRoue: rouage ? RAYON_PHYSIQUE / rouage.rayon : 1,
    guidon: guidonAffine,
    // Le réglage à la main : `placer-pilote.html` ne fait qu'appeler ceci.
    placerPilote, aligner, mesures, modelePilote,
    placement: () => ({ ...PLACEMENT }),
    reglages: () => JSON.parse(JSON.stringify(POSE)),
    /** Repose l'ensemble ailleurs, au sol. */
    placer: (nx, nz, ncap = root.rotation.y) => {
      root.position.set(nx, decor ? decor.groundAt(nx, nz) : 0, nz);
      root.rotation.y = ncap;
    },
  };
  window.RaphaelTrottinette = api;
  return api;
}


/**
 * La trottinette **conduisible**, présentée comme une voiture.
 *
 * `voiture-pilote.js` sait déjà tout faire : suspension sur les roues,
 * collisions, caméra, son, traces. Il ne lui manque qu'un véhicule à poser. On
 * lui rend donc la trottinette sous exactement la même forme qu'une voiture —
 * `root`, `caisse` qui se penche, `ombre` de contact — et il ne voit pas la
 * différence. C'est le même découpage que le village présenté au moteur des
 * Mondes comme une carte ordinaire.
 *
 * @returns {object} l'API attendue par le pilote
 */
export function construireEnginTrottinette({ renderer = null } = {}) {
  const root = new THREE.Group();
  root.name = 'engin-trottinette';
  const caisse = new THREE.Group();
  root.add(caisse);

  // Ombre de contact : la même tache douce que sous la voiture. Sans elle,
  // l'engin paraît flotter dès que les ombres portées sont coupées.
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
    new THREE.PlaneGeometry(1.0, 2.2),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.8,
    }),
  );
  ombre.rotation.x = -Math.PI / 2;
  ombre.renderOrder = 2;

  // On réutilise l'assemblage complet (engin + pilote aligné sur le guidon) en
  // lui donnant la caisse pour scène : il s'y range comme dans un village.
  let roues = null, rapportRoue = 1;
  const pret = construireTrottinette({ scene: caisse, x: 0, z: 0, cap: 0 })
    .then((kit) => { roues = kit.roues; rapportRoue = kit.rapportRoue; return { engin: kit, roues: kit.roues }; })
    .catch((err) => { console.warn('Trottinette indisponible', err); return null; });

  return {
    root, caisse, ombre, roues: [], pret,
    /**
     * Les roues tournent.
     *
     * Le pilote passe l'angle cumulé que la physique a compté avec **son**
     * rayon (13 cm) ; les roues du modèle en font 10. On corrige par le
     * rapport, sinon le pneu tourne trop lentement pour la vitesse du sol et
     * la trottinette a l'air de glisser sur de la glace.
     *
     * Pas de braquage : le pilote est un maillage figé, ses mains sont soudées
     * aux poignées. Tourner le guidon les arracherait — c'est à reprendre le
     * jour où l'on aura un pilote riggé.
     */
    majRoues(braquage, rotation) {
      if (!roues) return;
      for (let i = 0; i < roues.length; i++) roues[i].rotation.x = -rotation * rapportRoue;
    },
    setFreinage() {},
    setNuit() {},
    setTeinte() { return 'trottinette'; },
    setCouleur() {},
    materiaux: {},
    dimensions: { longueur: 2.1, largeur: 0.6, empattement: 1.15, rayonRoue: 0.13 },
  };
}
