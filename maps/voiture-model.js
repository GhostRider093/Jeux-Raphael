/**
 * La carrosserie — une sportive GT construite en code, sans le moindre fichier.
 *
 * Tout est procédural, comme les façades et les tuiles du village : rien à
 * télécharger, rien à licencier, et la voiture se règle depuis la console.
 *
 * La coque est un « loft » : une suite de sections transversales posées le long
 * de la voiture (museau, passage de roue avant, capot, base de pare-brise,
 * hanches, poupe), reliées deux à deux par des quadrilatères. Chaque section est
 * une super-ellipse — un rectangle aux angles arrondis dont on choisit la
 * rondeur — ce qui donne des flancs galbés sans un seul sommet placé à la main.
 * L'habitacle est un second loft, plus étroit, dont les quads sont répartis en
 * deux matières selon leur position : le pavillon est peint, le reste est vitré.
 *
 * La peinture est un vernis (`clearcoat`) et les chromes réfléchissent un petit
 * ciel calculé une fois pour toutes (PMREM d'un dégradé) : sans réflexion, une
 * carrosserie sombre vire au noir mat et la voiture a l'air d'être en carton.
 *
 * Repère : l'origine est au sol, l'avant est −z, la droite est +x — celui du
 * projet. La caisse est un groupe séparé des roues : le pilote la penche dans
 * les virages sans décoller les pneus du sol.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';

// Carrosserie réelle : « Crimson Thunder », générée sous Meshy puis ramenée de
// 32,4 Mo à 1.86 Mo (155 000 triangles : `weld`, décimation, meshopt, WebP 2048)
// — même chaîne que le Chevalier d'Enfer. À 6 %, le fichier tombait à 1,2 Mo mais
// l'atlas d'UV très fragmenté de Meshy se déchirait : plaques blanches froissées
// sur toute la carrosserie. Elle remplace la coque de code, qui reste en secours :
// si le fichier manque, la voiture est toujours là, et le jeu ne s'arrête pas.
const MODELE = 'assets/car/crimson.glb?v=voiture-20260921c';
// Teinte multipliée par la texture du modèle. **Elle reste blanche**, et ce
// n'est pas un oubli : l'atlas de Meshy est déjà rouge, blanc et noir, et toute
// teinte rouge ajoutée ici rosit les parties blanches (bandes, jantes, optiques)
// au lieu de raviver le rouge. `setCouleur()` reste là pour changer de couleur à
// la volée depuis la console, en connaissance de cause.
const TEINTE = 0xffffff;

// Teintes disponibles : une rotation de la **teinte** (au sens TSL) appliquée à
// la texture du modèle. Rien n'est retéléchargé — la voiture bleue est la même
// carrosserie, repeinte pixel par pixel à l'arrivée.
const TEINTES = { rouge: 0, bleu: 205 };
const LONGUEUR = 4.42;         // longueur visée (m) : le modèle est mis à l'échelle dessus

const RAYON = 0.345;           // rayon de roue (m) — identique à `voiture-physique.js`
// La voie est large : les roues affleurent les ailes (0,84 + demi-largeur ≈ 0,98,
// pour une coque de 0,99). Des roues rentrées sous la caisse donnent une voiture
// de sous-préfecture, pas une GT.
const ESSIEU_AV = -1.34, ESSIEU_AR = 1.32, VOIE = 0.84;

// ─────────────────────────────────────────────────────────────── petit ciel
let envPartage = null;
/**
 * Environnement de réflexion partagé : un dégradé ciel / horizon / sol, passé au
 * PMREM pour que la rugosité des matières ait un sens. Une seule fois par page.
 */
function environnement(renderer) {
  if (envPartage || !renderer) return envPartage;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const d = g.createLinearGradient(0, 0, 0, 64);
  d.addColorStop(0, '#20407a');
  d.addColorStop(0.42, '#9dc4ee');
  d.addColorStop(0.52, '#f2ead6');
  d.addColorStop(0.62, '#8e8878');
  d.addColorStop(1, '#3d3a33');
  g.fillStyle = d;
  g.fillRect(0, 0, 128, 64);
  // une tache claire : le soleil donne un éclat qui court sur les ailes
  const s = g.createRadialGradient(34, 18, 0, 34, 18, 22);
  s.addColorStop(0, 'rgba(255,255,240,.95)');
  s.addColorStop(1, 'rgba(255,255,240,0)');
  g.fillStyle = s;
  g.fillRect(0, 0, 128, 40);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  envPartage = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return envPartage;
}

// ────────────────────────────────────────────────────────────────── le loft
/**
 * Point d'une section : super-ellipse inscrite dans (±w, y0..y1).
 * `n` règle la rondeur : 2 donne une ellipse, 6 un rectangle presque net.
 */
function pointSection(st, t, out) {
  const a = t * Math.PI * 2;
  const cx = Math.cos(a), cy = Math.sin(a);
  const p = 2 / st.n;
  const hy = (st.y1 - st.y0) / 2, yc = (st.y1 + st.y0) / 2;
  out.x = st.w * Math.sign(cx) * Math.pow(Math.abs(cx), p);
  out.y = yc + hy * Math.sign(cy) * Math.pow(Math.abs(cy), p);
  out.z = st.z;
  return out;
}

/**
 * Construit une géométrie lofteée à partir de sections, avec des groupes de
 * matières décidés par `classer(z, y, x)` — c'est ainsi que le pavillon est
 * peint et les vitres transparentes sans découper deux maillages.
 */
