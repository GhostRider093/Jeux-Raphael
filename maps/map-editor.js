import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WORLD_MAPS, getPortalRoute } from './world-catalog.js?v=cockpit-cibles-20260730';
import { buildWorld } from './world-builder.js?v=cockpit-cibles-20260730';
import { OBJECT_FAMILIES, OBJECT_LIBRARY, createLibraryObject, libraryKeysByFamily } from './object-library.js?v=cockpit-cibles-20260730';
import { captureBaseline, serializeEdits, applyEdits } from './custom-map-format.js?v=cockpit-cibles-20260730';
import { listCustomMaps, loadCustomMap, saveCustomMap, downloadCustomMap, slugify } from '../custom-maps.js?v=cockpit-cibles-20260730';

// ==========================================================================
//  EDITEUR DE CARTES
// --------------------------------------------------------------------------
//  Un monde du catalogue est duplique puis rendu manipulable. La carte
//  d'origine n'est jamais modifiee.
//
//  Trois points delicats sont traites ici :
//
//  1. Arbres, rochers, immeubles et asteroides sont des `InstancedMesh`. On ne
//     peut pas les deplacer comme des objets ordinaires, mais on peut reecrire
//     la matrice d'UNE instance, et un raycast renvoie son `instanceId`.
//     `makeTarget` masque cette difference derriere une interface unique.
//
//  2. Le glissement capture la transformation de depart et applique un DELTA.
//     Relire la matrice a chaque image faisait deriver l'echelle : l'objet
//     grossissait ou disparaissait en cours de deplacement.
//
//  3. Le clic gauche est retire d'OrbitControls pour servir a l'edition. La
//     rotation de vue passe au clic droit.
// ==========================================================================

const params = new URLSearchParams(location.search);

// ── REMONTEE DES ERREURS ────────────────────────────────────────────────────
// Une exception dans un module ES ne laisse qu'une page noire et un message
// dans une console que personne n'ouvre. Tout est donc affiche a l'ecran.
function showFatal(origin, error) {
  const message = error?.stack || error?.message || String(error);
  let box = document.getElementById('fatal');
  if (!box) {
    box = document.createElement('div');
    box.id = 'fatal';
    box.style.cssText = `position:fixed;z-index:9999;left:16px;right:16px;top:16px;max-height:70vh;overflow:auto;
      padding:16px 18px;color:#ffdede;background:rgba(38,4,8,.96);border:2px solid #ff6b6b;border-radius:12px;
      font:12px/1.55 Consolas,monospace;white-space:pre-wrap;box-shadow:0 18px 50px rgba(0,0,0,.6)`;
    document.body.appendChild(box);
  }
  box.textContent = `ÉDITEUR — ERREUR (${origin})\n\n${message}`;
  console.error(`[editeur] ${origin}`, error);
}
window.addEventListener('error', event => showFatal('exception', event.error || event.message));
window.addEventListener('unhandledrejection', event => showFatal('promesse', event.reason));

// ── CHOIX DU MONDE DE BASE ──────────────────────────────────────────────────

const picker = document.getElementById('picker');
const editorSection = document.getElementById('editor');
const worldGrid = document.getElementById('world-grid');

// Le parametre est nomme `entry` : `world` est la variable d'etat du module.
WORLD_MAPS.forEach(entry => {
  const card = document.createElement('button');
  card.className = 'world-pick';
  card.type = 'button';
  const pieces = Object.values(entry.population || {}).reduce((total, value) => total + (value || 0), 0);
  card.innerHTML = `
    <div class="wp-icon">${entry.icon}</div>
    <div class="wp-name">${entry.name}</div>
    <div class="wp-cat">${entry.category}</div>
    <div class="wp-meta">${entry.size} unités · ${pieces} objets générés${entry.raceCourse ? ` · ${entry.raceCourse.length} portes` : ''}</div>`;
  card.addEventListener('click', () => startEditor(entry.id));
  worldGrid.appendChild(card);
});

// ── ETAT ────────────────────────────────────────────────────────────────────

let renderer, scene, camera, controls, built, world;
let raycaster, pointer, dragPlane;

let selected = [];               // cibles selectionnees, la premiere fait reference
const helperPool = [];           // cadres verts reutilises
const MAX_HELPERS = 60;
const MAX_SELECTION = 300;

let armedKey = null;             // piece de bibliotheque en attente de pose
let armedButton = null;

let dragging = false;
let dragMode = null;             // 'plane' | 'altitude'
let dragStart = [];              // transformations capturees au depart
const dragAnchor = new THREE.Vector3();
let dragStartClientY = 0;

let rubber = null;               // rectangle de selection en cours
const rubberBox = document.getElementById('rubber');

// Etirement par les faces de la boite englobante.
let stretching = null;           // { axis, sign, start… }
let handleGroup = null;
const handles = [];              // 6 poignees, une par face
const HANDLE_AXES = [
  { axis: 'x', sign: -1 }, { axis: 'x', sign: 1 },
  { axis: 'y', sign: -1 }, { axis: 'y', sign: 1 },
  { axis: 'z', sign: -1 }, { axis: 'z', sign: 1 }
];
const tmpLocalBox = new THREE.Box3();
const tmpAxisWorld = new THREE.Vector3();
const tmpOrigin = new THREE.Vector3();

