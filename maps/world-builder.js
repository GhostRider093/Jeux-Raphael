import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { OBJLoader } from '../libs/loaders/OBJLoader.js';
import { STLLoader } from '../libs/loaders/STLLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { ASSET_LIBRARY } from './world-catalog.js?v=public-map-paths-20260722';
import { createCollisionField, addBox3, addBoxFromCenter, addHeightfield } from './world-collision.js?v=sans-halo-20260730';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const portalObjLoader = new OBJLoader();
const portalTextureLoader = new THREE.TextureLoader();
const stlLoader = new STLLoader();
const assetCache = new Map();
const novaBuildingCache = new Map();
const NOVA_BUILDING_SCALE = 2.4;
// Rayon de la sphere de collision du pilote, cale sur l'envergure du chasseur.
const PILOT_COLLISION_RADIUS = 7;
// Garde-fous de l'enregistrement des collisions sur les modeles composites.
const COLLISION_MESH_LIMIT = 240;    // plafond par objet, protege les gros GLB
const COLLISION_MIN_HEIGHT = 6;      // en dessous, l'objet passe sous le chasseur
const COLLISION_COLUMN_SIZE = 14;    // finesse de la grille de colonnes, en unites

/**
 * Enregistre un objet compose de primitives, maillage par maillage.
 *
 * Exact et bon marche pour les groupes construits ici (murs, tours, blocs) ou
 * chaque maillage est deja une boite.
 */
function registerMeshColliders(collision, object) {
  if (!collision) return;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let registered = 0;
  object.traverse(node => {
    if (!node.isMesh || registered >= COLLISION_MESH_LIMIT) return;
    box.setFromObject(node);
    if (box.isEmpty() || box.max.y - box.min.y < COLLISION_MIN_HEIGHT) return;
    addBox3(collision, box);
    registered++;
  });
}

/**
 * Enregistre un modele importe en le rasterisant en colonnes verticales.
 *
 * Indispensable pour les modeles de quartier : `chicago.stl` est un maillage
 * unique contenant une ville entiere, et le decouper par maillage ne donnerait
 * qu'une seule boite geante — un mur invisible de plusieurs centaines de
 * metres. En projetant les triangles sur une grille horizontale, chaque
 * colonne batie devient un obstacle et les rues restent traversables.
 */
function registerHeightfieldColliders(collision, object) {
  if (!collision) return 0;
  object.updateMatrixWorld(true);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();

  // La grille elle-meme vit dans world-collision.js : ici on ne fait que
  // livrer les triangles en coordonnees monde.
  return addHeightfield(collision, emit => {
    object.traverse(node => {
      if (!node.isMesh) return;
      const position = node.geometry?.attributes?.position;
      if (!position) return;
      const index = node.geometry.index;
      const count = index ? index.count : position.count;
      const matrix = node.matrixWorld;
      for (let i = 0; i + 2 < count; i += 3) {
        a.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
        b.fromBufferAttribute(position, index ? index.getX(i + 1) : i + 1).applyMatrix4(matrix);
        c.fromBufferAttribute(position, index ? index.getX(i + 2) : i + 2).applyMatrix4(matrix);
        emit(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    });
  }, { cellSize: COLLISION_COLUMN_SIZE, minHeight: COLLISION_MIN_HEIGHT });
}

const NOVA_BUILDINGS = [
  { id: 'building-a', url: './assets/nova-city/building-a.glb', height: 72, unique: true },
  { id: 'building-b', url: './assets/nova-city/building-b.glb', height: 82, unique: true },
  { id: 'building-3d-model-1', url: './assets/nova-city/building-3d-model-1.glb', height: 76, unique: true },
  { id: 'meshy-tower-a', url: './assets/nova-city/meshy-tower-a.glb', height: 108, unique: true },
  { id: 'meshy-tower-b', url: './assets/nova-city/meshy-tower-b.glb', height: 112, unique: true },
  { id: 'meshy-building-c', url: './assets/nova-city/meshy-building-c.glb', height: 48, weight: 4 },
  { id: 'chicago', url: './assets/nova-city/chicago.stl', height: 340, rotateX: -Math.PI / 2, weight: 2, stl: true },
  { id: 'medieval-gate', url: './assets/nova-city/medieval-gate.glb', height: 44, weight: 3 }
];

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function hash2(x, z, seed) {
  const value = Math.sin(x * 127.1 + z * 311.7 + seed * 0.013) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  const ab = THREE.MathUtils.lerp(a, b, fx);
  const cd = THREE.MathUtils.lerp(c, d, fx);
  return THREE.MathUtils.lerp(ab, cd, fz) * 2 - 1;
}

function fbm(x, z, seed) {
  let total = 0, amplitude = .55, frequency = 1, weight = 0;
  for (let octave = 0; octave < 5; octave++) {
    total += valueNoise(x * frequency, z * frequency, seed + octave * 31) * amplitude;
    weight += amplitude;
    frequency *= 2.03;
    amplitude *= .5;
  }
  return total / weight;
}

export function getWorldHeight(world, x, z) {
  const t = world.terrain;
  // L'espace n'a pas de sol. Un plancher unique et tres bas laisse toute la
  // hauteur du circuit libre, sans relief ni relevement des bords.
  if (t.kind === 'space') return t.base;
  if (t.kind === 'voxel') {
    const blockSize = t.blockSize || 20;
    x = Math.floor((x + world.size * .5) / blockSize) * blockSize + blockSize * .5 - world.size * .5;
    z = Math.floor((z + world.size * .5) / blockSize) * blockSize + blockSize * .5 - world.size * .5;
  }
  const scale = t.scale || .006;
  const n = fbm(x * scale, z * scale, world.seed);
  const n2 = fbm((x + 271) * scale * .55, (z - 193) * scale * .55, world.seed + 99);
  const radius = Math.hypot(x, z) / (world.size * .5);
  let shape = n;

  switch (t.kind) {
    case 'alpine':
      shape = Math.pow(Math.abs(n * .78 + n2 * .46), 1.55) * 1.55 - .18 + radius * .35;
      break;
    case 'canyon': {
      const channels = Math.abs(Math.sin(x * .0065 + n2 * 1.8) + Math.sin(z * .0048 - n * 1.4)) * .5;
      shape = Math.pow(channels, 1.8) + Math.abs(n) * .35 - .42;
      break;
    }
    case 'archipelago': {
      const islands = Math.sin(x * .012) * Math.cos(z * .011) + n * .9;
      shape = Math.max(-.55, islands * .7 - .08 - radius * .22);
      break;
    }
    case 'volcanic': {
      const ring = Math.exp(-Math.pow((radius - .35) * 5.2, 2));
      const crater = Math.exp(-radius * radius * 38);
      shape = n * .25 + ring * 1.15 - crater * .7 - .18;
      break;
    }
    case 'basin':
      shape = n * .55 + Math.pow(radius, 1.7) * .75 - .35;
      break;
    case 'coast':
      shape = n * .65 + x / world.size * .9 - .12;
      break;
    case 'desert':
      shape = Math.sin(x * .018 + n2) * .35 + Math.sin(z * .013 - n) * .28 + n * .25;
      break;
    case 'arctic':
      shape = Math.round((n * .72 + n2 * .28) * 5) / 5;
      break;
    case 'sky': {
      const islands = Math.max(-.55, Math.sin(x * .014) * Math.sin(z * .012) + n * .85 - .12);
      shape = Math.pow(Math.max(0, islands), 1.45) - .28;
      break;
    }
    case 'marsh':
      shape = Math.round((n * .72 + n2 * .28) * 7) / 7 - .08;
      break;
    case 'moon': {
      const craters = -Math.max(0, .25 - Math.abs(Math.sin(x * .017) * Math.cos(z * .019))) * 1.2;
      shape = n * .55 + craters + .16;
      break;
    }
    case 'valley':
      shape = Math.abs(x / (world.size * .5)) * .85 + n * .38 - .22;
      break;
    case 'plateau':
      shape = Math.tanh((n * .72 + n2 * .25) * 2.4) * .58 + .18;
      break;
    case 'forest':
      shape = n * .65 + n2 * .2 - .04;
      break;
    case 'ruins':
      shape = n * .55 + n2 * .18;
      break;
    case 'voxel': {
      shape = n * .72 + n2 * .24 + Math.max(0, n * .38) * .45;
      const riverCenter = 170 + Math.sin(z * .007) * 82;
      if (Math.abs(x - riverCenter) < 42) {
        const riverShape = ((world.waterLevel ?? 4) - t.base - 5) / t.amplitude;
        shape = Math.min(shape, riverShape);
      }
      break;
    }
    case 'race-canyon': {
      const raceRadius = t.raceRadius || 350;
      const corridorDistance = Math.abs(Math.hypot(x, z) - raceRadius);
      const wall = smooth(THREE.MathUtils.clamp((corridorDistance - 48) / 105, 0, 1));
      const cliffDetail = Math.abs(n) * .22 + Math.max(0, n2) * .12;
      shape = -.16 + wall * 1.28 + cliffDetail;
      break;
    }
    default:
      shape = n * .55 + n2 * .18;
  }

  const edgeRise = Math.max(0, radius - .82) ** 2 * (t.kind === 'archipelago' ? -35 : 150);
  const height = t.base + shape * t.amplitude + edgeRise;
  return t.kind === 'voxel' ? Math.floor(height / (t.step || 6)) * (t.step || 6) : height;
}

function terrainColor(world, height) {
  const t = world.terrain;
  const low = new THREE.Color(t.low);
  const mid = new THREE.Color(t.mid);
  const high = new THREE.Color(t.high);
  const range = Math.max(30, t.amplitude * 1.15);
  const normalized = THREE.MathUtils.clamp((height - t.base + range * .32) / range, 0, 1);
  if (t.snowLine && height > t.snowLine) return high;
  return normalized < .52 ? low.lerp(mid, normalized / .52) : mid.lerp(high, (normalized - .52) / .48);
}

function buildTerrain(world, root) {
  if (world.terrain.kind === 'voxel') {
    const cells = Math.round(world.size / (world.terrain.blockSize || 20));
    const cellSize = world.size / cells;
    const bottom = -38;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: .94, metalness: 0,
      emissive: 0x23451d, emissiveIntensity: .72
    });
    const terrain = new THREE.InstancedMesh(geometry, material, cells * cells);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let instance = 0;
    for (let ix = 0; ix < cells; ix++) {
      for (let iz = 0; iz < cells; iz++) {
        const x = -world.size * .5 + (ix + .5) * cellSize;
        const z = -world.size * .5 + (iz + .5) * cellSize;
        const top = getWorldHeight(world, x, z);
        const height = Math.max(2, top - bottom);
        dummy.position.set(x, bottom + height * .5, z);
        dummy.scale.set(cellSize + .12, height, cellSize + .12);
        dummy.updateMatrix();
        terrain.setMatrixAt(instance, dummy.matrix);
        color.copy(terrainColor(world, top));
        if (top <= (world.waterLevel ?? -999) + 1) color.set(0x9b7446);
        terrain.setColorAt(instance, color);
        instance++;
      }
    }
    terrain.instanceMatrix.needsUpdate = true;
    terrain.instanceColor.needsUpdate = true;
    terrain.receiveShadow = true;
    root.add(terrain);
  } else {
    const segments = innerWidth < 700 ? 72 : 104;
    const geometry = new THREE.PlaneGeometry(world.size, world.size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      const y = getWorldHeight(world, x, z);
      position.setY(i, y);
      const color = terrainColor(world, y);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: .02 });
    const terrain = new THREE.Mesh(geometry, material);
    terrain.receiveShadow = true;
    root.add(terrain);
  }

  if (Number.isFinite(world.waterLevel)) {
    const waterColor = world.terrain.kind === 'volcanic' ? 0xff3d0b : world.terrain.kind === 'marsh' ? 0x183f45 : 0x2388b8;
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: waterColor,
      transparent: true,
      opacity: world.terrain.kind === 'volcanic' ? .9 : .68,
      roughness: world.terrain.kind === 'volcanic' ? .58 : .12,
      metalness: .08,
      emissive: world.terrain.kind === 'volcanic' ? 0x7d1200 : 0x001d28,
      emissiveIntensity: world.terrain.kind === 'volcanic' ? 1.2 : .18
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(world.size * 1.08, world.size * 1.08), waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.y = world.terrain.lavaLevel ?? world.waterLevel;
    water.userData.animatedWater = true;
    root.add(water);
  }
}