function loft(stations, cotes, classer) {
  const S = stations.length;
  const pos = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < cotes; j++) {
      pointSection(stations[i], j / cotes, p);
      pos.push(p.x, p.y, p.z);
    }
  }
  // Bouchons : un sommet au centre de la première et de la dernière section.
  const centre = (st) => [0, (st.y0 + st.y1) / 2, st.z];
  const iAvant = pos.length / 3; pos.push(...centre(stations[0]));
  const iArriere = pos.length / 3; pos.push(...centre(stations[S - 1]));

  const groupes = new Map();          // nom de matière → liste d'indices
  const pousser = (nom, a, b, c) => {
    let g = groupes.get(nom);
    if (!g) groupes.set(nom, g = []);
    g.push(a, b, c);
  };
  const milieu = (a, b, c, d) => {
    const m = [0, 0, 0];
    for (const k of [a, b, c, d]) { m[0] += pos[k * 3] / 4; m[1] += pos[k * 3 + 1] / 4; m[2] += pos[k * 3 + 2] / 4; }
    return m;
  };
  for (let i = 0; i < S - 1; i++) {
    for (let j = 0; j < cotes; j++) {
      const j2 = (j + 1) % cotes;
      const a = i * cotes + j, b = i * cotes + j2;
      const c = (i + 1) * cotes + j2, d = (i + 1) * cotes + j;
      const m = milieu(a, b, c, d);
      const nom = classer ? classer(m[2], m[1], m[0], i) : 'peinture';
      if (!nom) continue;             // quad supprimé (dessous de caisse invisible)
      pousser(nom, a, b, c);
      pousser(nom, a, c, d);
    }
  }
  for (let j = 0; j < cotes; j++) {
    const j2 = (j + 1) % cotes;
    pousser('peinture', iAvant, j2, j);
    pousser('peinture', iArriere, (S - 1) * cotes + j, (S - 1) * cotes + j2);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const ordre = [...groupes.keys()];
  const indices = [];
  ordre.forEach((nom) => {
    const debut = indices.length;
    indices.push(...groupes.get(nom));
    geo.addGroup(debut, indices.length - debut, ordre.indexOf(nom));
  });
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return { geo, ordre };
}

// ───────────────────────────────────────────────────────────── les sections
// Coque basse : du museau à la poupe, jusqu'à la ceinture de caisse. Le capot et
// le coffre sont le haut de ce volume — il n'y a pas de pièce séparée à recaler.
// Le bas de caisse monte au-dessus de chaque essieu : c'est **cette courbe** qui
// creuse les passages de roue. Sans elle, la coque descend jusqu'aux jantes et
// la voiture a l'air posée sur une jupe — les roues ne se voient plus.
const COQUE = [
  { z: -2.20, w: 0.63, y0: 0.44, y1: 0.61, n: 2.8 },
  { z: -2.06, w: 0.85, y0: 0.35, y1: 0.69, n: 3.2 },
  { z: -1.86, w: 0.92, y0: 0.41, y1: 0.78, n: 3.6 },
  { z: -1.60, w: 0.97, y0: 0.51, y1: 0.81, n: 4.0 },
  { z: -1.34, w: 0.99, y0: 0.55, y1: 0.83, n: 4.2 },   // essieu avant : sommet de l'arche
  { z: -1.08, w: 0.97, y0: 0.49, y1: 0.85, n: 4.4 },
  { z: -0.86, w: 0.93, y0: 0.33, y1: 0.86, n: 4.5 },   // bas de caisse
  { z: -0.40, w: 0.92, y0: 0.29, y1: 0.90, n: 4.6 },
  { z: 0.20, w: 0.94, y0: 0.29, y1: 0.92, n: 4.8 },
  { z: 0.80, w: 0.97, y0: 0.37, y1: 0.92, n: 4.8 },
  { z: 1.06, w: 0.99, y0: 0.49, y1: 0.91, n: 4.5 },
  { z: 1.32, w: 1.00, y0: 0.55, y1: 0.89, n: 4.3 },    // essieu arrière
  { z: 1.62, w: 0.98, y0: 0.48, y1: 0.88, n: 4.2 },
  { z: 1.92, w: 0.94, y0: 0.38, y1: 0.86, n: 4.0 },
  { z: 2.18, w: 0.81, y0: 0.42, y1: 0.80, n: 3.2 },
];

// Habitacle : pare-brise incliné, pavillon court, lunette fuyante (fastback).
const HABITACLE = [
  { z: -0.66, w: 0.78, y0: 0.82, y1: 0.88, n: 4.4 },
  { z: -0.42, w: 0.77, y0: 0.82, y1: 1.06, n: 4.4 },
  { z: -0.12, w: 0.74, y0: 0.82, y1: 1.26, n: 4.6 },
  { z: 0.24, w: 0.72, y0: 0.82, y1: 1.30, n: 5.0 },
  { z: 0.66, w: 0.73, y0: 0.82, y1: 1.26, n: 5.0 },
  { z: 1.14, w: 0.76, y0: 0.82, y1: 1.06, n: 4.4 },
  { z: 1.52, w: 0.80, y0: 0.82, y1: 0.93, n: 4.2 },
];

// ──────────────────────────────────────────── la carrosserie réelle (Meshy)
/**
 * Repeint une texture : rotation de teinte des pixels **colorés seulement**.
 *
 * L'atlas de Meshy est rouge, blanc et noir. Teinter tout ferait virer les
 * bandes blanches et les optiques ; on ne touche donc qu'aux pixels assez
 * saturés — le reste (blanc, noir, gris, chrome) passe intact. C'est ce qui
 * distingue une voiture repeinte d'une voiture sous gélatine.
 */
function repeindre(image, rotation) {
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const g = c.getContext('2d', { willReadFrequently: false });
  g.drawImage(image, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const tour = ((rotation % 360) + 360) / 360;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, v = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, v, b), min = Math.min(r, v, b);
    const delta = max - min;
    if (delta < 0.16) continue;                 // gris, blanc, noir : on n'y touche pas
    let h;
    if (max === r) h = ((v - b) / delta + 6) % 6;
    else if (max === v) h = (b - r) / delta + 2;
    else h = (r - v) / delta + 4;
    h = (h / 6 + tour) % 1;
    const sat = delta / max;
    // retour en RVB (teinte tournée, saturation et valeur conservées)
    const k = (n) => {
      const t = (n + h * 6) % 6;
      return max * (1 - sat * Math.max(0, Math.min(1, Math.min(t, 4 - t))));
    };
    d[i] = k(5) * 255; d[i + 1] = k(3) * 255; d[i + 2] = k(1) * 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;                            // les UV d'un glTF sont déjà dans le bon sens
  tex.anisotropy = 8;
  return tex;
}

