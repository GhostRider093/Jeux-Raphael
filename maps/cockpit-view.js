import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';

// ── VUE COCKPIT 3D ──────────────────────────────────────────────────────────
// Le modèle vient d'un cockpit d'Eurofighter imprimable en 3D (Printables
// #223908, CC BY-NC-SA 4.0), exporté en GLB. Trois conséquences directes sur
// le code ci-dessous :
//   · unités en millimètres, axe Z vers le haut, +Y vers le pilote (trimesh) ;
//   · aucune normale dans les géométries — les matériaux sont donc à facettes,
//     ce qui convient à une pièce mécanique ;
//   · neuf pièces de visserie (bezels, clips, supports de LED) sont posées à
//     plat sur le plateau d'impression, sous la console. Elles n'ont pas de
//     place dans un cockpit assemblé : elles restent masquées.
//
// Le rig est un enfant de la caméra : la structure est solidaire du regard au
// pixel près, sans un seul calcul dans la boucle de vol. Basculer la vue ne
// touche qu'à `.visible`.

const MODEL_URL = './assets/cockpit/eurofighter-cockpit.glb';

// ── CASQUETTE : PROPORTION DE MAQUETTE ──────────────────────────────────────
// La casquette d'origine avance de 80 mm au-dessus d'une planche haute de
// 58 mm — à l'échelle du jeu, un auvent d'un mètre au-dessus des genoux. Vue
// de l'intérieur, elle mangeait la moitié de l'écran et forçait à descendre
// l'œil sous son bord pour apercevoir les instruments. On la ramène à une
// profondeur d'auvent réaliste, en la pinçant vers son bord avant (Y = 23,6)
// pour ne pas décoller le reste de l'assemblage.
const HOOD_DEPTH = .45;
const HOOD_FRONT = 23.6;

// Point de vue du pilote, exprimé dans le repère du modèle (millimètres).
// X : axe de la planche · Y : recul derrière la casquette · Z : hauteur des
// yeux. Une fois l'auvent raccourci, le regard passe par-dessus son bord et
// retombe sur les écrans : le poste tient dans le tiers bas de l'image.
const EYE = { x: 43.5, y: 160, z: 104 };

// 106,6 mm de large ramenés à ~1,28 unité de jeu (l'unité vaut environ un
// mètre : l'envergure du chasseur est de 10,5). L'échelle seule ne change pas
// le cadrage — elle agit autour de l'œil : ce sont EYE et `tune` qui cadrent.
const SCALE = .012;

// Pièces posées à plat sur le plateau d'impression.
const PRINT_PARTS = /^(bez|clip|led)_/;

// Verrière du collimateur : transparente, sinon elle masque l'horizon.
const GLASS_PARTS = /^hudglass$/;

// Surfaces lumineuses : écran de collimateur.
const SCREEN_PARTS = /^hudscr$/;

// ── PLANCHE DE BORD ─────────────────────────────────────────────────────────
// La planche est percée de trois découpes (deux grands écrans verticaux, un
// petit écran central) : dans le modèle imprimable, elles reçoivent des écrans
// papier tenus par des clips. Sans rien derrière, on voit le paysage à travers
// la planche de bord. On referme donc l'arrière du panneau avec une plaque
// unique, texturée : elle bouche les trous et fournit les instruments.
//
// Repère du panneau : le grand pan incliné a pour normale (0 ; 0,9285 ;
// -0,3714) — 21,8° de dévers — et sa face avant est à 2 mm de l'origine. Les
// coordonnées ci-dessous sont mesurées dans ce plan : U le long de l'axe X du
// modèle, V en remontant le pan.
const PANEL = {
  normal: [0, .9285, -.3714],
  up: [0, .3714, .9285],
  uMin: -9.8, uMax: 96.8,     // largeur totale de la planche
  vMin: 23, vMax: 58.4,       // bande percée par les trois découpes
  depth: -1                   // 3 mm derrière la face avant : aucun z-fighting
};

