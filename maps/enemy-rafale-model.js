// ==========================================================================
//  CHASSEUR ENNEMI  -  Dassault Rafale
// --------------------------------------------------------------------------
//  La flotte de dix volait en Kawasaki Ki-61, un chasseur a helice de 1943.
//  Elle passe au Rafale le 16/09/2026 : jet, delta-canard, et une vitesse de
//  patrouille majoree de 50 % (voir world-combat.js).
//
//  Le modele vient de `Rafale++support_.3mf`, un projet d'impression pose a
//  la racine du depot. Il est converti hors ligne en deux temps, recette
//  complete dans scripts/convert-rafale.py puis scripts/blender-rafale.py :
//  279 000 triangles ramenes a 27 900, lissage par angle a 30 degres, gris
//  metal avec les panneaux d'aile exterieurs bleu et rouge — la livree de la
//  plaque AMS, qui rend l'appareil lisible a 400 m contre le ciel.
//
//  ATTENTION aux deux autres fichiers Rafale de la racine : `RAFALE.3mf` est
//  le meme appareil coupe en deux pour le plateau d'impression, et
//  `Dassault+Rafale_AMS.3mf` n'est pas un avion du tout mais une plaque
//  murale PLATE de 8 mm. Ni l'un ni l'autre ne se pose dans le ciel.
//
//  Orientation : le nez pointe vers -Z et le haut vers +Y, comme le chasseur
//  du joueur. Aucune rotation de rattrapage n'est necessaire.
//
//  Le gabarit n'est charge qu'une fois ; chaque ennemi en est un clone, qui
//  partage geometries et materiaux. Le cout d'un ennemi supplementaire est
//  donc celui de ses appels de rendu, pas celui du modele.
// ==========================================================================

import * as THREE from 'three';
import { GLTFLoader } from '../libs/loaders/GLTFLoader.js';

// Le suffixe de version force le rechargement du GLB : sans lui le
// navigateur garde en cache l'ancien modele malgre un Ctrl+F5 sur la page.
const MODEL_URL = './assets/enemies/rafale/rafale.glb?v=rafale-20260916';

//  TUYERES. Mesurees sur le GLB lui-meme, exprimees en fraction de la
//  longueur nez-queue : le modele est recentre puis mis a l'echelle ici, une
//  cote en dur se decalerait au premier changement de `targetLength`.
//  L'axe du fuselage n'est pas a mi-hauteur de la boite englobante — la
//  derive tire le haut de la boite, les bidons tirent le bas — d'ou un Y
//  franchement negatif, qui est bien le centre des deux tuyeres.
const TUYERE_X = .036;
const TUYERE_Y = -.072;
const TUYERE_Z = .418;
const FLAMME_LONGUEUR = .085;
const FLAMME_RAYON = .026;

let templatePromise = null;

function loadTemplate() {
  if (templatePromise) return templatePromise;

  templatePromise = new GLTFLoader().loadAsync(MODEL_URL).then(gltf => {
    const template = gltf.scene;
    template.name = 'rafale-template';
    template.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
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
 *   monde. L'envergure vaut 0,70 fois cette valeur : un delta est plus long
 *   que large, l'inverse exact du chasseur a helice qu'il remplace.
 * @param {boolean} options.thrusters pose les deux flammes de reacteur et les
 *   publie dans `userData.flames`, que les boucles de combat animent deja.
 */
export async function createEnemyFighterModel({ targetLength = 10, thrusters = true } = {}) {
  const template = await loadTemplate();
  const instance = template.clone(true);
  instance.name = 'enemy-fighter-rafale';

  // Mise a l'echelle sur la longueur nez-queue, pas sur la plus grande
  // dimension : elles coincident ici, mais `targetLength` doit garder le
  // meme sens que pour le Kawasaki, dont l'envergure primait.
  const bounds = new THREE.Box3().setFromObject(instance);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = targetLength / (size.z || 1);

  // Un groupe porte le recentrage : l'appareil doit tourner autour de son
  // milieu, pas autour de l'origine ou l'exportateur l'a laisse.
  const root = new THREE.Group();
  root.name = 'enemy-fighter-rafale-root';
  instance.position.sub(center);
  root.add(instance);
  root.scale.setScalar(scale);

  // Les modules de combat animent `userData.flames` : la cle doit exister,
  // meme vide.
  root.userData.flames = [];

  if (thrusters) {
    //  Les flammes sont posees dans le repere du MODELE, donc en unites du
    //  GLB : elles suivent la meme mise a l'echelle que l'appareil et il n'y
    //  a qu'un seul facteur a comprendre. Leur matiere est partagee par les
    //  deux tuyeres et par tous les clones — une flamme n'est pas un objet
    //  qu'on teinte individuellement.
    const longueur = size.z * FLAMME_LONGUEUR;
    const geometry = new THREE.ConeGeometry(size.z * FLAMME_RAYON, longueur, 10, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff5a1e, transparent: true, opacity: .82,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    for (const cote of [-1, 1]) {
      const flame = new THREE.Mesh(geometry, material);
      // Le cone de Three.js pointe vers +Y : un quart de tour l'envoie vers
      // l'arriere de l'appareil, pointe en premier.
      flame.rotation.x = Math.PI / 2;
      flame.position.set(
        cote * size.z * TUYERE_X,
        size.z * TUYERE_Y,
        size.z * TUYERE_Z + longueur / 2
      );
      flame.renderOrder = 30;
      instance.add(flame);
      root.userData.flames.push(flame);
    }
  }

  root.userData.propeller = null;
  return root;
}

export function preloadEnemyFighterModel() {
  return loadTemplate();
}
