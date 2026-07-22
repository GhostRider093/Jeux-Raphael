import * as THREE from 'three';
import { OBJLoader } from '../libs/loaders/OBJLoader.js';

const ASSET_DIR = './assets/enemies/red-black-fighter/';
const MODEL_URL = `${ASSET_DIR}Meshy_AI_Create_an_ultra_reali_0722015421_texture.obj`;

let templatePromise = null;
let whiteGlowTexture = null;

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

    // Red/black identification panels: the target remains readable and now
    // matches the red combat reticle instead of flashing blue while loading.
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0xd7192d, emissive: 0x4f0008, emissiveIntensity: .34, metalness: .5, roughness: .3 }),
      new THREE.MeshStandardMaterial({ color: 0x11151b, emissive: 0x210006, emissiveIntensity: .16, metalness: .72, roughness: .24 })
    ];
    let meshIndex = 0;
    object.traverse(node => {
      if (!node.isMesh) return;
      node.material = materials[meshIndex++ % materials.length];
      node.castShadow = true;
      node.receiveShadow = true;
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
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xf4ffff,
    side: THREE.BackSide,
    transparent: true,
    opacity: .72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const visibleMeshes = [];
  instance.traverse(node => { if (node.isMesh) visibleMeshes.push(node); });
  visibleMeshes.forEach(mesh => {
    const outline = new THREE.Mesh(mesh.geometry, glowMaterial);
    outline.name = 'enemy-white-fluorescent-outline';
    outline.scale.setScalar(1.1);
    outline.renderOrder = 3;
    mesh.add(outline);
  });
  const visibilityLight = new THREE.PointLight(0xeeffff, 48, targetLength * 12, 1.7);
  visibilityLight.name = 'enemy-white-visibility-light';
  instance.add(visibilityLight);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: getWhiteGlowTexture(),
    color: 0xf4ffff,
    transparent: true,
    opacity: .68,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  }));
  halo.name = 'enemy-white-fluorescent-halo';
  halo.position.y = .05;
  halo.scale.set(2.35, 2.35, 1);
  halo.renderOrder = 2;
  instance.add(halo);
  if (thrusters) addThrusters(instance);
  return instance;
}

export function preloadEnemyFighterModel() {
  return loadTemplate();
}
