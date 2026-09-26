/**
 * Les figurants de Poilhes City — pour que ce soit rigolo.
 *
 * Arnaud, 26/09/2026 : « on va le rendre un peu plus fun ; j'ai plein
 * d'objets 3D que j'avais laissés de côté, on les met dedans ». Cinq modèles
 * Meshy, ramenés de 4–47 Mo à 70–900 Ko (`gltf-transform optimize --compress
 * meshopt --texture-compress webp --texture-size 1024 --simplify-ratio 0.1`) :
 *
 *   — le **cycliste** roule sans fin sur la boucle de course, sur le bord
 *     droit, à 25 km/h : on le double pendant la course ;
 *   — le **policier de l'espace** garde la ligne de départ, en commissaire ;
 *   — un **stégosaure** de neuf mètres broute au bord du parcours ;
 *   — **Carole** et les **deux mafieux** tiennent le trottoir devant
 *     l'Ostal Louis — et les mafieux reviennent cinq fois le long du tour.
 *
 * Tous sont du décor : on passe au travers, ils ne bloquent personne.
 * Les modèles regardent +z ; leur hauteur est ramenée à une taille réelle.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';

const DOSSIER = 'assets/fun/';
export const FIGURANTS = {
  cycliste: { fichier: 'cycliste.glb', hauteur: 1.75, vitesse: 7, decalage: 1.9 },
  police: { fichier: 'police.glb', hauteur: 1.95 },
  dinosaure: { fichier: 'dinosaure.glb', longueur: 9, couleur: 0x5f8a3c },
  carole: { fichier: 'carole.glb', hauteur: 1.70 },
  // `parcours` : où les revoir le long de la boucle, en fraction du tour
  mafieux: { fichier: 'pinstripe.glb', hauteur: 1.85, parcours: [0.08, 0.27, 0.46, 0.64, 0.83] },
};

async function charger(loader, def) {
  const gltf = await loader.loadAsync(DOSSIER + def.fichier);
  const objet = gltf.scene;
  objet.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    // Le stégosaure est sorti de Meshy sans texture, et sans normales : on le
    // peint, et on calcule ses normales — sans elles la lumière n'accroche
    // pas et il reste une silhouette noire.
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
    if (def.couleur) o.material = new THREE.MeshStandardMaterial({ color: def.couleur, roughness: 0.8 });
  });
  const boite = new THREE.Box3().setFromObject(objet);
  const t = boite.getSize(new THREE.Vector3());
  const echelle = def.longueur ? def.longueur / Math.max(t.x, t.z) : def.hauteur / t.y;
  objet.scale.setScalar(echelle);
  objet.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(objet);
  const c = b.getCenter(new THREE.Vector3());
  objet.position.set(-c.x, -b.min.y, -c.z);        // centré, les pieds à zéro
  const racine = new THREE.Group();
  racine.add(objet);
  return racine;
}

/**
 * @param {object} o
 * @param {object} o.jeu      ce que rend `startVillage`
 * @param {string} o.village
 */
