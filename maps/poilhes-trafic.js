/**
 * La vie dans Poilhes City — trafic, passants et hélicoptères.
 *
 * Arnaud, 27/09/2026 : « il faut créer beaucoup plus d'interactions avec la
 * carte : beaucoup plus de personnages, d'hélicoptères, de voitures, de motos,
 * de trottinettes ». Tout ce petit monde circule sur les vraies rues du
 * village (`maps/<village>/trafic.json`, tiré du ruban de chaussée par
 * `scripts/poilhes/trafic_reseau.py`) :
 *
 *   — des **voitures** de toutes les couleurs (la berline du joueur,
 *     repeinte), sur leur voie de droite, qui **freinent devant le joueur et
 *     klaxonnent** s'il reste planté devant elles ;
 *   — des **motos** (Motocross de Meshy), des **quads** et des **trottinettes**
 *     (les engins du joueur, pilote compris), plus vifs que les voitures ;
 *   — des **passants** (Carole, les mafieux, le policier) sur les trottoirs,
 *     qui **sautent de côté** avec un « oh-oh » quand on fonce sur eux ;
 *   — des **hélicoptères** qui tournent au-dessus du village.
 *
 * Les passants et les hélicos sont du décor. Les **véhicules**, depuis le
 * 01/10/2026, sont des obstacles : `corps()` les donne au module des chocs
 * (`chocs.js`), et un véhicule percuté est **bousculé** (écarté de sa voie, de
 * travers, arrêté deux ou trois secondes), klaxonne, puis regagne sa voie.
 * Le nombre suit le niveau de qualité (`NOMBRES`).
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { construireVoiture } from './voiture-model.js?v=20260927o';
import { construireEnginTrottinette } from './trottinette.js?v=pilote-20260922';
import { construireEnginQuad, QUAD_TRAFIC } from './quad.js?v=20260927o';

/** Combien de chaque, par niveau de qualité (`maps/qualite.js`). */
export const NOMBRES = {
  // Téléphone (29/09/2026) : chaque modèle coûte de la mémoire, la page ne doit pas être fermée par Safari.
  telephone: { voitures: 2, motos: 1, quads: 0, trottinettes: 1, passants: 4, helicos: 0 },
  bas: { voitures: 4, motos: 2, quads: 1, trottinettes: 2, passants: 8, helicos: 1 },
  moyen: { voitures: 7, motos: 3, quads: 2, trottinettes: 3, passants: 14, helicos: 2 },
  eleve: { voitures: 10, motos: 4, quads: 2, trottinettes: 4, passants: 22, helicos: 2 },
};

/** Vitesses de croisière (m/s) et place sur la chaussée. */
const ENGINS = {
  voiture: { vitesse: [8, 11.5], voie: 0.27, longueur: 4.2 },
  moto: { vitesse: [10, 14], voie: 0.22, longueur: 2.2 },
  quad: { vitesse: [7, 10], voie: 0.25, longueur: 2 },
  trottinette: { vitesse: [5, 7], voie: 0.38, longueur: 1.4 },
  passant: { vitesse: [1.1, 1.6], trottoir: 1.2 },
};
/** Teintes des voitures : rotation de teinte de la carrosserie (degrés) ; `gris` désature. */
const TEINTES = [0, 205, 120, 48, 280, 25, 175, 'gris', 330, 'blanc'];
/** Les véhicules face aux chocs (01/10/2026) : demi-largeur (m) et masse (kg, pilote compris). */
const CARRURE = { voiture: { dw: 0.9, masse: 1400 }, moto: { dw: 0.42, masse: 230 }, quad: { dw: 0.6, masse: 380 }, trottinette: { dw: 0.3, masse: 105 } };
const PASSANTS = [
  { fichier: 'carole.glb', hauteur: 1.70 },
  { fichier: 'pinstripe.glb', hauteur: 1.85 },
  { fichier: 'police.glb', hauteur: 1.95 },
];
const HELICO = { fichier: 'helicoptere.glb', longueur: 13, altitude: [55, 85], rayon: [140, 320], vitesse: [18, 26] };
// Le Motocross de Meshy est livré « Z en haut » et sans matière : on le couche
// (`zHaut`) et on le peint aux couleurs des marques de cross.
/**
 * La LaFerrari (27/09/2026) : la carrosserie du fichier d'impression 3D d'Arnaud
 * (`LaFerrari+Wheels+4.1.3mf`, un seul bloc), peinte par zones et allégée par
 * `scripts/poilhes/voiture_3mf.py` → `assets/fun/laferrari.glb` (en mètres, le
 * nez vers −z, le sol à zéro). Les roues sont faites ici, aux centres mesurés
 * sur les passages de roue. Une voiture du trafic sur trois.
 */
