import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { WORLD_MAPS, PLAYER_MODES, getWorld, getMode, getPortalRoute } from './world-catalog.js?v=titan-race-score-20260722';
import { buildWorld, animateWorld } from './world-builder.js?v=titan-race-score-20260722';
import { createWorldCombat } from './world-combat.js?v=white-halo-20260722';

const params = new URLSearchParams(location.search);
const requestedMap = params.get('map');
const thumbnailMode = params.get('thumbnail') === '1';
let selectedMode = getMode(params.get('mode')).id;
const world = requestedMap ? getWorld(requestedMap) : null;

const catalog = document.getElementById('catalog');
const game = document.getElementById('game');
const modePicker = document.getElementById('mode-picker');
const mapGrid = document.getElementById('map-grid');
const searchInput = document.getElementById('map-search');
let originalChasseurGeometryPromise = null;

if (thumbnailMode) document.body.classList.add('world-thumbnail');

function hexColor(value) {
  return `#${Number(value).toString(16).padStart(6, '0')}`;
}

function makeWingMissile(length = 3.2) {
  const missile = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd9e2e8, roughness: .28, metalness: .62 });
  const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xb7271e, emissive: 0x320400, emissiveIntensity: .45, roughness: .42, metalness: .28 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x20272d, roughness: .48, metalness: .52 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.24, .31, length * .72, 12), bodyMaterial);
  body.rotation.x = Math.PI / 2;
  missile.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.25, length * .28, 12), bandMaterial);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -length * .5;
  missile.add(nose);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(.33, .33, length * .09, 12), bandMaterial);
  band.rotation.x = Math.PI / 2;
  band.position.z = -length * .18;
  missile.add(band);
  [-1, 1].forEach(side => {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(.9, .07, .68), darkMaterial);
    fin.position.set(0, side * .17, length * .28);
    fin.rotation.z = side > 0 ? .18 : -.18;
    missile.add(fin);
  });
  missile.traverse(node => { if (node.isMesh) node.castShadow = true; });
  missile.userData.wingMissile = true;
  return missile;
}

function renderModePicker() {
  modePicker.innerHTML = PLAYER_MODES.map(mode => `
    <button class="mode-choice ${mode.id === selectedMode ? 'active' : ''}" data-mode="${mode.id}">
      <span>${mode.icon}</span><strong>${mode.name}</strong><small>${mode.description}</small>
    </button>
  `).join('');
  modePicker.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => {
    selectedMode = button.dataset.mode;
    renderModePicker();
    renderCatalog(searchInput.value);
  }));
}

function renderCatalog(filter = '') {
  const term = filter.trim().toLowerCase();
  const worlds = WORLD_MAPS.filter(item => !term || `${item.name} ${item.category} ${item.description}`.toLowerCase().includes(term));
  mapGrid.innerHTML = worlds.map((item, index) => {
    const objectives = item.objectives.map(objective => `<li>${objective}</li>`).join('');
    return `
      <article class="map-card" style="--map-color:${hexColor(item.sky)};--map-image:url('./assets/world-previews/${item.id}.png');--delay:${Math.min(index, 10) * .035}s">
        <div class="map-visual"><span class="map-icon">${item.icon}</span><span class="map-number">${String(index + 1).padStart(2, '0')}</span></div>
        <div class="map-content">
          <div class="map-category">${item.category}</div>
          <h2>${item.name}</h2>
          <p class="map-tagline">${item.tagline}</p>
          <p>${item.description}</p>
          <ul>${objectives}</ul>
          <a class="launch-map" href="mondes.html?map=${encodeURIComponent(item.id)}&mode=${encodeURIComponent(selectedMode)}">Explorer avec ${getMode(selectedMode).name}</a>
        </div>
      </article>
    `;
  }).join('');
  document.getElementById('map-count').textContent = `${worlds.length} monde${worlds.length > 1 ? 's' : ''}`;
}

if (!world) {
  catalog.hidden = false;
  game.hidden = true;
  renderModePicker();
  renderCatalog();
  searchInput.addEventListener('input', () => renderCatalog(searchInput.value));
  window.__raphaelWorldDiagnostics = { catalogCount: WORLD_MAPS.length, ids: WORLD_MAPS.map(item => item.id) };
} else {
  catalog.hidden = true;
  game.hidden = false;
  startWorld();
}

function normalizeLoadedModel(model, targetHeight) {
  model.rotation.y = Math.PI;
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.scale.setScalar(targetHeight / Math.max(size.y, size.x, size.z, 1));
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
}

function buildJet() {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x3c4650, roughness: .42, metalness: .5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151b23, roughness: .55, metalness: .3 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x63cfff, emissive: 0x0a4668, emissiveIntensity: .7, transparent: true, opacity: .72, roughness: .1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.05, .7, 10, 18), metal);
  body.rotation.x = Math.PI / 2; group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.05, 3.2, 18), metal);
  nose.rotation.x = -Math.PI / 2; nose.position.z = -6.55; group.add(nose);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 10), glass);
  cockpit.scale.set(.85, .45, 1.35); cockpit.position.set(0, .82, -2.7); group.add(cockpit);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(10.5, .25, 2.8), metal);
  wings.position.z = -.3; group.add(wings);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(4.2, .2, 2.1), metal);
  tail.position.z = 4.1; group.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(.28, 2.5, 1.2), metal);
  fin.position.set(0, 1.15, 4.25); group.add(fin);
  [-.62, .62].forEach(x => {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(.55, .65, 2.2, 14), dark);
    engine.rotation.x = Math.PI / 2; engine.position.set(x, -.2, 4.65); group.add(engine);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(.4, 3.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a16, transparent: true, opacity: .72, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.x = Math.PI / 2; flame.position.set(x, -.2, 6.9); group.add(flame);
    group.userData.flames ||= []; group.userData.flames.push(flame);
  });
  const missileRacks = [-3.4, -2.15, 2.15, 3.4].map((x, index) => {
    const missile = makeWingMissile(3.7);
    missile.position.set(x, -.92, index % 2 ? -.35 : .35);
    group.add(missile);
    return missile;
  });
  group.userData.missileRacks = missileRacks;
  group.scale.setScalar(1.55);
  group.traverse(node => { if (node.isMesh) node.castShadow = true; });
  return group;
}