const addedObjects = [];
const deletedInstances = new Set();
let baseline = null;             // etat d'origine, reference du patch
let currentMapId = null;

const statusBar = document.getElementById('status');
const inspector = document.getElementById('inspector');
const inspectorNone = document.getElementById('insp-none');
const snapToggle = document.getElementById('snap-on');
const snapStep = document.getElementById('snap-step');

const fields = {
  px: document.getElementById('px'), py: document.getElementById('py'), pz: document.getElementById('pz'),
  rx: document.getElementById('rx'), ry: document.getElementById('ry'), rz: document.getElementById('rz'),
  sx: document.getElementById('sx'), sy: document.getElementById('sy'), sz: document.getElementById('sz')
};

// Temporaires reutilises : aucune allocation dans les boucles.
const tmpMatrix = new THREE.Matrix4();
const tmpPosition = new THREE.Vector3();
const tmpQuaternion = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const tmpEuler = new THREE.Euler();
const tmpBox = new THREE.Box3();
const tmpPoint = new THREE.Vector3();
const tmpDelta = new THREE.Vector3();
const tmpProject = new THREE.Vector3();

function setStatus(html) { statusBar.innerHTML = html; }

// ── ANNULATION ──────────────────────────────────────────────────────────────
// Une pile de transformations. Elle ne couvre pas les ajouts et suppressions —
// seulement les deplacements, rotations et echelles, qui sont les gestes
// qu'on rate le plus souvent.
const undoStack = [];
const UNDO_DEPTH = 60;

function pushUndo(targets = selected) {
  if (!targets.length) return;
  const snapshot = targets.map(target => {
    const position = new THREE.Vector3();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    target.read(position, euler, scale);
    return { target, position, euler, scale };
  });
  undoStack.push(snapshot);
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
}

function undo() {
  const snapshot = undoStack.pop();
  if (!snapshot) { setStatus('Rien à annuler'); return; }
  snapshot.forEach(entry => entry.target.write(entry.position, entry.euler, entry.scale));
  refreshInspector();
  refreshHelpers();
  setStatus(`Annulé · ${undoStack.length} étape(s) en mémoire`);
}

if (params.get('base')) startEditor(params.get('base'));

// ── CIBLES MANIPULABLES ─────────────────────────────────────────────────────

function makeTarget(object, instanceId = -1) {
  const instanced = instanceId >= 0 && object.isInstancedMesh;
  return {
    object,
    instanceId,
    instanced,
    key: instanced ? `${object.uuid}:${instanceId}` : object.uuid,
    get label() {
      if (instanced) return `${object.name || 'groupe'} · instance ${instanceId}`;
      const key = object.userData.libraryKey;
      return key ? (OBJECT_LIBRARY[key]?.label || object.name) : (object.name || 'objet');
    },
    read(position, euler, scale) {
      if (instanced) {
        object.getMatrixAt(instanceId, tmpMatrix);
        tmpMatrix.decompose(position, tmpQuaternion, scale);
        euler.setFromQuaternion(tmpQuaternion);
        position.applyMatrix4(object.matrixWorld);
      } else {
        position.copy(object.position);
        euler.copy(object.rotation);
        scale.copy(object.scale);
      }
    },
    write(position, euler, scale) {
      if (instanced) {
        tmpPoint.copy(position);
        object.worldToLocal(tmpPoint);
        tmpQuaternion.setFromEuler(euler);
        tmpMatrix.compose(tmpPoint, tmpQuaternion, scale);
        object.setMatrixAt(instanceId, tmpMatrix);
        object.instanceMatrix.needsUpdate = true;
      } else {
        object.position.copy(position);
        object.rotation.copy(euler);
        object.scale.copy(scale);
        object.updateMatrixWorld(true);
      }
    },
    worldPosition(result) {
      if (instanced) {
        object.getMatrixAt(instanceId, tmpMatrix);
        result.setFromMatrixPosition(tmpMatrix).applyMatrix4(object.matrixWorld);
      } else {
        object.getWorldPosition(result);
      }
      return result;
    },
    remove() {
      if (instanced) {
        // Une instance ne quitte pas le tampon : on l'ecrase a l'echelle nulle,
        // ce qui la rend invisible et non selectionnable.
        object.getMatrixAt(instanceId, tmpMatrix);
        tmpMatrix.decompose(tmpPosition, tmpQuaternion, tmpScale);
        tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale.set(0, 0, 0));
        object.setMatrixAt(instanceId, tmpMatrix);
        object.instanceMatrix.needsUpdate = true;
        deletedInstances.add(this.key);
      } else {
        object.parent?.remove(object);
        const index = addedObjects.indexOf(object);
        if (index >= 0) addedObjects.splice(index, 1);
      }
    },
    box(result) {
      if (instanced) {
        const geometry = object.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        object.getMatrixAt(instanceId, tmpMatrix);
        result.copy(geometry.boundingBox).applyMatrix4(tmpMatrix).applyMatrix4(object.matrixWorld);
      } else {
        result.setFromObject(object);
      }
      return result;
    }
  };
}