const LAFERRARI = {
  fichier: 'assets/fun/laferrari.glb?v=1', part: 3,
  roues: { rayon: 0.345, largeur: 0.27, x: 0.74, zAvant: -1.083, zArriere: 1.444 },
  couleurs: [0xa50d12, 0xe0b400, 0x111214, 0xe8e8e8, 0x123c9e, 0xe85c00],
};
/**
 * Les deux autres voitures d'Arnaud (27/09/2026) : ses 3MF de Mustang GTD et
 * d'Aventador SVJ sont des kits en pièces détachées, impossibles à remonter ;
 * on les a générées avec Meshy (texturées). Même constructeur que la berline
 * (`construireVoiture`, roues découpées) : une voiture du trafic sur trois,
 * à tour de rôle.
 */
export const MESHY = [
  { modele: 'assets/car/mustang-gtd.glb?v=1', demiTour: false },
  { modele: 'assets/car/aventador-svj.glb?v=1', demiTour: false },
];
const MOTO = { fichier: 'moto.glb', longueur: 2.15, zHaut: true, pilote: { y: 0.18, z: -0.05 }, couleurs: [0xff6a00, 0x2fa84f, 0x1f5fd1, 0xd8262e] };

const aleatoire = (a, b) => a + Math.random() * (b - a);
const choisir = (liste) => liste[Math.floor(Math.random() * liste.length)];

// ─────────────────────────────── modèles
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const modeles = {};
/** Un GLB de `assets/fun/`, centré, les pieds à zéro, face à +z, à la bonne taille. */
function modele(fichier, { hauteur = null, longueur = null, zHaut = false } = {}) {
  if (!modeles[fichier]) {
    modeles[fichier] = loader.loadAsync(fichier.includes('/') ? fichier : 'assets/fun/' + fichier).then((gltf) => {
      let objet = gltf.scene;
      if (zHaut) {
        objet.rotation.x = -Math.PI / 2;
        const debout = new THREE.Group();
        debout.add(objet);
        objet = debout;
      }
      objet.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      });
      objet.updateMatrixWorld(true);              // sinon la boîte ignore les échelles des nœuds
      const t = new THREE.Box3().setFromObject(objet, true).getSize(new THREE.Vector3());
      objet.scale.setScalar(longueur ? longueur / Math.max(t.x, t.z) : hauteur / t.y);
      objet.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(objet, true);
      const c = b.getCenter(new THREE.Vector3());
      objet.position.set(-c.x, -b.min.y, -c.z);
      return objet;
    });
  }
  return modeles[fichier].then((objet) => {
    const racine = new THREE.Group();
    racine.add(objet.clone());
    return racine;
  });
}