function buildGroundPlaceholder(modeId) {
  const group = new THREE.Group();
  const color = modeId === 'robot' ? 0x4b7187 : 0x7b4f3b;
  const material = new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: modeId === 'robot' ? .42 : .05 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(modeId === 'robot' ? 2.7 : 1.2, modeId === 'robot' ? 4 : 2.2, modeId === 'robot' ? 1.8 : .8), material);
  body.position.y = modeId === 'robot' ? 3.1 : 1.9; group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(modeId === 'robot' ? 1.15 : .55, 14, 9), material);
  head.position.y = modeId === 'robot' ? 5.8 : 3.35; group.add(head);
  [-1, 1].forEach(side => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(modeId === 'robot' ? .8 : .45, modeId === 'robot' ? 2.6 : 1.7, modeId === 'robot' ? .9 : .5), material);
    leg.position.set(side * (modeId === 'robot' ? .8 : .35), modeId === 'robot' ? 1.3 : .85, 0); group.add(leg);
  });
  group.userData.placeholder = true;
  return group;
}

function parseOriginalChasseurObj(text) {
  const positions = [];
  const indices = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('v ')) {
      const parts = line.trim().split(/\s+/);
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (line.startsWith('f ')) {
      const parts = line.trim().split(/\s+/).slice(1);
      if (parts.length < 3) continue;
      const face = parts.map(part => {
        const raw = part.split('/')[0];
        const value = Number.parseInt(raw, 10);
        if (!Number.isFinite(value)) return -1;
        return value > 0 ? value - 1 : positions.length / 3 + value;
      }).filter(index => index >= 0);
      for (let i = 1; i < face.length - 1; i++) indices.push(face[0], face[i], face[i + 1]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}

function getOriginalChasseurGeometry() {
  if (!originalChasseurGeometryPromise) {
    originalChasseurGeometryPromise = fetch('./perso/chasseur.obj?v=mondes-chasseur-original-20260718', { cache: 'no-store' })
      .then(response => {
        if (!response.ok) throw new Error(`OBJ chasseur introuvable : ${response.status}`);
        return response.text();
      })
      .then(parseOriginalChasseurObj);
  }
  return originalChasseurGeometryPromise;
}

function fitOriginalChasseur(root, targetSize = 16.5) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  root.scale.setScalar(targetSize / maxAxis);
  root.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(root);
  const center = fitted.getCenter(new THREE.Vector3());
  root.position.sub(center);
}

function makeOriginalThruster(length, radius) {
  const group = new THREE.Group();
  [[radius, length, 0xff6a10, .5], [radius * .6, length * .78, 0xffae2e, .7], [radius * .3, length * .5, 0xfff3b0, .95]].forEach(([r, h, color, opacity]) => {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 18, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = h / 2;
    group.add(flame);
  });
  return group;
}

async function loadOriginalChasseurInto(player) {
  const geometry = await getOriginalChasseurGeometry();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x3a4147, roughness: .55, metalness: .35 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.rotation.set(0, -Math.PI / 2, 0);
  const wrapper = new THREE.Group();
  wrapper.add(mesh);
  fitOriginalChasseur(wrapper);
  wrapper.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(wrapper);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const rearZ = box.max.z;
  const length = Math.min(4.8, size.z * .34);
  const radius = Math.min(.58, Math.max(.2, size.y * .18));
  const spread = size.x * .13;
  const y = center.y - size.y * .05;
  const thrusters = [-spread, spread].map(x => {
    const flame = makeOriginalThruster(length, radius);
    flame.position.set(center.x + x, y, rearZ - size.z * .02);
    return flame;
  });
  const rackSpread = Math.max(2.1, size.x * .3);
  const innerSpread = Math.max(1.25, size.x * .19);
  const missileLength = THREE.MathUtils.clamp(size.z * .28, 3.6, 4.8);
  const missileY = box.min.y - .22;
  const missileZ = center.z - size.z * .05;
  const missileRacks = [-rackSpread, -innerSpread, innerSpread, rackSpread].map((x, index) => {
    const missile = makeWingMissile(missileLength);
    missile.position.set(center.x + x, missileY, missileZ + (index % 2 ? -.2 : .28));
    return missile;
  });

  player.clear();
  player.add(wrapper, ...thrusters, ...missileRacks);
  player.userData.flames = thrusters;
  player.userData.missileRacks = missileRacks;
  player.userData.originalChasseur = wrapper;
  return wrapper;
}

async function loadGroundCharacter(modeId, player, mixers) {
  const modelUrl = modeId === 'robot'
    ? './perso/Meshy_AI_Azure_Titan_biped/Meshy_AI_Azure_Titan_biped_Meshy_AI_Meshy_Merged_Animations.glb'
    : './perso/Meshy_AI_Pinstripe_Shadows/Meshy_AI_Pinstripe_Shadows_rigged_animations.glb';
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  // Proportions proches des modes historiques de Raphael : le robot reste
  // imposant sans masquer l'écran d'un téléphone.
  normalizeLoadedModel(gltf.scene, modeId === 'robot' ? 3.4 : 2.6);
  player.clear();
  player.add(gltf.scene);
  if (gltf.animations?.length) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const preferred = gltf.animations.find(clip => /walk|run|jog/i.test(clip.name)) || gltf.animations[0];
    const action = mixer.clipAction(preferred);
    action.play();
    mixers.push({ mixer, action });
  }
}

function deadZone(value, zone = .13) {
  if (Math.abs(value || 0) < zone) return 0;
  return Math.sign(value) * (Math.abs(value) - zone) / (1 - zone);
}

const WORLD_GAMEPAD_PROFILE_KEY = 'raphael.flightGamepadBindings.v1';
const WORLD_GAMEPAD_DEFAULTS = {
  yaw: { type: 'axis', index: 0, scale: -1 },
  pitch: { type: 'axis', index: 1, scale: 1 },
  throttle: { type: 'button', index: 7, scale: 1 },
  brake: { type: 'button', index: 6, scale: 1 },
  climb: { type: 'axis', index: 3, scale: -1 },
  boost: { type: 'button', index: 5, scale: 1 },
  loop: { type: 'button', index: 10, scale: 1 },
  fire: { type: 'button', index: 2, scale: 1 },
  missile: { type: 'button', index: 1, scale: 1 },
  view: { type: 'button', index: 3, scale: 1 },
  exit: { type: 'button', index: 9, scale: 1 }
};
let worldGamepadProfile = {};
function reloadWorldGamepadProfile() {
  try {
    worldGamepadProfile = JSON.parse(localStorage.getItem(WORLD_GAMEPAD_PROFILE_KEY) || '{}') || {};
  } catch (error) {
    worldGamepadProfile = {};
  }
  return worldGamepadProfile;
}
reloadWorldGamepadProfile();
window.addEventListener('storage', event => {
  if (event.key === WORLD_GAMEPAD_PROFILE_KEY) reloadWorldGamepadProfile();
});
window.addEventListener('focus', reloadWorldGamepadProfile);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) reloadWorldGamepadProfile();
});

