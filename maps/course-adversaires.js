/**
 * Les adversaires de l'ordinateur sur les boucles de Poilhes City.
 *
 * Arnaud, 01/10/2026 : « un multijoueur… ça peut être un joueur physique, ça
 * peut aussi être contre l'ordinateur, toujours avec plusieurs niveaux ».
 *
 * Deux pilotes partent avec le joueur (Arnaud, 01/10 : « juste deux adversaires »),
 * sur le même type d'engin que lui. En voiture, ce sont **deux voitures
 * différentes** du trafic : la LaFerrari et l'Aventador SVJ (même conduite que la
 * berline, seule la carrosserie change). En quad et en trottinette, les modèles du trafic. Ils ne passent pas par la
 * physique : chacun **suit le tracé** de la boucle (`boucle*.json`) à la vitesse
 * qu'un bon pilote pourrait tenir à cet endroit avec cet engin :
 *
 *   — dans un virage de rayon R, l'engin du joueur tourne au plus à
 *     `virage · (1 − 0,45 v/vmax)` rad/s (la loi arcade) : la vitesse limite est
 *     celle où ce taux suffit, v = R·virage / (1 + 0,45·R·virage/vmax) ;
 *   — on freine avant le virage (profil calculé à l'envers), on réaccélère
 *     comme l'engin du joueur ;
 *   — le **niveau** est la part de cette limite que le pilote ose prendre.
 *
 * Ils s'évitent (changement de file, ou ils restent derrière), évitent le
 * joueur et le trafic ; les contacts sont des vrais chocs depuis le 01/10/2026
 * (`corps()` → `chocs.js`) : un pilote percuté perd de l'élan, part de côté et
 * de travers, puis regagne sa file. En Facile et en
 * Moyen, ils attendent un peu le joueur s'ils le distancent trop (et ne le
 * laissent pas filer non plus) ; en Difficile et en Pilote, aucun cadeau.
 */
import * as THREE from 'three';
import { REGLAGES, ARCADE_DEFAUT } from './voiture-physique.js?v=20261004a';
import { construireVoiture } from './voiture-model.js?v=20260927o';
import { construireEnginQuad, QUAD_TRAFIC } from './quad.js?v=20260927o';
import { construireEnginTrottinette } from './trottinette.js?v=pilote-20260922';
import { laFerrari, MESHY } from './poilhes-trafic.js?v=20261001c';

/** Les niveaux : `part` = part de la vitesse limite, `elastique` = attendre / rattraper le joueur. */
export const NIVEAUX = {
  aucun:     { nom: 'Seul', icone: '' },
  // 01/10/2026, après le premier essai d'Arnaud (« le premier niveau, c'est un peu haut ») :
  // Facile 0,60 → 0,50, Moyen 0,74 → 0,60, Difficile 0,87 → 0,78, Pilote 0,97 → 0,95.
  facile:    { nom: 'Facile', icone: '🙂', part: 0.50, elastique: true, attend: 30 },
  moyen:     { nom: 'Moyen', icone: '😐', part: 0.60, elastique: true, attend: 60 },
  difficile: { nom: 'Difficile', icone: '😠', part: 0.78, elastique: false },
  pilote:    { nom: 'Pilote', icone: '🔥', part: 0.95, elastique: false },
};
export const ORDRE_NIVEAUX = ['aucun', 'facile', 'moyen', 'difficile', 'pilote'];

// Arnaud, 04/10/2026 : « les couleurs sont trop flashy, il faut des couleurs un
// peu plus ternes, mais plus sympa ». Turbo passe du rouge vif au bordeaux, Jarvis
// du vert citron au vert olive ; les étiquettes suivent. `peinture` : la couleur
// de carrosserie (LaFerrari) ou la cible de `ternir()` (atlas Meshy).
const PILOTES = [
  { nom: 'Turbo', voiture: 'laferrari', couleur: '#d98a84', peinture: 0x5e1a20, ecart: 0.02 },   // LaFerrari bordeaux
  { nom: 'Jarvis', voiture: 'aventador', couleur: '#a9bf8e', peinture: { h: 95, s: 0.2, l: 0.44 }, ecart: -0.02 },   // Aventador olive
];
const PAS = 2;              // m entre deux points du tracé rééchantillonné
const CORDE = 5;            // points de part et d'autre pour mesurer la courbure (± 10 m)
const FREIN = 8;            // m/s² au freinage
const FILES = [-1.3, 1.3];      // m de part et d'autre de l'axe
const GLISSE_FILE = 1.6;    // m/s : vitesse de changement de file
/** Les boîtes des engins pour les chocs : demi-largeur, demi-longueur (m), masse (kg). */
const CARRURE = { voiture: { dw: 0.95, dl: 2.25, masse: 1450 }, quad: { dw: 0.62, dl: 1.0, masse: 380 }, trottinette: { dw: 0.32, dl: 0.62, masse: 110 } };
const REGLAGE_ENGIN = { voiture: REGLAGES.gt, quad: REGLAGES.quad, trottinette: REGLAGES.trottinette };

