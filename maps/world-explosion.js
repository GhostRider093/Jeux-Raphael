import * as THREE from 'three';

/**
 * Systeme d'explosions partage par les mondes.
 *
 * Sert aussi bien la destruction d'un chasseur ennemi que le crash du pilote
 * contre un batiment. Tout est mis en pool au demarrage : une explosion ne
 * cree aucun objet, elle reveille un emplacement deja construit. Les boucles
 * de mise a jour n'allouent ni vecteur, ni tableau, ni materiau.
 *
 * Composition d'une explosion :
 *   flash -> boule de feu multi-couches -> onde de choc -> anneau au sol
 *   -> debris tournoyants -> etincelles -> fumee ascendante -> lumiere ponctuelle
 */

const MAX_ACTIVE = 5;
const DEBRIS_COUNT = 16;
const SPARK_COUNT = 26;
const SMOKE_COUNT = 7;

// `tint` dose la teinte appliquee a chaque couche. Le coeur reste neutre :
// c'est la zone la plus chaude, elle doit rester blanche quelle que soit la
// matiere qui brule. La couleur s'affirme vers l'exterieur.
const FIREBALL_LAYERS = [
  { color: 0xfff8e6, radius: 2.2, growth: 3.4, life: .52, tint: 0 },
  { color: 0xffe08a, radius: 2.9, growth: 3.9, life: .66, tint: .3 },
  { color: 0xffa02a, radius: 3.6, growth: 4.4, life: .82, tint: .58 },
  { color: 0xff4a14, radius: 4.3, growth: 4.9, life: .96, tint: .78 },
  { color: 0x8a2b0c, radius: 5.0, growth: 5.6, life: 1.15, tint: .5 }
];

// Teintes de base des elements secondaires, avant application de la teinte.
const SHOCKWAVE_COLOR = 0xffd89a;
const GROUND_RING_COLOR = 0xffb257;
const DEBRIS_EMISSIVE = 0xff5a18;
const SPARK_COLOR = 0xffd08a;
const LIGHT_COLOR = 0xff8a3c;

const TOTAL_LIFE = 2.6;

// Texture radiale generee a la volee : pas de fichier externe, un seul upload GPU.
let softTexture = null;
function getSoftTexture() {
  if (softTexture) return softTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.35, 'rgba(255,255,255,.72)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  softTexture = new THREE.CanvasTexture(canvas);
  return softTexture;
}

const easeOut = progress => 1 - Math.pow(1 - progress, 3);

