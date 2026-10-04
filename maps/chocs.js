/**
 * Les chocs entre engins — Poilhes City.
 *
 * Arnaud, 01/10/2026 : « travailler et surtout blinder les collisions entre
 * voitures, avec chocs, bruitages et compagnie ». Jusque-là, le trafic était
 * un décor qu'on traversait.
 *
 * Chaque engin est une **boîte orientée** (largeur, longueur, cap) avec une
 * masse et une vitesse. Les sources (le joueur, le trafic, les adversaires de
 * l'ordinateur, les joueurs en ligne) donnent leurs boîtes à chaque image ;
 * ce module trouve les contacts et rend à chacun sa part :
 *
 *   — **détection** par axes séparateurs (deux boîtes orientées en 2D), avec
 *     un tri grossier par distance d'abord ;
 *   — **jamais au travers** : le déplacement du joueur depuis l'image
 *     précédente est découpé en pas de 60 cm, et l'on s'arrête au premier
 *     contact. À 160 km/h et 30 images/s, une voiture fait 1,5 m par image :
 *     sans ce découpage, elle traverserait une trottinette de profil ;
 *   — **réponse** par impulsion : on sépare les boîtes (au prorata des
 *     masses), puis l'impulsion le long de la normale (restitution 0,3, ça
 *     rebondit un peu sans faire flipper) et un frottement tangentiel. Un
 *     choc décentré fait **pivoter** l'engin (moment d'inertie de la boîte),
 *     pivot plafonné : on part de travers, pas en toupie ;
 *   — **effets** : bruitage (`sons-chocs.js`) dosé par la vitesse de
 *     rapprochement, étincelles au point de contact, secousse de caméra et
 *     vibration de la manette quand le joueur est dans le choc ; tôle qui
 *     racle tant que deux engins glissent l'un contre l'autre ;
 *   — **les murs** : le pilote gère déjà le contact ; ici on écoute la
 *     vitesse du joueur et un freinage brutal sans engin en face devient un
 *     choc (son, étincelles, secousse).
 *
 * Interface d'une boîte (`corps`) :
 *   { cle, sorte, x, z, y, cap, dw, dl, masse, vx, vz, mobile, appliquer(effet) }
 *   `cap` dans la convention des engins (l'avant est (−sin cap, −cos cap)) ;
 *   `dw`, `dl` : demi-largeur, demi-longueur (m) ;
 *   `mobile: false` : l'engin ne bouge pas sous le choc (joueur en ligne :
 *   c'est son propre navigateur qui le fait réagir) ;
 *   `appliquer({ dx, dz, dvx, dvz, dw, force, point })` : déplacement de
 *   séparation, changement de vitesse, de vitesse de rotation (rad/s), force du
 *   choc (0…1), point de contact.
 */
import * as THREE from 'three';
import { impact, frottement } from './sons-chocs.js?v=20261004a';

export const REGLES = {
  restitution: 0.3,        // part de la vitesse de rapprochement rendue en rebond
  frottement: 0.35,        // frottement tangentiel au contact
  dvMax: 22,               // m/s : un choc ne change jamais une vitesse de plus que ça
  pivotMax: 2.0,           // rad/s : la rotation qu'un choc peut donner, au plus
  pas: 0.6,                // m : découpage du déplacement du joueur
  teleportation: 12,       // m en une image : un `placer`, pas un déplacement
  hauteur: 1.4,            // m d'écart vertical au-delà duquel on passe au-dessus (saut)
  vitessePleine: 15,       // m/s de rapprochement pour un choc « à fond » (force 1)
  mur: 5,                  // m/s perdus en une image sans engin en face = choc contre un mur
  secousse: 0.32,          // m de secousse de caméra pour un choc à fond
};

const SORTES_JOUEUR = {
  voiture: { dw: 0.88, dl: 2.05, masse: 1450 },
  quad: { dw: 0.62, dl: 1.0, masse: 380 },
  trottinette: { dw: 0.32, dl: 0.62, masse: 110 },
};