/** Elements de fond : jamais selectionnables. */
function isBackground(object) {
  return /starfield|nebula|planet|speed-tunnel-shell|race-dressing/.test(object.name || '');
}

function editableRoot(object) {
  let node = object;
  while (node) {
    if (node.userData.editable || node.userData.libraryKey) return node;
    if (node.parent === built.root) return node;
    node = node.parent;
  }
  return null;
}

// ── DEMARRAGE ───────────────────────────────────────────────────────────────

async function startEditor(worldId) {
  try { await buildEditor(worldId); }
  catch (error) { showFatal('construction du monde', error); }
}

async function buildEditor(worldId) {
  world = WORLD_MAPS.find(item => item.id === worldId);
  if (!world) { showFatal('monde inconnu', new Error(`Aucun monde nommé « ${worldId} »`)); return; }
  picker.hidden = true;
  editorSection.hidden = false;
  document.title = `Éditeur — ${world.name}`;

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  document.getElementById('canvas-host').appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, .5, 9000);
  built = buildWorld(scene, world, message => setStatus(message), getPortalRoute(world.id));

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .09;
  controls.maxDistance = world.size * 2.2;
  // Le clic gauche appartient a l'edition ; la vue tourne au clic droit.
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  resetView();

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  buildPalette();
  wireEvents();

  try { await built.assetsPromise; }
  catch (error) { console.warn('[editeur] chargement partiel des objets 3D', error); }
  // La photographie de reference est prise APRES l'arrivee des objets 3D :
  // sinon les immeubles charges en asynchrone seraient tous vus comme
  // deplaces et enregistres inutilement.
  baseline = captureBaseline(built.root);

  // Reprise d'une carte deja enregistree.
  const resumeId = params.get('map');
  if (resumeId) {
    const saved = await loadCustomMap(resumeId);
    if (saved?.patch) {
      const report = applyEdits(built.root, saved.patch);
      currentMapId = saved.id;
      document.getElementById('map-name').value = saved.name || '';
      // Les pieces reconstruites doivent redevenir editables.
      built.root.children.forEach(child => {
        if (child.userData.libraryKey && !addedObjects.includes(child)) addedObjects.push(child);
      });
      (saved.patch.removed || []).forEach(key => deletedInstances.add(key.replace('#', ':')));
      setStatus(`<b>${saved.name}</b> chargée · ${report.moved} déplacés · ${report.added} ajoutés${report.missing ? ` · ${report.missing} introuvables` : ''}`);
    } else {
      setStatus('Carte introuvable — on repart du monde de base');
    }
  }

  document.getElementById('loading').hidden = true;
  if (!resumeId) reportInventory();
  animate();
}

// ── ENREGISTREMENT ──────────────────────────────────────────────────────────

/**
 * Les identifiants de suppression different entre l'editeur ("uuid:index") et
 * le format enregistre ("nom#index"). Le nom est le seul stable entre deux
 * chargements, c'est donc lui qui part sur disque.
 */
function deletedKeysForFormat() {
  const keys = new Set();
  deletedInstances.forEach(entry => {
    const [uuid, index] = entry.split(':');
    const mesh = built.root.getObjectByProperty('uuid', uuid);
    if (mesh?.name) keys.add(`${mesh.name}#${index}`);
  });
  return keys;
}

function buildPayload() {
  const nameInput = document.getElementById('map-name');
  const name = (nameInput.value || '').trim() || `${world.name} remixé`;
  nameInput.value = name;
  if (!currentMapId) currentMapId = slugify(name);
  return {
    id: currentMapId,
    name,
    baseWorldId: world.id,
    savedAt: new Date().toISOString(),
    patch: serializeEdits(built.root, baseline, {
      added: addedObjects,
      removed: deletedKeysForFormat()
    })
  };
}

async function saveMap() {
  const payload = buildPayload();
  const counts = payload.patch;
  setStatus('Enregistrement…');
  const result = await saveCustomMap(payload);
  const summary = `${counts.moved.length} déplacés · ${counts.added.length} ajoutés · ${counts.removed.length} supprimés`;
  if (result.server) setStatus(`<b>${payload.name}</b> enregistrée sur le serveur · ${summary}`);
  else if (result.local) setStatus(`<b>${payload.name}</b> enregistrée dans ce navigateur · ${summary} · <b>choisis un profil manette pour la retrouver ailleurs</b>`);
  else setStatus('Échec de l’enregistrement — utilise le bouton Fichier');
  // L'URL porte desormais la carte : un rechargement la retrouve.
  history.replaceState(null, '', `?base=${world.id}&map=${payload.id}`);
}

function resetView() {
  const span = world.size * .62;
  const inSpace = world.terrain.kind === 'space';
  camera.position.set(span, inSpace ? span * .5 : span * .42, span);
  controls.target.set(0, inSpace ? 0 : 40, 0);
  controls.update();
}

// ── PALETTE ET POSE ─────────────────────────────────────────────────────────

