import * as THREE from 'three';

// ==========================================================================
//  BIBLIOTHEQUE D'OBJETS PLACABLES  -  editeur de cartes
// --------------------------------------------------------------------------
//  Chaque entree sait fabriquer un objet 3D autonome, deplacable, orientable
//  et supprimable. Les materiaux sont partages par famille : poser cent
//  rochers ne cree pas cent materiaux.
//
//  La roche blanche du Circuit Stellaire est ici decoupee en pieces
//  independantes — eclats, blocs, dalles, aiguilles, arches, amas — pour
//  qu'on puisse composer un massif a la main au lieu de subir un tirage
//  aleatoire.
//
//  Chaque objet porte dans `userData` :
//    libraryKey   identifiant de la piece, seul champ necessaire pour la
//                 reconstruire depuis une carte enregistree
//    collisionBox demi-dimensions a inscrire dans le champ de collision
// ==========================================================================

const materials = {};
function sharedMaterial(name, factory) {
  if (!materials[name]) materials[name] = factory();
  return materials[name];
}

const paleRock = () => sharedMaterial('paleRock', () => new THREE.MeshStandardMaterial({
  color: 0xc4bcab, roughness: .88, metalness: .06, emissive: 0x33302a, emissiveIntensity: .35
}));
const darkRock = () => sharedMaterial('darkRock', () => new THREE.MeshStandardMaterial({
  color: 0x6f6a63, roughness: .94, metalness: .04
}));
const metal = () => sharedMaterial('metal', () => new THREE.MeshStandardMaterial({
  color: 0x8c96a3, roughness: .42, metalness: .68
}));
const concrete = () => sharedMaterial('concrete', () => new THREE.MeshStandardMaterial({
  color: 0x8d8b86, roughness: .82, metalness: .05
}));
const glassPanel = () => sharedMaterial('glassPanel', () => new THREE.MeshStandardMaterial({
  color: 0x2b4d63, roughness: .22, metalness: .5, emissive: 0x0d3550, emissiveIntensity: .7
}));

/** Applique une taille aleatoire mais bornee, pour eviter les clones parfaits. */
function jitterScale(object, minimum, maximum) {
  const scale = minimum + Math.random() * (maximum - minimum);
  object.scale.setScalar(scale);
  return scale;
}

/**
 * Renseigne la boite de collision a partir de l'emprise reelle de l'objet.
 * Mesuree une fois a la creation : l'editeur la met ensuite a l'echelle.
 */
function measureCollision(object) {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return object;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  object.userData.collisionBox = {
    halfWidth: size.x * .5, halfHeight: size.y * .5, halfDepth: size.z * .5,
    offsetX: center.x - object.position.x,
    offsetY: center.y - object.position.y,
    offsetZ: center.z - object.position.z
  };
  return object;
}

// ── PIECES DE ROCHE ─────────────────────────────────────────────────────────
// La roche du massif etait un tirage de dodecaedres. Les memes formes sont
// reprises ici, mais nommees et dimensionnees pour etre composees a la main.

function rockChunk(size, irregular = true) {
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(size, 0), paleRock());
  if (irregular) {
    mesh.scale.set(1, .65 + Math.random() * .7, .7 + Math.random() * .6);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function rockSpire() {
  const group = new THREE.Group();
  // Trois troncons empiles et decales : une aiguille droite fait artificiel.
  let height = 0;
  for (let i = 0; i < 3; i++) {
    const radius = 34 - i * 9;
    const segment = new THREE.Mesh(new THREE.ConeGeometry(radius, 90, 7, 1), paleRock());
    segment.position.set((Math.random() - .5) * 12, height + 45, (Math.random() - .5) * 12);
    segment.rotation.y = Math.random() * Math.PI;
    segment.castShadow = true;
    group.add(segment);
    height += 74;
  }
  return group;
}

function rockArch() {
  const group = new THREE.Group();
  const legHeight = 150;
  [-1, 1].forEach(side => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(30, 44, legHeight, 7), paleRock());
    leg.position.set(side * 95, legHeight * .5, 0);
    leg.rotation.z = side * -.09;
    leg.castShadow = true;
    group.add(leg);
  });
  const span = new THREE.Mesh(new THREE.BoxGeometry(250, 46, 62), paleRock());
  span.position.y = legHeight + 16;
  span.castShadow = true;
  group.add(span);
  return group;
}

function rockCluster() {
  const group = new THREE.Group();
  const count = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < count; i++) {
    const chunk = rockChunk(22 + Math.random() * 46);
    const angle = (i / count) * Math.PI * 2 + Math.random();
    const spread = 30 + Math.random() * 60;
    chunk.position.set(Math.cos(angle) * spread, Math.random() * 26, Math.sin(angle) * spread);
    group.add(chunk);
  }
  return group;
}

function rockSlab() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(220, 26, 160), paleRock());
  mesh.rotation.set((Math.random() - .5) * .3, Math.random() * Math.PI, (Math.random() - .5) * .3);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function rockWall() {
  const group = new THREE.Group();
  // Paroi composee : c'est la brique de base pour tracer un couloir a la main.
  for (let i = 0; i < 5; i++) {
    const chunk = rockChunk(52 + Math.random() * 40);
    chunk.position.set((i - 2) * 76 + (Math.random() - .5) * 20, Math.random() * 40, (Math.random() - .5) * 40);
    group.add(chunk);
  }
  return group;
}

// ── STRUCTURES ──────────────────────────────────────────────────────────────

