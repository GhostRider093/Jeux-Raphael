/**
 * Le skatepark du stade — une dalle de béton et des modules posés dessus.
 *
 * Depuis le 25/09/2026, plus rien n'est modelé à la main (« au niveau visuel
 * c'est catastrophique, faut retirer tout ce qui a été fait en premier » —
 * Arnaud). Le parc se compose avec des **modèles 3D** (trois lots de modules de
 * skatepark, `perso/skatepark-stl`), et un modèle posé existe deux fois :
 *
 *   1. comme maillage à regarder : le GLB, chargé et posé ici ;
 *   2. comme hauteurs à rouler : `maps/poilhes/skatepark-hauteurs.bin`, le
 *      dessus de chaque modèle rastérisé au pas de 10 cm par
 *      `scripts/poilhes/skatepark_modeles.py hauteurs`.
 *
 * Les deux sortent du **même fichier** : `maps/poilhes/skatepark-plan.json`
 * (modèle, position, rotation par pièce ; bandes de lancement ; départ).
 * Changer le parc, c'est éditer ce plan puis relancer le script — jamais toucher
 * à un chiffre ici. Le décor et la physique ne peuvent donc pas diverger, comme
 * avant avec `profil(u, v)` : la fonction existe toujours, elle lit la grille.
 *
 * Le repère est local au parc : `u` vers l'est, `v` vers le sud, l'origine au
 * centre de la dalle. Le sol reste celui du village — le parc **suit le
 * relief** (76 cm de dénivelé sur les 52 m du terrain : un module de 4 m ne
 * les sent pas, une dalle horizontale aurait laissé une marche de 40 cm).
 *
 * Emplacement : le stade de l'Olympique Midi Lirou, le seul rectangle vraiment
 * plat et libre du relevé (0 % d'obstacle sur 52 × 56 m).
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';

// ─────────────────────────────────────────────────────────── les dimensions
const DALLE = 0.07;                // épaisseur de la dalle (m)
const BISEAU = 1.6;                // sur quelle largeur la dalle rejoint l'herbe (m)

/** Le centre du parc, en coordonnées du village (mesuré, pas choisi au hasard). */
export const CENTRE = { x: 6.75, z: 133 };

// ─────────────────────────────────────────────────────────── les matières
/**
 * Textures **générées** (Arnaud, 25/09/2026 : « mettre de la texture sur le
 * pump park ») : rien à télécharger, un canvas de 512 px par matière.
 *  - béton : gris moyen granuleux, quelques taches plus sombres ;
 *  - contreplaqué : les modules en bois du lot FreeCAD (table, half-pipe,
 *    quarter, wallride, bosse), veines longues et vis ;
 *  - acier galvanisé : les rails.
 * Les GLB n'ont pas d'UV : on les projette par boîte (`uvParBoite`), une tuile
 * de 2 m ; la dalle reçoit des UV monde (1 tuile = 3 m) et garde ses couleurs
 * par sommet pour les bandes bleues et la ligne de départ.
 */