export function createExplosionSystem({ scene, camera, onSound }) {
  const slots = [];
  // Objets temporaires reutilises par les mises a jour.
  const tempObject = new THREE.Object3D();
  const tempColor = new THREE.Color();
  const tintColor = new THREE.Color();
  let shake = 0;

  function buildSlot() {
    const group = new THREE.Group();
    group.name = 'explosion-slot';
    group.visible = false;
    group.matrixAutoUpdate = true;
    scene.add(group);

    // — Flash : seul element dessine par-dessus le decor, pour rester lisible
    //   meme lorsque l'impact a lieu contre une paroi.
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false })
    );
    flash.renderOrder = 12;
    group.add(flash);

    const fireball = FIREBALL_LAYERS.map(layer => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(layer.radius, 16, 12),
        new THREE.MeshBasicMaterial({ color: layer.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      mesh.renderOrder = 10;
      group.add(mesh);
      return mesh;
    });

    const shockwave = new THREE.Mesh(
      new THREE.TorusGeometry(3.2, .42, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd89a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    shockwave.renderOrder = 11;
    group.add(shockwave);

    // Anneau plaque a l'horizontale : donne l'echelle du souffle au sol.
    const groundRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.35, 44),
      new THREE.MeshBasicMaterial({ color: 0xffb257, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
    );
    groundRing.rotation.x = -Math.PI / 2;
    groundRing.renderOrder = 9;
    group.add(groundRing);

    const debris = new THREE.InstancedMesh(
      new THREE.TetrahedronGeometry(.85, 0),
      new THREE.MeshStandardMaterial({ color: 0x2b2b30, emissive: 0xff5a18, emissiveIntensity: 1.4, roughness: .7, metalness: .5 }),
      DEBRIS_COUNT
    );
    debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    debris.frustumCulled = false;
    group.add(debris);

    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_COUNT * 3), 3));
    const sparks = new THREE.Points(sparkGeometry, new THREE.PointsMaterial({
      color: 0xffd08a, size: 2.6, map: getSoftTexture(), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    }));
    sparks.frustumCulled = false;
    group.add(sparks);

    const smoke = [];
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const puff = new THREE.Sprite(new THREE.SpriteMaterial({
        map: getSoftTexture(), color: 0x2e2622, transparent: true, depthWrite: false
      }));
      group.add(puff);
      smoke.push(puff);
    }

    const light = new THREE.PointLight(0xff8a3c, 0, 220, 2);
    group.add(light);

    return {
      group, flash, fireball, shockwave, groundRing, debris, sparks, smoke, light,
      active: false,
      life: 0,
      scale: 1,
      groundOffset: 0,
      // Couleur de depart resolue de chaque couche : la couche externe est
      // assombrie au fil de la vie, il faut donc conserver sa base.
      fireballBase: FIREBALL_LAYERS.map(() => new THREE.Color()),
      debrisPosition: new Float32Array(DEBRIS_COUNT * 3),
      debrisRotation: new Float32Array(DEBRIS_COUNT * 3),
      debrisVelocity: new Float32Array(DEBRIS_COUNT * 3),
      debrisSpin: new Float32Array(DEBRIS_COUNT * 3),
      debrisScale: new Float32Array(DEBRIS_COUNT),
      sparkVelocity: new Float32Array(SPARK_COUNT * 3),
      smokeVelocity: new Float32Array(SMOKE_COUNT * 3),
      smokeSeed: new Float32Array(SMOKE_COUNT)
    };
  }

  for (let i = 0; i < MAX_ACTIVE; i++) slots.push(buildSlot());

  function pickSlot() {
    for (let i = 0; i < slots.length; i++) if (!slots[i].active) return slots[i];
    // Toutes les places sont prises : on recycle la plus avancee.
    let oldest = slots[0];
    for (let i = 1; i < slots.length; i++) if (slots[i].life > oldest.life) oldest = slots[i];
    return oldest;
  }

  /**
   * @param {THREE.Vector3} position centre du souffle.
   * @param {number} scale 1 = impact leger, 3 = destruction complete d'un appareil.
   * @param {number} groundY altitude du sol sous l'impact, pour l'anneau au sol.
   * @param {number|null} tint teinte de la matiere qui brule (chasseur ennemi
   *   rouge, beton gris…). `null` conserve la palette de feu par defaut.
   */
  function spawn(position, scale = 1, groundY = null, tint = null) {
    const slot = pickSlot();
    const tinted = tint !== null && tint !== undefined;
    if (tinted) tintColor.set(tint);
    slot.active = true;
    slot.life = 0;
    slot.scale = scale;
    slot.group.visible = true;
    slot.group.position.copy(position);
    slot.groundOffset = groundY === null ? -scale * 2.2 : Math.min(-.4, groundY - position.y + .6);

    slot.flash.scale.setScalar(scale * 3.1);
    slot.flash.material.opacity = 1;

    slot.fireball.forEach((mesh, index) => {
      // Chaque couche part legerement decalee : la boule n'est pas une sphere
      // parfaite, elle bouillonne.
      mesh.position.set(
        (index - 2) * 1.15 * scale,
        (index - 1.6) * .95 * scale,
        (1.8 - index) * 1.05 * scale
      );
      mesh.scale.setScalar(scale * .45);
      mesh.material.opacity = .95;
      const base = slot.fireballBase[index];
      base.setHex(FIREBALL_LAYERS[index].color);
      if (tinted && FIREBALL_LAYERS[index].tint) base.lerp(tintColor, FIREBALL_LAYERS[index].tint);
      mesh.material.color.copy(base);
      mesh.visible = true;
    });

    slot.shockwave.scale.setScalar(scale * .35);
    slot.shockwave.material.opacity = .9;
    slot.shockwave.material.color.setHex(SHOCKWAVE_COLOR);
    if (tinted) slot.shockwave.material.color.lerp(tintColor, .55);
    slot.shockwave.visible = true;

    slot.groundRing.position.y = slot.groundOffset;
    slot.groundRing.scale.setScalar(scale * 2);
    slot.groundRing.material.opacity = .8;
    slot.groundRing.material.color.setHex(GROUND_RING_COLOR);
    if (tinted) slot.groundRing.material.color.lerp(tintColor, .55);
    slot.groundRing.visible = true;

    for (let i = 0; i < DEBRIS_COUNT; i++) {
      // Direction repartie sur une sphere, biaisee vers le haut.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(1 - Math.random() * 1.55);
      const power = (14 + Math.random() * 26) * scale;
      slot.debrisVelocity[i * 3] = Math.sin(phi) * Math.cos(theta) * power;
      slot.debrisVelocity[i * 3 + 1] = Math.cos(phi) * power * .85 + 9 * scale;
      slot.debrisVelocity[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * power;
      slot.debrisSpin[i * 3] = (Math.random() - .5) * 13;
      slot.debrisSpin[i * 3 + 1] = (Math.random() - .5) * 13;
      slot.debrisSpin[i * 3 + 2] = (Math.random() - .5) * 13;
      slot.debrisScale[i] = (.5 + Math.random() * .9) * scale;
      slot.debrisPosition[i * 3] = 0;
      slot.debrisPosition[i * 3 + 1] = 0;
      slot.debrisPosition[i * 3 + 2] = 0;
      slot.debrisRotation[i * 3] = Math.random() * 6.28;
      slot.debrisRotation[i * 3 + 1] = Math.random() * 6.28;
      slot.debrisRotation[i * 3 + 2] = Math.random() * 6.28;
    }
    slot.debris.material.emissiveIntensity = 1.4;
    slot.debris.material.emissive.setHex(DEBRIS_EMISSIVE);
    if (tinted) slot.debris.material.emissive.lerp(tintColor, .75);
    slot.debris.visible = true;

    const sparkPositions = slot.sparks.geometry.attributes.position.array;
    for (let i = 0; i < SPARK_COUNT; i++) {
      sparkPositions[i * 3] = 0;
      sparkPositions[i * 3 + 1] = 0;
      sparkPositions[i * 3 + 2] = 0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const power = (28 + Math.random() * 62) * scale;
      slot.sparkVelocity[i * 3] = Math.sin(phi) * Math.cos(theta) * power;
      slot.sparkVelocity[i * 3 + 1] = Math.cos(phi) * power;
      slot.sparkVelocity[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * power;
    }
    slot.sparks.geometry.attributes.position.needsUpdate = true;
    slot.sparks.material.opacity = 1;
    slot.sparks.material.size = 2.4 * scale;
    slot.sparks.material.color.setHex(SPARK_COLOR);
    if (tinted) slot.sparks.material.color.lerp(tintColor, .7);
    slot.sparks.visible = true;

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const angle = (i / SMOKE_COUNT) * Math.PI * 2 + Math.random();
      const spread = (3 + Math.random() * 5) * scale;
      slot.smoke[i].position.set(Math.cos(angle) * spread, (Math.random() - .3) * 3 * scale, Math.sin(angle) * spread);
      slot.smokeVelocity[i * 3] = Math.cos(angle) * 4.5 * scale;
      slot.smokeVelocity[i * 3 + 1] = (5 + Math.random() * 6) * scale;
      slot.smokeVelocity[i * 3 + 2] = Math.sin(angle) * 4.5 * scale;
      slot.smokeSeed[i] = Math.random() * 6.28;
      slot.smoke[i].scale.setScalar(scale * 3);
      slot.smoke[i].material.opacity = 0;
      slot.smoke[i].visible = true;
    }

    slot.light.intensity = 14 * scale;
    slot.light.distance = 150 * scale;
    slot.light.color.setHex(LIGHT_COLOR);
    if (tinted) slot.light.color.lerp(tintColor, .6);

    // Secousse ponderee par la distance : un impact lointain ne remue pas l'ecran.
    const distance = camera ? camera.position.distanceTo(position) : 400;
    const proximity = Math.max(0, 1 - distance / (260 * scale));
    shake = Math.max(shake, proximity * scale * 1.7);

    onSound?.(scale);
    return slot;
  }

  function releaseSlot(slot) {
    slot.active = false;
    slot.group.visible = false;
    slot.light.intensity = 0;
  }

  function update(dt) {
    if (shake > 0) shake = Math.max(0, shake - dt * 4.2);

    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      if (!slot.active) continue;
      slot.life += dt;
      const scale = slot.scale;

      // — Flash : tres court, il ouvre l'explosion.
      const flashProgress = Math.min(1, slot.life / .16);
      slot.flash.material.opacity = 1 - flashProgress;
      slot.flash.scale.setScalar(scale * (3.1 + flashProgress * 4.5));
      slot.flash.visible = flashProgress < 1;

      // — Boule de feu : expansion rapide puis extinction.
      for (let i = 0; i < slot.fireball.length; i++) {
        const layer = FIREBALL_LAYERS[i];
        const mesh = slot.fireball[i];
        const progress = Math.min(1, slot.life / layer.life);
        if (progress >= 1) { mesh.visible = false; continue; }
        const eased = easeOut(progress);
        mesh.scale.setScalar(scale * (.45 + eased * layer.growth * .34));
        mesh.material.opacity = .95 * (1 - progress * progress);
        // La couche la plus externe vire au noir de fumee en fin de course.
        if (i === slot.fireball.length - 1) {
          tempColor.copy(slot.fireballBase[i]).multiplyScalar(1 - progress * .75);
          mesh.material.color.copy(tempColor);
        }
      }

      // — Onde de choc : anneau face camera qui s'ouvre et s'affine.
      const waveProgress = Math.min(1, slot.life / .78);
      if (waveProgress < 1) {
        const eased = easeOut(waveProgress);
        slot.shockwave.scale.set(scale * (.35 + eased * 4.6), scale * (.35 + eased * 4.6), scale * (.35 + eased * 1.2));
        slot.shockwave.material.opacity = .9 * (1 - waveProgress);
        if (camera) slot.shockwave.lookAt(camera.position);
      } else slot.shockwave.visible = false;

      // — Anneau au sol : plus lent, il marque le point d'impact.
      const ringProgress = Math.min(1, slot.life / 1.15);
      if (ringProgress < 1) {
        slot.groundRing.scale.setScalar(scale * (2 + easeOut(ringProgress) * 16));
        slot.groundRing.material.opacity = .8 * (1 - ringProgress) * (1 - ringProgress);
      } else slot.groundRing.visible = false;

      // — Debris : balistique simple avec trainee de rotation.
      const debrisProgress = Math.min(1, slot.life / 2.2);
      if (debrisProgress < 1) {
        const drag = 1 - Math.min(.6, dt * 1.1);
        for (let i = 0; i < DEBRIS_COUNT; i++) {
          const vx = i * 3, vy = vx + 1, vz = vx + 2;
          slot.debrisVelocity[vy] -= 26 * dt;
          slot.debrisVelocity[vx] *= drag;
          slot.debrisVelocity[vz] *= drag;
          slot.debrisPosition[vx] += slot.debrisVelocity[vx] * dt;
          slot.debrisPosition[vy] += slot.debrisVelocity[vy] * dt;
          slot.debrisPosition[vz] += slot.debrisVelocity[vz] * dt;
          slot.debrisRotation[vx] += slot.debrisSpin[vx] * dt;
          slot.debrisRotation[vy] += slot.debrisSpin[vy] * dt;
          slot.debrisRotation[vz] += slot.debrisSpin[vz] * dt;
          tempObject.position.set(slot.debrisPosition[vx], slot.debrisPosition[vy], slot.debrisPosition[vz]);
          tempObject.rotation.set(slot.debrisRotation[vx], slot.debrisRotation[vy], slot.debrisRotation[vz]);
          tempObject.scale.setScalar(slot.debrisScale[i] * (1 - debrisProgress * .5));
          tempObject.updateMatrix();
          slot.debris.setMatrixAt(i, tempObject.matrix);
        }
        slot.debris.instanceMatrix.needsUpdate = true;
        slot.debris.material.emissiveIntensity = 1.4 * (1 - debrisProgress);
      } else slot.debris.visible = false;

      // — Etincelles : rapides, freinees, elles disparaissent avant la fumee.
      const sparkProgress = Math.min(1, slot.life / 1.05);
      if (sparkProgress < 1) {
        const positions = slot.sparks.geometry.attributes.position.array;
        const drag = 1 - Math.min(.75, dt * 2.4);
        for (let i = 0; i < SPARK_COUNT; i++) {
          const vx = i * 3, vy = vx + 1, vz = vx + 2;
          slot.sparkVelocity[vy] -= 20 * dt;
          slot.sparkVelocity[vx] *= drag;
          slot.sparkVelocity[vy] *= drag;
          slot.sparkVelocity[vz] *= drag;
          positions[vx] += slot.sparkVelocity[vx] * dt;
          positions[vy] += slot.sparkVelocity[vy] * dt;
          positions[vz] += slot.sparkVelocity[vz] * dt;
        }
        slot.sparks.geometry.attributes.position.needsUpdate = true;
        slot.sparks.material.opacity = 1 - sparkProgress * sparkProgress;
      } else slot.sparks.visible = false;

      // — Fumee : monte, s'etale et persiste apres le feu.
      for (let i = 0; i < SMOKE_COUNT; i++) {
        const puff = slot.smoke[i];
        const vx = i * 3, vy = vx + 1, vz = vx + 2;
        slot.smokeVelocity[vy] *= 1 - Math.min(.5, dt * .5);
        puff.position.x += (slot.smokeVelocity[vx] + Math.sin(slot.life * 1.6 + slot.smokeSeed[i]) * 1.4) * dt;
        puff.position.y += slot.smokeVelocity[vy] * dt;
        puff.position.z += (slot.smokeVelocity[vz] + Math.cos(slot.life * 1.4 + slot.smokeSeed[i]) * 1.4) * dt;
        const smokeProgress = Math.min(1, slot.life / TOTAL_LIFE);
        puff.scale.setScalar(scale * (3 + smokeProgress * 9));
        // Montee rapide de l'opacite puis longue disparition.
        puff.material.opacity = smokeProgress < .18
          ? (smokeProgress / .18) * .62
          : .62 * Math.pow(1 - (smokeProgress - .18) / .82, 1.6);
      }

      // — Lumiere : flash intense qui retombe en braise.
      const lightProgress = Math.min(1, slot.life / .95);
      slot.light.intensity = 14 * scale * (1 - lightProgress) * (1 - lightProgress);

      if (slot.life >= TOTAL_LIFE) releaseSlot(slot);
    }
  }

  function dispose() {
    slots.forEach(slot => {
      scene.remove(slot.group);
      slot.group.traverse(node => {
        node.geometry?.dispose?.();
        if (Array.isArray(node.material)) node.material.forEach(material => material.dispose());
        else node.material?.dispose?.();
      });
    });
    slots.length = 0;
  }

  return {
    spawn,
    update,
    dispose,
    getShake: () => shake,
    activeCount: () => slots.reduce((total, slot) => total + (slot.active ? 1 : 0), 0)
  };
}
