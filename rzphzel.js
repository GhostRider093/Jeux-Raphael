// VARIABLES
let scene, camera, renderer;
let player;
let playerMode = "scooter";
let velocity = { x:0, z:0, y:0 };
let onGround = true;
let keys = {};
let buildings = [];
let poles = [];
let waterways = [];
let bridgeMarkers = [];
let elevationMarkers = [];
let parkMarkers = [];
let editorObjects = [];
let collidableObjects = [];
let onScooter = true;
let minimapCanvas, minimapCtx;
const MAP_SIZE = 180;
const MINI_PX  = 200;
const ISLAND_RADIUS = 158;  // rayon de l'Ã®le en unitÃ©s monde
const BEACH_OUTER_RADIUS = ISLAND_RADIUS + 5;
const WATER_SINK_RADIUS = BEACH_OUTER_RADIUS + 8;
let offRoad = false;
let gameStarted = false;
let animationFrameId = null;
let isSinking = false;
let sinkTimer = 0;
let sinkStart = { x: 0, y: 0, z: 0 };
let mapEditor = null;
let valleyPortal = null;
let valleyPortalTriggered = false;

// â”€â”€ CAMÃ‰RA LIBRE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let cameraYaw   = 0;    // angle orbital horizontal (0 = derriÃ¨re le joueur)
let cameraPitch = 0.35; // angle orbital vertical
let cameraZoom  = 14;   // distance de base
let pointerLocked = false;

// â”€â”€ MOUVEMENT DIRECTIONNEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let playerYaw = 0;       // direction de la trottinette (radians)
let speed = 0;           // vitesse scalaire courante
const MAX_SPEED   = 0.45;
const MAX_BOOST   = 0.80;
const ACCEL       = 0.022;
const BRAKE_FORCE = 0.055;
const FRICTION_G  = 0.93;
const TURN_SPD    = 0.048;

let flightPitch = 0;
let flightVisualPitch = 0;
let flightSpeed = 0;
let flightAerobatic = null;
let flightAerobaticArmed = true;
let flightGamepadIndex = null;
let flightGamepadStatus = "manette non detectee";
let groundGamepadIndex = null;
let groundGamepadStatus = "manette non detectee";
let lastGroundGamepadButtons = [];
const FLIGHT_MIN_ALTITUDE = 7;
const FLIGHT_MAX_ALTITUDE = 150;
const FLIGHT_WORLD_LIMIT = 188;
const FLIGHT_MAX_SPEED = 72;
const FLIGHT_CRUISE_SPEED = 22;
const FLIGHT_ACCEL_RATE = 2.7;
const FLIGHT_YAW_RATE = 1.55;
const FLIGHT_PITCH_RATE = 0.95;
const GAMEPAD_DEAD_ZONE = 0.18;

// â”€â”€ STATE MACHINE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// IDLE | MOVE | BOOST | BRAKE | JUMP | FALL | LAND
let scooterState = 'IDLE';
let landTimer    = 0;

// â”€â”€ ANIMATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let leanAngle  = 0;
let wheelFront = null;
let wheelBack  = null;
let wheelRot   = 0;
let mechModel = null;
let mechMixer = null;
let mechActions = {};
let mechActiveAction = null;
let mechActiveName = "";
let titanModel = null;
let titanMixer = null;
let titanActions = {};
let titanActiveAction = null;
let titanActiveName = "";
let titanManualActionName = "";
let titanManualActionUntil = 0;
let titanBones = null;        // { leftThigh, rightThigh, leftShin, rightShin, spine }
let titanBoneRest = null;     // rotations de référence (Euler) à charger
let titanJumpBlend = 0;       // 0 = pose anim, 1 = pose accroupi (lissé)
let titanJumpWasActive = false;
let pinstripeModel = null;
let pinstripeMixer = null;
let pinstripeActions = {};
let pinstripeActiveAction = null;
let pinstripeActiveName = "";
let pinstripeManualActionName = "";
let pinstripeManualActionUntil = 0;
let pinstripeWalkPhase = 0;
let carModel = null;
let carAudio = null;
let roadDecorModel = null;
let cityBuildingsModel = null;
let lastFrameTime = performance.now();

const MECH_ASSET_ROOT = "./assets/Retro_UnderWaterAssets_Freebees/Mech/";
const ASSET_VERSION = "cartoon-road-textures-20260503";
const CAR_MODEL_PATH = `./assets/Model.fbx?v=${ASSET_VERSION}`;
const ROAD_DECOR_PATH = `./assets/Free_cartoon_road.fbx?v=${ASSET_VERSION}`;
const ROAD_TEXTURE_PATH = `./assets/Cartoon_road/Sourceimages/Road_concrete/Road_concrete_Diff_1001.jpg?v=${ASSET_VERSION}`;
const ROAD_ITEM_TEXTURE_PATH = `./assets/Cartoon_road/Sourceimages/Road_item/Item_cartoon_Diff_1001.jpg?v=${ASSET_VERSION}`;
const USE_ROAD_DECOR_MODEL = false;
const CENTER_CITY_BUILDINGS_PATH = "./assets/City_Buildlings_ThreeJS.3mf?v=center-3mf-city-buildings-20260529";
const CENTER_CITY_BUILDINGS_FOOTPRINT = 42;
const CENTER_CITY_BUILDINGS_PLAYER_START_Z = 36;
const MECH_ANIMATIONS = {
  Idle: "A_ISO_Mech_Idle_01.fbx",
  WalkForward: "A_ISO_Mech_WalkForward_01.fbx",
  WalkBackward: "A_ISO_Mech_WalkBackward_01.fbx",
  WalkLeft: "A_ISO_Mech_Walk_L_01.fbx",
  WalkRight: "A_ISO_Mech_Walk_R_01.fbx",
  Landing: "A_ISO_Mech_Landing_01.fbx",
  Death: "A_ISO_Mech_Death_01.fbx"
};

const TITAN_ASSET_ROOT = "./perso/Meshy_AI_Azure_Titan_biped/";
const TITAN_BASE_FILE  = "Meshy_AI_Azure_Titan_biped_Animation_Walking_withSkin.glb";
const TITAN_MERGED_FILE = "Meshy_AI_Azure_Titan_biped_Meshy_AI_Meshy_Merged_Animations.glb";
const USE_TITAN_MERGED_ANIMATIONS = true;
const TITAN_ANIMATIONS = {
  Walking: "Meshy_AI_Azure_Titan_biped_Animation_Walking_withSkin.glb",
  Jogging: "Meshy_AI_Azure_Titan_biped_Animation_Jogging_w050_withSkin.glb",
  Running: "Meshy_AI_Azure_Titan_biped_Animation_Running_withSkin.glb"
};

const PINSTRIPE_ASSET_ROOT = "./perso/Meshy_AI_Pinstripe_Shadows/";
const PINSTRIPE_FILE       = "Meshy_AI_Pinstripe_Shadows_rigged_animations.glb";

// CHASSEUR_MODEL_PATH / chasseurModel / loadChasseurModel : voir chasseur.js
// WARGUN_MODEL_PATH / wargunModel / loadWargunModel       : voir wargun.js

// â”€â”€ PARTICULES POUSSIÃˆRE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let dustParticles = null;
let dustPositions = null;
const DUST_COUNT  = 80;

// RÃ©seau de routes : segments {x1,z1,x2,z2,width}
const ROAD_WIDTH = 12;
const WATER_COURSE_WIDTH = 7;
const BRIDGE_DECK_WIDTH = 18;
const BRIDGE_DECK_LENGTH = 8;
const CITY_ROAD_COORDS = [-120, -80, -40, 0, 40, 80, 120];
const CITY_BLOCK_CENTERS = [-100, -60, -20, 20, 60, 100];
const roads = createCityRoads();

function cityRoadWidth(coord) {
  if (coord === 0) return 18;
  if (Math.abs(coord) === 120) return 13;
  if (Math.abs(coord) === 80) return 12;
  return 11;
}

function cityRoadLimit(coord) {
  const edge = ISLAND_RADIUS - 9;
  return Math.floor(Math.sqrt(Math.max(0, edge * edge - coord * coord)));
}

function createCityRoads() {
  const cityRoads = [];
  CITY_ROAD_COORDS.forEach(z => {
    const limit = cityRoadLimit(z);
    cityRoads.push({ x1: -limit, z1: z, x2: limit, z2: z, width: cityRoadWidth(z) });
  });
  CITY_ROAD_COORDS.forEach(x => {
    const limit = cityRoadLimit(x);
    cityRoads.push({ x1: x, z1: -limit, x2: x, z2: limit, width: cityRoadWidth(x) });
  });
  return cityRoads;
}

const MAP_DECOR_OBJECTS = [
  {
    id: 7,
    type: "cours d'eau",
    position: { x: 93.2, z: 2.25 },
    collidable: false,
    settings: {
      x1: 91.95421284680394,
      z1: -85.20757223032656,
      x2: 94.45296863068447,
      z2: 89.7053326413114
    }
  },
  { id: 8, type: "pont", position: { x: 93.17, z: 0 }, collidable: false, settings: {} },
  {
    id: 9,
    type: "cours d'eau",
    position: { x: 53.22, z: -110.07 },
    collidable: false,
    settings: {
      x1: 91.45446169002787,
      z1: -85.95719896549073,
      x2: 14.992534703283233,
      z2: -134.18318559438518
    }
  },
  {
    id: 10,
    type: "cours d'eau",
    position: { x: -32.61, z: -129.94 },
    collidable: false,
    settings: {
      x1: 14.992534703283233,
      z1: -134.18318559438518,
      x2: -80.2100606625654,
      z2: -125.68741592919135
    }
  },
  { id: 11, type: "pont", position: { x: 0, z: -132.85 }, collidable: false, settings: {} },
  {
    id: 12,
    type: "cours d'eau",
    position: { x: -113.82, z: -72.84 },
    collidable: false,
    settings: {
      x1: -80.95968739772955,
      z1: -126.4370426643555,
      x2: -146.67696451378782,
      z2: -19.240419535880243
    }
  },
  {
    id: 13,
    type: "cours d'eau",
    position: { x: -147.18, z: 21.74 },
    collidable: false,
    settings: {
      x1: -147.17671567056394,
      z1: -18.740668379104136,
      x2: -147.17671567056394,
      z2: 62.219019018625424
    }
  },
  { id: 14, type: "pont", position: { x: -147.18, z: 0 }, collidable: false, settings: {} },
  { id: 15, type: "pont", position: { x: -147.18, z: 60 }, collidable: false, settings: {} },
  {
    id: 16,
    type: "cours d'eau",
    position: { x: -65.47, z: 97.58 },
    collidable: false,
    settings: {
      x1: -143.17870641635506,
      z1: 60.71976554829711,
      x2: 12.243903341014676,
      z2: 134.4330611727731
    }
  },
  { id: 17, type: "pont", position: { x: 0, z: 128.63 }, collidable: false, settings: {} },
  {
    id: 18,
    type: "cours d'eau",
    position: { x: 54.6, z: 111.94 },
    collidable: false,
    settings: {
      x1: 13.493281232954903,
      z1: 134.4330611727731,
      x2: 95.70234652262477,
      z2: 89.45545706292333
    }
  },
  {
    id: 19,
    type: "cours d'eau",
    position: { x: -15.12, z: -11.12 },
    collidable: false,
    settings: {
      x1: 49.22548894244666,
      z1: -111.44450796107226,
      x2: -79.46043392740123,
      z2: 89.2055814845353
    }
  },
  { id: 20, type: "pont", position: { x: 29.06, z: -80 }, collidable: false, settings: {} },
  { id: 21, type: "pont", position: { x: 0, z: -34.69 }, collidable: false, settings: {} },
  { id: 22, type: "pont", position: { x: -22.25, z: 0 }, collidable: false, settings: {} },
  { id: 23, type: "pont", position: { x: -60.73, z: 60 }, collidable: false, settings: {} }
];

// START
// Modes qui utilisent le contrÃ´leur de vol (avion qui se bat dans les airs)
function isFlyingMode(mode){
  const activeMode = mode || playerMode;
  return activeMode === "fly" || activeMode === "chasseur" || activeMode === "wargun";
}

function createValleyPortal() {
  const portal = new THREE.Group();
  portal.position.set(0, 48, -172);

  const outerRing = new THREE.Mesh(
    new THREE.TorusGeometry(10, 1.15, 16, 64),
    new THREE.MeshBasicMaterial({
      color: 0x52e5ff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(7.6, 0.34, 12, 48),
    new THREE.MeshBasicMaterial({
      color: 0xb76cff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  const energy = new THREE.Mesh(
    new THREE.CircleGeometry(8.7, 48),
    new THREE.MeshBasicMaterial({
      color: 0x258dff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  energy.position.z = 0.05;
  portal.add(outerRing, innerRing, energy);
  portal.userData.outerRing = outerRing;
  portal.userData.innerRing = innerRing;
  portal.userData.energy = energy;
  scene.add(portal);
  valleyPortal = portal;
}

function showValleyLoadingTransition() {
  let overlay = document.getElementById("world-transition");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "world-transition";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "18px",
      background: "radial-gradient(circle, rgba(30,132,255,.72), rgba(3,8,24,.98) 68%)",
      color: "#dffaff",
      font: "700 28px monospace",
      letterSpacing: "4px",
      textAlign: "center",
      zIndex: "9999",
      opacity: "0",
      transition: "opacity .28s ease"
    });
    overlay.innerHTML = '<div>TRANSFERT VERS LA VALLÉE</div><div style="font-size:14px;letter-spacing:2px;opacity:.8">CHARGEMENT DU SECTEUR...</div>';
    document.body.appendChild(overlay);
  }
  requestAnimationFrame(() => { overlay.style.opacity = "1"; });
}

function updateValleyPortal(delta, now) {
  if (!valleyPortal || valleyPortalTriggered) return;
  valleyPortal.rotation.z += delta * 0.55;
  valleyPortal.userData.innerRing.rotation.z -= delta * 1.4;
  const pulse = 1 + Math.sin(now * 0.004) * 0.055;
  valleyPortal.scale.setScalar(pulse);
  valleyPortal.userData.energy.material.opacity = 0.18 + Math.sin(now * 0.006) * 0.07;

  if (!player || player.position.distanceTo(valleyPortal.position) > 12) return;
  valleyPortalTriggered = true;
  valleyPortal.visible = false;
  showValleyLoadingTransition();
  setTimeout(() => {
    window.location.href = "vallee.html?mode=chasseur&from=city";
  }, 900);
}

function start(mode){
  if (gameStarted) return;
  gameStarted = true;
  playerMode = ["scooter", "mech", "car", "titan", "pinstripe", "chasseur", "wargun", "fly"].includes(mode) ? mode : "scooter";

  const menu = document.getElementById("menu");
  const hud = document.getElementById("hud");
  if (menu) menu.style.display="none";
  if (hud) hud.style.display="block";
  init();
}

function init(){
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8c7d9);
  lastFrameTime = performance.now();

  camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
  camera.position.set(0,5,10);

  renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  let light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(10, 20, 10);
  scene.add(light);

  let ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  let fillLight = new THREE.DirectionalLight(0x8888ff, 0.4);
  fillLight.position.set(-5, 3, -4);
  scene.add(fillLight);

  // EAU (grand plan bleu autour de l'Ã®le)
  const waterMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3000, 3000),
    new THREE.MeshStandardMaterial({ color: 0x1565a8, roughness: 0.05, metalness: 0.3 })
  );
  waterMesh.rotation.x = -Math.PI/2;
  waterMesh.position.y = -0.35;
  scene.add(waterMesh);

  // Socle de la ville
  const islandMesh = new THREE.Mesh(
    new THREE.CircleGeometry(ISLAND_RADIUS, 96),
    new THREE.MeshStandardMaterial({ color: 0x5f6962, roughness: 0.9 })
  );
  islandMesh.rotation.x = -Math.PI/2;
  islandMesh.position.y = 0;
  scene.add(islandMesh);

  // Quais autour de la ville
  const beachMesh = new THREE.Mesh(
    new THREE.RingGeometry(ISLAND_RADIUS - 10, BEACH_OUTER_RADIUS, 96),
    new THREE.MeshStandardMaterial({ color: 0xb8ad95, roughness: 0.8 })
  );
  beachMesh.rotation.x = -Math.PI/2;
  beachMesh.position.y = 0.005;
  scene.add(beachMesh);

  // ROUTES 3D
  const roadTexture = new THREE.TextureLoader().load(ROAD_TEXTURE_PATH);
  roadTexture.wrapS = THREE.RepeatWrapping;
  roadTexture.wrapT = THREE.RepeatWrapping;
  roadTexture.repeat.set(1, 10);
  const roadMat     = new THREE.MeshStandardMaterial({ color: 0xffffff, map: roadTexture, roughness: 0.72 });
  const lineMatW    = new THREE.MeshStandardMaterial({ color: 0xffffff });
  const lineMatY    = new THREE.MeshStandardMaterial({ color: 0xffdd00 });

  roads.forEach(r => {
    const dx = r.x2 - r.x1, dz = r.z2 - r.z1;
    const len = Math.sqrt(dx*dx + dz*dz);
    const angle = Math.atan2(dx, dz);
    const cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
    const roadWidth = r.width || ROAD_WIDTH;

    // asphalte
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(roadWidth, len),
      roadMat
    );
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = angle;
    road.position.set(cx, 0.035, cz);
    scene.add(road);

    // bandes blanches latÃ©rales
    [-1, 1].forEach(side => {
      const stripe = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, len),
        lineMatW
      );
      stripe.rotation.x = -Math.PI / 2;
      stripe.rotation.z = angle;
      const ox = Math.cos(angle) * (roadWidth/2 - 0.4) * side;
      const oz = -Math.sin(angle) * (roadWidth/2 - 0.4) * side;
      stripe.position.set(cx + ox, 0.055, cz + oz);
      scene.add(stripe);
    });

    // tirets jaunes au centre
    const dashLen = 4, gap = 4;
    const steps = Math.floor(len / (dashLen + gap));
    const dirX = dx / len, dirZ = dz / len;
    for (let i = 0; i < steps; i++) {
      const t = -len/2 + i*(dashLen+gap) + dashLen/2;
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.25, dashLen),
        lineMatY
      );
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = angle;
      dash.position.set(cx + dirZ*t, 0.06, cz + dirX*t);
      scene.add(dash);
    }
  });

  createTerrainFeatures();
  loadCenterCityBuildings();
  if (USE_ROAD_DECOR_MODEL) loadRoadDecor();

  // JOUEUR
  player = buildPlayerForMode(playerMode);
  if (isFlyingMode()) {
    player.position.set(0, 42, 96);
    playerYaw = 0;
    cameraYaw = 0;
    cameraPitch = 0.22;
    cameraZoom = 22;
    flightPitch = 0;
    flightVisualPitch = 0;
    flightSpeed = FLIGHT_CRUISE_SPEED;
    flightGamepadIndex = null;
    flightGamepadStatus = "manette non detectee";
    onGround = false;
    velocity = { x: 0, y: 0, z: -flightSpeed };
  } else {
    player.position.set(0, 0, CENTER_CITY_BUILDINGS_PLAYER_START_Z);
  }
  scene.add(player);
  if (playerMode === "mech") loadMechCharacter();
  if (playerMode === "titan") loadTitanCharacter();
  if (playerMode === "pinstripe") loadPinstripeCharacter();
  if (playerMode === "car") {
    loadCarModel();
    startCarAudio();
  }
  if (playerMode === "chasseur" || playerMode === "fly") loadChasseurModel();
  if (playerMode === "wargun") loadWargunModel();
  if (isFlyingMode()) findFlightGamepad();
  else findGroundGamepad();

  document.addEventListener("keydown", e=>{
    keys[e.code]=true;
    if(e.code==="KeyM" && typeof openGamepadMapper === "function") openGamepadMapper();
    if(e.code==="KeyE") onScooter=!onScooter;
    if(e.code==="KeyF" && playerMode === "titan") triggerTitanAction("Double_Combo_Attack");
    if(e.code==="KeyF" && playerMode === "pinstripe") triggerPinstripeAction("Double_Combo_Attack");
  });

  document.addEventListener("keyup", e=>keys[e.code]=false);

  // â”€â”€ CAMÃ‰RA LIBRE â€” Pointer Lock â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  renderer.domElement.addEventListener("click", () => {
    if (mapEditor && mapEditor.enabled) return;
    if (!pointerLocked) renderer.domElement.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
  });
  document.addEventListener("mousemove", e => {
    if (!pointerLocked) return;
    cameraYaw   -= e.movementX * 0.003;
    cameraPitch  = Math.max(0.05, Math.min(1.45, cameraPitch - e.movementY * 0.003));
  });
  document.addEventListener("wheel", e => {
    cameraZoom = Math.max(5, Math.min(40, cameraZoom + e.deltaY * 0.02));
  }, { passive: true });
  window.addEventListener("gamepadconnected", event => {
    if (!isIgnoredGamepad(event.gamepad)) {
      groundGamepadIndex = event.gamepad.index;
      flightGamepadIndex = event.gamepad.index;
    }
    if (isFlyingMode()) {
      findFlightGamepad();
    } else {
      findGroundGamepad();
    }
  });
  window.addEventListener("gamepaddisconnected", event => {
    if (groundGamepadIndex === event.gamepad.index) groundGamepadIndex = null;
    if (flightGamepadIndex === event.gamepad.index) flightGamepadIndex = null;
    lastGroundGamepadButtons = [];
    if (isFlyingMode()) {
      findFlightGamepad();
    } else {
      findGroundGamepad();
    }
  });
  window.addEventListener("resize", handleResize);
  if (!isFlyingMode()) initMapEditor();

  // â”€â”€ PARTICULES POUSSIÃˆRE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const dustGeo = new THREE.BufferGeometry();
  dustPositions = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT * 3; i++) dustPositions[i] = 9999;
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({ color: 0xc8b896, size: 0.22, transparent: true, opacity: 0 });
  dustParticles = new THREE.Points(dustGeo, dustMat);
  scene.add(dustParticles);

  createValleyPortal();

  animate();

  // MINIMAP
  minimapCanvas = document.createElement("canvas");
  minimapCanvas.width  = MINI_PX;
  minimapCanvas.height = MINI_PX;
  Object.assign(minimapCanvas.style, {
    position: "absolute",
    bottom: "16px",
    right: "16px",
    border: "2px solid rgba(255,255,255,0.5)",
    borderRadius: "6px",
    background: "rgba(0,0,0,0.55)",
    zIndex: "99"
  });
  document.body.appendChild(minimapCanvas);
  minimapCtx = minimapCanvas.getContext("2d");

  // Exposer les globaux nécessaires aux modules externes (ulvheim.js, etc.)
  window.scene = scene;
  window.collidableObjects = collidableObjects;
  window.dispatchEvent(new Event('sceneready'));
}