const TEXTURES = {};
function texture(nom) {
  if (TEXTURES[nom]) return TEXTURES[nom];
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  let graine = nom.length * 977;
  const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };
  if (nom === 'beton') {
    g.fillStyle = '#9a9d9f'; g.fillRect(0, 0, 512, 512);
    const img = g.getImageData(0, 0, 512, 512), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const b = (alea() - 0.5) * 34; d[i] += b; d[i + 1] += b; d[i + 2] += b + (alea() - 0.5) * 6; }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 140; k++) {                                   // taches et granulats
      g.fillStyle = 'rgba(' + (60 + alea() * 40 | 0) + ',' + (60 + alea() * 40 | 0) + ',' + (65 + alea() * 40 | 0) + ',' + (0.05 + alea() * 0.12) + ')';
      g.beginPath(); g.ellipse(alea() * 512, alea() * 512, 3 + alea() * 26, 2 + alea() * 14, alea() * 3.14, 0, 6.29); g.fill();
    }
    g.strokeStyle = 'rgba(70,72,76,.35)'; g.lineWidth = 1.2;         // joints de dalle
    g.beginPath(); g.moveTo(0, 256); g.lineTo(512, 256); g.moveTo(256, 0); g.lineTo(256, 512); g.stroke();
  } else if (nom === 'bois') {
    g.fillStyle = '#c9a56a'; g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 2) {                                  // veines
      const t = Math.sin(y * 0.11 + Math.sin(y * 0.021) * 3) * 0.5 + 0.5;
      g.fillStyle = 'rgba(' + (120 + t * 40 | 0) + ',' + (80 + t * 30 | 0) + ',' + (35 + t * 20 | 0) + ',' + (0.10 + alea() * 0.12) + ')';
      g.fillRect(0, y, 512, 1 + (alea() < 0.3 ? 1 : 0));
    }
    const img = g.getImageData(0, 0, 512, 512), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const b = (alea() - 0.5) * 18; d[i] += b; d[i + 1] += b * 0.9; d[i + 2] += b * 0.7; }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(70,45,20,.45)'; g.lineWidth = 2;            // joints de plaques
    g.beginPath(); g.moveTo(0, 0.5); g.lineTo(512, 0.5); g.moveTo(0.5, 0); g.lineTo(0.5, 512); g.stroke();
    g.fillStyle = 'rgba(60,60,62,.85)';                                // vis
    for (let k = 0; k < 24; k++) { g.beginPath(); g.arc(20 + (k % 6) * 94, 24 + Math.floor(k / 6) * 150, 2.6, 0, 6.29); g.fill(); }
  } else {                                                              // acier
    g.fillStyle = '#b7bcc1'; g.fillRect(0, 0, 512, 512);
    const img = g.getImageData(0, 0, 512, 512), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const b = (alea() - 0.5) * 22; d[i] += b; d[i + 1] += b; d[i + 2] += b + 4; }
    g.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  TEXTURES[nom] = t;
  return t;
}
const MATIERES = {};
function matiere(nom) {
  if (MATIERES[nom]) return MATIERES[nom];
  const m = nom === 'bois'
    ? new THREE.MeshStandardMaterial({ map: texture('bois'), color: 0xd8c39a, roughness: 0.78, metalness: 0.0 })
    : nom === 'acier'
    ? new THREE.MeshStandardMaterial({ map: texture('acier'), color: 0xd0d4d8, roughness: 0.38, metalness: 0.75 })
    : new THREE.MeshStandardMaterial({ map: texture('beton'), color: 0xb9b3aa, roughness: 0.94, metalness: 0.0 });
  MATIERES[nom] = m;
  return m;
}
/** La matière d'un modèle d'après son nom : lot FreeCAD en bois, rails en acier, le reste en béton. */
function matiereDe(modele) {
  if (/^Rail$/i.test(modele)) return 'acier';
  if (/^(Cone_flat|Mini_Halfpipe|Quarter_pipe|Ramp_to_Wall|Table)/i.test(modele)) return 'bois';
  return 'beton';
}
/**
 * UV par projection sur les trois axes : chaque triangle est projeté sur le
 * plan le plus proche de sa normale. `echelle` convertit les unités du modèle
 * en mètres, `tuile` est la taille d'une répétition (m).
 */
