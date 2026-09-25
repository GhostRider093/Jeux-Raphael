/**
 * La course sur route — le tracé GPS au sol, et les portes posées dessus.
 *
 * Une course entre deux villages ne se trace pas à la règle. Entre Poilhes et
 * Capestang il y a **une vraie route**, celle qui longe le canal : c'est elle
 * qu'on suit. `scripts/poilhes/route_pays.py` la calcule une fois pour toutes
 * depuis OpenStreetMap — la même carte qui a servi à bâtir les villages — et
 * écrit `maps/pays-<nom>/route.json`. Ici on ne fait que la lire :
 *
 *   — on la dessine au sol, en ruban lumineux qui épouse le relief : c'est la
 *     trace d'un GPS, et il suffit de la suivre ;
 *   — on y pose les portes, à intervalles réguliers **le long du parcours** et
 *     orientées dans le sens de la route, pas face au village suivant.
 *
 * Sans le fichier, on retombe sur les points du catalogue (`courseRoute`) : la
 * course existe toujours, elle est seulement moins fidèle.
 */
import * as THREE from 'three';
import { GLISSIERE } from './glissieres.js?v=pilote-20260925';
import { construireFleches } from './fleches-sol.js?v=arcade-20260926b';

const LARGEUR = 13;          // demi-largeur de la porte (m) : une route, pas un couloir
const HAUTEUR = 7.5;         // hauteur libre sous le portique (m)
const PORTES = 11;           // nombre de portes réparties sur le parcours
const PAS_RUBAN = 9;         // un point de ruban tous les 9 m : le relief est suivi de près
// Largeur du tracé : celle d'une voie, pas celle d'un trait. À 1,9 m de
// demi-largeur il se perdait dans le paysage dès cinquante mètres — or c'est
// justement de loin qu'un guidage sert.
const DEMI_RUBAN = 3.4;

/** Rééchantillonne une polyligne à pas constant, en conservant sa forme. */
function reechantillonner(points, pas) {
  if (points.length < 2) return points.slice();
  const sortie = [points[0].slice()];
  let reste = pas;
  for (let i = 1; i < points.length; i++) {
    let [ax, az] = points[i - 1];
    const [bx, bz] = points[i];
    let d = Math.hypot(bx - ax, bz - az);
    while (d >= reste) {
      const t = reste / d;
      ax += (bx - ax) * t;
      az += (bz - az) * t;
      sortie.push([ax, az]);
      d -= reste;
      reste = pas;
    }
    reste -= d;
  }
  const dernier = points[points.length - 1];
  const fin = sortie[sortie.length - 1];
  if (Math.hypot(dernier[0] - fin[0], dernier[1] - fin[1]) > pas * 0.4) sortie.push(dernier.slice());
  return sortie;
}