function roadMaterial(world) {
  const night = world.id === 'neon-vegas' || world.id === 'lunar-outpost';
  return new THREE.MeshStandardMaterial({
    color: night ? 0x161925 : 0x34393d,
    roughness: .76,
    emissive: night ? 0x071f35 : 0x000000,
    emissiveIntensity: night ? .75 : 0
  });
}

function addRoadSegment(root, world, a, b, width = 18, material = roadMaterial(world)) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const x = (a[0] + b[0]) * .5, z = (a[1] + b[1]) * .5;
  const y = Math.max(getWorldHeight(world, x, z), (world.waterLevel ?? -999) + .5) + .38;
  const road = new THREE.Mesh(new THREE.BoxGeometry(width, .5, length), material);
  road.position.set(x, y, z);
  road.rotation.y = Math.atan2(dx, dz);
  road.receiveShadow = true;
  root.add(road);
  return road;
}

function addPolyline(root, world, points, width = 16) {
  const material = roadMaterial(world);
  for (let i = 0; i < points.length - 1; i++) addRoadSegment(root, world, points[i], points[i + 1], width, material);
}

function addVoxelTrail(root, world, points, width = 15) {
  const material = new THREE.MeshStandardMaterial({ color: 0x9a7047, roughness: 1 });
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(length / 16));
    for (let step = 0; step < steps; step++) {
      const t0 = step / steps, t1 = (step + 1) / steps;
      addRoadSegment(root, world,
        [THREE.MathUtils.lerp(a[0], b[0], t0), THREE.MathUtils.lerp(a[1], b[1], t0)],
        [THREE.MathUtils.lerp(a[0], b[0], t1), THREE.MathUtils.lerp(a[1], b[1], t1)], width, material);
    }
  }
}

function buildRoads(world, root) {
  const half = world.size * .39;
  if (world.layout === 'voxel-village') {
    addVoxelTrail(root, world, [[0, half], [-80, 300], [-220, 170], [-250, 70], [-180, -40], [-290, -280]], 15);
    addVoxelTrail(root, world, [[-250, 70], [-80, 40], [80, 90], [170, 140], [330, 220]], 13);
    addVoxelTrail(root, world, [[-180, -40], [10, -120], [190, -210], [340, -330]], 12);
  } else if (world.layout === 'race-circuit') {
    const points = (world.raceCourse || []).map(point => [point.x, point.z]);
    if (points.length) {
      points.push(points[0]);
      addPolyline(root, world, points, 20);
      addRoadSegment(root, world, points[0], [0, half], 24);
    }
  } else if (world.layout === 'grid' || world.layout === 'boulevards' || world.layout === 'strip') {
    const offsets = world.layout === 'strip' ? [-110, 0, 110] : [-240, -120, 0, 120, 240];
    offsets.forEach(offset => {
      addRoadSegment(root, world, [-half, offset], [half, offset], world.layout === 'strip' ? 26 : 17);
      if (world.layout !== 'strip') addRoadSegment(root, world, [offset, -half], [offset, half], 17);
    });
  } else if (world.layout === 'airbase') {
    addRoadSegment(root, world, [0, -half], [0, half], 58);
    addRoadSegment(root, world, [-half * .8, -half * .35], [half * .8, half * .45], 44);
    addRoadSegment(root, world, [-half * .75, half * .45], [half * .78, -half * .25], 34);
    const markMaterial = new THREE.MeshBasicMaterial({ color: 0xf7f1c8 });
    for (let z = -half + 30; z < half; z += 46) addRoadSegment(root, world, [-1, z - 9], [1, z + 9], 3, markMaterial);
  } else if (world.layout === 'ring') {
    const points = [];
    for (let i = 0; i <= 40; i++) {
      const angle = i / 40 * Math.PI * 2;
      points.push([Math.sin(angle) * 330, Math.cos(angle) * 330]);
    }
    addPolyline(root, world, points, 18);
    addRoadSegment(root, world, [0, 330], [0, half], 18);
  } else if (world.layout === 'islands' || world.layout === 'flooded' || world.layout === 'sky' || world.layout === 'marsh') {
    addPolyline(root, world, [[-half, 260], [-260, 160], [-80, 60], [110, 150], [300, 40], [half, -180]], 14);
    addPolyline(root, world, [[-300, -half], [-190, -230], [0, -80], [180, -210], [330, -half]], 13);
  } else if (world.layout === 'kingdom' || world.layout === 'capital') {
    addRoadSegment(root, world, [0, -half], [0, half], 20);
    addRoadSegment(root, world, [-half, 0], [half, 0], 18);
    const ring = [];
    for (let i = 0; i <= 24; i++) {
      const angle = i / 24 * Math.PI * 2;
      ring.push([Math.sin(angle) * 220, Math.cos(angle) * 220]);
    }
    addPolyline(root, world, ring, 14);
  } else {
    addPolyline(root, world, [[-half, 310], [-280, 180], [-120, 240], [30, 80], [220, 170], [half, -40]], 16);
    addPolyline(root, world, [[-300, -half], [-210, -250], [-40, -100], [140, -190], [310, -half]], 14);
  }
}

function randomGroundPoint(world, random, margin = 80) {
  const half = world.size * .46;
  for (let attempt = 0; attempt < 60; attempt++) {
    const x = (random() * 2 - 1) * half;
    const z = (random() * 2 - 1) * half;
    const y = getWorldHeight(world, x, z);
    if (Math.hypot(x, z - (world.spawn.ground?.[2] || 0)) < margin) continue;
    if (Number.isFinite(world.waterLevel) && y <= world.waterLevel + 1.4) continue;
    return { x, y, z };
  }
  return { x: 0, y: getWorldHeight(world, 0, 0), z: 0 };
}

function buildTrees(world, root, random) {
  const count = world.population.trees || 0;
  if (!count) return;
  const voxel = world.terrain.kind === 'voxel';
  const trunkGeometry = voxel ? new THREE.BoxGeometry(2.8, 10, 2.8) : new THREE.CylinderGeometry(.28, .45, 3.2, 6);
  const foliageGeometry = voxel ? new THREE.BoxGeometry(10, 8, 10) : world.terrain.kind === 'forest' || world.terrain.kind === 'alpine'
    ? new THREE.ConeGeometry(2.3, 7.5, 7)
    : new THREE.IcosahedronGeometry(2.6, 1);
  const trunk = new THREE.InstancedMesh(trunkGeometry, new THREE.MeshStandardMaterial({ color: 0x51341f, roughness: .95 }), count);
  const foliageColor = world.terrain.kind === 'marsh' ? 0x244f46 : world.terrain.kind === 'arctic' ? 0xcce4df : 0x285c2b;
  const foliage = new THREE.InstancedMesh(foliageGeometry, new THREE.MeshStandardMaterial({ color: foliageColor, roughness: .9 }), count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const point = randomGroundPoint(world, random, 95);
    const scale = .65 + random() * 1.45;
    dummy.position.set(point.x, point.y + (voxel ? 5 : 1.6) * scale, point.z);
    dummy.scale.set(scale, scale, scale);
    dummy.rotation.y = random() * Math.PI * 2;
    dummy.updateMatrix(); trunk.setMatrixAt(i, dummy.matrix);
    dummy.position.y = point.y + (voxel ? 12 : world.terrain.kind === 'forest' || world.terrain.kind === 'alpine' ? 6.2 : 4.8) * scale;
    dummy.updateMatrix(); foliage.setMatrixAt(i, dummy.matrix);
  }
  trunk.castShadow = foliage.castShadow = true;
  root.add(trunk, foliage);
}

function buildRocks(world, root, random) {
  const count = world.population.rocks || 0;
  if (!count) return;
  const color = world.terrain.kind === 'canyon' ? 0x8e4930 : world.terrain.kind === 'arctic' ? 0xb8d2d8 : 0x5e625c;
  const voxel = world.terrain.kind === 'voxel';
  const mesh = new THREE.InstancedMesh(voxel ? new THREE.BoxGeometry(3.4, 3.4, 3.4) : new THREE.DodecahedronGeometry(2.4, 0), new THREE.MeshStandardMaterial({ color, roughness: .96 }), count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const point = randomGroundPoint(world, random, 70);
    const sx = .5 + random() * 2.4, sy = .45 + random() * 2.0, sz = .5 + random() * 2.2;
    dummy.position.set(point.x, point.y + sy, point.z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(voxel ? 0 : random() * .4, voxel ? Math.round(random() * 3) * Math.PI * .5 : random() * Math.PI * 2, voxel ? 0 : random() * .3);
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.name = 'field-rocks';
  mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
}

function normalizeNovaBuilding(model, spec) {
  model.rotation.x = spec.rotateX || 0;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.setScalar(spec.height / Math.max(size.y, .001));
  model.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= fitted.min.y;
  model.position.z -= center.z;
  model.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = false;
    node.receiveShadow = true;
    node.frustumCulled = true;
  });
  model.userData.novaBuildingId = spec.id;
  return model;
}