/**
 * Recopie une géométrie en **flottants**.
 *
 * Indispensable, et pas évident : `meshopt` quantifie les positions en entiers
 * courts normalisés, la vraie échelle vivant dans la matrice du nœud. Appliquer
 * une matrice directement sur ces entiers les écrase — tout le modèle se
 * retrouve écrasé dans un cube de deux unités de côté, et plus rien ne se
 * repère. On lit donc les valeurs (le lecteur les dénormalise) avant de toucher
 * à quoi que ce soit.
 */
function enFlottants(geo) {
  const out = new THREE.BufferGeometry();
  for (const nom of ['position', 'normal', 'uv']) {
    const a = geo.attributes[nom];
    if (!a) continue;
    const t = a.itemSize;
    const arr = new Float32Array(a.count * t);
    for (let i = 0; i < a.count; i++) {
      arr[i * t] = a.getX(i);
      if (t > 1) arr[i * t + 1] = a.getY(i);
      if (t > 2) arr[i * t + 2] = a.getZ(i);
    }
    out.setAttribute(nom, new THREE.Float32BufferAttribute(arr, t));
  }
  if (geo.index) out.setIndex(new THREE.BufferAttribute(new Uint32Array(geo.index.array), 1));
  return out;
}

/**
 * Remet le modèle d'aplomb : longueur sur −z, hauteur sur +y, roues au sol.
 *
 * Un GLB généré ne connaît pas le repère du jeu. On ne devine donc pas : on
 * mesure. La plus grande dimension d'une voiture est sa longueur, la plus
 * petite sa hauteur, celle du milieu sa largeur — et cela reste vrai quel que
 * soit le modèle. On construit la rotation qui amène ces trois axes sur les
 * nôtres, puis l'échelle qui donne à la voiture sa vraie taille.
 */
function redresser(geo) {
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const taille = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
  const ordre = [0, 1, 2].sort((i, j) => taille[j] - taille[i]);   // longueur, largeur, hauteur
  const axeLong = ordre[0], axeLarge = ordre[1], axeHaut = ordre[2];
  const base = new THREE.Matrix4();
  const col = (axe) => [axe === 0 ? 1 : 0, axe === 1 ? 1 : 0, axe === 2 ? 1 : 0];
  const [lx, ly, lz] = col(axeLong), [wx, wy, wz] = col(axeLarge), [hx, hy, hz] = col(axeHaut);
  // lignes : x du jeu ← largeur, y ← hauteur, z ← longueur
  base.set(
    wx, wy, wz, 0,
    hx, hy, hz, 0,
    lx, ly, lz, 0,
    0, 0, 0, 1,
  );
  geo.applyMatrix4(base);
  const echelle = LONGUEUR / taille[axeLong];
  geo.scale(echelle, echelle, echelle);
  geo.computeBoundingBox();
  const c = geo.boundingBox;
  // centré en longueur et en largeur, posé sur le sol
  geo.translate(-(c.min.x + c.max.x) / 2, -c.min.y, -(c.min.z + c.max.z) / 2);
  geo.computeBoundingBox();
  return geo.boundingBox;
}

/**
 * Sépare les quatre roues de la carrosserie.
 *
 * Meshy livre un maillage d'un seul tenant : sans découpe, les roues ne
 * tournent pas et ne braquent pas. Mais « d'un seul tenant » n'est pas tout à
 * fait vrai, et c'est ce qui sauve la découpe : **deux des quatre roues sont
 * des pièces séparées** du maillage — elles ne touchent rien. On les prend
 * donc telles quelles, entières, avec leur gomme et leur jante.
 *
 * La méthode précédente cherchait les quatre roues à l'aveugle, par un disque
 * autour d'un axe mesuré sur la boîte englobante. Ce rayon se mesurait à 0,403
 * pour une roue qui en fait 0,337 : le disque avalait un morceau d'aile — qui
 * se mettait à tourner avec la roue — et laissait en arrière la bande de
 * roulement, restée collée à la caisse. D'où des pneus déchiquetés.
 *
 * Trois temps, du plus sûr au moins sûr :
 *
 * 1. **Les pièces détachées du maillage.** Un parcours de connexité donne les
 *    morceaux indépendants ; ceux qui sont bas, sur un flanc, minces et aussi
 *    hauts que longs sont des roues. Rien n'est coupé, rien ne manque.
 * 2. **La mesure de référence.** Ces roues-là donnent le rayon et la largeur
 *    réels — mesurés, plus jamais devinés.
 * 3. **Les roues soudées à la caisse** (l'autre essieu) sont découpées au
 *    **cylindre** de ce rayon : un cylindre exclut l'aile, qui passe au-dessus
 *    du pneu, et le passage de roue, qui est plus à l'intérieur.
 *
 * Si les quatre roues ne sortent pas, on rend `null` : une voiture aux roues
 * figées se voit, mais elle se voit moins qu'une voiture aux pneus en lambeaux.
 *
 * @returns {{corps: THREE.BufferGeometry, roues: Array}} ou null si le repérage échoue
 */
