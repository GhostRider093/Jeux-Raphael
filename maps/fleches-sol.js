/**
 * Des flèches peintes au sol le long d'un tracé — rien d'autre.
 *
 * Arnaud, 26/09/2026 : « le truc vert au sol, c'est horrible, ça gâche le
 * spectacle ; je veux les mêmes flèches, mais sans le truc vert, bien
 * voyantes ». Donc plus de bande : une flèche jaune cernée de noir tous les
 * `pas` mètres, posée à plat sur le sol (elle prend la pente), orientée dans
 * le sens de la course. Un seul maillage instancié, construit une fois.
 *
 * Utilisé par la course Poilhes–Capestang (`course-route.js`) et la boucle
 * de village (`course-boucle.js`).
 */
import * as THREE from 'three';

/** La texture de la flèche : un chevron plein, jaune, bordé de noir. */
function textureFleche() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  g.beginPath();
  g.moveTo(64, 8);        // pointe (en haut = vers l'avant)
  g.lineTo(120, 70);
  g.lineTo(84, 70);
  g.lineTo(84, 120);
  g.lineTo(44, 120);
  g.lineTo(44, 70);
  g.lineTo(8, 70);
  g.closePath();
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = '#141414';
  g.stroke();
  g.fillStyle = '#ffd21f';
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * @param {Array<[number, number]>} points  la polyligne (x, z), dans le sens de la course
 * @param {Function} solAt                   (x, z) => altitude du sol praticable
 * @param {object} [o]
 * @param {number} [o.pas=8]        m entre deux flèches
 * @param {number} [o.largeur=2]    m
 * @param {number} [o.longueur=2.4] m
 * @param {number} [o.debut=0]      m avant la première flèche
 * @param {boolean} [o.boucle=false] le tracé revient à son premier point
 * @param {number} [o.decalage=0]  m vers la droite : sur une rue parcourue dans
 *                                 les deux sens, chaque sens a sa voie
 * @param {object} [o.virages]     **flèches aux virages** (Arnaud, 26/09/2026 : « un peu
 *                                 moins de flèches, et des flèches au niveau des virages, pour
 *                                 bien faire comprendre qu'il faut tourner ») :
 *                                 { pasDroit, pasVirage, avant, seuil, grand } — en ligne droite
 *                                 une flèche tous les `pasDroit` m ; dans un virage (le cap
 *                                 tourne de plus de `seuil` rad sur 16 m) et `avant` m avant lui,
 *                                 une tous les `pasVirage` m, `grand` fois plus grande
 * @returns {THREE.InstancedMesh}
 */
export function construireFleches(points, solAt, {
  pas = 8, largeur = 2, longueur = 2.4, debut = 0, boucle = false, decalage = 0, virages = null,
} = {}) {
  const P = boucle ? [...points, points[0]] : points;
  // abscisses curvilignes
  const s = [0];
  for (let i = 1; i < P.length; i++) s.push(s[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const total = s[s.length - 1];
  /** Point et direction à l'abscisse d. */
  function pointA(d) {
    let i = 1;
    while (i < P.length - 1 && s[i] < d) i++;
    const a = P[i - 1], b = P[i];
    const L = s[i] - s[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - s[i - 1]) / L));
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / L, dz: (b[1] - a[1]) / L };
  }
  // Les virages : là où le cap tourne franchement sur 16 m.
  let enVirage = () => false;
  if (virages) {
    const cap = (d) => { const p = pointA(Math.max(0, Math.min(total, d))); return Math.atan2(p.dx, p.dz); };
    const zones = [];
    for (let d = 0; d < total; d += 2) {
      let ecart = cap(d + 8) - cap(d - 8);
      ecart = Math.atan2(Math.sin(ecart), Math.cos(ecart));
      if (Math.abs(ecart) > virages.seuil) zones.push([d - virages.avant, d + 6]);
    }
    enVirage = (d) => zones.some(([a, b]) => d >= a && d <= b);
  }
  const poses = [];
  for (let d = debut; d < total - 1;) {
    const p = pointA(d);
    const virage = enVirage(d);
    // la droite du sens de marche est (−dz, dx) : l'avant est −z quand le cap vaut 0
    poses.push({ x: p.x - p.dz * decalage, z: p.z + p.dx * decalage, dx: p.dx, dz: p.dz, echelle: virage ? virages.grand : 1 });
    d += virages ? (virage ? virages.pasVirage : virages.pasDroit) : pas;
  }

  const geo = new THREE.PlaneGeometry(largeur, longueur);
  geo.rotateX(-Math.PI / 2);            // à plat, le haut de la texture vers −z (l'avant)
  const mat = new THREE.MeshBasicMaterial({
    map: textureFleche(), transparent: true, alphaTest: 0.35, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, poses.length));
  inst.name = 'fleches-sol';
  inst.renderOrder = 3;
  inst.frustumCulled = false;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ');
  const v = new THREE.Vector3(), un = new THREE.Vector3(1, 1, 1);
  const demi = longueur / 2;
  poses.forEach((p, k) => {
    // la flèche épouse la pente : sol lu à l'avant et à l'arrière
    const yAv = solAt(p.x + p.dx * demi, p.z + p.dz * demi);
    const yAr = solAt(p.x - p.dx * demi, p.z - p.dz * demi);
    e.set(Math.atan2(yAv - yAr, longueur), Math.atan2(-p.dx, -p.dz), 0);
    q.setFromEuler(e);
    m.compose(v.set(p.x, (yAv + yAr) / 2 + 0.07, p.z), q, un.set(p.echelle || 1, 1, p.echelle || 1));
    inst.setMatrixAt(k, m);
  });
  inst.count = poses.length;
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}