function makeChicagoCityMaterial(geometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const minimum = bounds.min.clone();
  const extent = bounds.getSize(new THREE.Vector3()).max(new THREE.Vector3(.001, .001, .001));
  const material = new THREE.MeshStandardMaterial({
    color: 0xb8c1c7,
    roughness: .62,
    metalness: .12
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.chicagoMin = { value: minimum };
    shader.uniforms.chicagoExtent = { value: extent };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vChicagoLocalPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvChicagoLocalPosition = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vChicagoLocalPosition;\nuniform vec3 chicagoMin;\nuniform vec3 chicagoExtent;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 cityUv = clamp((vChicagoLocalPosition - chicagoMin) / chicagoExtent, 0.0, 1.0);
        vec3 cityNormal = normalize(vNormal);
        float roofMask = smoothstep(0.62, 0.88, cityNormal.y);
        float facadeMask = 1.0 - roofMask;
        float facadeCoord = abs(cityNormal.x) > abs(cityNormal.z) ? cityUv.z : cityUv.x;
        float blockNoise = fract(sin(dot(floor(cityUv.xz * 34.0), vec2(12.9898, 78.233))) * 43758.5453);
        vec3 stone = mix(vec3(0.31, 0.34, 0.36), vec3(0.68, 0.64, 0.57), blockNoise);
        vec3 glass = mix(vec3(0.035, 0.09, 0.13), vec3(0.12, 0.24, 0.31), blockNoise);
        float column = step(0.20, fract(facadeCoord * 118.0)) * step(fract(facadeCoord * 118.0), 0.82);
        float floorBand = step(0.24, fract(cityUv.y * 92.0)) * step(fract(cityUv.y * 92.0), 0.76);
        float upperFloors = smoothstep(0.025, 0.08, cityUv.y);
        float windowMask = facadeMask * column * floorBand * upperFloors;
        float litNoise = fract(sin(dot(floor(vec2(facadeCoord * 118.0, cityUv.y * 92.0)), vec2(91.7, 43.3))) * 15731.743);
        vec3 windowColor = mix(glass, vec3(0.88, 0.66, 0.31), step(0.88, litNoise));
        vec3 roofColor = mix(vec3(0.10, 0.12, 0.13), vec3(0.24, 0.27, 0.28), blockNoise);
        vec3 urbanColor = mix(stone, windowColor, windowMask * 0.92);
        urbanColor = mix(urbanColor, roofColor, roofMask);
        diffuseColor.rgb *= urbanColor * 1.55;
      `);
  };
  material.customProgramCacheKey = () => 'nova-chicago-city-v1';
  material.userData.proceduralCityTexture = true;
  return material;
}

function loadNovaBuilding(spec) {
  if (novaBuildingCache.has(spec.id)) return novaBuildingCache.get(spec.id);
  const promise = (spec.stl
    ? stlLoader.loadAsync(spec.url).then(geometry => {
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, spec.id === 'chicago'
          ? makeChicagoCityMaterial(geometry)
          : new THREE.MeshStandardMaterial({ color: 0xaeb8bf, roughness: .72, metalness: .16 }));
        return new THREE.Group().add(mesh);
      })
    : loader.loadAsync(spec.url).then(gltf => gltf.scene)
  ).then(model => normalizeNovaBuilding(model, spec));
  novaBuildingCache.set(spec.id, promise);
  return promise;
}

async function buildNovaCityBuildings(world, root, random, onProgress, collision) {
  if (world.id !== 'nova-city') return [];
  onProgress?.(`Nova City : chargement de ${NOVA_BUILDINGS.length} modèles d'immeubles…`);
  const loaded = await Promise.allSettled(NOVA_BUILDINGS.map(async spec => ({ spec, model: await loadNovaBuilding(spec) })));
  const available = loaded.filter(result => result.status === 'fulfilled').map(result => result.value);
  const failed = loaded.filter(result => result.status === 'rejected');
  if (!available.length) throw new Error('Aucun immeuble 3D Nova City disponible');
  if (failed.length) console.warn('[nova-city] immeubles indisponibles', failed.map(result => result.reason));

  const reusable = available.filter(item => !item.spec.unique);
  const weighted = reusable.flatMap(item => Array.from({ length: item.spec.weight || 1 }, () => item));
  const placements = [...available];
  const targetCount = 32;
  while (placements.length < targetCount && weighted.length) placements.push(weighted[Math.floor(random() * weighted.length)]);
  for (let index = placements.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [placements[index], placements[swap]] = [placements[swap], placements[index]];
  }

  const occupied = [];
  const minimumSpacing = 340;
  const findSpacedPoint = () => {
    let best = null;
    let bestDistance = -Infinity;
    for (let attempt = 0; attempt < 180; attempt++) {
      const point = randomGroundPoint(world, random, 180);
      const nearest = occupied.length
        ? Math.min(...occupied.map(other => Math.hypot(point.x - other.x, point.z - other.z)))
        : Infinity;
      if (nearest >= minimumSpacing) return point;
      if (nearest > bestDistance) { best = point; bestDistance = nearest; }
    }
    return best || randomGroundPoint(world, random, 180);
  };

  placements.forEach((item, index) => {
    const point = findSpacedPoint();
    occupied.push(point);
    const wrapper = new THREE.Group();
    wrapper.name = `nova-building-${index + 1}-${item.spec.id}`;
    wrapper.add(item.model.clone(true));
    wrapper.position.set(point.x, point.y, point.z);
    wrapper.rotation.y = Math.floor(random() * 4) * Math.PI * .5;
    const scale = item.spec.unique ? .88 + random() * .2 : .72 + random() * .48;
    wrapper.scale.setScalar(scale * NOVA_BUILDING_SCALE);
    wrapper.userData.novaBuilding = true;
    wrapper.userData.sourceModel = item.spec.id;
    root.add(wrapper);
    // Rasterisation en colonnes : `chicago.stl` est une ville entiere dans un
    // maillage unique, une boite globale en ferait un bloc plein.
    registerHeightfieldColliders(collision, wrapper);
  });
  root.userData.novaBuildings = placements.reduce((summary, item) => {
    summary[item.spec.id] = (summary[item.spec.id] || 0) + 1;
    return summary;
  }, {});
  root.userData.novaBuildingMinimumSpacing = minimumSpacing;
  onProgress?.(`Nova City : ${placements.length} immeubles 3D prêts`);
  return placements;
}

function buildBuildings(world, root, random, collision) {
  const count = world.population.buildings || 0;
  if (!count) return;
  const night = world.id === 'neon-vegas' || world.id === 'nova-city';
  const voxel = world.terrain.kind === 'voxel';
  const material = new THREE.MeshStandardMaterial({
    color: voxel ? 0xb47b48 : night ? 0x29455f : 0x716d67,
    roughness: .72,
    metalness: night ? .28 : .06,
    emissive: night ? 0x083a65 : 0x000000,
    emissiveIntensity: night ? .8 : 0
  });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const point = randomGroundPoint(world, random, 115);
    const width = voxel ? 10 + Math.floor(random() * 3) * 5 : 7 + random() * 19;
    const depth = voxel ? 10 + Math.floor(random() * 3) * 5 : 7 + random() * 18;
    const height = voxel ? 8 + Math.floor(random() * 4) * 5 : world.layout === 'grid' || world.layout === 'strip' ? 16 + random() * 85 : 6 + random() * 22;
    const quarterTurns = Math.round(random() * 3);
    dummy.position.set(point.x, point.y + height * .5, point.z);
    dummy.scale.set(width, height, depth);
    dummy.rotation.y = quarterTurns * Math.PI * .5;
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    // Les rotations sont des multiples de 90 degres : un quart de tour impair
    // echange simplement largeur et profondeur, la boite reste donc exacte.
    const swapped = quarterTurns % 2 === 1;
    addBoxFromCenter(
      collision, point.x, point.y + height * .5, point.z,
      (swapped ? depth : width) * .5, height * .5, (swapped ? width : depth) * .5
    );
  }
  mesh.name = 'field-buildings';
  mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
}

function buildTowers(world, root, random, collision) {
  const count = world.population.towers || 0;
  if (!count) return;
  const material = new THREE.MeshStandardMaterial({ color: 0x65717a, roughness: .45, metalness: .45, emissive: world.id === 'neon-vegas' ? 0x321080 : 0x000000, emissiveIntensity: .8 });
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(.65, 1.7, 1, 8), material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const point = randomGroundPoint(world, random, 100);
    const height = 18 + random() * 48;
    const radiusX = 1 + random() * 1.8;
    const radiusZ = 1 + random() * 1.8;
    dummy.position.set(point.x, point.y + height * .5, point.z);
    dummy.scale.set(radiusX, height, radiusZ);
    dummy.rotation.y = random() * Math.PI;
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
    // Cylindre : la rotation n'a pas d'effet sur l'emprise. 1.7 est le rayon
    // du bas de la CylinderGeometry, la partie la plus large du pylone.
    addBoxFromCenter(collision, point.x, point.y + height * .5, point.z, radiusX * 1.7, height * .5, radiusZ * 1.7);
  }
  mesh.name = 'field-towers';
  mesh.castShadow = true; root.add(mesh);
}

function buildCrystals(world, root, random) {
  const count = world.population.crystals || 0;
  if (!count) return;
  const color = world.terrain.kind === 'volcanic' ? 0xff4b16 : world.terrain.kind === 'arctic' ? 0x9bf6ff : 0x57d9ff;
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.15, roughness: .2, metalness: .25 });
  const mesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1.4, 0), material, count);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const point = randomGroundPoint(world, random, 80);
    const scale = .8 + random() * 3.8;
    dummy.position.set(point.x, point.y + scale * 1.5, point.z);
    dummy.scale.set(scale * .55, scale * 1.8, scale * .55);
    dummy.rotation.y = random() * Math.PI;
    dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.name = 'field-crystals';
  root.add(mesh);
}

