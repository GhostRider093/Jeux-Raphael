import * as THREE from 'three';
import { createLibraryObject } from './object-library.js?v=cockpit-cibles-20260730';

// ==========================================================================
//  FORMAT DES CARTES PERSO
// --------------------------------------------------------------------------
//  Une carte perso n'est pas une copie du monde : c'est un PATCH. Le monde de
//  base est reconstruit normalement — il est deterministe, sa graine ne change
//  pas — puis seules les differences sont appliquees. Un fichier pese donc
//  quelques kilo-octets meme sur une carte de mille objets.
//
//  L'identite d'un objet doit survivre a la reconstruction :
//    instance d'un groupe   ->  "field-rocks#42"
//    objet nomme            ->  "race-gate-3"
//  Ces noms sont poses par world-builder.js et sont stables, y compris pour
//  les objets charges en asynchrone dont l'ordre d'arrivee varie.
// ==========================================================================

export const CUSTOM_MAP_VERSION = 1;

const tmpMatrix = new THREE.Matrix4();

/** Les elements de fond ne sont ni editables ni enregistres. */
function isBackground(object) {
  return /starfield|nebula|planet|speed-tunnel-shell|race-dressing|stretch-handles/.test(object.name || '');
}

/**
 * Parcourt tout ce qui est identifiable dans un monde construit.
 * @param {function} visit reçoit (key, matrixSource) ou matrixSource sait lire
 *   et ecrire une matrice.
 */
export function forEachIdentified(root, visit) {
  root.traverse(node => {
    if (node === root || isBackground(node) || !node.isInstancedMesh || !node.name) return;
    for (let i = 0; i < node.count; i++) visit(`${node.name}#${i}`, node, i);
  });
  root.children.forEach(child => {
    if (child.isInstancedMesh || isBackground(child) || !child.name) return;
    if (child.userData.libraryKey) return;   // piece ajoutee : enregistree a part
    visit(child.name, child, -1);
  });
}

function readMatrix(object, instanceId, result) {
  if (instanceId >= 0) object.getMatrixAt(instanceId, result);
  else result.copy(object.matrix);
  return result;
}

function writeMatrix(object, instanceId, matrix) {
  if (instanceId >= 0) {
    object.setMatrixAt(instanceId, matrix);
    object.instanceMatrix.needsUpdate = true;
  } else {
    matrix.decompose(object.position, object.quaternion, object.scale);
    object.updateMatrixWorld(true);
  }
}

/**
 * Photographie de l'etat d'origine, prise juste apres la construction.
 * C'est la reference qui permet de n'enregistrer que les differences.
 */
export function captureBaseline(root) {
  const baseline = new Map();
  forEachIdentified(root, (key, object, instanceId) => {
    baseline.set(key, readMatrix(object, instanceId, new THREE.Matrix4()).toArray());
  });
  return baseline;
}

/** Comparaison a la tolerance pres : le flottant ne revient jamais identique. */
function sameMatrix(a, b) {
  for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > 1e-4) return false;
  return true;
}

/**
 * Construit le patch : seules les differences avec l'etat d'origine.
 * @param {Array<THREE.Object3D>} added pieces posees depuis la bibliotheque
 * @param {Set<string>} removed identifiants mis a l'ecart
 */
export function serializeEdits(root, baseline, { added = [], removed = new Set() } = {}) {
  const moved = [];
  const current = [];
  forEachIdentified(root, (key, object, instanceId) => {
    if (removed.has(key)) return;
    readMatrix(object, instanceId, tmpMatrix);
    current.length = 0;
    tmpMatrix.toArray(current);
    const original = baseline.get(key);
    if (original && sameMatrix(original, current)) return;
    moved.push({ k: key, m: current.slice() });
  });

  return {
    version: CUSTOM_MAP_VERSION,
    moved,
    removed: [...removed],
    added: added.map(object => ({
      k: object.userData.libraryKey,
      m: object.matrix.toArray()
    })).filter(entry => entry.k)
  };
}

/**
 * Applique un patch a un monde fraichement construit.
 * @returns {{moved:number, removed:number, added:number, missing:number}}
 */
export function applyEdits(root, patch) {
  const report = { moved: 0, removed: 0, added: 0, missing: 0 };
  if (!patch) return report;

  // Index des objets identifiables, construit une fois : sans lui, chaque
  // entree du patch imposerait un parcours complet de la scene.
  const index = new Map();
  forEachIdentified(root, (key, object, instanceId) => index.set(key, { object, instanceId }));

  (patch.moved || []).forEach(entry => {
    const found = index.get(entry.k);
    if (!found) { report.missing++; return; }
    tmpMatrix.fromArray(entry.m);
    writeMatrix(found.object, found.instanceId, tmpMatrix);
    report.moved++;
  });

  (patch.removed || []).forEach(key => {
    const found = index.get(key);
    if (!found) { report.missing++; return; }
    // Un objet retire est ramene a une echelle nulle : invisible, sans trou
    // dans le tampon d'instances.
    readMatrix(found.object, found.instanceId, tmpMatrix);
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    tmpMatrix.decompose(position, quaternion, scale);
    tmpMatrix.compose(position, quaternion, scale.set(0, 0, 0));
    writeMatrix(found.object, found.instanceId, tmpMatrix);
    report.removed++;
  });

  (patch.added || []).forEach(entry => {
    const object = createLibraryObject(entry.k);
    if (!object) { report.missing++; return; }
    tmpMatrix.fromArray(entry.m);
    tmpMatrix.decompose(object.position, object.quaternion, object.scale);
    root.add(object);
    object.updateMatrixWorld(true);
    report.added++;
  });

  return report;
}

/**
 * Inscrit les pieces ajoutees dans le champ de collision, pour qu'elles soient
 * solides en vol. Sans cet appel, on traverserait tout ce qu'on a pose.
 */
export function registerAddedCollisions(root, addBoxFromCenter, collision) {
  if (!collision) return 0;
  let registered = 0;
  root.children.forEach(child => {
    const box = child.userData.collisionBox;
    if (!child.userData.libraryKey || !box) return;
    child.updateMatrixWorld(true);
    const scale = child.scale;
    addBoxFromCenter(
      collision,
      child.position.x + box.offsetX * scale.x,
      child.position.y + box.offsetY * scale.y,
      child.position.z + box.offsetZ * scale.z,
      Math.abs(box.halfWidth * scale.x),
      Math.abs(box.halfHeight * scale.y),
      Math.abs(box.halfDepth * scale.z)
    );
    registered++;
  });
  return registered;
}