function readConfiguredControl(pad, action, zone = .13) {
  const binding = worldGamepadProfile[action] || WORLD_GAMEPAD_DEFAULTS[action];
  if (!binding || !pad) return 0;
  const scale = Number.isFinite(binding.scale) ? binding.scale : 1;
  if (binding.type === 'axis') return THREE.MathUtils.clamp(deadZone(pad.axes[binding.index], zone) * scale, -1, 1);
  return THREE.MathUtils.clamp((pad.buttons[binding.index]?.value || 0) * scale, -1, 1);
}

function readGamepad() {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
  const usablePads = pads.filter(item => !/audio|headset|speaker|microphone/i.test(item.id));
  const configuredId = String(worldGamepadProfile.gamepadId || '');
  const pad = usablePads.find(item => configuredId && item.id === configuredId) || usablePads[0] || null;
  if (!pad) return { x: 0, y: 0, throttle: 0, brake: 0, climb: 0, boost: false, acro: false, jump: false, view: false, portal: false, fire: false, missile: false, name: 'Aucune manette' };
  const yaw = readConfiguredControl(pad, 'yaw');
  const pitch = readConfiguredControl(pad, 'pitch');
  const throttleBinding = worldGamepadProfile.throttle || WORLD_GAMEPAD_DEFAULTS.throttle;
  const throttleValue = readConfiguredControl(pad, 'throttle', .05);
  const throttle = throttleBinding.type === 'axis' ? (throttleValue + 1) * .5 : Math.max(0, throttleValue);
  return {
    x: -yaw, y: pitch, throttle,
    brake: Math.max(0, readConfiguredControl(pad, 'brake', .05)),
    climb: readConfiguredControl(pad, 'climb', .18),
    boost: readConfiguredControl(pad, 'boost', .08) > .55,
    acro: readConfiguredControl(pad, 'loop', .08) > .55,
    jump: !!pad.buttons[0]?.pressed,
    fire: readConfiguredControl(pad, 'fire', .08) > .55,
    missile: readConfiguredControl(pad, 'missile', .08) > .55,
    view: readConfiguredControl(pad, 'view', .08) > .55,
    exit: readConfiguredControl(pad, 'exit', .08) > .55,
    portal: !!pad.buttons[4]?.pressed,
    name: pad.id.replace(/\s*\(.*?Vendor.*?\)/i, '').slice(0, 30)
  };
}

