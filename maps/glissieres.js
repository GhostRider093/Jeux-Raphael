/**
 * Glissières de sécurité le long de toutes les rues — Poilhes City.
 *
 * Demande d'Arnaud (25/09/2026) : « des glissières toutes petites, qui
 * permettent de maintenir la voiture sur la route même si on se trompe. Il
 * faut rendre la jouabilité accessible. » Deux choses, tirées de la même
 * source :
 *
 *   1. **Ce qu'on voit** — une lame de métal galvanisé de 13 cm, culminant à
 *      34 cm, sur des poteaux tous les 3 m, posée 35 cm au-delà du bord de la
 *      chaussée. Petite : elle borde la rue, elle ne la cache pas.
 *   2. **Ce qui retient** — une grille au demi-mètre (`glissiereAt`) marquant
 *      une bande de 2,4 m derrière chaque lame. Le pilote la lit comme un mur
 *      (`voiture-pilote.js`, `obstacleAt`) : avec l'assistance, la glissière
 *      est un rail et la voiture continue sa route ; sans, elle est renvoyée.
 *      La bande est épaisse pour qu'une voiture qui s'y retrouve — après un
 *      saut, un `R` — soit poussée **vers la route**, jamais vers le jardin.
 *
 * La source est le ruban de chaussée de `scripts/poilhes/roads.py` : neuf
 * sommets par section de 3 m, la colonne 4 sur l'axe, les colonnes 2 et 6 aux
 * bords (u = ∓1). Rien n'est régénéré côté Python : tout se lit dans
 * `routes_pos` / `routes_info` / `routes_fin` déjà chargés.
 *
 * Où il n'y a **pas** de glissière, et pourquoi :
 *   - à moins de 2 m du bout d'un tronçon : les tronçons de la BD TOPO
 *     s'arrêtent aux carrefours, c'est là qu'on tourne ;
 *   - quand 2 m derrière la lame il y a une autre chaussée (rue qui débouche,
 *     béton du skatepark) : on doit pouvoir y entrer ;
 *   - quand la lame tomberait dans un mur ou dans l'eau : la façade fait déjà
 *     le travail, et une glissière qui sort d'une maison est ridicule.
 *   - la bande physique ne marque jamais une cellule de chaussée : une rue ne
 *     se bouche pas.
 */
import * as THREE from 'three';

export const GLISSIERE = {
  hauteur: 0.34,     // sommet de la lame (m)
  lame: 0.13,        // hauteur de la lame (m)
  bombe: 0.03,       // saillie du pli central de la lame (m) : un W, pas une planche
  poteau: 0.07,      // côté du poteau (m)
  ecart: 0.35,       // recul de la lame derrière le bord de chaussée (m)
  retenue: 2.4,      // épaisseur de la bande physique derrière la lame (m)
  bout: 2.0,         // pas de glissière à moins de N m du bout d'un tronçon
  debouche: 2.0,     // « autre chaussée derrière ? » se teste à N m derrière la lame
  pas: 0.5,          // taille d'une cellule de la grille physique (m)
};

const COLS = 9;      // sommets par section (PROFIL de roads.py)
const AXE = 4, BORD = [2, 6];

/**
 * @param {object} o
 * @param {object} o.decor       retour de `construireVillage` (arr, detail, root)
 * @param {Function} [o.surRoute]  (x, z) => bool, grille des chaussées de `creerAdherence`
 * @param {Function} [o.blockedAt] (x, z) => bool, murs et eau du décor
 * @param {boolean}  [o.ombres]   les poteaux et la lame portent une ombre
 * @returns {{ root: THREE.Group, glissiereAt: Function, segments: number, longueur: number }}
 */