/** Longueur cumulée le long d'une polyligne. */
function cumul(points) {
  const s = [0];
  for (let i = 1; i < points.length; i++) {
    s.push(s[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  return s;
}

/**
 * Le ruban lumineux posé sur le relief.
 *
 * Il est construit en une seule géométrie, sans allocation par image : c'est un
 * décor, il ne bouge plus une fois posé. La matière est additive et n'écrit pas
 * dans le tampon de profondeur — sinon un ruban à vingt centimètres du sol
 * clignote contre lui à chaque bosse.
 */
function construireRuban(points, solAt) {
  const positions = [];
  const uv = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const long = Math.hypot(dx, dz) || 1;
    const nx = -dz / long, nz = dx / long;          // normale horizontale
    const y = solAt(x, z) + 0.22;
    positions.push(x + nx * DEMI_RUBAN, y, z + nz * DEMI_RUBAN);
    positions.push(x - nx * DEMI_RUBAN, y, z - nz * DEMI_RUBAN);
    uv.push(0, i / 4.5, 1, i / 4.5);
    if (i > 0) {
      const k = (i - 1) * 2;
      indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // Texture de flèches : le ruban dit aussi dans quel SENS il se parcourt.
  const c = document.createElement('canvas');
  c.width = 32; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#12b866';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.beginPath();
  g.moveTo(16, 10); g.lineTo(28, 34); g.lineTo(16, 27); g.lineTo(4, 34);
  g.closePath();
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  // **Peinture, pas néon.** En additif, le ruban s'ajoutait à une campagne en
  // plein soleil et saturait en blanc : on ne voyait plus ni sa couleur ni ses
  // flèches. Un vrai tracé de GPS est une bande posée sur la carte, opaque et
  // colorée — c'est ce qu'on fait ici.
  const ruban = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: 0.72, depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
  }));
  ruban.name = 'trace-gps';
  ruban.renderOrder = 3;
  ruban.frustumCulled = false;
  return ruban;
}

/** Une porte : portique, fanions, numéro, et le repère attendu par le moteur. */
function construirePorte(index, x, z, y, cap) {
  const couleur = 0x2bd66a;
  const porte = new THREE.Group();
  porte.name = `porte-route-${index + 1}`;
  const matiere = new THREE.MeshStandardMaterial({
    color: couleur, emissive: couleur, emissiveIntensity: 0.45, roughness: 0.35, metalness: 0.2,
  });
  const matiereRepere = new THREE.MeshBasicMaterial({
    color: couleur, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending,
  });
  for (const cote of [-1, 1]) {
    const montant = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, HAUTEUR, 10), matiere);
    montant.position.set(cote * LARGEUR, HAUTEUR / 2, 0);
    montant.castShadow = true;
    // Le moteur règle l'éclat de la porte en cours en écrivant sur le PREMIER
    // enfant : il attend ce repère, hérité des anneaux du circuit aérien.
    if (cote === -1) montant.userData.raceGateRing = { index, baseIntensity: 0.45 };
    porte.add(montant);
  }
  const traverse = new THREE.Mesh(new THREE.BoxGeometry(LARGEUR * 2 + 1, 0.9, 0.7), matiere);
  traverse.position.y = HAUTEUR;
  traverse.castShadow = true;
  porte.add(traverse);
  for (let k = 0; k <= index; k++) {
    const barre = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.8), matiereRepere);
    barre.position.set(-LARGEUR + 1.2 + k * 0.9, HAUTEUR + 0.75, 0);
    porte.add(barre);
  }
  for (const cote of [-1, 1]) {
    const fanion = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.2, 8), matiereRepere);
    fanion.position.set(cote * (LARGEUR + 2.2), HAUTEUR * 0.55, 0);
    porte.add(fanion);
  }
  const lampe = new THREE.PointLight(couleur, 16, 70, 2);
  lampe.position.y = HAUTEUR * 0.8;
  porte.add(lampe);

  porte.position.set(x, y, z);
  porte.rotation.y = cap;
  porte.userData.raceGate = {
    index, radius: LARGEUR, passed: false, missed: false,
    material: matiere, markerMaterial: matiereRepere, beacon: lampe,
  };
  return porte;
}

// ───────────────────────────────────────────────── les glissières de la course
/**
 * **Les seules glissières du jeu** (Arnaud, 26/09/2026 : « on enlève toutes
 * les barrières des routes ; on les laisse que sur la route entre Poilhes et
 * Capestang, où il y a la course, et on la fait très large »).
 *
 * Deux lames suivent le tracé à `COULOIR.demi` mètres de part et d'autre de
 * l'axe — les portes font 13 m de demi-largeur, les lames passent donc
 * derrière leurs piliers. Seulement dans la campagne : dans les villages, pas
 * de glissière.
 *
 * Ce qu'on rend au pilote, sur une grille au mètre :
 *   — `glissiereAt` : la bande de retenue derrière chaque lame, lue comme un
 *     mur par `voiture-pilote.js` (réponse douce, `railGlissiere`) ;
 *   — `couloirAt` : tout l'intérieur du couloir compte comme chaussée. Hors
 *     village, il n'y a pas de ruban de route dans les données : sans cela,
 *     toute la course se roulerait avec l'adhérence (et la vitesse) de l'herbe.
 */
export const COULOIR = {
  demi: 14,          // m de l'axe à chaque lame
  retenue: 3,        // m de bande de retenue derrière la lame
  pas: 1,            // m, maille de la grille
  lisse: 4,          // points (de 3 m) de part et d'autre pour lisser la direction
  tronconMin: 24,    // m : une lame plus courte n'est pas posée (morceau isolé)
};