function uvParBoite(geometrie, echelle, tuile = 2) {
  const geo = geometrie.index ? geometrie.toNonIndexed() : geometrie.clone();
  const pos = geo.attributes.position, n = pos.count;
  const uv = new Float32Array(n * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nrm = new THREE.Vector3(), ca = new THREE.Vector3();
  const k = echelle / tuile;
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    ca.subVectors(c, a);
    nrm.subVectors(b, a).cross(ca);
    const ax = Math.abs(nrm.x), ay = Math.abs(nrm.y), az = Math.abs(nrm.z);
    for (let j = 0; j < 3; j++) {
      const p = j === 0 ? a : j === 1 ? b : c;
      let u, v;
      if (az >= ax && az >= ay) { u = p.x; v = p.y; } else if (ay >= ax) { u = p.x; v = p.z; } else { u = p.y; v = p.z; }
      uv[(i + j) * 2] = u * k; uv[(i + j) * 2 + 1] = v * k;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** Marche adoucie : 0 avant, 1 après, sans angle vif. */
const lisse = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Charge le plan et la grille de hauteurs du parc. À appeler avant
 * `construireSkatepark` (qui reste synchrone) — `poilhes-scene.js` le fait.
 *
 * @param {string} base  dossier des données du village (`maps/poilhes/`)
 * @returns {Promise<object|null>} { plan, grille } ou null si le village n'a pas de plan
 */
export async function chargerParc(base) {
  try {
    const [rp, rh] = await Promise.all([
      fetch(base + 'skatepark-plan.json', { cache: 'no-cache' }),
      fetch(base + 'skatepark-hauteurs.bin', { cache: 'no-cache' }),
    ]);
    if (!rp.ok) return null;
    const plan = await rp.json();
    let grille = null;
    if (rh.ok) {
      const buf = await rh.arrayBuffer();
      const dv = new DataView(buf);
      const magie = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
      if (magie === 'SKP1') {
        const demiU = dv.getFloat32(4, true), demiV = dv.getFloat32(8, true);
        const nu = dv.getInt32(12, true), nv = dv.getInt32(16, true);
        grille = { demiU, demiV, nu, nv, pas: (2 * demiU) / (nu - 1), h: new Uint16Array(buf, 20, nu * nv) };
      }
    }
    return { plan, grille };
  } catch (err) {
    console.warn('[skatepark] plan illisible', err);
    return null;
  }
}

/**
 * Le parc, posé sur le terrain.
 *
 * @param {object} o { decor: { groundAt }, centre, parc: { plan, grille } (chargerParc) }
 * @returns {object} root, hauteurAt, surParc, turboAt, marquerAdherence, profil, centre, depart
 */
export function construireSkatepark({ decor, centre = CENTRE, parc = null }) {
  const cx = centre.x, cz = centre.z;
  const plan = parc && parc.plan ? parc.plan : { demi_u: 26, demi_v: 28, pieces: [], bandes: [], depart: { u: 0, v: 16, cap_deg: 0 } };
  const grille = parc ? parc.grille : null;
  const U = plan.demi_u, V = plan.demi_v;
  const root = new THREE.Group();
  root.name = 'skatepark';
  root.position.set(cx, 0, cz);

  /** La dalle : 7 cm de béton, dont les bords descendent vers l'herbe. */
  function dalle(u, v) {
    const t = Math.min((U - Math.abs(u)) / BISEAU, (V - Math.abs(v)) / BISEAU);
    return t <= 0 ? 0 : DALLE * Math.min(1, t);
  }

  /** Hauteur des modules au-dessus de la dalle, lue dans la grille (bilinéaire). */
  function modules(u, v) {
    if (!grille) return 0;
    const fx = (u + grille.demiU) / grille.pas, fy = (v + grille.demiV) / grille.pas;
    const i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= grille.nu - 1 || j >= grille.nv - 1) return 0;
    const tx = fx - i, ty = fy - j;
    const H = grille.h, n = grille.nu;
    const h00 = H[j * n + i], h10 = H[j * n + i + 1], h01 = H[(j + 1) * n + i], h11 = H[(j + 1) * n + i + 1];
    return ((h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty) / 1000;
  }

  /** La hauteur du béton au-dessus du sol, en un point du parc. */
  function profil(u, v) {
    if (u < -U || u > U || v < -V || v > V) return 0;
    const m = modules(u, v);
    return m > 0 ? DALLE + m : dalle(u, v);
  }

  /** Les bandes de lancement : null hors bande, sinon l'abscisse le long de la bande. */
  const bandes = (plan.bandes || []).map((b) => {
    const dx = b.u1 - b.u0, dz = b.v1 - b.v0, L = Math.hypot(dx, dz) || 1;
    return { u0: b.u0, v0: b.v0, tx: dx / L, tz: dz / L, L, demi: (b.largeur || 3) / 2 };
  });
  function bande(u, v) {
    for (const b of bandes) {
      const du = u - b.u0, dv = v - b.v0;
      const t = du * b.tx + dv * b.tz;
      if (t < 0 || t > b.L) continue;
      const e = Math.abs(-du * b.tz + dv * b.tx);
      if (e <= b.demi) return { t };
    }
    return null;
  }

  // ── la dalle (maillage) ──────────────────────────────────────────────────
  // Plate : les modules sont des GLB posés dessus, pas des bosses de la dalle.
  const PAS = 0.8;
  const nu = Math.round((2 * U) / PAS) + 1, nv = Math.round((2 * V) / PAS) + 1;
  const pos = new Float32Array(nu * nv * 3);
  const col = new Float32Array(nu * nv * 3);
  const uvs = new Float32Array(nu * nv * 2);
  // Éclaircis le 26/09/2026 : la couleur par sommet se multiplie désormais par
  // la texture béton, l'ancien gris foncé donnait une dalle noire au soleil couchant.
  const ASPHALTE = new THREE.Color(0xa3a8ae), BETON = new THREE.Color(0xc4cace);
  const TURBO = new THREE.Color(0x2a63c9), TURBO_CLAIR = new THREE.Color(0x9ec3ff), BLANC = new THREE.Color(0xe8ecef);
  const teinte = new THREE.Color();
  const dep = plan.depart || { u: 0, v: 16, cap_deg: 0 };
  for (let j = 0; j < nv; j++) {
    const v = -V + j * PAS;
    for (let i = 0; i < nu; i++) {
      const u = -U + i * PAS;
      const k = j * nu + i;
      pos[k * 3] = u;
      pos[k * 3 + 1] = decor.groundAt(cx + u, cz + v) + dalle(u, v);
      pos[k * 3 + 2] = v;
      uvs[k * 2] = u / 3; uvs[k * 2 + 1] = v / 3;
      teinte.copy(Math.abs(u) > U - BISEAU || Math.abs(v) > V - BISEAU ? BETON : ASPHALTE);
      const b = bande(u, v);
      if (b) teinte.copy(((b.t % 1.6) + 1.6) % 1.6 < 0.45 ? TURBO_CLAIR : TURBO);
      // la ligne de départ, en travers, juste derrière le point de départ
      if (Math.abs(u - dep.u) < 4 && Math.abs(v - dep.v - 1.5) < 0.45) teinte.copy(BLANC);
      col[k * 3] = teinte.r; col[k * 3 + 1] = teinte.g; col[k * 3 + 2] = teinte.b;
    }
  }
  const idx = new Uint32Array((nu - 1) * (nv - 1) * 6);
  let t = 0;
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // 0,32 sur la couleur : le parc est une MeshStandardMaterial ordinaire au
  // milieu d'un village peint par des shaders maison (voir l'ancienne version) —
  // à pleine luminance le béton virait au blanc.
  const beton = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: texture('beton'), color: 0xf3eee6, vertexColors: true, roughness: 1.0, metalness: 0,
  }));
  beton.castShadow = false;
  beton.receiveShadow = true;
  root.add(beton);

  // ── les modules (GLB) ────────────────────────────────────────────────────
  // Même transformation que le script Python : mètres, centré en x/y, posé
  // au sol (z = 0), puis z du modèle → y du jeu et y du modèle (nord) → −z du
  // jeu ; la rotation du plan tourne autour de la verticale, sens direct vu du
  // ciel. Les matières des GLB (béton gris, cuites par trimesh) sont gardées.
  const pieces = plan.pieces || [];
  if (pieces.length) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const cache = new Map();
    const charger = (nom) => {
      if (!cache.has(nom)) cache.set(nom, loader.loadAsync(`assets/skatepark/${nom}.glb?v=pilote-20260925`));
      return cache.get(nom);
    };
    // Chaque module reçoit sa matière (béton, bois, acier) et des UV projetés
    // par boîte : les STL n'ont ni UV ni normales (sans normales, un
    // MeshStandardMaterial rend noir — vu au premier essai).
    const geometries = new Map();       // modèle → géométrie avec UV, partagée
    for (const p of pieces) {
      charger(p.modele).then((g) => {
        const modele = g.scene.clone(true);
        const e = p.echelle || (p.modele.startsWith('obj_') ? 0.040 : p.modele.startsWith('Tech') ? 0.015 : 0.030);
        const mat = matiere(matiereDe(p.modele));
        modele.traverse((o) => {
          if (!o.isMesh) return;
          const cle = p.modele + ':' + o.name + ':' + e;
          if (!geometries.has(cle)) geometries.set(cle, uvParBoite(o.geometry, e, 2));
          o.geometry = geometries.get(cle);
          o.material = mat; o.castShadow = true; o.receiveShadow = true;
        });
        // le GLB est déjà en unités « modèle » (mm) : on applique l'échelle du script
        const boite = new THREE.Box3().setFromObject(modele);
        const dedans = new THREE.Group();
        dedans.add(modele);
        modele.scale.setScalar(e);
        modele.position.set(-(boite.min.x + boite.max.x) / 2 * e, -(boite.min.y + boite.max.y) / 2 * e, -boite.min.z * e);
        dedans.rotation.x = -Math.PI / 2;                 // z du modèle vers le haut
        const socle = new THREE.Group();
        socle.name = p.nom || p.modele;
        socle.add(dedans);
        socle.rotation.y = THREE.MathUtils.degToRad(p.rot || 0);
        socle.position.set(p.u, decor.groundAt(cx + p.u, cz + p.v) + DALLE, p.v);
        root.add(socle);
      }).catch((err) => console.warn('[skatepark] module absent', p.modele, err));
    }
  }

  /** Le sol du parc en un point du village : sol du terrain + béton. */
  function hauteurAt(x, z) {
    const u = x - cx, v = z - cz;
    if (u < -U || u > U || v < -V || v > V) return -1e9;
    return decor.groundAt(x, z) + profil(u, v);
  }
  /** Vrai sur la dalle : c'est du béton, donc l'adhérence du bitume. */
  function surParc(x, z) {
    const u = x - cx, v = z - cz;
    return u >= -U && u <= U && v >= -V && v <= V;
  }
  /** Vrai sur une bande de lancement : le pilote y pousse la trottinette. */
  function turboAt(x, z) {
    return bande(x - cx, z - cz) !== null;
  }
  /** Tamponne la dalle dans la grille d'adhérence de la voiture (béton = bitume). */
  function marquerAdherence(marquer) {
    for (let u = -U; u <= U; u += 1) for (let v = -V; v <= V; v += 1) marquer(cx + u, cz + v);
  }
  const depart = { x: cx + dep.u, z: cz + dep.v, cap: THREE.MathUtils.degToRad(dep.cap_deg || 0) };

  return { root, hauteurAt, surParc, turboAt, marquerAdherence, profil, centre: { x: cx, z: cz }, depart, plan };
}