function buildingBlock(width, height, depth, lit) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), concrete());
  body.position.y = height * .5;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  if (lit) {
    // Bandes vitrees plutot que des fenetres unitaires : meme lecture, une
    // fraction du cout.
    for (let level = 1; level < Math.floor(height / 18); level++) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(width * 1.01, 3.4, depth * 1.01), glassPanel());
      band.position.y = level * 18;
      group.add(band);
    }
  }
  return group;
}

function energyRing(radius, color) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: .82,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * .06, 10, 44), material);
  group.add(ring);
  const light = new THREE.PointLight(color, 30, radius * 6, 2);
  group.add(light);
  return group;
}

function beaconLamp(color) {
  const group = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 26, 8), metal());
  post.position.y = 13;
  group.add(post);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(5, 12, 9),
    new THREE.MeshBasicMaterial({ color, toneMapped: false })
  );
  head.position.y = 28;
  group.add(head);
  // `Object3D.position` est defini non inscriptible : un Object.assign dessus
  // leve une TypeError en module strict. On passe donc par set().
  const light = new THREE.PointLight(color, 42, 220, 2);
  light.position.set(0, 28, 0);
  group.add(light);
  return group;
}

function pineTree() {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.4, 16, 6),
    sharedMaterial('bark', () => new THREE.MeshStandardMaterial({ color: 0x51341f, roughness: .95 })));
  trunk.position.y = 8;
  group.add(trunk);
  const foliage = new THREE.Mesh(new THREE.ConeGeometry(9, 26, 8),
    sharedMaterial('foliage', () => new THREE.MeshStandardMaterial({ color: 0x2f6b37, roughness: .9 })));
  foliage.position.y = 26;
  foliage.castShadow = true;
  group.add(foliage);
  return group;
}

// ── CATALOGUE ───────────────────────────────────────────────────────────────

export const OBJECT_LIBRARY = {
  'rock-shard': { label: 'Éclat de roche', family: 'Roche', create: () => rockChunk(16 + Math.random() * 12) },
  'rock-block': { label: 'Bloc de roche', family: 'Roche', create: () => rockChunk(44 + Math.random() * 24) },
  'rock-boulder': { label: 'Gros rocher', family: 'Roche', create: () => rockChunk(96 + Math.random() * 60) },
  'rock-slab': { label: 'Dalle', family: 'Roche', create: rockSlab },
  'rock-spire': { label: 'Aiguille', family: 'Roche', create: rockSpire },
  'rock-arch': { label: 'Arche', family: 'Roche', create: rockArch },
  'rock-cluster': { label: 'Amas', family: 'Roche', create: rockCluster },
  'rock-wall': { label: 'Paroi', family: 'Roche', create: rockWall },
  'rock-dark': { label: 'Roche sombre', family: 'Roche', create: () => {
    const mesh = rockChunk(60 + Math.random() * 40);
    mesh.material = darkRock();
    return mesh;
  } },

  'building-small': { label: 'Petit immeuble', family: 'Ville', create: () => buildingBlock(22, 34, 20, true) },
  'building-tall': { label: 'Tour', family: 'Ville', create: () => buildingBlock(26, 120, 26, true) },
  'building-wide': { label: 'Hangar', family: 'Ville', create: () => buildingBlock(70, 26, 48, false) },
  'tower-mast': { label: 'Pylône', family: 'Ville', create: () => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 6, 66, 8), metal());
    mesh.position.y = 33;
    mesh.castShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  } },

  'ring-cyan': { label: 'Anneau cyan', family: 'Course', create: () => energyRing(78, 0x54f6ff) },
  'ring-violet': { label: 'Anneau violet', family: 'Course', create: () => energyRing(78, 0xb46cff) },
  'ring-small': { label: 'Petit anneau', family: 'Course', create: () => energyRing(34, 0xffc928) },
  'lamp-warm': { label: 'Feu orange', family: 'Course', create: () => beaconLamp(0xffb552) },
  'lamp-cold': { label: 'Feu cyan', family: 'Course', create: () => beaconLamp(0x7bf3ff) },

  'tree-pine': { label: 'Sapin', family: 'Nature', create: pineTree },
  'crystal': { label: 'Cristal', family: 'Nature', create: () => {
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(14, 0),
      sharedMaterial('crystal', () => new THREE.MeshStandardMaterial({
        color: 0x57d9ff, emissive: 0x57d9ff, emissiveIntensity: 1.15, roughness: .2, metalness: .25
      })));
    mesh.scale.set(.55, 1.8, .55);
    mesh.position.y = 20;
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  } }
};

/** Familles presentes, dans l'ordre d'affichage de la palette. */
export const OBJECT_FAMILIES = ['Roche', 'Ville', 'Course', 'Nature'];

/**
 * Fabrique une piece de la bibliotheque.
 * @returns {THREE.Object3D|null} null si la cle est inconnue.
 */
export function createLibraryObject(key) {
  const entry = OBJECT_LIBRARY[key];
  if (!entry) {
    console.warn('[bibliotheque] piece inconnue', key);
    return null;
  }
  const object = entry.create();
  object.name = `library-${key}`;
  object.userData.libraryKey = key;
  object.userData.editable = true;
  return measureCollision(object);
}

/** Liste des cles d'une famille, pour construire la palette. */
export function libraryKeysByFamily(family) {
  return Object.keys(OBJECT_LIBRARY).filter(key => OBJECT_LIBRARY[key].family === family);
}