function construireGlissieresCourse(points, { solAt, horsVillage, ombres = true }) {
  const C = COULOIR, G = GLISSIERE;
  const P = reechantillonner(points, 3);
  const nP = P.length;
  // Direction lissée : un virage sec du tracé ne doit pas faire sauter la lame.
  const T = P.map((_, i) => {
    const a = P[Math.max(0, i - C.lisse)], b = P[Math.min(nP - 1, i + C.lisse)];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  });

  // ── la grille, sur l'emprise du tracé ────────────────────────────────────
  const marge = C.demi + C.retenue + 3;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of P) { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x); z1 = Math.max(z1, z); }
  x0 -= marge; z0 -= marge; x1 += marge; z1 += marge;
  const nc = Math.ceil((x1 - x0) / C.pas), nr = Math.ceil((z1 - z0) / C.pas);
  const grille = new Uint8Array(nc * nr);        // 1 = couloir, 2 = retenue
  const cellule = (x, z) => {
    const c = Math.floor((x - x0) / C.pas), r = Math.floor((z - z0) / C.pas);
    return c < 0 || r < 0 || c >= nc || r >= nr ? -1 : r * nc + c;
  };
  const lire = (x, z) => { const k = cellule(x, z); return k < 0 ? 0 : grille[k]; };

  // Le couloir : l'axe balayé sur toute la largeur, hors villages.
  for (let i = 0; i + 1 < nP; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / L, nz = (bx - ax) / L;
    for (let t = 0; t <= L; t += 0.5) {
      const px = ax + (bx - ax) * (t / L), pz = az + (bz - az) * (t / L);
      for (let u = -C.demi; u <= C.demi; u += 0.5) {
        const qx = px + nx * u, qz = pz + nz * u;
        if (!horsVillage(qx, qz)) continue;
        const k = cellule(qx, qz);
        if (k >= 0) grille[k] = 1;
      }
    }
  }

  /** Distance de (x, z) à l'axe du tracé (au point rééchantillonné près). */
  function distanceAxe(x, z) {
    let d2 = Infinity;
    for (let i = 0; i < nP; i++) {
      const dx = P[i][0] - x, dz = P[i][1] - z;
      const d = dx * dx + dz * dz;
      if (d < d2) d2 = d;
    }
    return Math.sqrt(d2);
  }

  // ── les lames ────────────────────────────────────────────────────────────
  const lamePos = [], lameNor = [], lameIdx = [];
  const poteaux = [];
  const hb = G.hauteur - G.lame, hm = G.hauteur - G.lame / 2, ht = G.hauteur;
  let longueur = 0, segments = 0;

  for (const cote of [1, -1]) {
    // Les points de lame admis de ce côté : hors village, et pas rabattus sur
    // l'axe par l'intérieur d'un virage (la lame y croiserait le tracé).
    const Q = P.map(([x, z], i) => {
      const nx = -T[i][1] * cote, nz = T[i][0] * cote;
      const px = x + nx * C.demi, pz = z + nz * C.demi;
      const ok = horsVillage(px, pz) && distanceAxe(px, pz) > C.demi * 0.85;
      return ok ? { x: px, y: solAt(px, pz) - 0.01, z: pz, nx, nz } : null;
    });
    // Des tronçons continus ; les trop courts sont laissés de côté.
    let debut = 0;
    for (let i = 0; i <= nP; i++) {
      if (i < nP && Q[i]) continue;
      const fin = i - 1;
      if (fin - debut >= 1 && (fin - debut) * 3 >= C.tronconMin) {
        for (let j = debut; j < fin; j++) {
          const p0 = Q[j], p1 = Q[j + 1];
          const L = Math.hypot(p1.x - p0.x, p1.z - p0.z);
          if (L > 8 || L < 0.01) continue;         // saut au passage d'un virage : pas de lame
          const base = lamePos.length / 3;
          for (const p of [p0, p1]) {
            lamePos.push(p.x, p.y + hb, p.z,
                         p.x + p.nx * G.bombe, p.y + hm, p.z + p.nz * G.bombe,
                         p.x, p.y + ht, p.z);
            for (let q = 0; q < 3; q++) lameNor.push(p.nx, 0, p.nz);
          }
          lameIdx.push(base, base + 3, base + 1, base + 1, base + 3, base + 4,
                       base + 1, base + 4, base + 2, base + 2, base + 4, base + 5);
          poteaux.push({ x: p0.x, y: p0.y, z: p0.z, cap: Math.atan2(p1.x - p0.x, p1.z - p0.z) });
          segments++;
          longueur += L;
          // Bande de retenue : de la lame vers l'extérieur, jamais sur le couloir.
          for (let t = 0; t <= L; t += 0.5) {
            const bx = p0.x + (p1.x - p0.x) * (t / L), bz = p0.z + (p1.z - p0.z) * (t / L);
            for (let d = 0.3; d <= C.retenue; d += 0.5) {
              const k = cellule(bx + p0.nx * d, bz + p0.nz * d);
              if (k >= 0 && grille[k] !== 1) grille[k] = 2;
            }
          }
        }
      }
      debut = i + 1;
    }
  }

  const root = new THREE.Group();
  root.name = 'glissieres-course';
  if (segments) {
    const acier = new THREE.MeshStandardMaterial({
      color: 0xb9c1c7, metalness: 0.72, roughness: 0.36, side: THREE.DoubleSide,
    });
    const geoLame = new THREE.BufferGeometry();
    geoLame.setAttribute('position', new THREE.Float32BufferAttribute(lamePos, 3));
    geoLame.setAttribute('normal', new THREE.Float32BufferAttribute(lameNor, 3));
    geoLame.setIndex(lameIdx);
    const lame = new THREE.Mesh(geoLame, acier);
    lame.castShadow = ombres;
    lame.frustumCulled = false;
    root.add(lame);

    const hPoteau = G.hauteur + 0.15;
    const inst = new THREE.InstancedMesh(
      new THREE.BoxGeometry(G.poteau, hPoteau, G.poteau),
      new THREE.MeshStandardMaterial({ color: 0x6f777d, metalness: 0.6, roughness: 0.5 }),
      poteaux.length);
    inst.castShadow = ombres;
    inst.frustumCulled = false;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), un = new THREE.Vector3(1, 1, 1);
    const v = new THREE.Vector3();
    poteaux.forEach((p, i) => {
      q.setFromEuler(e.set(0, p.cap, 0));
      m.compose(v.set(p.x, p.y + hPoteau / 2 - 0.15, p.z), q, un);
      inst.setMatrixAt(i, m);
    });
    inst.instanceMatrix.needsUpdate = true;
    root.add(inst);
  }
  console.info(`[course] glissières : ${segments} lames, ${Math.round(longueur)} m, couloir de ${C.demi * 2} m`);
  return {
    root,
    segments,
    glissiereAt: (x, z) => lire(x, z) === 2,
    couloirAt: (x, z) => lire(x, z) === 1,
  };
}