// ── géométrie ────────────────────────────────────────────────────────────
function axes(c) {
  const fx = -Math.sin(c.cap), fz = -Math.cos(c.cap);
  return { fx, fz, rx: -fz, rz: fx };
}
/** Demi-étendue d'une boîte le long d'un axe (ax, az). */
function etendue(c, a, ax, az) {
  return c.dl * Math.abs(a.fx * ax + a.fz * az) + c.dw * Math.abs(a.rx * ax + a.rz * az);
}
/**
 * Deux boîtes orientées se touchent-elles ? Si oui : la normale (de A vers B)
 * et la profondeur, le long de l'axe de moindre recouvrement.
 */
function contact(A, B, ax0 = null, az0 = null) {
  const xA = ax0 ?? A.x, zA = az0 ?? A.z;
  const a = axes(A), b = axes(B);
  const dx = B.x - xA, dz = B.z - zA;
  let meilleur = Infinity, nx = 0, nz = 0;
  for (const [ux, uz] of [[a.fx, a.fz], [a.rx, a.rz], [b.fx, b.fz], [b.rx, b.rz]]) {
    const d = dx * ux + dz * uz;
    const recouvre = etendue(A, a, ux, uz) + etendue(B, b, ux, uz) - Math.abs(d);
    if (recouvre <= 0) return null;
    if (recouvre < meilleur) { meilleur = recouvre; const s = d >= 0 ? 1 : -1; nx = ux * s; nz = uz * s; }
  }
  // le point de contact : le bord de A, face à B
  const e = etendue(A, a, nx, nz);
  return { nx, nz, prof: meilleur, px: xA + nx * (e - meilleur / 2), pz: zA + nz * (e - meilleur / 2) };
}
const rayon = (c) => Math.hypot(c.dw, c.dl);
const inertie = (c) => c.masse * ((2 * c.dl) ** 2 + (2 * c.dw) ** 2) / 12;