function buildPlayerForMode(mode) {
  if (mode === "mech") return buildMechPlayer();
  if (mode === "titan") return buildTitanPlayer();
  if (mode === "pinstripe") return buildPinstripePlayer();
  if (mode === "chasseur") return buildStlPlaceholderPlayer(0xc0392b, false);
  if (mode === "wargun") return buildStlPlaceholderPlayer(0x7d3c98, false);
  if (mode === "car") return buildCarPlayer();
  if (mode === "fly") return buildStlPlaceholderPlayer(0x888888, false);  // unifie : utilise l'OBJ chasseur
  return buildScooter();
}

function buildFlyPlane() {
  wheelFront = null;
  wheelBack = null;

  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd6dde6, roughness: 0.42, metalness: 0.12 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0x1f72d1, roughness: 0.5, metalness: 0.08 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1f27, roughness: 0.74 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x7fc4ff, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.62 });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff0a0, emissive: 0xffd36a, emissiveIntensity: 0.9 });

  function addPart(geo, mat, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  }

  addPart(new THREE.CylinderGeometry(0.34, 0.44, 3.25, 24), bodyMat, 0, 0.35, -0.15, -Math.PI / 2, 0, 0);
  addPart(new THREE.ConeGeometry(0.43, 0.85, 24), bodyMat, 0, 0.35, -2.2, -Math.PI / 2, 0, 0);
  addPart(new THREE.BoxGeometry(5.6, 0.12, 0.55), stripeMat, 0, 0.32, -0.35);
  addPart(new THREE.BoxGeometry(2.15, 0.1, 0.36), stripeMat, 0, 0.42, 1.32);
  addPart(new THREE.BoxGeometry(0.14, 0.92, 0.45), stripeMat, 0, 0.92, 1.48, -0.08, 0, 0);
  addPart(new THREE.SphereGeometry(0.46, 24, 12), glassMat, 0, 0.75, -0.78);
  addPart(new THREE.BoxGeometry(0.5, 0.08, 1.55), darkMat, 0, 0.12, 0.78);
  addPart(new THREE.SphereGeometry(0.1, 12, 8), lightMat, -2.6, 0.38, -0.35);
  addPart(new THREE.SphereGeometry(0.1, 12, 8), lightMat, 2.6, 0.38, -0.35);

  const prop = new THREE.Group();
  prop.position.set(0, 0.35, -2.72);
  const bladeGeo = new THREE.BoxGeometry(1.15, 0.08, 0.05);
  const bladeA = new THREE.Mesh(bladeGeo, darkMat);
  const bladeB = new THREE.Mesh(bladeGeo, darkMat);
  bladeB.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 10), darkMat);
  prop.add(bladeA, bladeB, hub);
  g.add(prop);
  g.userData.propeller = prop;

  return g;
}

// CONSTRUIRE TROTTINETTE 3D
function buildScooter() {
  const g = new THREE.Group();
  const S = 2; // Ã©chelle

  const matRed   = new THREE.MeshStandardMaterial({ color: 0xe01020, roughness: 0.35, metalness: 0.2 });
  const matMetal = new THREE.MeshStandardMaterial({ color: 0xb0b8c0, roughness: 0.25, metalness: 0.85 });
  const matDark  = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6,  metalness: 0.2 });
  const matBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8,  metalness: 0.0 });
  const matGrip  = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1.0,  metalness: 0.0 });
  const matSpoke = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3,  metalness: 0.9 });

  function part(geo, mat, x, y, z, rx, ry, rz, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x*S, y*S, z*S);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    (parent || g).add(m);
    return m;
  }

  // Deck
  part(new THREE.BoxGeometry(0.18*S, 0.055*S, 1.15*S), matRed,   0, 0.50, 0.04);
  part(new THREE.BoxGeometry(0.14*S, 0.008*S, 0.95*S), matGrip,  0, 0.53, 0.04);
  part(new THREE.BoxGeometry(0.18*S, 0.040*S, 0.12*S), matRed,   0, 0.50, -0.58, -0.18);
  part(new THREE.BoxGeometry(0.18*S, 0.040*S, 0.14*S), matRed,   0, 0.52,  0.60,  0.22);
  // Garde-boue
  part(new THREE.BoxGeometry(0.18*S, 0.025*S, 0.28*S), matRed,   0, 0.565, 0.60);

  // Roues
  function buildWheel(zPos) {
    const wg = new THREE.Group();
    wg.position.set(0, 0.22*S, zPos*S);
    const tire = new THREE.Mesh(new THREE.TorusGeometry(0.22*S, 0.055*S, 14, 40), matBlack);
    tire.rotation.y = Math.PI / 2;
    wg.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.17*S, 0.17*S, 0.04*S, 28), matSpoke);
    rim.rotation.z = Math.PI / 2;
    wg.add(rim);
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.007*S, 0.007*S, 0.32*S, 6), matSpoke);
      sp.rotation.z = Math.PI / 2;
      sp.rotation.y = a;
      wg.add(sp);
    }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.028*S, 0.028*S, 0.07*S, 12), matMetal);
    hub.rotation.z = Math.PI / 2;
    wg.add(hub);
    g.add(wg);
    return wg;
  }
  wheelBack  = buildWheel( 0.52);  // arriÃ¨re
  wheelFront = buildWheel(-0.52);  // avant

  // Fourche avant
  part(new THREE.CylinderGeometry(0.018*S, 0.018*S, 0.30*S, 10), matMetal, 0, 0.37, -0.52);

  // Tige de direction
  const stem = new THREE.Group();
  stem.position.set(0, 0.49*S, -0.46*S);
  stem.rotation.x = -0.3;
  g.add(stem);
  part(new THREE.CylinderGeometry(0.02*S, 0.02*S, 0.72*S, 10), matMetal, 0, 0.36, 0, 0, 0, 0, stem);
  part(new THREE.CylinderGeometry(0.032*S, 0.032*S, 0.04*S, 12), matDark, 0, 0.01, 0, 0, 0, 0, stem);

  // Guidon
  const hbY = 0.72;
  part(new THREE.CylinderGeometry(0.016*S, 0.016*S, 0.58*S, 10), matMetal, 0, hbY, 0, 0, 0, Math.PI/2, stem);
  part(new THREE.CylinderGeometry(0.025*S, 0.025*S, 0.12*S, 12), matGrip,  0.31, hbY, 0, 0, 0, Math.PI/2, stem);
  part(new THREE.CylinderGeometry(0.025*S, 0.025*S, 0.12*S, 12), matGrip, -0.31, hbY, 0, 0, 0, Math.PI/2, stem);
  const leverGeo = new THREE.BoxGeometry(0.012*S, 0.06*S, 0.1*S);
  part(leverGeo, matDark,  0.21, hbY-0.03, 0.02, 0.3, 0, 0, stem);
  part(leverGeo, matDark, -0.21, hbY-0.03, 0.02, 0.3, 0, 0, stem);

  // â”€â”€ PERSONNAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const matSkin   = new THREE.MeshStandardMaterial({ color: 0xf4a460, roughness: 0.8 });
  const matShirt  = new THREE.MeshStandardMaterial({ color: 0x2255cc, roughness: 0.9 });
  const matPants  = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
  const matShoe   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const matHelmet = new THREE.MeshStandardMaterial({ color: 0xee2200, roughness: 0.3, metalness: 0.3 });
  const matVisor  = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0.1, metalness: 0.5, transparent: true, opacity: 0.6 });

  const rider = new THREE.Group();
  rider.position.set(0, 0.555*S, 0.05*S);
  g.add(rider);

  function rpart(geo, mat, x, y, z, rx, ry, rz, parent) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x*S, y*S, z*S);
    if (rx) m.rotation.x = rx;
    if (ry) m.rotation.y = ry;
    if (rz) m.rotation.z = rz;
    m.castShadow = true;
    (parent || rider).add(m);
    return m;
  }

  // Pieds
  rpart(new THREE.BoxGeometry(0.09*S, 0.055*S, 0.18*S), matShoe, -0.07, 0.028,  0.18);
  rpart(new THREE.BoxGeometry(0.09*S, 0.055*S, 0.18*S), matShoe,  0.07, 0.028,  0.18);
  // Jambes
  rpart(new THREE.BoxGeometry(0.085*S, 0.30*S, 0.085*S), matPants, -0.07, 0.20, 0.14);
  rpart(new THREE.BoxGeometry(0.085*S, 0.30*S, 0.085*S), matPants,  0.07, 0.20, 0.14);
  // Cuisses
  const thL = new THREE.Mesh(new THREE.BoxGeometry(0.095*S, 0.32*S, 0.095*S), matPants);
  thL.position.set(-0.07*S, 0.49*S, 0.08*S); thL.rotation.x = -0.18; rider.add(thL);
  const thR = thL.clone(); thR.position.set(0.07*S, 0.49*S, 0.08*S); rider.add(thR);
  // Bassin
  rpart(new THREE.BoxGeometry(0.26*S, 0.13*S, 0.18*S), matPants, 0, 0.67, 0.06);
  // Torse
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28*S, 0.38*S, 0.18*S), matShirt);
  torso.position.set(0, 0.90*S, 0.02*S); torso.rotation.x = -0.15; rider.add(torso);
  // Cou
  rpart(new THREE.CylinderGeometry(0.055*S, 0.055*S, 0.10*S, 10), matSkin, 0, 1.13, -0.01);
  // TÃªte
  rpart(new THREE.BoxGeometry(0.22*S, 0.24*S, 0.22*S), matSkin, 0, 1.30, -0.01);
  // Casque
  const helmetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.135*S, 16, 12), matHelmet);
  helmetMesh.scale.set(1, 0.88, 1);
  helmetMesh.position.set(0, 1.38*S, -0.01*S); rider.add(helmetMesh);
  rpart(new THREE.BoxGeometry(0.24*S, 0.03*S, 0.08*S), matHelmet, 0, 1.27, -0.11, -0.2);
  rpart(new THREE.BoxGeometry(0.18*S, 0.05*S, 0.06*S), matVisor,  0, 1.30, -0.13, -0.3);
  // Yeux
  rpart(new THREE.BoxGeometry(0.045*S, 0.030*S, 0.015*S), matDark, -0.06, 1.28, -0.115);
  rpart(new THREE.BoxGeometry(0.045*S, 0.030*S, 0.015*S), matDark,  0.06, 1.28, -0.115);

  // Bras gauche
  const armL = new THREE.Group();
  armL.position.set(-0.17*S, 0.96*S, -0.04*S);
  armL.rotation.set(1.07, 0, -0.385);
  rider.add(armL);
  rpart(new THREE.BoxGeometry(0.075*S, 0.40*S, 0.075*S), matShirt, 0, -0.20, 0, 0, 0, 0, armL);
  rpart(new THREE.BoxGeometry(0.065*S, 0.32*S, 0.065*S), matSkin,  0, -0.56, 0, 0, 0, 0, armL);
  rpart(new THREE.BoxGeometry(0.07*S,  0.12*S, 0.09*S),  matSkin,  0, -0.78, 0, 0, 0, 0, armL);
  // Bras droit
  const armR = new THREE.Group();
  armR.position.set(0.17*S, 0.96*S, -0.04*S);
  armR.rotation.set(1.07, 0, 0.385);
  rider.add(armR);
  rpart(new THREE.BoxGeometry(0.075*S, 0.40*S, 0.075*S), matShirt, 0, -0.20, 0, 0, 0, 0, armR);
  rpart(new THREE.BoxGeometry(0.065*S, 0.32*S, 0.065*S), matSkin,  0, -0.56, 0, 0, 0, 0, armR);
  rpart(new THREE.BoxGeometry(0.07*S,  0.12*S, 0.09*S),  matSkin,  0, -0.78, 0, 0, 0, 0, armR);

  return g;
}

function buildMechPlayer() {
  const g = new THREE.Group();
  const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x23d5c8, roughness: 0.45, metalness: 0.25 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.8), placeholderMat);
  body.position.y = 0.9;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.55, 0.65), placeholderMat);
  head.position.y = 2.05;
  g.add(body, head);
  g.userData.placeholder = [body, head];
  return g;
}

function buildTitanPlayer() {
  const g = new THREE.Group();
  const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x4a90e2, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.1, 0.9), placeholderMat);
  body.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.7), placeholderMat);
  head.position.y = 2.4;
  g.add(body, head);
  g.userData.placeholder = [body, head];
  return g;
}

function buildPinstripePlayer() {
  const g = new THREE.Group();
  const placeholderMat = new THREE.MeshStandardMaterial({ color: 0x2a2a35, roughness: 0.55, metalness: 0.15 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.9, 0.7), placeholderMat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.6), placeholderMat);
  head.position.y = 2.2;
  g.add(body, head);
  g.userData.placeholder = [body, head];
  return g;
}

function removePlayerPlaceholder() {
  if (!player || !player.userData.placeholder) return;
  player.userData.placeholder.forEach(part => player.remove(part));
  player.userData.placeholder = null;
}

function hasRenderableMesh(root) {
  let meshCount = 0;
  let vertexCount = 0;
  root.traverse(node => {
    if (!(node.isMesh || node.type === "Mesh" || (node.geometry && node.material)) || node.visible === false) return;
    meshCount++;
    const position = node.geometry && node.geometry.attributes && node.geometry.attributes.position;
    vertexCount += position ? position.count : 0;
  });

  if (!meshCount || !vertexCount) return false;
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);
  return Number.isFinite(maxAxis) && maxAxis > 0.01;
}

function loadPinstripeCharacter() {
  if (!window.GLTFLoader) {
    window.addEventListener("gltfloaderready", loadPinstripeCharacter, { once: true });
    return;
  }

  const loader = new window.GLTFLoader();
  loader.load(PINSTRIPE_ASSET_ROOT + PINSTRIPE_FILE, gltf => {
    pinstripeModel = gltf.scene;
    const pinstripeStats = { meshes: 0, skinnedMeshes: 0, normalMaps: 0 };
    pinstripeModel.traverse(node => {
      if (!node.isMesh) return;
      pinstripeStats.meshes++;
      if (node.isSkinnedMesh) pinstripeStats.skinnedMeshes++;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
      enhancePinstripeMaterial(node);
      if (node.material && node.material.normalMap) pinstripeStats.normalMaps++;
    });

    fitPinstripeToPlayer(pinstripeModel);
    pinstripeModel.userData.hasSkin = pinstripeStats.skinnedMeshes > 0;
    pinstripeModel.userData.baseY = pinstripeModel.position.y;
    pinstripeModel.userData.baseRotationX = pinstripeModel.rotation.x;
    pinstripeModel.userData.baseRotationZ = pinstripeModel.rotation.z;

    player.add(pinstripeModel);
    if (hasRenderableMesh(pinstripeModel)) removePlayerPlaceholder();

    if (gltf.animations && gltf.animations.length) {
      pinstripeMixer = new THREE.AnimationMixer(pinstripeModel);
      registerPinstripeAnimationClips(gltf.animations);
      if (pinstripeActions.Idle) playPinstripeAnimation("Idle", 0);
      else if (pinstripeActions.Walking) playPinstripeAnimation("Walking", 0);
      else if (Object.keys(pinstripeActions).length) playPinstripeAnimation(Object.keys(pinstripeActions)[0], 0);
    } else {
      console.warn("[Pinstripe] Aucun clip d'animation dans ce GLB; animation procedurale deplacement activee.");
    }

    if (!pinstripeStats.normalMaps) {
      console.warn("[Pinstripe] Aucune normal map detectee sur les materiaux charges.");
    }
    if (!pinstripeStats.skinnedMeshes) {
      console.warn("[Pinstripe] Aucun SkinnedMesh/rig detecte dans ce GLB.");
    }
  }, undefined, error => {
    console.error("Erreur chargement Pinstripe:", error);
  });
}