export async function poserFigurants({ jeu, village }) {
  let boucle = null;
  try {
    const res = await fetch(`maps/${village}/boucle.json`, { cache: 'no-cache' });
    if (res.ok) boucle = await res.json();
  } catch { /* pas de boucle : pas de cycliste */ }
  const sol = (x, z) => jeu.walkableAt(x, z);
  const libre = (x, z) => !jeu.blockedAt(x, z) && !jeu.blockedAt(x + 0.8, z) && !jeu.blockedAt(x - 0.8, z)
    && !jeu.blockedAt(x, z + 0.8) && !jeu.blockedAt(x, z - 0.8);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const scene = jeu.scene;
  const poses = {};

  /** Le point dégagé le plus proche de (x, z), en spirale. */
  function degage(x, z, rayonMax = 25) {
    for (let r = 0; r <= rayonMax; r += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += r ? 0.6 / r : 7) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (libre(px, pz)) return [px, pz];
      }
    }
    return [x, z];
  }
  function poser(obj, x, z, cap) {
    obj.position.set(x, sol(x, z), z);
    obj.rotation.y = cap;
    scene.add(obj);
  }

  // ── le long de la boucle ────────────────────────────────────────────────
  if (boucle) {
    const P = boucle.points;
    const d = boucle.depart;
    const droite = (cap) => [Math.cos(cap), -Math.sin(cap)];   // la droite pour un cap (avant = −z)

    // L'hélicoptère d'Arnaud (poilhes-helico.js) tourne au-dessus de la boucle,
    // centré sur elle. (Celui construit en volumes, « dégueulasse », est retiré.)
    if (jeu.helico) {
      const cx = P.reduce((a, q) => a + q[0], 0) / P.length, cz = P.reduce((a, q) => a + q[1], 0) / P.length;
      jeu.helico.setOrbite({ x: cx, z: cz });
      poses.helicoptere = jeu.helico;
    }

    // Le policier, à droite de la ligne de départ, face à la piste.
    charger(loader, FIGURANTS.police).then((o) => {
      const [rx, rz] = droite(d.cap);
      const [x, z] = degage(d.x + rx * 5, d.z + rz * 5, 8);
      poser(o, x, z, Math.atan2(d.x - x, d.z - z));             // +z du modèle vers la piste
      poses.police = o;
    }).catch((e) => console.warn('Figurant police :', e));

    // Le stégosaure : au milieu du terrain de foot, que la boucle longe — un
    // coin de rue le cachait derrière les arbres. De trois quarts, tourné
    // vers le point du parcours le plus proche.
    charger(loader, FIGURANTS.dinosaure).then((o) => {
      // L'angle nord-est du grand terrain de foot, lu sur le plan : c'est lui
      // que la rue du parcours longe (l'autre « terrain de sport » d'OSM est
      // caché derrière les maisons).
      let [x, z] = village === 'poilhes' ? [34, 124] : degage(P[Math.floor(P.length * 0.3)][0] + 12, P[Math.floor(P.length * 0.3)][1], 20);
      [x, z] = degage(x, z, 10);
      let proche = P[0], dmin = Infinity;
      for (const q of P) { const d2 = Math.hypot(q[0] - x, q[1] - z); if (d2 < dmin) { dmin = d2; proche = q; } }
      poser(o, x, z, Math.atan2(proche[0] - x, proche[1] - z) + 1.1);
      poses.dinosaure = o;
    }).catch((e) => console.warn('Figurant dinosaure :', e));

    // **Les deux mafieux, on doit les voir souvent** (Arnaud, 26/09/2026) :
    // une copie tous les quarts de tour environ, sur le trottoir, tournée vers
    // la route. Les copies partagent géométrie et textures : presque gratuit.
    charger(loader, FIGURANTS.mafieux).then((modele) => {
      poses.mafieuxParcours = [];
      for (const f of FIGURANTS.mafieux.parcours) {
        const i = Math.floor(P.length * f);
        const [ax, az] = P[i], [bx, bz] = P[Math.min(P.length - 1, i + 2)];
        const cap = Math.atan2(-(bx - ax), -(bz - az));
        const [rx, rz] = droite(cap);
        // le trottoir de droite, sinon celui d'en face
        let [x, z] = [ax + rx * 4.2, az + rz * 4.2];
        if (!libre(x, z)) [x, z] = [ax - rx * 4.2, az - rz * 4.2];
        [x, z] = degage(x, z, 5);
        const o = f === FIGURANTS.mafieux.parcours[0] ? modele : modele.clone();
        poser(o, x, z, Math.atan2(ax - x, az - z));
        poses.mafieuxParcours.push(o);
      }
    }).catch((e) => console.warn('Figurants mafieux (parcours) :', e));

    // Le cycliste : il tourne sans fin, sur le bord droit.
    charger(loader, FIGURANTS.cycliste).then((o) => {
      scene.add(o);
      poses.cycliste = o;
      const def = FIGURANTS.cycliste;
      const s = [0];
      for (let k = 1; k <= P.length; k++) {
        const a = P[k - 1], b = P[k % P.length];
        s.push(s[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      const total = s[P.length];
      let dist = total * 0.55, k = 1, avant = performance.now();
      const pos = new THREE.Vector3();
      function image(t) {
        requestAnimationFrame(image);
        const dt = Math.min(0.1, (t - avant) / 1000); avant = t;
        if (document.hidden) return;
        dist = (dist + def.vitesse * dt) % total;
        if (k > P.length || s[k - 1] > dist) k = 1;
        while (k < P.length && s[k] < dist) k++;
        const a = P[k - 1], b = P[k % P.length];
        const L = s[k] - s[k - 1] || 1, u = (dist - s[k - 1]) / L;
        const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
        const x = a[0] + (b[0] - a[0]) * u - dz * def.decalage;
        const z = a[1] + (b[1] - a[1]) * u + dx * def.decalage;
        pos.set(x, sol(x, z), z);
        o.position.lerp(pos, o.position.lengthSq() ? Math.min(1, dt * 12) : 1);
        // le cap tourne en douceur : pas de demi-tour sec au passage d'un sommet
        const cap = Math.atan2(dx, dz);
        let e = cap - o.rotation.y; e = Math.atan2(Math.sin(e), Math.cos(e));
        o.rotation.y += e * Math.min(1, dt * 6);
      }
      requestAnimationFrame(image);
    }).catch((e) => console.warn('Figurant cycliste :', e));
  }

  // ── devant l'Ostal Louis : Carole et les deux mafieux ───────────────────
  let epicerie = null;
  scene.traverse((o) => { if (o.name === 'epicerie') epicerie = o; });
  if (epicerie) {
    const cap = epicerie.rotation.y;                      // +z du groupe = vers la rue
    const fx = Math.sin(cap), fz = Math.cos(cap);         // vers la rue
    const lx = Math.cos(cap), lz = -Math.sin(cap);        // le long de la façade
    const e = epicerie.position;
    charger(loader, FIGURANTS.mafieux).then((o) => {
      const [x, z] = degage(e.x + fx * 2.2 - lx * 4.5, e.z + fz * 2.2 - lz * 4.5, 6);
      poser(o, x, z, cap + 0.4);
      poses.mafieux = o;
    }).catch((err) => console.warn('Figurants mafieux :', err));
    charger(loader, FIGURANTS.carole).then((o) => {
      const [x, z] = degage(e.x + fx * 2.0 - lx * 2.6, e.z + fz * 2.0 - lz * 2.6, 6);
      poser(o, x, z, cap - 0.3);
      poses.carole = o;
    }).catch((err) => console.warn('Figurante Carole :', err));
  }
  return poses;
}
