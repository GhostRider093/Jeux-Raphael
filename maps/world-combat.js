import * as THREE from 'three';
import { createEnemyFighterModel, preloadEnemyFighterModel } from './enemy-fighter-model.js?v=white-halo-20260722';

preloadEnemyFighterModel().catch(() => {});

const LOCK_SEARCH_DELAY = .85;
const LOCK_ACQUIRE_TIME = 3.6;
const LOCK_CAPTURE_RADIUS = 60;
const LOCK_RELEASE_RADIUS = 92;
const BULLET_SPEED = 560;
const AIM_DISTANCE = 1800;

function aimVerticalRatio() {
  return innerWidth <= 720 ? .48 : .44;
}

function segmentDistance(point, start, end) {
  const line = end.clone().sub(start);
  const lengthSq = line.lengthSq();
  if (lengthSq < .0001) return point.distanceTo(start);
  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(line) / lengthSq, 0, 1);
  return point.distanceTo(start.clone().addScaledVector(line, t));
}

function buildEnemyJet() {
  const group = new THREE.Group();
  const red = new THREE.MeshStandardMaterial({ color: 0x8f1818, emissive: 0x350303, emissiveIntensity: .5, roughness: .48, metalness: .38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: .54, metalness: .46 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xff765b, emissive: 0x691405, emissiveIntensity: 1.1, transparent: true, opacity: .72 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.85, .58, 7.8, 16), red);
  body.rotation.x = Math.PI / 2;
  group.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(.86, 2.5, 16), red);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -5.12;
  group.add(nose);
  const wings = new THREE.Mesh(new THREE.BoxGeometry(8.6, .22, 2.2), red);
  wings.position.z = -.3;
  group.add(wings);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(3.3, .18, 1.5), dark);
  tail.position.z = 3.25;
  group.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(.25, 1.9, 1.05), red);
  fin.position.set(0, .92, 3.4);
  group.add(fin);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(.78, 14, 9), glass);
  cockpit.scale.set(.8, .42, 1.25);
  cockpit.position.set(0, .62, -2.1);
  group.add(cockpit);
  [-.46, .46].forEach(x => {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(.38, .48, 1.45, 12), dark);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(x, -.12, 3.75);
    group.add(engine);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(.28, 2.2, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff3c16, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, -.12, 5.55);
    group.add(flame);
    group.userData.flames ||= [];
    group.userData.flames.push(flame);
  });
  group.scale.setScalar(1.25);
  group.traverse(node => { if (node.isMesh) node.castShadow = true; });
  return group;
}

