/**
 * Un pays comme monde du moteur des Mondes.
 *
 * Même rôle que `poilhes-world.js`, pour plusieurs villages à la fois : il
 * construit le pays avec `pays-scene.js` et le rend au moteur sous la forme
 * qu'attend `world-game.js` — `{ root, getHeight, bounds, collision, portal, tick }`.
 * Le moteur n'a rien à savoir de tout cela : il y lance son chasseur, son
 * cockpit, son HUD et son combat aérien comme sur n'importe quelle carte.
 */
import * as THREE from 'three';
import { construirePays } from './pays-scene.js?v=voiture-20260921';
import { construireCourseRoute } from './course-route.js?v=voiture-20260921';

// Le pays fait 8 km de côté : le plan lointain du moteur (4 200 m) couperait
// l'horizon en plein milieu, et le second village disparaîtrait par intermittence.
const PORTEE = 9000;

export async function buildPaysWorld(scene, world, onProgress, { renderer, camera, leger = false }) {
  const root = new THREE.Group();
  root.name = `world-${world.id}`;

  // Le pays règle la couleur du brouillard au fil de l'heure : il lui en faut un.
  // `buildWorld` s'en charge pour les mondes procéduraux, pas pour celui-ci.
  scene.fog = new THREE.FogExp2(0xc9dcec, 0.00015);
  const porteeInitiale = camera.far;
  camera.far = PORTEE;
  camera.updateProjectionMatrix();

  onProgress?.('Relevé du pays…');
  const decor = await construirePays({
    scene, renderer, camera, root, leger,
    pays: world.pays || 'canal',
    // 93 Mo de géométrie pour les deux villages : sans compte rendu, l'écran de
    // chargement reste figé plus d'une minute pendant qu'on entend le réacteur.
    onProgress: (f, msg) => { if (msg) onProgress?.(f > 0.02 && f < 0.99 ? `${msg} ${Math.round(f * 100)} %` : msg); },
  });
  onProgress?.('Pays prêt');

  // Le ciel du pays est une sphère peinte par son propre shader : la couleur de
  // fond et le brouillard du catalogue n'ont plus cours ici.
  scene.background = null;
  decor.setTime(world.heure ?? 11.5);

  /**
   * Plafond du relief : le sol, mais aussi les toits et les houppiers. Le
   * chasseur se cale sur `getHeight + 9` ; sans les surfaces, il traverserait
   * les tuiles des deux villages.
   */
  const getHeight = (x, z) => {
    const sol = decor.groundAt(x, z);
    const dessus = decor.surfaceAt(x, z);
    return dessus > sol ? dessus : sol;
  };

  // Ombres : le soleil suit l'avion. Une carte de 8 km ne tient pas dans une
  // caméra d'ombre — on la recadre autour du joueur, alignée sur les texels
  // pour que les ombres ne scintillent pas en vol.
  const sun = decor.sun, sunDir = decor.sunDir;
  const foyer = new THREE.Vector3();
  const DEMI = 420;
  {
    const c = sun.shadow.camera;
    c.left = -DEMI; c.right = DEMI; c.top = DEMI; c.bottom = -DEMI;
    c.far = 2200;
    c.updateProjectionMatrix();
  }
  const texel = (2 * DEMI) / sun.shadow.mapSize.x;

  // La course sur route, si le catalogue en décrit une : ses portes sont posées
  // sur le relief et rendues au moteur comme n'importe quelle course.
  const portes = await construireCourseRoute({
    world, root,
    solAt: (x, z) => decor.walkableAt(x, z),
    // L'itinéraire réel, calculé depuis OpenStreetMap par
    // `scripts/poilhes/route_pays.py`. Absent, la course retombe sur les points
    // du catalogue.
    url: `maps/pays-${world.pays || 'canal'}/route.json`,
  });

  return {
    root,
    portal: null,            // pas de réseau de portails : un pays est un lieu, pas une étape
    raceGates: portes,
    raceDressing: null,
    speedZones: [],
    assetsPromise: Promise.resolve(),
    collision: null,         // le relief suffit en vol ; les murs restent à brancher au sol
    getHeight,
    // Ce dont la voiture a besoin, et seulement elle : le sol praticable (les
    // tabliers de pont compris), les murs, et les villages avec leur décalage —
    // c'est de leurs rubans de chaussée qu'on tire la grille d'adhérence.
    solAt: (x, z) => decor.walkableAt(x, z),
    blockedAt: (x, z) => decor.blockedAt(x, z),
    villages: decor.villages,
    bounds: decor.bounds - 100,
    tick: (dt) => {
      decor.tick(dt);
      decor.sky.position.copy(camera.position);
      foyer.set(Math.round(camera.position.x / texel) * texel, 0,
                Math.round(camera.position.z / texel) * texel);
      foyer.y = decor.groundAt(foyer.x, foyer.z);
      sun.target.position.copy(foyer);
      sun.position.copy(foyer).addScaledVector(sunDir, 900);
    },
    dispose: () => { camera.far = porteeInitiale; camera.updateProjectionMatrix(); },
    decor,
  };
}