export function creerGlissieres({ decor, surRoute = null, blockedAt = () => false, ombres = true }) {
  const G = GLISSIERE;
  const root = new THREE.Group();
  root.name = 'glissieres';
  let pos, info, fin;
  try { pos = decor.arr('routes_pos'); info = decor.arr('routes_info'); fin = decor.arr('routes_fin'); }
  catch (e) { pos = null; }
  const vide = () => ({ root, glissiereAt: () => false, segments: 0, longueur: 0 });
  if (!pos || !pos.length) return vide();

  const demi = decor.detail || 500;
  const n = Math.ceil((demi * 2) / G.pas);
  const grille = new Uint8Array(n * n);
  const marquer = (x, z) => {
    if (surRoute && surRoute(x, z)) return;         // jamais sur une chaussée
    const c = Math.floor((x + demi) / G.pas), r = Math.floor((z + demi) / G.pas);
    if (c >= 0 && r >= 0 && c < n && r < n) grille[r * n + c] = 1;
  };
  /** Vrai si (x, z) est dans la bande de retenue d'une glissière. */
  function glissiereAt(x, z) {
    const c = Math.floor((x + demi) / G.pas), r = Math.floor((z + demi) / G.pas);
    if (c < 0 || r < 0 || c >= n || r >= n) return false;
    return grille[r * n + c] === 1;
  }

  const rows = (pos.length / 3 / COLS) | 0;
  const X = (r, c) => pos[(r * COLS + c) * 3];
  const Y = (r, c) => pos[(r * COLS + c) * 3 + 1];
  const Z = (r, c) => pos[(r * COLS + c) * 3 + 2];
  const S = (r) => info[(r * COLS) * 4 + 1];
  const FIN = (r) => fin[r * COLS];

  /** Point de lame d'une section, d'un côté : position et normale sortante. */
  function pointLame(r, cote) {
    const c = BORD[cote];
    let nx = X(r, c) - X(r, AXE), nz = Z(r, c) - Z(r, AXE);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    return { x: X(r, c) + nx * G.ecart, y: Y(r, c) - 0.01, z: Z(r, c) + nz * G.ecart, nx, nz };
  }
  /** Une lame a-t-elle sa place ici ? (voir l'en-tête) */
  function admis(p, r) {
    if (FIN(r) < G.bout) return false;
    if (blockedAt(p.x, p.z) || blockedAt(p.x + p.nx * 0.6, p.z + p.nz * 0.6)) return false;
    if (surRoute && surRoute(p.x + p.nx * G.debouche, p.z + p.nz * G.debouche)) return false;
    return true;
  }

  // ── parcours des sections ────────────────────────────────────────────────
  const lamePos = [], lameNor = [], lameIdx = [];
  const poteaux = [];                    // { x, y, z, cap }
  const posteVu = new Set();
  let segments = 0, longueur = 0;
  const hb = G.hauteur - G.lame, hm = G.hauteur - G.lame / 2, ht = G.hauteur;

  function ajouterLame(p0, p1) {
    // Trois sommets par bout : bas, pli (saillant), haut → deux quads en V.
    const base = lamePos.length / 3;
    for (const p of [p0, p1]) {
      lamePos.push(p.x, p.y + hb, p.z,
                   p.x + p.nx * G.bombe, p.y + hm, p.z + p.nz * G.bombe,
                   p.x, p.y + ht, p.z);
      for (let k = 0; k < 3; k++) lameNor.push(p.nx, 0, p.nz);
    }
    // p0: base+0..2, p1: base+3..5
    lameIdx.push(base, base + 3, base + 1, base + 1, base + 3, base + 4,
                 base + 1, base + 4, base + 2, base + 2, base + 4, base + 5);
  }
  function ajouterPoteau(r, cote, p, cap) {
    const cle = r * 2 + cote;
    if (posteVu.has(cle)) return;
    posteVu.add(cle);
    poteaux.push({ x: p.x, y: p.y, z: p.z, cap });
  }

  for (let r = 0; r + 1 < rows; r++) {
    if (!(S(r + 1) > S(r))) continue;    // changement de tronçon
    for (let cote = 0; cote < 2; cote++) {
      const p0 = pointLame(r, cote), p1 = pointLame(r + 1, cote);
      if (!admis(p0, r) || !admis(p1, r + 1)) continue;
      const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
      const mnx = (p0.nx + p1.nx) / 2, mnz = (p0.nz + p1.nz) / 2;
      if (surRoute && surRoute(mx + mnx * G.debouche, mz + mnz * G.debouche)) continue;
      if (blockedAt(mx, mz)) continue;

      ajouterLame(p0, p1);
      const cap = Math.atan2(p1.x - p0.x, p1.z - p0.z);
      ajouterPoteau(r, cote, p0, cap);
      ajouterPoteau(r + 1, cote, p1, cap);
      segments++;
      const L = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      longueur += L;

      // Bande de retenue : de la lame vers l'extérieur, au quart de mètre.
      const nt = Math.max(2, Math.ceil(L / 0.25)), nd = Math.ceil(G.retenue / 0.25);
      for (let i = 0; i <= nt; i++) {
        const t = i / nt;
        const bx = p0.x + (p1.x - p0.x) * t, bz = p0.z + (p1.z - p0.z) * t;
        const nx = p0.nx + (p1.nx - p0.nx) * t, nz = p0.nz + (p1.nz - p0.nz) * t;
        for (let j = 0; j <= nd; j++) marquer(bx + nx * j * 0.25, bz + nz * j * 0.25);
      }
    }
  }
  // ── les ponts ────────────────────────────────────────────────────────────
  // Les tabliers n'ont pas de ruban de chaussée (roads.py les saute : ils ont
  // leur propre maillage), donc rien dans `routes_pos` — et « sur les ponts,
  // c'était une catastrophe » (Arnaud, 25/09/2026). `ponts_axes` (build_village)
  // donne l'axe et la largeur de chaque tablier : on pose une lame de chaque
  // côté, juste devant le parapet, et la bande de retenue derrière. Aucune des
  // exclusions des rues ne s'applique : sur un pont, on ne tourne pas.
  let axes = null;
  try { axes = decor.arr('ponts_axes'); } catch (e) { axes = null; }
  if (axes && axes.length) {
    let k = 0, pont = 0;
    while (k + 2 <= axes.length) {
      const n = axes[k] | 0, w = axes[k + 1];
      k += 2;
      const P = [];
      for (let i = 0; i < n && k + 3 <= axes.length; i++, k += 3) P.push({ x: axes[k], y: axes[k + 1], z: axes[k + 2] });
      pont++;
      if (P.length < 2) continue;
      // rééchantillonné tous les 3 m, comme les sections de rue
      const S = [];
      for (let i = 0; i + 1 < P.length; i++) {
        const a = P[i], b = P[i + 1];
        const L = Math.hypot(b.x - a.x, b.z - a.z);
        const m = Math.max(1, Math.round(L / 3));
        for (let j = 0; j < m; j++) {
          const t = j / m;
          S.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / L, tz: (b.z - a.z) / L });
        }
        if (i + 2 === P.length) S.push({ x: b.x, y: b.y, z: b.z, tx: (b.x - a.x) / L, tz: (b.z - a.z) / L });
      }
      const recul = w / 2 - 0.55;          // devant le parapet (35 cm) et son épaisseur
      for (let cote = 0; cote < 2; cote++) {
        const sg = cote === 0 ? 1 : -1;
        const lameDe = (s) => ({ x: s.x + sg * (-s.tz) * recul, y: s.y - 0.01, z: s.z + sg * s.tx * recul, nx: sg * (-s.tz), nz: sg * s.tx });
        for (let i = 0; i + 1 < S.length; i++) {
          const p0 = lameDe(S[i]), p1 = lameDe(S[i + 1]);
          ajouterLame(p0, p1);
          const cap = Math.atan2(p1.x - p0.x, p1.z - p0.z);
          ajouterPoteau(1e6 + pont * 1000 + i, cote, p0, cap);
          ajouterPoteau(1e6 + pont * 1000 + i + 1, cote, p1, cap);
          segments++;
          const L = Math.hypot(p1.x - p0.x, p1.z - p0.z);
          longueur += L;
          const nt = Math.max(2, Math.ceil(L / 0.25)), nd = Math.ceil(G.retenue / 0.25);
          for (let a = 0; a <= nt; a++) {
            const t = a / nt;
            const bx = p0.x + (p1.x - p0.x) * t, bz = p0.z + (p1.z - p0.z) * t;
            for (let j = 0; j <= nd; j++) marquer(bx + p0.nx * j * 0.25, bz + p0.nz * j * 0.25);
          }
        }
      }
    }
  }
  if (!segments) return vide();

  // ── maillages ────────────────────────────────────────────────────────────
  const acier = new THREE.MeshStandardMaterial({
    color: 0xb9c1c7, metalness: 0.72, roughness: 0.36, side: THREE.DoubleSide,
  });
  const geoLame = new THREE.BufferGeometry();
  geoLame.setAttribute('position', new THREE.Float32BufferAttribute(lamePos, 3));
  geoLame.setAttribute('normal', new THREE.Float32BufferAttribute(lameNor, 3));
  geoLame.setIndex(lameIdx);
  const lame = new THREE.Mesh(geoLame, acier);
  lame.name = 'glissieres-lame';
  lame.castShadow = ombres;
  lame.receiveShadow = false;
  lame.frustumCulled = false;            // un seul maillage sur tout le village
  root.add(lame);

  const hPoteau = G.hauteur + 0.15;      // 15 cm enterrés : l'accotement est plus bas que la chaussée
  const geoPoteau = new THREE.BoxGeometry(G.poteau, hPoteau, G.poteau);
  const fonte = new THREE.MeshStandardMaterial({ color: 0x6f777d, metalness: 0.6, roughness: 0.5 });
  const inst = new THREE.InstancedMesh(geoPoteau, fonte, poteaux.length);
  inst.name = 'glissieres-poteaux';
  inst.castShadow = ombres;
  inst.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1);
  const v = new THREE.Vector3();
  for (let i = 0; i < poteaux.length; i++) {
    const p = poteaux[i];
    e.set(0, p.cap, 0);
    q.setFromEuler(e);
    v.set(p.x, p.y + hPoteau / 2 - 0.15, p.z);
    m.compose(v, q, s1);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;
  root.add(inst);

  return { root, glissiereAt, segments, longueur: Math.round(longueur), poteaux: poteaux.length };
}