/** Repeint une texture de carrosserie : rotation de teinte, ou gris / blanc. */
const texturesRepeintes = new Map();
function repeindre(texture, teinte) {
  const cle = texture.uuid + ':' + teinte;
  if (texturesRepeintes.has(cle)) return texturesRepeintes.get(cle);
  const image = texture.image;
  const c = document.createElement('canvas');
  // une moitié de définition suffit pour une voiture qui passe
  c.width = Math.max(256, image.width >> 1); c.height = Math.max(256, image.height >> 1);
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hsl = new THREE.Color(), rgb = new THREE.Color(), tmp = {};
  for (let i = 0; i < d.length; i += 4) {
    hsl.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    hsl.getHSL(tmp);
    if (tmp.s < 0.25) continue;                       // chromes, pneus, vitres : on n'y touche pas
    if (teinte === 'gris') rgb.setHSL(0, 0, tmp.l * 0.9);
    else if (teinte === 'blanc') rgb.setHSL(0, 0, Math.min(0.92, 0.45 + tmp.l));
    else rgb.setHSL((tmp.h + teinte / 360) % 1, tmp.s, tmp.l);
    d[i] = rgb.r * 255; d[i + 1] = rgb.g * 255; d[i + 2] = rgb.b * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = texture.colorSpace; t.flipY = texture.flipY; t.wrapS = texture.wrapS; t.wrapT = texture.wrapT;
  texturesRepeintes.set(cle, t);
  return t;
}

/** Une LaFerrari de la couleur n° `k` (ou de `couleur`, si donnée), avec ses quatre roues. */
let modeleLaFerrari = null;
export async function laFerrari(k, couleur = null) {
  if (!modeleLaFerrari) modeleLaFerrari = loader.loadAsync(LAFERRARI.fichier).then((g) => g.scene);
  const base = await modeleLaFerrari;
  const root = new THREE.Group();
  const caisse = base.clone(true);
  if (couleur === null) couleur = LAFERRARI.couleurs[k % LAFERRARI.couleurs.length];
  caisse.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    // Le nom « peinture » est porté par le maillage : l'allègement (palette de
    // gltf-transform) a renommé les matières en PaletteMaterial00x. Tester la
    // seule matière laissait toutes les LaFerrari couleur corail (vu le 04/10/2026).
    if (o.material && (o.material.name === 'peinture' || /^peinture/.test(o.name) || /^peinture/.test(o.parent?.name || ''))) {
      // le fichier n'a pas de normales (palette + texture suffisaient en éclairage
      // plat) : sans elles, une matière éclairée rend la carrosserie noire
      if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      o.material = new THREE.MeshPhysicalMaterial({ color: couleur, roughness: 0.38, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.15 });
    }
  });
  root.add(caisse);
  // les roues : pneu, jante et cinq branches — elles tournent avec la vitesse
  const R = LAFERRARI.roues;
  const pneu = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const jante = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.8 });
  const roues = [];
  for (const [x, z] of [[-R.x, R.zAvant], [R.x, R.zAvant], [-R.x, R.zArriere], [R.x, R.zArriere]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, R.rayon, z);
    const tourne = new THREE.Group();
    const p = new THREE.Mesh(new THREE.CylinderGeometry(R.rayon, R.rayon, R.largeur, 24), pneu);
    p.rotation.z = Math.PI / 2;
    tourne.add(p);
    const cote = Math.sign(x);
    const disque = new THREE.Mesh(new THREE.CylinderGeometry(R.rayon * 0.66, R.rayon * 0.66, 0.02, 20), jante);
    disque.rotation.z = Math.PI / 2; disque.position.x = cote * (R.largeur / 2 + 0.005);
    tourne.add(disque);
    for (let b = 0; b < 5; b++) {
      const branche = new THREE.Mesh(new THREE.BoxGeometry(0.02, R.rayon * 1.25, 0.05), jante);
      branche.rotation.x = (b / 5) * Math.PI;
      branche.position.x = cote * (R.largeur / 2 + 0.02);
      tourne.add(branche);
    }
    pivot.add(tourne);
    root.add(pivot);
    roues.push(tourne);
  }
  return {
    root,
    majRoues(braquage, rotation) { for (const r of roues) r.rotation.x = -rotation; },
    setNuit() {},
  };
}

// ─────────────────────────────── le klaxon et le « oh-oh »
let audio = null;
function contexte() {
  if (!audio) { try { audio = new AudioContext(); } catch { audio = null; } }
  return audio;
}
/** Deux notes carrées un peu fausses : un klaxon de village. Volume selon la distance. */
function klaxon(distance) {
  const ctx = contexte();
  if (!ctx || ctx.state !== 'running') return;
  const vol = 0.16 * Math.max(0, 1 - distance / 60);
  if (vol < 0.01) return;
  const gain = ctx.createGain();
  const filtre = ctx.createBiquadFilter();
  filtre.type = 'lowpass'; filtre.frequency.value = 1800;
  filtre.connect(gain); gain.connect(ctx.destination);
  const t0 = ctx.currentTime;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.02);
  gain.gain.setValueAtTime(vol, t0 + 0.22);
  gain.gain.linearRampToValueAtTime(0, t0 + 0.3);
  gain.gain.setValueAtTime(0, t0 + 0.38);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.4);
  gain.gain.setValueAtTime(vol, t0 + 0.72);
  gain.gain.linearRampToValueAtTime(0, t0 + 0.8);
  for (const f of [392, 466]) {
    const o = ctx.createOscillator();
    o.type = 'square'; o.frequency.value = f;
    o.connect(filtre); o.start(t0); o.stop(t0 + 0.82);
  }
}
const ohOh = new Audio('assets/sons/uh-oh.mp3');
ohOh.volume = 0.5;
let dernierOhOh = 0;

