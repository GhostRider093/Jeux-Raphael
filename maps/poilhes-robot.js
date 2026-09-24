/**
 * Robot pilotable dans Poilhes, en vue à la troisième personne.
 *
 * Deux modèles :
 *   titan — Azure Titan biped (bleu et blanc), perso/Meshy_AI_Azure_Titan_biped/…merged.glb
 *   mech  — Mech « ISO » rouge, assets/mech/mech.glb (voir scripts/blender-mech.py)
 *
 * Déplacement à inertie : la vitesse suit la consigne avec accélération et freinage,
 * le corps pivote progressivement vers la direction, et l'animation (marche / course)
 * est choisie et cadencée d'après la vitesse réelle — pas de patinage.
 *
 * Collisions : le robot est un disque de rayon RADIUS sur la grille d'obstacles
 * (bâtiments et eau). Il glisse le long des murs, et s'il se retrouve malgré tout
 * dans un obstacle (téléportation, décor mal fermé), il est repoussé vers la sortie
 * la plus proche : on ne peut pas rester bloqué.
 *
 * Aucune allocation dans update() : vecteurs réutilisés.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { createImpacts } from './poilhes-impact.js?v=voiture-20260921';

export const MODELS = {
  titan: {
    nom: 'Titan bleu',
    url: 'perso/Meshy_AI_Azure_Titan_biped/Meshy_AI_Azure_Titan_biped_Meshy_AI_Meshy_Merged_Animations.glb',
    hauteur: 2.25,
    // vitesse (m/s) à laquelle chaque animation tourne à sa cadence naturelle
    marche: { clip: 'Walking', vitesse: 1.5 },
    course: { clip: 'Running', vitesse: 5.0 },
    saut: 'Basic_Jump',
    atterrissage: null,
  },
  mech: {
    nom: 'Mech rouge',
    url: 'assets/mech/mech.glb',
    hauteur: 3.4,
    marche: { clip: 'WalkForward', vitesse: 2.0 },
    course: { clip: 'WalkForward', vitesse: 3.4 },
    saut: null,
    atterrissage: 'Landing',
    repos: 'Idle',
  },
};

const RADIUS = 0.8;            // encombrement au sol (m)
const WALK = 2.4, RUN = 6.2;   // vitesses de consigne (m/s)
const ACCEL = 7.0, BRAKE = 12.0, TURN = 6.0;   // m/s², m/s², rad/s
// Recul et hauteur de la caméra. En portrait sur un téléphone, l'écran est
// étroit : à 18 m le robot n'est plus qu'un jouet au milieu des toits.
const PORTRAIT = matchMedia('(pointer: coarse) and (orientation: portrait)').matches;
const CAM_DIST = PORTRAIT ? 12.0 : 18.0, CAM_HEIGHT = PORTRAIT ? 2.4 : 3.0;
// Plafond de la montée le long des façades. Il valait 1,15 rad — 66 degrés :
// dans une ruelle, la caméra basculait à la verticale et le jeu devenait une
// vue de dessus où l'on ne voit plus ni ce qu'on vise ni ce qui arrive. On
// préfère désormais se rapprocher que monter.
const CAM_PITCH_MAX = PORTRAIT ? 0.48 : 0.60;
const CAM_MIN = 5.0, CAM_MAX = 40.0;       // bornes réglables à la molette
const CAM_AHEAD = 1.6;                      // on vise devant le robot, pas ses pieds
const DROP = 22;               // hauteur de largage (m)

/** Boîte englobante des sommets réellement affichés (squelette appliqué), repère du modèle. */
export function skinnedBox(model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) o.skeleton.update();
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 5) {
      if (o.isSkinnedMesh) o.getVertexPosition(i, v);
      else v.fromBufferAttribute(o.geometry.attributes.position, i);
      box.expandByPoint(v.applyMatrix4(o.matrixWorld));
    }
  });
  return box;
}