function buildPalette() {
  const body = document.getElementById('palette-body');
  OBJECT_FAMILIES.forEach(family => {
    const keys = libraryKeysByFamily(family);
    if (!keys.length) return;
    const block = document.createElement('div');
    block.className = 'fam';
    block.innerHTML = `<div class="fam-name">${family}</div>`;
    const items = document.createElement('div');
    items.className = 'fam-items';
    keys.forEach(key => {
      const button = document.createElement('button');
      button.className = 'lib-btn';
      button.type = 'button';
      button.textContent = OBJECT_LIBRARY[key].label;
      button.addEventListener('click', () => armPiece(key, button));
      items.appendChild(button);
    });
    block.appendChild(items);
    body.appendChild(block);
  });
}

/**
 * Arme une piece : rien n'est pose tant qu'on n'a pas clique dans la carte.
 * C'est le geste attendu — choisir, puis designer l'endroit.
 */
function armPiece(key, button) {
  if (armedKey === key) { disarmPiece(); return; }
  disarmPiece();
  armedKey = key;
  armedButton = button;
  button.classList.add('armed');
  document.body.classList.add('placing');
  setStatus(`<b>${OBJECT_LIBRARY[key].label}</b> — clique dans la carte pour le poser · Échap annule`);
}

function disarmPiece() {
  armedButton?.classList.remove('armed');
  armedKey = null;
  armedButton = null;
  document.body.classList.remove('placing');
}

/**
 * Point 3D sous le curseur : la surface visee en priorite, sinon un plan
 * horizontal a la hauteur du centre de vue. Poser sur le decor est le
 * comportement attendu ; le plan sert dans le vide spatial.
 */
function pointUnderCursor(event, result) {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(built.root, true);
  for (const hit of hits) {
    if (isBackground(hit.object)) continue;
    result.copy(hit.point);
    return result;
  }
  dragPlane.set(new THREE.Vector3(0, 1, 0), -controls.target.y);
  return raycaster.ray.intersectPlane(dragPlane, result) ? result : null;
}

function placeArmedPiece(event) {
  const key = armedKey;
  const object = createLibraryObject(key);
  if (!object) { disarmPiece(); return; }
  if (!pointUnderCursor(event, tmpPoint)) { disarmPiece(); return; }
  object.position.set(snap(tmpPoint.x), tmpPoint.y, snap(tmpPoint.z));
  built.root.add(object);
  object.updateMatrixWorld(true);
  addedObjects.push(object);
  select([makeTarget(object)]);
  // La piece reste armee : on en pose souvent plusieurs a la suite.
  setStatus(`<b>${OBJECT_LIBRARY[key].label}</b> posé · clique encore pour en poser un autre · Échap arrête`);
}

// ── SELECTION ───────────────────────────────────────────────────────────────

function select(targets) {
  selected = (targets || []).slice(0, MAX_SELECTION);
  const has = selected.length > 0;
  inspector.classList.toggle('empty', !has);
  inspectorNone.hidden = has;
  if (has) refreshInspector();
  refreshHelpers();
  refreshHandles();
  if (selected.length > 1) setStatus(`<b>${selected.length}</b> objets sélectionnés — glisse pour les déplacer ensemble`);
}

function toggleInSelection(target) {
  const index = selected.findIndex(item => item.key === target.key);
  if (index >= 0) selected.splice(index, 1);
  else selected.push(target);
  select(selected);
}

function isSelected(target) {
  return selected.some(item => item.key === target.key);
}

function getHelper(index) {
  if (!helperPool[index]) {
    const helper = new THREE.Box3Helper(
      new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1)),
      0xa4ed72
    );
    helper.visible = false;
    scene.add(helper);
    helperPool[index] = helper;
  }
  return helperPool[index];
}

function refreshHelpers() {
  const shown = Math.min(selected.length, MAX_HELPERS);
  for (let i = 0; i < shown; i++) {
    const helper = getHelper(i);
    selected[i].box(tmpBox);
    if (tmpBox.isEmpty() || !Number.isFinite(tmpBox.min.x)) { helper.visible = false; continue; }
    helper.box.copy(tmpBox);
    helper.visible = true;
  }
  for (let i = shown; i < helperPool.length; i++) helperPool[i].visible = false;
}

function refreshInspector() {
  if (!selected.length) return;
  selected[0].read(tmpPosition, tmpEuler, tmpScale);
  fields.px.value = tmpPosition.x.toFixed(1);
  fields.py.value = tmpPosition.y.toFixed(1);
  fields.pz.value = tmpPosition.z.toFixed(1);
  fields.rx.value = THREE.MathUtils.radToDeg(tmpEuler.x).toFixed(0);
  fields.ry.value = THREE.MathUtils.radToDeg(tmpEuler.y).toFixed(0);
  fields.rz.value = THREE.MathUtils.radToDeg(tmpEuler.z).toFixed(0);
  fields.sx.value = tmpScale.x.toFixed(2);
  fields.sy.value = tmpScale.y.toFixed(2);
  fields.sz.value = tmpScale.z.toFixed(2);
}

