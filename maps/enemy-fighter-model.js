import * as THREE from 'three';
import { OBJLoader } from '../libs/loaders/OBJLoader.js';

const ASSET_DIR = './assets/enemies/red-black-fighter/';
const MODEL_URL = `${ASSET_DIR}Meshy_AI_Create_an_ultra_reali_0722015421_texture.obj`;

let templatePromise = null;
let whiteGlowTexture = null;

// Taille du halo de reperage, en unites d'ecran : avec `sizeAttenuation: false`
// une valeur de 1 couvre a peu pres la hauteur du champ de vision. 0.085
// represente donc environ 8 % de la hauteur de l'ecran, quelle que soit la
// distance de l'ennemi.
const BEACON_SCREEN_SIZE = .085;

function getWhiteGlowTexture() {
  if (whiteGlowTexture) return whiteGlowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 62);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.2, 'rgba(235,255,255,.9)');
  gradient.addColorStop(.48, 'rgba(190,245,255,.38)');
  gradient.addColorStop(1, 'rgba(160,230,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  whiteGlowTexture = new THREE.CanvasTexture(canvas);
  return whiteGlowTexture;
}

function loadTemplate() {
  if (templatePromise) return templatePromise;

  templatePromise = new OBJLoader().loadAsync(MODEL_URL).then(object => {

    // Cible « hologramme » : couleur vive cyan, fortement émissive et légèrement
    // translucide, pour rester très visible à distance dans la ville.
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0x0b4a55, emissive: 0x4dffff, emissiveIntensity: 2.4, metalness: .1, roughness: .3, transparent: true, opacity: .96, toneMapped: false }),
      new THREE.MeshStandardMaterial({ color: 0x0d5240, emissive: 0x74ffd8, emissiveIntensity: 2.1, metalness: .1, roughness: .35, transparent: true, opacity: .95, toneMapped: false })
    ];
    const wireMaterial = new THREE.MeshBasicMaterial({ color: 0xbfffff, wireframe: true, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    let meshIndex = 0;
    object.traverse(node => {
      if (!node.isMesh) return;
      node.material = materials[meshIndex++ % materials.length];
      node.castShadow = false;
      node.receiveShadow = false;
      // Surcouche filaire additive : accentue le rendu hologramme.
      const wire = new THREE.Mesh(node.geometry, wireMaterial);
      wire.name = 'enemy-hologram-wire';
      wire.renderOrder = 4;
      node.add(wire);
    });

    const bounds = new THREE.Box3().setFromObject(object);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    object.position.sub(center);
    object.scale.setScalar(1 / Math.max(size.x, size.y, size.z));
    object.name = 'enemy-fighter-red-black-template';
    return object;
  }).catch(error => {
    templatePromise = null;
    throw error;
  });

  return templatePromise;
}

function addThrusters(group) {
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: 0xff3518,
    transparent: true,
    opacity: .84,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const flames = [];
  for (const x of [-.12, .12]) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(.055, .42, 10, 1, true), flameMaterial);
    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, 0, .99);
    group.add(flame);
    flames.push(flame);
  }
  group.userData.flames = flames;
}

export async function createEnemyFighterModel({ targetLength = 10, thrusters = true } = {}) {
  const template = await loadTemplate();
  const instance = template.clone(true);
  instance.name = 'enemy-fighter-red-black';
  instance.scale.multiplyScalar(targetLength * 1.1);
  // Contour sombre plein (silhouette) : fait ressortir l'ennemi cyan sur TOUS
  // les fonds, y compris les immeubles clairs ou l'additif serait invisible.
  const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x00121a, side: THREE.BackSide, toneMapped: false });
  const visibleMeshes = [];
  instance.traverse(node => { if (node.isMesh && node.name !== 'enemy-hologram-wire') visibleMeshes.push(node); });
  visibleMeshes.forEach(mesh => {
    const outline = new THREE.Mesh(mesh.geometry, outlineMaterial);
    outline.name = 'enemy-hologram-outline';
    outline.scale.setScalar(1.18);
    outline.renderOrder = 1;
    mesh.add(outline);
  });
  const visibilityLight = new THREE.PointLight(0x5ffcff, 90, targetLength * 16, 1.6);
  visibilityLight.name = 'enemy-hologram-light';
  instance.add(visibilityLight);
  const makeHalo = (scale, opacity, order, color, sizeAttenuation = true) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getWhiteGlowTexture(),
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      sizeAttenuation,
      toneMapped: false
    }));
    sprite.name = 'enemy-hologram-halo';
    sprite.position.y = .05;
    sprite.scale.set(scale, scale, 1);
    sprite.renderOrder = order;
    return sprite;
  };

  // Halos proches : ils grandissent avec l'appareil, donnent la presence et la
  // taille apparente. Coeur blanc pur, aura holographique autour.
  instance.add(makeHalo(9, 1, 4, 0xffffff));
  instance.add(makeHalo(19, .72, 3, 0xc8fdff));
  instance.add(makeHalo(34, .38, 2, 0x8dfcff));

  // Halo de reperage : `sizeAttenuation: false` fige sa taille a l'ecran, il ne
  // retrecit donc pas avec la distance. C'est ce qui manquait — les halos
  // classiques disparaissaient justement quand l'ennemi devenait lointain.
  // `depthTest: false` le laisse traverser les immeubles : la cible reste
  // reperable meme masquee par une tour.
  const beacon = makeHalo(1, .92, 5, 0xffffff, false);
  beacon.name = 'enemy-hologram-beacon';
  // Un sprite herite de l'echelle de son parent. Celle de l'instance depend du
  // modele importe, donc on l'annule au lieu de la supposer : la taille finale
  // a l'ecran est ainsi la meme quel que soit l'appareil.
  const instanceScale = instance.scale.x || 1;
  const beaconScreenSize = BEACON_SCREEN_SIZE / instanceScale;
  beacon.scale.set(beaconScreenSize, beaconScreenSize, 1);
  instance.add(beacon);
  if (thrusters) addThrusters(instance);
  return instance;
}

export function preloadEnemyFighterModel() {
  return loadTemplate();
}
