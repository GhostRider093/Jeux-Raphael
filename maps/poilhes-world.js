/**
 * Un village relevé comme monde du moteur des Mondes.
 *
 * `world-builder.js` fabrique des mondes procéduraux à partir d'une graine.
 * Poilhes, lui, existe : son relief, ses toits et ses arbres viennent du LiDAR
 * et de la BD TOPO. Ce fichier est l'adaptateur entre les deux — il construit le
 * village avec `poilhes-scene.js` et le présente sous la forme que `world-game.js`
 * attend d'un monde : `{ root, getHeight, bounds, collision, portal, … }`.
 *
 * Le moteur n'a donc rien à savoir du village : il y lance son chasseur, son
 * cockpit, son HUD et son combat aérien comme sur n'importe quelle autre carte.
 */
import * as THREE from 'three';
import { construireVillage } from './poilhes-scene.js?v=voiture-20260921';

export async function buildPoilhesWorld(scene, world, onProgress, { renderer, camera, leger = false }) {
  const root = new THREE.Group();
  root.name = `world-${world.id}`;

  // Le village règle la couleur du brouillard au fil de l'heure : il lui en faut
  // un. `buildWorld` s'en charge pour les mondes procéduraux, pas pour celui-ci.
  scene.fog = new THREE.FogExp2(0xc9dcec, 0.00015);

  onProgress?.('Relevé du village…');
  const decor = await construireVillage({
    scene, renderer, camera, root, leger,
    village: world.village || 'poilhes',
    // On fait remonter le pourcentage : c'est le téléchargement des 21 Mo de
    // géométrie qui tient l'écran de chargement, il faut le voir avancer.
    onProgress: (f, msg) => { if (msg) onProgress?.(f > 0.02 && f < 0.99 ? `${msg} ${Math.round(f * 100)} %` : msg); },
  });
  onProgress?.('Village prêt');

  // Le ciel du village est une sphère peinte par son propre shader : la couleur
  // de fond et le brouillard du catalogue n'ont plus cours ici.
  scene.background = null;

  /**
   * Plafond du relief pour le moteur : le sol, mais aussi les toits et les
   * houppiers. Le chasseur du jeu se cale sur `getHeight + 9` ; sans les
   * surfaces, il traverserait les tuiles.
   */
  const getHeight = (x, z) => {
    const sol = decor.groundAt(x, z);
    const dessus = decor.surfaceAt(x, z);
    return dessus > sol ? dessus : sol;
  };

  return {
    root,
    portal: null,            // pas de réseau de portails : Poilhes est un lieu, pas une étape
    raceGates: [],
    raceDressing: null,
    speedZones: [],
    assetsPromise: Promise.resolve(),
    collision: null,         // le relief suffit en vol ; les murs restent à brancher au sol
    getHeight,
    // Pour la voiture : le sol praticable (pont du canal compris), les murs, et
    // le village lui-même, dont on tire la grille d'adhérence des chaussées.
    solAt: (x, z) => decor.walkableAt(x, z),
    blockedAt: (x, z) => decor.blockedAt(x, z),
    villages: [{ decor, x: 0, z: 0 }],
    bounds: decor.bounds - 100,
    // Le moteur appelle ceci à chaque image : c'est l'horloge des shaders du
    // village (eau, feuillage, ciel). Sans elle, le village est figé.
    tick: (dt) => {
      decor.clock.value += dt;
      decor.skyU.uTime.value = decor.clock.value;
      decor.sky.position.copy(camera.position);
    },
    decor,
  };
}