function applyInspector() {
  if (!selected.length) return;
  const target = selected[0];
  target.read(tmpPosition, tmpEuler, tmpScale);
  tmpPosition.set(Number(fields.px.value) || 0, Number(fields.py.value) || 0, Number(fields.pz.value) || 0);
  tmpEuler.set(
    THREE.MathUtils.degToRad(Number(fields.rx.value) || 0),
    THREE.MathUtils.degToRad(Number(fields.ry.value) || 0),
    THREE.MathUtils.degToRad(Number(fields.rz.value) || 0)
  );
  // Une echelle nulle rendrait l'objet invisible et insaisissable.
  tmpScale.set(Number(fields.sx.value) || .01, Number(fields.sy.value) || .01, Number(fields.sz.value) || .01);
  target.write(tmpPosition, tmpEuler, tmpScale);
  refreshHelpers();
}

function updatePointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function pickAt(event) {
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(built.root, true);
  for (const hit of hits) {
    const object = hit.object;
    if (isBackground(object)) continue;
    if (object.isInstancedMesh && hit.instanceId !== undefined) {
      if (deletedInstances.has(`${object.uuid}:${hit.instanceId}`)) continue;
      return makeTarget(object, hit.instanceId);
    }
    const root = editableRoot(object);
    if (root && root !== built.root) return makeTarget(root);
  }
  return null;
}

function snap(value) {
  if (!snapToggle.checked) return value;
  const step = Math.max(1, Number(snapStep.value) || 10);
  return Math.round(value / step) * step;
}

// ── ETIREMENT PAR LES FACES ─────────────────────────────────────────────────
// Six poignees se posent au centre des faces de la boite de l'objet. Tirer sur
// l'une allonge l'objet sur cet axe seul, en laissant la face opposee en place
// — c'est ce qu'on attend en etirant un tunnel pour le rallonger.

/**
 * Boite de l'objet dans son propre repere, transformation annulee.
 * Mesuree une seule fois puis conservee : c'est la reference stable a partir de
 * laquelle l'echelle est recalculee.
 */
function localBoxOf(target, result) {
  if (target.instanced) {
    const geometry = target.object.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    return result.copy(geometry.boundingBox);
  }
  const object = target.object;
  if (object.userData.localBox) return result.copy(object.userData.localBox);
  // On neutralise la transformation le temps de la mesure, puis on la remet.
  const savedPosition = object.position.clone();
  const savedQuaternion = object.quaternion.clone();
  const savedScale = object.scale.clone();
  object.position.set(0, 0, 0);
  object.quaternion.identity();
  object.scale.set(1, 1, 1);
  object.updateMatrixWorld(true);
  result.setFromObject(object);
  object.position.copy(savedPosition);
  object.quaternion.copy(savedQuaternion);
  object.scale.copy(savedScale);
  object.updateMatrixWorld(true);
  object.userData.localBox = result.clone();
  return result;
}

function ensureHandles() {
  if (handleGroup) return;
  handleGroup = new THREE.Group();
  handleGroup.name = 'stretch-handles';
  handleGroup.visible = false;
  const material = new THREE.MeshBasicMaterial({ color: 0xffd95d, depthTest: false, toneMapped: false });
  HANDLE_AXES.forEach((spec, index) => {
    const handle = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    handle.renderOrder = 900;
    handle.userData.handleIndex = index;
    handleGroup.add(handle);
    handles.push(handle);
  });
  scene.add(handleGroup);
}

/** Replace les poignees sur les faces de l'objet de reference. */
function refreshHandles() {
  ensureHandles();
  // Une seule cible : etirer un groupe entier n'aurait pas de sens clair.
  if (selected.length !== 1) { handleGroup.visible = false; return; }
  const target = selected[0];
  localBoxOf(target, tmpLocalBox);
  if (tmpLocalBox.isEmpty()) { handleGroup.visible = false; return; }
  handleGroup.visible = true;

  target.read(tmpPosition, tmpEuler, tmpScale);
  tmpQuaternion.setFromEuler(tmpEuler);
  tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
  // Taille des poignees liee a la distance : lisibles de pres comme de loin.
  const handleSize = camera.position.distanceTo(tmpPosition) * .014;

  HANDLE_AXES.forEach((spec, index) => {
    tmpLocalBox.getCenter(tmpPoint);
    tmpPoint[spec.axis] = spec.sign < 0 ? tmpLocalBox.min[spec.axis] : tmpLocalBox.max[spec.axis];
    tmpPoint.applyMatrix4(tmpMatrix);
    handles[index].position.copy(tmpPoint);
    handles[index].scale.setScalar(handleSize);
  });
}

function pickHandle(event) {
  if (!handleGroup?.visible) return null;
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(handles, false)[0];
  return hit ? HANDLE_AXES[hit.object.userData.handleIndex] : null;
}

function beginStretch(event, spec) {
  const target = selected[0];
  if (!target) return false;
  pushUndo([target]);
  const position = new THREE.Vector3();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3();
  target.read(position, euler, scale);
  localBoxOf(target, tmpLocalBox);

  const localSize = tmpLocalBox.max[spec.axis] - tmpLocalBox.min[spec.axis];
  if (localSize < .0001) return false;

  // Direction de l'axe en coordonnees monde : l'objet peut etre tourne.
  tmpQuaternion.setFromEuler(euler);
  tmpAxisWorld.set(0, 0, 0);
  tmpAxisWorld[spec.axis] = 1;
  tmpAxisWorld.applyQuaternion(tmpQuaternion).normalize();

  // Origine = face opposee, celle qui doit rester fixe.
  tmpLocalBox.getCenter(tmpPoint);
  tmpPoint[spec.axis] = spec.sign < 0 ? tmpLocalBox.max[spec.axis] : tmpLocalBox.min[spec.axis];
  tmpMatrix.compose(position, tmpQuaternion, scale);
  tmpOrigin.copy(tmpPoint).applyMatrix4(tmpMatrix);

  stretching = {
    target, spec, localSize,
    startPosition: position.clone(),
    euler: euler.clone(),
    startScale: scale.clone(),
    axisWorld: tmpAxisWorld.clone(),
    origin: tmpOrigin.clone(),
    startExtent: Math.abs(localSize * scale[spec.axis])
  };
  controls.enabled = false;
  return true;
}