// Le panneau vertical du haut (Y = 23,6 mm, Z de 49 à 70) est lui aussi percé :
// une découpe carrée à droite de l'axe, plus l'échancrure du collimateur. Une
// petite plaque aveugle, glissée dans l'épaisseur de la paroi, suffit à ne plus
// voir le ciel au travers.
const PANEL_BLIND = {
  normal: [0, 1, 0],
  up: [0, 0, 1],
  uMin: 48, uMax: 74,
  vMin: 54, vMax: 68,
  depth: 21
};

// Découpes, mesurées sur la géométrie (mêmes coordonnées U/V).
const PANEL_SCREENS = [
  { u0: 60.3, u1: 83.6, v0: 25, v1: 57, title: 'PUISSANCE', kind: 'bars' },
  { u0: 32, u1: 53, v0: 28, v1: 43, title: 'SYSTÈMES', kind: 'systems' },
  { u0: 3.3, u1: 25.2, v0: 25, v1: 57, title: 'APPAREIL', kind: 'aircraft' }
];

let modelPromise = null;

function loadModel() {
  if (!modelPromise) {
    modelPromise = new GLTFLoader().loadAsync(MODEL_URL).catch(error => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

// Fond de planche : dessiné une fois, jamais redessiné en vol.
function drawPanelCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 340;
  const context = canvas.getContext('2d');
  const width = PANEL.uMax - PANEL.uMin, height = PANEL.vMax - PANEL.vMin;
  // Le demi-tour du rig inverse l'axe X du modèle : on dessine directement
  // dans le repère du joueur, U décroissant vers la droite de l'écran.
  const px = u => (PANEL.uMax - u) / width * canvas.width;
  const py = v => (PANEL.vMax - v) / height * canvas.height;

  const base = context.createLinearGradient(0, 0, 0, canvas.height);
  base.addColorStop(0, '#12181e');
  base.addColorStop(1, '#05080b');
  context.fillStyle = base;
  context.fillRect(0, 0, canvas.width, canvas.height);
  // Quelques nervures de tôle : sans elles, la plaque vue de biais est plate.
  context.strokeStyle = 'rgba(126,164,186,.09)';
  context.lineWidth = 2;
  for (let x = 24; x < canvas.width; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvas.height);
    context.stroke();
  }

  PANEL_SCREENS.forEach(screen => {
    const x = px(screen.u1), y = py(screen.v1);
    const w = px(screen.u0) - x, h = py(screen.v0) - y;
    context.save();
    context.translate(x, y);

    context.fillStyle = '#00090d';
    context.fillRect(0, 0, w, h);
    const glow = context.createRadialGradient(w / 2, h * .2, 4, w / 2, h * .2, h * .9);
    glow.addColorStop(0, 'rgba(32,123,145,.30)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, w, h);
    context.strokeStyle = 'rgba(89,207,237,.42)';
    context.lineWidth = 3;
    context.strokeRect(1.5, 1.5, w - 3, h - 3);

    context.fillStyle = '#78dff6';
    context.textAlign = 'center';
    context.font = `700 ${Math.round(h * .085)}px "Bahnschrift SemiCondensed",Segoe UI,sans-serif`;
    context.fillText(screen.title, w / 2, h * .135);

    if (screen.kind === 'bars') {
      const values = [.46, .72, .88, .62, .78];
      const barWidth = w / 11, foot = h * .84, top = h * .26;
      values.forEach((value, index) => {
        const bx = w / 2 + (index - 2) * barWidth * 1.7 - barWidth / 2;
        const bh = (foot - top) * value;
        const paint = context.createLinearGradient(0, foot - bh, 0, foot);
        paint.addColorStop(0, '#9ceaff');
        paint.addColorStop(1, '#2f7c95');
        context.fillStyle = paint;
        context.fillRect(bx, foot - bh, barWidth, bh);
      });
    } else if (screen.kind === 'systems') {
      const rows = [['MOTEUR', '100%'], ['VOL', 'ACTIF'], ['RADAR', 'ARMÉ']];
      context.font = `600 ${Math.round(h * .11)}px "Bahnschrift SemiCondensed",Segoe UI,sans-serif`;
      rows.forEach(([label, value], index) => {
        const ry = h * .38 + index * h * .21;
        context.textAlign = 'left';
        context.fillStyle = '#9fd2e2';
        context.fillText(label, w * .12, ry);
        context.textAlign = 'right';
        context.fillStyle = '#e4fbff';
        context.fillText(value, w * .88, ry);
      });
    } else {
      // Silhouette d'appareil vue de dessus, sur deux cercles de portée.
      context.strokeStyle = 'rgba(120,223,246,.35)';
      context.lineWidth = 2;
      [.34, .22].forEach(ratio => {
        context.beginPath();
        context.arc(w / 2, h * .58, h * ratio, 0, Math.PI * 2);
        context.stroke();
      });
      context.fillStyle = '#78dff6';
      context.beginPath();
      context.moveTo(w / 2, h * .40);
      context.lineTo(w / 2 + w * .26, h * .70);
      context.lineTo(w / 2 + w * .06, h * .66);
      context.lineTo(w / 2 + w * .05, h * .78);
      context.lineTo(w / 2 - w * .05, h * .78);
      context.lineTo(w / 2 - w * .06, h * .66);
      context.lineTo(w / 2 - w * .26, h * .70);
      context.closePath();
      context.fill();
    }

    // Balayage de lignes : rend la surface lisible comme un écran, pas comme
    // une décalcomanie.
    context.fillStyle = 'rgba(0,0,0,.16)';
    for (let line = 4; line < h; line += 6) context.fillRect(0, line, w, 2);
    context.restore();
  });

  return canvas;
}

// Plaque posée dans un plan du modèle. U suit l'axe X, V remonte le pan.
function createPlate(plane, material, name) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(plane.uMax - plane.uMin, plane.vMax - plane.vMin),
    material
  );
  const normal = new THREE.Vector3(...plane.normal);
  const up = new THREE.Vector3(...plane.up);
  // Base directe : right × up = normal. D'où le -X, qui remet aussi la
  // texture à l'endroit une fois le rig retourné.
  const right = new THREE.Vector3(-1, 0, 0);
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
  mesh.position.set((plane.uMin + plane.uMax) / 2, 0, 0)
    .addScaledVector(up, (plane.vMin + plane.vMax) / 2)
    .addScaledVector(normal, plane.depth);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// Plaque de fond : referme les découpes et porte les instruments.
function createInstrumentPanel() {
  const texture = new THREE.CanvasTexture(drawPanelCanvas());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
  const mesh = createPlate(PANEL, material, 'cockpit-instrument-panel');
  return { mesh, material, texture };
}

/**
 * Monte le cockpit sur la caméra.
 *
 * @param {THREE.PerspectiveCamera} camera caméra de vol (doit appartenir à la scène)
 * @returns {{ready: Promise, setVisible: Function, isLoaded: Function, tune: Function, settings: Function, dispose: Function}}
 */
export function createCockpitView(camera) {
  // Réglages exposés à la console : ils se corrigent à vue, en vol.
  const settings = { x: 0, y: 0, z: 0, scale: SCALE, pitch: 0 };

  const rig = new THREE.Group();
  rig.name = 'cockpit-rig';
  rig.visible = false;
  // Le cockpit est à moins d'un mètre de l'œil : il ne doit jamais être
  // écarté par le culling d'une caméra dont le frustum est calculé pour des
  // décors à plusieurs kilomètres.
  rig.frustumCulled = false;

  // Repère du modèle → repère du jeu : Z-up devient Y-up (tilt), puis demi-tour
  // pour que le +Y du modèle — le côté pilote — passe derrière la caméra.
  const spin = new THREE.Group();
  spin.rotation.y = Math.PI;
  const tilt = new THREE.Group();
  tilt.rotation.x = -Math.PI / 2;
  spin.add(tilt);
  rig.add(spin);

  // Éclairage propre au poste : le cockpit ne doit pas s'éteindre quand
  // l'appareil vire dos au soleil. Une seule lampe, attachée à la caméra pour
  // que sa portée reste exprimée en unités de jeu et non en millimètres.
  const lamp = new THREE.PointLight(0xdfefff, 3.4, 6, 2);
  lamp.position.set(0, .5, .35);
  lamp.castShadow = false;
  camera.add(lamp);
  lamp.visible = false;

  camera.add(rig);

  const disposables = [];
  // `DoubleSide` n'est pas un luxe : la fiche du modèle signale des normales
  // incohérentes et des arêtes non-manifold. En simple face, les triangles mal
  // orientés laisseraient des trous dans la planche de bord.
  // Le gris graphite n'est pas décoratif : en noir profond, la casquette n'est
  // qu'une silhouette plate, sans arête lisible contre le ciel.
  const structureMaterial = new THREE.MeshStandardMaterial({
    color: 0x272d34, roughness: .78, metalness: .16, flatShading: true, side: THREE.DoubleSide
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x8fe6ff, roughness: .08, metalness: 0, flatShading: true,
    transparent: true, opacity: .13, depthWrite: false, side: THREE.DoubleSide
  });
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x04202b, emissive: 0x4fd8ff, emissiveIntensity: 1.35,
    roughness: .35, metalness: 0, flatShading: true, toneMapped: false, side: THREE.DoubleSide
  });
  disposables.push(structureMaterial, glassMaterial, screenMaterial);

  const applySettings = () => {
    rig.position.set(settings.x, settings.y, settings.z);
    rig.rotation.x = THREE.MathUtils.degToRad(settings.pitch);
    rig.scale.setScalar(settings.scale);
  };
  applySettings();

  let loaded = false;
  let wanted = false;
  const parts = new Map();

  const ready = loadModel().then(gltf => {
    const model = gltf.scene;
    // Recentrage sur l'œil du pilote : après quoi l'origine du rig est le
    // point de vue, et les réglages se lisent en unités de jeu.
    model.position.set(-EYE.x, -EYE.y, -EYE.z);
    model.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
      node.frustumCulled = false;
      const name = node.name || node.parent?.name || '';
      parts.set(name, node);
      if (PRINT_PARTS.test(name)) { node.visible = false; return; }
      if (GLASS_PARTS.test(name)) { node.material = glassMaterial; node.renderOrder = 2; return; }
      node.material = SCREEN_PARTS.test(name) ? screenMaterial : structureMaterial;
    });
    // Les nœuds parents des pièces d'impression portent le nom, pas les mesh.
    model.children.forEach(node => { if (PRINT_PARTS.test(node.name || '')) node.visible = false; });
    const hood = parts.get('hood');
    if (hood) {
      hood.scale.y = HOOD_DEPTH;
      hood.position.y = HOOD_FRONT * (1 - HOOD_DEPTH);
    }
    const panel = createInstrumentPanel();
    model.add(panel.mesh);
    const blind = createPlate(PANEL_BLIND, structureMaterial, 'cockpit-blind-plate');
    model.add(blind);
    disposables.push(panel.material, panel.texture, panel.mesh.geometry, blind.geometry);
    tilt.add(model);
    loaded = true;
    rig.visible = wanted;
    lamp.visible = wanted;
    return api;
  });

  const api = {
    ready,
    isLoaded: () => loaded,
    setVisible(value) {
      wanted = !!value;
      rig.visible = loaded && wanted;
      lamp.visible = rig.visible;
    },
    // Réglage à vue depuis la console : RaphaelCockpit.tune({ y: -.05, scale: .011 })
    tune(patch = {}) {
      Object.assign(settings, patch);
      applySettings();
      return { ...settings };
    },
    settings: () => ({ ...settings }),
    // Allumer ou éteindre une pièce nommée du modèle : body, hood, ldash,
    // rdash, hudcon, hudscr, hudglass.
    part(name, visible = true) {
      const node = parts.get(name);
      if (node) node.visible = visible;
      return [...parts.keys()];
    },
    dispose() {
      camera.remove(rig);
      camera.remove(lamp);
      lamp.dispose();
      disposables.forEach(item => item.dispose());
    }
  };

  if (typeof window !== 'undefined') window.RaphaelCockpit = api;
  return api;
}