// Mobilier leger partage par toutes les cartes. L'instanciation permet
// d'enrichir les grands espaces sans multiplier les draw calls.
function buildWorldSupplies(world, root, random) {
  const crateCount = Math.max(36, Math.round(world.size / 28));
  const beaconCount = Math.ceil(crateCount * .55);
  const group = new THREE.Group();
  group.name = 'world-supplies';
  const crate = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.8, 2.2, 2.8),
    new THREE.MeshStandardMaterial({ color: 0x78634a, roughness: .88, metalness: .08 }),
    crateCount
  );
  const beacon = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(.28, .42, 5.5, 7),
    new THREE.MeshStandardMaterial({ color: 0x66737a, emissive: 0x16536a, emissiveIntensity: .75, roughness: .5, metalness: .35 }),
    beaconCount
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < crateCount; i++) {
    const point = randomGroundPoint(world, random, 125);
    const scale = .7 + random() * 1.25;
    dummy.position.set(point.x, point.y + 1.1 * scale, point.z);
    dummy.scale.setScalar(scale);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.updateMatrix();
    crate.setMatrixAt(i, dummy.matrix);
  }
  for (let i = 0; i < beaconCount; i++) {
    const point = randomGroundPoint(world, random, 145);
    const scale = .8 + random() * .7;
    dummy.position.set(point.x, point.y + 2.75 * scale, point.z);
    dummy.scale.setScalar(scale);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.updateMatrix();
    beacon.setMatrixAt(i, dummy.matrix);
  }
  crate.castShadow = crate.receiveShadow = beacon.castShadow = true;
  group.add(crate, beacon);
  root.add(group);
}

function standardMaterial(color, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, roughness: .62, metalness: .18, emissive, emissiveIntensity: emissive ? .8 : 0 });
}

function buildLandmark(world, landmark) {
  const group = new THREE.Group();
  const scale = landmark.scale || 1;
  const metal = standardMaterial(0x596872);
  const stone = standardMaterial(world.terrain.kind === 'canyon' ? 0x9b5738 : 0x77756d);
  const glow = standardMaterial(0x54cfff, 0x167eaa);
  const add = mesh => { mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh; };

  if (landmark.type === 'spire') {
    const shaft = add(new THREE.Mesh(new THREE.CylinderGeometry(4, 9, 70, 12), metal)); shaft.position.y = 35;
    const tip = add(new THREE.Mesh(new THREE.ConeGeometry(6, 28, 12), glow)); tip.position.y = 84;
  } else if (landmark.type === 'dome') {
    const dome = add(new THREE.Mesh(new THREE.SphereGeometry(25, 24, 12, 0, Math.PI * 2, 0, Math.PI * .5), glow));
    dome.scale.y = .55;
    const base = add(new THREE.Mesh(new THREE.CylinderGeometry(27, 29, 4, 24), metal)); base.position.y = 2;
  } else if (landmark.type === 'arch') {
    const pillarA = add(new THREE.Mesh(new THREE.BoxGeometry(9, 48, 12), stone)); pillarA.position.set(-24, 24, 0);
    const pillarB = pillarA.clone(); pillarB.position.x = 24; group.add(pillarB);
    const top = add(new THREE.Mesh(new THREE.TorusGeometry(24, 5, 10, 32, Math.PI), stone)); top.rotation.z = Math.PI; top.position.y = 48;
  } else if (landmark.type === 'bridge') {
    const deck = add(new THREE.Mesh(new THREE.BoxGeometry(90, 3, 14), metal)); deck.position.y = 12;
    [-38, 38].forEach(x => { const p = add(new THREE.Mesh(new THREE.BoxGeometry(5, 28, 5), stone)); p.position.set(x, 0, 0); });
  } else if (landmark.type === 'helipad') {
    const pad = add(new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 3, 32), metal)); pad.position.y = 2;
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(15, 1.4, 8, 40), glow)); ring.rotation.x = Math.PI / 2; ring.position.y = 4;
  } else if (landmark.type === 'pyramid') {
    const pyramid = add(new THREE.Mesh(new THREE.ConeGeometry(34, 55, 4), stone)); pyramid.position.y = 27.5; pyramid.rotation.y = Math.PI / 4;
  } else if (landmark.type === 'arena') {
    const arena = add(new THREE.Mesh(new THREE.TorusGeometry(34, 7, 10, 48), stone)); arena.rotation.x = Math.PI / 2; arena.position.y = 6;
    const floor = add(new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 2, 40), metal)); floor.position.y = 2;
  } else if (landmark.type === 'radar') {
    const mast = add(new THREE.Mesh(new THREE.CylinderGeometry(2, 4, 38, 10), metal)); mast.position.y = 19;
    const dish = add(new THREE.Mesh(new THREE.SphereGeometry(18, 20, 10, 0, Math.PI), glow)); dish.scale.set(1, .32, 1); dish.rotation.z = Math.PI / 2; dish.position.y = 44;
  } else if (landmark.type === 'reactor') {
    const core = add(new THREE.Mesh(new THREE.CylinderGeometry(18, 24, 42, 16), metal)); core.position.y = 21;
    const ringA = add(new THREE.Mesh(new THREE.TorusGeometry(28, 2.4, 8, 48), glow)); ringA.rotation.x = Math.PI / 2; ringA.position.y = 28;
    const ringB = ringA.clone(); ringB.rotation.set(Math.PI / 2, Math.PI / 2, 0); group.add(ringB);
  } else if (landmark.type === 'crater') {
    const crater = add(new THREE.Mesh(new THREE.TorusGeometry(42, 13, 10, 48), stone)); crater.rotation.x = Math.PI / 2; crater.position.y = 5;
  } else if (landmark.type === 'lighthouse') {
    const tower = add(new THREE.Mesh(new THREE.CylinderGeometry(5, 9, 52, 14), stone)); tower.position.y = 26;
    const lamp = add(new THREE.Mesh(new THREE.SphereGeometry(7, 16, 10), glow)); lamp.position.y = 56;
  } else if (landmark.type === 'oasis' || landmark.type === 'lake-island') {
    const pool = add(new THREE.Mesh(new THREE.CylinderGeometry(38, 42, 1.2, 32), standardMaterial(0x218fb4, 0x063d55))); pool.position.y = 1;
    for (let i = 0; i < 8; i++) {
      const angle = i / 8 * Math.PI * 2;
      const trunk = add(new THREE.Mesh(new THREE.CylinderGeometry(.7, 1.1, 10, 6), standardMaterial(0x6a4422)));
      trunk.position.set(Math.sin(angle) * 30, 5, Math.cos(angle) * 30);
    }
  } else if (landmark.type === 'hangar') {
    const hangar = add(new THREE.Mesh(new THREE.BoxGeometry(70, 24, 48), metal)); hangar.position.y = 12;
    const door = add(new THREE.Mesh(new THREE.BoxGeometry(42, 16, 1), standardMaterial(0x18212a))); door.position.set(0, 8, -24.5);
  } else if (landmark.type === 'voxel-village') {
    const wood = standardMaterial(0xa96f3f);
    const roof = standardMaterial(0xb54a32);
    const glass = standardMaterial(0x79cfe2, 0x164653);
    [[-28, 0], [0, -18], [29, 5], [-8, 27]].forEach(([x, z], index) => {
      const house = add(new THREE.Mesh(new THREE.BoxGeometry(20, 14 + index % 2 * 4, 18), wood));
      house.position.set(x, 7 + index % 2 * 2, z);
      const cap = add(new THREE.Mesh(new THREE.BoxGeometry(24, 5, 22), roof)); cap.position.set(x, 16 + index % 2 * 4, z);
      const window = add(new THREE.Mesh(new THREE.BoxGeometry(5, 5, .7), glass)); window.position.set(x, 9, z + 9.35);
    });
    const well = add(new THREE.Mesh(new THREE.BoxGeometry(12, 5, 12), stone)); well.position.set(0, 2.5, 7);
  } else if (landmark.type === 'voxel-mine') {
    const obsidian = standardMaterial(0x201a2d, 0x160a2d);
    const portalGlow = standardMaterial(0x9a57ff, 0x6e21c9);
    const tunnel = add(new THREE.Mesh(new THREE.BoxGeometry(42, 25, 22), standardMaterial(0x4c433b))); tunnel.position.y = 12.5;
    const opening = add(new THREE.Mesh(new THREE.BoxGeometry(24, 18, 1.4), standardMaterial(0x0b0c10))); opening.position.set(0, 9, 11.2);
    [-15, 15].forEach(x => { const pillar = add(new THREE.Mesh(new THREE.BoxGeometry(8, 32, 8), obsidian)); pillar.position.set(x, 16, 14); });
    const lintel = add(new THREE.Mesh(new THREE.BoxGeometry(38, 8, 8), obsidian)); lintel.position.set(0, 30, 14);
    const glowPanel = add(new THREE.Mesh(new THREE.BoxGeometry(20, 14, .8), portalGlow)); glowPanel.position.set(0, 12, 14.5);
  } else if (landmark.type === 'voxel-castle') {
    const castleStone = standardMaterial(0x777b80);
    const banner = standardMaterial(0x3e67c7, 0x142964);
    const block = (w, h, d, x, y, z, material = castleStone) => {
      const mesh = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material));
      mesh.position.set(x, y, z); return mesh;
    };
    block(82, 24, 18, 0, 12, 0);
    block(18, 48, 18, -38, 24, 0); block(18, 48, 18, 38, 24, 0);
    block(48, 38, 42, 0, 19, -24);
    [-44, -32, -12, 12, 32, 44].forEach(x => block(8, 10, 20, x, 31, 0));
    const gate = block(17, 17, 2, 0, 8.5, 9.5, standardMaterial(0x201b18));
    gate.userData.voxelGate = true;
    block(7, 19, 1, 0, 28, 10.2, banner);
  } else {
    const marker = add(new THREE.Mesh(new THREE.CylinderGeometry(8, 12, 30, 10), metal)); marker.position.y = 15;
  }

  const ground = getWorldHeight(world, landmark.x, landmark.z);
  group.position.set(landmark.x, Math.max(ground, (world.waterLevel ?? -999) + .5), landmark.z);
  group.scale.setScalar(scale);
  return group;
}