function registerPinstripeAnimationClips(clips) {
  pinstripeActions = {};
  clips.forEach((clip, index) => {
    const originalName = clip.name || "PinstripeClip" + index;
    clip.name = normalizePinstripeClipName(originalName);
    const action = pinstripeMixer.clipAction(clip);
    action.enabled = true;
    if (/jump|attack|combo/i.test(clip.name)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    pinstripeActions[clip.name] = action;
  });
}

function normalizePinstripeClipName(name) {
  if (/idle|stand/i.test(name)) return "Idle";
  if (/running|run/i.test(name)) return "Running";
  if (/walking|walk/i.test(name)) return "Walking";
  if (/jump/i.test(name)) return "Basic_Jump";
  if (/double.*combo|combo.*attack|attack/i.test(name)) return "Double_Combo_Attack";
  return name.replace(/\s+/g, "_");
}

function playPinstripeAnimation(name, fade) {
  if (!pinstripeActions[name] || pinstripeActiveName === name) return;
  const nextAction = pinstripeActions[name];
  const fadeTime = fade === undefined ? 0.18 : fade;

  nextAction.reset();
  nextAction.enabled = true;
  nextAction.fadeIn(fadeTime);
  nextAction.play();

  if (pinstripeActiveAction) pinstripeActiveAction.fadeOut(fadeTime);
  pinstripeActiveAction = nextAction;
  pinstripeActiveName = name;
}

function triggerPinstripeAction(name) {
  if (!pinstripeActions[name]) return;
  const action = pinstripeActions[name];
  const duration = action.getClip ? action.getClip().duration * 1000 : 900;
  pinstripeManualActionName = name;
  pinstripeManualActionUntil = performance.now() + Math.max(500, duration);
  playPinstripeAnimation(name, 0.08);
}

function enhancePinstripeMaterial(mesh) {
  const source = mesh.material || {};
  const enhanced = new THREE.MeshStandardMaterial({
    map: source.map || null,
    normalMap: source.normalMap || null,
    roughnessMap: source.roughnessMap || null,
    metalnessMap: source.metalnessMap || null,
    emissiveMap: source.emissiveMap || null,
    color: source.color ? source.color.clone() : new THREE.Color(0xffffff),
    emissive: source.emissive ? source.emissive.clone() : new THREE.Color(0x111111),
    emissiveIntensity: source.emissiveMap ? 0.35 : 0.08,
    roughness: source.roughness !== undefined ? source.roughness : 0.58,
    metalness: source.metalness !== undefined ? source.metalness : 0.22,
    side: THREE.DoubleSide
  });

  if (enhanced.map) {
    if (THREE.SRGBColorSpace) enhanced.map.colorSpace = THREE.SRGBColorSpace;
    else enhanced.map.encoding = THREE.sRGBEncoding;
    enhanced.map.anisotropy = 8;
  }
  if (enhanced.emissiveMap) {
    if (THREE.SRGBColorSpace) enhanced.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    else enhanced.emissiveMap.encoding = THREE.sRGBEncoding;
    enhanced.emissiveMap.anisotropy = 8;
  }
  [enhanced.normalMap, enhanced.roughnessMap, enhanced.metalnessMap].forEach(texture => {
    if (!texture) return;
    texture.anisotropy = 8;
  });
  if (enhanced.normalMap) {
    enhanced.normalScale = new THREE.Vector2(1.35, 1.35);
  }

  enhanced.needsUpdate = true;
  mesh.material = enhanced;
}

function fitPinstripeToPlayer(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  const scale = 2.4 / maxAxis;

  root.scale.setScalar(scale);
  root.rotation.y = Math.PI;

  const fittedBox = new THREE.Box3().setFromObject(root);
  const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
  root.position.x -= fittedCenter.x;
  root.position.z -= fittedCenter.z;
  root.position.y -= fittedBox.min.y;
}

function updatePinstripeAnimation(delta) {
  if (playerMode !== "pinstripe") return;

  if (pinstripeMixer) {
    pinstripeMixer.update(delta);
    if (!Object.keys(pinstripeActions).length) return;

    if (pinstripeManualActionName && performance.now() < pinstripeManualActionUntil && pinstripeActions[pinstripeManualActionName]) {
      return;
    }
    pinstripeManualActionName = "";

    if ((scooterState === "JUMP" || scooterState === "FALL") && pinstripeActions.Basic_Jump) {
      playPinstripeAnimation("Basic_Jump", 0.08);
      return;
    }

    let target = speed < 0.03 && pinstripeActions.Idle ? "Idle" : "Walking";
    if (speed > 0.42 && pinstripeActions.Running) target = "Running";
    else if (speed < 0.03 && pinstripeActions.Idle) target = "Idle";
    else if (!pinstripeActions.Walking && pinstripeActions.Running) target = "Running";

    playPinstripeAnimation(target);

    if (pinstripeActiveAction) {
      const baseTimeScale = pinstripeActiveName === "Idle" ? 1
                         : pinstripeActiveName === "Walking" ? Math.max(0.35, speed / 0.25)
                         : pinstripeActiveName === "Basic_Jump" ? 1
                         : Math.max(0.7, speed / 0.65);
      pinstripeActiveAction.timeScale = baseTimeScale;
    }
    return;
  }

  if (pinstripeModel && !pinstripeMixer) updatePinstripeProcedural(delta);
}

function updatePinstripeProcedural(delta) {
  const moving = speed > 0.02;
  const intensity = Math.min(speed / MAX_SPEED, 1);
  const baseY = pinstripeModel.userData.baseY || 0;
  const baseRotationX = pinstripeModel.userData.baseRotationX || 0;
  const baseRotationZ = pinstripeModel.userData.baseRotationZ || 0;

  pinstripeWalkPhase += delta * (moving ? 6 + intensity * 9 : 1.4);
  pinstripeModel.position.y = baseY + (moving ? Math.abs(Math.sin(pinstripeWalkPhase)) * 0.045 * intensity : Math.sin(pinstripeWalkPhase) * 0.008);
  pinstripeModel.rotation.x = baseRotationX + (moving ? Math.sin(pinstripeWalkPhase * 2) * 0.025 * intensity : 0);
  pinstripeModel.rotation.z = baseRotationZ + (moving ? Math.sin(pinstripeWalkPhase) * 0.075 * intensity : 0);
}

function buildCarPlayer() {
  wheelFront = null;
  wheelBack = null;

  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf0b429, roughness: 0.45, metalness: 0.18 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x89c6ff, roughness: 0.14, metalness: 0.25, transparent: true, opacity: 0.72 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.82 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.62, 3.4), bodyMat);
  body.position.y = 0.72;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.62, 1.35), glassMat);
  cabin.position.set(0, 1.18, -0.15);

  const wheels = [];
  [-0.88, 0.88].forEach(x => {
    [-1.05, 1.05].forEach(z => {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.28, 28), tireMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.35, z);
      wheels.push(wheel);
    });
  });

  g.add(body, cabin, ...wheels);
  g.userData.placeholder = [body, cabin, ...wheels];
  return g;
}

function loadCarModel() {
  if (!window.FBXLoader) {
    window.addEventListener("fbxloaderready", loadCarModel, { once: true });
    return;
  }

  const loader = new window.FBXLoader();
  loader.load(CAR_MODEL_PATH, model => {
    carModel = model;
    carModel.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
      if (node.material) node.material.side = THREE.DoubleSide;
    });

    fitCarToPlayer(carModel);
    player.add(carModel);
    if (hasRenderableMesh(carModel)) removePlayerPlaceholder();
  }, undefined, error => {
    console.error("Erreur chargement voiture:", error);
  });
}

function fitCarToPlayer(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  const scale = 4.42 / maxAxis;

  root.scale.setScalar(scale);
  root.rotation.y = 0;

  const fittedBox = new THREE.Box3().setFromObject(root);
  const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
  root.position.x -= fittedCenter.x;
  root.position.z -= fittedCenter.z;
  root.position.y -= fittedBox.min.y;
}

// â”€â”€ MODÃˆLES STL (chasseur / wargun) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildStlPlaceholderPlayer(color, visible = true) {
  wheelFront = null;
  wheelBack = null;
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 3.2), mat);
  body.position.y = 0.7;
  body.visible = visible;          // invisible = le temps que le vrai modele charge
  g.add(body);
  g.userData.placeholder = [body];
  return g;
}

function loadStlModel(path, scaleTarget, onLoaded, errLabel) {
  if (!window.STLLoader) {
    window.addEventListener("stlloaderready", () => loadStlModel(path, scaleTarget, onLoaded, errLabel), { once: true });
    return;
  }
  const loader = new window.STLLoader();
  loader.load(path, geometry => {
    geometry.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.55, metalness: 0.45 });
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const wrapper = new THREE.Group();
    wrapper.add(mesh);
    onLoaded(wrapper, mesh);        // orientation spÃ©cifique au modÃ¨le
    fitStlToPlayer(wrapper, scaleTarget);
    player.add(wrapper);
    if (hasRenderableMesh(wrapper)) removePlayerPlaceholder();
  }, undefined, error => {
    console.error("Erreur chargement " + errLabel + ":", error);
  });
}

function fitStlToPlayer(root, scaleTarget) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z) || 1;
  root.scale.setScalar(scaleTarget / maxAxis);

  const fittedBox = new THREE.Box3().setFromObject(root);
  const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
  root.position.x -= fittedCenter.x;
  root.position.z -= fittedCenter.z;
  root.position.y -= fittedBox.min.y;
}

// loadChasseurModel() : deplace dans chasseur.js (fichier dedie au perso)

// loadWargunModel() : deplace dans wargun.js (fichier dedie au perso)

function loadCenterCityBuildings() {
  if (!window.ThreeMFLoader) {
    window.addEventListener("threemfloaderready", loadCenterCityBuildings, { once: true });
    return;
  }

  const loader = new window.ThreeMFLoader();
  loader.load(CENTER_CITY_BUILDINGS_PATH, object => {
    cityBuildingsModel = object;
    cityBuildingsModel.name = "City Buildings 3MF Center";
    cityBuildingsModel.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
      enhanceCenterCityBuildingMaterial(node);
    });

    fitCenterCityBuildings(cityBuildingsModel);
    scene.add(cityBuildingsModel);
    buildings.push(cityBuildingsModel);
    collidableObjects.push(cityBuildingsModel);
  }, undefined, error => {
    console.error("Erreur chargement City Buildlings 3MF:", error);
  });
}

function enhanceCenterCityBuildingMaterial(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.filter(Boolean).forEach(material => {
    material.side = THREE.DoubleSide;
    if (material.map) {
      if (THREE.SRGBColorSpace) material.map.colorSpace = THREE.SRGBColorSpace;
      else material.map.encoding = THREE.sRGBEncoding;
      material.map.anisotropy = 8;
    }
    material.needsUpdate = true;
  });
}

function fitCenterCityBuildings(root) {
  root.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);

  let box = new THREE.Box3().setFromObject(root);
  let size = box.getSize(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z) || 1;
  const scale = CENTER_CITY_BUILDINGS_FOOTPRINT / footprint;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y += 0.08 - box.min.y;
  root.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(root);
  size = box.getSize(new THREE.Vector3());
  root.userData.mapWidth = size.x;
  root.userData.mapDepth = size.z;
  root.userData.collisionRadius = Math.max(size.x, size.z) * 0.55;
  root.userData.collidable = true;
}

function loadRoadDecor() {
  if (!window.FBXLoader) {
    window.addEventListener("fbxloaderready", loadRoadDecor, { once: true });
    return;
  }

  const loader = new window.FBXLoader();
  const roadDecorMaterials = buildRoadDecorTextureMaterials();
  loader.setResourcePath("./assets/Cartoon_road/Sourceimages/");
  loader.load(ROAD_DECOR_PATH, model => {
    roadDecorModel = model;
    roadDecorModel.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
      node.material = pickRoadDecorTextureMaterial(node, roadDecorMaterials);
    });

    fitRoadDecorToMap(roadDecorModel);
    scene.add(roadDecorModel);
  }, undefined, error => {
    console.error("Erreur chargement decor route:", error);
  });
}

function buildRoadDecorTextureMaterials() {
  const textureLoader = new THREE.TextureLoader();
  const concrete = textureLoader.load(ROAD_TEXTURE_PATH);
  const item = textureLoader.load(ROAD_ITEM_TEXTURE_PATH);

  [concrete, item].forEach(texture => {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else texture.encoding = THREE.sRGBEncoding;
  });
  concrete.repeat.set(2, 2);
  item.repeat.set(1, 1);

  return {
    road: new THREE.MeshStandardMaterial({ color: 0xffffff, map: concrete, roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide }),
    item: new THREE.MeshStandardMaterial({ color: 0xffffff, map: item, roughness: 0.78, metalness: 0.04, side: THREE.DoubleSide }),
    dark: new THREE.MeshStandardMaterial({ color: 0x30343c, roughness: 0.84, side: THREE.DoubleSide })
  };
}

function pickRoadDecorTextureMaterial(node, materials) {
  const names = [
    node.name || "",
    node.parent && node.parent.name || "",
    node.material && node.material.name || ""
  ].join(" ").toLowerCase();

  if (/road|street|turn|basic|concrete|cross|end|t_/.test(names)) return materials.road.clone();
  if (/item|sign|barrier|cone|prop|asset|cartoon/.test(names)) return materials.item.clone();
  return materials.item.clone();
}

function fitRoadDecorToMap(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxHorizontal = Math.max(size.x, size.z) || 1;
  const scale = 230 / maxHorizontal;

  root.scale.setScalar(scale);
  root.position.x -= center.x * scale;
  root.position.z -= center.z * scale;

  const fittedBox = new THREE.Box3().setFromObject(root);
  root.position.y += 0.045 - fittedBox.min.y;
}

function startCarAudio() {
  if (carAudio || !window.AudioContext && !window.webkitAudioContext) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextClass();
  const engine = ctx.createOscillator();
  const growl = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  engine.type = "sawtooth";
  growl.type = "square";
  engine.frequency.value = 58;
  growl.frequency.value = 29;
  filter.type = "lowpass";
  filter.frequency.value = 460;
  filter.Q.value = 7;
  gain.gain.value = 0.0001;

  engine.connect(filter);
  growl.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  engine.start();
  growl.start();

  carAudio = { ctx, engine, growl, filter, gain };
  if (ctx.state === "suspended") ctx.resume();
}

function updateCarAudio(isAccelerating, isBoosting) {
  if (playerMode !== "car" || !carAudio) return;

  const { ctx, engine, growl, filter, gain } = carAudio;
  if (ctx.state === "suspended") ctx.resume();

  const speedRatio = Math.min(speed / MAX_BOOST, 1);
  const throttle = isAccelerating ? 1 : 0;
  const boost = isBoosting ? 1 : 0;
  const targetFreq = 50 + speedRatio * 104 + throttle * 48 + boost * 34;
  const targetGrowl = targetFreq * 0.48;
  const targetFilter = 260 + speedRatio * 780 + throttle * 560;
  const targetGain = 0.008 + speedRatio * 0.034 + throttle * 0.058 + boost * 0.018;
  const continuousGain = isAccelerating ? targetGain : Math.min(targetGain, 0.022 + speedRatio * 0.012);
  const idleGain = speed < 0.01 && !isAccelerating ? 0.006 : continuousGain;

  engine.frequency.setTargetAtTime(targetFreq, ctx.currentTime, 0.07);
  growl.frequency.setTargetAtTime(targetGrowl, ctx.currentTime, 0.08);
  filter.frequency.setTargetAtTime(targetFilter, ctx.currentTime, 0.09);
  gain.gain.setTargetAtTime(idleGain, ctx.currentTime, 0.08);
}

function loadMechCharacter() {
  if (!window.FBXLoader) {
    window.addEventListener("fbxloaderready", loadMechCharacter, { once: true });
    return;
  }

  const loader = new window.FBXLoader();
  const textureLoader = new THREE.TextureLoader();
  const material = buildMechMaterial(textureLoader);

  loader.load(MECH_ASSET_ROOT + "Model/SK_ISO_Mech.fbx", model => {
    mechModel = model;
    mechModel.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
      node.material = material.clone();
    });

    fitMechToPlayer(mechModel);
    if (player.userData.placeholder) {
      player.userData.placeholder.forEach(part => player.remove(part));
      player.userData.placeholder = null;
    }

    player.add(mechModel);
    mechMixer = new THREE.AnimationMixer(mechModel);
    loadMechAnimations(loader);
  }, undefined, error => {
    console.error("Erreur chargement Mech:", error);
  });
}

function buildMechMaterial(textureLoader) {
  const textureRoot = MECH_ASSET_ROOT + "Textures/";
  const baseColor = textureLoader.load(textureRoot + "T_Mech_Base_Color.png");
  const normal = textureLoader.load(textureRoot + "T_Mech_Normal.png");
  const roughness = textureLoader.load(textureRoot + "T_Mech_Roughness.png");
  const metalness = textureLoader.load(textureRoot + "T_Mech_Metallic.png");
  const emissive = textureLoader.load(textureRoot + "T_Mech_Emissive.png");

  if (THREE.SRGBColorSpace) {
    baseColor.colorSpace = THREE.SRGBColorSpace;
    emissive.colorSpace = THREE.SRGBColorSpace;
  } else {
    baseColor.encoding = THREE.sRGBEncoding;
    emissive.encoding = THREE.sRGBEncoding;
  }

  [baseColor, normal, roughness, metalness, emissive].forEach(texture => {
    texture.flipY = true;
    texture.anisotropy = 8;
  });

  return new THREE.MeshStandardMaterial({
    map: baseColor,
    normalMap: normal,
    roughnessMap: roughness,
    metalnessMap: metalness,
    emissiveMap: emissive,
    emissive: new THREE.Color(0x66fff2),
    emissiveIntensity: 0.55,
    roughness: 0.82,
    metalness: 0.58
  });
}

function fitMechToPlayer(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);
  const scale = 2.45 / maxAxis;

  root.scale.setScalar(scale);
  root.rotation.y = Math.PI;

  const fittedBox = new THREE.Box3().setFromObject(root);
  const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
  root.position.x -= fittedCenter.x;
  root.position.z -= fittedCenter.z;
  root.position.y -= fittedBox.min.y;
}