// ─────────────────────────────── le réseau
function preparerReseau(data) {
  const rues = data.rues.map((r) => {
    const s = [0];
    for (let k = 1; k < r.p.length; k++) s.push(s[k - 1] + Math.hypot(r.p[k][0] - r.p[k - 1][0], r.p[k][1] - r.p[k - 1][1]));
    return { p: r.p, s, L: s[s.length - 1], l: r.l };
  });
  return { rues, liens: data.liens };
}
/** Point, direction (unitaire) et indice de segment à l'abscisse `d` d'une rue. */
function echantillon(rue, d, sortie) {
  const { p, s } = rue;
  let k = sortie.k || 1;
  if (k >= p.length || s[k - 1] > d) k = 1;
  while (k < p.length - 1 && s[k] < d) k++;
  const a = p[k - 1], b = p[k];
  const L = s[k] - s[k - 1] || 1, u = Math.min(1, Math.max(0, (d - s[k - 1]) / L));
  sortie.k = k;
  sortie.x = a[0] + (b[0] - a[0]) * u; sortie.z = a[1] + (b[1] - a[1]) * u;
  sortie.dx = (b[0] - a[0]) / L; sortie.dz = (b[1] - a[1]) / L;
  return sortie;
}

/**
 * @param {object} o
 * @param {object} o.jeu       ce que rend `startVillage`
 * @param {string} o.village
 * @param {string} [o.niveau]  'bas' | 'moyen' | 'eleve'
 * @returns {Promise<object|null>} { agents, helicos, arreter() } — null sans réseau
 */
