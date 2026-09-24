/**
 * Gobelins : les ennemis du premier niveau de Poilhes.
 *
 * Cinq figurines issues d'un jeu d'impression 3D (voir scripts/goblins/) : cinq
 * armes, cinq comportements. Trois au corps à corps qui chargent, deux à distance
 * qui gardent leurs mètres et tirent.
 *
 * Les modèles sont des coquilles sans squelette : la démarche est jouée en
 * procédural sur le groupe (balancement, appui, penché dans les virages). Le jour
 * où les mêmes modèles reviennent riggés, seule `anime()` change.
 *
 * Aucune allocation dans update() : vecteurs, projectiles et gobelins sont réservés
 * une fois pour toutes. Les corps restent au sol quelques secondes puis s'effacent.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { skinnedBox } from './poilhes-robot.js?v=voiture-20260921';

/**
 * Ennemis riggés : vrai squelette, vraies animations (Meshy).
 *
 * Le Chevalier d'Enfer est la pièce lourde du premier niveau : il encaisse, il
 * marche puis charge, et il frappe à deux mains. Quatre clips seulement, fondus
 * entre eux ; il n'a pas de pose de repos, donc la marche ralentie en tient lieu.
 */
export const RIGGES = {
  knight: {
    nom: "Chevalier d'Enfer",
    url: 'assets/knight/knight.glb',
    vie: 420, vitesse: 2.1, charge: 4.4, portee: 0, degats: 26, cadence: 2.3, taille: 2.45,
    clips: { marche: 'Walking', course: 'Running', coups: ['Punch_Combo_5', 'Reaping_Swing'] },
    cadences: { marche: 1.5, course: 4.2 },      // vitesse (m/s) à laquelle le clip tourne juste
  },
};

/** Un gobelin par arme. `portee` : 0 = corps à corps. */
export const GOBELINS = {
  axe: { nom: 'Hachier', vie: 100, vitesse: 2.3, portee: 0, degats: 9, cadence: 1.2, taille: 1.55 },
  club: { nom: 'Casseur', vie: 145, vitesse: 1.8, portee: 0, degats: 14, cadence: 1.7, taille: 1.65 },
  sword: { nom: 'Porte-bouclier', vie: 125, vitesse: 2.4, portee: 0, degats: 9, cadence: 1.1, taille: 1.55 },
  bow: { nom: 'Archer', vie: 70, vitesse: 2.0, portee: 34, degats: 7, cadence: 2.0, taille: 1.55 },
  staff: { nom: 'Chaman', vie: 85, vitesse: 1.6, portee: 24, degats: 11, cadence: 2.6, taille: 1.55 },
};

const TYPES = Object.keys(GOBELINS);
const VUE = 55;              // distance à laquelle le gobelin repère le robot (m)
const OUBLI = 95;            // au-delà, il renonce
const CORPS = 2.6;           // distance d'engagement au corps à corps (m)
const RAYON = 0.55;          // encombrement au sol (m)
const EFFACEMENT = 6.0;      // durée d'un cadavre avant disparition (s)
const FLECHES = 24;          // projectiles ennemis simultanés