function loadMechAnimations(loader) {
  Object.keys(MECH_ANIMATIONS).forEach(name => {
    loader.load(MECH_ASSET_ROOT + "Animations/" + MECH_ANIMATIONS[name], animFbx => {
      const clip = animFbx.animations && animFbx.animations[0];
      if (!clip || !mechMixer) return;

      clip.name = name;
      const action = mechMixer.clipAction(clip);
      action.enabled = true;
      if (name === "Landing" || name === "Death") {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      mechActions[name] = action;

      if (name === "Idle") playMechAnimation("Idle", 0);
    }, undefined, error => {
      console.error("Erreur animation Mech " + name + ":", error);
    });
  });
}

function playMechAnimation(name, fade) {
  if (!mechActions[name] || mechActiveName === name) return;
  const nextAction = mechActions[name];
  const fadeTime = fade === undefined ? 0.18 : fade;

  nextAction.reset();
  nextAction.enabled = true;
  nextAction.fadeIn(fadeTime);
  nextAction.play();

  if (mechActiveAction) mechActiveAction.fadeOut(fadeTime);
  mechActiveAction = nextAction;
  mechActiveName = name;
}

function updateMechAnimation(delta, isFwd, isBrake, isLeft, isRight) {
  if (playerMode !== "mech") return;
  if (mechMixer) mechMixer.update(delta);

  if (!mechMixer || !mechActions.Idle) return;
  if (scooterState === "LAND" && mechActions.Landing) {
    playMechAnimation("Landing");
  } else if (scooterState === "SINK" && mechActions.Death) {
    playMechAnimation("Death");
  } else if (speed > 0.015) {
    if (isBrake && mechActions.WalkBackward) playMechAnimation("WalkBackward");
    else if (isLeft && !isFwd && mechActions.WalkLeft) playMechAnimation("WalkLeft");
    else if (isRight && !isFwd && mechActions.WalkRight) playMechAnimation("WalkRight");
    else if (mechActions.WalkForward) playMechAnimation("WalkForward");
  } else {
    playMechAnimation("Idle");
  }
}

function loadTitanCharacter() {
  if (!window.GLTFLoader) {
    window.addEventListener("gltfloaderready", loadTitanCharacter, { once: true });
    return;
  }

  const loader = new window.GLTFLoader();
  const file = USE_TITAN_MERGED_ANIMATIONS ? TITAN_MERGED_FILE : TITAN_BASE_FILE;

  loader.load(TITAN_ASSET_ROOT + file, gltf => {
    titanModel = gltf.scene;
    titanModel.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.frustumCulled = false;
      enhanceTitanMaterial(node);
    });

    fitTitanToPlayer(titanModel);

    player.add(titanModel);
    if (hasRenderableMesh(titanModel)) removePlayerPlaceholder();

    titanMixer = new THREE.AnimationMixer(titanModel);
    findTitanBones(titanModel);

    registerTitanAnimationClips(gltf.animations || []);
    if (titanActions.Walking) playTitanAnimation("Walking", 0);
    else if (Object.keys(titanActions).length) playTitanAnimation(Object.keys(titanActions)[0], 0);

    if (!USE_TITAN_MERGED_ANIMATIONS) loadTitanAnimations(loader);
  }, undefined, error => {
    console.error("Erreur chargement Titan:", error);
  });
}

function registerTitanAnimationClips(clips) {
  clips.forEach((clip, index) => {
    const originalName = clip.name || "TitanClip" + index;
    clip.name = normalizeTitanClipName(originalName);
    const action = titanMixer.clipAction(clip);
    action.enabled = true;
    if (/jump|attack|combo|weapon/i.test(clip.name)) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    titanActions[clip.name] = action;
  });
}

function normalizeTitanClipName(name) {
  if (/idle|stand/i.test(name)) return "Idle";
  if (/running|run/i.test(name)) return "Running";
  if (/walking|walk/i.test(name)) return "Walking";
  if (/jump/i.test(name)) return "Basic_Jump";
  if (/double.*combo|combo.*attack/i.test(name)) return "Double_Combo_Attack";
  if (/weapon/i.test(name)) return "Weapon_Combo_2";
  if (/sit|answer/i.test(name)) return "Sitting_Answering_Questions";
  return name.replace(/\s+/g, "_");
}

function enhanceTitanMaterial(mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.filter(Boolean).forEach(material => {
    material.side = THREE.DoubleSide;

    if (material.map) {
      if (THREE.SRGBColorSpace) material.map.colorSpace = THREE.SRGBColorSpace;
      else material.map.encoding = THREE.sRGBEncoding;
      material.map.anisotropy = 8;
    }
    if (material.emissiveMap) {
      if (THREE.SRGBColorSpace) material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      else material.emissiveMap.encoding = THREE.sRGBEncoding;
      material.emissiveMap.anisotropy = 8;
    }
    if (material.normalMap) material.normalMap.anisotropy = 8;

    if (material.color) material.color.multiplyScalar(1.08);
    if (material.emissive) material.emissive.set(0x0b3d7a);
    material.emissiveIntensity = material.emissiveMap ? 0.22 : 0.08;
    material.roughness = material.roughness !== undefined ? Math.min(material.roughness, 0.58) : 0.45;
    material.metalness = material.metalness !== undefined ? Math.max(material.metalness, 0.18) : 0.18;
    material.needsUpdate = true;
  });

  if (!mesh.material) {
    mesh.material = new THREE.MeshStandardMaterial({
      color: 0x3b78d4,
      roughness: 0.45,
      metalness: 0.35,
      side: THREE.DoubleSide
    });
  }
}

function fitTitanToPlayer(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);
  const scale = 2.6 / maxAxis;

  root.scale.setScalar(scale);
  root.rotation.y = Math.PI;

  const fittedBox = new THREE.Box3().setFromObject(root);
  const fittedCenter = fittedBox.getCenter(new THREE.Vector3());
  root.position.x -= fittedCenter.x;
  root.position.z -= fittedCenter.z;
  root.position.y -= fittedBox.min.y;
}

function loadTitanAnimations(loader) {
  Object.keys(TITAN_ANIMATIONS).forEach(name => {
    if (name === "Walking") return; // déjà chargé via le modèle de base
    loader.load(TITAN_ASSET_ROOT + TITAN_ANIMATIONS[name], gltf => {
      const clip = gltf.animations && gltf.animations[0];
      if (!clip || !titanMixer) return;

      clip.name = name;
      registerTitanAnimationClips([clip]);
    }, undefined, error => {
      console.error("Erreur animation Titan " + name + ":", error);
    });
  });
}

function playTitanAnimation(name, fade) {
  if (!titanActions[name] || titanActiveName === name) return;
  const nextAction = titanActions[name];
  const fadeTime = fade === undefined ? 0.22 : fade;

  nextAction.reset();
  nextAction.enabled = true;
  nextAction.fadeIn(fadeTime);
  nextAction.play();

  if (titanActiveAction) titanActiveAction.fadeOut(fadeTime);
  titanActiveAction = nextAction;
  titanActiveName = name;
}

function triggerTitanAction(name) {
  if (!titanActions[name]) return;
  const action = titanActions[name];
  const duration = action.getClip ? action.getClip().duration * 1000 : 900;
  titanManualActionName = name;
  titanManualActionUntil = performance.now() + Math.max(500, duration);
  playTitanAnimation(name, 0.08);
}

function updateTitanAnimation(delta) {
  if (playerMode !== "titan") return;
  if (titanMixer) titanMixer.update(delta);

  if (!titanMixer || !Object.keys(titanActions).length) return;

  if (titanManualActionName && performance.now() < titanManualActionUntil && titanActions[titanManualActionName]) {
    return;
  }
  titanManualActionName = "";

  if ((scooterState === "JUMP" || scooterState === "FALL") && titanActions.Basic_Jump) {
    if (!titanJumpWasActive || titanActiveName !== "Basic_Jump") {
      playTitanAnimation("Basic_Jump", 0.08);
      titanJumpWasActive = true;
    }
    return;
  }
  titanJumpWasActive = false;

  // Choix d'animation par paliers de vitesse
  // - sous le seuil : Walking au ralenti (pseudo-idle)
  // - vitesse moyenne : Jogging
  // - haute vitesse : Running
  let target = speed < 0.03 && titanActions.Idle ? "Idle" : "Walking";
  if (speed > 0.44 && titanActions.Running) target = "Running";
  else if (speed > 0.22 && titanActions.Jogging) target = "Jogging";
  else if (speed < 0.03 && titanActions.Idle) target = "Idle";
  else if (!titanActions.Walking && titanActions.Running) target = "Running";

  playTitanAnimation(target);

  // Ajuste la vitesse de lecture sur la vitesse réelle, pour une lente quasi-idle quand on bouge à peine
  if (titanActiveAction) {
    const baseTimeScale = titanActiveName === "Idle" ? 1
                       : titanActiveName === "Walking" ? Math.max(0.25, speed / 0.25)
                       : titanActiveName === "Jogging" ? Math.max(0.6, speed / 0.4)
                       : titanActiveName === "Basic_Jump" ? 1
                       : Math.max(0.7, speed / 0.7);
    titanActiveAction.timeScale = baseTimeScale;
  }

  if (!titanActions.Basic_Jump) applyTitanJumpPose();
}

function findTitanBones(root) {
  titanBones = { leftThigh: null, rightThigh: null, leftShin: null, rightShin: null, spine: null };
  const allBones = [];
  root.traverse(node => {
    if (node.isBone) allBones.push(node);
  });

  const isLeft  = n => /left/i.test(n) || /(^|[^a-z])l([^a-z]|$)/i.test(n);
  const isRight = n => /right/i.test(n) || /(^|[^a-z])r([^a-z]|$)/i.test(n);

  allBones.forEach(b => {
    const n = b.name;
    if (/(upleg|upperleg|thigh|hip(?!s))/i.test(n) && !/twist/i.test(n)) {
      if (isLeft(n))  titanBones.leftThigh  = titanBones.leftThigh  || b;
      if (isRight(n)) titanBones.rightThigh = titanBones.rightThigh || b;
    } else if (/(shin|calf|lowerleg|knee|leftleg|rightleg)/i.test(n) || (/(^|[^a-z])leg([^a-z]|$)/i.test(n) && !/up/i.test(n))) {
      if (isLeft(n))  titanBones.leftShin  = titanBones.leftShin  || b;
      if (isRight(n)) titanBones.rightShin = titanBones.rightShin || b;
    } else if (/spine|chest|torso/i.test(n) && !titanBones.spine) {
      titanBones.spine = b;
    }
  });

  // Capture la pose initiale (rest pose) en clonant les rotations Euler
  titanBoneRest = {};
  for (const key in titanBones) {
    const b = titanBones[key];
    if (!b) continue;
    titanBoneRest[key] = new THREE.Euler().copy(b.rotation);
  }

  // Debug : si quelque chose manque, lister tous les bones pour pouvoir ajuster
  const missing = Object.entries(titanBones).filter(([k, v]) => !v && k !== "spine").map(([k]) => k);
  if (missing.length) {
    console.warn("[Titan] bones manquants:", missing, "— bones disponibles:", allBones.map(b => b.name));
  } else {
    console.log("[Titan] bones trouvés:", Object.fromEntries(Object.entries(titanBones).filter(([, v]) => v).map(([k, v]) => [k, v.name])));
  }
}

function applyTitanJumpPose() {
  if (!titanBones || !titanBoneRest) return;

  // Cible de blend selon l'état
  // JUMP : on vient de pousser → repli puis extension à mesure que velocity.y diminue
  // FALL : jambes mi-repliées pendant la chute
  // LAND : forte flexion à l'impact, relâche progressivement (landTimer 12→0)
  let target = 0;
  if (scooterState === "JUMP") {
    // velocity.y part de 0.42 vers 0 puis négatif. Crouch faible au début, max en haut du saut
    const apexFactor = 1 - Math.min(1, Math.max(0, velocity.y / 0.42));
    target = 0.25 + apexFactor * 0.35;
  } else if (scooterState === "FALL") {
    target = 0.55;
  } else if (scooterState === "LAND") {
    target = (landTimer / 12) * 0.95;
  } else if (!onGround) {
    target = 0.35;
  }

  // Lissage exponentiel pour éviter les sauts de pose
  titanJumpBlend += (target - titanJumpBlend) * 0.35;

  if (titanJumpBlend < 0.005) return;

  // Angles ciblés (radians) à pleine flexion
  // NB: les axes locaux dépendent du rigging du GLB. Si le pli part dans le mauvais sens,
  // inverser les signes ci-dessous.
  bendBone(titanBones.leftThigh,  titanBoneRest.leftThigh,  +0.95, 0, 0);
  bendBone(titanBones.rightThigh, titanBoneRest.rightThigh, +0.95, 0, 0);
  bendBone(titanBones.leftShin,   titanBoneRest.leftShin,   -1.60, 0, 0);
  bendBone(titanBones.rightShin,  titanBoneRest.rightShin,  -1.60, 0, 0);
  bendBone(titanBones.spine,      titanBoneRest.spine,      +0.18, 0, 0);
}

function bendBone(bone, rest, addX, addY, addZ) {
  if (!bone || !rest) return;
  const t = titanJumpBlend;
  bone.rotation.x = bone.rotation.x * (1 - t) + (rest.x + addX) * t;
  bone.rotation.y = bone.rotation.y * (1 - t) + (rest.y + addY) * t;
  bone.rotation.z = bone.rotation.z * (1 - t) + (rest.z + addZ) * t;
}

function isNearRoad(x, z, margin = 10) {
  return roads.some(r => {
    const dx = r.x2 - r.x1;
    const dz = r.z2 - r.z1;
    const lenSq = dx*dx + dz*dz;
    const t = Math.max(0, Math.min(1, ((x - r.x1)*dx + (z - r.z1)*dz) / lenSq));
    const nearX = r.x1 + t*dx;
    const nearZ = r.z1 + t*dz;
    return Math.sqrt((x-nearX)**2 + (z-nearZ)**2) < (r.width || ROAD_WIDTH) / 2 + margin;
  });
}

function distancePointToRoadSq(x, z, road) {
  const dx = road.x2 - road.x1;
  const dz = road.z2 - road.z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) return Infinity;
  const t = Math.max(0, Math.min(1, ((x - road.x1) * dx + (z - road.z1) * dz) / lenSq));
  const px = road.x1 + t * dx;
  const pz = road.z1 + t * dz;
  return (x - px) ** 2 + (z - pz) ** 2;
}

function getBridgeRotation(x, z) {
  let nearestRoad = roads[0];
  let nearestDistance = Infinity;
  roads.forEach(road => {
    const distance = distancePointToRoadSq(x, z, road);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestRoad = road;
    }
  });
  const dx = nearestRoad.x2 - nearestRoad.x1;
  const dz = nearestRoad.z2 - nearestRoad.z1;
  return Math.atan2(dx, dz) + Math.PI / 2;
}

function createMapDecorObjects() {
  MAP_DECOR_OBJECTS.forEach(item => {
    if (item.type === "cours d'eau") {
      const settings = item.settings || {};
      createWaterCourse(
        new THREE.Vector3(settings.x1, 0, settings.z1),
        new THREE.Vector3(settings.x2, 0, settings.z2),
        item
      );
      return;
    }

    if (item.type === "pont") {
      const point = new THREE.Vector3(item.position.x, 0, item.position.z);
      createEditorBridge(point, getBridgeRotation(point.x, point.z), item);
    }
  });
}

function createTerrainFeatures() {
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0x8b8f8c, roughness: 0.88 });
  const plazaMat = new THREE.MeshStandardMaterial({ color: 0xa3a09a, roughness: 0.86 });
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x3e7a43, roughness: 0.92 });
  const crosswalkMat = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6 });

  createCitySidewalkBlocks(sidewalkMat, plazaMat);
  createCityParks(parkMat);
  createCityCrosswalks(crosswalkMat);
  createCityDecor();
}

function addCityPlane(width, depth, material, x, z, y = 0.025, rotation = 0) {
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), material);
  plane.rotation.x = -Math.PI / 2;
  plane.rotation.z = rotation;
  plane.position.set(x, y, z);
  plane.receiveShadow = true;
  scene.add(plane);
  return plane;
}

function isCentralPlazaBlock(x, z) {
  return Math.abs(x) === 20 && Math.abs(z) === 20;
}

function isParkBlock(x, z) {
  return x === -100 && z === 100 || x === 100 && z === -100 || x === -100 && z === -60 || x === 100 && z === 60;
}

function createCitySidewalkBlocks(sidewalkMat, plazaMat) {
  CITY_BLOCK_CENTERS.forEach(x => {
    CITY_BLOCK_CENTERS.forEach(z => {
      const dist = Math.sqrt(x*x + z*z);
      if (dist > ISLAND_RADIUS - 12) return;
      const nearEdge = dist > ISLAND_RADIUS - 28;
      const size = nearEdge ? 18 : 24;
      const mat = isCentralPlazaBlock(x, z) ? plazaMat : sidewalkMat;
      addCityPlane(size, size, mat, x, z, 0.022);
    });
  });
}

function createCityParks(parkMat) {
  const parkBlocks = [
    [-100, 100], [100, -100], [-100, -60], [100, 60]
  ];
  parkBlocks.forEach(([x, z], i) => {
    if (Math.sqrt(x*x + z*z) > ISLAND_RADIUS - 12) return;
    addCityPlane(22, 22, parkMat, x, z, 0.032);
    parkMarkers.push({ x, z, w: 22, d: 22 });
    [[-6, -6], [6, -5], [-5, 6], [6, 6]].forEach(([ox, oz], j) => {
      scene.add(buildStreetTree(x + ox, z + oz, 0.9 + ((i + j) % 2) * 0.18));
    });
  });
}

function createCityCrosswalks(crosswalkMat) {
  CITY_ROAD_COORDS.forEach(x => {
    CITY_ROAD_COORDS.forEach(z => {
      if (Math.abs(x) > 80 || Math.abs(z) > 80) return;
      addCrosswalkStripes(x, z, "vertical", crosswalkMat);
      addCrosswalkStripes(x, z, "horizontal", crosswalkMat);
    });
  });
}

function addCrosswalkStripes(x, z, direction, material) {
  const stripeCount = 5;
  const stripeGap = 1.35;
  for (let i = 0; i < stripeCount; i++) {
    const offset = (i - (stripeCount - 1) / 2) * stripeGap;
    if (direction === "vertical") {
      addCityPlane(0.65, 8.2, material, x + offset, z, 0.07);
    } else {
      addCityPlane(8.2, 0.65, material, x, z + offset, 0.071);
    }
  }
}

function createCityDecor() {
  const materials = {
    building: [
      new THREE.MeshStandardMaterial({ color: 0x87909a, roughness: 0.67, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: 0xb2b8bd, roughness: 0.72, metalness: 0.03 }),
      new THREE.MeshStandardMaterial({ color: 0x6f7a82, roughness: 0.62, metalness: 0.06 }),
      new THREE.MeshStandardMaterial({ color: 0xa58e78, roughness: 0.76, metalness: 0.02 })
    ],
    base: new THREE.MeshStandardMaterial({ color: 0x4e5660, roughness: 0.8 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x333941, roughness: 0.78 }),
    windowLit: new THREE.MeshStandardMaterial({ color: 0xffdf86, emissive: 0x442800, roughness: 0.35 }),
    windowDark: new THREE.MeshStandardMaterial({ color: 0x18222d, roughness: 0.55 }),
    sign: new THREE.MeshStandardMaterial({ color: 0x276a7f, emissive: 0x071a20, roughness: 0.4 }),
    lampPost: new THREE.MeshStandardMaterial({ color: 0x20252c, roughness: 0.5, metalness: 0.4 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff2b0, emissive: 0xffcc55, roughness: 0.2 }),
    bench: new THREE.MeshStandardMaterial({ color: 0x6f4a2a, roughness: 0.82 }),
    bollard: new THREE.MeshStandardMaterial({ color: 0x30343a, roughness: 0.7, metalness: 0.2 })
  };

  createCityBuildings(materials);
  createStreetLights(materials);
  createCityBenches(materials.bench);
  createCityBollards(materials.bollard);
}

function createCityBuildings(materials) {
  let index = 0;
  CITY_BLOCK_CENTERS.forEach(x => {
    CITY_BLOCK_CENTERS.forEach(z => {
      if (Math.sqrt(x*x + z*z) > ISLAND_RADIUS - 15) return;
      if (isCentralPlazaBlock(x, z) || isParkBlock(x, z)) return;

      const group = buildCityBuilding(x, z, index, materials);
      scene.add(group);
      buildings.push(group);
      collidableObjects.push(group);
      index++;
    });
  });
}

