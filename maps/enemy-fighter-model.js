import * as THREE from 'three';
import { OBJLoader } from '../libs/loaders/OBJLoader.js';

const ASSET_DIR = './assets/enemies/red-black-fighter/';
const MODEL_URL = `${ASSET_DIR}Meshy_AI_Create_an_ultra_reali_0722015421_texture.obj`;

let templatePromise = null;

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
  if (thrusters) addThrusters(instance);
  return instance;
}

export function preloadEnemyFighterModel() {
  return loadTemplate();
}