async function getAssetTemplate(key) {
  if (assetCache.has(key)) return assetCache.get(key);
  const spec = ASSET_LIBRARY[key];
  if (!spec) throw new Error(`Asset inconnu: ${key}`);
  const promise = loader.loadAsync(spec.url).then(gltf => {
    const model = gltf.scene;
    model.rotation.x = spec.rotateX || 0;
    model.rotation.z = spec.rotateZ || 0;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z) || 1;
    model.scale.setScalar(spec.targetSize / maxAxis);
    model.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(model);
    const center = fitted.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y -= fitted.min.y;
    model.traverse(node => {
      if (node.isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });
    return model;
  });
  assetCache.set(key, promise);
  return promise;
}

async function placeExistingAssets(world, root, onProgress, collision) {
  const placements = world.assets || [];
  let loaded = 0;
  onProgress?.(`Objets 3D : 0 / ${placements.length}`);
  const results = await Promise.allSettled(placements.map(async placement => {
    const template = await getAssetTemplate(placement.key);
    const wrapper = new THREE.Group();
    wrapper.add(template.clone(true));
    const y = Math.max(getWorldHeight(world, placement.x, placement.z), (world.waterLevel ?? -999) + .4);
    wrapper.position.set(placement.x, y + (placement.y || 0), placement.z);
    wrapper.rotation.y = placement.rotation || 0;
    wrapper.scale.setScalar(placement.scale || 1);
    wrapper.name = `asset-${placements.indexOf(placement)}-${placement.key}`;
    wrapper.userData.assetKey = placement.key;
    root.add(wrapper);
    // Quartier parisien, stade, forteresses : modeles importes dont la
    // geometrie interne est inconnue, la rasterisation est la seule voie sure.
    registerHeightfieldColliders(collision, wrapper);
    loaded++;
    onProgress?.(`Objets 3D : ${loaded} / ${placements.length}`);
  }));
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) console.warn('[mondes] assets non charges', failures.map(item => item.reason));
  onProgress?.(failures.length ? `Objets 3D : ${loaded}/${placements.length} (${failures.length} indisponible)` : `Objets 3D : ${loaded}/${placements.length} prêts`);
  return results;
}

function addLighting(world, root) {
  const voxel = world.terrain.kind === 'voxel';
  const hemisphere = new THREE.HemisphereLight(0xcfeaff, voxel ? 0x5d704c : 0x263027, world.id === 'neon-vegas' || world.id === 'lunar-outpost' ? .58 : voxel ? 1.55 : .82);
  root.add(hemisphere);
  const sun = new THREE.DirectionalLight(world.id === 'fire-caldera' ? 0xffb078 : 0xfff1d5, world.id === 'neon-vegas' ? 1.1 : voxel ? 2.8 : 2.15);
  sun.position.set(-420, 650, 300);
  sun.castShadow = true;
  sun.shadow.mapSize.set(innerWidth < 700 ? 1024 : 2048, innerWidth < 700 ? 1024 : 2048);
  sun.shadow.camera.left = -650; sun.shadow.camera.right = 650;
  sun.shadow.camera.top = 650; sun.shadow.camera.bottom = -650;
  sun.shadow.camera.far = 1600;
  root.add(sun);
}

function buildPortal(world, route, root) {
  if (!route?.destination) return null;
  // Sans sol, le placement automatique enverrait le portail a -900. Le monde
  // peut donc imposer son ancrage exact, aligne sur la planete d'arrivee.
  const anchor = world.portalAnchor;
  const baseX = anchor ? anchor.x : route.x;
  const baseZ = anchor ? anchor.z : route.z;
  const groundY = anchor ? anchor.y : Math.max(getWorldHeight(world, baseX, baseZ), (world.waterLevel ?? -999) + .5);
  const portal = new THREE.Group();
  portal.name = `portal-to-${route.destination.id}`;
  portal.position.set(baseX, groundY, baseZ);
  // Le portail regarde le pilote qui arrive : sinon on le traverse de biais.
  if (anchor?.facing) portal.rotation.y = anchor.facing;

  const energy = new THREE.MeshBasicMaterial({
    color: 0x77e8ff, transparent: true, opacity: .2,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
  });

  const centerY = 21;
  const core = new THREE.Mesh(new THREE.PlaneGeometry(19, 31), energy);
  core.position.set(0, centerY, -.45);
  core.userData.portalCore = true;
  portal.add(core);

  const texture = portalTextureLoader.load('./assets/portal-archway/ethereal-rune-archway.png');
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  loader.load('./assets/portal-archway/ethereal-rune-archway.glb', gltf => {
    const object = gltf.scene;
    object.traverse(node => {
      if (!node.isMesh) return;
      node.material = new THREE.MeshStandardMaterial({
        map: texture, color: 0xffffff, emissive: 0x123b55, emissiveIntensity: .72,
        roughness: .56, metalness: .18, side: THREE.DoubleSide
      });
      node.castShadow = true;
      node.receiveShadow = true;
    });
    object.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    object.scale.setScalar(48 / Math.max(size.y, .001));
    object.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    object.position.x -= center.x;
    object.position.y -= box.min.y;
    object.position.z -= center.z;
    object.name = 'ethereal-rune-archway';
    object.userData.portalArchway = true;
    portal.add(object);
  });

  // La plateforme suppose un sol sous le portail : en orbite elle n'a pas lieu
  // d'etre, l'arche flotte.
  if (!anchor) {
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x182a3b, emissive: 0x071b32, emissiveIntensity: .8, roughness: .52, metalness: .62 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(17, 19, 1.1, 32), baseMaterial);
    platform.scale.set(1.28, 1.08, .44);
    platform.position.y = .35;
    platform.receiveShadow = true;
    portal.add(platform);
  }

  for (let i = 0; i < 24; i++) {
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(i % 3 === 0 ? .32 : .2, 7, 5),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x6fe9ff : 0xb093ff, transparent: true, opacity: .82, blending: THREE.AdditiveBlending })
    );
    particle.userData.portalParticle = {
      angle: i / 24 * Math.PI * 2,
      radius: 12 + (i % 5) * 1.15,
      speed: .42 + (i % 4) * .08,
      depth: ((i % 7) - 3) * .48,
      centerY
    };
    portal.add(particle);
  }

  const light = new THREE.PointLight(0x60dcff, 55, 145, 2);
  light.position.set(0, centerY, 4);
  portal.add(light);
  portal.userData.portal = {
    destinationId: route.destination.id,
    destinationName: route.destination.name,
    centerY: groundY + centerY,
    // A la vitesse lumiere le pilote franchit plus de dix unites par image :
    // un rayon de 24 se laisserait traverser sans etre detecte.
    activationRadius: world.portalActivationRadius ?? 24
  };
  root.add(portal);
  return portal;
}

// Le plan lointain de la camera est a 4200 : tout ce qui est place au-dela est
// purement et simplement ecrete. Le decor lointain doit donc tenir dessous,
// et c'est `fog: false` qui lui garde sa nettete plutot que la distance.
const SPACE_STAR_SHELL = 3600;
const SPACE_PLANET_SHELL = 2900;

let softSpaceTexture = null;
function getSoftSpaceTexture() {
  if (softSpaceTexture) return softSpaceTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.3, 'rgba(255,255,255,.55)');
  gradient.addColorStop(.7, 'rgba(255,255,255,.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  softSpaceTexture = new THREE.CanvasTexture(canvas);
  return softSpaceTexture;
}

/**
 * Champ d'etoiles colore.
 *
 * Les etoiles portent une couleur par sommet plutot qu'une teinte unique par
 * couche : un ciel monochrome est ce qui fait « plat ». Rendu en `Points`,
 * donc un seul appel de dessin par couche.
 */
