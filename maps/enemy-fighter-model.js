// ==========================================================================
//  CHASSEUR ENNEMI  -  Kawasaki Ki-61 « Hien »
// --------------------------------------------------------------------------
//  Le modele de concours (data/objet3d/) arrive en OBJ de 29 Mo, 198 000
//  sommets, 7 materiaux et des textures 4K : injouable tel quel avec dix
//  ennemis a l'ecran. Il est converti hors ligne en GLB — train d'atterrissage
//  supprime (l'appareil est en vol, et le train pesait 142 000 des 198 000
//  sommets), maillage allege, textures ramenees a 1024 et empaquetees ORM.
//  La recette complete est dans scripts/convert-kawasaki.py : 45 000 triangles
//  et 4,2 Mo pour le gabarit final.
//
//  Orientation : le nez du modele pointe vers -Z, comme le chasseur du
//  joueur. Aucune rotation de rattrapage n'est necessaire.
//
//  Aucun halo, aucune surcouche : l'appareil se repere a sa silhouette. Le
//  halo de reperage ajoute a la reprise du modele donnait une cible jaune
//  collee sur chaque ennemi — retire le 07/09/2026 a la demande d'Arnaud.
//
//  Le gabarit n'est charge qu'une fois ; chaque ennemi en est un clone, qui
//  partage geometries et materiaux. Le cout d'un ennemi supplementaire est
//  donc celui de ses appels de rendu, pas celui du modele.
// ==========================================================================

import * as THREE from 'three';
import { GLTFLoader } from '../libs/loaders/GLTFLoader.js';

// Le suffixe de version force le rechargement du GLB : sans lui le
// navigateur garde en cache l'ancien modele malgre un Ctrl+F5 sur la page.
const MODEL_URL = './assets/enemies/kawasaki-ki61/kawasaki-fighter.glb?v=sans-train-20260907';

let templatePromise = null;

// Vitesse de rotation de l'helice, en tours par seconde. Au-dela d'une
// quinzaine de tours l'oeil ne suit plus et le disque scintille.
const PROPELLER_TURNS_PER_SECOND = 11;

// ── HELICES ───────────────────────────────────────────────────────────────
// Une seule boucle d'animation pour toutes les helices en vol : dix ennemis
// ne doivent pas ouvrir dix boucles. Les appareils detruits sortent du graphe
// de scene, on les retire ici a la premiere image ou ils n'ont plus de parent.
const spinningPropellers = new Set();
let spinnerRunning = false;
let lastSpinAt = 0;

function spinPropellers(now) {
  const dt = Math.min((now - lastSpinAt) / 1000, .1);
  lastSpinAt = now;
  const angle = dt * PROPELLER_TURNS_PER_SECOND * Math.PI * 2;
  for (const propeller of spinningPropellers) {
    if (!propeller.parent) { spinningPropellers.delete(propeller); continue; }
    // Le noeud glTF porte deja la rotation de conversion Y-haut : son axe
    // local Y est l'axe longitudinal de l'appareil. `rotateY` compose avec
    // cette rotation au lieu de l'ecraser.
    propeller.rotateY(angle);
  }
  if (spinningPropellers.size) requestAnimationFrame(spinPropellers);
  else spinnerRunning = false;
}

function registerPropeller(propeller) {
  spinningPropellers.add(propeller);
  if (spinnerRunning) return;
  spinnerRunning = true;
  lastSpinAt = performance.now();
  requestAnimationFrame(spinPropellers);
}

function loadTemplate() {
  if (templatePromise) return templatePromise;

  templatePromise = new GLTFLoader().loadAsync(MODEL_URL).then(gltf => {
    const template = gltf.scene;
    template.name = 'kawasaki-ki61-template';
    template.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
      // Le modele est vu de tres pres en poursuite : sans filtrage anisotrope
      // les panneaux de fuselage moirent des que l'appareil s'incline.
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach(material => {
        if (!material) return;
        for (const map of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
          if (map) map.anisotropy = 8;
        }
      });
    });
    return template;
  }).catch(error => {
    templatePromise = null;
    throw error;
  });

  return templatePromise;
}

/**
 * @param {object} options
 * @param {number} options.targetLength longueur nez-queue voulue, en unites de
 *   monde. L'envergure vaut environ 1,4 fois cette valeur : c'est un chasseur
 *   a helice, ses ailes sont plus longues que son fuselage.
 * @param {boolean} options.thrusters conserve pour compatibilite : le Ki-61
 *   n'a pas de reacteur, la cle `userData.flames` reste donc vide et les
 *   boucles d'animation existantes n'ont rien a animer.
 */
export async function createEnemyFighterModel({ targetLength = 10, thrusters = true } = {}) {
  const template = await loadTemplate();
  const instance = template.clone(true);
  instance.name = 'enemy-fighter-kawasaki';

  // Mise a l'echelle sur la longueur nez-queue, pas sur la plus grande
  // dimension : sur un appareil a helice la plus grande dimension est
  // l'envergure, et `targetLength` ne voudrait alors plus rien dire.
  const bounds = new THREE.Box3().setFromObject(instance);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = targetLength / (size.z || 1);

  // Un groupe porte le recentrage : l'appareil doit tourner autour de son
  // milieu, pas autour de l'origine ou l'exportateur l'a laisse.
  const root = new THREE.Group();
  root.name = 'enemy-fighter-kawasaki-root';
  instance.position.sub(center);
  root.add(instance);
  root.scale.setScalar(scale);

  const propeller = instance.getObjectByName('propeller');
  if (propeller) registerPropeller(propeller);

  // Les modules de combat animent `userData.flames` : la cle doit exister.
  root.userData.flames = [];
  root.userData.propeller = propeller || null;
  return root;
}

export function preloadEnemyFighterModel() {
  return loadTemplate();
}
