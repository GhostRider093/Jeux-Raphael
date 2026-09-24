import * as THREE from 'three';
// La flotte vole en Rafale depuis le 16/09/2026. Le Kawasaki Ki-61 reste
// dans enemy-fighter-model.js : c'est un import a changer, rien de plus.
import { createEnemyFighterModel, preloadEnemyFighterModel } from './enemy-rafale-model.js?v=rafale-20260916';
import { createExplosionSystem } from './world-explosion.js?v=sons-reels-20260908';

preloadEnemyFighterModel().catch(() => {});

// Le cadrage complet, attente radar comprise, tient en deux fois moins de
// temps qu'avant : 4,45 s -> 2,22 s. Les deux valeurs sont divisees par deux,
// pas seulement l'acquisition — c'est le delai ressenti qui compte.
const LOCK_SEARCH_DELAY = .42;
const LOCK_ACQUIRE_TIME = 1.8;
// Zone d'accroche elargie de 30 % le 16/09/2026 : a 60 px le losange se
// derobait des qu'un chasseur manoeuvrait, le verrouillage etait un exercice
// d'adresse au lieu d'une intention de tir. 60 -> 78 et 92 -> 120, meme facteur
// sur les deux rayons pour garder l'hysteresis (on lache plus loin qu'on ne prend).
const LOCK_CAPTURE_RADIUS = 78;
const LOCK_RELEASE_RADIUS = 120;
//  L'ENNEMI RIPOSTE — niveau 1.
//  Les dix Rafale tirent, mais le premier niveau doit se franchir sans
//  connaitre le jeu : leur missile vire MOU, et il se laisse berner par une
//  manoeuvre franche. Une vrille ou un gros break a gauche ou a droite suffit
//  a le semer — regle posee par Arnaud le 16/09/2026.
const RIPOSTE_PORTEE = 620;
const RIPOSTE_DISTANCE_MINI = 90;     // trop pres, le missile n'a pas le temps de s'armer
const RIPOSTE_CONE = .55;             // cosinus : le joueur doit etre dans les 57 degres devant le nez
const RIPOSTE_DELAI = 7.5;            // secondes entre deux tirs d'un meme chasseur
const RIPOSTE_PREMIER_DELAI = 10;     // le decollage se fait en paix
const RIPOSTE_MAX_EN_VOL = 1;         // un seul missile ennemi en l'air au niveau 1
const MISSILE_ENNEMI_VITESSE = 150;
const MISSILE_ENNEMI_VIRAGE = 1.1;    // mou : c'est exactement ce qui rend l'esquive possible
const MISSILE_ENNEMI_VIE = 8;
const MISSILE_ENNEMI_RAYON = 11;      // fusee de proximite
//  ESQUIVE. Le missile ne perd sa proie qu'en approche finale : manoeuvrer
//  trop tot ne sert a rien, il aurait le temps de se recaler. Les seuils sont
//  larges — une vrille franche depasse les 2 rad/s de roulis, un break serre
//  les 0,8 rad/s de changement de cap — et la memoire de 0,7 s pardonne au
//  pilote d'avoir commence son tonneau une demi-seconde trop tot.
const ESQUIVE_DISTANCE = 260;
const ESQUIVE_ROULIS = 2.0;
const ESQUIVE_VIRAGE = .8;
const ESQUIVE_MEMOIRE = .7;

const BULLET_SPEED = 560;
const AIM_DISTANCE = 1800;

