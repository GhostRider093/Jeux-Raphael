/**
 * Un pays : plusieurs villages relevés réunis dans la même carte, à leur écart réel.
 *
 * Poilhes et Capestang sont à 4 022 m l'un de l'autre. Chacun existe déjà —
 * `maps/poilhes/` et `maps/capestang/`, chacun centré sur sa propre origine.
 * Ce module ne reconstruit rien : il pose chaque village dans un groupe décalé
 * à sa vraie place et fournit ce qu'un village seul apporte avec lui mais qui,
 * à plusieurs, doit être unique :
 *
 *   — un seul ciel et un seul soleil (`creerAmbiance`), sinon deux sphères de
 *     ciel se battent pixel par pixel et la scène est éclairée deux fois ;
 *   — un seul relief lointain (`maps/pays-<nom>/`, 8 km au pas de 20 m), celui
 *     qui relie les villages. Les deux reliefs de 6 km livrés avec eux se
 *     recouvriraient, avec deux photos aériennes d'expositions différentes.
 *
 * Les fonctions d'interrogation (sol, surfaces, obstacles) aiguillent vers le
 * village qui contient le point, et retombent sur le relief du pays entre les
 * deux. Aucune allocation dans la boucle d'animation.
 *
 * Données : `scripts/poilhes/build_pays.py` (PAYS=canal).
 */
import * as THREE from 'three';
import { construireVillage, creerAmbiance, reliefLointain } from './poilhes-scene.js?v=voiture-20260921';

const DOSSIER = (pays) => `maps/pays-${pays}/`;
const HORS_SOL = -1e9;   // « pas de surface ici » — même convention que le village

/**
 * Construit le pays dans une scène.
 *
 * @returns {Promise<object>} meta, villages, groundAt, walkableAt, blockedAt,
 *   surfaceAt, reliefAt, setTime, tick, ambiance, sun, sunDir, sky, skyU, bounds, root.
 */
export async function construirePays({ scene, renderer, camera, onProgress = () => {},
                                       leger = false, root = null, pays = 'canal' }) {
  const BASE = DOSSIER(pays);
  const cible = root || scene;
  if (root && !root.parent) scene.add(root);

  onProgress(0.01, 'Lecture du pays…');
  const meta = await (await fetch(BASE + 'pays.json', { cache: 'no-cache' })).json();
  const buffer = await (await fetch(BASE + 'pays.bin', { cache: 'no-cache' })).arrayBuffer();
  const e = meta.tableaux.lointain;
  const hauteurs = new Float32Array(buffer, e.offset, e.count);
  const F = meta.lointain;
  const V = `?v=${meta.version || 0}`;

  // ------------------------------------------------------------------- ciel commun
  const ambiance = creerAmbiance({
    scene, renderer, cible, leger, lat: meta.origine.lat, lon: meta.origine.lon,
  });

  // ------------------------------------------------------------------- relief commun
  onProgress(0.04, 'Relief du pays…');
  const loader = new THREE.TextureLoader();
  const tex = await new Promise((ok, ko) => loader.load(
    BASE + 'ortho_lointain.jpg' + V,
    (t) => { t.colorSpace = THREE.SRGBColorSpace; ok(t); }, undefined, ko));
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  cible.add(reliefLointain(F, hauteurs, tex));

  /** Altitude du relief du pays (bilinéaire), hors des villages. */
  function reliefAt(x, z) {
    const c = THREE.MathUtils.clamp((x + F.demi_cote) / F.pas, 0, F.n - 1.001);
    const r = THREE.MathUtils.clamp((z + F.demi_cote) / F.pas, 0, F.n - 1.001);
    const i = c | 0, j = r | 0, fx = c - i, fz = r - j;
    const a = hauteurs[j * F.n + i] * (1 - fx) + hauteurs[j * F.n + i + 1] * fx;
    const b = hauteurs[(j + 1) * F.n + i] * (1 - fx) + hauteurs[(j + 1) * F.n + i + 1] * fx;
    return a * (1 - fz) + b * fz;
  }

  // ------------------------------------------------------------------- les villages
  const villages = [];
  const part = 0.94 / meta.villages.length;
  for (let k = 0; k < meta.villages.length; k++) {
    const v = meta.villages[k];
    const groupe = new THREE.Group();
    groupe.name = `village-${v.village}`;
    groupe.position.set(v.x, 0, v.z);
    cible.add(groupe);
    const decor = await construireVillage({
      scene, renderer, camera, root: groupe, leger,
      village: v.village,
      // Le ciel, le soleil et l'horizon sont ceux du pays : le village n'en
      // refait pas. C'est toute la différence entre deux cartes et une seule.
      ambiance, lointain: false,
      onProgress: (f, msg) => onProgress(0.05 + part * (k + f), msg ? `${v.nom} — ${msg}` : msg),
    });
    villages.push({ nom: v.nom, id: v.village, x: v.x, z: v.z, demi: v.demi_cote, decor });
  }

  /** Le village qui contient ce point, ou null si l'on est dans la campagne. */
  function chez(x, z) {
    for (let k = 0; k < villages.length; k++) {
      const u = villages[k];
      if (Math.abs(x - u.x) < u.demi && Math.abs(z - u.z) < u.demi) return u;
    }
    return null;
  }

  function groundAt(x, z) {
    const u = chez(x, z);
    return u ? u.decor.groundAt(x - u.x, z - u.z) : reliefAt(x, z);
  }
  function walkableAt(x, z) {
    const u = chez(x, z);
    return u ? u.decor.walkableAt(x - u.x, z - u.z) : reliefAt(x, z);
  }
  function surfaceAt(x, z) {
    const u = chez(x, z);
    return u ? u.decor.surfaceAt(x - u.x, z - u.z) : HORS_SOL;
  }
  function blockedAt(x, z) {
    const u = chez(x, z);
    return u ? u.decor.blockedAt(x - u.x, z - u.z) : false;
  }

  /** Heure du jour : le ciel une fois, l'éclairage de chaque village ensuite. */
  function setTime(hours) {
    const lampes = ambiance.regler(hours);
    for (let k = 0; k < villages.length; k++) villages[k].decor.setNight(lampes);
  }

  /** Horloge des shaders (eau, feuillage, ciel) — sans elle, le pays est figé. */
  function tick(dt) {
    ambiance.skyU.uTime.value += dt;
    for (let k = 0; k < villages.length; k++) villages[k].decor.clock.value += dt;
  }

  return {
    meta, villages, ambiance,
    groundAt, walkableAt, blockedAt, surfaceAt, reliefAt,
    setTime, tick,
    sun: ambiance.sun, sunDir: ambiance.sunDir, sky: ambiance.sky, skyU: ambiance.skyU,
    root: cible,
    bounds: F.demi_cote,
  };
}