function buildCityBuilding(x, z, index, materials) {
  const group = new THREE.Group();
  const edgeFactor = Math.sqrt(x*x + z*z) > 125 ? -2 : 0;
  const width = 10 + (index % 3) * 2 + edgeFactor;
  const depth = 11 + ((index + 1) % 3) * 2 + edgeFactor;
  const height = 16 + (index % 6) * 4 + (Math.abs(x) < 45 && Math.abs(z) < 85 ? 8 : 0);
  const baseHeight = 1.4;

  const base = new THREE.Mesh(new THREE.BoxGeometry(width + 0.8, baseHeight, depth + 0.8), materials.base);
  base.position.y = baseHeight / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    materials.building[index % materials.building.length]
  );
  body.position.y = baseHeight + height / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.7, 0.45, depth + 0.7), materials.roof);
  roof.position.y = baseHeight + height + 0.22;
  roof.castShadow = true;
  group.add(roof);

  const sign = new THREE.Mesh(new THREE.BoxGeometry(width * 0.55, 0.5, 0.08), materials.sign);
  sign.position.set(0, baseHeight + 0.7, -depth / 2 - 0.08);
  group.add(sign);

  addBuildingWindows(group, width, depth, height, baseHeight, index, materials);

  group.position.set(x, 0, z);
  group.userData.mapWidth = width;
  group.userData.mapDepth = depth;
  group.userData.collisionRadius = Math.sqrt(width * width + depth * depth) * 0.58;
  group.userData.collidable = true;
  return group;
}

function addBuildingWindows(group, width, depth, height, baseHeight, index, materials) {
  const rows = Math.max(3, Math.floor(height / 3.4));
  const frontCols = Math.max(3, Math.floor(width / 3));
  const sideCols = Math.max(2, Math.floor(depth / 3.5));

  for (let row = 0; row < rows; row++) {
    const y = baseHeight + 2.2 + row * 2.7;
    if (y > baseHeight + height - 1.2) continue;

    for (let col = 0; col < frontCols; col++) {
      const x = -width / 2 + (col + 1) * width / (frontCols + 1);
      const mat = (row + col + index) % 4 === 0 ? materials.windowDark : materials.windowLit;
      const front = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.05, 0.08), mat);
      front.position.set(x, y, -depth / 2 - 0.055);
      group.add(front);

      const back = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1.05, 0.08), mat);
      back.position.set(x, y, depth / 2 + 0.055);
      group.add(back);
    }

    if (row % 2 === 0) {
      for (let col = 0; col < sideCols; col++) {
        const z = -depth / 2 + (col + 1) * depth / (sideCols + 1);
        const mat = (row + col + index) % 3 === 0 ? materials.windowDark : materials.windowLit;
        const left = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.82), mat);
        left.position.set(-width / 2 - 0.055, y, z);
        group.add(left);

        const right = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.82), mat);
        right.position.set(width / 2 + 0.055, y, z);
        group.add(right);
      }
    }
  }
}

function createStreetLights(materials) {
  roads.forEach(r => {
    const dx = r.x2 - r.x1;
    const dz = r.z2 - r.z1;
    const len = Math.sqrt(dx*dx + dz*dz);
    if (len <= 0) return;
    const steps = Math.floor(len / 36);
    const dirX = dx / len;
    const dirZ = dz / len;
    const sideX = -dirZ;
    const sideZ = dirX;
    const roadWidth = r.width || ROAD_WIDTH;

    for (let i = 1; i < steps; i++) {
      const x = r.x1 + dirX * i * 36;
      const z = r.z1 + dirZ * i * 36;
      [-1, 1].forEach(side => {
        const lx = x + sideX * side * (roadWidth / 2 + 3);
        const lz = z + sideZ * side * (roadWidth / 2 + 3);
        if (Math.sqrt(lx*lx + lz*lz) > ISLAND_RADIUS - 10) return;
        if (isNearRoad(lx, lz, -1.4)) return;
        const light = buildStreetLight(lx, lz, materials.lampPost, materials.lamp);
        scene.add(light);
        poles.push(light);
      });
    }
  });
}

function buildStreetLight(x, z, postMat, lampMat) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 5.2, 10), postMat);
  pole.position.y = 2.6;
  group.add(pole);

  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.12, 0.12), postMat);
  arm.position.set(0.55, 5.05, 0);
  group.add(arm);

  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), lampMat);
  lamp.position.set(1.25, 4.95, 0);
  group.add(lamp);

  group.position.set(x, 0, z);
  group.userData.collisionRadius = 0.9;
  return group;
}

function createCityBenches(benchMat) {
  const spots = [
    [-29, 29, 0], [29, 29, Math.PI], [-29, -29, 0], [29, -29, Math.PI],
    [-106, 89, Math.PI / 2], [94, -89, -Math.PI / 2], [-108, -70, Math.PI / 2], [108, 70, -Math.PI / 2]
  ];
  spots.forEach(([x, z, rot]) => {
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(4, 0.35, 1), benchMat);
    seat.position.y = 0.75;
    bench.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(4, 1.1, 0.3), benchMat);
    back.position.set(0, 1.3, 0.45);
    bench.add(back);
    bench.position.set(x, 0, z);
    bench.rotation.y = rot;
    scene.add(bench);
  });
}

function createCityBollards(bollardMat) {
  [-35, -25, 25, 35].forEach(x => {
    [-35, 35].forEach(z => scene.add(buildBollard(x, z, bollardMat)));
  });
  [-35, 35].forEach(x => {
    [-25, 25].forEach(z => scene.add(buildBollard(x, z, bollardMat)));
  });
}

function buildBollard(x, z, mat) {
  const bollard = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.85, 10), mat);
  bollard.position.set(x, 0.42, z);
  return bollard;
}

function initMapEditor() {
  const panel = document.createElement("div");
  panel.id = "map-editor";
  panel.innerHTML = `
    <div class="editor-title">Editeur de map</div>
    <button data-action="toggle" class="wide">Activer edition</button>
    <label>Element
      <select data-field="tool">
        <option value="select">Selection / drag</option>
        <option value="water">Cours d'eau trace</option>
        <option value="bridge">Pont</option>
        <option value="building">Immeuble</option>
        <option value="lamp">Lampadaire</option>
        <option value="stadiumLight">Projecteur stade</option>
        <option value="car">Voiture</option>
        <option value="truck">Camion</option>
        <option value="glb">Objet GLB</option>
      </select>
    </label>
    <div data-field="glb-section" style="display:none">
      <div style="font-size:11px;color:#9bd3ff;margin:8px 0 4px">Galerie — clic pour selectionner</div>
      <div data-field="glb-gallery" style="display:grid;grid-template-columns:repeat(4,1fr);gap:5px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
        <label>Echelle<input data-field="glb-scale" type="number" value="0.09" min="0.001" max="20" step="0.01"></label>
        <label>Rot Y (deg)<input data-field="glb-rot" type="number" value="0" min="-180" max="180" step="5"></label>
      </div>
    </div>
    <div class="editor-grid">
      <label>Forme<select data-field="shape"><option value="rect">Rectangle</option><option value="square">Carre</option></select></label>
      <label>Largeur<input data-field="width" type="number" value="10" min="4" max="40"></label>
      <label>Profondeur<input data-field="depth" type="number" value="10" min="4" max="40"></label>
      <label>Hauteur<input data-field="height" type="number" value="18" min="4" max="80"></label>
      <label>Fenetres<input data-field="windows" type="number" value="12" min="0" max="120"></label>
      <label>Lumieres<input data-field="lights" type="number" value="6" min="0" max="120"></label>
    </div>
    <label class="check"><input data-field="collision" type="checkbox"> Collision sur l'objet selectionne</label>
    <button data-action="delete" class="wide">Supprimer selection</button>
    <div data-field="status" class="editor-status">Edition inactive</div>
  `;

  Object.assign(panel.style, {
    position: "absolute",
    top: "12px",
    right: "12px",
    width: "260px",
    background: "rgba(12,18,28,0.88)",
    color: "white",
    border: "1px solid rgba(255,255,255,0.22)",
    borderRadius: "10px",
    padding: "12px",
    font: "12px Arial",
    zIndex: "120",
    backdropFilter: "blur(10px)"
  });

  const style = document.createElement("style");
  style.textContent = `
    #map-editor .editor-title { font-weight: 700; font-size: 15px; margin-bottom: 8px; }
    #map-editor label { display: block; margin: 7px 0; color: rgba(255,255,255,0.78); }
    #map-editor select, #map-editor input, #map-editor button {
      width: 100%; box-sizing: border-box; margin-top: 3px; border: 0; border-radius: 6px;
      padding: 7px; background: rgba(255,255,255,0.12); color: white;
    }
    #map-editor option { color: black; }
    #map-editor button { cursor: pointer; background: #1787d8; font-weight: 700; }
    #map-editor .editor-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    #map-editor .check { display: flex; align-items: center; gap: 8px; }
    #map-editor .check input { width: auto; margin: 0; }
    #map-editor .editor-status { margin-top: 8px; color: #9bd3ff; min-height: 28px; }
    #map-editor .glb-thumb {
      display:flex; flex-direction:column; align-items:center;
      cursor:pointer; border-radius:5px; padding:2px;
      background:rgba(255,255,255,0.06); border:2px solid transparent;
      transition:border-color .12s;
    }
    #map-editor .glb-thumb:hover { background:rgba(255,255,255,0.14); }
    #map-editor .glb-thumb.selected { border-color:#00d4ff; background:rgba(0,212,255,0.12); }
    #map-editor .glb-thumb canvas { width:54px; height:54px; border-radius:3px; display:block; }
    #map-editor .glb-thumb-lbl { font-size:8px; color:rgba(255,255,255,0.65); text-align:center; margin-top:2px; width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  `;
  document.head.appendChild(style);
  document.body.appendChild(panel);

  mapEditor = {
    enabled: false,
    tool: "select",
    selected: null,
    dragging: null,
    waterStart: null,
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    panel,
    selectedGlbFile: "assets/Ulvheim/ulvheim-A-1.glb",
    glbCache: {},
    thumbBusy: false,
    thumbQueue: [],
  };

  buildEditorGlbGallery(panel);

  panel.addEventListener("pointerdown", e => e.stopPropagation());
  panel.querySelector('[data-action="toggle"]').addEventListener("click", () => setEditorEnabled(!mapEditor.enabled));
  panel.querySelector('[data-action="delete"]').addEventListener("click", deleteSelectedEditorObject);
  panel.querySelector('[data-field="tool"]').addEventListener("change", e => {
    mapEditor.tool = e.target.value;
    panel.querySelector('[data-field="glb-section"]').style.display = e.target.value === "glb" ? "" : "none";
    setEditorStatus("Outil: " + e.target.options[e.target.selectedIndex].text);
  });
  panel.querySelector('[data-field="collision"]').addEventListener("change", e => {
    if (mapEditor.selected) setObjectCollision(mapEditor.selected, e.target.checked);
  });

  renderer.domElement.addEventListener("pointerdown", handleEditorPointerDown);
  renderer.domElement.addEventListener("pointermove", handleEditorPointerMove);
  renderer.domElement.addEventListener("pointerup", handleEditorPointerUp);
}

function setEditorEnabled(enabled) {
  mapEditor.enabled = enabled;
  mapEditor.panel.querySelector('[data-action="toggle"]').textContent = enabled ? "Desactiver edition" : "Activer edition";
  setEditorStatus(enabled ? "Edition active: clic pour placer, drag pour deplacer." : "Edition inactive");
}

function setEditorStatus(text) {
  if (!mapEditor) return;
  mapEditor.panel.querySelector('[data-field="status"]').textContent = text;
}

function getEditorSettings() {
  const read = name => mapEditor.panel.querySelector(`[data-field="${name}"]`);
  const width = Number(read("width").value) || 10;
  const shape = read("shape").value;
  return {
    tool: read("tool").value,
    shape,
    width,
    depth: shape === "square" ? width : (Number(read("depth").value) || 10),
    height: Number(read("height").value) || 18,
    windows: Number(read("windows").value) || 0,
    lights: Number(read("lights").value) || 0
  };
}

function getPointerWorld(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mapEditor.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mapEditor.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  mapEditor.raycaster.setFromCamera(mapEditor.pointer, camera);
  const point = new THREE.Vector3();
  return mapEditor.raycaster.ray.intersectPlane(mapEditor.groundPlane, point) ? point : null;
}

function getEditorObjectRoot(object) {
  let current = object;
  while (current && !current.userData.editorObject && current.parent) current = current.parent;
  return current && current.userData.editorObject ? current : null;
}

function selectEditorObject(object) {
  if (mapEditor.selected && mapEditor.selected.userData.selectionBox) {
    mapEditor.selected.remove(mapEditor.selected.userData.selectionBox);
    mapEditor.selected.userData.selectionBox = null;
  }
  mapEditor.selected = object;
  const collisionField = mapEditor.panel.querySelector('[data-field="collision"]');
  collisionField.checked = Boolean(object && object.userData.collidable);

  if (object) {
    const box = new THREE.BoxHelper(object, 0x00ffff);
    object.add(box);
    object.userData.selectionBox = box;
    setEditorStatus("Selection: " + object.userData.type);
  }
}

function handleEditorPointerDown(event) {
  if (!mapEditor || !mapEditor.enabled) return;
  event.preventDefault();
  const point = getPointerWorld(event);
  if (!point) return;

  if (mapEditor.tool === "water") {
    mapEditor.waterStart = point.clone();
    setEditorStatus("Trace du cours d'eau en cours...");
    return;
  }

  mapEditor.raycaster.setFromCamera(mapEditor.pointer, camera);
  const hit = mapEditor.raycaster.intersectObjects(editorObjects, true)[0];
  const selected = hit ? getEditorObjectRoot(hit.object) : null;

  if (selected) {
    selectEditorObject(selected);
    mapEditor.dragging = selected;
    return;
  }

  if (mapEditor.tool !== "select") {
    const object = createEditorObject(mapEditor.tool, point, getEditorSettings());
    selectEditorObject(object);
  }
}

function handleEditorPointerMove(event) {
  if (!mapEditor || !mapEditor.enabled || !mapEditor.dragging) return;
  const point = getPointerWorld(event);
  if (!point) return;
  const previousX = mapEditor.dragging.position.x;
  const previousZ = mapEditor.dragging.position.z;
  const deltaX = point.x - previousX;
  const deltaZ = point.z - previousZ;
  mapEditor.dragging.position.x = point.x;
  mapEditor.dragging.position.z = point.z;
  if (mapEditor.dragging.userData.waterway) {
    mapEditor.dragging.userData.waterway.x1 += deltaX;
    mapEditor.dragging.userData.waterway.x2 += deltaX;
    mapEditor.dragging.userData.waterway.z1 += deltaZ;
    mapEditor.dragging.userData.waterway.z2 += deltaZ;
  }
  if (mapEditor.dragging.userData.bridgeMarker) {
    mapEditor.dragging.userData.bridgeMarker.x += deltaX;
    mapEditor.dragging.userData.bridgeMarker.z += deltaZ;
  }
  if (mapEditor.dragging.userData.selectionBox) mapEditor.dragging.userData.selectionBox.update();
}

function handleEditorPointerUp(event) {
  if (!mapEditor || !mapEditor.enabled) return;
  const point = getPointerWorld(event);
  if (mapEditor.tool === "water" && mapEditor.waterStart && point) {
    createWaterCourse(mapEditor.waterStart, point);
  }
  mapEditor.waterStart = null;
  mapEditor.dragging = null;
}

// ── Galerie GLB in-game ───────────────────────────────────────────────────────
const EDITOR_GLB_MODELS = [
  { file: "assets/Ulvheim/ulvheim-A-1.glb",        label: "A-1",  stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-2.glb",        label: "A-2",  stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-1-ruin1.glb",  label: "R1",   stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-1-ruin2.glb",  label: "R2",   stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-1-ruin3.glb",  label: "R3",   stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-1-ruin4.glb",  label: "R4",   stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-1-ruin5.glb",  label: "R5",   stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-2-ruin1A.glb", label: "R1A",  stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-2-ruin1B.glb", label: "R1B",  stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-2-ruin2A.glb", label: "R2A",  stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-2-ruin2B.glb", label: "R2B",  stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-2-ruin3A.glb", label: "R3A",  stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-2-ruin3B.glb", label: "R3B",  stl: true  },
  { file: "assets/Ulvheim/ulvheim-A-2-ruin5.glb",  label: "R5B",  stl: true  },
  { file: "assets/Motocross/Motocross.glb",         label: "Moto", stl: true  },
  { file: "assets/lasvegas_allegiant.glb",          label: "Vegas",stl: false },
];

const EDITOR_THUMB_SIZE = 54;
let editorThumbRenderer = null;
let editorThumbScene    = null;
let editorThumbCam      = null;
let editorThumbRoot     = null;

function getEditorThumbRenderer() {
  if (editorThumbRenderer) return editorThumbRenderer;
  editorThumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  editorThumbRenderer.setSize(EDITOR_THUMB_SIZE, EDITOR_THUMB_SIZE);
  editorThumbRenderer.setPixelRatio(1);
  editorThumbScene = new THREE.Scene();
  editorThumbScene.background = new THREE.Color(0x1a2035);
  editorThumbScene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
  sun.position.set(1, 2, 1.5);
  editorThumbScene.add(sun);
  editorThumbScene.add(Object.assign(new THREE.DirectionalLight(0x8ab4ff, 0.4), { position: new THREE.Vector3(-1, 0.5, -1) }));
  editorThumbCam = new THREE.PerspectiveCamera(40, 1, 0.01, 10000);
  return editorThumbRenderer;
}

function renderEditorThumb(gltfScene, canvas, isStl) {
  getEditorThumbRenderer();
  if (editorThumbRoot) { editorThumbScene.remove(editorThumbRoot); editorThumbRoot = null; }

  const root = gltfScene.clone(true);
  if (isStl) root.rotation.x = -Math.PI / 2;
  root.updateMatrixWorld(true);
  root.traverse(n => {
    if (n.isMesh) n.material = new THREE.MeshStandardMaterial({ color: 0x9a8a76, roughness: 0.82, metalness: 0.05 });
  });

  const box    = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  const size   = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  root.position.sub(center);
  editorThumbScene.add(root);
  editorThumbRoot = root;

  const d = maxDim * 1.35;
  editorThumbCam.position.set(d * 0.7, d * 0.65, d * 0.7);
  editorThumbCam.lookAt(0, 0, 0);
  editorThumbCam.near = maxDim * 0.01;
  editorThumbCam.far  = maxDim * 10;
  editorThumbCam.updateProjectionMatrix();

  editorThumbRenderer.render(editorThumbScene, editorThumbCam);
  canvas.getContext("2d").drawImage(editorThumbRenderer.domElement, 0, 0, EDITOR_THUMB_SIZE, EDITOR_THUMB_SIZE);
}

function buildEditorGlbGallery(panel) {
  const gallery = panel.querySelector('[data-field="glb-gallery"]');
  if (!gallery) return;

  EDITOR_GLB_MODELS.forEach(model => {
    const item   = document.createElement("div");
    item.className = "glb-thumb" + (model.file === mapEditor.selectedGlbFile ? " selected" : "");
    item.title = model.label;

    const canvas = document.createElement("canvas");
    canvas.width  = EDITOR_THUMB_SIZE;
    canvas.height = EDITOR_THUMB_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1a2035";
    ctx.fillRect(0, 0, EDITOR_THUMB_SIZE, EDITOR_THUMB_SIZE);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "9px Arial";
    ctx.textAlign = "center";
    ctx.fillText("…", EDITOR_THUMB_SIZE / 2, EDITOR_THUMB_SIZE / 2 + 3);

    const lbl = document.createElement("div");
    lbl.className = "glb-thumb-lbl";
    lbl.textContent = model.label;

    item.appendChild(canvas);
    item.appendChild(lbl);
    gallery.appendChild(item);

    item.addEventListener("click", () => {
      mapEditor.selectedGlbFile = model.file;
      gallery.querySelectorAll(".glb-thumb").forEach(el => el.classList.remove("selected"));
      item.classList.add("selected");
      const scale = panel.querySelector('[data-field="glb-scale"]');
      if (scale) scale.value = model.stl ? "0.09" : "5";
      setEditorStatus("GLB: " + model.label + " — clic pour placer");
    });

    loadEditorThumb(model.file, canvas, model.stl);
  });
}