function updateStretch(event) {
  const state = stretching;
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);

  // Projection du curseur sur l'axe d'etirement : on cherche le point de l'axe
  // le plus proche du rayon de la souris.
  const ray = raycaster.ray;
  const w0 = tmpPoint.copy(state.origin).sub(ray.origin);
  const a = state.axisWorld.dot(ray.direction);
  const denominator = 1 - a * a;
  if (Math.abs(denominator) < 1e-6) return;
  const distanceAlongAxis =
    (w0.dot(state.axisWorld) - a * w0.dot(ray.direction)) / denominator;

  const extent = Math.max(state.localSize * .02, Math.abs(distanceAlongAxis));
  const factor = extent / state.startExtent;

  const scale = tmpScale.copy(state.startScale);
  scale[state.spec.axis] = state.startScale[state.spec.axis] * factor;

  // La face opposee doit rester immobile : le centre se decale donc de la
  // moitie de l'allongement.
  const growth = extent - state.startExtent;
  const position = tmpPosition.copy(state.startPosition)
    .addScaledVector(state.axisWorld, state.spec.sign * growth * .5);

  state.target.write(position, state.euler, scale);
  refreshInspector();
  refreshHelpers();
  refreshHandles();
}

function endStretch() {
  if (!stretching) return;
  stretching = null;
  controls.enabled = true;
}

// ── RECTANGLE DE SELECTION ──────────────────────────────────────────────────

/** Parcourt toutes les cibles selectionnables de la carte. */
function forEachCandidate(visit) {
  built.root.traverse(node => {
    if (node === built.root || isBackground(node) || !node.isInstancedMesh) return;
    for (let i = 0; i < node.count; i++) {
      if (deletedInstances.has(`${node.uuid}:${i}`)) continue;
      visit(node, i);
    }
  });
  built.root.children.forEach(child => {
    if (!child.isInstancedMesh && !isBackground(child)) visit(child, -1);
  });
}

function finishRubber(additive) {
  const rect = rubber;
  rubber = null;
  rubberBox.hidden = true;
  if (!rect) return;
  const width = Math.abs(rect.x2 - rect.x1);
  const height = Math.abs(rect.y2 - rect.y1);
  // Sous quelques pixels c'est un clic, pas un rectangle.
  if (width < 5 && height < 5) { if (!additive) select([]); return; }

  const canvasRect = renderer.domElement.getBoundingClientRect();
  const minX = Math.min(rect.x1, rect.x2), maxX = Math.max(rect.x1, rect.x2);
  const minY = Math.min(rect.y1, rect.y2), maxY = Math.max(rect.y1, rect.y2);
  const found = additive ? selected.slice() : [];
  const seen = new Set(found.map(item => item.key));

  forEachCandidate((object, instanceId) => {
    if (found.length >= MAX_SELECTION) return;
    const target = makeTarget(object, instanceId);
    if (seen.has(target.key)) return;
    target.worldPosition(tmpProject);
    tmpProject.project(camera);
    // Derriere la camera : `project` replie le point, il faut l'ecarter.
    if (tmpProject.z < -1 || tmpProject.z > 1) return;
    const screenX = canvasRect.left + (tmpProject.x * .5 + .5) * canvasRect.width;
    const screenY = canvasRect.top + (-tmpProject.y * .5 + .5) * canvasRect.height;
    if (screenX < minX || screenX > maxX || screenY < minY || screenY > maxY) return;
    found.push(target);
    seen.add(target.key);
  });

  select(found);
  if (!found.length) setStatus('Rien dans le rectangle');
  else if (found.length >= MAX_SELECTION) setStatus(`<b>${found.length}</b> objets — limite atteinte`);
}

// ── GLISSEMENT ──────────────────────────────────────────────────────────────

/**
 * Capture l'etat des cibles avant deplacement. Le glissement applique ensuite
 * un delta a ces valeurs figees : relire la matrice a chaque image faisait
 * deriver l'echelle, l'objet grossissait ou disparaissait.
 */
function beginDrag(event, altitude) {
  dragStart = selected.map(target => {
    const position = new THREE.Vector3();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    target.read(position, euler, scale);
    return { target, position, euler, scale };
  });
  if (!dragStart.length) return false;
  dragging = true;
  dragMode = altitude ? 'altitude' : 'plane';
  dragStartClientY = event.clientY;
  controls.enabled = false;
  // Le plan de glissement passe par la reference : sinon l'objet sauterait a
  // l'altitude zero au premier mouvement.
  dragPlane.set(new THREE.Vector3(0, 1, 0), -dragStart[0].position.y);
  updatePointer(event);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(dragPlane, dragAnchor)) dragAnchor.copy(dragStart[0].position);
  return true;
}