export function createEnemies({ scene, walkableAt, blockedAt, cible }) {
  const root = new THREE.Group();
  root.name = 'gobelins';
  scene.add(root);

  const modeles = {};                 // type -> { geo, mat }   (figurines rigides)
  const rigges = {};                  // type -> promesse { modele, clips }
  const vivants = [];                 // ennemis en jeu (vivants ou en train de disparaître)
  let charge = null;                  // promesse de chargement

  const loader = new GLTFLoader();

  /**
   * Matière d'un gobelin : la démarche est jouée dans le vertex shader.
   *
   * Les figurines n'ont pas de squelette. On plie donc le maillage à la main, dans
   * son repère (origine aux pieds, +Z devant) : les jambes balancent autour de la
   * hanche en opposition de phase gauche/droite, les bras répondent plus discrètement
   * — ils tiennent une arme —, le buste prend l'appui et plonge sur un coup porté.
   * Un exemplaire de matière par gobelin, mais une seule compilation GPU grâce à
   * `customProgramCacheKey` : seules les uniformes changent.
   */
  function matiereAnimee(base, hauteur) {
    const mat = base.clone();
    const u = {
      uPhase: { value: 0 }, uMarche: { value: 0 }, uAttaque: { value: 0 },
      uFlash: { value: 0 }, uHaut: { value: hauteur },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = `uniform float uPhase, uMarche, uAttaque, uHaut;
${shader.vertexShader
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          float h = transformed.y / uHaut;                       // 0 aux pieds, 1 au crâne
          float ph = uPhase + (transformed.x >= 0.0 ? 0.0 : 3.14159);
          float jambe = smoothstep(0.60, 0.04, h) * uMarche;
          transformed.z += sin(ph) * jambe * 0.30;
          transformed.y += max(0.0, sin(ph)) * jambe * 0.06;
          float bras = smoothstep(0.58, 0.92, h) * smoothstep(0.09, 0.20, abs(transformed.x)) * uMarche;
          transformed.z -= sin(ph) * bras * 0.11;
          transformed.y += abs(sin(uPhase)) * smoothstep(0.15, 0.75, h) * uMarche * 0.035;
          transformed.z += uAttaque * smoothstep(0.30, 1.0, h) * 0.34;   // le buste plonge sur le coup
        }`)}`;
      shader.fragmentShader = `uniform float uFlash;
${shader.fragmentShader
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.0, 0.94, 0.86), uFlash);`)}`;
    };
    mat.customProgramCacheKey = () => 'gobelin';
    return { mat, u };
  }

  /**
   * Copie un modèle à squelette. `Object3D.clone()` duplique bien la hiérarchie,
   * mais les maillages copiés restent attachés au squelette d'origine : ils
   * prendraient tous la même pose. On rattache donc chaque copie aux os clonés,
   * retrouvés par leur nom — c'est tout ce que fait SkeletonUtils, en trente lignes.
   */
  function clonerSquelette(source) {
    const copie = source.clone(true);
    const os = new Map();
    copie.traverse((o) => { if (o.isBone) os.set(o.name, o); });
    const avant = [], apres = [];
    source.traverse((o) => avant.push(o));
    copie.traverse((o) => apres.push(o));
    for (let i = 0; i < avant.length; i++) {
      if (!avant[i].isSkinnedMesh) continue;
      const src = avant[i], dst = apres[i];
      const sq = new THREE.Skeleton(src.skeleton.bones.map((b) => os.get(b.name) || b),
                                    src.skeleton.boneInverses);
      dst.bind(sq, src.bindMatrix);
    }
    return copie;
  }

  /** Charge un ennemi riggé (Meshy) : modèle de référence + clips, une seule fois. */
  function chargerRigge(type) {
    const def = RIGGES[type];
    if (!def) return Promise.resolve(null);
    if (rigges[type]) return rigges[type];
    rigges[type] = new Promise((ok) => {
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(def.url, (gltf) => {
        const modele = gltf.scene;
        const boite = skinnedBox(modele);
        const haut = Math.max(0.01, boite.max.y - boite.min.y);
        // mise à l'échelle du jeu, pieds sur y = 0 et modèle recentré sur son appui
        modele.scale.setScalar(def.taille / haut);
        modele.position.set(-(boite.min.x + boite.max.x) / 2 * modele.scale.x,
                            -boite.min.y * modele.scale.y,
                            -(boite.min.z + boite.max.z) / 2 * modele.scale.z);
        modele.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = true;
          o.frustumCulled = false;
          // La carte metal/rugosite cuite par Meshy rend l'armure miroir : sans
          // reflet fort dans le village, elle vire au noir verni. On rabat les
          // facteurs, la texture garde le detail.
          o.material.metalness = 0.18;
          o.material.roughness = 0.88;
        });
        ok({ modele, clips: gltf.animations });
      }, undefined, () => ok(null));
    });
    return rigges[type];
  }

  /** Charge les cinq GLB une seule fois ; géométrie et matière partagées par type. */
  function load() {
    if (charge) return charge;
    charge = Promise.all(TYPES.map((type) => new Promise((ok) => {
      loader.load(`assets/goblins/${type}.glb`, (gltf) => {
        let geo = null;
        gltf.scene.traverse((o) => { if (o.isMesh && !geo) geo = o.geometry; });
        if (geo) {
          geo.computeVertexNormals();
          modeles[type] = {
            geo,
            mat: new THREE.MeshStandardMaterial({
              vertexColors: true, roughness: 0.82, metalness: 0.06, flatShading: false,
            }),
          };
        }
        ok();
      }, undefined, () => ok());
    })));
    return charge;
  }

  // --------------------------------------------------------------------- projectiles
  const traits = [];
  function buildTraits() {
    if (traits.length) return;
    const geoFleche = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5).rotateX(Math.PI / 2);
    const matFleche = new THREE.MeshBasicMaterial({ color: 0x6b5233 });
    const geoSort = new THREE.SphereGeometry(0.16, 8, 6);
    const matSort = new THREE.MeshBasicMaterial({ color: 0x9cff7a, transparent: true, opacity: 0.9 });
    for (let i = 0; i < FLECHES; i++) {
      const magie = i >= FLECHES / 2;
      const m = new THREE.Mesh(magie ? geoSort : geoFleche, magie ? matSort : matFleche);
      m.visible = false;
      m.frustumCulled = false;
      root.add(m);
      traits.push({ m, magie, vie: 0, degats: 0, vel: new THREE.Vector3() });
    }
  }

  function tirer(g, dir) {
    buildTraits();
    const magie = g.type === 'staff';
    const t = traits.find((x) => x.vie <= 0 && x.magie === magie);
    if (!t) return;
    t.m.position.copy(g.root.position);
    t.m.position.y += g.conf.taille * 0.72;
    t.m.position.addScaledVector(dir, 0.6);
    t.vel.copy(dir).multiplyScalar(magie ? 26 : 42);
    t.vie = 3.0;
    t.degats = g.conf.degats;
    t.m.visible = true;
    if (!magie) t.m.lookAt(t.m.position.x + dir.x, t.m.position.y + dir.y, t.m.position.z + dir.z);
  }

  // --------------------------------------------------------------------- apparition
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

  /** Point libre le plus proche de (x, z) : on ne fait pas naître un gobelin dans un mur. */
  function placeLibre(x, z, out) {
    for (let r = 0; r < 26; r += 2) {
      for (let a = 0; a < 12; a++) {
        const t = a * Math.PI / 6 + r;
        const px = x + Math.cos(t) * r, pz = z + Math.sin(t) * r;
        if (!blockedAt(px, pz)) { out.set(px, walkableAt(px, pz), pz); return true; }
      }
    }
    return false;
  }

  /** Fait apparaître un gobelin. `type` au hasard si absent. */
  function spawn(x, z, type) {
    const t = type || TYPES[(Math.random() * TYPES.length) | 0];
    const mod = modeles[t];
    if (!mod) return null;
    if (!placeLibre(x, z, v1)) return null;

    const conf = GOBELINS[t];
    const anim = matiereAnimee(mod.mat, conf.taille);
    const groupe = new THREE.Group();
    const mesh = new THREE.Mesh(mod.geo, anim.mat);
    mesh.rotation.y = Math.PI;                 // les figurines regardent +Z, le jeu regarde -Z
    mesh.castShadow = true;
    groupe.add(mesh);
    groupe.position.copy(v1);
    root.add(groupe);

    const g = {
      type: t, conf, root: groupe, mesh, mat: anim.mat, u: anim.u, attaque: 0,
      vie: conf.vie, max: conf.vie,
      yaw: Math.random() * Math.PI * 2, etat: 'veille',
      phase: Math.random() * 6.28, cadence: 0.9, sol: v1.y,   // jamais de coup des l'arrivee
      controle: 0, contourne: 0, cote: 1, dernierX: v1.x, dernierZ: v1.z,
      mort: 0, touche: 0, vitesse: 0,
      vel: new THREE.Vector3(),
    };
    vivants.push(g);
    return g;
  }

  /** Fait apparaître un ennemi riggé (chargement à la demande, d'où la promesse). */
  async function spawnRigge(x, z, type = 'knight') {
    const paquet = await chargerRigge(type);
    if (!paquet || !placeLibre(x, z, v1)) return null;
    const def = RIGGES[type];

    const groupe = new THREE.Group();
    const modele = clonerSquelette(paquet.modele);
    modele.rotation.y = Math.PI;                  // le modèle regarde +Z, le jeu regarde -Z
    modele.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
    groupe.add(modele);
    groupe.position.copy(v1);
    root.add(groupe);

    const mixer = new THREE.AnimationMixer(modele);
    const actions = {};
    for (const clip of paquet.clips) actions[clip.name] = mixer.clipAction(clip);

    const g = {
      type, conf: def, root: groupe, mesh: modele, mixer, actions, clip: null, attaque: 0,
      vie: def.vie, max: def.vie,
      yaw: Math.random() * Math.PI * 2, etat: 'veille',
      phase: 0, cadence: 1.2, sol: v1.y,
      controle: 0, contourne: 0, cote: 1, dernierX: v1.x, dernierZ: v1.z,
      mort: 0, touche: 0, vitesse: 0,
      vel: new THREE.Vector3(),
    };
    vivants.push(g);
    return g;
  }

  /** Une escouade autour d'un point, à distance respectable du joueur. */
  function vague(x, z, n = 6, rayon = 45, chevaliers = 0) {
    const nes = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random();
      const d = rayon * (0.45 + Math.random() * 0.55);
      const g = spawn(x + Math.cos(a) * d, z + Math.sin(a) * d);
      if (g) nes.push(g);
    }
    for (let i = 0; i < chevaliers; i++) {
      const a = Math.random() * Math.PI * 2;
      spawnRigge(x + Math.cos(a) * rayon * 0.9, z + Math.sin(a) * rayon * 0.9);
    }
    return nes;
  }

  // --------------------------------------------------------------------- dégâts
  /**
   * Encaisse un tir. Renvoie vrai si le gobelin meurt sur ce coup.
   * `point` sert à orienter la chute : on tombe dans le sens du tir.
   */
  function blesser(g, degats, dir) {
    if (g.etat === 'mort') return false;
    g.vie -= degats;
    g.touche = 0.16;
    if (dir) g.vel.addScaledVector(dir, 1.6);
    if (g.vie > 0) {
      if (g.etat === 'veille') g.etat = 'chasse';       // on se fait tirer dessus : on cherche
      return false;
    }
    g.etat = 'mort';
    g.mort = 0;
    if (g.mixer) g.mixer.stopAllAction();
    return true;
  }

  /**
   * Premier gobelin touché par un tir.
   *
   * Le volume de touche est une capsule verticale, et elle monte plus haut que le
   * crâne : le Titan tire à hauteur d'épaule, c'est-à-dire au-dessus d'un gobelin
   * de 1,55 m. Sans cette marge, on vide son chargeur sur un ennemi collé à soi
   * sans jamais le toucher.
   */
  const CAP_BAS = 0.25, CAP_HAUT = 1.30, CAP_RAYON = 0.52;   // en fraction de la taille, puis mètres
  const echant = new THREE.Vector3();
  function raycast(from, dir, max, out) {
    let best = -1, cible = null;
    for (const g of vivants) {
      if (g.etat === 'mort') continue;
      const h = g.conf.taille;
      const bas = g.root.position.y + CAP_BAS * h, haut = g.root.position.y + CAP_HAUT * h;
      const rayon = Math.min(0.85, CAP_RAYON * (h / 1.55));
      // point du tir le plus proche de l'axe du corps, puis distance a la capsule
      v1.set(g.root.position.x - from.x, 0, g.root.position.z - from.z);
      const plan = Math.hypot(dir.x, dir.z);
      if (plan < 1e-4) continue;
      const le = (v1.x * dir.x + v1.z * dir.z) / (plan * plan);
      if (le < 0.5 || le > max || (best >= 0 && le > best)) continue;
      echant.copy(from).addScaledVector(dir, le);
      const dy = echant.y < bas ? bas - echant.y : echant.y > haut ? echant.y - haut : 0;
      const dh = Math.hypot(echant.x - g.root.position.x, echant.z - g.root.position.z);
      const d2 = dh * dh + dy * dy;
      if (d2 > rayon * rayon) continue;
      const recul = Math.sqrt(Math.max(0, rayon * rayon - d2));
      const d = Math.max(0.6, le - recul);
      if (best < 0 || d < best) { best = d; cible = g; }
    }
    if (cible && out) out.copy(from).addScaledVector(dir, best);
    return { d: best, gobelin: cible };
  }

  // --------------------------------------------------------------------- mouvement
  /** Avance en glissant le long des murs, comme le robot. */
  function avancer(g, dx, dz) {
    const p = g.root.position;
    if (!blockedAt(p.x + dx, p.z + dz)) { p.x += dx; p.z += dz; return; }
    if (!blockedAt(p.x + dx, p.z)) { p.x += dx; return; }
    if (!blockedAt(p.x, p.z + dz)) { p.z += dz; return; }
  }

  /**
   * Ennemi riggé : vrais clips, choisis et cadencés d'après la vitesse réelle.
   *
   * Le chevalier n'a pas de pose de repos — sa marche tourne au ralenti quand il
   * ne bouge pas, ce qui lui donne un balancement d'attente convaincant. Un coup
   * porté joue une fois, sans boucler, et reprend la main sur la locomotion.
   */
  function animeRigge(g, dt) {
    const v = Math.abs(g.vitesse);
    const c = g.conf.clips;
    g.attaque = Math.max(0, g.attaque - dt);
    const vise = g.attaque > 0 ? g.coup : (v > 3.0 ? c.course : c.marche);
    if (vise !== g.clip) {
      const suivante = g.actions[vise];
      if (suivante) {
        if (g.attaque > 0) suivante.reset().setLoop(THREE.LoopOnce, 1);
        else suivante.reset().setLoop(THREE.LoopRepeat, Infinity);
        suivante.clampWhenFinished = g.attaque > 0;
        suivante.fadeIn(0.18).play();
      }
      if (g.clip && g.actions[g.clip]) g.actions[g.clip].fadeOut(0.18);
      g.clip = vise;
    }
    const action = g.actions[g.clip];
    if (action && g.attaque <= 0) {
      const ref = v > 3.0 ? g.conf.cadences.course : g.conf.cadences.marche;
      action.timeScale = Math.max(0.35, v / ref);        // au ralenti à l'arrêt : c'est l'attente
    }
    g.root.position.y = g.sol;
    g.mixer.update(dt);
    const feu = Math.min(1, Math.max(0, g.touche) * 6) * 0.85;
    g.mesh.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setScalar(feu); });
  }

  /** Démarche procédurale : appui, balancement, penché. Pour les figurines sans squelette. */
  function anime(g, dt) {
    if (g.mixer) { animeRigge(g, dt); return; }
    const v = Math.abs(g.vitesse);
    // cadence liée à la vitesse réelle : pas de patinage, pas de course sur place
    g.phase += dt * (1.6 + v * 2.4);
    g.attaque = Math.max(0, g.attaque - dt * 3.2);
    g.root.position.y = g.sol;
    g.mesh.rotation.z = Math.sin(g.phase) * 0.055 * Math.min(1, v / 1.2);
    g.mesh.rotation.x = -Math.min(0.11, v * 0.04) - g.attaque * 0.18;
    g.u.uPhase.value = g.phase;
    g.u.uMarche.value = Math.min(1, v / 1.5);
    g.u.uAttaque.value = g.attaque;
    g.u.uFlash.value = Math.max(0, g.touche) * 5.0;
  }

  /** Chute : le gobelin bascule vers l'avant puis s'enfonce et disparaît. */
  function tomber(g, dt) {
    g.mort += dt;
    const t = Math.min(1, g.mort / 0.55);
    g.mesh.rotation.x = -t * t * Math.PI * 0.46;
    g.mesh.rotation.z *= 1 - dt * 3;
    g.root.position.y = g.sol - Math.max(0, g.mort - EFFACEMENT + 1.2) * 1.4;
    if (g.mort > EFFACEMENT) {
      root.remove(g.root);
      g.mesh.geometry = null;
      vivants.splice(vivants.indexOf(g), 1);
    }
  }

  // --------------------------------------------------------------------- boucle
  function update(dt, joueur) {
    if (!vivants.length && !traits.length) return;
    const vise = joueur && joueur.position ? joueur.position : null;

    for (let i = vivants.length - 1; i >= 0; i--) {
      const g = vivants[i];
      if (g.touche > 0) g.touche -= dt;
      if (g.etat === 'mort') { tomber(g, dt); continue; }

      const p = g.root.position;
      let dist = Infinity, dx = 0, dz = 0;
      if (vise) {
        dx = vise.x - p.x; dz = vise.z - p.z;
        dist = Math.hypot(dx, dz);
      }

      if (g.etat === 'veille' && dist < VUE) g.etat = 'chasse';
      else if (g.etat !== 'veille' && dist > OUBLI) g.etat = 'veille';

      let consigne = 0;
      if (g.etat === 'chasse' && dist < Infinity) {
        const garde = g.conf.portee ? g.conf.portee * 0.75 : CORPS + (g.conf.taille - 1.55) * 0.9;
        g.yaw = Math.atan2(-dx, -dz);                  // convention du jeu : yaw 0 regarde -Z
        // Contournement : sans plan de circulation, un ennemi lancé droit sur un mur
        // reste collé dessus. On mesure ce qu'il a vraiment parcouru, et s'il piétine
        // on le fait longer l'obstacle un instant, d'un côté tiré au sort.
        g.controle += dt;
        if (g.controle > 0.8) {
          if (g.contourne <= 0 && Math.hypot(p.x - g.dernierX, p.z - g.dernierZ) < 0.25 * g.controle) {
            g.cote = Math.random() < 0.5 ? -1 : 1;
            g.contourne = 1.6;
          }
          g.controle = 0;
          g.dernierX = p.x;
          g.dernierZ = p.z;
        }
        if (g.contourne > 0) {
          g.contourne -= dt;
          g.yaw += g.cote * 1.25;
        }
        if (dist > garde) consigne = (g.conf.charge && dist < 30) ? g.conf.charge : g.conf.vitesse;
        else if (dist < garde * 0.6 && g.conf.portee) consigne = -g.conf.vitesse * 0.5;

        g.cadence -= dt;
        const aPortee = g.conf.portee ? dist < g.conf.portee : dist < garde * 1.15;
        if (!aPortee) g.cadence = Math.max(g.cadence, 0.45);   // temps d'armer le bras en arrivant
        if (aPortee && g.cadence <= 0) {
          g.cadence = g.conf.cadence * (0.85 + Math.random() * 0.3);
          if (g.conf.portee) {
            v2.set(dx, (vise.y + 1.0) - (p.y + g.conf.taille * 0.72), dz).normalize();
            tirer(g, v2);
          } else if (joueur && joueur.hurt) {
            joueur.hurt(g.conf.degats, g);
            if (g.mixer) {                             // riggé : un vrai clip d'attaque, joué une fois
              const coups = g.conf.clips.coups;
              g.coup = coups[(Math.random() * coups.length) | 0];
              g.attaque = 1.2;
              g.clip = null;
            } else {
              g.attaque = 1.0;                         // figurine : le buste plonge, l'arme part
            }
          }
        }
      }

      // vitesse amortie, puis recul encaissé
      g.vitesse += (consigne - g.vitesse) * Math.min(1, dt * 5);
      const pas = g.vitesse * dt;
      avancer(g, -Math.sin(g.yaw) * pas + g.vel.x * dt, -Math.cos(g.yaw) * pas + g.vel.z * dt);
      g.vel.multiplyScalar(Math.max(0, 1 - dt * 6));

      g.sol = walkableAt(p.x, p.z);
      g.root.rotation.y = g.yaw;
      anime(g, dt);
    }

    // projectiles
    for (const t of traits) {
      if (t.vie <= 0) continue;
      t.vie -= dt;
      if (!t.magie) t.vel.y -= 9.0 * dt;
      t.m.position.addScaledVector(t.vel, dt);
      if (!t.magie) t.m.lookAt(t.m.position.x + t.vel.x, t.m.position.y + t.vel.y, t.m.position.z + t.vel.z);
      if (vise) {
        const d = t.m.position.distanceTo(vise);
        if (d < 1.6 && joueur.hurt) { joueur.hurt(t.degats, null); t.vie = 0; }
      }
      if (t.vie <= 0 || t.m.position.y < walkableAt(t.m.position.x, t.m.position.z) - 0.2) {
        t.vie = 0;
        t.m.visible = false;
      }
    }
  }

  function clear() {
    for (const g of vivants) root.remove(g.root);
    vivants.length = 0;
    for (const t of traits) { t.vie = 0; t.m.visible = false; }
  }

  return {
    load, spawn, spawnRigge, vague, update, raycast, blesser, clear, root,
    get liste() { return vivants; },
    get restants() {
      let n = 0;
      for (const g of vivants) if (g.etat !== 'mort') n++;
      return n;
    },
  };
}