function loadEditorThumb(file, canvas, isStl) {
  mapEditor.thumbQueue.push({ file, canvas, isStl });
  processEditorThumbQueue();
}

function processEditorThumbQueue() {
  if (mapEditor.thumbBusy || mapEditor.thumbQueue.length === 0) return;
  const { file, canvas, isStl } = mapEditor.thumbQueue.shift();
  mapEditor.thumbBusy = true;

  function done() { mapEditor.thumbBusy = false; processEditorThumbQueue(); }

  if (mapEditor.glbCache[file]) {
    renderEditorThumb(mapEditor.glbCache[file], canvas, isStl);
    done(); return;
  }

  function tryLoad() {
    if (!window.GLTFLoader) { setTimeout(tryLoad, 300); return; }
    new window.GLTFLoader().load(file, gltf => {
      mapEditor.glbCache[file] = gltf.scene;
      renderEditorThumb(gltf.scene, canvas, isStl);
      done();
    }, undefined, () => done());
  }
  tryLoad();
}

function createEditorGlbObject(point) {
  if (!window.GLTFLoader) { setEditorStatus("GLTFLoader pas prêt…"); return null; }
  const file   = mapEditor.selectedGlbFile;
  const panel  = mapEditor.panel;
  const scaleV = Number(panel.querySelector('[data-field="glb-scale"]').value) || 0.09;
  const rotY   = (Number(panel.querySelector('[data-field="glb-rot"]').value) || 0) * Math.PI / 180;
  const model  = EDITOR_GLB_MODELS.find(m => m.file === file);
  const isStl  = model ? model.stl : true;
  const label  = model ? model.label : file.split("/").pop();

  setEditorStatus("Chargement " + label + "…");

  function place(gltfScene) {
    const root = gltfScene.clone(true);
    if (isStl) root.rotation.x = -Math.PI / 2;
    root.scale.setScalar(scaleV);
    root.rotation.y = rotY;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.position.set(
      point.x - (box.min.x + box.max.x) / 2,
      -box.min.y,
      point.z - (box.min.z + box.max.z) / 2
    );
    root.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });
    registerEditorObject(root, "glb:" + label, 8);
    selectEditorObject(root);
    setEditorStatus("Placé : " + label);
  }

  if (mapEditor.glbCache[file]) { place(mapEditor.glbCache[file]); return null; }

  new window.GLTFLoader().load(file, gltf => {
    mapEditor.glbCache[file] = gltf.scene;
    place(gltf.scene);
  }, undefined, err => setEditorStatus("Erreur : " + err.message));

  return null;
}

function registerEditorObject(object, type, radius) {
  object.userData.editorObject = true;
  object.userData.type = type;
  object.userData.collisionRadius = radius || 2;
  editorObjects.push(object);
  scene.add(object);
  return object;
}

function createEditorObject(type, point, settings) {
  if (type === "building")     return createEditorBuilding(point, settings);
  if (type === "glb")          { createEditorGlbObject(point); return null; }
  if (type === "lamp")         return createEditorLamp(point);
  if (type === "stadiumLight") return createEditorStadiumLight(point);
  if (type === "bridge")       return createEditorBridge(point);
  if (type === "car")          return createEditorVehicle(point, false);
  if (type === "truck")        return createEditorVehicle(point, true);
  return null;
}

function createEditorBuilding(point, settings) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7e8794, roughness: 0.65 });
  const litMat = new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0x553800, roughness: 0.35 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2733, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(settings.width, settings.height, settings.depth), mat);
  body.position.y = settings.height / 2;
  group.add(body);

  const totalWindows = Math.max(0, settings.windows);
  for (let i = 0; i < totalWindows; i++) {
    const lit = i < settings.lights;
    const row = Math.floor(i / 4);
    const col = i % 4;
    const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.08), lit ? litMat : darkMat);
    win.position.set(-settings.width * 0.3 + col * settings.width * 0.2, 3 + row * 2.4, -settings.depth / 2 - 0.06);
    if (win.position.y < settings.height - 1) group.add(win);
  }

  group.position.set(point.x, 0, point.z);
  group.userData.mapWidth = settings.width;
  group.userData.mapDepth = settings.depth;
  buildings.push(group);
  return registerEditorObject(group, "immeuble", Math.max(settings.width, settings.depth) * 0.55);
}

function createEditorLamp(point) {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x20252c, roughness: 0.5, metalness: 0.35 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xfff0aa, emissive: 0xffcc55 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 10), poleMat);
  pole.position.y = 2.5;
  group.add(pole);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), glowMat);
  lamp.position.y = 5.2;
  group.add(lamp);
  group.position.set(point.x, 0, point.z);
  return registerEditorObject(group, "lampadaire", 1.2);
}

function createEditorStadiumLight(point) {
  const group = createEditorLamp(point);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xe8edf2, emissive: 0x443300, roughness: 0.35 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(3.5, 1.2, 0.5), headMat);
  head.position.set(0, 6.2, -0.6);
  group.add(head);
  group.userData.type = "projecteur stade";
  group.userData.collisionRadius = 1.6;
  return group;
}

function createEditorVehicle(point, isTruck) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: isTruck ? 0xd45535 : 0x2f80ed, roughness: 0.45 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(isTruck ? 7 : 4.5, isTruck ? 2.4 : 1.6, isTruck ? 3 : 2.2), bodyMat);
  body.position.y = isTruck ? 1.2 : 0.8;
  group.add(body);
  [-1, 1].forEach(x => [-1, 1].forEach(z => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.35, 12), darkMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x * (isTruck ? 2.5 : 1.5), 0.45, z * (isTruck ? 1.25 : 0.9));
    group.add(wheel);
  }));
  group.position.set(point.x, 0, point.z);
  return registerEditorObject(group, isTruck ? "camion" : "voiture", isTruck ? 4 : 2.5);
}

function createWaterCourse(start, end, metadata = {}) {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const len = Math.sqrt(dx*dx + dz*dz);
  if (len < 4) return;
  const width = WATER_COURSE_WIDTH;
  const angle = Math.atan2(dx, dz);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x1f8fd1, transparent: true, opacity: 0.9, roughness: 0.08 });
  const course = new THREE.Mesh(new THREE.PlaneGeometry(width, len), waterMat);
  course.rotation.x = -Math.PI / 2;
  course.rotation.z = angle;
  course.position.set((start.x + end.x) / 2, 0.055, (start.z + end.z) / 2);
  const waterway = { x1: start.x, z1: start.z, x2: end.x, z2: end.z, width };
  waterways.push(waterway);
  const object = registerEditorObject(course, "cours d'eau", width);
  object.userData.waterway = waterway;
  object.userData.collidable = Boolean(metadata.collidable);
  if (metadata.id !== undefined) object.userData.mapObjectId = metadata.id;
  setEditorStatus("Cours d'eau ajoute.");
  return object;
}

function createEditorBridge(point, rotation = getBridgeRotation(point.x, point.z), metadata = {}) {
  const group = new THREE.Group();
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.62, metalness: 0.08 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd4d7dc, roughness: 0.5 });

  const deck = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE_DECK_WIDTH, 0.18, BRIDGE_DECK_LENGTH), deckMat);
  deck.position.y = 0.14;
  group.add(deck);

  [-1, 1].forEach(side => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(BRIDGE_DECK_WIDTH, 0.55, 0.28), railMat);
    rail.position.set(0, 0.52, side * (BRIDGE_DECK_LENGTH / 2 - 0.45));
    group.add(rail);
  });

  group.position.set(point.x, 0, point.z);
  group.rotation.y = rotation;
  const bridgeMarker = { x: point.x, z: point.z, width: BRIDGE_DECK_WIDTH, length: BRIDGE_DECK_LENGTH, rot: rotation };
  bridgeMarkers.push(bridgeMarker);

  const bridge = registerEditorObject(group, "pont", 8);
  bridge.userData.bridgeMarker = bridgeMarker;
  bridge.userData.collidable = Boolean(metadata.collidable);
  if (metadata.id !== undefined) bridge.userData.mapObjectId = metadata.id;
  return bridge;
}

function setObjectCollision(object, enabled) {
  object.userData.collidable = enabled;
  collidableObjects = collidableObjects.filter(o => o !== object);
  if (enabled) collidableObjects.push(object);
  setEditorStatus(enabled ? "Collision active sur selection." : "Collision desactivee.");
}

function deleteSelectedEditorObject() {
  const object = mapEditor && mapEditor.selected;
  if (!object) return;
  collidableObjects = collidableObjects.filter(o => o !== object);
  editorObjects = editorObjects.filter(o => o !== object);
  if (object.userData.waterway) waterways = waterways.filter(waterway => waterway !== object.userData.waterway);
  if (object.userData.bridgeMarker) bridgeMarkers = bridgeMarkers.filter(marker => marker !== object.userData.bridgeMarker);
  scene.remove(object);
  mapEditor.selected = null;
  setEditorStatus("Element supprime.");
}