function updateDrag(event) {
  if (dragMode === 'altitude') {
    // Le pas suit la distance de la camera, sinon le reglage est inutilisable
    // de loin comme de pres.
    const sensitivity = camera.position.distanceTo(controls.target) * .0016;
    tmpDelta.set(0, -(event.clientY - dragStartClientY) * sensitivity, 0);
  } else {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(dragPlane, tmpPoint)) return;
    tmpDelta.copy(tmpPoint).sub(dragAnchor);
    tmpDelta.y = 0;
  }
  dragStart.forEach(entry => {
    tmpPosition.copy(entry.position).add(tmpDelta);
    if (dragMode === 'altitude') tmpPosition.y = snap(tmpPosition.y);
    else { tmpPosition.x = snap(tmpPosition.x); tmpPosition.z = snap(tmpPosition.z); }
    // Rotation et echelle sont reecrites telles qu'au depart : elles ne peuvent
    // donc pas deriver pendant le deplacement.
    entry.target.write(tmpPosition, entry.euler, entry.scale);
  });
  refreshInspector();
  refreshHelpers();
  refreshHandles();
}

function endDrag() {
  if (!dragging) return;
  dragging = false;
  dragStart = [];
  controls.enabled = true;
}

// ── ACTIONS ─────────────────────────────────────────────────────────────────

/** Applique une transformation a chaque objet selectionne. */
function transformSelection(mutate) {
  if (!selected.length) return;
  selected.forEach(target => {
    const position = new THREE.Vector3();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    target.read(position, euler, scale);
    mutate(position, euler, scale);
    target.write(position, euler, scale);
  });
  refreshInspector();
  refreshHelpers();
  refreshHandles();
}

const rotateSelection = (axis, degrees) =>
  transformSelection((position, euler) => { euler[axis] += THREE.MathUtils.degToRad(degrees); });
const flipSelection = axis =>
  transformSelection((position, euler, scale) => { scale[axis] *= -1; });
const scaleSelection = factor =>
  transformSelection((position, euler, scale) => {
    // Bornes larges mais finies : une echelle nulle ou demesuree rendrait
    // l'objet insaisissable.
    scale.multiplyScalar(factor);
    scale.clampScalar(-400, 400);
    if (Math.abs(scale.x) < .01) scale.setScalar(.01);
  });

function duplicateSelection() {
  if (!selected.length) return;
  const copies = [];
  let refused = 0;
  selected.forEach(target => {
    if (target.instanced) {
      const mesh = target.object;
      // Le tampon d'un InstancedMesh est de taille fixe : on n'ajoute une
      // instance que s'il reste une place allouee.
      if (mesh.count >= mesh.instanceMatrix.count) { refused++; return; }
      const newId = mesh.count;
      mesh.getMatrixAt(target.instanceId, tmpMatrix);
      tmpMatrix.decompose(tmpPosition, tmpQuaternion, tmpScale);
      tmpPosition.x += 40;
      tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
      mesh.setMatrixAt(newId, tmpMatrix);
      mesh.count = newId + 1;
      mesh.instanceMatrix.needsUpdate = true;
      copies.push(makeTarget(mesh, newId));
      return;
    }
    const source = target.object;
    const key = source.userData.libraryKey;
    const copy = key ? createLibraryObject(key) : source.clone(true);
    if (!copy) return;
    copy.position.copy(source.position);
    copy.position.x += 40;
    copy.rotation.copy(source.rotation);
    copy.scale.copy(source.scale);
    copy.userData.editable = true;
    built.root.add(copy);
    copy.updateMatrixWorld(true);
    addedObjects.push(copy);
    copies.push(makeTarget(copy));
  });
  if (copies.length) select(copies);
  setStatus(refused
    ? `${copies.length} dupliqué(s) · ${refused} refusé(s), groupe plein — pose une pièce de la bibliothèque`
    : `<b>${copies.length}</b> objet(s) dupliqué(s)`);
}

function deleteSelection() {
  if (!selected.length) return;
  const count = selected.length;
  selected.forEach(target => target.remove());
  select([]);
  setStatus(`<b>${count}</b> objet(s) supprimé(s)`);
}

function reportInventory() {
  let instances = 0, objects = 0;
  built.root.traverse(node => {
    if (node.isInstancedMesh) instances += node.count;
    else if (node.isMesh || node.isGroup) objects++;
  });
  setStatus(`<b>${world.name}</b> · ${instances} instances · ${objects} objets · ${addedObjects.length} ajoutés · ${deletedInstances.size} supprimés`);
}

// ── EVENEMENTS ──────────────────────────────────────────────────────────────

