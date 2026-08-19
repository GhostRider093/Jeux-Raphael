import * as THREE from 'three';
import { addTubePath } from './world-collision.js?v=tunnels-20260819';

// ══════════════════════════════════════════════════════════════════════════
//  GEOMETRIE DES TUNNELS
// --------------------------------------------------------------------------
//  Un tunnel est decrit par une poignee de nombres : des points de controle,
//  un rayon, un profil. La geometrie n'est jamais enregistree — elle est
//  reconstruite a l'identique au chargement, comme le reste du monde.
//
//  Le meme trace produit l'enveloppe visible ET les troncons de collision.
//  C'est volontaire : deux sources separees finiraient par diverger, et un
//  tunnel dont la paroi visible ne coincide plus avec la paroi solide est
//  l'un des defauts les plus penibles a diagnostiquer.
//
//  La section n'est pas dessinee par `TubeGeometry`, qui ne sait faire que du
//  rond. On extrude nous-memes un profil polygonal le long de la courbe, ce
//  qui donne les trois sections avec un seul chemin de code — le rond n'etant
//  qu'un polygone a seize cotes.
// ══════════════════════════════════════════════════════════════════════════

/** Longueur visee d'un troncon, en unites monde. */
const SEGMENT_LENGTH = 24;
const MIN_SEGMENTS = 6;
// Plafond de securite : un trace absurde ne doit pas figer l'onglet.
const MAX_SEGMENTS = 400;

/**
 * Sections disponibles. Chaque profil rend une liste de sommets 2D sur un
 * rayon de 1, parcourue dans le sens trigonometrique.
 *
 * `inscribed` est le rayon du plus grand cercle contenu dans le profil. La
 * collision est circulaire : c'est ce rayon-la qu'elle utilise, jamais le
 * rayon nominal. Un pilote est donc arrete un peu avant la paroi dans les
 * angles, ce qui est le bon sens de l'erreur — l'inverse le laisserait
 * traverser la pierre a vue.
 */
export const TUNNEL_PROFILES = {
  round: {
    label: 'Rond',
    // Un polygone a seize cotes passe legerement en deca du cercle nominal au
    // milieu de chaque arete. La collision s'aligne sur ce creux.
    inscribed: Math.cos(Math.PI / 16),
    build: () => ring(16)
  },
  square: {
    label: 'Carré',
    inscribed: 1,
    build: () => [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  },
  arch: {
    // Voute en haut, parois droites, sol plat : la section d'un tunnel
    // creuse. C'est la seule des trois sur laquelle on peut se poser.
    label: 'Arche',
    inscribed: 1,
    build: () => {
      const points = [[-1, -1], [1, -1], [1, 0]];
      for (let i = 1; i < 10; i++) {
        const angle = (i / 10) * Math.PI;
        points.push([Math.cos(angle), Math.sin(angle)]);
      }
      points.push([-1, 0]);
      return points;
    }
  }
};

function ring(count) {
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    points.push([Math.cos(angle), Math.sin(angle)]);
  }
  return points;
}

/** Profil connu, ou la section ronde a defaut. */
export function getProfile(name) {
  return TUNNEL_PROFILES[name] || TUNNEL_PROFILES.round;
}

/**
 * Courbe lissee passant par les points de controle.
 * Le lissage est volontairement doux (`.4`) : au-dela, un trace serre part
 * en boucle entre deux points et le tunnel se recoupe lui-meme.
 */
export function tunnelCurve(points) {
  const vectors = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  return new THREE.CatmullRomCurve3(vectors, false, 'catmullrom', .4);
}