function separerRoues(geo, boite) {
  const pos = geo.attributes.position;
  const index = geo.index;
  const demiLarge = Math.max(Math.abs(boite.min.x), Math.abs(boite.max.x));
  const demiLong = Math.max(Math.abs(boite.min.z), Math.abs(boite.max.z));
  const haut = boite.max.y;
  const n = pos.count;

  // ── 1. les morceaux indépendants du maillage ────────────────────────────
  // Deux sommets au même endroit appartiennent à la même pièce, même si le
  // fichier les compte deux fois : on les soude avant de propager.
  const PAS = 1e-4;                       // 0,1 mm
  const grille = new Map();
  const rep = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const cle = `${Math.round(pos.getX(i) / PAS)},${Math.round(pos.getY(i) / PAS)},${Math.round(pos.getZ(i) / PAS)}`;
    const r = grille.get(cle);
    if (r === undefined) { grille.set(cle, i); rep[i] = i; } else rep[i] = r;
  }
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const racine = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const unir = (a, b) => { a = racine(a); b = racine(b); if (a !== b) parent[b] = a; };
  for (let t = 0; t < index.count; t += 3) {
    const a = rep[index.getX(t)], b = rep[index.getX(t + 1)], c = rep[index.getX(t + 2)];
    unir(a, b); unir(b, c);
  }

  // Boîte de chaque morceau, en un seul passage.
  const morceaux = new Map();
  for (let i = 0; i < n; i++) {
    const r = racine(rep[i]);
    let m = morceaux.get(r);
    if (!m) { m = { n: 0, minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9 }; morceaux.set(r, m); }
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    m.n++;
    if (x < m.minX) m.minX = x;
    if (x > m.maxX) m.maxX = x;
    if (y < m.minY) m.minY = y;
    if (y > m.maxY) m.maxY = y;
    if (z < m.minZ) m.minZ = z;
    if (z > m.maxZ) m.maxZ = z;
  }

  /** Une roue : basse, sur un flanc, mince, et aussi haute que longue. */
  function estUneRoue(m) {
    const lx = m.maxX - m.minX, ly = m.maxY - m.minY, lz = m.maxZ - m.minZ;
    const diametre = Math.max(ly, lz);
    const cx = (m.minX + m.maxX) / 2;
    return m.n > 400
      && m.minY < haut * 0.08                       // elle touche le sol
      && diametre > haut * 0.25 && diametre < haut * 0.80
      && Math.abs(ly - lz) < diametre * 0.22        // un disque, pas une plaque
      && lx < diametre * 0.85                       // et mince
      && Math.abs(cx) > demiLarge * 0.35;           // sur un flanc
  }

  const trouvees = [];
  for (const [r, m] of morceaux) {
    if (!estUneRoue(m)) continue;
    trouvees.push({
      racine: r,
      axe: {
        x: (m.minX + m.maxX) / 2,
        y: (m.minY + m.maxY) / 2,
        z: (m.minZ + m.maxZ) / 2,
        rayon: Math.max(m.maxY - m.minY, m.maxZ - m.minZ) / 2,
        demiLargeur: (m.maxX - m.minX) / 2,
        sx: Math.sign((m.minX + m.maxX) / 2) || 1,
      },
    });
  }
  if (!trouvees.length) return null;

  // ── 2. la mesure de référence ───────────────────────────────────────────
  const RAYON_REF = trouvees.reduce((s, r) => s + r.axe.rayon, 0) / trouvees.length;
  const LARGEUR_REF = trouvees.reduce((s, r) => s + r.axe.demiLargeur, 0) / trouvees.length;
  const zTrouve = trouvees.reduce((s, r) => s + r.axe.z, 0) / trouvees.length;

  // ── 3. l'essieu resté soudé à la caisse ─────────────────────────────────
  // Il est à l'autre bout : on cherche le pic de matière basse et latérale
  // dans la moitié opposée à celle des roues déjà trouvées.
  const axes = trouvees.map((r) => r.axe);
  if (axes.length < 4) {
    const BINS = 48;
    const hist = new Float32Array(BINS);
    for (let i = 0; i < n; i++) {
      if (pos.getY(i) > RAYON_REF * 2.1) continue;
      if (Math.abs(pos.getX(i)) < demiLarge * 0.45) continue;
      const b = Math.min(BINS - 1, Math.max(0, ((pos.getZ(i) + demiLong) / (2 * demiLong) * BINS) | 0));
      hist[b]++;
    }
    // On ignore la bande où sont déjà les roues connues, sinon le pic y retombe.
    const bTrouve = ((zTrouve + demiLong) / (2 * demiLong) * BINS) | 0;
    let best = -1, val = -1;
    for (let b = 2; b < BINS - 2; b++) {
      if (Math.abs(b - bTrouve) < BINS * 0.18) continue;
      if (hist[b] > val) { val = hist[b]; best = b; }
    }
    if (best < 0) return null;
    const zc = (best + 0.5) / BINS * 2 * demiLong - demiLong;

    for (const sx of [-1, 1]) {
      if (axes.some((a) => a.sx === sx && Math.abs(a.z - zc) < RAYON_REF)) continue;
      // Axe : le sol donne la hauteur (bas du pneu + rayon), la gomme la voie.
      let yMin = 1e9, sommeX = 0, nbX = 0;
      for (let i = 0; i < n; i++) {
        const x = pos.getX(i);
        if (Math.sign(x) !== sx || Math.abs(x) < demiLarge * 0.45) continue;
        if (Math.abs(pos.getZ(i) - zc) > RAYON_REF * 0.8) continue;
        const y = pos.getY(i);
        if (y > RAYON_REF * 2.1) continue;
        if (y < yMin) yMin = y;
        if (y < RAYON_REF * 0.55) { sommeX += x; nbX++; }
      }
      if (!nbX) return null;
      axes.push({
        x: sommeX / nbX, y: yMin + RAYON_REF, z: zc,
        rayon: RAYON_REF, demiLargeur: LARGEUR_REF, sx, fondue: true,
      });
    }
  }
  if (axes.length !== 4) return null;

  // ── répartition des triangles ───────────────────────────────────────────
  const corpsIdx = [];
  const roueIdx = axes.map(() => []);
  const parRacine = new Map();
  trouvees.forEach((r, k) => parRacine.set(r.racine, k));

  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    // Un triangle d'une pièce détachée suit sa pièce, sans autre examen.
    const k = parRacine.get(racine(rep[a]));
    if (k !== undefined) { roueIdx[k].push(a, b, c); continue; }
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    let choisie = -1;
    for (let j = 0; j < 4; j++) {
      const w = axes[j];
      if (!w.fondue) continue;                     // déjà servie par la connexité
      if (Math.sign(cx) !== w.sx) continue;
      // **Cylindre**, et non disque : la largeur compte autant que le rayon.
      // L'aile passe au-dessus du pneu (donc hors rayon) et le passage de roue
      // est plus à l'intérieur (donc hors largeur) — les deux sortent.
      if (Math.abs(cx - w.x) > w.demiLargeur * 1.35) continue;
      const dz = cz - w.z, dy = cy - w.y;
      if (dz * dz + dy * dy < (w.rayon * 1.02) ** 2) { choisie = j; break; }
    }
    if (choisie < 0) corpsIdx.push(a, b, c); else roueIdx[choisie].push(a, b, c);
  }
  if (roueIdx.some((r) => r.length < 300)) return null;

  // Rangées comme le jeu les attend : avant gauche, avant droite, arrière
  // gauche, arrière droite. L'avant est en −z.
  const ordre = axes.map((a, i) => i).sort((i, j) =>
    (axes[i].z - axes[j].z) || (axes[i].x - axes[j].x));

  const extraire = (liste, centre) => {
    const g = geo.clone();
    g.setIndex(liste);
    const net = g.toNonIndexed();
    g.dispose();
    if (centre) net.translate(-centre.x, -centre.y, -centre.z);
    net.computeBoundingSphere();
    return net;
  };
  return {
    corps: extraire(corpsIdx, null),
    roues: ordre.map((i) => ({ geo: extraire(roueIdx[i], axes[i]), axe: axes[i] })),
  };
}