function buildStarfield(world, root, random) {
  // Teintes stellaires reelles : bleutees pour les chaudes, ambrees pour les
  // froides, blanches pour la majorite.
  const palette = [
    [1, 1, 1], [.86, .92, 1], [.72, .84, 1],
    [1, .95, .84], [1, .84, .68], [1, .72, .62],
    [.82, 1, .96], [.94, .82, 1]
  ];
  // Trois couches au lieu de deux, dont une de grosses etoiles vives. Chacune
  // scintille a son propre rythme : c'est le dephasage entre couches qui donne
  // l'impression que les etoiles clignotent individuellement, sans le cout d'un
  // shader dedie.
  const layers = [
    { count: 4200, size: 3.6, opacity: 1, twinkle: { speed: 1.7, depth: .16, phase: 0 } },
    { count: 2100, size: 8, opacity: .8, twinkle: { speed: 1.1, depth: .3, phase: 2.1 } },
    { count: 420, size: 20, opacity: .95, twinkle: { speed: .7, depth: .42, phase: 4.2 } }
  ];
  layers.forEach(layer => {
    const positions = new Float32Array(layer.count * 3);
    const colors = new Float32Array(layer.count * 3);
    for (let i = 0; i < layer.count; i++) {
      // Repartition uniforme sur une sphere : sans le arccos, les etoiles
      // s'agglutineraient aux poles.
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = SPACE_STAR_SHELL * (.88 + random() * .12);
      positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.cos(phi) * radius;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
      const tint = palette[Math.floor(random() * palette.length)];
      // Plancher de luminosite releve : des etoiles a 55 % donnaient un ciel
      // terne, c'est ce qui rendait la scene sombre.
      const brightness = .78 + random() * .22;
      colors[i * 3] = tint[0] * brightness;
      colors[i * 3 + 1] = tint[1] * brightness;
      colors[i * 3 + 2] = tint[2] * brightness;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(geometry, new THREE.PointsMaterial({
      vertexColors: true, map: getSoftSpaceTexture(), size: layer.size,
      transparent: true, opacity: layer.opacity, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true, toneMapped: false, fog: false
    }));
    stars.name = 'starfield';
    stars.frustumCulled = false;
    stars.userData.twinkle = { ...layer.twinkle, base: layer.opacity };
    root.add(stars);
  });
}

/**
 * Nebuleuses : grands voiles additifs orientes vers le centre du circuit.
 *
 * Ce sont des plans et non des volumes : a cette distance la difference est
 * invisible, et le cout reste celui de quelques quads.
 */
function buildNebulae(world, root, random) {
  const hues = world.nebulaColors || [0x3b2f8f, 0x8f2f6b, 0x1f6f8f, 0x6b2f8f];
  hues.forEach((color, index) => {
    const theta = (index / hues.length) * Math.PI * 2 + random() * .8;
    const phi = Math.acos(2 * random() - 1);
    const radius = SPACE_STAR_SHELL * .82;
    const veil = new THREE.Mesh(
      new THREE.PlaneGeometry(2600 + random() * 1800, 1700 + random() * 1200),
      new THREE.MeshBasicMaterial({
        map: getSoftSpaceTexture(), color, transparent: true, opacity: .3 + random() * .18,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false,
        side: THREE.DoubleSide
      })
    );
    veil.position.set(
      Math.sin(phi) * Math.cos(theta) * radius,
      Math.cos(phi) * radius * .55,
      Math.sin(phi) * Math.sin(theta) * radius
    );
    veil.lookAt(0, 0, 0);
    veil.rotation.z = random() * Math.PI;
    veil.name = 'nebula';
    root.add(veil);
  });
}

// ── PLANETE DE TYPE TERRE ───────────────────────────────────────────────────
// Planisphere genere a la volee : oceans, continents, reliefs et calottes.
// Aucun fichier externe, donc rien a telecharger et rien a versionner.
//
// Une planete generee reste une planete *plausible*, pas la Terre reconnaissable :
// les vrais littoraux ne s'inventent pas. Le champ `textureUrl` du catalogue
// permet donc de brancher une vraie carte equirectangulaire quand on en a une,
// sans toucher a ce code.

const earthTextures = new Map();
function getEarthTexture(seed) {
  if (earthTextures.has(seed)) return earthTextures.get(seed);
  const width = 768, height = 384;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const data = image.data;

  for (let py = 0; py < height; py++) {
    const lat = (py / height - .5) * Math.PI;
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    for (let px = 0; px < width; px++) {
      const lon = (px / width) * Math.PI * 2;
      // Le bruit est echantillonne sur la position spherique et non sur le
      // planisphere : c'est ce qui evite une couture visible au meridien.
      const sx = cosLat * Math.cos(lon);
      const sy = sinLat;
      const sz = cosLat * Math.sin(lon);
      const elevation = fbm(sx * 2.1, sz * 2.1, seed) * .62
        + fbm(sy * 2.7, sx * 2.7, seed + 41) * .38;

      let r, g, b;
      if (elevation < -.02) {
        // Ocean : plus sombre au large, plus clair sur les plateaux.
        const depth = Math.min(1, (-.02 - elevation) * 3.2);
        r = 12 + (1 - depth) * 30;
        g = 52 + (1 - depth) * 70;
        b = 104 + (1 - depth) * 70;
      } else if (elevation < .03) {
        r = 196; g = 182; b = 132;                       // littoral
      } else if (elevation < .17) {
        const t = (elevation - .03) / .14;
        r = 62 + t * 34; g = 116 - t * 22; b = 52 + t * 10;   // plaines
      } else {
        const t = Math.min(1, (elevation - .17) / .22);
        r = 108 + t * 62; g = 96 + t * 66; b = 78 + t * 72;   // reliefs
      }

      // Calottes polaires : transition douce pour eviter un bord net.
      const polar = Math.max(0, (Math.abs(lat) - 1.16) / .41);
      if (polar > 0) {
        const blend = Math.min(1, polar);
        r += (246 - r) * blend;
        g += (250 - g) * blend;
        b += (255 - b) * blend;
      }

      const index = (py * width + px) * 4;
      data[index] = r; data[index + 1] = g; data[index + 2] = b; data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  earthTextures.set(seed, texture);
  return texture;
}

const cloudTextures = new Map();
function getCloudTexture(seed) {
  if (cloudTextures.has(seed)) return cloudTextures.get(seed);
  const width = 512, height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  const data = image.data;
  for (let py = 0; py < height; py++) {
    const lat = (py / height - .5) * Math.PI;
    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    for (let px = 0; px < width; px++) {
      const lon = (px / width) * Math.PI * 2;
      const sx = cosLat * Math.cos(lon), sy = sinLat, sz = cosLat * Math.sin(lon);
      const density = fbm(sx * 3.4, sz * 3.4, seed) * .6 + fbm(sy * 4.2, sx * 4.2, seed + 17) * .4;
      // Seuil haut : sans lui la planete disparait sous une couche uniforme.
      const alpha = Math.max(0, Math.min(1, (density - .04) * 4.2));
      const index = (py * width + px) * 4;
      data[index] = data[index + 1] = data[index + 2] = 255;
      data[index + 3] = alpha * 235;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  cloudTextures.set(seed, texture);
  return texture;
}

/**
 * Planetes lointaines, decrites dans le catalogue pour garder la main sur
 * l'esthetique. Chacune peut porter une atmosphere, un anneau, des nuages, et
 * soit une texture generee (`earthLike`) soit une vraie carte (`textureUrl`).
 */
function buildPlanets(world, root) {
  const planets = world.planets || [];
  const built = [];
  planets.forEach((spec, index) => {
    const group = new THREE.Group();
    group.name = `planet-${spec.id || index + 1}`;
    const direction = new THREE.Vector3(spec.x, spec.y, spec.z);
    if (direction.lengthSq() < 1) direction.set(0, 0, -1);
    direction.normalize().multiplyScalar(spec.distance || SPACE_PLANET_SHELL);
    group.position.copy(direction);

    const globeMaterial = new THREE.MeshStandardMaterial({
      color: spec.color, roughness: .82, metalness: .05,
      emissive: spec.emissive ?? spec.color, emissiveIntensity: spec.emissiveIntensity ?? .28,
      fog: false, toneMapped: false
    });
    // Une vraie carte prime toujours sur la generation procedurale.
    if (spec.textureUrl) {
      portalTextureLoader.load(spec.textureUrl, texture => {
        texture.colorSpace = THREE.SRGBColorSpace;
        globeMaterial.map = texture;
        globeMaterial.color.setHex(0xffffff);
        globeMaterial.emissiveIntensity = spec.emissiveIntensity ?? .12;
        globeMaterial.needsUpdate = true;
      }, undefined, error => console.warn('[planete] carte indisponible, rendu procedural conserve', error));
    }
    if (spec.earthLike) {
      globeMaterial.map = getEarthTexture(spec.seed ?? 7);
      globeMaterial.color.setHex(0xffffff);
      globeMaterial.emissiveIntensity = spec.emissiveIntensity ?? .12;
      globeMaterial.roughness = .92;
    }
    const globe = new THREE.Mesh(new THREE.SphereGeometry(spec.radius, 64, 44), globeMaterial);
    globe.name = 'planet-globe';
    group.add(globe);

    // Couche nuageuse : sphere legerement plus grande, en rotation propre pour
    // que la planete ne paraisse pas figee.
    if (spec.clouds) {
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(spec.radius * 1.022, 48, 32),
        new THREE.MeshStandardMaterial({
          map: getCloudTexture(spec.seed ?? 7), transparent: true, opacity: .82,
          depthWrite: false, roughness: 1, metalness: 0, fog: false, toneMapped: false
        })
      );
      clouds.name = 'planet-clouds';
      clouds.userData.planetSpin = { speed: (spec.spin ?? .012) * 1.45 };
      group.add(clouds);
    }

    // Halo atmospherique : une sphere legerement plus grande vue de l'interieur,
    // ce qui donne un liseré lumineux sur le limbe.
    if (spec.atmosphere) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(spec.radius * 1.09, 40, 26),
        new THREE.MeshBasicMaterial({
          color: spec.atmosphere, transparent: true, opacity: .3,
          blending: THREE.AdditiveBlending, side: THREE.BackSide,
          depthWrite: false, fog: false, toneMapped: false
        })
      );
      group.add(halo);
    }
    if (spec.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(spec.radius * spec.ring.inner, spec.radius * spec.ring.outer, 96),
        new THREE.MeshBasicMaterial({
          color: spec.ring.color, transparent: true, opacity: .55,
          side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false
        })
      );
      ring.rotation.x = spec.ring.tilt ?? -1.1;
      ring.rotation.y = spec.ring.yaw ?? .3;
      group.add(ring);
    }
    group.userData.planetSpin = { speed: spec.spin ?? .012 };
    root.add(group);
    built.push({ id: spec.id || `planet-${index + 1}`, group, spec });
  });
  return built;
}

/**
 * Soleil lointain : sphere vive, halo additif, et une lumiere directionnelle
 * alignee sur lui pour que l'eclairage du circuit vienne bien de la.
 */
function buildSpaceSun(world, root) {
  const spec = world.sun;
  if (!spec) return;
  const direction = new THREE.Vector3(spec.x, spec.y, spec.z).normalize();
  const position = direction.clone().multiplyScalar(spec.distance || 3200);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(spec.radius || 120, 36, 24),
    new THREE.MeshBasicMaterial({ color: spec.color || 0xfff3d0, fog: false, toneMapped: false })
  );
  core.position.copy(position);
  root.add(core);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getSoftSpaceTexture(), color: spec.glowColor || 0xffd68a,
    transparent: true, opacity: .85, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, toneMapped: false
  }));
  glow.position.copy(position);
  const glowSize = (spec.radius || 120) * 9;
  glow.scale.set(glowSize, glowSize, 1);
  root.add(glow);

  const light = new THREE.DirectionalLight(spec.color || 0xfff3d0, spec.intensity ?? 2.4);
  light.position.copy(direction.multiplyScalar(900));
  root.add(light);
}

/**
 * Asteroides du circuit : obstacles reels, enregistres dans le champ de
 * collision. Ils sont repartis en volume et non sur un sol, et evites autour
 * de la trajectoire de course pour que le circuit reste franchissable.
 */