/**
 * Construit la course : le tracé au sol et ses portes.
 *
 * @param {object} o { world, root, solAt, url, glissieres } — `url` = le route.json du pays ;
 *   `glissieres` = { horsVillage(x, z), ombres } pour poser les glissières de la course
 * @returns {Promise<Array<THREE.Group>>} les portes, dans l'ordre — avec, si
 *   `glissieres` est fourni, `portes.glissieres = { glissiereAt, couloirAt }`
 */
export async function construireCourseRoute({ world, root, solAt, url, glissieres = null }) {
  let points = null;
  if (url) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.points) && data.points.length > 1) points = data.points;
      }
    } catch (e) { /* pas d'itinéraire : on retombe sur le catalogue */ }
  }
  // Repli : les points écrits à la main dans le catalogue.
  if (!points) points = (world.courseRoute || []).map((p) => [p.x, p.z]);
  if (points.length < 2) return [];

  // Le ruban suit la route de près ; les portes, elles, sont espacées.
  const fin = reechantillonner(points, PAS_RUBAN);
  // Plus de bande verte (Arnaud, 26/09/2026 : « horrible, ça gâche le
  // spectacle ») : seulement ses flèches, jaunes et bien visibles.
  // `construireRuban` reste dans ce fichier, il n'est plus appelé.
  root.add(construireFleches(fin, solAt, { pas: 20, largeur: 4, longueur: 4.6, debut: 12 }));

  const s = cumul(fin);
  const total = s[s.length - 1];
  const portes = [];
  for (let k = 0; k < PORTES; k++) {
    // On évite les deux extrémités : la première porte est à la sortie du
    // village, la dernière à son entrée, pas au milieu de la place.
    const cible = total * (0.04 + 0.92 * (k / (PORTES - 1)));
    let i = 1;
    while (i < s.length - 1 && s[i] < cible) i++;
    const [x, z] = fin[i];
    const [px, pz] = fin[Math.max(0, i - 1)];
    const [nx, nz] = fin[Math.min(fin.length - 1, i + 1)];
    // Cap de la porte : la direction de la ROUTE à cet endroit — une porte de
    // travers oblige à ralentir sans raison.
    const cap = Math.atan2(nx - px, nz - pz);
    const porte = construirePorte(k, x, z, solAt(x, z), cap);
    root.add(porte);
    portes.push(porte);
  }
  if (glissieres) {
    const g = construireGlissieresCourse(points, { solAt, ...glissieres });
    root.add(g.root);
    portes.glissieres = g;
  }
  return portes;
}