// Le canon et la zone d'accroche doivent viser LA OU LE VISEUR EST DESSINE.
// Cette hauteur n'est pas une constante : le CSS de mondes.html pose le
// reticule a 48 %, la vue cockpit a 50 %, les media queries a 46 ou 48 %.
// La valeur recopiee en dur (.44) tirait donc quatre points d'ecran au-dessus
// du reticule — les obus passaient au-dessus de la cible, et le losange
// d'accroche etait decale d'autant. On mesure l'element plutot que de le
// deviner ; le cache evite un getBoundingClientRect par ennemi et par image.
let aimRatioCache = { cle: '', valeur: .48 };
function aimVerticalRatio() {
  const cle = `${innerWidth}x${innerHeight}|${document.body.className}`;
  if (aimRatioCache.cle === cle) return aimRatioCache.valeur;
  let valeur = .48;
  const viseur = document.getElementById('flight-reticle');
  if (viseur) {
    const rect = viseur.getBoundingClientRect();
    if (rect.height > 0 && innerHeight > 0) valeur = (rect.top + rect.height / 2) / innerHeight;
  }
  aimRatioCache = { cle, valeur };
  return valeur;
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

export function createWorldCombat({ scene, camera, player, world, mode, getHeight, getForward, getSpeed, explosionSystem: sharedExplosions, onPlayerHit }) {
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

  // -- LA FLOTTE ------------------------------------------------------------
  //
  //  DIX chasseurs en vol EN MEME TEMPS, chacun sur sa patrouille, disperses
  //  sur toute la carte. Ils ne ripostent pas : ils se baladent, et c'est au
  //  joueur d'aller les chercher.
  //
  //  UN SEUL EST « LA CIBLE » a un instant donne — celui que le losange tient,
  //  dont le HUD montre les points de vie, vers qui part un missile guide. Tout
  //  le module continue donc de raisonner sur une cible unique : c'est `cible`
  //  qui change de main, la mecanique du verrouillage n'a pas bouge.
  //
  //  MAIS LES NEUF AUTRES ENCAISSENT. Les collisions balaient la flotte
  //  entiere, jamais la seule cible : un obus qui traverse un chasseur non vise
  //  doit lui faire mal, sinon on tire dans le tas sans effet et le jeu ment.
  //
  //  LA PATROUILLE EST UNE ORBITE, pas un cap a tenir. Une position calculee a
  //  partir du temps ne derive pas, ne s'emballe pas et ne demande aucune
  //  memoire : `angle = phase0 + sens * vitesse * t`. Dix appareils coutent dix
  //  cosinus par image.
  const FLOTTE = 10;

  // Position d'un chasseur sur son orbite a l'instant `t`. Le plancher a 45 m
  // au-dessus du relief garde l'orbite en l'air : un cercle trace au-dessus
  // d'une plaine traverse la montagne d'a cote sans ce garde-fou.
  const positionOrbite = new THREE.Vector3();
  function poserSurPatrouille(chasseur, t) {
    const p = chasseur.patrouille;
    const angle = p.phase0 + p.sens * p.vitesse * t;
    const x = p.centreX + Math.cos(angle) * p.rayon;
    const z = p.centreZ + Math.sin(angle) * p.rayon;
    const dansLeMonde = Math.abs(x) < world.size * .48 && Math.abs(z) < world.size * .48;
    const sol = dansLeMonde ? getHeight(x, z) : -999;
    const y = Math.max(sol + 45, p.altitude + Math.sin(t * .5 + p.phase0) * 18);
    return positionOrbite.set(x, y, z);
  }

  //  LES ORBITES SONT CENTREES SUR LE MILIEU DU MONDE, pas sur le point
  //  d'apparition. Celui-ci est pose au bord sud — z vaut 430 a 520 pour un
  //  monde qui s'arrete a 720 — et un etalement mesure depuis la aurait envoye
  //  la moitie de la flotte au-dessus du vide, hors du relief.
  //
  //  Chaque centre est place selon l'angle d'or, a un rayon en racine : dix
  //  points reellement etales, sans deux voisins colles ni trou au milieu — ce
  //  qu'un tirage au hasard ne garantit pas sur dix essais. Le placement est
  //  donc le meme d'une partie a l'autre, et le reglage se teste.
  //
  //  `PORTEE` borne le centre PLUS le rayon d'orbite : aucune patrouille ne
  //  franchit 0,42 fois la taille du monde, alors que le relief va jusqu'a 0,48.
  const PORTEE = world.size * .42;
  const flotte = Array.from({ length: FLOTTE }, (_, index) => {
    const angle = index * 2.39996;
    // Des cercles LARGES, 180 a 420 m. Un chasseur qui tourne sur 100 m se voit
    // tourner en rond ; sur 400 m il traverse le paysage et il faut le suivre.
    const rayon = 180 + (index % 4) * 80;
    const distance = (PORTEE - rayon) * Math.sqrt((index + .55) / FLOTTE);
    const chasseur = {
      index,
      mesh: new THREE.Group(),
      hp: 100, maxHp: 100, alive: true,
      // Le rayon suit la longueur du modele (0,575 x targetLength) : sans
      // cela les obus traverseraient les ailes du Kawasaki, plus large que
      // l'ancien appareil.
      radius: 15, phase: 0, holdUntil: 0, velocity: new THREE.Vector3(),
      // Decale d'un chasseur a l'autre : sans ce `index * .8`, dix appareils
      // armes en meme temps tirent en meme temps.
      riposteDelai: RIPOSTE_PREMIER_DELAI + index * .8,
      patrouille: {
        centreX: Math.cos(angle) * distance,
        centreZ: Math.sin(angle) * distance,
        rayon,
        altitude: world.spawn.air[1] + 4 + (index % 5) * 28,
        // La vitesse angulaire se DEDUIT d'une vitesse au sol de 72 a 120 m/s.
        // Fixer l'angle directement donnait un grand cercle parcouru au pas et
        // un petit cercle parcouru en trombe : la meme flotte, deux allures.
        // 16/09/2026 : +50 % sur les trois allures (48-80 -> 72-120 m/s). La
        // flotte passe du chasseur a helice au jet ; l'ecart entre allures est
        // majore du meme facteur pour que la flotte garde son etalement.
        vitesse: (72 + (index % 3) * 24) / rayon,
        sens: index % 2 ? 1 : -1,
        phase0: angle
      }
    };
    chasseur.mesh.position.copy(poserSurPatrouille(chasseur, 0));
    scene.add(chasseur.mesh);
    return chasseur;
  });

  //  Un seul gabarit est telecharge : `createEnemyFighterModel` en rend un
  //  clone, qui partage geometrie et matieres avec les neuf autres. Dix
  //  appareils ne coutent donc pas dix fois un appareil.
  const ready = Promise.all(flotte.map(chasseur =>
    createEnemyFighterModel({ targetLength: 26, thrusters: true }).then(model => {
      chasseur.mesh.clear();
      chasseur.mesh.add(model);
      chasseur.mesh.userData.flames = model.userData.flames || [];
    })
  )).then(() => { document.body.dataset.enemyFighterModel = 'loaded'; })
    .catch(error => {
      document.body.dataset.enemyFighterModel = 'error';
      console.warn('[world-combat] modele ennemi Kawasaki non charge', error);
    });

  //  La cible courante, et le compte des vivants.
  let cible = flotte[0];
  const vivants = () => flotte.filter(chasseur => chasseur.alive);

  const bullets = [];
  const missiles = [];
  const missilesEnnemis = [];
  const missileSmoke = [];
  // Le pilote et les ennemis partagent le meme pool d'explosions lorsqu'il est
  // fourni par le monde ; sinon le module en cree un pour lui seul.
  // Le son du souffle est joue par world-explosion.js, pas ici : sinon deux
  // explosions se superposent a chaque destruction.
  const explosionSystem = sharedExplosions || createExplosionSystem({ scene, camera });
  const ownsExplosions = !sharedExplosions;
  let locked = false;
  let lockProgress = 0;
  let lockSearchHold = 0;
  let lockAnnounced = false;
  let forcedLockUntil = 0;
  let deniedUntil = 0;
  let gunCooldown = 0;
  let previousMissile = false;
  const targetKillCount = FLOTTE;
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

  function targetPoint() { return cible.mesh.position.clone(); }

  //  QUI EST LA CIBLE. Le plus proche du reticule a l'ecran ; a defaut — si
  //  aucun n'est dans le champ — le plus proche en distance. UN VERROUILLAGE EN
  //  COURS FIGE LE CHOIX : sans cela un chasseur qui traverse l'ecran vole le
  //  losange d'un autre au dernier moment, juste avant le tir.
  function choisirCible() {
    if (cible?.alive && (locked || performance.now() < forcedLockUntil)) return;
    let meilleur = null;
    let meilleurScore = Infinity;
    for (const chasseur of flotte) {
      if (!chasseur.alive) continue;
      const vue = projectPoint(chasseur.mesh.position);
      // Hors champ, on classe par distance DERRIERE tous les visibles — d'ou
      // les cent mille : aucun ecran ne fait cent mille pixels de large.
      const score = vue?.visible ? vue.screen : 1e5 + chasseur.mesh.position.distanceTo(player.position);
      if (score < meilleurScore) { meilleurScore = score; meilleur = chasseur; }
    }
    if (meilleur) cible = meilleur;
  }

  function getAimDirection() {
    const ndcY = 1 - aimVerticalRatio() * 2;
    const throughScope = new THREE.Vector3(0, ndcY, .42).unproject(camera);
    const cameraRay = throughScope.sub(camera.position).normalize();
    const aimPoint = camera.position.clone().addScaledVector(cameraRay, AIM_DISTANCE);
    return aimPoint.sub(player.position).normalize();
  }

  // La mise en scene complete vit desormais dans world-explosion.js, partagee
  // avec le crash du pilote contre un batiment.
  function spawnExplosion(position, scale = 1) {
    explosionSystem.spawn(position, scale, getHeight(position.x, position.z));
  }

  //  PLUS DE REAPPARITION. Les dix sont dans le monde des le decollage : quand
  //  le dernier tombe, la mission est finie. L'ennemi qui repoussait 1,8 s plus
  //  tard devant le nez du joueur n'etait pas une escadrille, c'etait un stand
  //  de tir — et c'est precisement ce qu'on remplace ici.
  function destroyEnemy(chasseur) {
    if (!chasseur?.alive) return;
    chasseur.alive = false;
    chasseur.hp = 0;
    spawnExplosion(chasseur.mesh.position.clone(), 3.2);
    scene.remove(chasseur.mesh);
    score += 100;
    kills++;
    // Le verrouillage ne tombe que si c'est LA cible qui vient d'exploser : un
    // chasseur abattu au canon a l'autre bout du ciel ne doit pas lacher le
    // losange que le joueur tient sur un autre.
    if (chasseur === cible) {
      locked = false;
      lockProgress = 0;
      lockSearchHold = 0;
      radarTarget.style.display = 'none';
      diamond.className = '';
      seekerDiamond.className = '';
      reticle.classList.remove('locked', 'acquiring', 'denied');
    }
    const restants = vivants();
    lockState.className = 'ok';
    lockState.textContent = `CIBLE DÉTRUITE · ${kills}/${targetKillCount}`;
    if (restants.length) {
      distanceState.textContent = `${restants.length} chasseur${restants.length > 1 ? 's' : ''} encore en vol`;
      choisirCible();
    } else {
      distanceState.textContent = 'Mission aérienne accomplie';
      radarTarget.style.display = 'none';
    }
    scoreState.textContent = `Score ${score} · chasseurs ${kills}/${targetKillCount}`;
  }

  function damageEnemy(chasseur, amount) {
    if (!chasseur?.alive) return;
    chasseur.hp = Math.max(0, chasseur.hp - amount);
    if (chasseur.hp <= 0) destroyEnemy(chasseur);
  }

  // Bouche de canon reutilisee : la boucle de tir ne doit rien allouer.
  const bouche = new THREE.Vector3();

  /** Une salve part des deux ailes a la fois, jamais de l'axe de l'appareil. */
  function tirerDepuis(position, direction) {
    const mesh = new THREE.Mesh(bulletGeometry, bulletMaterial);
    mesh.position.copy(position);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    mesh.renderOrder = 40;
    scene.add(mesh);
    bullets.push({ mesh, velocity: direction.clone().multiplyScalar(BULLET_SPEED), life: 2.3 });
  }

  function fireGun() {
    if (!cible?.alive) return;
    audio.gun();
    const direction = getAimDirection();
    // Les canons sont dans les ailes, a cote des rampes a missiles. Les bouches
    // viennent des ancrages de l'appareil : elles suivent le roulis sans un
    // calcul de plus, et personne ici n'a besoin de connaitre l'envergure.
    const appareil = player.userData.originalChasseur;
    if (appareil && window.RaphaelChasseur) {
      for (const nom of ['canonGauche', 'canonDroit']) {
        window.RaphaelChasseur.ancrageMonde(appareil, nom, bouche);
        tirerDepuis(bouche, direction);
      }
      return;
    }
    tirerDepuis(player.position.clone().addScaledVector(getForward().normalize(), 11), direction);
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
    if (!cible?.alive) return false;
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
    // Le missile part avec SA cible en poche. S'il s'en remettait a `cible`,
    // il changerait d'avis en vol des que le joueur regarde ailleurs.
    missiles.push({ mesh: body, velocity: direction.multiplyScalar(125), life: 9, trailClock: 0, guided, cible: guided ? cible : null });
    return true;
  }

  //  -- L'ENNEMI RIPOSTE ---------------------------------------------------
  //
  //  Jusqu'ici la flotte se promenait et se laissait descendre. Elle tire
  //  depuis le 16/09/2026, mais le premier niveau reste franchissable : un
  //  seul missile en l'air a la fois, un cone de tir etroit, et surtout un
  //  autodirecteur qui se laisse semer par une manoeuvre franche.

  const alerteMissile = document.getElementById('missile-alert');
  let alerteTenueJusqua = 0;

  //  MESURE DE LA MANOEUVRE DU JOUEUR. Les figures ne sont plus
  //  preprogrammees dans ce jeu — le pilote fait ses tonneaux au manche — il
  //  n'y a donc aucun drapeau « vrille en cours » a lire quelque part. On
  //  mesure ce que l'appareil FAIT, image par image : de combien son cap
  //  tourne, et de combien il roule autour de son propre axe.
  const avantJoueur = new THREE.Vector3();
  const hautJoueur = new THREE.Vector3();
  const avantPrecedent = new THREE.Vector3(0, 0, -1);
  const hautPrecedent = new THREE.Vector3(0, 1, 0);
  const hautProjete = new THREE.Vector3();
  const hautProjetePrecedent = new THREE.Vector3();
  let tauxVirage = 0;
  let tauxRoulis = 0;
  let manoeuvreMemoire = 0;

  function mesurerManoeuvre(dt) {
    if (dt <= 0) return;
    avantJoueur.set(0, 0, -1).applyQuaternion(player.quaternion).normalize();
    hautJoueur.set(0, 1, 0).applyQuaternion(player.quaternion).normalize();
    tauxVirage = avantPrecedent.angleTo(avantJoueur) / dt;
    //  Le roulis se mesure sur la composante du HAUT perpendiculaire a l'axe
    //  de vol. Sans cette projection, un simple virage compterait comme un
    //  tonneau et le missile se ferait semer par n'importe quoi.
    hautProjete.copy(hautJoueur).projectOnPlane(avantJoueur);
    hautProjetePrecedent.copy(hautPrecedent).projectOnPlane(avantJoueur);
    tauxRoulis = hautProjete.lengthSq() > 1e-6 && hautProjetePrecedent.lengthSq() > 1e-6
      ? hautProjetePrecedent.normalize().angleTo(hautProjete.normalize()) / dt
      : 0;
    avantPrecedent.copy(avantJoueur);
    hautPrecedent.copy(hautJoueur);
    //  La memoire pardonne au pilote d'avoir commence sa figure un peu trop
    //  tot : ce qui compte est d'avoir manoeuvre, pas d'etre encore en train
    //  de le faire a l'image exacte ou le missile arrive.
    manoeuvreMemoire = tauxRoulis >= ESQUIVE_ROULIS || tauxVirage >= ESQUIVE_VIRAGE
      ? ESQUIVE_MEMOIRE
      : Math.max(0, manoeuvreMemoire - dt);
  }

  const joueurEsquive = () => manoeuvreMemoire > 0;

  function annoncerMissile(texte, classe, duree = 0) {
    if (!alerteMissile) return;
    alerteMissile.textContent = texte;
    alerteMissile.className = classe;
    alerteTenueJusqua = duree ? performance.now() + duree : 0;
  }

  function majAlerteMissile() {
    if (!alerteMissile || performance.now() < alerteTenueJusqua) return;
    const menace = missilesEnnemis.some(missile => !missile.perdu);
    if (menace) annoncerMissile('MISSILE — VRILLE OU BREAK !', 'on');
    else annoncerMissile('', '');
  }

  function tirerMissileEnnemi(chasseur) {
    const depart = chasseur.mesh.position.clone();
    const direction = player.position.clone().sub(depart).normalize();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(.24, .15, 4.2, 10),
      new THREE.MeshStandardMaterial({ color: 0x8f6a52, roughness: .42, metalness: .55 })
    );
    body.geometry.rotateX(Math.PI / 2);
    //  Le missile nait DEVANT le chasseur : ne sur son nez, il traverserait
    //  son propre tireur a la premiere image.
    body.position.copy(depart).addScaledVector(direction, 14);
    body.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
    addMissileFlame(body);
    scene.add(body);
    missilesEnnemis.push({
      mesh: body,
      velocity: direction.multiplyScalar(MISSILE_ENNEMI_VITESSE),
      life: MISSILE_ENNEMI_VIE,
      trailClock: 0,
      perdu: false,
      tireur: chasseur.index
    });
    audio.missile();
    annoncerMissile('MISSILE — VRILLE OU BREAK !', 'on');
    return true;
  }

  function updateRiposte(dt) {
    //  Le plafond de missiles en l'air se lit AVANT les delais : tant que le
    //  precedent vole, la flotte attend. C'est ce qui fait le niveau 1.
    if (missilesEnnemis.length >= RIPOSTE_MAX_EN_VOL) return;
    for (const chasseur of flotte) {
      if (!chasseur.alive) continue;
      chasseur.riposteDelai -= dt;
      if (chasseur.riposteDelai > 0) continue;
      const versJoueur = player.position.clone().sub(chasseur.mesh.position);
      const distance = versJoueur.length();
      if (distance > RIPOSTE_PORTEE || distance < RIPOSTE_DISTANCE_MINI) continue;
      //  Un chasseur tire de l'avant, jamais par la queue : son axe de vol
      //  est la direction dans laquelle son orbite l'emmene.
      if (chasseur.velocity.lengthSq() < .01) continue;
      if (chasseur.velocity.clone().normalize().dot(versJoueur.normalize()) < RIPOSTE_CONE) continue;
      tirerMissileEnnemi(chasseur);
      chasseur.riposteDelai = RIPOSTE_DELAI;
      return;
    }
  }

  function updateMissilesEnnemis(dt) {
    for (let index = missilesEnnemis.length - 1; index >= 0; index--) {
      const missile = missilesEnnemis[index];
      missile.life -= dt;
      missile.trailClock -= dt;
      if (missile.trailClock <= 0) {
        spawnMissileSmoke(missile.mesh.position);
        missile.trailClock = .035;
      }
      //  L'ESQUIVE, et c'est tout le niveau 1 : le missile ne se laisse
      //  berner qu'en approche finale, et UNE SEULE FOIS. Perdu, il file tout
      //  droit et ne se recale jamais — un break franc suffit donc, il n'y a
      //  pas de deuxieme passe a subir.
      if (!missile.perdu && missile.mesh.position.distanceTo(player.position) < ESQUIVE_DISTANCE && joueurEsquive()) {
        missile.perdu = true;
        annoncerMissile('MISSILE ESQUIVÉ', 'dodged', 1400);
      }
      if (!missile.perdu) {
        const desired = player.position.clone().sub(missile.mesh.position).normalize();
        missile.velocity.lerp(desired.multiplyScalar(MISSILE_ENNEMI_VITESSE), Math.min(1, dt * MISSILE_ENNEMI_VIRAGE));
      }
      missile.mesh.position.addScaledVector(missile.velocity, dt);
      if (missile.velocity.lengthSq() > 1) {
        missile.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), missile.velocity.clone().normalize());
      }
      const flame = missile.mesh.userData.missileFlame;
      if (flame) flame.scale.set(1 + Math.sin(performance.now() * .05) * .12, 1 + Math.sin(performance.now() * .066) * .18, 1);
      const touche = missile.mesh.position.distanceTo(player.position) < MISSILE_ENNEMI_RAYON;
      if (touche) {
        const impact = missile.mesh.position.clone();
        explosionSystem.spawn(impact, 1.7, getHeight(impact.x, impact.z));
        audio.explosion();
        annoncerMissile('TOUCHÉ', 'hit', 1200);
        //  Les degats ne sont pas ecrits ici : la coque, ses pastilles et la
        //  destruction appartiennent au monde. Le combat se contente de dire
        //  ou le missile a frappe.
        onPlayerHit?.(impact);
      }
      if (touche || missile.life <= 0) {
        scene.remove(missile.mesh);
        missilesEnnemis.splice(index, 1);
      }
    }
    majAlerteMissile();
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
    if (!cible?.alive) return null;
    return projectPoint(targetPoint());
  }

  //  TOUTE la flotte avance, y compris ce qui est derriere le joueur. Un monde
  //  qui ne bouge que dans le champ de la camera se trahit au premier demi-tour.
  //
  //  L'ancien ennemi etait accroche au joueur : sa position se calculait a
  //  560 m devant SON nez, il ne se baladait donc nulle part et il etait
  //  impossible de le semer. C'est cet ancrage qui disparait ici.
  const deplacement = new THREE.Vector3();
  function updateFlotte(dt, elapsed) {
    for (const chasseur of flotte) {
      if (!chasseur.alive) continue;
      chasseur.phase += dt;
      if (performance.now() >= chasseur.holdUntil) {
        // On rejoint l'orbite en douceur au lieu d'y sauter : apres un
        // `placeTargetAhead` le chasseur est loin de son cercle, et un
        // rattrapage instantane le ferait disparaitre d'un coup.
        deplacement.copy(chasseur.mesh.position);
        chasseur.mesh.position.lerp(poserSurPatrouille(chasseur, elapsed), Math.min(1, dt * .9));
        deplacement.subVectors(chasseur.mesh.position, deplacement);
        chasseur.velocity.copy(deplacement).multiplyScalar(1 / Math.max(dt, .001));
        if (deplacement.lengthSq() > .0001) {
          const yaw = Math.atan2(-deplacement.x, -deplacement.z);
          // L'inclinaison suit le sens de l'orbite : un avion qui tourne en
          // rond a plat n'a pas l'air de voler.
          chasseur.mesh.rotation.set(Math.sin(elapsed * .7 + chasseur.index) * .05, yaw, -chasseur.patrouille.sens * .34);
        }
      }
      if (performance.now() < chasseur.holdUntil) chasseur.velocity.multiplyScalar(Math.max(0, 1 - dt * 5));
      (chasseur.mesh.userData.flames || []).forEach((flame, index) => flame.scale.setScalar(.85 + Math.sin(elapsed * 35 + index + chasseur.index) * .08));
    }
  }

  //  LE RADAR MONTRE LES DIX. Disperser la flotte sur la carte sans l'afficher
  //  revenait a cacher neuf avions : rien n'aurait dit ou aller. Le losange
  //  rouge reste LA CIBLE, les autres sont des echos plus discrets.
  const radarEchoes = flotte.map(() => {
    const echo = document.createElement('i');
    echo.className = 'radar-echo';
    radarTarget.parentElement.insertBefore(echo, radarTarget);
    return echo;
  });

  // Vecteurs de travail : la boucle passe dix fois par image, elle n'alloue rien.
  const radarOffset = new THREE.Vector3();
  const radarForward = new THREE.Vector3();
  const radarRight = new THREE.Vector3();

  function poserBlip(element, position, wobbleX = 0, wobbleY = 0) {
    radarOffset.copy(position).sub(player.position);
    const distance = Math.hypot(radarOffset.x, radarOffset.z);
    const maxRange = 1200;
    const scale = Math.min(1, maxRange / Math.max(1, distance));
    const rightAmount = radarOffset.dot(radarRight) * scale / maxRange;
    const forwardAmount = radarOffset.dot(radarForward) * scale / maxRange;
    element.style.display = 'block';
    element.style.left = `${50 + THREE.MathUtils.clamp(rightAmount, -.44, .44) * 100 + wobbleX}%`;
    element.style.top = `${50 - THREE.MathUtils.clamp(forwardAmount, -.44, .44) * 100 + wobbleY}%`;
  }

  function updateRadar() {
    radarForward.copy(getForward()).setY(0).normalize();
    radarRight.set(-radarForward.z, 0, radarForward.x);
    flotte.forEach((chasseur, index) => {
      const echo = radarEchoes[index];
      // La cible est portee par `#radar-target`, pas par son echo : sans ce
      // retrait les deux pastilles se superposeraient sur le meme avion.
      if (!chasseur.alive || chasseur === cible) { echo.style.display = 'none'; return; }
      poserBlip(echo, chasseur.mesh.position);
    });
    if (!cible?.alive) { radarTarget.style.display = 'none'; return; }
    const acquiring = lockProgress > 0 && !locked;
    poserBlip(
      radarTarget, cible.mesh.position,
      acquiring ? Math.sin(performance.now() * .027) * 2.8 : 0,
      acquiring ? Math.cos(performance.now() * .021) * 2.2 : 0
    );
  }

  function updateLock(dt) {
    if (!cible?.alive) return;
    const aim = projectTarget();
    const forced = performance.now() < forcedLockUntil;
    const insideCapture = !!(aim?.visible && aim.screen <= LOCK_CAPTURE_RADIUS);
    const retain = !!(locked && aim?.visible && aim.screen <= LOCK_RELEASE_RADIUS);
    if (forced && cible.alive) {
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
    const overlapsMobileHud = innerWidth <= 720 && aim && aim.sx > innerWidth - 155 && aim.sy < 292;
    if (aim?.visible && aim.screen < 300 && !overlapsMobileHud) {
      const acquisitionRatio = locked ? 1 : THREE.MathUtils.clamp(lockProgress / LOCK_ACQUIRE_TIME, 0, 1);
      const searchStrength = insideCapture && !locked ? 1 - acquisitionRatio : 0;
      const phase = performance.now() * .0042;
      // Le chercheur part large et se resserre : son ecart est `searchStrength`,
      // qui tombe a zero au verrouillage. Trois harmoniques incommensurables
      // au lieu de deux — la trajectoire ne se referme jamais sur elle-meme et
      // le balayage garde l'air de chercher plutot que de tourner en rond.
      // Excursion maximale : 134 px en x, 92 px en y.
      const orbitX = searchStrength * (Math.cos(phase) * 104 + Math.sin(phase * 2.3) * 21 + Math.sin(phase * 4.7) * 9);
      const orbitY = searchStrength * (Math.sin(phase) * 70 + Math.cos(phase * 1.7) * 15 + Math.cos(phase * 3.9) * 7);
      const targetX = THREE.MathUtils.clamp(aim.sx, 39, innerWidth - 39);
      const targetY = THREE.MathUtils.clamp(aim.sy, 39, innerHeight - 39);
      diamond.style.left = `${targetX}px`;
      diamond.style.top = `${targetY}px`;
      diamond.classList.add('visible');
      // Le rectangle n'apparait QUE pendant l'acquisition. Hors du cone,
      // `searchStrength` vaut zero : il se posait donc pile sur le losange des
      // l'apparition de la cible, et on voyait un losange a carre au lieu d'un
      // losange seul. D'abord le losange seul sur l'avion, ensuite le
      // rectangle qui vient le retrouver.
      if (insideCapture || locked) {
        seekerDiamond.style.left = `${THREE.MathUtils.clamp(targetX + orbitX, 39, innerWidth - 39)}px`;
        seekerDiamond.style.top = `${THREE.MathUtils.clamp(targetY + orbitY, 39, innerHeight - 39)}px`;
        seekerDiamond.classList.add('visible');
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
    healthFill.style.transform = `scaleX(${cible.hp / cible.maxHp})`;
    scoreState.textContent = `PV ${cible.hp}/${cible.maxHp} · En vol ${vivants().length}/${targetKillCount} · Score ${score}`;
  }

  function updateProjectiles(dt) {
    for (let index = bullets.length - 1; index >= 0; index--) {
      const bullet = bullets[index];
      const previous = bullet.mesh.position.clone();
      bullet.life -= dt;
      bullet.mesh.position.addScaledVector(bullet.velocity, dt);
      // L'obus est teste contre TOUTE la flotte, pas contre la seule cible :
      // sinon on tire au milieu d'un chasseur non vise sans rien lui faire.
      let touche = null;
      for (const chasseur of flotte) {
        if (!chasseur.alive) continue;
        if (segmentDistance(chasseur.mesh.position, previous, bullet.mesh.position) <= chasseur.radius) { touche = chasseur; break; }
      }
      if (touche) damageEnemy(touche, 10);
      if (touche || bullet.life <= 0) {
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
      if (missile.cible?.alive) {
        const desired = missile.cible.mesh.position.clone().sub(missile.mesh.position).normalize();
        missile.velocity.lerp(desired.multiplyScalar(280), Math.min(1, dt * 3.5));
      }
      missile.mesh.position.addScaledVector(missile.velocity, dt);
      if (missile.velocity.lengthSq() > 1) missile.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), missile.velocity.clone().normalize());
      const flame = missile.mesh.userData.missileFlame;
      if (flame) flame.scale.set(1 + Math.sin(performance.now() * .045) * .12, 1 + Math.sin(performance.now() * .061) * .18, 1);
      // Tout missile qui touche compte, guide ou non. Le test exigeait
      // `missile.guided` : un missile tire sans verrouillage traversait
      // l'appareil sans rien faire, ce qui n'a aucun sens a l'impact.
      let percute = null;
      for (const chasseur of flotte) {
        if (!chasseur.alive) continue;
        if (missile.mesh.position.distanceTo(chasseur.mesh.position) < chasseur.radius + 2) { percute = chasseur; break; }
      }
      if (percute) damageEnemy(percute, 100);
      if (percute || missile.life <= 0) {
      scene.remove(missile.mesh);
        missiles.splice(index, 1);
      }
    }
    updateMissilesEnnemis(dt);
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
    // Un pool partage est mis a jour une seule fois, par le monde lui-meme.
    if (ownsExplosions) explosionSystem.update(dt);
  }

  function update(dt, elapsed, pad, keys, touch) {
    gunCooldown -= dt;
    // La manoeuvre du joueur se mesure AVANT tout le reste : les missiles
    // ennemis liront le taux de roulis de CETTE image, pas de la precedente.
    mesurerManoeuvre(dt);
    updateFlotte(dt, elapsed);
    // Le choix de cible vient APRES le deplacement et AVANT le radar : sinon le
    // losange se pose une image en retard sur une position deja perimee.
    choisirCible();
    updateRadar();
    updateLock(dt);
    updateProjectiles(dt);
    updateRiposte(dt);
    audio.updateEngine(getSpeed());
    if (pad.fire || pad.missile || pad.boost || pad.throttle > .08) audio.ensure();

    const fireHeld = !!(keys.Space || keys.KeyF || touch.fire || pad.fire);
    if (fireHeld && gunCooldown <= 0) {
      fireGun();
      // Canon lent, 8,4 coups par seconde. A la cadence d'une mitrailleuse on
      // n'entend plus les coups, seulement un ronflement : un canon d'avion se
      // compte, il ne bourdonne pas. 7 coups/s etait le premier reglage juge
      // bon, releve de 20 % a l'essai suivant.
      gunCooldown = .119;
    }
    const missileHeld = !!(keys.KeyG || keys.KeyM || touch.missile || pad.missile);
    if (missileHeld && !previousMissile) {
      fireMissile(locked);
    }
    previousMissile = missileHeld;
  }

  //  Amene UN chasseur devant le nez et l'y tient 12 s : de quoi verifier le
  //  cadrage en vol sans courir apres la flotte.
  function placeTargetAhead(distance = 340) {
    const chasseur = cible?.alive ? cible : (vivants()[0] || flotte[0]);
    if (!chasseur.alive) {
      chasseur.alive = true;
      chasseur.hp = chasseur.maxHp;
      scene.add(chasseur.mesh);
    }
    cible = chasseur;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    chasseur.mesh.position.copy(camera.position).addScaledVector(forward.normalize(), distance);
    chasseur.mesh.rotation.y = player.rotation.y;
    chasseur.holdUntil = performance.now() + 12000;
    return chasseur.mesh.position.toArray();
  }

  return {
    active: true,
    ready,
    update,
    playExplosionSound: () => audio.explosion(),
    diagnostics: {
      active: true,
      state: () => ({ hp: cible.hp, alive: cible.alive, locked, lockProgress, missileQueued: false, missilesLeft, kills, targetKillCount, flotte: FLOTTE, tailleMonde: world.size, porteePatrouilles: PORTEE, ennemisVivants: vivants().length, cibleIndex: cible.index, positionsFlotte: vivants().map(chasseur => ({ index: chasseur.index, hp: chasseur.hp, position: chasseur.mesh.position.toArray(), distance: chasseur.mesh.position.distanceTo(player.position) })), mountedMissiles: (player.userData.missileRacks || []).filter(item => item.visible).length, activeMissiles: missiles.length, guidedMissiles: missiles.filter(item => item.guided).length, score, targetPosition: cible.mesh.position.toArray(), targetDistance: cible.mesh.position.distanceTo(player.position), bulletSpeed: BULLET_SPEED, aimVerticalRatio: aimVerticalRatio(), missilesEnnemis: missilesEnnemis.length, missilesEnnemisPerdus: missilesEnnemis.filter(missile => missile.perdu).length, tauxRoulis: +tauxRoulis.toFixed(2), tauxVirage: +tauxVirage.toFixed(2), esquive: joueurEsquive() }),
      placeTargetAhead,
      forceLock: () => { forcedLockUntil = performance.now() + 2500; locked = true; lockProgress = LOCK_ACQUIRE_TIME; return true; },
      fireMissile,
      //  Fait tirer le chasseur vise sur-le-champ : verifier une esquive en
      //  vol ne doit pas dependre du hasard d'une patrouille bien orientee.
      forcerRiposte: () => {
        const chasseur = cible?.alive ? cible : vivants()[0];
        if (!chasseur) return false;
        chasseur.riposteDelai = RIPOSTE_DELAI;
        return tirerMissileEnnemi(chasseur);
      },
      destroyTarget: () => destroyEnemy(cible),
      destroyAll: () => { flotte.forEach(chasseur => destroyEnemy(chasseur)); return kills; }
    }
  };
}