function createAudioSystem(audioStateElement) {
  let context = null;
  let radarBeepBuffer = null;
  let nextAcquireBeep = 0;
  let lockOscillator = null;
  let lockGain = null;

  function ensure() {
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      fetch('./assets/audio/radar-beep.ogg')
        .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`Radar beep ${response.status}`)))
        .then(data => context.decodeAudioData(data))
        .then(buffer => { radarBeepBuffer = buffer; })
        .catch(error => console.warn('[world-combat] radar beep', error));
    }
    const renderState = () => {
      if (audioStateElement) audioStateElement.textContent = context.state === 'running'
        ? 'Son : moteur chasseur et combat actifs'
        : 'Son : prêt · touchez une commande';
    };
    if (context.state === 'suspended') context.resume().then(renderState).catch(renderState);
    renderState();
    return context;
  }

  // Le vrai moteur est gere par fighter-engine-audio.js.
  function updateEngine() {}

  function radarBeep(delay = 0, playbackRate = 1, volume = .18) {
    const c = ensure();
    if (!c || !radarBeepBuffer) return;
    const source = c.createBufferSource();
    const gain = c.createGain();
    source.buffer = radarBeepBuffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(c.destination);
    source.start(c.currentTime + delay);
  }

  function noise(duration, volume, cutoff, tone = 0) {
    const c = ensure();
    if (!c) return;
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * duration), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / c.sampleRate;
      data[i] = (Math.random() * 2 - 1) * Math.exp(-t * (5 / Math.max(.1, duration))) + (tone ? Math.sin(t * Math.PI * 2 * tone) * Math.exp(-t * 5) : 0);
    }
    const source = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.value = volume;
    source.buffer = buffer;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(c.destination);
    source.start();
  }

  function gun() {
    if (window.RaphaelFighterCannon) window.RaphaelFighterCannon.fireShot();
    else noise(.085, .48, 1500, 78);
  }
  function missile() {
    if (window.RaphaelMissileAudio) window.RaphaelMissileAudio.playLaunch();
    else noise(1.05, .55, 1900, 115);
  }
  function explosion() {
    if (window.RaphaelMissileAudio) window.RaphaelMissileAudio.playDestruction();
    else noise(.9, .78, 850, 48);
  }
  function lock() {
    setLockContinuous(true);
  }

  function setLockContinuous(active) {
    if (!active) {
      if (lockGain && context) lockGain.gain.setTargetAtTime(.0001, context.currentTime, .025);
      if (lockOscillator && context) {
        const oscillator = lockOscillator;
        oscillator.stop(context.currentTime + .14);
      }
      lockOscillator = null;
      lockGain = null;
      return;
    }
    if (lockOscillator) return;
    const c = ensure();
    if (!c) return;
    lockOscillator = c.createOscillator();
    lockGain = c.createGain();
    lockOscillator.type = 'square';
    lockOscillator.frequency.value = 1080;
    lockGain.gain.setValueAtTime(.0001, c.currentTime);
    lockGain.gain.exponentialRampToValueAtTime(.032, c.currentTime + .08);
    lockOscillator.connect(lockGain);
    lockGain.connect(c.destination);
    lockOscillator.start();
  }

  function acquire(progress) {
    const c = ensure();
    if (!c || c.currentTime < nextAcquireBeep) return;
    const normalized = THREE.MathUtils.clamp(progress, 0, 1);
    nextAcquireBeep = c.currentTime + THREE.MathUtils.lerp(.42, .13, normalized);
    radarBeep(0, .82 + normalized * .38, .14 + normalized * .07);
  }

  document.addEventListener('keydown', ensure, { passive: true });
  document.addEventListener('pointerdown', ensure, { passive: true });
  return { ensure, updateEngine, gun, missile, explosion, lock, acquire, setLockContinuous, isActive: () => !!context };
}