function buildAsteroids(world, root, random, collision) {
  const count = world.population.asteroids || 0;
  if (!count) return;
  const clearRadius = world.asteroidClearance || 150;
  // Zones a preserver : les portes, mais aussi l'interieur des massifs. Un
  // asteroide tombe au milieu d'un couloir de roche le rendrait infranchissable,
  // et le controle par porte seule laisse passer le milieu des segments.
  const keepClear = (world.raceCourse || []).map(point => ({
    x: point.x, y: Number.isFinite(point.y) ? point.y : 0, z: point.z, radius: clearRadius
  }));
  (world.rockMassifs || []).forEach(massif => {
    const corridor = (massif.corridorRadius || 240) * 1.25;
    (massif.path || []).forEach(p => keepClear.push({ x: p[0], y: p[1], z: p[2], radius: corridor }));
  });
  const material = new THREE.MeshStandardMaterial({ color: 0x6b6a76, roughness: .95, metalness: .08 });
  const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), material, count);
  const dummy = new THREE.Object3D();
  const span = world.size * .48;
  let placed = 0;

  for (let attempt = 0; attempt < count * 12 && placed < count; attempt++) {
    const x = (random() * 2 - 1) * span;
    const z = (random() * 2 - 1) * span;
    const y = (random() * 2 - 1) * (world.verticalSpan || 320);
    const tooClose = keepClear.some(zone =>
      Math.hypot(x - zone.x, y - zone.y, z - zone.z) < zone.radius);
    if (tooClose) continue;
    const size = 12 + random() * 46;
    dummy.position.set(x, y, z);
    dummy.scale.set(size, size * (.7 + random() * .6), size * (.75 + random() * .5));
    dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    // Boite englobante : le dodecaedre de rayon 1 tient dans un cube unitaire.
    addBoxFromCenter(collision, x, y, z, dummy.scale.x, dummy.scale.y, dummy.scale.z);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.name = 'field-asteroids';
  root.add(mesh);
}

/**
 * Point d'un trace, en coordonnees absolues ou relatives au sol.
 *
 * Sur un relief, l'altitude du terrain n'est pas connue au moment d'ecrire le
 * catalogue. Un trace `groundRelative` s'ecrit donc `[x, z, hauteur]` et suit
 * automatiquement la montagne — c'est ce qui permet de tracer un couloir de
 * parois qui grimpe.
 */
function resolvePathPoint(world, owner, point) {
  if (owner.groundRelative) {
    const [x, z, clearance = 60] = point;
    return new THREE.Vector3(x, getWorldHeight(world, x, z) + clearance, z);
  }
  return new THREE.Vector3(point[0], point[1], point[2]);
}

/**
 * Massif rocheux perce d'un couloir.
 *
 * Le piege serait de modeler une roche pleine puis d'y creuser un tunnel :
 * Three.js n'a pas de soustraction booleenne, et le resultat serait truffe de
 * trous invisibles. On procede donc a l'inverse — le couloir est defini
 * d'abord, la roche est empilee **autour** de lui. Le vide est alors libre par
 * construction, et les collisions ne portent que sur les blocs.
 *
 * Le couloir suit une courbe : on en echantillonne le trace, puis chaque bloc
 * est place a une distance de l'axe superieure au rayon du couloir.
 */