function segmentCount(curve) {
  const length = curve.getLength();
  return THREE.MathUtils.clamp(Math.round(length / SEGMENT_LENGTH), MIN_SEGMENTS, MAX_SEGMENTS);
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
// Reference de secours pour les troncons verticaux, ou la verticale du monde
// ne peut plus servir : le produit vectoriel s'y annule.
const FALLBACK_UP = new THREE.Vector3(0, 0, 1);

/**
 * Repere du profil a l'abscisse `t`, ecrit dans `right` et `up`.
 *
 * Les reperes de Frenet de Three.js ne conviennent pas ici : leur orientation
 * autour de l'axe est arbitraire et tourne le long de la courbe. Une arche s'y
 * retrouve couchee sur le flanc, et son sol plat finit au plafond. On reconstruit
 * donc un repere cale sur la verticale du monde — le haut du profil reste le
 * haut du tunnel, du premier metre au dernier.
 */
function frameAt(curve, t, right, up, tangent) {
  curve.getTangentAt(t, tangent);
  const reference = Math.abs(tangent.y) > .999 ? FALLBACK_UP : WORLD_UP;
  right.crossVectors(tangent, reference).normalize();
  up.crossVectors(right, tangent).normalize();
}

/**
 * Extrude le profil le long de la courbe.
 *
 * Les faces sont orientees vers l'INTERIEUR : c'est la paroi qu'on longe en
 * volant, et c'est donc elle qui doit etre eclairee correctement. Le materiau
 * est rendu en `DoubleSide` pour que l'ouvrage reste visible de l'exterieur
 * quand il ne traverse pas une montagne — passerelle spatiale, tube suspendu.
 */
function buildShell(curve, profile, radius, segments) {
  const section = profile.build();
  const sides = section.length;
  const positions = new Float32Array((segments + 1) * sides * 3);
  const uvs = new Float32Array((segments + 1) * sides * 2);
  const point = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, point);
    frameAt(curve, t, right, up, tangent);
    for (let j = 0; j < sides; j++) {
      const [px, py] = section[j];
      const base = (i * sides + j) * 3;
      positions[base] = point.x + (right.x * px + up.x * py) * radius;
      positions[base + 1] = point.y + (right.y * px + up.y * py) * radius;
      positions[base + 2] = point.z + (right.z * px + up.z * py) * radius;
      const uvBase = (i * sides + j) * 2;
      // La texture se repete tous les deux rayons parcourus : le defilement
      // reste lisible a grande vitesse sans etirer le motif dans les courbes.
      uvs[uvBase] = (i / segments) * (curve.getLength() / (radius * 2));
      uvs[uvBase + 1] = j / sides;
    }
  }

  const indices = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < sides; j++) {
      const next = (j + 1) % sides;
      const a = i * sides + j;
      const b = i * sides + next;
      const c = (i + 1) * sides + next;
      const d = (i + 1) * sides + j;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const DEFAULT_MATERIAL = {
  color: 0x4a5560,
  roughness: .92,
  metalness: .05,
  // Un tunnel ferme ne recoit ni soleil ni ciel : sans cette lueur propre, la
  // paroi est d'un noir absolu et on y vole a l'aveugle. La valeur est basse
  // — il s'agit de deviner la roche, pas de l'illuminer.
  emissive: 0x18242e
};

/** Espacement des bandeaux lumineux, en unites monde. */
const LIGHT_SPACING = 90;
const LIGHT_WIDTH = 6;

/**
 * Bandeaux lumineux repartis le long de la paroi.
 *
 * Ils ne servent pas qu'a voir : une paroi lisse ne donne aucune sensation de
 * vitesse, faute de repere qui defile. Ce sont eux qui font le tunnel.
 *
 * Rendus en materiau basique — ils s'eclairent eux-memes et n'ajoutent aucune
 * lampe a la scene, donc aucune recompilation de shader ni cout par pixel.
 */
function buildLights(curve, profile, radius, color) {
  const section = profile.build();
  const sides = section.length;
  const length = curve.getLength();
  const count = Math.max(2, Math.floor(length / LIGHT_SPACING));
  const positions = [];
  const indices = [];
  const point = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  // Legerement en retrait de la paroi, sinon le bandeau et la roche se
  // disputent le meme plan et scintillent a distance.
  const inset = radius * .985;

  for (let ring = 0; ring < count; ring++) {
    const t = (ring + .5) / count;
    const half = LIGHT_WIDTH / (2 * length);
    const base = positions.length / 3;
    for (const offset of [-half, half]) {
      const at = THREE.MathUtils.clamp(t + offset, 0, 1);
      curve.getPointAt(at, point);
      frameAt(curve, at, right, up, tangent);
      for (let j = 0; j < sides; j++) {
        const [px, py] = section[j];
        positions.push(
          point.x + (right.x * px + up.x * py) * inset,
          point.y + (right.y * px + up.y * py) * inset,
          point.z + (right.z * px + up.z * py) * inset
        );
      }
    }
    for (let j = 0; j < sides; j++) {
      const next = (j + 1) % sides;
      const a = base + j, b = base + next;
      const c = base + sides + next, d = base + sides + j;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'tunnel-lights';
  return mesh;
}

/**
 * Construit un tunnel complet.
 *
 * @param {object} spec  `{ points, radius, profile, wall, name, material }`
 *   `points` : au moins deux triplets `[x, y, z]`.
 *   `radius` : rayon nominal du vide, en unites monde.
 *   `wall`   : epaisseur de la paroi solide. Une paroi trop fine se traverse
 *              a grande vitesse — le pilote saute d'un cote a l'autre entre
 *              deux images sans jamais avoir ete teste dedans.
 * @returns `{ mesh, curve, registerCollision, dispose, spec }`
 */
export function createTunnel(spec = {}) {
  const points = Array.isArray(spec.points) ? spec.points : [];
  if (points.length < 2) throw new Error('Un tunnel demande au moins deux points de controle.');

  const radius = spec.radius > 0 ? spec.radius : 40;
  const wall = spec.wall > 0 ? spec.wall : Math.max(8, radius * .3);
  const profile = getProfile(spec.profile);
  const curve = tunnelCurve(points);
  const segments = segmentCount(curve);

  const geometry = buildShell(curve, profile, radius, segments);
  const material = spec.material || new THREE.MeshStandardMaterial({
    ...DEFAULT_MATERIAL,
    side: THREE.DoubleSide
  });
  const shell = new THREE.Mesh(geometry, material);
  shell.name = 'tunnel-shell';
  // La paroi est un volume ferme parcouru de l'interieur : les ombres portees
  // n'y apportent rien de lisible et coutent une passe de rendu par lampe.
  shell.castShadow = false;
  shell.receiveShadow = true;

  // Le nom du groupe sert d'identite dans le patch de carte : il doit rester
  // stable d'une reconstruction a l'autre.
  const mesh = new THREE.Group();
  mesh.name = spec.name || 'tunnel';
  mesh.add(shell);

  const lights = spec.lights === false
    ? null
    : buildLights(curve, profile, radius, spec.lightColor ?? 0x54f6ff);
  if (lights) mesh.add(lights);

  mesh.userData.tunnel = { ...spec, radius, wall, profile: spec.profile || 'round' };

  return {
    mesh,
    shell,
    curve,
    spec: mesh.userData.tunnel,

    /**
     * Inscrit la paroi dans le champ de collision.
     * Les troncons suivent exactement la courbe qui a servi au maillage.
     */
    registerCollision(field) {
      if (!field) return 0;
      const flat = new Float32Array((segments + 1) * 3);
      const point = new THREE.Vector3();
      for (let i = 0; i <= segments; i++) {
        curve.getPointAt(i / segments, point);
        flat[i * 3] = point.x;
        flat[i * 3 + 1] = point.y;
        flat[i * 3 + 2] = point.z;
      }
      return addTubePath(field, flat, radius * profile.inscribed, wall);
    },

    dispose() {
      geometry.dispose();
      if (!spec.material) material.dispose();
      if (lights) { lights.geometry.dispose(); lights.material.dispose(); }
    }
  };
}