export function createWorldCombat({ scene, camera, player, world, mode, getHeight, getForward, getSpeed }) {
  const ui = document.getElementById('combat-ui');
  const combatButtons = Array.from(document.querySelectorAll('[data-world-touch="fire"],[data-world-touch="missile"]'));
  if (mode.type !== 'flight' || world.combat === false) {
    ui.hidden = true;
    combatButtons.forEach(button => { button.hidden = true; });
    return {
      active: false,
      update() {},
      diagnostics: {
        active: false,
        state: () => ({ locked: false, targetDistance: 0, hp: 0, alive: false, kills: 0, score: 0 })
      }
    };
  }

  ui.hidden = false;
  combatButtons.forEach(button => { button.hidden = false; });
  const reticle = document.getElementById('flight-reticle');
  const reticleRange = document.getElementById('reticle-range');
  const aimLead = document.getElementById('aim-lead');
  const diamond = document.getElementById('target-diamond');
  const seekerDiamond = document.getElementById('missile-seeker-diamond');
  const radarTarget = document.getElementById('radar-target');
  const lockState = document.getElementById('combat-lock-state');
  const distanceState = document.getElementById('combat-distance');
  const ammoState = document.getElementById('combat-ammo');
  const missileRackState = document.getElementById('missile-rack-status');
  const missileButton = document.querySelector('[data-world-touch="missile"]');
  const healthFill = document.getElementById('target-health-fill');
  const scoreState = document.getElementById('combat-score');
  const audio = createAudioSystem(document.getElementById('combat-audio-state'));

  const enemy = {
    mesh: new THREE.Group(), hp: 100, maxHp: 100, alive: true,
    radius: 11.5, phase: 0, holdUntil: 0, velocity: new THREE.Vector3()
  };
  const initialZ = world.spawn.air[2] - 540;
  enemy.mesh.position.set(world.spawn.air[0], world.spawn.air[1] + 24, initialZ);
  scene.add(enemy.mesh);
  const ready = createEnemyFighterModel({ targetLength: 20, thrusters: true }).then(model => {
    enemy.mesh.clear();
    enemy.mesh.add(model);
    enemy.mesh.userData.flames = model.userData.flames || [];
    document.body.dataset.enemyFighterModel = 'loaded';
  }).catch(error => {
    document.body.dataset.enemyFighterModel = 'error';
    console.warn('[world-combat] modele ennemi rouge et noir non charge', error);
  });

  const bullets = [];
  const missiles = [];
  const missileSmoke = [];
  const explosions = [];
  let locked = false;
  let lockProgress = 0;
  let lockSearchHold = 0;
  let lockAnnounced = false;
  let forcedLockUntil = 0;
  let deniedUntil = 0;
  let gunCooldown = 0;
  let previousMissile = false;
  const targetKillCount = 10;
  let kills = 0;
  const missilesLeft = Infinity;
  let score = 0;

  const bulletGeometry = new THREE.CylinderGeometry(.18, .27, 8.5, 8);
  bulletGeometry.rotateX(Math.PI / 2);
  const bulletMaterial = new THREE.MeshBasicMaterial({
    color: 0xffed63,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false
  });

  function targetPoint() { return enemy.mesh.position.clone(); }

  function getAimDirection() {
    const ndcY = 1 - aimVerticalRatio() * 2;
    const throughScope = new THREE.Vector3(0, ndcY, .42).unproject(camera);
    const cameraRay = throughScope.sub(camera.position).normalize();
    const aimPoint = camera.position.clone().addScaledVector(cameraRay, AIM_DISTANCE);
    return aimPoint.sub(player.position).normalize();
  }

  function spawnExplosion(position, scale = 1) {
    audio.explosion();
    const parts = [];
    // Boule de feu multi-couches : flash blanc -> jaune -> orange -> rouge -> fumee.
    const layers = [
      { color: 0xffffff, r: 2.4 },
      { color: 0xfff2a0, r: 3.0 },
      { color: 0xff9f24, r: 3.7 },
      { color: 0xff3b16, r: 4.4 },
      { color: 0x551a0a, r: 5.2 }
    ];
    layers.forEach((layer, index) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(layer.r * scale, 14, 10),
        new THREE.MeshBasicMaterial({ color: layer.color, transparent: true, opacity: .92, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
      );
      mesh.position.copy(position).add(new THREE.Vector3((index - 2) * 2.2 * scale, (index - 1) * 1.4 * scale, (2 - index) * 1.9 * scale));
      mesh.renderOrder = 5;
      scene.add(mesh);
      parts.push(mesh);
    });
    // Onde de choc en anneau.
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(3.6 * scale, .55 * scale, 10, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
    );
    ring.position.copy(position);
    ring.lookAt(camera.position);
    ring.renderOrder = 5;
    scene.add(ring);
    parts.push(ring);
    explosions.push({ parts, life: 1.2, maxLife: 1.2 });
  }

  function destroyEnemy() {
    if (!enemy.alive) return;
    enemy.alive = false;
    enemy.hp = 0;
    spawnExplosion(targetPoint(), 3.2);
    scene.remove(enemy.mesh);
    locked = false;
    lockProgress = 0;
    lockSearchHold = 0;
    score += 100;
    kills++;
    radarTarget.style.display = 'none';
    diamond.className = '';
    seekerDiamond.className = '';
    aimLead.className = '';
    reticle.classList.remove('locked', 'acquiring', 'denied');
    lockState.className = 'ok';
    lockState.textContent = `CIBLE DÉTRUITE · ${kills}/${targetKillCount}`;
    distanceState.textContent = kills >= targetKillCount ? 'Mission aérienne accomplie' : 'Nouvel adversaire en approche';
    scoreState.textContent = `Score ${score} · chasseurs ${kills}/${targetKillCount}`;
    if (kills < targetKillCount) {
      setTimeout(() => {
        enemy.hp = enemy.maxHp;
        enemy.alive = true;
        enemy.phase = 0;
        scene.add(enemy.mesh);
        placeTargetAhead(380 + Math.random() * 90);
        lockState.className = '';
        lockState.textContent = `CONTACT ${kills + 1}/${targetKillCount} · RECHERCHE RADAR`;
      }, 1800);
    }
  }

  function damageEnemy(amount) {
    if (!enemy.alive) return;
    enemy.hp = Math.max(0, enemy.hp - amount);
    if (enemy.hp <= 0) destroyEnemy();
  }

  function fireGun() {
    if (!enemy.alive) return;
    audio.gun();
    const direction = getAimDirection();
    const muzzleForward = getForward().normalize();
    const mesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
    mesh.position.copy(player.position).addScaledVector(muzzleForward, 11);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    mesh.renderOrder = 40;
    scene.add(mesh);
    bullets.push({ mesh, velocity: direction.multiplyScalar(BULLET_SPEED), life: 2.3 });
  }

  function denyMissile() {
    deniedUntil = performance.now() + 750;
    reticle.classList.remove('denied');
    void reticle.offsetWidth;
    reticle.classList.add('denied');
    lockState.className = 'locked';
    lockState.textContent = 'MISSILE NON GUIDÉ · CIBLE NON VERROUILLÉE';
  }

  function spawnMissileSmoke(position) {
    const puff = new THREE.Mesh(
      new THREE.SphereGeometry(.45, 7, 5),
      new THREE.MeshBasicMaterial({ color: 0xd8e2e5, transparent: true, opacity: .42, depthWrite: false })
    );
    puff.position.copy(position);
    scene.add(puff);
    missileSmoke.push({ mesh: puff, life: .72, maxLife: .72 });
  }

  function addMissileFlame(body) {
    const flameGroup = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.ConeGeometry(.68, 5.4, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff5a08, transparent: true, opacity: .78, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
    );
    const core = new THREE.Mesh(
      new THREE.ConeGeometry(.38, 3.5, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2a0, transparent: true, opacity: .98, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
    );
    outer.rotation.x = core.rotation.x = -Math.PI / 2;
    flameGroup.position.z = -2.5;
    flameGroup.renderOrder = 35;
    flameGroup.add(outer, core);
    body.add(flameGroup);
    body.userData.missileFlame = flameGroup;
  }

  function fireMissile(forceGuided) {
    if (!enemy.alive) return false;
    const guided = forceGuided ?? locked;
    if (!guided) denyMissile();
    audio.missile();
    const mountedMissile = (player.userData.missileRacks || []).find(item => item.visible);
    const launchPosition = player.position.clone();
    if (mountedMissile) {
      player.updateWorldMatrix(true, true);
      mountedMissile.getWorldPosition(launchPosition);
    }
    const direction = getForward().normalize();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.2, .13, 3.8, 10), new THREE.MeshStandardMaterial({ color: 0xaeb8c4, roughness: .3, metalness: .7 }));
    body.geometry.rotateX(Math.PI / 2);
    body.position.copy(launchPosition).addScaledVector(direction, 1.5);
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    addMissileFlame(body);
    scene.add(body);
    missiles.push({ mesh: body, velocity: direction.multiplyScalar(125), life: 9, trailClock: 0, guided });
    return true;
  }

  function projectPoint(position) {
    const ndc = position.clone().project(camera);
    if (ndc.z < -1 || ndc.z > 1) return null;
    const sx = (ndc.x * .5 + .5) * innerWidth;
    const sy = (-ndc.y * .5 + .5) * innerHeight;
    return {
      sx, sy,
      screen: Math.hypot(sx - innerWidth / 2, sy - innerHeight * aimVerticalRatio()),
      distance: position.distanceTo(player.position),
      visible: Math.abs(ndc.x) < 1.25 && Math.abs(ndc.y) < 1.25
    };
  }

  function projectTarget() {
    if (!enemy.alive) return null;
    return projectPoint(targetPoint());
  }

  function updateEnemy(dt, elapsed) {
    if (!enemy.alive) return;
    enemy.phase += dt;
    if (performance.now() >= enemy.holdUntil) {
      const forward = getForward().clone().setY(0).normalize();
      const right = new THREE.Vector3(-forward.z, 0, forward.x);
      const forwardDistance = 560 + Math.sin(elapsed * .18) * 65;
      const lateralDistance = Math.sin(elapsed * .27) * Math.min(42, world.size * .035);
      const x = player.position.x + forward.x * forwardDistance + right.x * lateralDistance;
      const z = player.position.z + forward.z * forwardDistance + right.z * lateralDistance;
      const insideWorld = Math.abs(x) < world.size * .48 && Math.abs(z) < world.size * .48;
      const ground = insideWorld ? getHeight(x, z) : -999;
      const y = Math.max(ground + 55, player.position.y - 30 + Math.sin(elapsed * .34) * 12);
      const previous = enemy.mesh.position.clone();
      enemy.mesh.position.lerp(new THREE.Vector3(x, y, z), Math.min(1, dt * .9));
      const direction = enemy.mesh.position.clone().sub(previous);
      enemy.velocity.copy(direction).multiplyScalar(1 / Math.max(dt, .001));
      if (direction.lengthSq() > .0001) {
        const yaw = Math.atan2(-direction.x, -direction.z);
        enemy.mesh.rotation.set(Math.sin(elapsed * .7) * .07, yaw, Math.sin(elapsed * .45) * .22);
      }
    }
    if (performance.now() < enemy.holdUntil) enemy.velocity.multiplyScalar(Math.max(0, 1 - dt * 5));
    (enemy.mesh.userData.flames || []).forEach((flame, index) => flame.scale.setScalar(.85 + Math.sin(elapsed * 35 + index) * .08));
  }

  function updateRadar() {
    if (!enemy.alive) return;
    radarTarget.style.display = 'block';
    const offset = targetPoint().sub(player.position);
    const distance = Math.hypot(offset.x, offset.z);
    const forward = getForward().setY(0).normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const maxRange = 1200;
    const scale = Math.min(1, maxRange / Math.max(1, distance));
    const rightAmount = offset.dot(right) * scale / maxRange;
    const forwardAmount = offset.dot(forward) * scale / maxRange;
    const acquiring = lockProgress > 0 && !locked;
    const wobbleX = acquiring ? Math.sin(performance.now() * .027) * 2.8 : 0;
    const wobbleY = acquiring ? Math.cos(performance.now() * .021) * 2.2 : 0;
    radarTarget.style.left = `${50 + THREE.MathUtils.clamp(rightAmount, -.44, .44) * 100 + wobbleX}%`;
    radarTarget.style.top = `${50 - THREE.MathUtils.clamp(forwardAmount, -.44, .44) * 100 + wobbleY}%`;
  }

  function updateLock(dt) {
    if (!enemy.alive) return;
    const aim = projectTarget();
    const forced = performance.now() < forcedLockUntil;
    const insideCapture = !!(aim?.visible && aim.screen <= LOCK_CAPTURE_RADIUS);
    const retain = !!(locked && aim?.visible && aim.screen <= LOCK_RELEASE_RADIUS);
    if (forced && enemy.alive) {
      locked = true;
      lockProgress = LOCK_ACQUIRE_TIME;
    } else if (retain) {
      lockProgress = LOCK_ACQUIRE_TIME;
    } else if (insideCapture) {
      locked = false;
      lockSearchHold = Math.min(LOCK_SEARCH_DELAY, lockSearchHold + dt);
      if (lockSearchHold >= LOCK_SEARCH_DELAY) lockProgress = Math.min(LOCK_ACQUIRE_TIME, lockProgress + dt);
      if (lockProgress >= LOCK_ACQUIRE_TIME) locked = true;
    } else {
      locked = false;
      lockProgress = 0;
      lockSearchHold = 0;
    }

    if (locked && !lockAnnounced) audio.lock();
    audio.setLockContinuous(locked);
    if (insideCapture && !locked) audio.acquire(lockProgress / LOCK_ACQUIRE_TIME);
    lockAnnounced = locked;
    reticle.classList.toggle('locked', locked);
    reticle.classList.toggle('acquiring', insideCapture && !locked);
    if (performance.now() > deniedUntil) reticle.classList.remove('denied');

    diamond.className = '';
    seekerDiamond.className = '';
    aimLead.className = '';
    const overlapsMobileHud = innerWidth <= 720 && aim && aim.sx > innerWidth - 155 && aim.sy < 292;
    if (aim?.visible && aim.screen < 300 && !overlapsMobileHud) {
      const acquisitionRatio = locked ? 1 : THREE.MathUtils.clamp(lockProgress / LOCK_ACQUIRE_TIME, 0, 1);
      const searchStrength = insideCapture && !locked ? 1 - acquisitionRatio : 0;
      const phase = performance.now() * .0042;
      const orbitX = searchStrength * (Math.cos(phase) * 72 + Math.sin(phase * 2.3) * 14);
      const orbitY = searchStrength * (Math.sin(phase) * 48 + Math.cos(phase * 1.7) * 10);
      const targetX = THREE.MathUtils.clamp(aim.sx, 27, innerWidth - 27);
      const targetY = THREE.MathUtils.clamp(aim.sy, 27, innerHeight - 27);
      diamond.style.left = `${targetX}px`;
      diamond.style.top = `${targetY}px`;
      diamond.classList.add('visible');
      seekerDiamond.style.left = `${THREE.MathUtils.clamp(targetX + orbitX, 27, innerWidth - 27)}px`;
      seekerDiamond.style.top = `${THREE.MathUtils.clamp(targetY + orbitY, 27, innerHeight - 27)}px`;
      seekerDiamond.style.opacity = insideCapture || locked ? '1' : '.68';
      seekerDiamond.classList.add('visible');
    }

    if (aim?.visible && !overlapsMobileHud) {
      const travelTime = Math.min(1.35, aim.distance / BULLET_SPEED);
      const predicted = targetPoint().addScaledVector(enemy.velocity, travelTime);
      const lead = projectPoint(predicted);
      const leadOverlapsHud = innerWidth <= 720 && lead && lead.sx > innerWidth - 155 && lead.sy < 292;
      if (lead?.visible && lead.screen < 360 && !leadOverlapsHud) {
        aimLead.style.left = `${THREE.MathUtils.clamp(lead.sx, 18, innerWidth - 18)}px`;
        aimLead.style.top = `${THREE.MathUtils.clamp(lead.sy, 18, innerHeight - 18)}px`;
        aimLead.classList.add('visible');
      }
    }

    if (performance.now() < deniedUntil) {
      lockState.className = 'locked';
      lockState.textContent = 'MISSILE BLOQUÉ · ALIGNEZ LE LOSANGE';
    } else if (locked) {
      lockState.className = 'locked';
      lockState.textContent = 'TIR AUTORISÉ · AVION ENNEMI';
    } else if (insideCapture) {
      lockState.className = '';
      lockState.textContent = lockSearchHold < LOCK_SEARCH_DELAY
        ? 'RECHERCHE RADAR…'
        : `ACQUISITION ${Math.round(lockProgress / LOCK_ACQUIRE_TIME * 100)}%`;
    } else {
      lockState.className = '';
      lockState.textContent = 'ALIGNEZ LE LOSANGE';
    }
    distanceState.textContent = `Distance ${Math.round(aim?.distance || targetPoint().distanceTo(player.position))} m`;
    reticleRange.textContent = `CANON · CIBLE ${Math.round(aim?.distance || targetPoint().distanceTo(player.position))} M`;
    ammoState.textContent = `Missiles ∞ · Canon ${gunCooldown <= 0 ? 'prêt' : 'recharge'}`;
    if (missileRackState) missileRackState.textContent = 'SOUS AILES  ◆ ∞ ◆';
    if (missileButton) missileButton.textContent = 'MISSILE ∞';
    healthFill.style.transform = `scaleX(${enemy.hp / enemy.maxHp})`;
    scoreState.textContent = `Cible aérienne · PV ${enemy.hp} / ${enemy.maxHp} · Score ${score}`;
  }

  function updateProjectiles(dt) {
    for (let index = bullets.length - 1; index >= 0; index--) {
      const bullet = bullets[index];
      const previous = bullet.mesh.position.clone();
      bullet.life -= dt;
      bullet.mesh.position.addScaledVector(bullet.velocity, dt);
      const hit = enemy.alive && segmentDistance(targetPoint(), previous, bullet.mesh.position) <= enemy.radius;
      if (hit) damageEnemy(10);
      if (hit || bullet.life <= 0) {
        scene.remove(bullet.mesh);
        bullets.splice(index, 1);
      }
    }
    for (let index = missiles.length - 1; index >= 0; index--) {
      const missile = missiles[index];
      missile.life -= dt;
      missile.trailClock -= dt;
      if (missile.trailClock <= 0) {
        spawnMissileSmoke(missile.mesh.position);
        missile.trailClock = .035;
      }
      if (missile.guided && enemy.alive) {
        const desired = targetPoint().sub(missile.mesh.position).normalize();
        missile.velocity.lerp(desired.multiplyScalar(280), Math.min(1, dt * 3.5));
      }
      missile.mesh.position.addScaledVector(missile.velocity, dt);
      if (missile.velocity.lengthSq() > 1) missile.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), missile.velocity.clone().normalize());
      const flame = missile.mesh.userData.missileFlame;
      if (flame) flame.scale.set(1 + Math.sin(performance.now() * .045) * .12, 1 + Math.sin(performance.now() * .061) * .18, 1);
      const hit = missile.guided && enemy.alive && missile.mesh.position.distanceTo(targetPoint()) < enemy.radius + 2;
      if (hit) damageEnemy(100);
      if (hit || missile.life <= 0) {
      scene.remove(missile.mesh);
        missiles.splice(index, 1);
      }
    }
    for (let index = missileSmoke.length - 1; index >= 0; index--) {
      const smoke = missileSmoke[index];
      smoke.life -= dt;
      const progress = 1 - smoke.life / smoke.maxLife;
      smoke.mesh.scale.setScalar(1 + progress * 3.2);
      smoke.mesh.material.opacity = Math.max(0, .42 * (1 - progress));
      smoke.mesh.position.y += dt * 1.8;
      if (smoke.life <= 0) {
        scene.remove(smoke.mesh);
        missileSmoke.splice(index, 1);
      }
    }
    for (let index = explosions.length - 1; index >= 0; index--) {
      const explosion = explosions[index];
      explosion.life -= dt;
      const progress = 1 - explosion.life / explosion.maxLife;
      explosion.parts.forEach((part, partIndex) => {
        part.scale.setScalar(1 + progress * (2.6 + partIndex * .55));
        part.material.opacity = Math.max(0, .92 * (1 - progress * progress));
      });
      if (explosion.life <= 0) {
        explosion.parts.forEach(part => scene.remove(part));
        explosions.splice(index, 1);
      }
    }
  }

  function update(dt, elapsed, pad, keys, touch) {
    gunCooldown -= dt;
    updateEnemy(dt, elapsed);
    updateRadar();
    updateLock(dt);
    updateProjectiles(dt);
    audio.updateEngine(getSpeed());
    if (pad.fire || pad.missile || pad.boost || pad.throttle > .08) audio.ensure();

    const fireHeld = !!(keys.Space || keys.KeyF || touch.fire || pad.fire);
    if (fireHeld && gunCooldown <= 0) {
      fireGun();
      gunCooldown = .085;
    }
    const missileHeld = !!(keys.KeyG || keys.KeyM || touch.missile || pad.missile);
    if (missileHeld && !previousMissile) {
      fireMissile(locked);
    }
    previousMissile = missileHeld;
  }

  function placeTargetAhead(distance = 340) {
    if (!enemy.alive) {
      enemy.alive = true;
      enemy.hp = enemy.maxHp;
      scene.add(enemy.mesh);
    }
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    enemy.mesh.position.copy(camera.position).addScaledVector(forward.normalize(), distance);
    enemy.mesh.rotation.y = player.rotation.y;
    enemy.holdUntil = performance.now() + 12000;
    return enemy.mesh.position.toArray();
  }

  return {
    active: true,
    ready,
    update,
    diagnostics: {
      active: true,
      state: () => ({ hp: enemy.hp, alive: enemy.alive, locked, lockProgress, missileQueued: false, missilesLeft, kills, targetKillCount, mountedMissiles: (player.userData.missileRacks || []).filter(item => item.visible).length, activeMissiles: missiles.length, guidedMissiles: missiles.filter(item => item.guided).length, score, targetPosition: enemy.mesh.position.toArray(), targetDistance: enemy.mesh.position.distanceTo(player.position), bulletSpeed: BULLET_SPEED, aimVerticalRatio: aimVerticalRatio() }),
      placeTargetAhead,
      forceLock: () => { forcedLockUntil = performance.now() + 2500; locked = true; lockProgress = LOCK_ACQUIRE_TIME; return true; },
      fireMissile,
      destroyTarget: () => destroyEnemy()
    }
  };
}
