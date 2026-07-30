import * as THREE from 'three';

// ==========================================================================
//  CIBLES A ABATTRE
// --------------------------------------------------------------------------
//  Des cibles fixes posees le long d'un circuit, sans adversaire ni radar.
//
//  Volontairement independant de world-combat.js : celui-ci amene toute une
//  machinerie — IA ennemie, verrouillage, missiles, alertes — qui n'a pas lieu
//  d'etre sur une course. Le tir est ici un rayon instantane plutot qu'un
//  projectile balistique : sur une cible immobile la difference est invisible,
//  et cela evite de dupliquer le systeme de projectiles.
//
//  Aucune allocation dans la boucle : les vecteurs sont reutilises et les
//  cibles abattues sont simplement masquees.
// ==========================================================================

const FIRE_INTERVAL = .12;      // cadence, en secondes
const HIT_RADIUS_BONUS = 6;     // tolerance de visee, en unites
const MAX_RANGE = 900;

export function createTargetRange({ scene, world, player, camera, getForward, explosions, getHeight }) {
  const specs = world.targets || [];
  if (!specs.length) return { active: false, update() {}, diagnostics: () => ({ active: false }) };

  const group = new THREE.Group();
  group.name = 'shooting-targets';
  scene.add(group);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xd94f3a, emissive: 0x7a1a0c, emissiveIntensity: 1.1, roughness: .42, metalness: .35
  });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe08a, transparent: true, opacity: .9,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  });

  const targets = specs.map((spec, index) => {
    const radius = spec.radius || 11;
    const holder = new THREE.Group();
    holder.name = `target-${index + 1}`;
    const y = Number.isFinite(spec.y) ? spec.y : getHeight(spec.x, spec.z) + (spec.clearance ?? 60);
    holder.position.set(spec.x, y, spec.z);

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), bodyMaterial);
    holder.add(core);
    // Anneau lumineux : une cible rouge sur un fond de roche rouge serait
    // introuvable, l'anneau additif la detache de tous les decors.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.7, radius * .1, 8, 28), ringMaterial);
    holder.add(ring);
    holder.userData.spin = .6 + (index % 3) * .25;

    group.add(holder);
    return { holder, ring, radius, alive: true, x: spec.x, y, z: spec.z };
  });

  let cooldown = 0;
  let destroyed = 0;
  let score = 0;
  const forward = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const impact = new THREE.Vector3();

  /**
   * Tir instantane : on cherche la premiere cible dont le centre est assez
   * proche de l'axe de visee. La projection sur l'axe evite de toucher une
   * cible situee derriere le pilote.
   */
  function fire() {
    forward.copy(getForward()).normalize();
    let best = null;
    let bestDistance = Infinity;
    for (const target of targets) {
      if (!target.alive) continue;
      toTarget.set(target.x - player.position.x, target.y - player.position.y, target.z - player.position.z);
      const along = toTarget.dot(forward);
      if (along <= 0 || along > MAX_RANGE) continue;
      // Distance du centre a l'axe de visee.
      const offAxis = Math.sqrt(Math.max(0, toTarget.lengthSq() - along * along));
      if (offAxis > target.radius + HIT_RADIUS_BONUS) continue;
      if (along < bestDistance) { bestDistance = along; best = target; }
    }
    if (!best) return false;

    best.alive = false;
    best.holder.visible = false;
    destroyed++;
    score += 100;
    impact.set(best.x, best.y, best.z);
    explosions?.spawn(impact, 1.5, getHeight(best.x, best.z), 0xff6a3c);
    return true;
  }

  function update(dt, elapsed, firing) {
    cooldown -= dt;
    for (const target of targets) {
      if (!target.alive) continue;
      target.holder.rotation.y = elapsed * target.holder.userData.spin;
      // L'anneau fait face au pilote : une cible vue par la tranche
      // disparaitrait.
      if (camera) target.ring.lookAt(camera.position);
    }
    if (!firing || cooldown > 0) return;
    cooldown = FIRE_INTERVAL;
    if (fire()) window.RaphaelFighterCannon?.fireShot();
  }

  return {
    active: true,
    update,
    remaining: () => targets.filter(target => target.alive).length,
    total: targets.length,
    score: () => score,
    diagnostics: () => ({ active: true, total: targets.length, destroyed, score })
  };
}