// ── les étincelles ───────────────────────────────────────────────────────
function creerEtincelles(scene) {
  const N = 320;
  const pos = new Float32Array(N * 3), vit = new Float32Array(N * 3), vie = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffb347, size: 0.16, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  for (let i = 0; i < N; i++) pos[i * 3 + 1] = -1e4;
  scene.add(points);
  let suivant = 0, vivantes = 0;
  return {
    jaillir(x, y, z, nombre, force, tx = 0, tz = 0) {
      for (let k = 0; k < nombre; k++) {
        const i = suivant; suivant = (suivant + 1) % N;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        const v = 3 + Math.random() * 7 * (0.4 + force);
        const a = Math.random() * Math.PI * 2;
        vit[i * 3] = Math.cos(a) * v * 0.6 + tx * 0.5;
        vit[i * 3 + 1] = 1.5 + Math.random() * 4 * (0.3 + force);
        vit[i * 3 + 2] = Math.sin(a) * v * 0.6 + tz * 0.5;
        vie[i] = 0.25 + Math.random() * 0.45;
      }
      vivantes = N;
    },
    maj(dt) {
      if (!vivantes) return;
      let encore = 0;
      for (let i = 0; i < N; i++) {
        if (vie[i] <= 0) continue;
        vie[i] -= dt;
        if (vie[i] <= 0) { pos[i * 3 + 1] = -1e4; continue; }
        encore++;
        vit[i * 3 + 1] -= 14 * dt;
        pos[i * 3] += vit[i * 3] * dt; pos[i * 3 + 1] += vit[i * 3 + 1] * dt; pos[i * 3 + 2] += vit[i * 3 + 2] * dt;
      }
      vivantes = encore;
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/**
 * @param {object} o
 * @param {object} o.jeu       ce que rend `startVillage` (scene, camera, mode, voiture, quad, trottinette, walkableAt)
 * @param {Function[]} o.sources  fonctions qui rendent chacune un tableau de corps (trafic, adversaires, en ligne)
 */
export function creerChocs({ jeu, sources = [] }) {
  const etincelles = creerEtincelles(jeu.scene);
  const solAt = (x, z) => jeu.walkableAt(x, z);

  // ── le joueur ─────────────────────────────────────────────────────────
  let pivotJoueur = 0;              // rad/s ajoutés par les chocs, qui s'éteignent
  function piloteCourant() {
    const m = jeu.mode;
    return m === 'voiture' ? jeu.voiture : m === 'quad' ? jeu.quad : m === 'trottinette' ? jeu.trottinette : null;
  }
  function corpsJoueur() {
    const p = piloteCourant();
    if (!p || !p.etat) return null;
    const e = p.etat, d = SORTES_JOUEUR[jeu.mode];
    const s = Math.sin(e.yaw), c = Math.cos(e.yaw);
    return {
      cle: 'joueur', sorte: 'joueur', joueur: true,
      x: e.x, z: e.z, y: p.root ? p.root.position.y : solAt(e.x, e.z), cap: e.yaw,
      dw: d.dw, dl: d.dl, masse: d.masse, mobile: true,
      vx: -s * e.u + c * e.v, vz: -c * e.u - s * e.v,
      appliquer(f) {
        e.x += f.dx; e.z += f.dz;
        this.x += f.dx; this.z += f.dz; this.vx += f.dvx; this.vz += f.dvz;   // pour le contact suivant
        const dvx = f.dvx, dvz = f.dvz;
        // vitesse monde → repère de l'engin (u vers l'avant, v latéral)
        const s2 = Math.sin(e.yaw), c2 = Math.cos(e.yaw);
        e.u += -s2 * dvx - c2 * dvz;
        e.v += c2 * dvx - s2 * dvz;
        pivotJoueur = THREE.MathUtils.clamp(pivotJoueur + f.dw, -REGLES.pivotMax, REGLES.pivotMax);
      },
    };
  }
  /**
   * Le pivot dû aux chocs : la caisse tourne, la vitesse monde ne tourne pas —
   * l'accroche de la loi arcade la ramène ensuite dans l'axe. C'est la
   * conséquence d'un choc, pas une aide : rien ne touche à la direction.
   */
  function pivoter(dt) {
    if (Math.abs(pivotJoueur) < 0.01) { pivotJoueur = 0; return; }
    const p = piloteCourant();
    if (p && p.etat) {
      const e = p.etat, d = pivotJoueur * dt;
      e.yaw += d;
      const cd = Math.cos(d), sd = Math.sin(d), u0 = e.u;
      e.u = u0 * cd - e.v * sd;
      e.v = e.v * cd + u0 * sd;
    }
    pivotJoueur *= Math.exp(-dt / 0.3);
  }

  // ── la secousse de caméra et la manette ───────────────────────────────
  let secousse = 0;
  const sauve = new THREE.Vector3();
  let decale = false;
  const avantRendu = jeu.scene.onBeforeRender, apresRendu = jeu.scene.onAfterRender;
  jeu.scene.onBeforeRender = function (r, s, cam, ...reste) {
    if (avantRendu) avantRendu.call(this, r, s, cam, ...reste);
    if (secousse > 0.005 && cam === jeu.camera) {
      sauve.copy(cam.position); decale = true;
      cam.position.x += (Math.random() * 2 - 1) * secousse;
      cam.position.y += (Math.random() * 2 - 1) * secousse * 0.6;
      cam.position.z += (Math.random() * 2 - 1) * secousse;
      cam.updateMatrixWorld();
    }
  };
  jeu.scene.onAfterRender = function (r, s, cam, ...reste) {
    if (decale && cam === jeu.camera) { cam.position.copy(sauve); cam.updateMatrixWorld(); decale = false; }
    if (apresRendu) apresRendu.call(this, r, s, cam, ...reste);
  };
  function vibrer(force) {
    try {
      for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
        if (gp && gp.vibrationActuator && gp.vibrationActuator.playEffect) {
          gp.vibrationActuator.playEffect('dual-rumble', {
            duration: 120 + force * 380, strongMagnitude: Math.min(1, 0.3 + force), weakMagnitude: Math.min(1, 0.5 + force * 0.5),
          }).catch(() => {});
        }
      }
    } catch { /* pas de manette */ }
  }

  /** Un choc s'entend, se voit, et secoue si le joueur y est. */
  const derniers = new Map();         // paire → instant du dernier bruit
  let horloge = 0;
  function effets(cle, force, px, pz, y, joueurDedans, distance, tx, tz) {
    const avant = derniers.get(cle) || -1;
    if (horloge - avant < 0.25) return;          // un contact qui dure n'est pas une rafale de chocs
    derniers.set(cle, horloge);
    impact(force, joueurDedans ? 0 : distance);
    if (force > 0.12 && distance < 80) etincelles.jaillir(px, y + 0.5, pz, Math.round(6 + force * 40), force, tx, tz);
    if (joueurDedans) {
      secousse = Math.max(secousse, REGLES.secousse * force);
      if (force > 0.08) vibrer(force);
    }
  }

  // ── une paire en contact ──────────────────────────────────────────────
  function resoudre(A, B, k, joueur) {
    const invA = A.mobile ? 1 / A.masse : 0, invB = B.mobile ? 1 / B.masse : 0;
    const inv = invA + invB;
    if (inv <= 0) return null;
    const { nx, nz, prof, px, pz } = k;
    // séparer, au prorata des masses (+ 1 cm, qu'ils ne se recollent pas)
    const sep = prof + 0.01;
    const effetA = { dx: -nx * sep * invA / inv, dz: -nz * sep * invA / inv, dvx: 0, dvz: 0, dw: 0, force: 0, point: { x: px, z: pz } };
    const effetB = { dx: nx * sep * invB / inv, dz: nz * sep * invB / inv, dvx: 0, dvz: 0, dw: 0, force: 0, point: { x: px, z: pz } };
    const rvx = B.vx - A.vx, rvz = B.vz - A.vz;
    const vn = rvx * nx + rvz * nz;
    let force = 0, glisse = 0;
    // tangente et vitesse de glissement
    let tx = rvx - vn * nx, tz = rvz - vn * nz;
    const vt = Math.hypot(tx, tz);
    if (vt > 1e-4) { tx /= vt; tz /= vt; }
    if (vn < 0) {
      const J = -(1 + REGLES.restitution) * vn / inv;
      const Jt = Math.max(-REGLES.frottement * J, Math.min(REGLES.frottement * J, -vt / inv));
      let ix = nx * J + tx * Jt, iz = nz * J + tz * Jt;
      // jamais plus de dvMax de changement de vitesse pour le plus léger
      const dvPire = Math.hypot(ix, iz) * Math.max(invA, invB);
      if (dvPire > REGLES.dvMax) { const r = REGLES.dvMax / dvPire; ix *= r; iz *= r; }
      effetA.dvx = -ix * invA; effetA.dvz = -iz * invA;
      effetB.dvx = ix * invB; effetB.dvz = iz * invB;
      // le pivot : r × impulsion / inertie (rotation autour de +y, positive à gauche)
      const pivot = (C, Fx, Fz) => {
        const rx = px - C.x, rz = pz - C.z;
        return THREE.MathUtils.clamp((rz * Fx - rx * Fz) / inertie(C), -REGLES.pivotMax, REGLES.pivotMax);
      };
      if (invA) effetA.dw = pivot(A, -ix, -iz);
      if (invB) effetB.dw = pivot(B, ix, iz);
      force = Math.min(1, -vn / REGLES.vitessePleine);
    } else {
      glisse = vt;
    }
    effetA.force = effetB.force = force;
    A.appliquer(effetA);
    B.appliquer(effetB);
    if (force > 0.03) {
      const y = Math.max(A.y || 0, B.y || 0);
      const dist = joueur ? Math.hypot(px - joueur.x, pz - joueur.z) : 0;
      effets(A.cle + '|' + B.cle, force, px, pz, y, A.joueur || B.joueur, dist, tx * vt, tz * vt);
    }
    return { glisse, joueurDedans: A.joueur || B.joueur, px, pz, y: Math.max(A.y || 0, B.y || 0) };
  }

  // ── la boucle ─────────────────────────────────────────────────────────
  let avant = performance.now();
  let precedent = null;           // { x, z, v } du joueur, image précédente
  let actif = true;
  function image(t) {
    if (!actif) return;
    requestAnimationFrame(image);
    const dt = Math.min(0.1, (t - avant) / 1000); avant = t;
    if (dt <= 0 || document.hidden) return;
    horloge += dt;
    etincelles.maj(dt);
    secousse *= Math.exp(-dt / 0.12);
    pivoter(dt);

    const joueur = corpsJoueur();
    const autres = [];
    for (const src of sources) {
      try { const l = src(); if (l) for (const c of l) if (c && Number.isFinite(c.x) && Number.isFinite(c.z)) autres.push(c); } catch { /* source pas prête */ }
    }

    let racle = 0, chocVehicule = false;
    if (joueur) {
      // ── le joueur : découpé en pas, arrêt au premier contact ──
      const saut = precedent ? Math.hypot(joueur.x - precedent.x, joueur.z - precedent.z) : 0;
      const pas = saut > REGLES.teleportation ? 1 : Math.max(1, Math.ceil(saut / REGLES.pas));
      const proches = autres.filter((c) => Math.hypot(c.x - joueur.x, c.z - joueur.z) < rayon(c) + rayon(joueur) + saut + 1
        && Math.abs((c.y ?? joueur.y) - joueur.y) < REGLES.hauteur);
      for (const c of proches) {
        let k = null;
        for (let i = 1; i <= pas && !k; i++) {
          if (pas === 1) { k = contact(joueur, c); break; }
          const f = i / pas;
          const x = precedent.x + (joueur.x - precedent.x) * f, z = precedent.z + (joueur.z - precedent.z) * f;
          k = contact(joueur, c, x, z);
          if (k && i < pas) {
            // on ramène le joueur là où il a touché, avant de résoudre
            joueur.appliquer({ dx: x - joueur.x, dz: z - joueur.z, dvx: 0, dvz: 0, dw: 0 });
          }
        }
        if (!k) continue;
        const r = resoudre(joueur, c, k, joueur);
        if (!r) continue;
        chocVehicule = true;
        // Deuxième passe : si l'autre n'a pas pu bouger (contre un mur, au bout
        // de son écart), c'est le joueur qui sort entièrement. On ne s'enfonce jamais.
        const k2 = contact(joueur, c);
        if (k2) joueur.appliquer({ dx: -k2.nx * (k2.prof + 0.01), dz: -k2.nz * (k2.prof + 0.01), dvx: 0, dvz: 0, dw: 0 });
        if (r.glisse > 2) {
          racle = Math.max(racle, Math.min(1, (r.glisse - 2) / 14));
          if (Math.random() < dt * 25) etincelles.jaillir(r.px, r.y + 0.45, r.pz, 2, 0.2);
        }
      }
    }
    // ── les autres entre eux : adversaires contre trafic (le trafic entre
    //    lui-même garde ses distances, on ne s'en mêle pas) ──
    for (let i = 0; i < autres.length; i++) {
      const A = autres[i];
      if (A.sorte !== 'bot') continue;
      for (let j = 0; j < autres.length; j++) {
        const B = autres[j];
        if (j === i || B.sorte === 'avatar' || (B.sorte === 'bot' && j < i)) continue;
        if (Math.hypot(A.x - B.x, A.z - B.z) > rayon(A) + rayon(B)) continue;
        if (Math.abs((A.y ?? 0) - (B.y ?? 0)) > REGLES.hauteur) continue;
        const k = contact(A, B);
        if (k) resoudre(A, B, k, joueur);
      }
    }
    frottement(racle);

    // ── les murs : un freinage brutal sans engin en face ──
    const p = piloteCourant();
    if (joueur && p && p.etat) {
      const v = Math.hypot(p.etat.u, p.etat.v);
      if (precedent && !chocVehicule && Math.hypot(p.etat.x - precedent.x, p.etat.z - precedent.z) < REGLES.teleportation) {
        const perte = precedent.v - v;
        // (une vitesse remise à zéro pile, c'est un `placer` : départ de course, R)
        if (perte > REGLES.mur && !(p.etat.u === 0 && p.etat.v === 0)) {
          const force = Math.min(1, perte / (REGLES.vitessePleine * 1.2));
          const fx = -Math.sin(p.etat.yaw), fz = -Math.cos(p.etat.yaw);
          effets('mur', force, p.etat.x + fx * joueur.dl, p.etat.z + fz * joueur.dl, joueur.y, true, 0, 0, 0);
        }
      }
      precedent = { x: p.etat.x, z: p.etat.z, v };
    } else precedent = null;
  }
  requestAnimationFrame(image);

  return {
    REGLES,
    /** Ajouter une source de corps après coup (le trafic arrive plus tard). */
    ajouterSource(f) { sources.push(f); },
    arreter() { actif = false; frottement(0); },
  };
}