function wireEvents() {
  const canvas = renderer.domElement;

  canvas.addEventListener('contextmenu', event => event.preventDefault());

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    if (armedKey) { placeArmedPiece(event); return; }

    // Les poignees d'etirement passent avant tout : elles flottent devant
    // l'objet et doivent rester attrapables.
    const handleSpec = pickHandle(event);
    if (handleSpec && beginStretch(event, handleSpec)) {
      canvas.setPointerCapture(event.pointerId);
      setStatus(`Étirement sur l’axe <b>${handleSpec.axis.toUpperCase()}</b>`);
      return;
    }

    const target = pickAt(event);
    if (!target) {
      // Vide : on ouvre un rectangle de selection.
      rubber = { x1: event.clientX, y1: event.clientY, x2: event.clientX, y2: event.clientY };
      rubberBox.hidden = false;
      updateRubberBox();
      canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (event.shiftKey) { toggleInSelection(target); return; }
    // Attraper un objet deja selectionne conserve le groupe : c'est ainsi
    // qu'on deplace plusieurs objets d'un seul geste.
    if (!isSelected(target)) select([target]);
    pushUndo();
    if (beginDrag(event, event.altKey)) canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener('pointermove', event => {
    if (stretching) { updateStretch(event); return; }
    if (rubber) { rubber.x2 = event.clientX; rubber.y2 = event.clientY; updateRubberBox(); return; }
    if (dragging) updateDrag(event);
  });

  const release = event => {
    if (rubber) { finishRubber(event.shiftKey); }
    endStretch();
    endDrag();
    if (event.pointerId !== undefined && canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // Molette : agrandit la selection. Sans selection — ou avec Ctrl — elle rend
  // le zoom a la camera.
  //
  // Verrouillee pendant un glissement : sur un pave tactile, tout mouvement a
  // deux doigts emet un evenement `wheel`, et une roulette libre en emet aussi
  // pendant qu'on deplace. L'objet se mettait donc a grossir ou a retrecir en
  // plein deplacement, jusqu'a disparaitre.
  canvas.addEventListener('wheel', event => {
    if (dragging || stretching || !selected.length || event.ctrlKey) return;
    event.preventDefault();
    pushUndo();
    scaleSelection(event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  // Maj enfoncee pendant un glissement : bascule en reglage d'altitude.
  window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'Shift' && dragging && dragMode === 'plane') {
      dragMode = 'altitude';
      dragStartClientY = event.clientY ?? dragStartClientY;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'z') { undo(); event.preventDefault(); return; }
    if (event.key === 'Escape') { disarmPiece(); select([]); setStatus('Sélection annulée'); }
    if (event.key === 'Delete' || event.key === 'Backspace') { deleteSelection(); event.preventDefault(); }
    if (event.key.toLowerCase() === 'd') duplicateSelection();
    if (event.key.toLowerCase() === 'r') { pushUndo(); rotateSelection('y', 45); }
  });

  Object.values(fields).forEach(input => input.addEventListener('change', applyInspector));

  document.querySelectorAll('[data-act]').forEach(button => {
    button.addEventListener('click', () => {
      const action = button.dataset.act;
      if (action !== 'duplicate' && action !== 'delete') pushUndo();
      if (action === 'rot-y') rotateSelection('y', 45);
      if (action === 'rot-x') rotateSelection('x', 45);
      if (action === 'flip-x') flipSelection('x');
      if (action === 'flip-y') flipSelection('y');
      if (action === 'bigger') scaleSelection(1.25);
      if (action === 'smaller') scaleSelection(.8);
      if (action === 'duplicate') duplicateSelection();
      if (action === 'delete') deleteSelection();
    });
  });

  document.getElementById('btn-reset-view').addEventListener('click', resetView);
  document.getElementById('btn-count').addEventListener('click', reportInventory);
  document.getElementById('btn-save').addEventListener('click', () => saveMap().catch(error => showFatal('enregistrement', error)));
  document.getElementById('btn-export').addEventListener('click', () => downloadCustomMap(buildPayload()));
  document.getElementById('btn-play').addEventListener('click', async () => {
    await saveMap().catch(error => showFatal('enregistrement', error));
    location.href = `mondes.html?map=${world.id}&mode=chasseur&custom=${currentMapId}`;
  });

  // Ctrl+S : le reflexe de tout le monde, et le meilleur filet contre la perte
  // de travail.
  window.addEventListener('keydown', event => {
    if (event.ctrlKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveMap().catch(error => showFatal('enregistrement', error));
    }
  });

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function updateRubberBox() {
  if (!rubber) return;
  rubberBox.style.left = `${Math.min(rubber.x1, rubber.x2)}px`;
  rubberBox.style.top = `${Math.min(rubber.y1, rubber.y2)}px`;
  rubberBox.style.width = `${Math.abs(rubber.x2 - rubber.x1)}px`;
  rubberBox.style.height = `${Math.abs(rubber.y2 - rubber.y1)}px`;
}

// ── BOUCLE ──────────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  // La taille des poignees depend de la distance de la camera : elles doivent
  // donc suivre les mouvements de vue. Six mises a jour de vecteurs, sans
  // allocation — le cout est negligeable.
  if (selected.length === 1 && !stretching) refreshHandles();
  renderer.render(scene, camera);
}

window.__raphaelEditor = {
  worldId: () => world?.id,
  selection: () => selected.map(target => target.label),
  added: () => addedObjects.length,
  deleted: () => deletedInstances.size,
  libraryKeys: () => Object.keys(OBJECT_LIBRARY)
};