/**
 * Construit la voiture.
 *
 * @param {object} opts { renderer, couleur }
 * @returns {object} root, caisse, roues, majRoues, setFreinage, setNuit, setCouleur
 */
export function construireVoiture({ renderer = null, couleur = 0xc21d24 } = {}) {
  const env = environnement(renderer);
  const commun = env ? { envMap: env, envMapIntensity: 1.0 } : {};

  // Peinture métallisée : peu de métal et beaucoup de vernis. À 0,55 de
  // `metalness`, le rouge tourne au plastique chromé ; c'est le `clearcoat` qui
  // fait la carrosserie, pas le métal.
  const peinture = new THREE.MeshPhysicalMaterial({
    color: couleur, metalness: 0.22, roughness: 0.32,
    clearcoat: 1, clearcoatRoughness: 0.04, ...commun,
  });
  const vitre = new THREE.MeshPhysicalMaterial({
    color: 0x0b1116, metalness: 0.35, roughness: 0.06, transparent: true, opacity: 0.62,
    clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide, ...commun,
  });
  const noir = new THREE.MeshStandardMaterial({ color: 0x14171b, metalness: 0.35, roughness: 0.62, ...commun });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 1, roughness: 0.16, ...commun });
  const gomme = new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.02, roughness: 0.92 });
  const jante = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.95, roughness: 0.22, ...commun });
  const disque = new THREE.MeshStandardMaterial({ color: 0x4a4f56, metalness: 0.9, roughness: 0.42 });
  const etrier = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.6, roughness: 0.4 });
  const phare = new THREE.MeshStandardMaterial({
    color: 0xdfeaff, emissive: 0xfff2d0, emissiveIntensity: 0.15, metalness: 0.4, roughness: 0.12, ...commun,
  });
  const feu = new THREE.MeshStandardMaterial({
    color: 0x7a0d12, emissive: 0xff1c10, emissiveIntensity: 0.55, metalness: 0.3, roughness: 0.25,
  });

  const root = new THREE.Group();
  root.name = 'voiture';
  const caisse = new THREE.Group();          // tout ce qui se penche dans les virages
  root.add(caisse);
  // Tout le procédural vit dans ce groupe : quand le modèle Meshy arrive, il
  // suffit de l'éteindre. C'est lui qu'on voit si le GLB manque à l'appel —
  // comme l'habillage CSS du cockpit quand son modèle ne charge pas.
  const secours = new THREE.Group();
  caisse.add(secours);

  // ── coque et habitacle ───────────────────────────────────────────────────
  const bas = loft(COQUE, 28, (z, y) => (y < 0.16 ? null : 'peinture'));
  const meshBas = new THREE.Mesh(bas.geo, bas.ordre.map(() => peinture));
  meshBas.castShadow = true; meshBas.receiveShadow = true;
  secours.add(meshBas);

  // Pavillon peint, reste vitré. Le pare-brise (z < 0) garde du verre jusqu'en
  // haut : le peindre reviendrait à rouler avec une casquette sur les yeux.
  const haut = loft(HABITACLE, 24, (z, y, x) => {
    if (y < 0.86) return null;                                  // caché dans la coque
    if (z > -0.02 && z < 1.02 && y > 1.16) return 'peinture';    // pavillon
    if (Math.abs(x) > 0.66 && y < 0.95) return 'peinture';       // bas de custode
    return 'vitre';
  });
  const meshHaut = new THREE.Mesh(haut.geo, haut.ordre.map((nom) => (nom === 'vitre' ? vitre : peinture)));
  meshHaut.castShadow = true;
  secours.add(meshHaut);

  // ── montants, pour que le verre ne flotte pas ────────────────────────────
  const montant = (x, z, y, hauteur, inclinaison) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.075, hauteur, 0.11), peinture);
    m.position.set(x, y, z);
    m.rotation.x = inclinaison;
    m.castShadow = true;
    secours.add(m);
  };
  for (const cote of [-1, 1]) {
    montant(cote * 0.735, -0.34, 1.00, 0.44, -0.70);    // montant de pare-brise
    montant(cote * 0.745, 0.95, 1.08, 0.46, 0.72);      // montant arrière (custode)
  }
  // Ligne d'épaule : un jonc qui court sur le flanc, d'une aile à l'autre. C'est
  // le seul détail qui casse le galbe et donne une arête à la lumière ; sans lui,
  // le flanc reste une savonnette quelle que soit la section.
  for (const cote of [-1, 1]) {
    const jonc = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.045, 2.75), peinture);
    jonc.position.set(cote * 0.955, 0.745, 0.0);
    jonc.rotation.x = -0.018;
    jonc.castShadow = true;
    secours.add(jonc);
  }

  // ── détails ──────────────────────────────────────────────────────────────
  const piece = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    secours.add(m);
    return m;
  };

  piece(new THREE.BoxGeometry(1.24, 0.20, 0.10), noir, 0, 0.55, -2.09, 0.12);        // calandre
  piece(new THREE.BoxGeometry(1.86, 0.06, 0.46), noir, 0, 0.21, -1.92);              // lame avant
  piece(new THREE.BoxGeometry(1.62, 0.24, 0.40), noir, 0, 0.33, 2.02, -0.10);        // diffuseur
  for (const cote of [-1, 1]) {
    piece(new THREE.BoxGeometry(0.10, 0.11, 2.20), noir, cote * 0.955, 0.31, 0.02);  // bas de caisse
    piece(new THREE.BoxGeometry(0.26, 0.06, 0.32), noir, cote * 0.66, 0.845, -1.18, -0.05); // extracteur de capot
    piece(new THREE.CylinderGeometry(0.058, 0.062, 0.14, 14), chrome,
      cote * 0.36, 0.36, 2.20, Math.PI / 2);                                         // sortie d'échappement
    // rétroviseur : une tige et une coquille, c'est ce qui fait la silhouette
    piece(new THREE.BoxGeometry(0.11, 0.035, 0.05), noir, cote * 0.90, 0.95, -0.50, 0, 0, cote * 0.12);
    piece(new THREE.BoxGeometry(0.16, 0.10, 0.08), peinture, cote * 0.99, 0.97, -0.52, 0, cote * 0.18, 0);
    // poignée de porte
    piece(new THREE.BoxGeometry(0.03, 0.035, 0.16), chrome, cote * 0.94, 0.80, 0.18);
  }

  // Becquet de coffre : un simple bec, il suffit à donner l'arrière d'une GT.
  piece(new THREE.BoxGeometry(1.56, 0.055, 0.30), peinture, 0, 0.94, 1.76, -0.16);

  // Feux : deux fentes effilées devant, encastrées dans l'aile et inclinées vers
  // le nez — un bloc blanc posé à plat sur la calandre donne un regard de jouet.
  const phares = [];
  for (const cote of [-1, 1]) {
    piece(new THREE.BoxGeometry(0.46, 0.115, 0.16), noir, cote * 0.56, 0.715, -1.99, -0.08, cote * 0.17, cote * 0.06);
    phares.push(piece(new THREE.BoxGeometry(0.40, 0.062, 0.10), phare,
      cote * 0.56, 0.725, -2.02, -0.08, cote * 0.17, cote * 0.06));
    // filet de jour, sous le phare : deux traits fins qui dessinent le regard
    phares.push(piece(new THREE.BoxGeometry(0.30, 0.028, 0.05), phare,
      cote * 0.62, 0.635, -2.03, 0, cote * 0.17, cote * 0.10));
  }
  const barre = piece(new THREE.BoxGeometry(1.58, 0.085, 0.06), feu, 0, 0.79, 2.16);
  const feux = [barre];
  for (const cote of [-1, 1]) feux.push(piece(new THREE.BoxGeometry(0.22, 0.14, 0.06), feu, cote * 0.62, 0.66, 2.15));

  // ── roues ────────────────────────────────────────────────────────────────
  /** Une roue : moyeu (qui braque), disque et étrier fixes, pneu et jante qui tournent. */
  function construireRoue(largeur) {
    const moyeu = new THREE.Group();
    const tourne = new THREE.Group();
    moyeu.add(tourne);

    const pneu = new THREE.Mesh(new THREE.CylinderGeometry(RAYON, RAYON, largeur, 26), gomme);
    pneu.rotation.z = Math.PI / 2;
    pneu.castShadow = true;
    tourne.add(pneu);

    const voile = new THREE.Mesh(new THREE.CylinderGeometry(RAYON * 0.68, RAYON * 0.68, largeur * 0.96, 22), jante);
    voile.rotation.z = Math.PI / 2;
    tourne.add(voile);
    // cinq branches : au-delà, on ne les distingue plus et l'on paie des triangles
    for (let k = 0; k < 5; k++) {
      const branche = new THREE.Mesh(new THREE.BoxGeometry(0.055, RAYON * 1.28, largeur * 0.55), jante);
      branche.rotation.x = (k * Math.PI * 2) / 5;
      branche.position.x = largeur * 0.18;
      tourne.add(branche);
    }
    const disqueMesh = new THREE.Mesh(new THREE.CylinderGeometry(RAYON * 0.62, RAYON * 0.62, 0.035, 20), disque);
    disqueMesh.rotation.z = Math.PI / 2;
    moyeu.add(disqueMesh);
    const etrierMesh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.10), etrier);
    etrierMesh.position.set(0, RAYON * 0.5, -0.06);
    moyeu.add(etrierMesh);

    return { moyeu, tourne };
  }

  const roues = [];
  for (const [z, cote, largeur] of [
    [ESSIEU_AV, -1, 0.255], [ESSIEU_AV, 1, 0.255],
    [ESSIEU_AR, -1, 0.295], [ESSIEU_AR, 1, 0.295],
  ]) {
    const r = construireRoue(largeur);
    r.moyeu.position.set(cote * VOIE, RAYON, z);
    r.avant = z < 0;
    r.cote = cote;
    root.add(r.moyeu);
    roues.push(r);
    // aile élargie autour du passage de roue : la voiture paraît plus large au sol
    piece(new THREE.BoxGeometry(0.06, 0.09, 0.86), noir, cote * 0.99, 0.60, z, 0, 0, cote * 0.22);
  }

  // ── ombre de contact ─────────────────────────────────────────────────────
  // Posée à plat sous la voiture, elle l'ancre au sol même quand les ombres
  // portées sont coupées (téléphone) ou que le soleil est rasant.
  const tache = document.createElement('canvas');
  tache.width = tache.height = 64;
  const tg = tache.getContext('2d');
  const rad = tg.createRadialGradient(32, 32, 2, 32, 32, 31);
  rad.addColorStop(0, 'rgba(0,0,0,.55)');
  rad.addColorStop(0.55, 'rgba(0,0,0,.28)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  tg.fillStyle = rad;
  tg.fillRect(0, 0, 64, 64);
  const ombre = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 5.0),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(tache), transparent: true, depthWrite: false, opacity: 0.85,
    }),
  );
  ombre.rotation.x = -Math.PI / 2;
  ombre.renderOrder = 2;

  // ── commandes d'affichage ────────────────────────────────────────────────
  let nuit = false;
  let rapportRoue = 1;          // rayon physique / rayon du modèle : les roues ne patinent pas
  const basRoue = [RAYON, RAYON, RAYON, RAYON];

  /**
   * Place les roues : braquage des avants, rotation des quatre, écrasement de
   * suspension (mètres, positif = roue remontée dans son passage).
   */
  function majRoues(braquage, rotation, debattement) {
    for (let i = 0; i < 4; i++) {
      const r = roues[i];
      if (r.avant) r.moyeu.rotation.y = braquage;
      // `rapportRoue` : si la roue du modèle n'a pas le rayon de la physique,
      // elle tournerait trop vite ou trop lentement — et cela se voit.
      r.tourne.rotation.x = rotation * rapportRoue;
      if (debattement) r.moyeu.position.y = basRoue[i] + debattement[i];
    }
  }

  // ── éclairage de la carrosserie chargée ──────────────────────────────────
  // Le modèle généré n'a pas de feux : ses optiques sont peintes dans la
  // texture, donc éteintes par définition. On les rallume — deux disques
  // lumineux devant, deux rouges derrière, leur halo, et deux vrais faisceaux
  // qui éclairent la chaussée. Tout est placé d'après la boîte englobante du
  // modèle : rien n'est codé en dur pour cette voiture-là.
  let optiqueAv = null, optiqueAr = null, faisceaux = [], halos = [];

  /** Texture de halo : un point lumineux qui se voit de loin, additif. */
  function halo() {
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

  function installerFeux(boite) {
    const largeur = boite.max.x - boite.min.x, hauteur = boite.max.y;
    const nez = boite.min.z, poupe = boite.max.z;
    const texHalo = halo();

    optiqueAv = new THREE.MeshBasicMaterial({ color: 0xfff4d8, transparent: true, opacity: 0.0 });
    optiqueAr = new THREE.MeshBasicMaterial({ color: 0xff2a14, transparent: true, opacity: 0.0 });

    for (const cote of [-1, 1]) {
      const x = cote * largeur * 0.30;
      // optique avant : un disque posé sur le nez, tourné vers l'avant
      const av = new THREE.Mesh(new THREE.CircleGeometry(0.115, 18), optiqueAv);
      av.position.set(x, hauteur * 0.50, nez - 0.02);
      av.rotation.y = Math.PI;
      caisse.add(av);
      // optique arrière
      const ar = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.11), optiqueAr);
      ar.position.set(cote * largeur * 0.28, hauteur * 0.58, poupe + 0.02);
      caisse.add(ar);

      // halos : c'est eux qu'on voit à cent mètres, pas les disques
      for (const [couleur, pos, taille] of [
        [0xfff0cc, [x, hauteur * 0.50, nez - 0.05], 0.85],
        [0xff2a14, [cote * largeur * 0.28, hauteur * 0.58, poupe + 0.05], 0.55],
      ]) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: texHalo, color: couleur, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        sp.position.set(pos[0], pos[1], pos[2]);
        sp.scale.setScalar(taille);
        sp.userData.arriere = couleur !== 0xfff0cc;
        caisse.add(sp);
        halos.push(sp);
      }

      // faisceau : une vraie lumière, qui éclaire la chaussée devant
      const spot = new THREE.SpotLight(0xfff2d6, 0, 70, 0.46, 0.55, 1.1);
      // Un cran DEVANT le nez, et un peu plus bas : posée sur la tôle, la lampe
      // éclairait le capot de la voiture elle-même, qui blanchissait de nuit.
      spot.position.set(x, hauteur * 0.44, nez - 0.25);
      spot.target.position.set(cote * 0.9, -0.4, nez - 18);
      spot.castShadow = false;             // deux ombres de plus par image, pour rien
      caisse.add(spot);
      caisse.add(spot.target);
      faisceaux.push(spot);
    }
  }

  /** Feux stop : les optiques arrière doublent d'intensité au freinage. */
  function setFreinage(actif) {
    const cible = actif ? 2.6 : (nuit ? 0.75 : 0.5);
    if (feu.emissiveIntensity !== cible) feu.emissiveIntensity = cible;
    if (optiqueAr) {
      // De jour, un feu stop se voit quand même : c'est même à cela qu'il sert.
      const o = actif ? 0.95 : (nuit ? 0.42 : 0);
      if (optiqueAr.opacity !== o) optiqueAr.opacity = o;
      for (const h of halos) if (h.userData.arriere) h.material.opacity = actif ? 0.8 : (nuit ? 0.3 : 0);
    }
  }

  /** Phares allumés la nuit — et une barre arrière un peu plus vive. */
  function setNuit(actif) {
    if (nuit === actif) return;
    nuit = actif;
    phare.emissiveIntensity = actif ? 2.2 : 0.15;
    feu.emissiveIntensity = actif ? 0.75 : 0.5;
    // L'environnement de réflexion est un ciel de **jour** : gardé tel quel la
    // nuit, la carrosserie continue d'y refléter un plein midi et vire au bleu
    // lumineux au milieu d'un village éteint.
    if (toleMeshy) toleMeshy.envMapIntensity = actif ? 0.10 : 0.55;
    if (optiqueAv) optiqueAv.opacity = actif ? 1 : 0;
    if (optiqueAr) optiqueAr.opacity = actif ? 0.42 : 0;
    for (const s of faisceaux) s.intensity = actif ? 90 : 0;
    for (const h of halos) h.material.opacity = actif ? (h.userData.arriere ? 0.3 : 0.55) : 0;
  }

  let toleMeshy = null;
  const texturesTeintes = {};        // teinte → texture repeinte, calculée une seule fois
  let teinteCourante = 'rouge';
  let teinteDemandee = null;        // couleur voulue avant que le modèle soit là

  /**
   * Repeint la voiture. La première demande d'une couleur coûte le temps d'un
   * balayage de la texture (2048², une poignée de dizaines de millisecondes),
   * les suivantes sont gratuites : on garde la texture obtenue.
   */
  function setTeinte(nom) {
    if (!(nom in TEINTES)) return teinteCourante;
    // **La demande peut arriver avant la carrosserie.** Dans les Mondes, le mode
    // choisit la voiture au lancement, alors que le GLB met encore une seconde à
    // venir : sans mémoire, la peinture était simplement perdue et la berline
    // bleue arrivait rouge.
    if (!toleMeshy) { teinteDemandee = nom; return nom; }
    if (nom === teinteCourante) return teinteCourante;
    const base = texturesTeintes.rouge || toleMeshy.map;
    if (!base || !base.image) return teinteCourante;
    texturesTeintes.rouge = base;
    if (!texturesTeintes[nom]) {
      texturesTeintes[nom] = repeindre(base.image, TEINTES[nom]);
    }
    toleMeshy.map = texturesTeintes[nom];
    toleMeshy.needsUpdate = true;
    teinteCourante = nom;
    return teinteCourante;
  }
  /** Change la teinte de la carrosserie — modèle Meshy comme coque de secours. */
  function setCouleur(c) {
    peinture.color.set(c);
    if (toleMeshy) toleMeshy.color.set(c);
  }

  // ── la vraie carrosserie prend la place de celle de code ─────────────────
  /**
   * Charge le GLB, le remet d'aplomb, en sépare les roues et les monte sur les
   * moyeux existants. Tout le reste du jeu — physique, caméra, suspension — ne
   * voit aucune différence : seul le maillage change de main.
   */
  async function charger(url = MODELE) {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    let source = null;
    gltf.scene.traverse((o) => { if (o.isMesh && !source) source = o; });
    if (!source) throw new Error('GLB sans maillage');

    const geo = enFlottants(source.geometry);
    if (!geo.index) {
      // Un maillage non indexé se découpe aussi bien, une fois numéroté.
      const n = geo.attributes.position.count;
      const suite = new Uint32Array(n);
      for (let i = 0; i < n; i++) suite[i] = i;
      geo.setIndex(new THREE.BufferAttribute(suite, 1));
    }
    geo.applyMatrix4(source.matrixWorld);
    const boite = redresser(geo);

    // Matière : Meshy cuit metalness = roughness = 1, ce qui rend la tôle
    // charbonneuse. On rabat les facteurs et on ajoute un vernis — c'est ce
    // vernis qui distingue une carrosserie d'une caisse en plastique.
    const src = source.material;
    const tole = new THREE.MeshPhysicalMaterial({
      map: src.map || null,
      // Pas de carte de normales : elle est faite pour le maillage d'origine à
      // 862 000 triangles. Sur le maillage décimé, ses détails ne tombent plus
      // au bon endroit et la carrosserie se couvre de plaques laiteuses.
      normalMap: null,
      // **Pas de `roughnessMap` non plus**, et c'est la correction qui change
      // tout. Three.js *multiplie* le facteur par la carte : celle de Meshy
      // vaut 0,33 en moyenne et descend à 0,09, si bien que le « roughness :
      // 0,86 » censé mater la tôle donnait en réalité 0,28 en moyenne et 0,08
      // par endroits. Une carrosserie à 0,08 de rugosité est un miroir : elle
      // prenait la couleur du ciel, paraissait mouillée, et par transparence
      // on croyait voir au travers. Mesuré sur la carte, pas supposé.
      roughnessMap: null,
      // Pas de `metalnessMap` : Meshy la cuit à 1 partout. Gardée, elle rend la
      // voiture chromée — la peinture disparaît sous le reflet du ciel et la
      // carrosserie devient blanc-bleu, quelle que soit sa couleur réelle.
      color: TEINTE,
      // Une peinture de voiture, c'est un pigment mat sous un vernis : métal à
      // zéro, rugosité franche, et tout le brillant porté par le `clearcoat`.
      // C'est lui qui fait le reflet long sur une aile, sans transformer la
      // tôle en chrome.
      metalness: 0.0, roughness: 0.58,
      clearcoat: 0.55, clearcoatRoughness: 0.22,
      // `DoubleSide` reste nécessaire : la décimation a retourné une partie
      // des faces, et en `FrontSide` la carrosserie se troue — on voit
      // l'habitacle et le flanc opposé au travers. Ce n'était donc pas elle
      // qui donnait l'impression de transparence, c'était le miroir.
      side: THREE.DoubleSide,
      ...commun, envMapIntensity: 0.30,
    });

    toleMeshy = tole;
    if (teinteDemandee) { const voulue = teinteDemandee; teinteDemandee = null; setTeinte(voulue); }
    const decoupe = separerRoues(geo, boite);
    if (!decoupe) {
      // Repérage raté : plutôt une voiture entière aux roues figées qu'une
      // voiture amputée. On garde le maillage tel quel.
      const entier = new THREE.Mesh(geo, tole);
      entier.castShadow = true; entier.receiveShadow = true;
      caisse.add(entier);
      secours.visible = false;
      for (const r of roues) r.moyeu.visible = false;
      return { roues: 0 };
    }

    const corps = new THREE.Mesh(decoupe.corps, tole);
    corps.castShadow = true; corps.receiveShadow = true;
    caisse.add(corps);
    secours.visible = false;

    for (let i = 0; i < 4; i++) {
      const { geo: gr, axe } = decoupe.roues[i];
      const r = roues[i];
      r.tourne.clear();
      r.moyeu.clear();
      r.moyeu.add(r.tourne);
      const m = new THREE.Mesh(gr, tole);
      m.castShadow = true;
      r.tourne.add(m);
      r.moyeu.position.set(axe.x, axe.y, axe.z);
      basRoue[i] = axe.y;
      r.avant = axe.z < 0;
    }
    rapportRoue = RAYON / decoupe.roues[0].axe.rayon;
    // L'ombre de contact reprend l'empreinte réelle du modèle.
    installerFeux(boite);
    if (nuit) { nuit = false; setNuit(true); }   // la nuit était peut-être déjà tombée
    ombre.scale.set((boite.max.x - boite.min.x) / 2.6 * 1.15, (boite.max.z - boite.min.z) / 5.0 * 1.1, 1);
    return {
      roues: 4,
      essieux: decoupe.roues.map((r) => ({ ...r.axe })),
      taille: { longueur: boite.max.z - boite.min.z, largeur: boite.max.x - boite.min.x, hauteur: boite.max.y },
    };
  }
  const pret = charger().catch((err) => {
    console.warn('Voiture : modèle 3D indisponible, coque de secours', err);
    return null;
  });

  return {
    root, caisse, roues, ombre, phares, feux, pret,
    majRoues, setFreinage, setNuit, setCouleur, setTeinte, teinte: () => teinteCourante,
    materiaux: { peinture, vitre, noir, chrome, gomme, jante },
    dimensions: { longueur: 4.4, largeur: 1.98, empattement: ESSIEU_AR - ESSIEU_AV, rayonRoue: RAYON },
  };
}