async function startWorld() {
  const wrap = document.getElementById('world-canvas');
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.35 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  wrap.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .2, 4200);
  const status = document.getElementById('asset-status');
  const mode = getMode(selectedMode);
  document.body.classList.toggle('world-flight-active', mode.type === 'flight');
  let assetMessage = 'Préparation des objets 3D…';
  let pilotMessage = mode.type === 'flight' ? 'chargement du chasseur original…' : 'chargement du personnage…';
  const renderLoadStatus = () => { status.textContent = `${assetMessage} · ${pilotMessage}`; };
  const portalRoute = getPortalRoute(world.id);
  const built = buildWorld(scene, world, message => { assetMessage = message; renderLoadStatus(); }, portalRoute);
  const player = mode.type === 'flight' ? buildJet() : buildGroundPlaceholder(mode.id);
  const spawn = mode.type === 'flight' ? world.spawn.air : world.spawn.ground;
  const spawnX = spawn[0], spawnZ = spawn[2];
  player.position.set(spawnX, mode.type === 'flight' ? spawn[1] : built.getHeight(spawnX, spawnZ), spawnZ);
  if (params.get('portalPreview') === '1' && built.portal) {
    const portalData = built.portal.userData.portal;
    const previewZ = built.portal.position.z + 95;
    player.position.set(
      built.portal.position.x,
      mode.type === 'flight' ? portalData.centerY : built.getHeight(built.portal.position.x, previewZ),
      previewZ
    );
    player.rotation.y = 0;
  }
  scene.add(player);
  const mixers = [];
  let pilotPromise;
  if (mode.type === 'flight') {
    pilotPromise = loadOriginalChasseurInto(player).then(() => {
      pilotMessage = 'chasseur original prêt';
      renderLoadStatus();
    }).catch(error => {
      console.warn('[mondes] chasseur original non chargé', error);
      pilotMessage = 'chasseur simplifié actif';
      renderLoadStatus();
    });
  } else {
    pilotPromise = loadGroundCharacter(mode.id, player, mixers).then(() => {
      pilotMessage = 'personnage prêt';
      renderLoadStatus();
    }).catch(error => {
      console.warn('[mondes] personnage 3D non chargé', error);
      pilotMessage = 'modèle simplifié actif';
      renderLoadStatus();
    });
  }

  document.getElementById('world-title').textContent = `${world.icon} ${world.name}`;
  document.getElementById('world-category').textContent = world.category;
  document.getElementById('mode-name').textContent = mode.name;
  document.getElementById('mission-title').textContent = world.mission;
  document.getElementById('mission-list').innerHTML = world.objectives.map(item => `<li>${item}</li>`).join('')
    + (mode.type === 'flight' && world.combat !== false ? '<li>Abattre 10 chasseurs ennemis au radar</li><li>Missiles illimités</li>' : '')
    + `<li>Traverser le portail vers ${portalRoute.destination.name}</li>`;
  document.getElementById('back-catalog').href = `mondes.html?mode=${mode.id}`;
  const portalStatus = document.getElementById('portal-status');
  portalStatus.textContent = `Portail → ${portalRoute.destination.name}`;

  const keys = {};
  const touch = { x: 0, y: 0, boost: false, acro: false, jump: false, portal: false, fire: false, missile: false };
  const motion = { enabled: false, x: 0, y: 0, neutralBeta: 0, neutralGamma: 0, hasSample: false };
  // Tous les points de départ sont placés au sud de la zone jouable : le pilote
  // doit donc regarder vers le centre de la carte au lancement.
  let yaw = 0, pitch = mode.type === 'flight' ? .12 : 0, flightVisualPitch = pitch, speed = mode.type === 'flight' ? 72 : 0, verticalVelocity = 0, cameraWide = mode.type === 'flight', cockpitView = false, lastView = false;
  let launchSequence = mode.type === 'flight' ? 4.2 : 0;
  let aerobatic = null, aerobaticArmed = true;
  const clock = new THREE.Clock();
  const cycleCameraView = () => {
    if (mode.type !== 'flight') {
      cameraWide = !cameraWide;
      return;
    }
    if (cockpitView) {
      cockpitView = false;
      cameraWide = true;
    } else if (cameraWide) {
      cameraWide = false;
    } else {
      cockpitView = true;
    }
    document.body.classList.toggle('world-cockpit-view', cockpitView);
  };
  const cameraForward = new THREE.Vector3(0, 0, -1);
  const getFlightForward = () => {
    const cp = Math.cos(pitch);
    return new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
  };
  const combat = createWorldCombat({
    scene, camera, player, world, mode,
    getHeight: built.getHeight,
    getForward: getFlightForward,
    getSpeed: () => speed
  });
  const speedTapeMarks = document.getElementById('speed-tape-marks');
  const altitudeTapeMarks = document.getElementById('altitude-tape-marks');
  const speedValue = document.getElementById('speed-value');
  const altitudeValue = document.getElementById('altitude-value');
  const flightHeading = document.getElementById('flight-heading');
  const flightLock = document.getElementById('flight-lock');
  const flightTargetRange = document.getElementById('flight-target-range');
  const makeTapeMarks = element => {
    if (!element) return [];
    return Array.from({ length: 9 }, (_, index) => {
      const mark = document.createElement('div');
      const label = document.createElement('span');
      mark.className = 'flight-tape-mark';
      mark.style.top = `${index * 12.5}%`;
      mark.appendChild(label);
      element.appendChild(mark);
      return label;
    });
  };
  const speedMarks = makeTapeMarks(speedTapeMarks);
  const altitudeMarks = makeTapeMarks(altitudeTapeMarks);
  const updateTape = (element, labels, value, step) => {
    const base = Math.round(value / step) * step;
    labels.forEach((label, index) => {
      label.textContent = Math.max(0, base + (index - 4) * step);
    });
    element.style.transform = `translateY(${((value - base) / step) * 12.5}%)`;
  };

  const mobileLayout = window.matchMedia('(max-width: 900px), (pointer: coarse)').matches;
  if (mobileLayout) {
    const game = document.getElementById('game');
    const infoDrawer = document.getElementById('mobile-info-drawer');
    const infoToggle = document.getElementById('mobile-info-toggle');
    ['game-hud', 'mission-panel'].forEach(id => {
      const panel = document.getElementById(id);
      if (panel) infoDrawer.appendChild(panel);
    });
    const setInfoOpen = open => {
      game.classList.toggle('mobile-info-open', open);
      infoDrawer.setAttribute('aria-hidden', String(!open));
      infoToggle.setAttribute('aria-expanded', String(open));
      infoToggle.textContent = open ? 'INFOS −' : 'INFOS +';
    };
    infoToggle.addEventListener('click', event => {
      event.preventDefault();
      setInfoOpen(!game.classList.contains('mobile-info-open'));
    });
    setInfoOpen(false);

    const fullscreenToggle = document.getElementById('fullscreen-toggle');
    const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement;
    const renderFullscreenButton = () => {
      const active = !!fullscreenElement();
      fullscreenToggle.classList.toggle('active', active);
      fullscreenToggle.textContent = active ? 'QUITTER ÉCRAN' : 'PLEIN ÉCRAN';
    };
    fullscreenToggle.addEventListener('click', async event => {
      event.preventDefault();
      try {
        if (fullscreenElement()) {
          const exit = document.exitFullscreen || document.webkitExitFullscreen;
          if (exit) await exit.call(document);
        } else {
          const root = document.documentElement;
          const request = root.requestFullscreen || root.webkitRequestFullscreen;
          if (!request) throw new Error('indisponible');
          await request.call(root, { navigationUI: 'hide' });
        }
      } catch {
        fullscreenToggle.textContent = 'PLEIN ÉCRAN INDISPO';
        window.setTimeout(renderFullscreenButton, 1600);
        return;
      }
      renderFullscreenButton();
    });
    document.addEventListener('fullscreenchange', renderFullscreenButton);
    document.addEventListener('webkitfullscreenchange', renderFullscreenButton);
    renderFullscreenButton();
  }

  const raceGates = built.raceGates || [];
  const raceEnabled = mode.type === 'flight' && raceGates.length > 0;
  const racePanel = document.getElementById('race-panel');
  const raceGateText = document.getElementById('race-gate');
  const raceTimeLabel = document.getElementById('race-time-label');
  const raceTimeText = document.getElementById('race-time');
  const raceBestText = document.getElementById('race-best');
  const raceScoreText = document.getElementById('race-score');
  const raceRadarArrow = document.getElementById('race-radar-arrow');
  const raceRadarDistance = document.getElementById('race-radar-distance');
  const raceAward = document.getElementById('race-award');
  const raceStorageKey = `raphael.race.best.${world.id}`;
  const raceTimeLimit = 210;
  let raceIndex = 0;
  let raceStartElapsed = null;
  let raceElapsed = 0;
  let raceFinished = false;
  let raceScore = 0;
  let raceLastPlaneSide = null;
  let raceBest = null;
  try {
    const stored = Number(localStorage.getItem(raceStorageKey));
    if (Number.isFinite(stored) && stored > 0) raceBest = stored;
  } catch {}

  const formatRaceTime = seconds => {
    const safe = Math.max(0, seconds || 0);
    const minutes = Math.floor(safe / 60);
    const remaining = safe - minutes * 60;
    return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(3).padStart(6, '0')}`;
  };

  function showRaceAward(passed) {
    if (!raceAward) return;
    raceAward.textContent = passed ? '+50 POINTS' : '−20 POINTS';
    raceAward.classList.remove('show', 'missed');
    if (!passed) raceAward.classList.add('missed');
    void raceAward.offsetWidth;
    raceAward.classList.add('show');
  }

  function updateRaceRadar(gate) {
    if (!gate || !raceRadarArrow || !raceRadarDistance) return;
    const dx = gate.position.x - player.position.x;
    const dz = gate.position.z - player.position.z;
    const targetYaw = Math.atan2(-dx, -dz);
    const relativeAngle = THREE.MathUtils.radToDeg(targetYaw - yaw);
    raceRadarArrow.style.transform = `translate(-50%,-88%) rotate(${relativeAngle}deg)`;
    raceRadarDistance.textContent = `PROCHAIN POINT · ${Math.round(Math.hypot(dx, dz))} m`;
  }

  function refreshRaceGates() {
    raceGates.forEach((gate, index) => {
      const data = gate.userData.raceGate;
      const isCurrent = !raceFinished && index === raceIndex;
      const isPassed = data.passed;
      const isMissed = data.missed;
      const color = isPassed ? 0xffc928 : isMissed ? 0x8f1d2c : isCurrent ? 0xa52cff : 0x30233f;
      const intensity = isPassed ? 2.2 : isMissed ? .8 : isCurrent ? 3.15 : .35;
      data.material.color.setHex(color);
      data.material.emissive.setHex(color);
      data.material.emissiveIntensity = intensity;
      data.markerMaterial.color.setHex(color);
      data.markerMaterial.opacity = isCurrent || isPassed ? .82 : .22;
      data.beacon.color.setHex(color);
      data.beacon.intensity = isCurrent ? 38 : isPassed ? 22 : 5;
      gate.children[0].userData.raceGateRing.baseIntensity = intensity;
      gate.visible = true;
      gate.scale.setScalar(isCurrent ? 1.12 : 1);
    });
    if (raceScoreText) raceScoreText.textContent = raceFinished ? `TOTAL : ${raceScore} POINTS` : `SCORE : ${raceScore} POINTS`;
  }

  function completeRaceGate(elapsed, passed) {
    const gate = raceGates[raceIndex];
    if (!gate) return;
    const data = gate.userData.raceGate;
    data.passed = passed;
    data.missed = !passed;
    raceScore += passed ? 50 : -20;
    showRaceAward(passed);
    if (raceStartElapsed === null) raceStartElapsed = elapsed;
    raceIndex++;
    raceLastPlaneSide = null;
    if (raceIndex >= raceGates.length) {
      raceElapsed = elapsed - raceStartElapsed;
      raceFinished = true;
      raceGateText.textContent = 'ARRIVÉE · COURSE TERMINÉE';
      raceTimeLabel.textContent = 'TEMPS FINAL';
      raceTimeText.textContent = formatRaceTime(raceElapsed);
      if (!raceBest || raceElapsed < raceBest) {
        raceBest = raceElapsed;
        try { localStorage.setItem(raceStorageKey, String(raceBest)); } catch {}
        raceBestText.textContent = 'NOUVEAU RECORD';
      }
    }
    refreshRaceGates();
  }

  function updateRace(elapsed) {
    if (!raceEnabled) return;
    if (raceFinished) return;
    if (raceStartElapsed !== null) raceElapsed = elapsed - raceStartElapsed;
    const remaining = Math.max(0, raceTimeLimit - raceElapsed);
    raceTimeText.textContent = formatRaceTime(remaining);
    raceTimeText.style.color = remaining <= 30 ? '#ff6572' : '#b8ff76';
    raceBestText.textContent = `Record : ${raceBest ? formatRaceTime(raceBest) : '--:--.---'}`;
    const gate = raceGates[raceIndex];
    if (!gate) return;
    updateRaceRadar(gate);
    if (raceStartElapsed !== null && remaining <= 0) {
      raceFinished = true;
      raceGateText.textContent = 'TEMPS ÉCOULÉ · COURSE TERMINÉE';
      raceTimeLabel.textContent = 'TEMPS RESTANT';
      raceTimeText.textContent = '00:00.000';
      raceRadarDistance.textContent = 'COURSE TERMINÉE';
      refreshRaceGates();
      return;
    }
    raceGateText.textContent = `${raceStartElapsed === null ? 'DÉPART' : 'PORTE'} ${raceIndex + 1} / ${raceGates.length}`;
    const localPosition = gate.worldToLocal(player.position.clone());
    const distance = player.position.distanceTo(gate.position);
    if (distance <= gate.userData.raceGate.radius) {
      completeRaceGate(elapsed, true);
      return;
    }
    if (raceStartElapsed === null) return;
    const crossedPlane = raceLastPlaneSide !== null && Math.sign(localPosition.z) !== Math.sign(raceLastPlaneSide);
    const nearGate = Math.hypot(localPosition.x, localPosition.y) <= gate.userData.raceGate.radius * 2.6;
    raceLastPlaneSide = localPosition.z;
    if (crossedPlane && nearGate) completeRaceGate(elapsed, false);
  }

  racePanel.hidden = !raceEnabled;
  if (raceEnabled) {
    raceTimeText.textContent = formatRaceTime(raceTimeLimit);
    raceBestText.textContent = `Record : ${raceBest ? formatRaceTime(raceBest) : '--:--.---'}`;
    refreshRaceGates();
  }

  window.addEventListener('keydown', event => {
    keys[event.code] = true;
    if (event.code === 'Escape') location.href = `mondes.html?mode=${mode.id}`;
    if (event.code === 'KeyV') cycleCameraView();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  });
  window.addEventListener('keyup', event => { keys[event.code] = false; });

  const stick = document.getElementById('world-stick');
  const knob = document.getElementById('world-knob');
  const touchLayer = document.getElementById('world-touch');
  const stickToggle = document.getElementById('stick-toggle');
  const invertControlsToggle = document.getElementById('invert-controls-toggle');
  const motionToggle = document.getElementById('motion-toggle');
  const motionState = document.getElementById('motion-state');
  let pointerId = null;
  function moveStick(event) {
    const rect = stick.getBoundingClientRect(), max = rect.width * .34;
    const dx = THREE.MathUtils.clamp(event.clientX - rect.left - rect.width * .5, -max, max);
    const dy = THREE.MathUtils.clamp(event.clientY - rect.top - rect.height * .5, -max, max);
    touch.x = dx / max; touch.y = dy / max;
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
  function resetStick() { pointerId = null; touch.x = touch.y = 0; knob.style.transform = 'translate(-50%,-50%)'; }
  stick.addEventListener('pointerdown', event => { event.preventDefault(); pointerId = event.pointerId; stick.setPointerCapture(pointerId); moveStick(event); });
  stick.addEventListener('pointermove', event => { if (event.pointerId === pointerId) moveStick(event); });
  stick.addEventListener('pointerup', event => { if (event.pointerId === pointerId) resetStick(); });
  stick.addEventListener('pointercancel', resetStick);

  let stickVisible = true;
  let touchControlsInverted = false;
  try { stickVisible = localStorage.getItem('raphael.mobile.stick') !== 'hidden'; } catch {}
  try { touchControlsInverted = localStorage.getItem('raphael.mobile.controlsInverted') === 'true'; } catch {}
  function renderStickVisibility() {
    touchLayer.classList.toggle('stick-hidden', !stickVisible);
    stickToggle.classList.toggle('active', stickVisible);
    stickToggle.textContent = stickVisible ? 'JOYSTICK' : 'JOYSTICK +';
    if (!stickVisible) resetStick();
  }
  stickToggle.addEventListener('click', event => {
    event.preventDefault();
    stickVisible = !stickVisible;
    try { localStorage.setItem('raphael.mobile.stick', stickVisible ? 'visible' : 'hidden'); } catch {}
    renderStickVisibility();
  });
  renderStickVisibility();

  function renderTouchControlDirection() {
    invertControlsToggle.classList.toggle('inverted', touchControlsInverted);
    invertControlsToggle.textContent = touchControlsInverted ? 'COMMANDES : INVERSÉES' : 'COMMANDES : NORMALES';
    invertControlsToggle.setAttribute('aria-pressed', String(touchControlsInverted));
  }
  invertControlsToggle.addEventListener('click', event => {
    event.preventDefault();
    touchControlsInverted = !touchControlsInverted;
    touch.y = 0;
    motion.y = 0;
    try { localStorage.setItem('raphael.mobile.controlsInverted', String(touchControlsInverted)); } catch {}
    renderTouchControlDirection();
  });
  renderTouchControlDirection();

  function orientationAngle() {
    const angle = screen.orientation?.angle ?? window.orientation ?? 0;
    return ((Number(angle) % 360) + 360) % 360;
  }

  function handleDeviceOrientation(event) {
    if (!motion.enabled || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    if (!motion.hasSample) {
      motion.neutralBeta = event.beta;
      motion.neutralGamma = event.gamma;
      motion.hasSample = true;
    }
    const beta = event.beta - motion.neutralBeta;
    const gamma = event.gamma - motion.neutralGamma;
    const angle = orientationAngle();
    let horizontal = gamma, vertical = beta;
    if (angle === 90) { horizontal = beta; vertical = -gamma; }
    else if (angle === 270) { horizontal = -beta; vertical = gamma; }
    else if (angle === 180) { horizontal = -gamma; vertical = -beta; }
    const targetX = THREE.MathUtils.clamp(horizontal / 24, -1, 1);
    const targetY = THREE.MathUtils.clamp(vertical / 28, -1, 1);
    motion.x += (targetX - motion.x) * .28;
    motion.y += (targetY - motion.y) * .28;
    motionState.textContent = 'Inclinaison active';
  }
  window.addEventListener('deviceorientation', handleDeviceOrientation, { passive: true });

  async function toggleMotionControls() {
    if (motion.enabled) {
      motion.enabled = false;
      motion.x = motion.y = 0;
      motion.hasSample = false;
      motionToggle.classList.remove('active');
      motionState.textContent = 'Inclinaison inactive';
      return;
    }
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') throw new Error('permission refusée');
      }
      if (typeof DeviceOrientationEvent === 'undefined') throw new Error('capteur indisponible');
      motion.enabled = true;
      motion.hasSample = false;
      motionToggle.classList.add('active');
      motionState.textContent = 'Bougez le téléphone pour calibrer';
    } catch (error) {
      motionState.textContent = `Inclinaison : ${error.message || 'indisponible'}`;
    }
  }
  motionToggle.addEventListener('click', event => { event.preventDefault(); void toggleMotionControls(); });
  document.querySelectorAll('[data-world-touch]').forEach(button => {
    const action = button.dataset.worldTouch;
    let missileTapTimer = null;
    const set = active => {
      button.classList.toggle('active', active);
      if (action === 'boost') touch.boost = active;
      if (action === 'acro') touch.acro = active;
      if (action === 'jump') touch.jump = active;
      if (action === 'portal') touch.portal = active;
      if (action === 'fire') touch.fire = active;
      if (action === 'missile') {
        if (active) {
          touch.missile = true;
          clearTimeout(missileTapTimer);
          missileTapTimer = setTimeout(() => {
            touch.missile = false;
            button.classList.remove('active');
          }, 240);
        }
        return;
      }
      if (action === 'view' && active) cycleCameraView();
    };
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); set(true); });
    button.addEventListener('pointerup', () => set(false));
    button.addEventListener('pointercancel', () => set(false));
    button.addEventListener('lostpointercapture', () => set(false));
  });

  function updateFlight(dt, pad) {
    const yawInput = (keys.ArrowLeft || keys.KeyA || keys.KeyQ ? 1 : 0) + (keys.ArrowRight || keys.KeyD ? -1 : 0) - touch.x - motion.x - pad.x;
    const mobilePitchDirection = touchControlsInverted ? 1 : -1;
    const pitchInput = (keys.ArrowUp || keys.KeyI ? 1 : 0) + (keys.ArrowDown || keys.KeyK ? -1 : 0)
      + (touch.y + motion.y) * mobilePitchDirection + pad.y;
    const climbInput = THREE.MathUtils.clamp(
      (keys.KeyE || keys.PageUp ? 1 : 0)
      + (keys.ControlLeft || keys.ControlRight || keys.KeyC || keys.PageDown ? -1 : 0)
      + (pad.climb || 0), -1, 1
    );
    const acroHeld = !!(keys.KeyX || touch.acro || pad.acro);
    const acroAxis = Math.max(Math.abs(yawInput), Math.abs(pitchInput));
    if ((!acroHeld || acroAxis < .28) && !aerobatic) aerobaticArmed = true;
    if (acroHeld && aerobaticArmed && !aerobatic && acroAxis > .55) {
      aerobatic = Math.abs(yawInput) >= Math.abs(pitchInput)
        ? { type: 'roll', direction: Math.sign(yawInput) || 1, elapsed: 0, duration: 1.05 }
        : { type: 'loop', direction: Math.sign(pitchInput) || 1, elapsed: 0, duration: 1.55 };
      aerobaticArmed = false;
    }
    const raceTuning = world.layout === 'race-circuit';
    const cruiseSpeed = raceTuning ? 68 : 38;
    const fullSpeed = raceTuning ? 128 : 72;
    const boostSpeed = raceTuning ? 168 : 92;
    let targetSpeed = cruiseSpeed;
    if (keys.KeyW || keys.KeyZ || touch.boost) targetSpeed = fullSpeed;
    if (keys.KeyS) targetSpeed = 0;
    if (pad.throttle > .05) targetSpeed = Math.max(8, pad.throttle * fullSpeed);
    if (pad.brake > .05) targetSpeed = Math.max(0, targetSpeed * (1 - pad.brake * .9));
    if (keys.ShiftLeft || keys.ShiftRight || pad.boost) targetSpeed = boostSpeed;
    speed += (targetSpeed - speed) * Math.min(1, dt * 2.7);
    window.RaphaelFighterEngine?.update(speed / boostSpeed, targetSpeed >= boostSpeed * .9);
    yaw += THREE.MathUtils.clamp(yawInput, -1, 1) * 1.55 * dt;
    pitch = THREE.MathUtils.clamp(pitch + THREE.MathUtils.clamp(pitchInput, -1, 1) * .95 * dt, -.48, .52);
    if (launchSequence > 0) {
      launchSequence = Math.max(0, launchSequence - dt);
      pitch += (.14 - pitch) * Math.min(1, dt * 2.6);
      targetSpeed = Math.max(targetSpeed, 78);
    }
    const forward = getFlightForward();
    const verticalSpeed = forward.y * speed + climbInput * 30;
    player.position.x += forward.x * speed * dt;
    player.position.y += verticalSpeed * dt;
    player.position.z += forward.z * speed * dt;
    player.position.x = THREE.MathUtils.clamp(player.position.x, -built.bounds, built.bounds);
    player.position.z = THREE.MathUtils.clamp(player.position.z, -built.bounds, built.bounds);
    const minimum = built.getHeight(player.position.x, player.position.z) + 9;
    player.position.y = THREE.MathUtils.clamp(player.position.y, minimum, 2000);
    if (player.position.y <= minimum + .1) pitch = Math.max(0, pitch);
    let acroRoll = 0, acroPitch = 0;
    if (aerobatic) {
      aerobatic.elapsed += dt;
      const progress = THREE.MathUtils.clamp(aerobatic.elapsed / aerobatic.duration, 0, 1);
      const angle = Math.PI * 2 * progress * aerobatic.direction;
      if (aerobatic.type === 'roll') acroRoll = angle;
      else acroPitch = -angle;
      if (progress >= 1) aerobatic = null;
    }
    const horizontalSpeed = Math.max(.001, Math.hypot(forward.x * speed, forward.z * speed));
    const trajectoryPitch = THREE.MathUtils.clamp(Math.atan2(verticalSpeed, horizontalSpeed), -.62, .62);
    flightVisualPitch += (trajectoryPitch - flightVisualPitch) * Math.min(1, dt * 6.5);
    // Le modèle OBJ a son axe de tangage visuel inverse : une trajectoire
    // montante lève le nez, une trajectoire descendante le fait piquer.
    player.rotation.set(-flightVisualPitch + acroPitch, yaw, THREE.MathUtils.clamp(yawInput, -1, 1) * .45 + acroRoll);
    (player.userData.flames || []).forEach((flame, index) => flame.scale.setScalar(.75 + speed / 80 + Math.sin(performance.now() * .04 + index) * .08));
    cameraForward.lerp(forward, Math.min(1, dt * 4)).normalize();
    const speedRatio = raceTuning ? THREE.MathUtils.clamp(speed / boostSpeed, 0, 1) : 0;
    const targetFov = cockpitView ? 72 : raceTuning ? 64 + speedRatio * 18 : 64;
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 3.5);
    camera.updateProjectionMatrix();
    player.visible = !cockpitView;
    if (cockpitView) {
      const desired = player.position.clone().addScaledVector(forward, 3.2).add(new THREE.Vector3(0, 2.7, 0));
      camera.position.lerp(desired, Math.min(1, dt * 12));
      camera.up.set(0, 1, 0);
      camera.lookAt(player.position.clone().addScaledVector(forward, 90).add(new THREE.Vector3(0, 2.2, 0)));
    } else {
      const distance = cameraWide ? 112 : 61 + speedRatio * 21, height = cameraWide ? 32 : 15 + speedRatio * 4;
      const desired = player.position.clone().addScaledVector(cameraForward, -distance).add(new THREE.Vector3(0, height, 0));
      camera.position.lerp(desired, Math.min(1, dt * 5.5));
      camera.lookAt(player.position.clone().addScaledVector(forward, 43));
    }
  }

  function updateGround(dt, pad) {
    const turn = (keys.ArrowLeft || keys.KeyA || keys.KeyQ ? 1 : 0) + (keys.ArrowRight || keys.KeyD ? -1 : 0) - touch.x - motion.x - pad.x;
    const forwardInput = (keys.ArrowUp || keys.KeyW || keys.KeyZ ? 1 : 0) + (keys.ArrowDown || keys.KeyS ? -1 : 0) - touch.y - motion.y - pad.y;
    const boost = keys.ShiftLeft || keys.ShiftRight || touch.boost || pad.boost;
    const maxSpeed = mode.id === 'robot' ? (boost ? 30 : 18) : (boost ? 22 : 12);
    speed += (THREE.MathUtils.clamp(forwardInput, -1, 1) * maxSpeed - speed) * Math.min(1, dt * 6);
    yaw += THREE.MathUtils.clamp(turn, -1, 1) * (1.7 + Math.abs(speed) * .025) * dt;
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    player.position.addScaledVector(forward, speed * dt);
    player.position.x = THREE.MathUtils.clamp(player.position.x, -built.bounds, built.bounds);
    player.position.z = THREE.MathUtils.clamp(player.position.z, -built.bounds, built.bounds);
    const ground = built.getHeight(player.position.x, player.position.z);
    if ((keys.Space || touch.jump || pad.jump) && player.position.y <= ground + .12) verticalVelocity = mode.id === 'robot' ? 15 : 11;
    verticalVelocity -= 28 * dt;
    player.position.y += verticalVelocity * dt;
    if (player.position.y < ground) { player.position.y = ground; verticalVelocity = 0; }
    player.rotation.y = yaw;
    mixers.forEach(item => {
      item.action.paused = Math.abs(speed) < .25;
      item.action.timeScale = THREE.MathUtils.clamp(Math.abs(speed) / 7, .45, 1.8);
    });
    const distance = cameraWide ? 28 : mode.id === 'robot' ? 18 : 12;
    const height = cameraWide ? 14 : mode.id === 'robot' ? 9 : 6;
    const desired = player.position.clone().addScaledVector(forward, -distance).add(new THREE.Vector3(0, height, 0));
    camera.position.lerp(desired, Math.min(1, dt * 7));
    camera.lookAt(player.position.clone().add(new THREE.Vector3(0, mode.id === 'robot' ? 4 : 2.5, 0)));
  }

  function updateHud(pad) {
    const speedKmh = Math.round(Math.abs(speed) * 3.6);
    const altitude = Math.max(0, Math.round(player.position.y));
    document.getElementById('world-speed').textContent = `${speedKmh} km/h`;
    document.getElementById('world-altitude').textContent = `Altitude ${altitude} m`;
    document.getElementById('world-coordinates').textContent = `X ${Math.round(player.position.x)} · Z ${Math.round(player.position.z)}`;
    document.getElementById('world-gamepad').textContent = pad.name;
    if (mode.type === 'flight') {
      const heading = Math.round(((THREE.MathUtils.radToDeg(yaw) % 360) + 360) % 360);
      const combatState = combat.diagnostics.state();
      speedValue.textContent = String(speedKmh).padStart(3, '0');
      altitudeValue.textContent = String(altitude).padStart(3, '0');
      flightHeading.textContent = `HDG ${String(heading).padStart(3, '0')}°`;
      flightLock.textContent = combatState.locked ? 'LOCK' : 'SCAN';
      flightTargetRange.textContent = `CIBLE ${Math.round(combatState.targetDistance)} M`;
      updateTape(speedTapeMarks, speedMarks, speedKmh, 20);
      updateTape(altitudeTapeMarks, altitudeMarks, altitude, 50);
    }
  }

  const portalPrompt = document.getElementById('portal-prompt');
  const portalPromptTitle = document.getElementById('portal-prompt-title');
  const portalPromptCopy = document.getElementById('portal-prompt-copy');
  const portalProgressFill = document.getElementById('portal-progress-fill');
  const portalFlash = document.getElementById('portal-flash');
  let portalCharge = 0;
  let portalSwitching = false;

  function updatePortal(dt, pad) {
    if (!built.portal || portalSwitching) return;
    const dx = player.position.x - built.portal.position.x;
    const dz = player.position.z - built.portal.position.z;
    const horizontalDistance = Math.hypot(dx, dz);
    const portalData = built.portal.userData.portal;
    const verticalDistance = Math.abs(player.position.y - portalData.centerY);
    const inside = mode.type === 'flight'
      ? Math.hypot(horizontalDistance, verticalDistance) < portalData.activationRadius + 3
      : horizontalDistance < portalData.activationRadius;
    const manual = !!(keys.KeyE || touch.portal || pad.portal);
    const closeEnoughForManual = horizontalDistance < 70 && verticalDistance < 55;
    const charging = inside || (manual && closeEnoughForManual);
    const nearby = horizontalDistance < 135 && verticalDistance < 100;

    portalPrompt.classList.toggle('visible', nearby || charging);
    portalPromptTitle.textContent = `PORTAIL → ${portalData.destinationName}`;
    if (charging) {
      // Un chasseur en boost ne reste que quelques dixièmes de seconde dans
      // l'arche : la traversée physique doit donc verrouiller très vite.
      portalCharge = Math.min(1, portalCharge + dt * (inside ? 5.5 : 2.15));
      portalPromptCopy.textContent = inside ? 'Passage inter-monde en cours…' : 'Activation à distance…';
    } else {
      portalCharge = Math.max(0, portalCharge - dt * 1.8);
      portalPromptCopy.textContent = `${Math.round(horizontalDistance)} m · traversez la grande arche ou maintenez E / bouton portail`;
    }
    portalProgressFill.style.transform = `scaleX(${portalCharge})`;
    portalStatus.textContent = `Portail → ${portalData.destinationName} · ${Math.round(horizontalDistance)} m`;

    if (portalCharge >= 1) {
      portalSwitching = true;
      speed = 0;
      portalPromptCopy.textContent = 'TRANSPORT…';
      portalFlash.classList.add('active');
      setTimeout(() => {
        location.href = `mondes.html?map=${encodeURIComponent(portalData.destinationId)}&mode=${encodeURIComponent(mode.id)}&from=${encodeURIComponent(world.id)}`;
      }, 280);
    }
  }

  let elapsed = 0, lastExit = false;
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(.05, clock.getDelta());
    elapsed += dt;
    const pad = readGamepad();
    if (pad.exit && !lastExit) location.href = 'mondes.html';
    lastExit = pad.exit;
    const viewPressed = pad.view;
    if (viewPressed && !lastView) cycleCameraView();
    lastView = viewPressed;
    if (mode.type === 'flight') updateFlight(dt, pad); else updateGround(dt, pad);
    updateRace(elapsed);
    combat.update(dt, elapsed, pad, keys, touch);
    updatePortal(dt, pad);
    mixers.forEach(item => item.mixer.update(dt));
    animateWorld(built.root, elapsed);
    updateHud(pad);
    renderer.render(scene, camera);
  }

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 700 ? 1.35 : 2));
    renderer.setSize(innerWidth, innerHeight);
  });

  window.__raphaelWorldDiagnostics = {
    catalogCount: WORLD_MAPS.length,
    worldId: world.id,
    modeId: mode.id,
    objectCount: () => built.root.children.length,
    novaBuildings: () => ({ ...(built.root.userData.novaBuildings || {}) }),
    novaBuildingMinimumSpacing: () => built.root.userData.novaBuildingMinimumSpacing || 0,
    playerPosition: () => player.position.toArray(),
    flight: () => ({ pitch, visualPitch: flightVisualPitch, yaw, speed, rotation: player.rotation.toArray().slice(0, 3) }),
    aerobatic: () => ({ active: aerobatic?.type || null, rotation: player.rotation.toArray().slice(0, 3) }),
    portalDestination: portalRoute.destination.id,
    portalPosition: () => built.portal?.position.toArray() || null,
    combat: combat.diagnostics,
    race: () => ({
      enabled: raceEnabled,
      gate: raceIndex,
      gateCount: raceGates.length,
      running: raceStartElapsed !== null && !raceFinished,
      finished: raceFinished,
      elapsed: raceElapsed,
      remaining: Math.max(0, raceTimeLimit - raceElapsed),
      best: raceBest,
      score: raceScore
    }),
    mobile: () => ({
      stickVisible,
      motionEnabled: motion.enabled,
      motionX: motion.x,
      motionY: motion.y,
      motionCalibrated: motion.hasSample,
      controlsInverted: touchControlsInverted
    }),
    teleportToRaceGate: () => {
      const gate = raceGates[raceIndex];
      if (!gate) return null;
      player.position.copy(gate.position);
      return player.position.toArray();
    },
    teleportToPortal: () => {
      if (!built.portal) return null;
      const portalData = built.portal.userData.portal;
      player.position.set(built.portal.position.x, mode.type === 'flight' ? portalData.centerY : built.portal.position.y, built.portal.position.z + 2);
      return player.position.toArray();
    },
    teleportNearPortal: () => {
      if (!built.portal) return null;
      const portalData = built.portal.userData.portal;
      player.position.set(built.portal.position.x, mode.type === 'flight' ? portalData.centerY : built.portal.position.y, built.portal.position.z + 58);
      return player.position.toArray();
    }
  };
  const loading = document.getElementById('world-loading');
  const loadingText = document.getElementById('world-loading-text');
  try {
    loadingText.textContent = 'Chargement complet de la ville et des appareilsâ€¦';
    await Promise.all([built.assetsPromise, pilotPromise, combat.ready || Promise.resolve()]);
    assetMessage = 'Tous les objets 3D sont prÃªts';
  } catch (error) {
    console.warn('[mondes] chargement partiel', error);
    assetMessage = 'Chargement terminÃ© avec modÃ¨le de secours';
  }
  renderLoadStatus();
  renderer.render(scene, camera);
  loading.classList.add('ready');
  loading.setAttribute('aria-hidden', 'true');
  clock.start();
  animate();
}