const k = (r, c) => (r[c] !== undefined ? r[c] : ARCADE_DEFAUT[c]);

/**
 * Ternit la carrosserie d'un atlas Meshy : les pixels colorés prennent la teinte,
 * la saturation et une luminosité proches de `cible` ({ h en degrés, s, l }) ; le
 * modelé de la texture est gardé, atténué au quart (à moitié, l'atlas Meshy
 * donnait un camouflage). Noirs,
 * chromes, vitres et pneus — peu saturés — ne bougent pas.
 */
const atlasTernis = new Map();
function ternir(texture, cible) {
  const cle = texture.uuid + ':' + JSON.stringify(cible);
  if (atlasTernis.has(cle)) return atlasTernis.get(cle);
  const image = texture.image;
  const c = document.createElement('canvas');
  c.width = image.width; c.height = image.height;
  const g = c.getContext('2d');
  g.drawImage(image, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const col = new THREE.Color(), hsl = {};
  // luminosité moyenne de la peinture, pour garder le modelé autour de la cible
  let somme = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255).getHSL(hsl);
    if (hsl.s >= 0.3) { somme += hsl.l; n++; }
  }
  const moyenne = n ? somme / n : 0.5;
  for (let i = 0; i < d.length; i += 4) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255).getHSL(hsl);
    if (hsl.s < 0.1 || hsl.l < 0.06) continue;
    const part = Math.min(1, (hsl.s - 0.1) / 0.15);          // fondu : pas de pixel orphelin
    const l = Math.max(0.04, Math.min(0.9, cible.l + (hsl.l - moyenne) * 0.25));
    const r0 = d[i], v0 = d[i + 1], b0 = d[i + 2];
    col.setHSL(cible.h / 360, cible.s, l);
    d[i] = r0 + (col.r * 255 - r0) * part;
    d[i + 1] = v0 + (col.g * 255 - v0) * part;
    d[i + 2] = b0 + (col.b * 255 - b0) * part;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = texture.colorSpace; t.flipY = texture.flipY;
  t.wrapS = texture.wrapS; t.wrapT = texture.wrapT; t.anisotropy = texture.anisotropy;
  atlasTernis.set(cle, t);
  return t;
}

function etiquette(texte, couleur) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,20,.78)';
  g.beginPath(); g.roundRect(4, 6, 248, 52, 16); g.fill();
  g.fillStyle = couleur;
  g.font = '700 32px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(texte.slice(0, 14), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 10;
  return s;
}

/**
 * @param {object} o
 * @param {object} o.jeu     ce que rend `startVillage` (scene, renderer, walkableAt)
 * @param {object} o.data    le tracé (`boucle*.json`) : points, depart, tours
 * @param {number} o.tours
 */
