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
  const makeHalo = (scale, opacity, order) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getWhiteGlowTexture(),
      color: 0x8dfcff,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    }));
    sprite.name = 'enemy-hologram-halo';
    sprite.position.y = .05;
    sprite.scale.set(scale, scale, 1);
    sprite.renderOrder = order;
    return sprite;
  };
  // Halo proche (net) + grand halo (visible de tres loin).
  instance.add(makeHalo(6, .95, 2));
  instance.add(makeHalo(13, .5, 1));
  if (thrusters) addThrusters(instance);
  return instance;
}

export function preloadEnemyFighterModel() {
  return loadTemplate();
}
