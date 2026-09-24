/**
 * Impact de laser sur le décor de Poilhes.
 *
 * Objectif : un point d'impact net et lisible, même à dix mètres, sans la boule de
 * feu des avions (world-explosion.js) qui ne veut rien dire sur un mur de pierre.
 *
 * Six couches, toutes en réserves préallouées (aucune allocation pendant le jeu) :
 *   1. cœur      — petit disque blanc très bref : le point touché
 *   2. halo      — bouffée cyan additive autour du cœur
 *   3. onde      — anneau fin plaqué sur la surface, qui s'ouvre
 *   4. braise    — tache orange qui refroidit : la pierre a chauffé
 *   5. éclats    — étincelles projetées, soumises à la pesanteur
 *   6. poussière — trois bouffées claires qui rampent le long du mur, puis la brûlure
 *
 * Règles apprises à l'usage :
 *   - la brûlure n'apparaît qu'APRÈS le flash, sinon elle fait un œil noir au milieu ;
 *   - la poussière reste discrète (opacité ≤ 0,25), sinon tout devient laiteux ;
 *   - la poussière s'écarte le long de la surface, elle ne monte pas en colonne ;
 *   - tout est dimensionné en mètres réels : l'effet fait environ 2 m d'envergure.
 */
import * as THREE from 'three';

const POOL = 10;              // impacts simultanés
const SPARKS = 18;            // éclats par impact