export function creerAdversaires({ jeu, data, tours }) {
  const solAt = (x, z) => jeu.walkableAt(x, z);

  // ── le tracé rééchantillonné tous les PAS mètres, bouclé ────────────────
  const X = [], Z = [];
  {
    const P = data.points;
    X.push(P[0][0]); Z.push(P[0][1]);
    let reste = 0;
    for (let i = 1; i <= P.length; i++) {
      const a = P[i - 1], b = P[i % P.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-6) continue;
      let t = PAS - reste;
      while (t <= L) { X.push(a[0] + (b[0] - a[0]) * t / L); Z.push(a[1] + (b[1] - a[1]) * t / L); t += PAS; }
      reste = L - (t - PAS);
    }
  }
  const N = X.length;
  const LONGUEUR = N * PAS;
  const TOTAL = LONGUEUR * tours;
  const idx = (i) => ((i % N) + N) % N;

  /** Rayon du cercle passant par i−CORDE, i, i+CORDE (∞ en ligne droite). */
  const RAYON = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = idx(i - CORDE), c = idx(i + CORDE);
    const ab = Math.hypot(X[i] - X[a], Z[i] - Z[a]), bc = Math.hypot(X[c] - X[i], Z[c] - Z[i]), ac = Math.hypot(X[c] - X[a], Z[c] - Z[a]);
    const aire2 = Math.abs((X[i] - X[a]) * (Z[c] - Z[a]) - (X[c] - X[a]) * (Z[i] - Z[a]));
    RAYON[i] = aire2 < 1e-3 ? 1e4 : (ab * bc * ac) / (2 * aire2);
  }
  // un virage se voit en entier : on garde le plus petit rayon à ± 3 points
  const R = new Float32Array(N);
  for (let i = 0; i < N; i++) { let m = 1e4; for (let j = -3; j <= 3; j++) m = Math.min(m, RAYON[idx(i + j)]); R[i] = m; }

  /** Le profil de vitesse (m/s) d'un engin à une part donnée de sa limite. */
  function profil(reglage, part) {
    const vmax = k(reglage, 'vmax'), vir = k(reglage, 'virage');
    const v = new Float32Array(N);
    for (let i = 0; i < N; i++) v[i] = part * Math.min(vmax, (R[i] * vir) / (1 + 0.45 * R[i] * vir / vmax));
    // freinage anticipé : deux passes à l'envers (la boucle se referme)
    for (let passe = 0; passe < 2; passe++) {
      for (let i = N - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[idx(i + 1)] ** 2 + 2 * FREIN * PAS));
    }
    // temps cumulé le long d'un tour, à pleine allure du profil (pour estimer une arrivée)
    const T = new Float32Array(N + 1);
    for (let i = 0; i < N; i++) T[i + 1] = T[i] + PAS / Math.max(1, v[i]);
    return { v, T, vmax: part * vmax, accel: k(reglage, 'accel') };
  }

  // ── position sur le tracé ───────────────────────────────────────────────
  const d = data.depart;
  const avant = { x: -Math.sin(d.cap), z: -Math.cos(d.cap) };       // le sens du départ
  const droite = { x: -avant.z, z: avant.x };
  /** (s, écart latéral) → x, z, cap. Avant la ligne (s < 0) : en ligne droite derrière elle. */
  function poser(s, lat, out) {
    let x, z, tx, tz;
    if (s < 0) {
      x = d.x + avant.x * s; z = d.z + avant.z * s; tx = avant.x; tz = avant.z;
      x += droite.x * lat; z += droite.z * lat;
    } else {
      const u = (s % LONGUEUR) / PAS, i = Math.floor(u), f = u - i;
      const a = idx(i), b = idx(i + 1);
      x = X[a] + (X[b] - X[a]) * f; z = Z[a] + (Z[b] - Z[a]) * f;
      // la tangente sur ± 2 points : un cap sans à-coups
      const p = idx(i - 2), q = idx(i + 3);
      tx = X[q] - X[p]; tz = Z[q] - Z[p];
      const n = Math.hypot(tx, tz) || 1; tx /= n; tz /= n;
      x += -tz * lat; z += tx * lat;
    }
    out.x = x; out.z = z; out.cap = Math.atan2(-tx, -tz); out.tx = tx; out.tz = tz;
    return out;
  }
  /** Le joueur projeté sur le tracé, près de son abscisse précédente. */
  function projeter(x, z, sAvant) {
    if (sAvant < 0) {
      const s = (x - d.x) * avant.x + (z - d.z) * avant.z;
      if (s < 0) return { s, lat: (x - d.x) * droite.x + (z - d.z) * droite.z };
    }
    const base = Math.max(0, sAvant);
    let meilleur = null, dMin = Infinity;
    for (let s = base - 30; s <= base + 80; s += PAS) {
      if (s < 0) continue;
      const i = idx(Math.round(s / PAS));
      const dd = (X[i] - x) ** 2 + (Z[i] - z) ** 2;
      if (dd < dMin) { dMin = dd; meilleur = s; }
    }
    if (meilleur === null) return { s: sAvant, lat: 0 };
    const i = idx(Math.round(meilleur / PAS)), j = idx(i + 1);
    const tx = X[j] - X[i], tz = Z[j] - Z[i], n = Math.hypot(tx, tz) || 1;
    return { s: meilleur, lat: ((x - X[i]) * -tz + (z - Z[i]) * tx) / n };
  }

  // ── les pilotes ─────────────────────────────────────────────────────────
  let niveau = 'aucun';
  let obstacles = null;      // () => les boîtes du trafic, pour l'éviter
  let pilotes = [];
  let phase = null;          // 'grille' | 'course' | null
  let horloge = 0;
  const joueur = { s: -15, lat: 0, v: 0, fini: false };

  function construire(engin, pilote) {
    const groupe = new THREE.Group();
    let objet;
    if (engin === 'quad') objet = construireEnginQuad({ renderer: jeu.renderer, modele: QUAD_TRAFIC });
    else if (engin === 'trottinette') objet = construireEnginTrottinette({ renderer: jeu.renderer });
    else {
      if (pilote.voiture === 'laferrari') {
        // la LaFerrari se charge à part : une coquille vide en attendant
        objet = { root: new THREE.Group() };
        laFerrari(0, pilote.peinture).then((lf) => { objet.root.add(lf.root); objet.majRoues = lf.majRoues; })
          .catch((e) => { console.warn('Adversaire, LaFerrari :', e); objet.root.add(construireVoiture({ renderer: jeu.renderer }).root); });
      } else {
        const m = MESHY.find((x) => x.modele.includes(pilote.voiture)) || {};
        objet = construireVoiture({ renderer: jeu.renderer, ...m });
        if (pilote.peinture && objet.pret) {
          objet.pret.then(() => objet.root.traverse((o) => {
            if (o.isMesh && o.material && o.material.map && o.material.isMeshPhysicalMaterial) {
              o.material.map = ternir(o.material.map, pilote.peinture);
              o.material.needsUpdate = true;
            }
          }));
        }
      }
    }
    groupe.add(objet.root);
    groupe.traverse((o) => { o.visible = true; });
    const e = etiquette(pilote.nom, pilote.couleur);
    e.position.y = engin === 'trottinette' ? 2.6 : 2.8;
    groupe.add(e);
    return { groupe, objet };
  }

  /** Les pilotes se mettent en grille, derrière la ligne, à côté du joueur. */
  function preparer(engin, recul) {
    arreter();
    if (niveau === 'aucun') return;
    const reglage = REGLAGE_ENGIN[engin] || REGLAGES.gt;
    const N_ = NIVEAUX[niveau];
    // la grille : à gauche et à droite du joueur, puis derrière lui
    const largeur = engin === 'trottinette' ? 1.4 : 2.5;
    const places = [[-recul, -largeur], [-recul, largeur]];
    pilotes = PILOTES.map((p, i) => {
      const { groupe, objet } = construire(engin, p);
      jeu.scene.add(groupe);
      return {
        ...p, groupe, objet, engin,
        prof: profil(reglage, N_.part * (1 + p.ecart)),
        s: places[i][0], lat: places[i][1], latGrille: places[i][1], file: FILES[i],
        v: 0, roue: 0, franchi: null, arrivee: null,
        latV: 0, rot: 0, rotW: 0, tx: avant.x, tz: avant.z, cap: d.cap,   // les chocs
      };
    });
    joueur.s = -recul; joueur.lat = 0; joueur.fini = false;
    phase = 'grille';
    horloge = 0;
    for (const p of pilotes) placer(p, 0);
  }

  function arreter() {
    for (const p of pilotes) jeu.scene.remove(p.groupe);
    pilotes = []; phase = null;
  }

  const pos = { x: 0, z: 0, cap: 0 };
  function placer(p, dt) {
    poser(p.s, p.lat, pos);
    const y = solAt(pos.x, pos.z);
    const g = p.groupe;
    g.position.set(pos.x, y, pos.z);
    // le tangage suit la pente (ponts) : le sol 1,5 m devant et derrière
    const fx = -Math.sin(pos.cap), fz = -Math.cos(pos.cap);
    const pente = Math.atan2(solAt(pos.x + fx * 1.5, pos.z + fz * 1.5) - solAt(pos.x - fx * 1.5, pos.z - fz * 1.5), 3);
    g.rotation.order = 'YXZ';
    p.tx = pos.tx; p.tz = pos.tz;
    p.cap = pos.cap + p.rot;          // de travers après un choc
    let e = p.cap - g.rotation.y; e = Math.atan2(Math.sin(e), Math.cos(e));
    g.rotation.y = dt && !p.rot ? g.rotation.y + e * Math.min(1, dt * 12) : p.cap;
    g.rotation.x = pente;
    p.roue += p.v * dt / 0.33;
    if (p.objet.majRoues) { try { p.objet.majRoues(0, p.roue, [0, 0, 0, 0]); } catch { /* signature propre à l'engin */ } }
  }

  /** Le « GO » : tout le monde part. */
  function go() { if (phase === 'grille') phase = 'course'; }

  /**
   * Une image. `moi` : l'engin du joueur ({ etat }) ou null ; `chrono` : true
   * dès que le joueur a franchi la ligne.
   */
  function maj(dt, moi) {
    if (!pilotes.length) return;
    let trafic = [];
    try { trafic = obstacles ? obstacles() || [] : []; } catch { trafic = []; }
    horloge += dt;
    if (moi && moi.etat) {
      const pr = projeter(moi.etat.x, moi.etat.z, joueur.s);
      // une abscisse qui saute de plus d'un tour d'un coup est une erreur de projection
      if (Math.abs(pr.s - joueur.s) < 120) { joueur.s = pr.s; joueur.lat = pr.lat; }
      joueur.v = Math.abs(moi.etat.u || 0);
    }
    if (phase !== 'course') { for (const p of pilotes) placer(p, dt); return; }

    const NIV = NIVEAUX[niveau];
    for (const p of pilotes) {
      const fini = p.arrivee !== null;
      // ── la vitesse visée : le profil, puis l'élastique, puis la circulation
      const i = idx(Math.floor(Math.max(0, p.s) / PAS));
      let cible = p.s < 0 ? p.prof.vmax : p.prof.v[i];
      if (NIV.elastique && !joueur.fini && !fini) {
        const ecart = p.s - joueur.s;
        if (ecart > NIV.attend) cible *= Math.max(0.6, 1 - (ecart - NIV.attend) / 200);   // il attend
        else if (ecart < -80) cible *= Math.min(1.12, 1 + (-ecart - 80) / 400);  // il revient
      }
      if (fini) cible = Math.max(0, cible * (1 - (p.s - TOTAL) / 40));          // il ralentit après la ligne

      // ── les autres devant dans ma file : changer de file, sinon rester derrière
      const devant = [...pilotes.filter((q) => q !== p).map((q) => ({ s: q.s, lat: q.lat, v: q.v })),
        { s: joueur.s, lat: joueur.lat, v: joueur.v }];
      // le trafic tout proche, ramené dans le repère du pilote (abscisse, écart, vitesse le long du tracé)
      for (const o of trafic) {
        const ox = o.x - p.groupe.position.x, oz = o.z - p.groupe.position.z;
        if (ox * ox + oz * oz > 400) continue;
        devant.push({ s: p.s + ox * p.tx + oz * p.tz, lat: p.lat + ox * -p.tz + oz * p.tx, v: Math.max(0, o.vx * p.tx + o.vz * p.tz) });
      }
      // on regarde d'autant plus loin qu'on va vite (de quoi freiner à temps)
      const vue = 7 + p.v * 0.7;
      const gene = devant.find((q) => q.s > p.s && q.s - p.s < vue && Math.abs(q.lat - p.file) < 1.6);
      if (gene && cible > gene.v) {
        const libre = FILES.find((f) => f !== p.file && !devant.some((q) => Math.abs(q.s - p.s) < vue && Math.abs(q.lat - f) < 1.6));
        if (libre !== undefined) p.file = libre;
        else cible = Math.min(cible, gene.v);
      }

      // ── accélérer comme l'engin du joueur, freiner fort
      if (p.v < cible) { const x = p.v / Math.max(1, p.prof.vmax); p.v = Math.min(cible, p.v + p.prof.accel * Math.max(0.15, 1 - x * x) * dt); }
      else p.v = Math.max(cible, p.v - FREIN * 1.5 * dt);
      const avantS = p.s;
      p.s += p.v * dt;
      // de la grille à sa file, en douceur ; plus serré dans les virages
      const fileVisee = p.s < 0 ? p.latGrille : p.file * Math.min(1, R[i] / 25);
      const dl = fileVisee - p.lat;
      p.lat += Math.sign(dl) * Math.min(Math.abs(dl), GLISSE_FILE * dt);
      // l'écart et le pivot d'un choc, qui s'éteignent
      if (p.latV || p.rot || p.rotW) {
        p.lat = Math.max(-3, Math.min(3, p.lat + p.latV * dt));
        p.latV *= Math.exp(-3.5 * dt);
        p.rot += p.rotW * dt; p.rotW *= Math.exp(-4 * dt);
        p.rot *= Math.exp(-1.6 * dt);
        if (Math.abs(p.latV) < 0.02) p.latV = 0;
        if (Math.abs(p.rot) < 0.005 && Math.abs(p.rotW) < 0.01) p.rot = p.rotW = 0;
      }

      if (avantS < 0 && p.s >= 0) p.franchi = horloge;
      if (!fini && p.s >= TOTAL && p.franchi !== null) p.arrivee = horloge - p.franchi;
      // arrêté après la ligne : il s'efface, la rue reste libre pour l'arrivée du joueur
      if (fini && p.v < 0.5) p.groupe.visible = false;
      placer(p, dt);
    }

  }

  /** La place du joueur (1 = en tête) et le nombre de concurrents. */
  function place() {
    const devant = pilotes.filter((p) => (p.arrivee !== null) || p.s > joueur.s).length;
    return { rang: devant + 1, sur: pilotes.length + 1 };
  }

  /**
   * Le classement à l'arrivée du joueur. Un pilote encore en course reçoit
   * un temps estimé (le profil sur la distance qui lui reste) : il ne bouge
   * plus guère, il n'y a pas d'imprévu sur sa route.
   */
  function resultats(tempsJoueur, nomJoueur) {
    joueur.fini = true;
    const liste = pilotes.map((p) => {
      if (p.arrivee !== null) return { nom: p.nom, temps: p.arrivee, estime: false, bot: true };
      const tours_ = Math.floor(Math.max(0, p.s) / LONGUEUR);
      const i = Math.floor((Math.max(0, p.s) % LONGUEUR) / PAS);
      const T = p.prof.T;
      const reste = (T[N] - T[i]) + (tours - 1 - tours_) * T[N] + (p.s < 0 ? -p.s / Math.max(1, p.v) : 0);
      const ecoule = p.franchi !== null ? horloge - p.franchi : 0;
      return { nom: p.nom, temps: ecoule + Math.max(0, reste), estime: true, bot: true };
    });
    liste.push({ nom: nomJoueur, temps: tempsJoueur, estime: false, bot: false });
    return liste.sort((a, b) => a.temps - b.temps);
  }

  /** Les pilotes pour le module des chocs. */
  function corps() {
    return pilotes.filter((p) => p.groupe.visible).map((p, i) => {
      const c = CARRURE[p.engin] || CARRURE.voiture;
      const nx = -p.tz, nz = p.tx;
      return {
        cle: 'bot' + i, sorte: 'bot',
        x: p.groupe.position.x, z: p.groupe.position.z, y: p.groupe.position.y, cap: p.cap,
        dw: c.dw, dl: c.dl, masse: c.masse, mobile: true,
        vx: p.tx * p.v + nx * p.latV, vz: p.tz * p.v + nz * p.latV,
        appliquer(f) {
          // le long du tracé : de l'élan en plus ou en moins ; en travers : il part de côté
          p.s += f.dx * p.tx + f.dz * p.tz;
          p.lat = Math.max(-3, Math.min(3, p.lat + f.dx * nx + f.dz * nz));
          p.v = Math.max(0, p.v + f.dvx * p.tx + f.dvz * p.tz);
          p.latV += f.dvx * nx + f.dvz * nz;
          p.rotW += f.dw;
          if (f.force > 0.3) p.v *= 1 - 0.35 * f.force;     // sonné, il lève le pied
          this.x += f.dx; this.z += f.dz;
        },
      };
    });
  }

  return {
    preparer, go, maj, arreter, place, resultats, corps,
    set obstacles(f) { obstacles = f; },
    get niveau() { return niveau; },
    set niveau(n) { if (n in NIVEAUX) niveau = n; },
    get actifs() { return pilotes.length > 0; },
    get phase() { return phase; },
    get pilotes() { return pilotes; },      // poignée de test
    longueur: LONGUEUR,
  };
}