function handleResize() {
  if (!camera || !renderer) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function findNearestRoadPoint(x, z) {
  let nearest = { x: 0, z: 0, distanceSq: Infinity };

  roads.forEach(r => {
    const dx = r.x2 - r.x1;
    const dz = r.z2 - r.z1;
    const lenSq = dx*dx + dz*dz;
    const t = Math.max(0, Math.min(1, ((x - r.x1)*dx + (z - r.z1)*dz) / lenSq));
    const nearX = r.x1 + t*dx;
    const nearZ = r.z1 + t*dz;
    const distanceSq = (x - nearX)**2 + (z - nearZ)**2;

    if (distanceSq < nearest.distanceSq) {
      nearest = { x: nearX, z: nearZ, distanceSq };
    }
  });

  return nearest;
}

function startSinking() {
  if (isSinking) return;

  isSinking = true;
  sinkTimer = 0;
  sinkStart = {
    x: player.position.x,
    y: player.position.y,
    z: player.position.z
  };
  speed = 0;
  velocity.x = 0;
  velocity.y = 0;
  velocity.z = 0;
  onGround = false;
  scooterState = "SINK";

}

function updateSinking() {
  sinkTimer++;

  if (sinkTimer <= 42) {
    const t = sinkTimer / 42;
    player.position.y = sinkStart.y - t * 3.2;
    player.rotation.x += 0.08;
    player.rotation.z *= 0.94;
  } else if (sinkTimer === 43) {
    player.visible = false;
  } else if (sinkTimer >= 58) {
    const respawn = findNearestRoadPoint(sinkStart.x, sinkStart.z);
    const awayFromWaterX = respawn.x - sinkStart.x;
    const awayFromWaterZ = respawn.z - sinkStart.z;
    if (awayFromWaterX !== 0 || awayFromWaterZ !== 0) {
      playerYaw = Math.atan2(-awayFromWaterX, -awayFromWaterZ);
    }
    player.position.set(respawn.x, 0, respawn.z);
    player.rotation.x = 0;
    player.rotation.z = 0;
    player.rotation.y = playerYaw;
    player.visible = true;
    velocity.y = 0;
    onGround = true;
    offRoad = false;
    scooterState = "LAND";
    landTimer = 12;
    isSinking = false;
  }

  camera.position.set(
    player.position.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * cameraZoom,
    Math.max(player.position.y, 0) + Math.sin(cameraPitch) * cameraZoom + 1.5,
    player.position.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * cameraZoom
  );
  camera.lookAt(player.position.x, Math.max(player.position.y, 0) + 3, player.position.z);

  renderer.render(scene, camera);
  if (minimapCtx) drawMinimap();
}

function clampValue(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getConnectedGamepads() {
  if (!navigator.getGamepads) return [];
  return Array.from(navigator.getGamepads()).filter(Boolean);
}

function isIgnoredGamepad(gamepad) {
  const id = (gamepad && gamepad.id || "").toLowerCase();
  return /jbl|quantum|stream|headset|microphone|speaker|audio|0ecb|205f/.test(id);
}

function isXboxGamepad(gamepad) {
  const id = (gamepad && gamepad.id || "").toLowerCase();
  return /xbox|xinput|x-input|microsoft|045e/.test(id);
}

function isStandardMappedGamepad(gamepad) {
  return isXboxGamepad(gamepad) || gamepad.mapping === "standard";
}

function isPreferredGamepad(gamepad) {
  const id = (gamepad && gamepad.id || "").toLowerCase();
  return isStandardMappedGamepad(gamepad) || /thrust|t\.?flight|t-flight|hotas|044f|b106|joystick/.test(id);
}

function shortGamepadName(gamepad) {
  const id = gamepad && gamepad.id || "manette";
  return id.replace(/\s*\(Vendor:.*?\)\s*/i, "").trim() || id;
}

function selectGamepad(currentIndex) {
  if (!navigator.getGamepads) {
    return { gamepad: null, ignoredCount: 0, apiAvailable: false };
  }

  const pads = getConnectedGamepads();
  const ignoredPads = pads.filter(isIgnoredGamepad);
  const candidates = pads.filter(pad => !isIgnoredGamepad(pad));
  const current = candidates.find(pad => pad.index === currentIndex && pad.connected !== false);
  const selected = current || candidates.find(isPreferredGamepad) || candidates[0] || null;

  return { gamepad: selected, ignoredCount: ignoredPads.length, apiAvailable: true };
}

function formatGamepadStatus(gamepad, ignoredCount) {
  return `${shortGamepadName(gamepad)} actif${ignoredCount ? " - audio ignore" : ""}`;
}

function findGroundGamepad() {
  const result = selectGamepad(groundGamepadIndex);
  if (!result.apiAvailable) {
    groundGamepadIndex = null;
    groundGamepadStatus = "API manette indisponible";
    return null;
  }

  if (!result.gamepad) {
    groundGamepadIndex = null;
    groundGamepadStatus = result.ignoredCount ? "audio ignore" : "manette non detectee";
    return null;
  }

  groundGamepadIndex = result.gamepad.index;
  groundGamepadStatus = formatGamepadStatus(result.gamepad, result.ignoredCount);
  return result.gamepad;
}

function findFlightGamepad() {
  const result = selectGamepad(flightGamepadIndex);
  if (!result.apiAvailable) {
    flightGamepadIndex = null;
    flightGamepadStatus = "API manette indisponible";
    return null;
  }

  if (!result.gamepad) {
    flightGamepadIndex = null;
    flightGamepadStatus = result.ignoredCount ? "audio ignore" : "manette non detectee";
    return null;
  }

  flightGamepadIndex = result.gamepad.index;
  flightGamepadStatus = formatGamepadStatus(result.gamepad, result.ignoredCount);
  return result.gamepad;
}

function readGamepadAxis(gamepad, axisIndex, deadZone) {
  if (!gamepad || !gamepad.axes || !Number.isFinite(gamepad.axes[axisIndex])) return 0;
  const value = gamepad.axes[axisIndex];
  return Math.abs(value) < deadZone ? 0 : value;
}

function readGamepadButtonValue(gamepad, buttonIndex) {
  const button = gamepad && gamepad.buttons && gamepad.buttons[buttonIndex];
  if (!button) return 0;
  return typeof button.value === "number" ? button.value : (button.pressed ? 1 : 0);
}

function readGamepadButton(gamepad, buttonIndex) {
  return !!(gamepad && gamepad.buttons && gamepad.buttons[buttonIndex] && gamepad.buttons[buttonIndex].pressed);
}

const FLIGHT_GAMEPAD_BINDINGS_KEY = "raphael.flightGamepadBindings.v1";
const FLIGHT_GAMEPAD_ACTIONS = [
  { id: "yaw", label: "Lacet gauche/droite", capture: "axis", defaultBinding: { type: "axis", index: 0, scale: -1 } },
  { id: "pitch", label: "Pitch haut/bas", capture: "axis", defaultBinding: { type: "axis", index: 1, scale: 1 } },
  { id: "throttle", label: "Vitesse", capture: "value", defaultBinding: { type: "button", index: 7 } },
  { id: "brake", label: "Ralentir", capture: "value", defaultBinding: { type: "button", index: 6 } },
  { id: "climb", label: "Monter/descendre vertical", capture: "axis", defaultBinding: { type: "axis", index: 3, scale: -1 } },
  { id: "boost", label: "Boost", capture: "button", defaultBinding: { type: "button", index: 5 } },
  { id: "fire", label: "Tir", capture: "button", defaultBinding: { type: "button", index: 2 } }
];

let flightGamepadBindings = loadFlightGamepadBindings();
const gamepadMapperState = {
  open: false,
  captureAction: null,
  baseline: null,
  raf: 0
};

function loadFlightGamepadBindings() {
  try {
    const raw = window.localStorage && window.localStorage.getItem(FLIGHT_GAMEPAD_BINDINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("[gamepad] impossible de lire les commandes sauvegardees", error);
    return {};
  }
}

function saveFlightGamepadBindings() {
  try {
    window.localStorage.setItem(FLIGHT_GAMEPAD_BINDINGS_KEY, JSON.stringify(flightGamepadBindings));
  } catch (error) {
    console.warn("[gamepad] impossible de sauvegarder les commandes", error);
  }
}

function resetFlightGamepadBindings() {
  flightGamepadBindings = {};
  try {
    window.localStorage.removeItem(FLIGHT_GAMEPAD_BINDINGS_KEY);
  } catch (error) {
    console.warn("[gamepad] impossible de reinitialiser les commandes", error);
  }
  gamepadMapperState.captureAction = null;
  gamepadMapperState.baseline = null;
  renderGamepadMapper();
}

function getFlightGamepadAction(actionId) {
  return FLIGHT_GAMEPAD_ACTIONS.find(action => action.id === actionId) || null;
}

function getFlightGamepadBinding(actionId) {
  const action = getFlightGamepadAction(actionId);
  if (!action) return null;
  return flightGamepadBindings[actionId] || action.defaultBinding;
}

function getCustomFlightGamepadBinding(actionId) {
  return flightGamepadBindings[actionId] || null;
}

function readGamepadBindingValue(gamepad, binding, deadZone) {
  if (!gamepad || !binding) return 0;
  if (binding.type === "axis") {
    return clampValue(readGamepadAxis(gamepad, binding.index, deadZone) * (binding.scale || 1), -1, 1);
  }
  if (binding.type === "button") {
    return readGamepadButtonValue(gamepad, binding.index);
  }
  return 0;
}

function readFlightGamepadControl(gamepad, actionId, deadZone = GAMEPAD_DEAD_ZONE) {
  return readGamepadBindingValue(gamepad, getFlightGamepadBinding(actionId), deadZone);
}

function readCustomFlightGamepadControl(gamepad, actionId, deadZone = GAMEPAD_DEAD_ZONE) {
  const binding = getCustomFlightGamepadBinding(actionId);
  return binding ? readGamepadBindingValue(gamepad, binding, deadZone) : null;
}

function isFlightGamepadFirePressed() {
  const gamepad = findFlightGamepad();
  return !!(gamepad && readFlightGamepadControl(gamepad, "fire", 0.08) > 0.55);
}
window.isFlightGamepadFirePressed = isFlightGamepadFirePressed;

function describeGamepadBinding(binding) {
  if (!binding) return "non defini";
  if (binding.type === "axis") {
    return `Axe ${binding.index} ${binding.scale < 0 ? "-" : "+"}`;
  }
  if (binding.type === "button") return `Bouton ${binding.index}`;
  return "commande inconnue";
}

function snapshotGamepad(gamepad) {
  return {
    axes: Array.from(gamepad && gamepad.axes || []),
    buttons: Array.from(gamepad && gamepad.buttons || []).map(button => {
      if (!button) return 0;
      return typeof button.value === "number" ? button.value : (button.pressed ? 1 : 0);
    })
  };
}

function detectGamepadBinding(gamepad, baseline, action) {
  if (!gamepad || !baseline || !action) return null;

  const axisCandidates = [];
  const axes = gamepad.axes || [];
  for (let i = 0; i < axes.length; i++) {
    const value = Number.isFinite(axes[i]) ? axes[i] : 0;
    const base = Number.isFinite(baseline.axes[i]) ? baseline.axes[i] : 0;
    const delta = Math.abs(value - base);
    if (Math.abs(value) > 0.48 && delta > 0.32) {
      axisCandidates.push({
        score: delta + Math.abs(value) * 0.2,
        binding: { type: "axis", index: i, scale: value >= 0 ? 1 : -1 }
      });
    }
  }

  const buttonCandidates = [];
  const buttons = gamepad.buttons || [];
  for (let i = 0; i < buttons.length; i++) {
    const value = readGamepadButtonValue(gamepad, i);
    const base = Number.isFinite(baseline.buttons[i]) ? baseline.buttons[i] : 0;
    const delta = value - base;
    if (value > 0.52 && delta > 0.28) {
      buttonCandidates.push({ score: delta + value * 0.2, binding: { type: "button", index: i } });
    }
  }

  axisCandidates.sort((a, b) => b.score - a.score);
  buttonCandidates.sort((a, b) => b.score - a.score);

  if (action.capture === "axis") return axisCandidates[0] ? axisCandidates[0].binding : null;
  if (action.capture === "button") return (buttonCandidates[0] || axisCandidates[0] || null)?.binding || null;

  const bestAxis = axisCandidates[0] || null;
  const bestButton = buttonCandidates[0] || null;
  if (!bestAxis) return bestButton ? bestButton.binding : null;
  if (!bestButton) return bestAxis.binding;
  return bestButton.score >= bestAxis.score ? bestButton.binding : bestAxis.binding;
}

function updateGamepadMapperStatus(gamepad) {
  const status = document.getElementById("gamepad-status");
  if (!status) return;
  if (!navigator.getGamepads) {
    status.textContent = "API manette indisponible dans ce navigateur";
    return;
  }
  status.textContent = gamepad
    ? `${shortGamepadName(gamepad)} actif - ${gamepad.axes.length} axes, ${gamepad.buttons.length} boutons`
    : flightGamepadStatus;
}

function updateGamepadMapperReadout(gamepad) {
  const axesEl = document.getElementById("gamepad-axes");
  const buttonsEl = document.getElementById("gamepad-buttons");
  if (axesEl) {
    axesEl.textContent = gamepad && gamepad.axes && gamepad.axes.length
      ? Array.from(gamepad.axes).map((value, index) => `${index}: ${value.toFixed(2)}`).join("   ")
      : "aucun axe";
  }
  if (buttonsEl) {
    buttonsEl.textContent = gamepad && gamepad.buttons && gamepad.buttons.length
      ? Array.from(gamepad.buttons).map((button, index) => `${index}: ${readGamepadButtonValue(gamepad, index).toFixed(2)}`).join("   ")
      : "aucun bouton";
  }
}

function renderGamepadMapper() {
  const list = document.getElementById("gamepad-list");
  const capture = document.getElementById("gamepad-capture");
  const gamepad = findFlightGamepad();
  updateGamepadMapperStatus(gamepad);
  updateGamepadMapperReadout(gamepad);

  if (capture && !gamepadMapperState.captureAction) {
    capture.textContent = "Choisis une commande, puis bouge le stick ou appuie sur le bouton.";
  }
  if (!list) return;

  list.innerHTML = FLIGHT_GAMEPAD_ACTIONS.map(action => {
    const binding = getFlightGamepadBinding(action.id);
    const mode = flightGamepadBindings[action.id] ? "Enregistre" : "Defaut";
    return `
      <div class="gamepad-row">
        <div>
          <strong>${action.label}</strong>
          <span>${mode} - ${describeGamepadBinding(binding)}</span>
        </div>
        <button class="gamepad-small" type="button" data-gamepad-action="${action.id}">Enregistrer</button>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-gamepad-action]").forEach(button => {
    button.addEventListener("click", () => beginGamepadCapture(button.getAttribute("data-gamepad-action")));
  });
}

function beginGamepadCapture(actionId) {
  const action = getFlightGamepadAction(actionId);
  const gamepad = findFlightGamepad();
  const capture = document.getElementById("gamepad-capture");
  if (!action) return;
  if (!gamepad) {
    if (capture) capture.textContent = "Appuie d'abord sur un bouton de la manette pour que le navigateur la detecte.";
    return;
  }
  gamepadMapperState.captureAction = actionId;
  gamepadMapperState.baseline = snapshotGamepad(gamepad);
  if (capture) capture.textContent = `En attente : ${action.label}`;
}

function tickGamepadMapper() {
  if (!gamepadMapperState.open) return;
  const gamepad = findFlightGamepad();
  updateGamepadMapperStatus(gamepad);
  updateGamepadMapperReadout(gamepad);

  if (gamepadMapperState.captureAction && gamepad) {
    const action = getFlightGamepadAction(gamepadMapperState.captureAction);
    const binding = detectGamepadBinding(gamepad, gamepadMapperState.baseline, action);
    if (binding) {
      flightGamepadBindings[action.id] = binding;
      saveFlightGamepadBindings();
      gamepadMapperState.captureAction = null;
      gamepadMapperState.baseline = null;
      const capture = document.getElementById("gamepad-capture");
      if (capture) capture.textContent = `${action.label} : ${describeGamepadBinding(binding)} sauvegarde`;
      renderGamepadMapper();
    }
  }

  gamepadMapperState.raf = requestAnimationFrame(tickGamepadMapper);
}

function openGamepadMapper() {
  setupGamepadMapperUi();
  const panel = document.getElementById("gamepad-mapper");
  if (!panel) return;
  if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock();
  panel.style.display = "flex";
  panel.setAttribute("aria-hidden", "false");
  gamepadMapperState.open = true;
  renderGamepadMapper();
  cancelAnimationFrame(gamepadMapperState.raf);
  tickGamepadMapper();
}

function closeGamepadMapper() {
  const panel = document.getElementById("gamepad-mapper");
  if (panel) {
    panel.style.display = "none";
    panel.setAttribute("aria-hidden", "true");
  }
  gamepadMapperState.open = false;
  gamepadMapperState.captureAction = null;
  gamepadMapperState.baseline = null;
  cancelAnimationFrame(gamepadMapperState.raf);
}

function setupGamepadMapperUi() {
  const close = document.getElementById("gamepad-close");
  const detect = document.getElementById("gamepad-detect");
  const reset = document.getElementById("gamepad-reset");
  if (close && !close.dataset.bound) {
    close.dataset.bound = "1";
    close.addEventListener("click", closeGamepadMapper);
  }
  if (detect && !detect.dataset.bound) {
    detect.dataset.bound = "1";
    detect.addEventListener("click", renderGamepadMapper);
  }
  if (reset && !reset.dataset.bound) {
    reset.dataset.bound = "1";
    reset.addEventListener("click", resetFlightGamepadBindings);
  }
}

window.openGamepadMapper = openGamepadMapper;
window.closeGamepadMapper = closeGamepadMapper;
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", setupGamepadMapperUi, { once: true });
} else {
  setupGamepadMapperUi();
}

function readGroundGamepadInput() {
  const neutral = {
    forward: 0,
    brake: 0,
    turn: 0,
    boost: false,
    jumpPressed: false,
    trickHeld: false,
    actionPressed: false,
    cameraX: 0,
    cameraY: 0
  };
  const gamepad = findGroundGamepad();

  if (!gamepad) {
    lastGroundGamepadButtons = [];
    return neutral;
  }

  const buttons = gamepad.buttons || [];
  const pressed = index => !!(buttons[index] && buttons[index].pressed);
  const justPressed = index => pressed(index) && !lastGroundGamepadButtons[index];
  const leftX = readGamepadAxis(gamepad, 0, GAMEPAD_DEAD_ZONE);
  const leftY = readGamepadAxis(gamepad, 1, GAMEPAD_DEAD_ZONE);
  const rightX = readGamepadAxis(gamepad, 2, GAMEPAD_DEAD_ZONE);
  const rightY = readGamepadAxis(gamepad, 3, GAMEPAD_DEAD_ZONE);
  const triggerLeft = readGamepadButtonValue(gamepad, 6);
  const triggerRight = readGamepadButtonValue(gamepad, 7);

  neutral.forward = Math.max(triggerRight, Math.max(0, -leftY));
  neutral.brake = Math.max(triggerLeft, Math.max(0, leftY));
  neutral.turn = clampValue(-leftX + (pressed(14) ? 1 : 0) + (pressed(15) ? -1 : 0), -1, 1);
  neutral.boost = pressed(5) || triggerRight > 0.86;
  neutral.jumpPressed = justPressed(0);
  neutral.trickHeld = pressed(3);
  neutral.actionPressed = justPressed(2) || justPressed(3);
  neutral.cameraX = rightX;
  neutral.cameraY = rightY;

  lastGroundGamepadButtons = buttons.map(button => button.pressed);
  return neutral;
}

function updateFlightHud() {
  const hudEl = document.getElementById("hud");
  if (!hudEl || !player) return;

  const speedKmh = Math.round(Math.abs(flightSpeed) * 3.6);
  const altitude = Math.round(player.position.y);
  const flightLabel = playerMode === "chasseur" ? "Avion chasseur"
                    : playerMode === "wargun" ? "Wargun"
                    : "Vue avion";
  hudEl.innerHTML =
    `${flightLabel} &nbsp; Stick=diriger &nbsp; X/L3+direction=vrille/looping &nbsp; RT/throttle=vitesse &nbsp; W/Z=accel &nbsp; M=manette`
    + `<br><span style="font-size:22px;font-weight:bold">${speedKmh} <small>km/h</small></span>`
    + `&nbsp;&nbsp;<span style="font-size:18px;font-weight:bold">${altitude} <small>m</small></span>`
    + `&nbsp;&nbsp;<span style="opacity:0.75">[SURVOL]</span>`
    + `&nbsp;&nbsp;<small style="opacity:0.72">${flightGamepadStatus}</small>`;
}

function updateFlyoverMode(delta) {
  const keyboardForward = keys["KeyW"] || keys["KeyZ"];
  const keyboardBrake = keys["KeyS"];
  const isBoost = keys["ShiftLeft"] || keys["ShiftRight"];

  let yawInput = 0;
  if (keys["KeyA"] || keys["KeyQ"] || keys["ArrowLeft"]) yawInput += 1;
  if (keys["KeyD"] || keys["ArrowRight"]) yawInput -= 1;

  let pitchInput = 0;
  if (keys["ArrowUp"] || keys["KeyI"]) pitchInput += 1;
  if (keys["ArrowDown"] || keys["KeyK"]) pitchInput -= 1;

  let climbInput = 0;
  // Espace est reserve au canon. E/PageUp commandent la montee directe.
  if (keys["KeyE"] || keys["PageUp"]) climbInput += 1;
  if (keys["ControlLeft"] || keys["ControlRight"] || keys["KeyC"] || keys["PageDown"]) climbInput -= 1;

  const gamepad = findFlightGamepad();
  let targetSpeed = FLIGHT_CRUISE_SPEED;
  if (gamepad) {
    const isStandardPad = isStandardMappedGamepad(gamepad);
    const customYaw = readCustomFlightGamepadControl(gamepad, "yaw", 0.08);
    const customPitch = readCustomFlightGamepadControl(gamepad, "pitch", 0.08);
    const customThrottle = readCustomFlightGamepadControl(gamepad, "throttle", 0.05);
    const customBrake = readCustomFlightGamepadControl(gamepad, "brake", 0.05);
    const customClimb = readCustomFlightGamepadControl(gamepad, "climb", GAMEPAD_DEAD_ZONE);
    const customBoost = readCustomFlightGamepadControl(gamepad, "boost", 0.08);

    if (customYaw !== null) {
      yawInput += customYaw;
    } else {
      yawInput += -readGamepadAxis(gamepad, 0, 0.08);
      if (!isStandardPad) {
        const twist = readGamepadAxis(gamepad, 2, 0.12);
        yawInput += -twist * 0.55;
      }
    }

    if (customPitch !== null) {
      pitchInput += customPitch;
    } else {
      pitchInput += readGamepadAxis(gamepad, 1, 0.08);
    }

    if (customThrottle !== null) {
      const throttle = Math.max(0, customThrottle);
      if (throttle > 0.05) targetSpeed = Math.max(8, throttle * FLIGHT_MAX_SPEED);
    } else if (isStandardPad) {
      const triggerRight = readGamepadButtonValue(gamepad, 7);
      if (triggerRight > 0.05) {
        targetSpeed = Math.max(8, triggerRight * FLIGHT_MAX_SPEED);
      }
    } else if (gamepad.axes && gamepad.axes.length > 3 && Number.isFinite(gamepad.axes[3])) {
      const throttle = clampValue((1 - gamepad.axes[3]) / 2, 0, 1);
      targetSpeed = Math.max(8, throttle * FLIGHT_MAX_SPEED);
    }

    if (customBrake !== null) {
      const brake = Math.max(0, customBrake);
      if (brake > 0.05) targetSpeed = Math.max(0, targetSpeed * (1 - brake * 0.9));
    } else if (isStandardPad) {
      const triggerLeft = readGamepadButtonValue(gamepad, 6);
      if (triggerLeft > 0.05) {
        targetSpeed = Math.max(0, targetSpeed * (1 - triggerLeft * 0.9));
      }
    }

    if (customBoost !== null) {
      if (customBoost > 0.55) targetSpeed *= 1.2;
    } else if (isStandardPad) {
      if (readGamepadButton(gamepad, 5)) targetSpeed *= 1.2;
    }

    if (customClimb !== null) {
      climbInput += customClimb;
    } else if (isStandardPad) {
      const rightY = readGamepadAxis(gamepad, 3, GAMEPAD_DEAD_ZONE);
      if (readGamepadButton(gamepad, 0)) climbInput += 1;
      if (readGamepadButton(gamepad, 1) || readGamepadButton(gamepad, 4)) climbInput -= 1;
      climbInput += -rightY;
    } else {
      if (readGamepadButton(gamepad, 4)) climbInput -= 1;
      if (readGamepadButton(gamepad, 5)) climbInput += 1;
    }
  }

  yawInput = clampValue(yawInput, -1, 1);
  pitchInput = clampValue(pitchInput, -1, 1);
  climbInput = clampValue(climbInput, -1, 1);

  const acroHeld = !!(keys["KeyX"] || (gamepad && readGamepadButton(gamepad, 10)));
  const acroAxis = Math.max(Math.abs(yawInput), Math.abs(pitchInput));
  if ((!acroHeld || acroAxis < 0.28) && !flightAerobatic) flightAerobaticArmed = true;
  if (acroHeld && flightAerobaticArmed && !flightAerobatic && acroAxis > 0.55) {
    flightAerobatic = Math.abs(yawInput) >= Math.abs(pitchInput)
      ? { type: "roll", direction: Math.sign(yawInput) || 1, elapsed: 0, duration: 1.05 }
      : { type: "loop", direction: Math.sign(pitchInput) || 1, elapsed: 0, duration: 1.55 };
    flightAerobaticArmed = false;
  }

  if (keyboardForward) targetSpeed = Math.max(targetSpeed, FLIGHT_MAX_SPEED * 0.58);
  if (keyboardBrake) targetSpeed = 0;
  if (isBoost) targetSpeed *= 1.25;

  const combatFlightMods = window.RaphaelAirCombat ? window.RaphaelAirCombat.flightModifiers() : { speed: 1, yaw: 1 };
  targetSpeed *= combatFlightMods.speed;
  flightSpeed += (targetSpeed - flightSpeed) * Math.min(1, delta * FLIGHT_ACCEL_RATE);
  if (Math.abs(flightSpeed) < 0.05) flightSpeed = 0;
  if (playerMode === "chasseur") {
    window.RaphaelFighterEngine?.update(Math.abs(flightSpeed) / FLIGHT_MAX_SPEED, isBoost);
  }

  playerYaw += yawInput * FLIGHT_YAW_RATE * combatFlightMods.yaw * delta;
  flightPitch = clampValue(flightPitch + pitchInput * FLIGHT_PITCH_RATE * delta, -0.48, 0.52);

  const cosPitch = Math.cos(flightPitch);
  const forward = new THREE.Vector3(
    -Math.sin(playerYaw) * cosPitch,
    Math.sin(flightPitch),
    -Math.cos(playerYaw) * cosPitch
  );

  const verticalSpeed = forward.y * flightSpeed + climbInput * 30;
  player.position.x += forward.x * flightSpeed * delta;
  player.position.y += verticalSpeed * delta;
  player.position.z += forward.z * flightSpeed * delta;
  player.position.x = clampValue(player.position.x, -FLIGHT_WORLD_LIMIT, FLIGHT_WORLD_LIMIT);
  player.position.z = clampValue(player.position.z, -FLIGHT_WORLD_LIMIT, FLIGHT_WORLD_LIMIT);
  player.position.y = clampValue(player.position.y, FLIGHT_MIN_ALTITUDE, FLIGHT_MAX_ALTITUDE);

  if (player.position.y <= FLIGHT_MIN_ALTITUDE + 0.01) flightPitch = Math.max(0, flightPitch);
  if (player.position.y >= FLIGHT_MAX_ALTITUDE - 0.01) flightPitch = Math.min(0, flightPitch);

  const horizontalSpeed = Math.max(0.001, Math.hypot(forward.x * flightSpeed, forward.z * flightSpeed));
  const trajectoryPitch = clampValue(Math.atan2(verticalSpeed, horizontalSpeed), -0.62, 0.62);
  flightVisualPitch += (trajectoryPitch - flightVisualPitch) * Math.min(1, delta * 6.5);
  const bank = yawInput * 0.45;   // inverse : ailes inclinees dans le bon sens
  // Le modele OBJ a son axe de tangage visuel inverse par rapport au repere de vol.
  let acroRoll = 0, acroPitch = 0;
  if (flightAerobatic) {
    flightAerobatic.elapsed += delta;
    const progress = clampValue(flightAerobatic.elapsed / flightAerobatic.duration, 0, 1);
    const angle = Math.PI * 2 * progress * flightAerobatic.direction;
    if (flightAerobatic.type === "roll") acroRoll = angle;
    else acroPitch = -angle;
    if (progress >= 1) flightAerobatic = null;
  }
  player.rotation.set(-flightVisualPitch + acroPitch, playerYaw, bank + acroRoll);
  if (player.userData.propeller) {
    player.userData.propeller.rotation.z += delta * (22 + Math.abs(flightSpeed) * 0.85);
  }

  velocity.x = forward.x * flightSpeed;
  velocity.y = verticalSpeed;
  velocity.z = forward.z * flightSpeed;
  speed = clampValue(Math.abs(flightSpeed) / FLIGHT_MAX_SPEED * MAX_SPEED, 0, MAX_BOOST);
  scooterState = "SURVOL";

  const camDist = 24 + Math.min(10, Math.abs(flightSpeed) / FLIGHT_MAX_SPEED * 10);
  const camHeight = 7.2 + Math.max(0, flightPitch) * 4;
  const desiredCamera = player.position.clone()
    .addScaledVector(forward, -camDist)
    .add(new THREE.Vector3(0, camHeight, 0));
  camera.position.lerp(desiredCamera, Math.min(1, delta * 4.8));
  camera.lookAt(player.position.clone().addScaledVector(forward, 28).add(new THREE.Vector3(0, 2.2, 0)));

  updateValleyPortal(delta, performance.now());

  updateFlightHud();
  renderer.render(scene, camera);
  if (minimapCtx) drawMinimap();
}

// LOOP
function animate(){
  animationFrameId = requestAnimationFrame(animate);
  const now = performance.now();
  const frameDelta = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;

  if (isSinking) {
    updateMechAnimation(frameDelta, false, false, false, false);
    updateTitanAnimation(frameDelta);
    updatePinstripeAnimation(frameDelta);
    updateCarAudio(false, false);
    updateSinking();
    return;
  }

  if (isFlyingMode()) {
    updateFlyoverMode(frameDelta);
    return;
  }

  // â”€â”€ INPUTS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const gamepadInput = readGroundGamepadInput();
  if (gamepadInput.cameraX || gamepadInput.cameraY) {
    cameraYaw -= gamepadInput.cameraX * 0.025;
    cameraPitch = clampValue(cameraPitch - gamepadInput.cameraY * 0.018, 0.05, 1.45);
  }

  const isFwd   = keys["KeyW"] || keys["KeyZ"] || keys["ArrowUp"] || gamepadInput.forward > 0.22;
  const isBrake = keys["KeyS"] || keys["ArrowDown"] || gamepadInput.brake > 0.22;
  const isLeft  = keys["KeyA"] || keys["KeyQ"] || keys["ArrowLeft"] || gamepadInput.turn > 0.22;
  const isRight = keys["KeyD"] || keys["ArrowRight"] || gamepadInput.turn < -0.22;
  const isBoost = keys["ShiftLeft"] || keys["ShiftRight"] || gamepadInput.boost;

  if (gamepadInput.actionPressed && playerMode === "titan") triggerTitanAction("Double_Combo_Attack");
  if (gamepadInput.actionPressed && playerMode === "pinstripe") triggerPinstripeAction("Double_Combo_Attack");

  // â”€â”€ STATE MACHINE + ACCÃ‰LÃ‰RATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (scooterState !== 'JUMP' && scooterState !== 'FALL') {
    const maxSpd = isBoost ? MAX_BOOST : MAX_SPEED;
    if (isFwd) {
      speed = Math.min(speed + ACCEL, maxSpd);
      scooterState = isBoost ? 'BOOST' : 'MOVE';
    } else if (isBrake && speed > 0) {
      speed -= BRAKE_FORCE;
      if (speed <= 0) { speed = 0; scooterState = 'IDLE'; }
      else scooterState = 'BRAKE';
    } else {
      speed *= FRICTION_G;
      if (speed < 0.003) { speed = 0; if (scooterState !== 'LAND') scooterState = 'IDLE'; }
    }
  }

  // â”€â”€ VIRAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let turnInput = gamepadInput.turn;
  if (keys["KeyA"] || keys["KeyQ"] || keys["ArrowLeft"])  turnInput =  1;
  if (keys["KeyD"] || keys["ArrowRight"]) turnInput = -1;
  const turnFactor = Math.min(speed / MAX_SPEED, 1);
  playerYaw += turnInput * TURN_SPD * turnFactor;
  player.rotation.y = playerYaw;

  // Lean visuel (inclinaison dans les virages)
  const leanStrength = playerMode === "car" ? 0.12 : 0.38;
  const targetLean = -turnInput * turnFactor * leanStrength;
  leanAngle += (targetLean - leanAngle) * 0.12;
  player.rotation.z = leanAngle;

  // â”€â”€ DÃ‰PLACEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  velocity.x = -Math.sin(playerYaw) * speed;
  velocity.z = -Math.cos(playerYaw) * speed;
  player.position.x += velocity.x;
  player.position.z += velocity.z;

  // â”€â”€ SAUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if ((keys["Space"] || gamepadInput.jumpPressed) && onGround) {
    velocity.y = 0.42;
    onGround = false;
    scooterState = 'JUMP';
  }

  // GravitÃ© renforcÃ©e en descente
  velocity.y -= velocity.y < 0 ? 0.034 : 0.022;
  player.position.y += velocity.y;

  if (player.position.y <= 0) {
    player.position.y = 0;
    if (!onGround) {
      scooterState = 'LAND';
      landTimer = 12;
    }
    velocity.y = 0;
    onGround = true;
  }

  // Transitions d'Ã©tat
  if (scooterState === 'JUMP' && velocity.y < 0) scooterState = 'FALL';
  if (scooterState === 'LAND' && --landTimer <= 0) scooterState = speed > 0.01 ? 'MOVE' : 'IDLE';

  // â”€â”€ SALTO / INCLINAISON SAUT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!onGround && (keys["KeyT"] || gamepadInput.trickHeld)) {
    player.rotation.x += 0.2;
  } else if (scooterState === 'JUMP' || scooterState === 'FALL') {
    player.rotation.x += (0.15 - player.rotation.x) * 0.08;
  } else {
    player.rotation.x += (0 - player.rotation.x) * 0.12;
  }

  // â”€â”€ ROTATION ROUES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  wheelRot += speed * 2.8;
  if (playerMode === "scooter") {
    if (wheelFront) wheelFront.rotation.x = wheelRot;
    if (wheelBack)  wheelBack.rotation.x  = wheelRot;
  }
  updateMechAnimation(frameDelta, isFwd, isBrake, isLeft, isRight);
  updateTitanAnimation(frameDelta);
  updatePinstripeAnimation(frameDelta);
  updateCarAudio(isFwd, isBoost);

  // â”€â”€ COLLISION POTEAUX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const POLE_RADIUS = 0.9;
  poles.forEach(p => {
    let dx = player.position.x - p.position.x;
    let dz = player.position.z - p.position.z;
    let dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < POLE_RADIUS && dist > 0.001) {
      let nx = dx / dist, nz = dz / dist;
      player.position.x = p.position.x + nx * POLE_RADIUS;
      player.position.z = p.position.z + nz * POLE_RADIUS;
      let vDot = velocity.x * nx + velocity.z * nz;
      if (vDot < 0) {
        velocity.x -= 2 * vDot * nx;
        velocity.z -= 2 * vDot * nz;
        velocity.x *= 0.55;
        velocity.z *= 0.55;
        speed *= 0.55;
      }
    }
  });

  collidableObjects.forEach(o => {
    const dx = player.position.x - o.position.x;
    const dz = player.position.z - o.position.z;
    const radius = o.userData.collisionRadius || 2;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < radius && dist > 0.001) {
      const nx = dx / dist;
      const nz = dz / dist;
      player.position.x = o.position.x + nx * radius;
      player.position.z = o.position.z + nz * radius;
      speed *= 0.35;
      velocity.x = nx * Math.abs(speed);
      velocity.z = nz * Math.abs(speed);
    }
  });

  // â”€â”€ LIMITE ÃŽLE / EAU â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  {
    const px = player.position.x;
    const pz = player.position.z;
    const distFromCenter = Math.sqrt(px*px + pz*pz);
    if (distFromCenter > WATER_SINK_RADIUS) {
      startSinking();
      return;
      // Ramener le joueur au bord de l'Ã®le
      // Rebondir lÃ©gÃ¨rement vers l'intÃ©rieur
      // Afficher l'avertissement
    }
  }

  // â”€â”€ PARTICULES POUSSIÃˆRE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (dustParticles && dustPositions) {
    if (speed > 0.04) {
      for (let i = 0; i < DUST_COUNT; i++) {
        const idx = i * 3;
        // dÃ©rive verticale + dispersion
        dustPositions[idx+1] += 0.04;
        dustPositions[idx]   += (Math.random()-0.5) * 0.06;
        dustPositions[idx+2] += (Math.random()-0.5) * 0.06;
        // respawn alÃ©atoire derriÃ¨re la roue arriÃ¨re
        if (dustPositions[idx+1] > player.position.y + 1.8 || Math.random() < speed * 0.4 / DUST_COUNT) {
          dustPositions[idx]   = player.position.x + Math.sin(playerYaw)*1.1 + (Math.random()-0.5)*0.8;
          dustPositions[idx+1] = player.position.y + 0.05 + Math.random()*0.12;
          dustPositions[idx+2] = player.position.z + Math.cos(playerYaw)*1.1 + (Math.random()-0.5)*0.8;
        }
      }
      dustParticles.material.opacity = Math.min(0.6, speed * 1.4);
    } else {
      dustParticles.material.opacity *= 0.88;
    }
    dustParticles.geometry.attributes.position.needsUpdate = true;
  }

  // â”€â”€ HUD VITESSE + Ã‰TAT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const speedKmh = Math.round(speed / MAX_SPEED * 80);
  const hudEl = document.getElementById("hud");
  const playerLabel = playerMode === "mech" ? "Personnage"
                    : playerMode === "titan" ? "Bot anime"
                    : playerMode === "pinstripe" ? "Pinstripe Shadows"
                    : playerMode === "car" ? "Voiture"
                    : playerMode === "chasseur" ? "Avion chasseur"
                    : playerMode === "wargun" ? "Wargun"
                    : playerMode === "fly" ? "Vue avion"
                    : "Trottinette";
  const extraControls = playerMode === "titan" || playerMode === "pinstripe" ? " &nbsp; F=attaque" : "";
  if (hudEl) hudEl.innerHTML =
    `${playerLabel} &nbsp; W/Z/RT=avancer &nbsp; A/D/stick=virer &nbsp; S/LT=freiner &nbsp; SHIFT/RB=boost &nbsp; ESPACE/A=saut &nbsp; T/Y=salto${extraControls}`
    + `<br><span style="font-size:22px;font-weight:bold">${speedKmh} <small>km/h</small></span>`
    + `&nbsp;&nbsp;<span style="opacity:0.7">[${scooterState}]</span>`
    + `&nbsp;&nbsp;<small style="opacity:0.72">${groundGamepadStatus}</small>`
    + `&nbsp;&nbsp;<small style="opacity:0.5">clic = camÃ©ra libre souris</small>`;

  // â”€â”€ CAMÃ‰RA ORBITALE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Auto-suivi yaw quand souris non capturÃ©e
  if (!pointerLocked) {
    let dy = playerYaw - cameraYaw;
    while (dy >  Math.PI) dy -= 2*Math.PI;
    while (dy < -Math.PI) dy += 2*Math.PI;
    cameraYaw += dy * 0.04;
  }
  // Zoom dynamique selon vitesse
  const camDist = cameraZoom * (1 + speed * 0.55);
  // Camera shake sur atterrissage
  const shake = (scooterState === 'LAND') ? (landTimer / 12) * 0.28 : 0;
  camera.position.set(
    player.position.x + Math.sin(cameraYaw) * Math.cos(cameraPitch) * camDist + (Math.random()-0.5)*shake,
    player.position.y + Math.sin(cameraPitch) * camDist + 1.5            + (Math.random()-0.5)*shake,
    player.position.z + Math.cos(cameraYaw) * Math.cos(cameraPitch) * camDist
  );
  camera.lookAt(player.position.x, player.position.y + 3, player.position.z);

  renderer.render(scene, camera);
  if (minimapCtx) drawMinimap();
}

function drawMinimap() {
  const ctx = minimapCtx;
  if (!ctx || !player) return;
  const S = MINI_PX;
  const scale = S / (MAP_SIZE * 2); // monde -> pixels

  function wx(x) { return (x + MAP_SIZE) * scale; }
  function wz(z) { return (z + MAP_SIZE) * scale; }

  ctx.clearRect(0, 0, S, S);

  // fond eau (bleu)
  ctx.fillStyle = "#1040a0";
  ctx.fillRect(0, 0, S, S);

  // socle urbain
  ctx.fillStyle = "#5f6962";
  ctx.beginPath();
  ctx.arc(wx(0), wz(0), ISLAND_RADIUS * scale, 0, Math.PI * 2);
  ctx.fill();

  // quais
  ctx.strokeStyle = "#b8ad95";
  ctx.lineWidth = 6 * scale;
  ctx.beginPath();
  ctx.arc(wx(0), wz(0), ISLAND_RADIUS * scale, 0, Math.PI * 2);
  ctx.stroke();

  // parcs
  ctx.fillStyle = "rgba(70,135,76,0.82)";
  parkMarkers.forEach(zone => {
    ctx.fillRect(wx(zone.x) - zone.w * scale / 2, wz(zone.z) - zone.d * scale / 2, zone.w * scale, zone.d * scale);
  });

  // zones surelevees
  ctx.fillStyle = "rgba(95,110,95,0.75)";
  elevationMarkers.forEach(zone => {
    ctx.fillRect(wx(zone.x) - zone.w * scale / 2, wz(zone.z) - zone.d * scale / 2, zone.w * scale, zone.d * scale);
  });

  // cours d'eau interieurs
  ctx.strokeStyle = "#1f8fd1";
  ctx.lineWidth = 8 * scale;
  ctx.lineCap = "round";
  waterways.forEach(c => {
    ctx.beginPath();
    ctx.moveTo(wx(c.x1), wz(c.z1));
    ctx.lineTo(wx(c.x2), wz(c.z2));
    ctx.stroke();
  });

  // grille lÃ©gÃ¨re
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 8; i++) {
    let p = (S / 8) * i;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
  }

  // routes sur la minimap
  ctx.strokeStyle = "#555";
  ctx.lineCap = "round";
  roads.forEach(r => {
    ctx.lineWidth = (r.width || ROAD_WIDTH) * scale * 1.5;
    ctx.beginPath();
    ctx.moveTo(wx(r.x1), wz(r.z1));
    ctx.lineTo(wx(r.x2), wz(r.z2));
    ctx.stroke();
  });
  // lignes blanches
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 4]);
  roads.forEach(r => {
    ctx.beginPath();
    ctx.moveTo(wx(r.x1), wz(r.z1));
    ctx.lineTo(wx(r.x2), wz(r.z2));
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // ponts
  ctx.fillStyle = "#9aa3ad";
  bridgeMarkers.forEach(b => {
    ctx.save();
    ctx.translate(wx(b.x), wz(b.z));
    ctx.rotate(-b.rot);
    ctx.fillRect(-b.width * scale / 2, -b.length * scale / 2, b.width * scale, b.length * scale);
    ctx.restore();
  });

  // bâtiments (gris)
  ctx.fillStyle = "rgba(170,180,190,0.85)";
  buildings.forEach(b => {
    const width = b.userData.mapWidth || (b.geometry && b.geometry.parameters.width) || 4;
    const depth = b.userData.mapDepth || (b.geometry && b.geometry.parameters.depth) || 4;
    const w = Math.max(3, width * scale);
    const d = Math.max(3, depth * scale);
    ctx.fillRect(wx(b.position.x) - w / 2, wz(b.position.z) - d / 2, w, d);
  });

  // poteaux (jaune)
  ctx.fillStyle = "#ffcc00";
  poles.forEach(p => {
    ctx.beginPath();
    ctx.arc(wx(p.position.x), wz(p.position.z), Math.max(2, 0.2 * scale * 3), 0, Math.PI * 2);
    ctx.fill();
  });

  // joueur (rouge, avec direction)
  let px = wx(player.position.x);
  let pz = wz(player.position.z);
  ctx.fillStyle = "#ff3333";
  ctx.beginPath();
  ctx.arc(px, pz, 4, 0, Math.PI * 2);
  ctx.fill();

  // flÃ¨che direction
  let speed = Math.sqrt(velocity.x*velocity.x + velocity.z*velocity.z);
  if (speed > 0.01) {
    let len = 10;
    let ex = px + (velocity.x / speed) * len;
    let ez = pz + (velocity.z / speed) * len;
    ctx.strokeStyle = "#ff9999";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, pz);
    ctx.lineTo(ex, ez);
    ctx.stroke();
  }

  // lÃ©gende
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "9px Arial";
  ctx.fillText("â— joueur", 5, S - 28);
  ctx.fillStyle = "rgba(255,204,0,0.8)";
  ctx.fillText("â— poteau", 5, S - 18);
}

function buildStreetTree(x, z, scale = 1) {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6f4a24, roughness: 0.9 });
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2f6f3d, roughness: 0.82 });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * scale, 0.24 * scale, 2.4 * scale, 9), trunkMat);
  trunk.position.y = 1.2 * scale;
  group.add(trunk);

  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.35 * scale, 14, 10), leavesMat);
  crown.position.y = 2.9 * scale;
  crown.scale.set(1.05, 0.9, 1.05);
  group.add(crown);

  group.position.set(x, 0, z);
  return group;
}

// â”€â”€ PALMIER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildPalmTree(x, z) {
  const group = new THREE.Group();
  const trunkMat  = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.9 });
  const leavesMat = new THREE.MeshStandardMaterial({ color: 0x2d8a1e, roughness: 0.8, side: THREE.DoubleSide });
  const cocoMat   = new THREE.MeshStandardMaterial({ color: 0x5a3a10 });

  // Tronc courbÃ© (3 segments)
  const tiltX = (Math.random() - 0.5) * 0.25;
  const tiltZ = (Math.random() - 0.5) * 0.25;
  const HEIGHT = 6 + Math.random() * 2;
  const SEGS = 4;
  for (let i = 0; i < SEGS; i++) {
    const seg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22 - i*0.04, 0.28 - i*0.03, HEIGHT/SEGS, 8),
      trunkMat
    );
    seg.position.set(tiltX * i * 0.6, HEIGHT/SEGS * (i + 0.5), tiltZ * i * 0.6);
    seg.rotation.x = tiltZ * 0.12;
    seg.rotation.z = -tiltX * 0.12;
    group.add(seg);
  }

  // Feuilles
  const topX = tiltX * SEGS * 0.6;
  const topZ = tiltZ * SEGS * 0.6;
  const LEAF_COUNT = 7;
  for (let i = 0; i < LEAF_COUNT; i++) {
    const a = (i / LEAF_COUNT) * Math.PI * 2;
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(2.2, 3.5, 4),
      leavesMat
    );
    leaf.position.set(topX + Math.cos(a) * 1.2, HEIGHT + 1.2, topZ + Math.sin(a) * 1.2);
    leaf.rotation.z =  Math.cos(a) * 0.85;
    leaf.rotation.x = -Math.sin(a) * 0.85;
    group.add(leaf);
  }

  // Noix de coco (2-3)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const coco = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), cocoMat);
    coco.position.set(topX + Math.cos(a) * 0.5, HEIGHT - 0.2, topZ + Math.sin(a) * 0.5);
    group.add(coco);
  }

  group.position.set(x, 0, z);
  return group;
}