function buildRockMassif(world, root, random, collision) {
  const massifs = world.rockMassifs || [];
  if (!massifs.length) return;

  massifs.forEach((massif, massifIndex) => {
    const controls = (massif.path || []).map(p => resolvePathPoint(world, massif, p));
    if (controls.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(controls, false, 'catmullrom', .4);
    const corridor = massif.corridorRadius || 240;
    const thickness = massif.shellThickness || 420;
    const chunkCount = massif.chunks || 320;

    // Roche claire : dans le noir de l'espace, une roche sombre est invisible.
    const material = new THREE.MeshStandardMaterial({
      color: massif.color ?? 0xb9b2a4,
      roughness: .88,
      metalness: .06,
      emissive: massif.emissive ?? 0x2a2620,
      emissiveIntensity: .35
    });
    const mesh = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), material, chunkCount);
    mesh.name = `rock-massif-${massifIndex + 1}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const axis = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const sideways = new THREE.Vector3();
    const upward = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const worldUp = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i < chunkCount; i++) {
      const t = random();
      curve.getPointAt(t, axis);
      curve.getTangentAt(t, tangent);
      // Repere local perpendiculaire a la trajectoire : c'est lui qui garantit
      // que le decalage s'eloigne bien de l'axe du couloir.
      sideways.crossVectors(tangent, worldUp);
      if (sideways.lengthSq() < .001) sideways.set(1, 0, 0);
      sideways.normalize();
      upward.crossVectors(sideways, tangent).normalize();

      const size = massif.chunkSize ? massif.chunkSize[0] + random() * (massif.chunkSize[1] - massif.chunkSize[0]) : 45 + random() * 130;
      // Dans le vide, la roche entoure le couloir sur tout le pourtour. Sur un
      // relief ce serait absurde : des blocs flotteraient en plein ciel. On
      // regroupe alors les blocs en deux amas lateraux — de vraies parois.
      const lateral = massif.walls ?? massif.groundRelative;
      const angle = lateral
        ? (random() < .5 ? 0 : Math.PI) + (random() - .5) * (massif.wallSpread ?? 2.3)
        : random() * Math.PI * 2;
      // La marge du rayon inclut la taille du bloc : sans elle, un gros bloc
      // centre juste au-dela du couloir mordrait dedans.
      const distance = corridor + size * 1.1 + random() * thickness;
      offset.copy(sideways).multiplyScalar(Math.cos(angle) * distance)
        .addScaledVector(upward, Math.sin(angle) * distance);

      dummy.position.copy(axis).add(offset);
      dummy.scale.set(size, size * (.65 + random() * .7), size * (.7 + random() * .6));
      dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      addBoxFromCenter(
        collision,
        dummy.position.x, dummy.position.y, dummy.position.z,
        dummy.scale.x, dummy.scale.y, dummy.scale.z
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);

    // Balisage lumineux du couloir : sans lui, l'interieur du massif est une
    // caverne noire et le trace devient illisible.
    const lampCount = massif.lamps || 14;
    const lampColor = massif.lampColor ?? 0xffb552;
    for (let i = 0; i <= lampCount; i++) {
      const t = i / lampCount;
      curve.getPointAt(t, axis);
      curve.getTangentAt(t, tangent);
      sideways.crossVectors(tangent, worldUp);
      if (sideways.lengthSq() < .001) sideways.set(1, 0, 0);
      sideways.normalize();
      upward.crossVectors(sideways, tangent).normalize();

      // Quatre feux par station, plaques contre la paroi.
      for (let k = 0; k < 4; k++) {
        const angle = k * Math.PI * .5 + (i % 2) * .4;
        offset.copy(sideways).multiplyScalar(Math.cos(angle) * corridor * .92)
          .addScaledVector(upward, Math.sin(angle) * corridor * .92);
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(5.5, 10, 8),
          new THREE.MeshBasicMaterial({ color: lampColor, toneMapped: false })
        );
        lamp.position.copy(axis).add(offset);
        root.add(lamp);
      }
      // Une vraie source lumineuse une station sur deux : suffisant pour
      // eclairer la paroi sans saturer le nombre de lumieres de la scene.
      if (i % 2 === 0) {
        const light = new THREE.PointLight(lampColor, 70, corridor * 3.4, 2);
        light.position.copy(axis);
        root.add(light);
      }
    }
  });
}

/**
 * Tunnels d'acceleration : une enfilade d'anneaux lumineux marquant un volume
 * ou le pilote passe en vitesse lumiere. Les anneaux ne sont que le reperage
 * visuel, l'effet est declenche par la distance au centre (voir world-game.js).
 */
function buildSpeedZones(world, root) {
  const zones = world.speedZones || [];
  if (!zones.length) return [];
  const built = [];

  zones.forEach((zone, index) => {
    const group = new THREE.Group();
    group.name = `speed-tunnel-${index + 1}`;
    const color = zone.color ?? 0x54f6ff;
    const radius = zone.radius || 130;

    // Le trace est une courbe et non un segment : un tunnel qui vire donne
    // envie de le suivre, alors qu'un tube droit se traverse sans y penser.
    const controls = (zone.path || []).map(point => resolvePathPoint(world, zone, point));
    if (controls.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(controls, false, 'catmullrom', .4);

    // Echantillonnage unique, conserve pour la detection en jeu : la boucle
    // d'animation n'aura qu'a comparer des distances a ces points.
    const sampleCount = zone.samples || 48;
    const samples = new Float32Array((sampleCount + 1) * 3);
    const point = new THREE.Vector3();
    for (let i = 0; i <= sampleCount; i++) {
      curve.getPointAt(i / sampleCount, point);
      samples[i * 3] = point.x;
      samples[i * 3 + 1] = point.y;
      samples[i * 3 + 2] = point.z;
    }

    // Paroi du tunnel : un tube ouvert, vu de l'interieur, en grille lumineuse.
    const shell = new THREE.Mesh(
      new THREE.TubeGeometry(curve, sampleCount, radius, 26, false),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: .17, side: THREE.BackSide,
        blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true,
        toneMapped: false, fog: false
      })
    );
    shell.name = 'speed-tunnel-shell';
    group.add(shell);

    // Arceaux repartis le long de la courbe, orientes selon la tangente.
    const arcCount = zone.arcs || 16;
    const tangent = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();
    for (let i = 0; i <= arcCount; i++) {
      const t = i / arcCount;
      curve.getPointAt(t, point);
      curve.getTangentAt(t, tangent);
      const arc = new THREE.Mesh(
        new THREE.TorusGeometry(radius * .96, radius * .035, 8, 40),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: .8,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false
        })
      );
      arc.position.copy(point);
      lookTarget.copy(point).add(tangent);
      arc.lookAt(lookTarget);
      arc.userData.speedRing = { index: i, phase: i * .42 };
      group.add(arc);
    }

    // Quelques feux le long du parcours, sinon l'interieur reste plat.
    for (let i = 0; i < 3; i++) {
      curve.getPointAt((i + .5) / 3, point);
      const light = new THREE.PointLight(color, 60, radius * 6, 2);
      light.position.copy(point);
      group.add(light);
    }

    root.add(group);
    const midpoint = curve.getPointAt(.5, new THREE.Vector3());
    built.push({
      samples,
      sampleCount: sampleCount + 1,
      radius,
      multiplier: zone.multiplier || 2.4,
      bonus: zone.bonus ?? 150,
      bonusHold: zone.bonusHold ?? 5,
      centerX: midpoint.x, centerY: midpoint.y, centerZ: midpoint.z,
      group
    });
  });
  return built;
}

// ── HABILLAGE DE COURSE ─────────────────────────────────────────────────────
// Vocabulaire visuel des circuits d'aujourd'hui, transpose dans le vide :
// chevrons de guidage sur la trajectoire, numeros de porte lisibles de loin,
// damier de depart. Les chevrons remplacent aussi le radar retire du HUD.

const numberTextures = new Map();
function getNumberTexture(value) {
  if (numberTextures.has(value)) return numberTextures.get(value);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  context.font = '900 170px Consolas, monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  // Contour epais puis remplissage : le chiffre reste lisible sur un fond
  // clair comme sur le noir de l'espace.
  context.lineWidth = 18;
  context.strokeStyle = 'rgba(4,14,24,.95)';
  context.strokeText(String(value), size / 2, size / 2 + 8);
  context.fillStyle = '#ffffff';
  context.fillText(String(value), size / 2, size / 2 + 8);
  const texture = new THREE.CanvasTexture(canvas);
  numberTextures.set(value, texture);
  return texture;
}

let checkerTexture = null;
function getCheckerTexture() {
  if (checkerTexture) return checkerTexture;
  const cells = 8;
  const cell = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = cells * cell;
  const context = canvas.getContext('2d');
  for (let x = 0; x < cells; x++) {
    for (let y = 0; y < cells; y++) {
      context.fillStyle = (x + y) % 2 ? '#ffffff' : '#0b0f18';
      context.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  checkerTexture = new THREE.CanvasTexture(canvas);
  checkerTexture.wrapS = checkerTexture.wrapT = THREE.RepeatWrapping;
  return checkerTexture;
}

/**
 * Chevrons de guidage, numeros et damier de depart.
 *
 * Un `InstancedMesh` par segment : le cout de dessin reste negligeable, et le
 * jeu peut allumer le seul segment courant pour guider le pilote — ce qui rend
 * le radar central inutile.
 */
function buildRaceDressing(world, root, gates) {
  if (gates.length < 2) return null;
  const group = new THREE.Group();
  group.name = 'race-dressing';
  root.add(group);

  const chevronGeometry = new THREE.ConeGeometry(7.5, 17, 4);
  // La pointe du cone regarde +Y : on la couche vers +Z pour qu'elle indique
  // le sens de la marche.
  chevronGeometry.rotateX(Math.PI / 2);
  chevronGeometry.scale(1, .28, 1);

  const dummy = new THREE.Object3D();
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const segments = [];

  gates.forEach((gate, index) => {
    const next = gates[(index + 1) % gates.length];
    from.copy(gate.position);
    to.copy(next.position);
    const span = from.distanceTo(to);
    // Les chevrons commencent apres la porte et s'arretent avant la suivante,
    // pour ne pas encombrer l'anneau lui-meme.
    const count = Math.max(3, Math.min(14, Math.round(span / 55)));
    const material = new THREE.MeshBasicMaterial({
      color: 0x2b5f7a, transparent: true, opacity: .5,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false
    });
    const mesh = new THREE.InstancedMesh(chevronGeometry, material, count);
    mesh.frustumCulled = false;
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1);
      dummy.position.lerpVectors(from, to, t);
      dummy.lookAt(to);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
    segments.push({ mesh, material });

    // Numero de porte : un sprite reste lisible sous tous les angles, ce qui
    // n'est pas le cas d'un plan oriente.
    const label = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getNumberTexture(index + 1), transparent: true,
      depthWrite: false, depthTest: false, toneMapped: false, fog: false
    }));
    label.scale.set(30, 30, 1);
    label.position.set(0, 44, 0);
    label.renderOrder = 6;
    gate.add(label);
  });

  // Damier de depart : deux panneaux encadrant la premiere porte.
  const checker = getCheckerTexture().clone();
  checker.needsUpdate = true;
  checker.repeat.set(3, 1);
  [-1, 1].forEach(side => {
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(46, 15),
      new THREE.MeshBasicMaterial({ map: checker, side: THREE.DoubleSide, toneMapped: false, fog: false })
    );
    panel.position.set(side * 58, 0, 0);
    panel.rotation.y = side * -.35;
    gates[0].add(panel);
  });

  return {
    segments,
    /** Allume le segment a parcourir et eteint les autres. */
    setActiveSegment(activeIndex) {
      for (let i = 0; i < segments.length; i++) {
        const isActive = i === activeIndex;
        segments[i].material.color.setHex(isActive ? 0x7bf3ff : 0x2b5f7a);
        segments[i].material.opacity = isActive ? .95 : .28;
      }
    }
  };
}

function buildRaceCourse(world, root) {
  const points = world.raceCourse || [];
  if (!points.length) return [];
  const gates = [];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const gate = new THREE.Group();
    gate.name = `race-gate-${index + 1}`;
    const color = 0x30233f;
    const material = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: .35,
      roughness: .22, metalness: .42
    });
    // Taille reglable par monde : un anneau de 27 se perd dans un couloir de
    // roche large de plusieurs centaines d'unites.
    const gateRadius = world.gateRadius || 27;
    const scaleFactor = gateRadius / 27;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(gateRadius, 2.15 * scaleFactor, 12, 52), material);
    ring.castShadow = true;
    ring.userData.raceGateRing = { index, baseIntensity: .35 };
    gate.add(ring);
    const markerMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .62, blending: THREE.AdditiveBlending });
    [-1, 1].forEach(side => {
      const marker = new THREE.Mesh(new THREE.ConeGeometry(2.8 * scaleFactor, 10 * scaleFactor, 10), markerMaterial);
      marker.position.set(side * gateRadius * 1.22, 0, 0);
      marker.rotation.z = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      gate.add(marker);
    });
    const beacon = new THREE.PointLight(color, 28 * scaleFactor, 105 * scaleFactor, 2);
    gate.add(beacon);
    // Une porte peut fixer son altitude absolue (`y`), indispensable dans
    // l'espace ou il n'y a pas de sol de reference.
    const ground = Number.isFinite(point.y) ? point.y - (point.clearance || 66) : getWorldHeight(world, point.x, point.z);
    gate.position.set(point.x, ground + (point.clearance || 66), point.z);
    gate.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
    gate.userData.raceGate = { index, radius: gateRadius * 1.15, passed: false, missed: false, material, markerMaterial, beacon };
    root.add(gate);
    gates.push(gate);
  });
  return gates;
}

export function buildWorld(scene, world, onProgress, portalRoute) {
  scene.background = new THREE.Color(world.sky);
  scene.fog = new THREE.FogExp2(world.fog, world.fogDensity);
  const root = new THREE.Group();
  root.name = `world-${world.id}`;
  scene.add(root);
  const random = seededRandom(world.seed);
  // Le portail et les portes de course restent volontairement traversables :
  // seuls les volumes construits alimentent le champ de collision.
  const collision = createCollisionField(PILOT_COLLISION_RADIUS);
  const inSpace = world.terrain.kind === 'space';

  if (inSpace) {
    // Aucun sol, aucune route, aucune vegetation. L'eclairage terrestre
    // (hemisphere + soleil ombrant) est remplace par une lueur ambiante tres
    // faible plus le soleil du systeme : dans le vide, l'ombre est franche.
    root.add(new THREE.AmbientLight(world.ambientColor ?? 0x2b3a5c, world.ambientIntensity ?? .5));
    buildStarfield(world, root, random);
    buildNebulae(world, root, random);
    buildPlanets(world, root);
    buildSpaceSun(world, root);
    buildAsteroids(world, root, random, collision);
  } else {
    addLighting(world, root);
    buildTerrain(world, root);
    buildRoads(world, root);
    buildTrees(world, root, random);
    buildRocks(world, root, random);
    if (world.id !== 'nova-city') {
      buildBuildings(world, root, random, collision);
      buildTowers(world, root, random, collision);
    }
    buildCrystals(world, root, random);
    buildWorldSupplies(world, root, random);
    (world.landmarks || []).forEach(landmark => {
      const group = buildLandmark(world, landmark);
      root.add(group);
      registerMeshColliders(collision, group);
    });
  }
  // Les massifs valent pour tous les mondes : dans le vide ils forment un
  // couloir isole, sur un relief ils dressent des parois au-dessus du sol.
  buildRockMassif(world, root, random, collision);
  const speedZones = buildSpeedZones(world, root);
  const raceGates = buildRaceCourse(world, root);
  const raceDressing = buildRaceDressing(world, root, raceGates);
  const portal = buildPortal(world, portalRoute, root);
  const assetsPromise = Promise.all([
    placeExistingAssets(world, root, onProgress, collision),
    buildNovaCityBuildings(world, root, random, onProgress, collision)
  ]);
  return {
    root,
    portal,
    raceGates,
    raceDressing,
    speedZones,
    assetsPromise,
    collision,
    getHeight: (x, z) => getWorldHeight(world, x, z),
    bounds: world.size * .48
  };
}

export function animateWorld(root, elapsed) {
  root?.traverse(node => {
    if (node.userData.animatedWater && node.material) {
      node.material.opacity = .64 + Math.sin(elapsed * 1.5) * .045;
    }
    if (node.userData.portalRing) {
      node.rotation.z = elapsed * node.userData.portalRing.speed * node.userData.portalRing.direction;
    }
    if (node.userData.portalCore && node.material) {
      node.material.opacity = .22 + Math.sin(elapsed * 3.2) * .08;
      node.scale.setScalar(.98 + Math.sin(elapsed * 2.1) * .025);
    }
    // Anneaux du tunnel d'acceleration : pulsation decalee qui donne
    // l'impression que l'energie file vers la sortie.
    const twinkle = node.userData.twinkle;
    if (twinkle && node.material) {
      node.material.opacity = twinkle.base * (1 - twinkle.depth + Math.sin(elapsed * twinkle.speed + twinkle.phase) * twinkle.depth);
    }
    if (node.userData.planetSpin) node.rotation.y = elapsed * node.userData.planetSpin.speed;
    const speedRing = node.userData.speedRing;
    if (speedRing && node.material) {
      node.material.opacity = .45 + Math.abs(Math.sin(elapsed * 3.4 - speedRing.phase)) * .5;
      node.rotation.z = elapsed * (speedRing.index % 2 ? .7 : -.7);
    }
    if (node.userData.raceGateRing && node.material) {
      const gate = node.userData.raceGateRing;
      node.material.emissiveIntensity = gate.baseIntensity + Math.sin(elapsed * 3 + gate.index * .7) * .42;
    }
    const particle = node.userData.portalParticle;
    if (particle) {
      const angle = particle.angle + elapsed * particle.speed;
      node.position.set(
        Math.cos(angle) * particle.radius,
        particle.centerY + Math.sin(angle) * particle.radius,
        particle.depth + Math.sin(elapsed * 1.7 + particle.angle) * .7
      );
    }
  });
}