export async function creerTrafic({ jeu, village, niveau = 'eleve' }) {
  let data;
  try {
    const res = await fetch(`maps/${village}/trafic.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    data = await res.json();
  } catch { return null; }
  const { rues, liens } = preparerReseau(data);
  if (!rues.length) return null;
  const nombres = NOMBRES[niveau] || NOMBRES.eleve;
  const scene = jeu.scene;
  const sol = (x, z) => jeu.walkableAt(x, z);
  // Les rues assez longues pour qu'on y naisse sans surgir d'un bout.
  const naissances = rues.map((r, i) => i).filter((i) => rues[i].L > 40);
  const agents = [];

  function placerAuHasard(a) {
    // loin du joueur : personne n'apparaît sous son nez
    const moi = positionJoueur();
    for (let essai = 0; essai < 12; essai++) {
      a.rue = choisir(naissances.length ? naissances : rues.map((r, i) => i));
      const r = rues[a.rue];
      a.d = aleatoire(0.1, 0.9) * r.L;
      echantillon(r, a.d, a.ech);
      if (!moi || Math.hypot(a.ech.x - moi.x, a.ech.z - moi.z) > 40) break;
    }
    a.sens = Math.random() < 0.5 ? 1 : -1;
    a.premier = true;
  }

  /** Au bout d'une rue : on prend une des rues raccordées, sinon demi-tour. */
  function carrefour(a) {
    const r = rues[a.rue];
    const bout = a.sens > 0 ? 1 : 0;
    const options = (liens[a.rue] && liens[a.rue][bout]) || [];
    if (!options.length) { a.sens = -a.sens; a.d = Math.min(Math.max(a.d, 0), r.L); return; }
    const [ri, b, k] = choisir(options);
    const nr = rues[ri];
    a.rue = ri; a.ech.k = 1;
    if (b === 0) { a.d = 0; a.sens = 1; }
    else if (b === 1) { a.d = nr.L; a.sens = -1; }
    else { a.d = nr.s[k]; a.sens = Math.random() < 0.5 ? 1 : -1; }
  }

  // ── le joueur : où il est, à quelle vitesse ─────────────────────────────
  const joueur = { x: 0, z: 0, v: 0, ok: false };
  function positionJoueur() {
    const m = jeu.mode;
    const p = m === 'voiture' ? jeu.voiture : m === 'quad' ? jeu.quad : m === 'trottinette' ? jeu.trottinette : null;
    if (p && p.etat) return { x: p.etat.x, z: p.etat.z };
    if (m === 'helico') return null;              // en l'air, on ne gêne personne
    const c = jeu.camera.position;
    return { x: c.x, z: c.z };
  }

  // ── fabriquer chaque sorte ──────────────────────────────────────────────
  function nouvelAgent(sorte, objet, extra = {}) {
    const def = ENGINS[sorte];
    const a = {
      sorte, objet, ech: {}, rue: 0, d: 0, sens: 1, vit: 0,
      croisiere: aleatoire(def.vitesse[0], def.vitesse[1]),
      bloque: 0, dernierKlaxon: 0, saut: 0, sautDir: 0, phase: Math.random() * 10, ...extra,
    };
    placerAuHasard(a);
    agents.push(a);
    scene.add(objet);
    return a;
  }

  const renderer = jeu.renderer || null;
  const attentes = [];
  // Les voitures : l'une après l'autre (le modèle se découpe au chargement,
  // autant ne pas figer une image avec dix découpes d'un coup).
  attentes.push((async () => {
    for (let i = 0; i < nombres.voitures; i++) {
      if (i % LAFERRARI.part === 1) {
        try {
          const lf = await laFerrari(Math.floor(i / LAFERRARI.part));
          nouvelAgent('voiture', lf.root, { engin: lf });
          continue;
        } catch (e) { console.warn('Trafic, LaFerrari :', e); }
      }
      const meshy = i % LAFERRARI.part === 2 ? MESHY[Math.floor(i / LAFERRARI.part) % MESHY.length] : null;
      const v = construireVoiture({ renderer, ...(meshy || {}) });
      const teinte = meshy ? 0 : TEINTES[i % TEINTES.length];     // les Meshy gardent leur robe
      try {
        await v.pret;
        // la tôle du modèle Meshy porte la texture : chaque voiture a sa copie repeinte
        v.caisse.traverse((o) => {
          if (o.isMesh && o.material && o.material.map && teinte !== 0) {
            o.material = o.material.clone();
            o.material.map = repeindre(o.material.map, teinte);
          }
        });
      } catch { /* coque de secours : elle garde sa couleur */ }
      nouvelAgent('voiture', v.root, { engin: v, modele: meshy ? meshy.modele : 'berline' });
      if (v.ombre) { v.ombre.visible = false; }
      await new Promise((r) => setTimeout(r, 120));
    }
  })());
  attentes.push((async () => {
    for (let i = 0; i < nombres.trottinettes; i++) {
      const t = construireEnginTrottinette({ renderer });
      try { await t.pret; } catch { /* rien */ }
      nouvelAgent('trottinette', t.root, { engin: t });
    }
    for (let i = 0; i < nombres.quads; i++) {
      const q = construireEnginQuad({ renderer, modele: QUAD_TRAFIC });   // l'orange, 2e choix d'Arnaud
      try { await q.pret; } catch { /* rien */ }
      nouvelAgent('quad', q.root, { engin: q });
    }
  })());
  attentes.push((async () => {
    for (let i = 0; i < nombres.motos; i++) {
      try {
        const m = await modele(MOTO.fichier, { longueur: MOTO.longueur, zHaut: MOTO.zHaut });
        const peinture = new THREE.MeshStandardMaterial({ color: MOTO.couleurs[i % MOTO.couleurs.length], roughness: 0.55, metalness: 0.15 });
        m.traverse((o) => { if (o.isMesh) o.material = peinture; });
        // Le pilote : celui du quad, déjà assis et articulé (squelette Mixamo —
        // un simple clone le laisserait au centre du monde). On construit un
        // quad, on lui prend son pilote, on le pose sur la moto.
        try {
          const q = construireEnginQuad({ renderer });
          await q.pret;
          let peau = null;
          q.caisse.traverse((o) => { if (!peau && o.isSkinnedMesh) peau = o; });
          // le plus petit groupe qui porte à la fois la peau et son squelette
          const os = peau && peau.skeleton && peau.skeleton.bones[0];
          const contient = (n, cible) => { let ok = false; n.traverse((o) => { if (o === cible) ok = true; }); return ok; };
          let porteur = peau;
          while (porteur && os && !contient(porteur, os)) porteur = porteur.parent;
          if (porteur && porteur !== q.caisse && porteur !== q.root) {
            // on garde sa pose telle qu'assise sur le quad (les deux racines sont à l'origine)
            q.root.updateMatrixWorld(true);
            const siege = new THREE.Group();
            m.add(siege);
            m.updateMatrixWorld(true);
            siege.attach(porteur);
            siege.rotation.y = Math.PI;                 // le quad regarde −z, la moto +z
            siege.position.set(0, MOTO.pilote.y, MOTO.pilote.z);
          }
        } catch { /* la moto roule seule */ }
        nouvelAgent('moto', m, { faceZ: true });
      } catch (e) { console.warn('Trafic, moto :', e); break; }
    }
  })());
  attentes.push((async () => {
    for (let i = 0; i < nombres.passants; i++) {
      const def = PASSANTS[i % PASSANTS.length];
      try {
        const p = await modele(def.fichier, { hauteur: def.hauteur });
        nouvelAgent('passant', p, { faceZ: true });
      } catch (e) { console.warn('Trafic, passant :', e); break; }
    }
  })());

  // ── les hélicoptères ────────────────────────────────────────────────────
  const helicos = [];
  attentes.push((async () => {
    for (let i = 0; i < nombres.helicos; i++) {
      try {
        const h = await modele(HELICO.fichier, { longueur: HELICO.longueur });
        // un disque flou au-dessus : « ça tourne », même de loin
        const disque = new THREE.Mesh(
          new THREE.CircleGeometry(6.2, 40),
          new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
        );
        disque.rotation.x = -Math.PI / 2;
        const boite = new THREE.Box3().setFromObject(h);
        disque.position.y = boite.max.y + 0.05;
        h.add(disque);
        scene.add(h);
        helicos.push({
          objet: h, disque,
          cx: aleatoire(-120, 120), cz: aleatoire(-120, 120),
          rayon: aleatoire(HELICO.rayon[0], HELICO.rayon[1]),
          alt: aleatoire(HELICO.altitude[0], HELICO.altitude[1]),
          w: (Math.random() < 0.5 ? 1 : -1) * aleatoire(HELICO.vitesse[0], HELICO.vitesse[1]),
          angle: Math.random() * Math.PI * 2,
        });
      } catch (e) { console.warn('Trafic, hélicoptère :', e); break; }
    }
  })());

  // ── la nuit : les voitures allument leurs phares ────────────────────────
  let nuit = null;
  function suivreNuit() {
    const heure = +(document.getElementById('time')?.value ?? 14);
    const n = heure < 7.4 || heure > 20.2;
    if (n === nuit) return;
    nuit = n;
    for (const a of agents) if (a.engin && a.engin.setNuit) a.engin.setNuit(n);
  }

  // ── la boucle ───────────────────────────────────────────────────────────
  let avant = performance.now(), actif = true, horloge = 0, dernierJoueur = null;
  const cible = new THREE.Vector3();
  function image(t) {
    if (!actif) return;
    requestAnimationFrame(image);
    const dt = Math.min(0.1, (t - avant) / 1000); avant = t;
    if (document.hidden || dt <= 0) return;
    horloge += dt;
    if ((horloge % 2) < dt) suivreNuit();

    const moi = positionJoueur();
    if (moi && dernierJoueur) joueur.v = Math.hypot(moi.x - dernierJoueur.x, moi.z - dernierJoueur.z) / dt;
    dernierJoueur = moi;

    for (const a of agents) avancer(a, dt, moi);
    for (const h of helicos) voler(h, dt);
  }

  function avancer(a, dt, moi) {
    const def = ENGINS[a.sorte];
    const r = rues[a.rue];
    const pieton = a.sorte === 'passant';
    // ── la vitesse voulue : croisière, sauf obstacle devant ──
    let voulue = a.croisiere;
    const e = a.ech;
    const fx = e.dx * a.sens, fz = e.dz * a.sens;          // l'avant
    if (moi && !pieton) {
      const vx = moi.x - e.x, vz = moi.z - e.z;
      const devant = vx * fx + vz * fz, cote = Math.abs(-vx * fz + vz * fx);
      if (devant > 0 && devant < 12 && cote < 3.2) {
        voulue = devant < 6 ? 0 : a.croisiere * (devant - 6) / 6;
        a.bloque += dt;
        // planté devant : on klaxonne, pas plus d'une fois toutes les quatre secondes
        if (a.sorte !== 'trottinette' && a.bloque > 1.2 && horloge - a.dernierKlaxon > 4) {
          a.dernierKlaxon = horloge;
          klaxon(Math.hypot(vx, vz));
        }
      } else a.bloque = 0;
    }
    if (!pieton) {
      // le véhicule qui précède, dans la même rue et le même sens
      for (const b of agents) {
        if (b === a || b.rue !== a.rue || b.sens !== a.sens || b.sorte === 'passant') continue;
        const ecart = (b.d - a.d) * a.sens;
        if (ecart > 0 && ecart < def.longueur + 6) voulue = Math.min(voulue, b.vit * 0.9);
      }
    }
    // percuté : il reste planté le temps de se remettre
    if (a.bouscule && a.bouscule.arret > 0) voulue = 0;
    // accélère doucement, freine franchement
    const k = voulue < a.vit ? 4 : 1.2;
    a.vit += (voulue - a.vit) * Math.min(1, dt * k);

    a.d += a.sens * a.vit * dt;
    if (a.d > r.L || a.d < 0) carrefour(a);
    const rue = rues[a.rue];
    echantillon(rue, Math.min(Math.max(a.d, 0), rue.L), e);
    const dirx = e.dx * a.sens, dirz = e.dz * a.sens;

    // ── la place sur la chaussée : voie de droite, ou trottoir ──
    const decalage = pieton ? rue.l / 2 + ENGINS.passant.trottoir : Math.max(0.6, rue.l * def.voie);
    let x = e.x - dirz * decalage, z = e.z + dirx * decalage;

    // ── les passants s'écartent (et le disent) quand on fonce sur eux ──
    let hop = 0;
    if (pieton) {
      if (moi && a.saut <= 0) {
        const d = Math.hypot(moi.x - x, moi.z - z);
        if (d < 4.5 && joueur.v > 3) {
          a.saut = 0.6;
          a.sautDir = ((moi.x - x) * -dirz + (moi.z - z) * dirx) > 0 ? -1 : 1;   // à l'opposé du joueur
          if (horloge - dernierOhOh > 2.5) { dernierOhOh = horloge; ohOh.currentTime = 0; ohOh.play().catch(() => {}); }
        }
      }
      if (a.saut > 0) {
        a.saut -= dt;
        const u = 1 - Math.max(0, a.saut) / 0.6;
        a.ecart = (a.ecart || 0) + a.sautDir * dt * 6;
        hop = Math.sin(u * Math.PI) * 0.9;
      } else if (a.ecart) {
        a.ecart *= Math.max(0, 1 - dt * 0.5);            // on regagne le trottoir sans se presser
        if (Math.abs(a.ecart) < 0.05) a.ecart = 0;
      }
      if (a.ecart) { x += -dirz * a.ecart; z += dirx * a.ecart; }
      a.phase += dt * a.vit * 5.5;
      hop += Math.abs(Math.sin(a.phase)) * 0.05;          // le pas
    }
    // ── bousculé : l'écart du choc s'ajoute, puis se résorbe ──
    let tourne = 0;
    const b = a.bouscule;
    if (b) {
      // poussé, jamais dans une façade : un pas qui y entrerait est refusé
      const nx = b.ox + b.vx * dt, nz = b.oz + b.vz * dt;
      const bloque = jeu.decor && jeu.decor.blockedAt;
      if (bloque && bloque(e.x - dirz * decalage + nx, e.z + dirx * decalage + nz)) { b.vx = b.vz = 0; }
      else { b.ox = nx; b.oz = nz; }
      const amorti = Math.exp(-4 * dt);
      b.vx *= amorti; b.vz *= amorti;
      b.rot += b.w * dt; b.w *= Math.exp(-3.5 * dt);
      const ecart = Math.hypot(b.ox, b.oz);
      if (ecart > 6) { b.ox *= 6 / ecart; b.oz *= 6 / ecart; }      // jamais à plus de 6 m de sa voie
      if (b.arret > 0) {
        b.arret -= dt;
        if (b.arret <= 0 && b.klaxon && moi && a.sorte !== 'trottinette') klaxon(Math.hypot(moi.x - x, moi.z - z));
      } else {
        // il regagne sa voie et se remet droit, sans se presser
        const r = Math.min(1, dt * 0.9);
        b.ox -= b.ox * r; b.oz -= b.oz * r; b.rot -= b.rot * r;
        if (Math.hypot(b.ox, b.oz) < 0.05 && Math.abs(b.rot) < 0.02 && Math.hypot(b.vx, b.vz) < 0.1) a.bouscule = null;
      }
      x += b.ox; z += b.oz;
      tourne = b.rot;
    }
    a.px = x; a.pz = z; a.dirx = dirx; a.dirz = dirz; a.tourne = tourne;
    const y = sol(x, z) + hop;
    a.py = y;
    const o = a.objet;
    cible.set(x, y, z);
    if (a.premier) { o.position.copy(cible); a.premier = false; }
    else o.position.lerp(cible, Math.min(1, dt * 10));
    // le cap : +z pour les GLB bruts, −z pour les engins du joueur
    const cap = (a.faceZ ? Math.atan2(dirx, dirz) : Math.atan2(-dirx, -dirz)) + tourne;
    let ecartCap = cap - o.rotation.y; ecartCap = Math.atan2(Math.sin(ecartCap), Math.cos(ecartCap));
    // bousculé, il tourne avec le choc, sans retard
    o.rotation.y += b ? ecartCap : ecartCap * Math.min(1, dt * (pieton ? 8 : 5));
    if (b) o.position.copy(cible);
    if (pieton) o.rotation.z = Math.sin(a.phase) * 0.04;
    if (a.engin && a.engin.majRoues) {
      a.tour = (a.tour || 0) + a.vit * dt / 0.33;
      try { a.engin.majRoues(0, a.tour, [0, 0, 0, 0]); } catch { /* signature propre à l'engin */ }
    }
  }

  function voler(h, dt) {
    h.angle += (h.w / h.rayon) * dt;
    const x = h.cx + Math.cos(h.angle) * h.rayon, z = h.cz + Math.sin(h.angle) * h.rayon;
    const y = Math.max(h.alt, sol(x, z) + 40) + Math.sin(h.angle * 3) * 4;
    h.objet.position.set(x, y, z);
    // tangente au cercle : le nez devant, penché dans le virage
    const tx = -Math.sin(h.angle) * Math.sign(h.w), tz = Math.cos(h.angle) * Math.sign(h.w);
    h.objet.rotation.set(0, Math.atan2(tx, tz), 0);
    h.objet.rotateZ(-0.22 * Math.sign(h.w));
    h.objet.rotateX(0.08);
    h.disque.rotation.z += dt * 30;
  }

  requestAnimationFrame(image);
  Promise.all(attentes).then(() => {
    suivreNuit();
    console.info(`[trafic] ${agents.length} en circulation, ${helicos.length} hélicoptère(s)`);
  });
  /**
   * Les véhicules pour le module des chocs (01/10/2026) : une boîte chacun,
   * et ce qu'il fait quand on le percute.
   */
  function corps() {
    const liste = [];
    for (const a of agents) {
      if (a.sorte === 'passant' || a.px === undefined || !a.objet.visible) continue;
      const c = CARRURE[a.sorte];
      if (!c) continue;
      const b = a.bouscule;
      liste.push({
        cle: 'trafic' + agents.indexOf(a), sorte: 'trafic',
        x: a.px, z: a.pz, y: a.py, cap: Math.atan2(-a.dirx, -a.dirz) + (a.tourne || 0),
        dw: c.dw, dl: ENGINS[a.sorte].longueur / 2, masse: c.masse, mobile: true,
        vx: a.dirx * a.vit + (b ? b.vx : 0), vz: a.dirz * a.vit + (b ? b.vz : 0),
        appliquer(f) {
          const bb = a.bouscule || (a.bouscule = { ox: 0, oz: 0, vx: 0, vz: 0, rot: 0, w: 0, arret: 0, klaxon: false });
          bb.ox += f.dx; bb.oz += f.dz;
          this.x += f.dx; this.z += f.dz;
          // le choc passe dans l'écart (il est poussé hors de sa voie) ; il perd son élan
          bb.vx += f.dvx; bb.vz += f.dvz;
          bb.w += f.dw;
          if (f.force > 0.1) {
            a.vit *= 0.3;
            bb.arret = Math.max(bb.arret, 1.4 + f.force * 2.6);
            bb.klaxon = true;
          }
        },
      });
    }
    return liste;
  }

  return {
    agents, helicos, corps,
    arreter() { actif = false; for (const a of agents) scene.remove(a.objet); for (const h of helicos) scene.remove(h.objet); },
  };
}