export function createRobot({ scene, camera, groundAt, walkableAt, blockedAt, surfaceAt, keys }) {
  let ennemis = null;                // branche par setEnemies() : le laser les touche avant les murs
  const root = new THREE.Group();          // position au sol
  const pivot = new THREE.Group();         // cap du corps (tourne progressivement)
  root.add(pivot);
  root.visible = false;
  scene.add(root);

  const loaded = {};                       // modèles déjà chargés, par clé
  let kit = null;                          // modèle actif : { def, group, mixer, actions }
  let current = null;
  let choice = 'titan';

  const state = { yaw: 0, bodyYaw: 0, camPitch: 0.12, dist: CAM_DIST, vy: 0, falling: false,
                  busyUntil: 0, time: 0, speed: 0, vie: 250, vieMax: 250, blesse: 0, detruit: 0,
                  verrou: false };
  const RELEVE = 4.0;            // secondes a terre avant redeploiement
  const vel = new THREE.Vector3();
  const want = new THREE.Vector3(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
  const step = new THREE.Vector3(), camWanted = new THREE.Vector3();
  const probe = new THREE.Vector3(), push = new THREE.Vector3();

  // ------------------------------------------------------------------ chargement
  async function load(key = choice) {
    if (loaded[key]) return loaded[key];
    const def = MODELS[key];
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(def.url);
    const group = gltf.scene;
    group.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
      o.frustumCulled = false;             // la boîte englobante ne suit pas l'animation
      if (o.material.emissiveMap) o.material.emissive.set(0x66fff2);
    });
    // pieds à y = 0, centré sur l'axe vertical. La boîte est mesurée sur les sommets
    // APRÈS squelette : celle de Box3.setFromObject part de la géométrie de liaison.
    const box = skinnedBox(group);
    const size = box.getSize(new THREE.Vector3());
    const k = def.hauteur / size.y;
    const c = box.getCenter(new THREE.Vector3());
    group.scale.setScalar(k);
    group.position.set(-c.x * k, -box.min.y * k, -c.z * k);

    const mixer = new THREE.AnimationMixer(group);
    const actions = {};
    for (const clip of gltf.animations) {
      // certaines animations déplacent la racine de plusieurs dizaines de mètres
      // (largage, cascade) : on garde la gestuelle, le déplacement est calculé ici.
      clip.tracks = clip.tracks.filter((t) => !/(Root_M|Hips|mixamorig:Hips)\.position$/.test(t.name));
      const a = mixer.clipAction(clip);
      if (clip.name === def.atterrissage || clip.name === def.saut) {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      actions[clip.name] = a;
    }
    // bras droit : sert à viser et à placer la bouche du canon (le Mech n'en a pas)
    const bone = (n) => group.getObjectByName(n) || null;
    const bones = bone('RightArm') && bone('RightHand')
      ? { arm: bone('RightArm'), fore: bone('RightForeArm') || bone('RightHand'), hand: bone('RightHand') }
      : null;
    loaded[key] = { def, group, mixer, actions, bones };
    return loaded[key];
  }

  /** Change de modèle (titan / mech) sans quitter le mode. */
  async function setModel(key) {
    if (!MODELS[key]) return;
    choice = key;
    const next = await load(key);
    if (kit) pivot.remove(kit.group);
    kit = next;
    current = null;
    pivot.add(kit.group);
    // Meshy et Unreal exportent le personnage tourné vers +Z : on le retourne vers l'avant (-Z)
    kit.group.rotation.y = Math.PI;
    return kit;
  }

  function play(name, fade = 0.25, timeScale = 1) {
    if (!kit) return;
    const next = name ? kit.actions[name] : null;
    if (next) next.timeScale = timeScale;
    if (current === next) return;
    if (next) {
      next.reset().play();
      if (current) current.crossFadeTo(next, fade, false);
    } else if (current) {
      current.fadeOut(fade);                   // plus d'animation : pose debout au repos
    }
    current = next;
  }

  /** Entre dans le mode robot : largage au point (x, z), cap `yaw`. */
  async function enter(x, z, yaw) {
    await setModel(choice);
    root.visible = true;
    state.yaw = state.bodyYaw = yaw;
    vel.set(0, 0, 0);
    state.speed = 0;
    const clear = freeSpot(x, z);
    root.position.set(clear.x, walkableAt(clear.x, clear.z) + DROP, clear.z);
    state.vy = 0;
    state.falling = true;
    cam.yaw = yaw;                       // la caméra démarre derrière, sans rattrapage visible
    cam.dist = cam.want = state.dist;
    cam.pitch = state.camPitch;
    cam.ready = false;
    cam.snap = true;                     // on arrive peut-être d'une vue aérienne : pas de long travelling
    play(null, 0.1);
  }

  function exit() {
    root.visible = false;
    if (camera.fov !== 55) {             // le champ élargi à la course ne suit pas les autres modes
      camera.fov = cam.fov = 55;
      camera.updateProjectionMatrix();
    }
  }

  /** Détente (clic gauche maintenu ou touche F). */
  function setTrigger(on) {
    trigger = on;
  }

  /** Molette : recule ou rapproche la caméra. */
  function zoom(delta) {
    state.dist = THREE.MathUtils.clamp(state.dist * (1 + delta * 0.0012), CAM_MIN, CAM_MAX);
  }

  /** Tourne le robot (souris / glisser). */
  function look(dx, dy) {
    state.yaw -= dx;
    state.camPitch = THREE.MathUtils.clamp(state.camPitch + dy, -0.35, 1.0);
  }

  // ------------------------------------------------------------------ canon laser
  // Le robot tend le bras droit devant lui et tire de gros traits bleus, façon Cobra.
  const BEAMS = 14, FIRE_RATE = 0.22, BEAM_LIFE = 0.11, RANGE = 140;
  const DEGATS = 34;             // trois traits sur un gobelin ordinaire, cinq sur le casseur
  const hitNormal = new THREE.Vector3();
  const beams = [];
  let blast = null;
  let beamRoot = null, muzzleLight = null;
  let nextShot = 0, aim = 0, aimUntil = 0, shake = 0, trigger = false;
  const aimDir = new THREE.Vector3(), muzzle = new THREE.Vector3(), hit = new THREE.Vector3();
  const touche = new THREE.Vector3();          // point d'impact sur un gobelin
  const camDir = new THREE.Vector3(), viseur = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

  function buildBeams() {
    if (beamRoot) return;
    beamRoot = new THREE.Group();
    scene.add(beamRoot);
    // cœur blanc-bleu + halo : un cylindre orienté sur +Z, étiré à la longueur du tir
    // cylindre centré à l'origine : on le décale pour qu'il parte de la bouche du canon
    // et aille vers l'avant, sinon la moitié du trait sort dans le dos du robot
    const core = new THREE.CylinderGeometry(0.07, 0.07, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const halo = new THREE.CylinderGeometry(0.22, 0.22, 1, 8, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    for (let i = 0; i < BEAMS; i++) {
      const g = new THREE.Group();
      g.visible = false;
      g.add(new THREE.Mesh(core, new THREE.MeshBasicMaterial({
        color: 0xdff2ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
      })));
      g.add(new THREE.Mesh(halo, new THREE.MeshBasicMaterial({
        color: 0x2ea8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
      })));
      beamRoot.add(g);
      beams.push({ g, until: 0 });
    }
    muzzleLight = new THREE.PointLight(0x4fb8ff, 0, 22, 2);
    scene.add(muzzleLight);
    // impacts : éclair, onde, étincelles, poussière et brûlure — voir poilhes-impact.js
    blast = createImpacts({ scene });
  }

  /** Premier obstacle rencontré (mur ou relief) le long du tir.

      La carte des hauteurs ne dit pas ce qu'il y a SOUS un houppier : la tester ferait
      exploser le tir dès qu'un arbre surplombe le robot. Le laser passe donc sous les arbres. */
  function trace(from, dir, out, pas = 0.5, depart = 1.5) {
    const solid = (d) => {
      const x = from.x + dir.x * d, y = from.y + dir.y * d, z = from.z + dir.z * d;
      if (groundAt(x, z) > y) return 1;          // le relief
      if (blockedAt(x, z)) return 2;             // un mur
      return 0;
    };
    for (let d = depart; d < RANGE; d += pas) {
      const kind = solid(d);
      if (!kind) continue;
      // affinage : on revient au dernier point libre, au centimètre près, sinon l'effet
      // se déclenche jusqu'à un demi-mètre DANS le mur et la façade le cache
      let lo = d - pas, hi = d;
      for (let i = 0; i < 7; i++) {
        const mid = (lo + hi) / 2;
        if (solid(mid)) hi = mid; else lo = mid;
      }
      out.set(from.x + dir.x * hi, from.y + dir.y * hi, from.z + dir.z * hi);
      if (kind === 1) hitNormal.set(0, 1, 0);
      else hitNormal.set(-dir.x, 0, -dir.z).normalize();
      return hi;
    }
    out.copy(from).addScaledVector(dir, RANGE);
    hitNormal.copy(dir).negate();
    return RANGE;
  }

  /** Oriente le bras droit vers la cible ; `w` = 0 (animation seule) à 1 (bras tendu). */
  function aimArm(w) {
    if (!kit || w < 0.01) return;
    const bones = kit.bones;
    if (!bones || !bones.arm || !bones.hand) return;
    for (const [bone, child, factor] of [[bones.arm, bones.fore, 1], [bones.fore, bones.hand, 0.85]]) {
      bone.updateMatrixWorld(true);
      child.getWorldPosition(v1);
      bone.getWorldPosition(v2);
      v3.subVectors(v1, v2);
      if (v3.lengthSq() < 1e-6) continue;
      v3.normalize();
      qa.setFromUnitVectors(v3, aimDir);
      bone.getWorldQuaternion(qb);
      qc.copy(qa).multiply(qb);                                  // orientation monde visée
      bone.parent.getWorldQuaternion(qb).invert();
      qc.premultiply(qb);                                        // repassée en local
      bone.quaternion.slerp(qc, w * factor);
      bone.updateMatrixWorld(true);
    }
  }

  /** Tire un trait ; renvoie la distance touchée. */
  function shoot() {
    buildBeams();
    const b = beams.find((x) => x.until <= state.time) || beams[0];
    gunMuzzle(muzzle);
    let len = trace(muzzle, aimDir, hit);
    // un gobelin devant le mur arrête le trait : on le blesse et l'impact se fait sur lui
    const proie = ennemis ? ennemis.raycast(muzzle, aimDir, len, touche) : null;
    if (proie && proie.gobelin) {
      len = proie.d;
      hit.copy(touche);
      hitNormal.copy(aimDir).negate();
      ennemis.blesser(proie.gobelin, DEGATS, aimDir);
    }
    b.g.position.copy(muzzle);
    b.g.lookAt(hit);
    b.g.scale.set(1, 1, len);
    b.g.visible = true;
    b.until = state.time + BEAM_LIFE;
    muzzleLight.position.copy(muzzle);
    muzzleLight.intensity = 60;
    if (blast && len < RANGE - 1) blast.spawn(hit, hitNormal, proie && proie.gobelin ? 0.7 : 1.0);
    shake = 0.16;
    vel.addScaledVector(aimDir, -1.4);                            // recul
    zap();
    return len;
  }

  /** Bruit de tir : balayage descendant, court, sans fichier son. */
  let audio = null;
  function zap() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const filter = audio.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1400, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.18);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2600, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(filter).connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    } catch { /* audio indisponible : le tir reste visuel */ }
  }

  /** Position de la bouche du canon : la main droite, ou l'avant du torse à défaut. */
  function gunMuzzle(out) {
    if (kit.bones) return kit.bones.hand.getWorldPosition(out);
    const h = kit.def.hauteur;
    return out.set(
      root.position.x - Math.sin(state.yaw) * h * 0.45,
      root.position.y + h * 0.62,
      root.position.z - Math.cos(state.yaw) * h * 0.45,
    );
  }

  /** Appuyé sur la détente (clic ou F) : vise, tire en cadence, éteint les traits. */
  function updateGun(dt, firing) {
    if (!kit) return;
    if (firing) aimUntil = state.time + 0.7;
    const wanted = state.time < aimUntil ? 1 : 0;
    aim += (wanted - aim) * Math.min(1, dt * 9);
    // Direction de tir : le viseur, au centre de l'écran.
    //
    // Le trait partait autrefois à l'horizontale depuis l'épaule : la caméra regardant
    // vers le bas, il filait au-dessus de tout et on ne voyait jamais où il allait.
    // On cherche donc ce que la caméra vise, et le trait part de la main VERS ce point :
    // les deux se rejoignent exactement sur la petite croix.
    gunMuzzle(muzzle);
    camera.getWorldDirection(camDir);
    // On part du robot et non de l'objectif : sinon le sol, touche entre les deux quand
    // la camera plonge, tirerait le point de visee sous terre et le trait piquerait
    // a quelques metres devant les pieds.
    trace(camera.position, camDir, viseur, 1.0, camera.position.distanceTo(root.position) + 1.5);
    aimDir.subVectors(viseur, muzzle);
    // garde-fou : on ne tire ni dans ses pieds ni dans le ciel
    const plat = Math.hypot(aimDir.x, aimDir.z) || 1e-6;
    aimDir.y = THREE.MathUtils.clamp(aimDir.y / plat, -0.80, 0.50) * plat;
    aimDir.normalize();
    state.verrou = !!(ennemis && ennemis.raycast(muzzle, aimDir, RANGE, null).gobelin);
    aimArm(aim);
    if (firing && state.time >= nextShot && (aim > 0.45 || !kit.bones)) {
      nextShot = state.time + FIRE_RATE;
      shoot();
    }
    if (!beamRoot) return;
    for (const b of beams) {
      if (!b.g.visible) continue;
      const left = b.until - state.time;
      if (left <= 0) { b.g.visible = false; continue; }
      const k = left / BEAM_LIFE;
      b.g.children[0].material.opacity = k;
      b.g.children[1].material.opacity = 0.55 * k * k;
      b.g.scale.x = b.g.scale.y = 0.6 + 0.6 * k;
    }
    if (state.blesse > 0) state.blesse -= dt;
    if (blast) blast.update(dt);
    if (muzzleLight) muzzleLight.intensity *= Math.max(0, 1 - dt * 12);
    shake = Math.max(0, shake - dt * 1.6);
  }

  // ------------------------------------------------------------------ collisions
  /** Vrai si le disque du robot tient à cette position (centre + 8 points sur le pourtour). */
  function free(x, z, r = RADIUS) {
    if (blockedAt(x, z)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (blockedAt(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  }

  /** Point libre le plus proche (spirale) : sert au largage et aux téléportations. */
  function freeSpot(x, z) {
    if (free(x, z)) return { x, z };
    for (let r = 0.5; r < 40; r += 0.5) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (free(px, pz)) return { x: px, z: pz };
      }
    }
    return { x, z };
  }

  /** Direction de dégagement quand le robot se retrouve dans un obstacle. */
  function escape(x, z, out) {
    out.set(0, 0, 0);
    let best = Infinity;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (let r = 0.5; r <= 25; r += 0.5) {
        if (free(x + Math.cos(a) * r, z + Math.sin(a) * r)) {
          if (r < best) {
            best = r;
            out.set(Math.cos(a), 0, Math.sin(a));
          }
          break;
        }
      }
    }
    return best < Infinity;
  }

  /** Avance de (dx, dz) en glissant le long des murs ; renvoie la distance réellement parcourue. */
  function slide(p, dx, dz) {
    const before = { x: p.x, z: p.z };
    const g0 = walkableAt(p.x, p.z);
    const climbable = (nx, nz) => Math.abs(walkableAt(nx, nz) - g0) < 1.5;
    if (free(p.x + dx, p.z + dz) && climbable(p.x + dx, p.z + dz)) {
      p.x += dx;
      p.z += dz;
    } else {
      if (dx && free(p.x + dx, p.z) && climbable(p.x + dx, p.z)) p.x += dx;
      if (dz && free(p.x, p.z + dz) && climbable(p.x, p.z + dz)) p.z += dz;
    }
    return Math.hypot(p.x - before.x, p.z - before.z);
  }

  // ------------------------------------------------------------------ boucle
  /** Une image : consigne, inertie, collisions, animation, caméra. */
  function update(dt, touch) {
    if (!root.visible || !kit) return;
    state.time += dt;
    const p = root.position;
    const def = kit.def;

    if (state.detruit) { if (state.blesse > 0) state.blesse -= dt; updateDown(dt); return; }

    // dégagement : jamais coincé dans un mur
    if (!free(p.x, p.z)) {
      if (escape(p.x, p.z, push)) {
        p.x += push.x * Math.min(5 * dt, 0.3);
        p.z += push.z * Math.min(5 * dt, 0.3);
      } else {
        const out = freeSpot(p.x, p.z);          // aucune sortie proche : on se replace
        p.x = out.x;
        p.z = out.z;
      }
      vel.set(0, 0, 0);
      p.y = walkableAt(p.x, p.z);
    }

    if (state.falling) {
      state.vy -= 22 * dt;
      p.y += state.vy * dt;
      const g = walkableAt(p.x, p.z);
      if (p.y <= g) {
        p.y = g;
        state.falling = false;
        if (def.atterrissage) {
          play(def.atterrissage, 0.1);
          state.busyUntil = state.time + kit.actions[def.atterrissage].getClip().duration * 0.8;
        } else {
          play(null, 0.2);
          state.busyUntil = state.time + 0.25;
        }
      }
      kit.mixer.update(dt);
      updateGun(dt, false);         // pendant la chute : pas de tir, mais les traits s'éteignent
      placeCamera(dt, p);
      return;
    }

    // ---- consigne du joueur
    let ix = 0, iz = 0;
    if (state.time >= state.busyUntil) {
      if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
      if (keys.has('KeyA')) ix -= 1;
      if (keys.has('KeyD')) ix += 1;
      if (keys.has('ArrowLeft')) state.yaw += 1.8 * dt;
      if (keys.has('ArrowRight')) state.yaw -= 1.8 * dt;
      if (touch && touch.active) { ix += touch.x; iz += touch.y; }
    }
    fwd.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    right.set(-fwd.z, 0, fwd.x);
    want.set(0, 0, 0).addScaledVector(fwd, -iz).addScaledVector(right, ix);
    const len = want.length();
    const running = keys.has('ShiftLeft') || keys.has('ShiftRight') || !!(touch && touch.run);
    if (len > 1) want.multiplyScalar(1 / len);
    want.multiplyScalar(Math.min(len, 1) * (running ? RUN : WALK));

    // ---- inertie : on rejoint la consigne, plus vite au freinage qu'à l'accélération
    const rate = want.lengthSq() > vel.lengthSq() ? ACCEL : BRAKE;
    step.copy(want).sub(vel);
    const dv = rate * dt;
    if (step.lengthSq() > dv * dv) step.setLength(dv);
    vel.add(step);
    if (vel.lengthSq() < 1e-4) vel.set(0, 0, 0);

    // ---- déplacement et collisions
    const moved = slide(p, vel.x * dt, vel.z * dt);
    const speed = dt > 0 ? moved / dt : 0;
    if (speed < vel.length() * 0.35) vel.multiplyScalar(0.4);   // on butte : on perd l'élan
    state.speed += (speed - state.speed) * Math.min(1, dt * 12);
    p.y += (walkableAt(p.x, p.z) - p.y) * Math.min(1, dt * 10);

    // ---- cap du corps : il pivote vers là où l'on va, sans à-coup
    if (state.speed > 0.15 && vel.lengthSq() > 1e-3) {
      const target = Math.atan2(-vel.x, -vel.z);
      let d = target - state.bodyYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      state.bodyYaw += THREE.MathUtils.clamp(d, -TURN * dt, TURN * dt);
    } else {
      let d = state.yaw - state.bodyYaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      state.bodyYaw += THREE.MathUtils.clamp(d, -TURN * 0.5 * dt, TURN * 0.5 * dt);
    }
    pivot.rotation.y = state.bodyYaw;

    // ---- animation choisie et cadencée d'après la vitesse réelle
    if (state.time >= state.busyUntil) {
      const s = state.speed;
      if (s < 0.25) {
        play(def.repos || null, 0.3);
      } else if (s < def.course.vitesse * 0.62) {
        play(def.marche.clip, 0.22, THREE.MathUtils.clamp(s / def.marche.vitesse, 0.45, 1.8));
      } else {
        play(def.course.clip, 0.22, THREE.MathUtils.clamp(s / def.course.vitesse, 0.6, 1.6));
      }
    }
    kit.mixer.update(dt);
    updateGun(dt, trigger || keys.has('KeyF'));
    placeCamera(dt, p);
  }

  /**
   * Caméra à la troisième personne, amortie et sensible au contexte.
   *
   * Rien ne saute : le cap, le point visé, la distance et l'inclinaison rejoignent
   * leur consigne par amortissement exponentiel (constantes de temps en secondes).
   * Elle se rapproche vite quand un mur arrive, et repart lentement quand la voie
   * se dégage — l'inverse donne le clignotement qu'on avait.
   * Elle regarde d'autant plus loin devant que le robot va vite, s'écarte et ouvre
   * légèrement le champ à la course, et monte le long des façades dans les ruelles.
   */
  const cam = { yaw: 0, dist: CAM_DIST, want: CAM_DIST, pitch: 0.12, fov: 55, ready: false, snap: false };
  const camAim = new THREE.Vector3(), camLook = new THREE.Vector3();
  /** Fraction du chemin à parcourir cette image pour une constante de temps `tau`. */
  const ease = (dt, tau) => 1 - Math.exp(-dt / tau);

  /** Distance dégagée devant la caméra pour une inclinaison donnée. */
  function clearDist(p, pitch, wanted) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    for (let d = 2.0; d <= wanted; d += 0.5) {
      probe.set(p.x + Math.sin(cam.yaw) * c * d, camLook.y + s * d + CAM_HEIGHT, p.z + Math.cos(cam.yaw) * c * d);
      // bâtiment, relief, ou feuillage dans lequel la caméra serait noyée (pas une branche)
      if (blockedAt(probe.x, probe.z) || groundAt(probe.x, probe.z) > probe.y - 0.3
          || surfaceAt(probe.x, probe.z) > probe.y + 1.5) return Math.max(3.0, d - 0.6);
    }
    return wanted;
  }

  function placeCamera(dt, p) {
    const h = kit.def.hauteur;
    const rush = Math.min(state.speed / RUN, 1);              // 0 à l'arrêt, 1 à pleine course

    // --- cap : suit la souris avec un léger retard, sans à-coup
    let dYaw = state.yaw - cam.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    cam.yaw += dYaw * ease(dt, 0.14);

    // --- point visé : devant le robot, d'autant plus loin qu'il avance vite
    const ahead = CAM_AHEAD + rush * 3.0;
    camAim.set(p.x - Math.sin(cam.yaw) * ahead, p.y + h * 0.95, p.z - Math.cos(cam.yaw) * ahead);
    if (!cam.ready) { camLook.copy(camAim); cam.ready = true; }
    camLook.lerp(camAim, ease(dt, 0.13));

    // --- distance et inclinaison voulues, puis dégagement du décor
    const wanted = state.dist * (1 + rush * 0.14);
    let pitchWant = state.camPitch;
    let distWant = clearDist(p, pitchWant, wanted);
    for (let k = 0; k < 7 && distWant < wanted - 0.01; k++) {
      const up = Math.min(CAM_PITCH_MAX, pitchWant + 0.08);
      if (up === pitchWant) break;
      const d2 = clearDist(p, up, wanted);
      if (d2 <= distWant) break;                              // monter n'aide plus : on s'arrête là
      pitchWant = up;
      distWant = d2;
    }
    // double filtrage : la consigne elle-même est lissée, puis la distance la suit.
    // Se resserrer reste prioritaire (on ne traverse pas un mur), s'éloigner prend son temps.
    cam.want += (distWant - cam.want) * ease(dt, distWant < cam.want ? 0.10 : 0.45);
    cam.dist += (cam.want - cam.dist) * ease(dt, cam.want < cam.dist ? 0.12 : 0.40);
    cam.pitch += (pitchWant - cam.pitch) * ease(dt, 0.35);

    const c = Math.cos(cam.pitch), s = Math.sin(cam.pitch);
    camWanted.set(
      p.x + Math.sin(cam.yaw) * c * cam.dist,
      camLook.y + s * cam.dist + CAM_HEIGHT,
      p.z + Math.cos(cam.yaw) * c * cam.dist,
    );
    // encore dans un mur : on raccourcit la distance pour les images suivantes, sans téléporter
    if (blockedAt(camWanted.x, camWanted.z)) {
      cam.want = Math.min(cam.want, Math.max(3.0, cam.dist * 0.75));
      camWanted.lerp(camLook, 0.35);
    }
    const floor = groundAt(camWanted.x, camWanted.z) + 0.8;
    if (camWanted.y < floor) camWanted.y = floor;
    if (shake > 0.001) {
      camWanted.x += (Math.random() - 0.5) * shake;
      camWanted.y += (Math.random() - 0.5) * shake;
      camWanted.z += (Math.random() - 0.5) * shake;
    }
    if (cam.snap) {                      // entrée dans le mode : on se place d'un coup
      cam.snap = false;
      camera.position.copy(camWanted);
      camera.lookAt(camLook);
      return;
    }
    // déplacement plafonné : même si la consigne saute, la caméra glisse, elle ne se téléporte pas
    step.subVectors(camWanted, camera.position).multiplyScalar(ease(dt, 0.09));
    const maxStep = (6 + state.speed * 2.5) * dt;
    if (step.lengthSq() > maxStep * maxStep) step.setLength(maxStep);
    camera.position.add(step);
    camera.lookAt(camLook);

    // --- champ de vision : s'ouvre un peu à la course, donne la sensation de vitesse
    const fovWant = 55 + rush * 8;
    if (Math.abs(fovWant - cam.fov) > 0.05) {
      cam.fov += (fovWant - cam.fov) * ease(dt, 0.45);
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
  }

  /** Encaisse un coup ennemi : santé, secousse, et le voyant du HUD clignote. */
  function hurt(degats) {
    if (state.vie <= 0) return;
    state.vie = Math.max(0, state.vie - degats);
    state.blesse = 0.35;
    shake = Math.max(shake, 0.10 + degats * 0.006);
    if (state.vie <= 0) {
      state.detruit = state.time;                  // mise a terre, puis redeploiement
      trigger = false;
      state.vy = 2.0;
    }
  }

  /** Mise a terre : le robot bascule, la camera recule, puis il revient neuf. */
  function updateDown(dt) {
    const t = state.time - state.detruit;
    const chute = Math.min(1, t / 0.7);
    if (kit) {
      kit.group.rotation.x = -chute * chute * 1.25;
      kit.group.position.y = -chute * 0.35;
    }
    state.dist += (CAM_MAX * 0.55 - state.dist) * Math.min(1, dt * 1.5);
    updateGun(dt, false);
    placeCamera(dt, root.position);
    if (t > RELEVE) {
      if (kit) { kit.group.rotation.x = 0; kit.group.position.y = 0; }
      state.detruit = 0;
      state.vie = state.vieMax;
      state.dist = CAM_DIST;
      const out = freeSpot(root.position.x, root.position.z);
      enter(out.x, out.z, state.yaw);
    }
  }

  return {
    load, setModel, enter, exit, look, zoom, setTrigger, update, root, state, hurt,
    setEnemies(e) { ennemis = e; },
    get modele() { return choice; },
    get impacts() { return blast; },       // permet de régler l'effet d'impact depuis la console
  };
}