/** Dégradé radial doux (cœur opaque, bord transparent). */
function radial(inner, mid) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.45, mid);
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createImpacts({ scene }) {
  const root = new THREE.Group();
  scene.add(root);

  const white = radial('rgba(255,255,255,1)', 'rgba(210,240,255,.9)');
  const cyan = radial('rgba(180,230,255,.95)', 'rgba(70,170,255,.5)');
  const ember = radial('rgba(255,210,150,.95)', 'rgba(255,120,40,.5)');
  const dustTex = radial('rgba(220,214,200,.55)', 'rgba(190,183,170,.25)');
  const scorch = radial('rgba(20,15,11,.85)', 'rgba(45,36,28,.45)');
  const ringGeo = new THREE.RingGeometry(0.78, 1, 32);
  const discGeo = new THREE.CircleGeometry(1, 20);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARKS * 3), 3));

  const sprite = (map, color) => new THREE.Sprite(new THREE.SpriteMaterial({
    map, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));

  const slots = [];
  for (let i = 0; i < POOL; i++) {
    const group = new THREE.Group();
    group.visible = false;
    const core = sprite(white, 0xffffff);
    const halo = sprite(cyan, 0x8fd8ff);
    const glow = sprite(ember, 0xffb060);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xbfeaff, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    }));
    const burn = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({
      map: scorch, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2,
    }));
    const sparks = new THREE.Points(sparkGeo.clone(), new THREE.PointsMaterial({
      map: white, color: 0xcfeeff, size: 0.12, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    const dust = [];
    for (let k = 0; k < 3; k++) {
      dust.push(new THREE.Sprite(new THREE.SpriteMaterial({
        map: dustTex, transparent: true, depthWrite: false, opacity: 0,
      })));
      group.add(dust[k]);
    }
    const light = new THREE.PointLight(0x8fd8ff, 0, 14, 2);
    group.add(core, halo, glow, ring, burn, sparks, light);
    root.add(group);
    slots.push({
      group, core, halo, glow, ring, burn, sparks, dust, light,
      vel: new Float32Array(SPARKS * 3), drift: new Float32Array(9),
      life: 0, active: false, scale: 1,
    });
  }

  const tmp = new THREE.Vector3(), tan = new THREE.Vector3(), bit = new THREE.Vector3(), dir = new THREE.Vector3();
  const FRONT = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

  /** Déclenche un impact au point `p`, sur une surface de normale `n`. */
  function spawn(p, n, scale = 1) {
    const s = slots.find((x) => !x.active) || slots.reduce((a, b) => (a.life > b.life ? a : b));
    s.active = true;
    s.life = 0;
    s.scale = scale;
    s.group.visible = true;
    // décollé de la surface : posé dessus, l'effet serait à moitié dans le mur
    s.group.position.copy(p).addScaledVector(n, 0.1);

    tmp.copy(n).normalize();
    tan.copy(Math.abs(tmp.y) > 0.9 ? FRONT : UP).cross(tmp).normalize();   // deux axes du plan touché
    bit.copy(tmp).cross(tan).normalize();
    for (const m of [s.ring, s.burn]) {
      m.position.copy(tmp).multiplyScalar(0.03);
      m.quaternion.setFromUnitVectors(FRONT, tmp);
    }
    s.ring.visible = s.burn.visible = true;
    for (const m of [s.core, s.halo, s.glow]) m.position.set(0, 0, 0);

    // éclats : demi-sphère côté surface, vitesses inégales
    const pos = s.sparks.geometry.attributes.position;
    for (let i = 0; i < SPARKS; i++) {
      pos.array[i * 3] = pos.array[i * 3 + 1] = pos.array[i * 3 + 2] = 0;
      tmp.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      if (tmp.dot(n) < 0) tmp.reflect(n);
      const v = (2.5 + Math.random() * 5.5) * scale;
      s.vel[i * 3] = tmp.x * v;
      s.vel[i * 3 + 1] = tmp.y * v + 1.2;
      s.vel[i * 3 + 2] = tmp.z * v;
    }
    pos.needsUpdate = true;
    s.sparks.visible = true;

    // poussière : trois bouffées qui rampent le long de la surface, pas une colonne
    s.dust.forEach((d, k) => {
      const a = Math.random() * Math.PI * 2;
      dir.copy(tan).multiplyScalar(Math.cos(a)).addScaledVector(bit, Math.sin(a));
      d.position.copy(dir).multiplyScalar(0.15).addScaledVector(n, 0.15);
      s.drift[k * 3] = dir.x * (0.5 + Math.random() * 0.5);
      s.drift[k * 3 + 1] = dir.y * (0.5 + Math.random() * 0.5) + 0.25;
      s.drift[k * 3 + 2] = dir.z * (0.5 + Math.random() * 0.5);
      d.material.opacity = 0;
      d.scale.setScalar(0.25 * scale);
    });
  }

  function update(dt) {
    for (const s of slots) {
      if (!s.active) continue;
      s.life += dt;
      const t = s.life, k = s.scale;

      // 1. cœur : très bref, c'est lui qui dit « ça a touché là »
      const core = Math.max(0, 1 - t / 0.07);
      s.core.material.opacity = core;
      s.core.scale.setScalar((0.16 + 0.5 * (1 - core)) * k);
      s.core.visible = core > 0.01;

      // 2. halo cyan : un peu plus long, un peu plus large
      const halo = Math.max(0, 1 - t / 0.2);
      s.halo.material.opacity = halo * 0.75;
      s.halo.scale.setScalar((0.35 + 1.15 * (1 - halo)) * k);
      s.halo.visible = halo > 0.01;
      s.light.intensity = 22 * k * Math.max(core, halo * 0.6);

      // 3. onde : anneau fin qui s'ouvre sur la surface
      const ring = Math.max(0, 1 - t / 0.26);
      s.ring.material.opacity = ring * 0.85;
      s.ring.scale.setScalar((0.2 + 1.5 * (1 - ring)) * k);
      s.ring.visible = ring > 0.01;

      // 4. braise : la pierre chauffée refroidit en une demi-seconde
      const ember = Math.max(0, 1 - t / 0.55);
      s.glow.material.opacity = ember * ember * 0.8;
      s.glow.scale.setScalar((0.3 + 0.12 * (1 - ember)) * k);
      s.glow.visible = ember > 0.01;

      // 5. éclats : pesanteur et frottement
      const sp = Math.max(0, 1 - t / 0.65);
      if (sp > 0.01) {
        const pos = s.sparks.geometry.attributes.position;
        for (let i = 0; i < SPARKS; i++) {
          s.vel[i * 3 + 1] -= 13 * dt;
          const drag = 1 - Math.min(1, dt * 1.8);
          s.vel[i * 3] *= drag;
          s.vel[i * 3 + 1] *= drag;
          s.vel[i * 3 + 2] *= drag;
          pos.array[i * 3] += s.vel[i * 3] * dt;
          pos.array[i * 3 + 1] += s.vel[i * 3 + 1] * dt;
          pos.array[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
        }
        pos.needsUpdate = true;
        s.sparks.material.opacity = sp * sp;
        s.sparks.material.size = 0.11 * k * (0.5 + 0.5 * sp);
      } else if (s.sparks.visible) {
        s.sparks.visible = false;
      }

      // 6. poussière : discrète, elle s'écarte puis se dilue
      s.dust.forEach((d, i) => {
        const a = Math.max(0, 1 - t / 0.85);
        d.material.opacity = a * 0.25 * Math.min(1, t * 6);
        d.scale.setScalar((0.25 + 0.75 * (1 - a)) * k);
        d.position.x += s.drift[i * 3] * dt;
        d.position.y += s.drift[i * 3 + 1] * dt;
        d.position.z += s.drift[i * 3 + 2] * dt;
      });

      // brûlure : seulement une fois le flash passé, puis elle s'efface
      const burn = Math.max(0, 1 - t / 2.5);
      s.burn.material.opacity = burn * 0.5 * Math.min(1, Math.max(0, t - 0.12) * 5);
      s.burn.scale.setScalar((0.22 + 0.1 * (1 - burn)) * k);

      if (t > 2.5) {
        s.active = false;
        s.group.visible = false;
      }
    }
  }

  return { spawn, update };
}
