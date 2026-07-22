// Kit "City Kit Roads 2.0" par Kenney, licence CC0.
export const KENNEY_ROAD_FILES = [
  'bridge-pillar.glb', 'bridge-pillar-wide.glb',
  'construction-barrier.glb', 'construction-cone.glb', 'construction-light.glb',
  'light-curved.glb', 'light-curved-cross.glb', 'light-curved-double.glb',
  'light-square.glb', 'light-square-cross.glb', 'light-square-double.glb',
  'road-bend.glb', 'road-bend-barrier.glb', 'road-bend-sidewalk.glb',
  'road-bend-square.glb', 'road-bend-square-barrier.glb', 'road-bridge.glb',
  'road-crossing.glb', 'road-crossroad.glb', 'road-crossroad-barrier.glb',
  'road-crossroad-line.glb', 'road-crossroad-path.glb', 'road-curve.glb',
  'road-curve-barrier.glb', 'road-curve-intersection.glb',
  'road-curve-intersection-barrier.glb', 'road-curve-pavement.glb',
  'road-driveway-double.glb', 'road-driveway-double-barrier.glb',
  'road-driveway-single.glb', 'road-driveway-single-barrier.glb',
  'road-end.glb', 'road-end-barrier.glb', 'road-end-round.glb',
  'road-end-round-barrier.glb', 'road-intersection.glb',
  'road-intersection-barrier.glb', 'road-intersection-line.glb',
  'road-intersection-path.glb', 'road-roundabout.glb', 'road-roundabout-barrier.glb',
  'road-side.glb', 'road-side-barrier.glb', 'road-side-entry.glb',
  'road-side-entry-barrier.glb', 'road-side-exit.glb', 'road-side-exit-barrier.glb',
  'road-slant.glb', 'road-slant-barrier.glb', 'road-slant-curve.glb',
  'road-slant-curve-barrier.glb', 'road-slant-flat.glb', 'road-slant-flat-curve.glb',
  'road-slant-flat-high.glb', 'road-slant-high.glb', 'road-slant-high-barrier.glb',
  'road-split.glb', 'road-split-barrier.glb', 'road-square.glb',
  'road-square-barrier.glb', 'road-straight.glb', 'road-straight-barrier.glb',
  'road-straight-barrier-end.glb', 'road-straight-barrier-half.glb',
  'road-straight-half.glb', 'sign-highway.glb', 'sign-highway-detailed.glb',
  'sign-highway-wide.glb', 'tile-high.glb', 'tile-low.glb', 'tile-slant.glb',
  'tile-slantHigh.glb'
];

const keyFor = file => `kenneyRoad_${file.replace(/\.glb$/i, '').replace(/[^a-z0-9]+/gi, '_')}`;

export const KENNEY_ROAD_LIBRARY = Object.fromEntries(KENNEY_ROAD_FILES.map(file => {
  const isFurniture = /^(bridge-pillar|construction-|light-|sign-)/.test(file);
  return [keyFor(file), {
    url: `./assets/kenney-city-roads/${file}`,
    targetSize: isFurniture ? 20 : 40,
    label: `Kenney ${file.replace(/\.glb$/i, '').replaceAll('-', ' ')}`
  }];
}));

const KENNEY_AXIS_CORRECTION = Math.PI / 2;
const place = (file, x, z, rotation = 0, scale = 1) => ({
  key: keyFor(file), x, z, rotation: rotation + KENNEY_AXIS_CORRECTION, scale
});

// Un vrai quadrillage routier dense : trois avenues nord/sud croisent trois
// avenues est/ouest. Les morceaux sont jointifs et visibles dès le départ.
const connectedRoads = [];
const tile = 40;
const limits = 10;
const axes = [-200, 0, 200];
for (let step = -limits; step <= limits; step++) {
  const position = step * tile;
  for (const z of axes) {
    const crossing = axes.includes(position);
    connectedRoads.push(place(crossing ? 'road-crossroad.glb' : 'road-straight.glb', position, z, Math.PI / 2));
  }
  for (const x of axes) {
    if (axes.includes(position)) continue;
    connectedRoads.push(place('road-straight.glb', x, position));
  }
}

// Rond-point central, pont au nord et petites zones de chantier.
connectedRoads.push(
  place('road-roundabout.glb', 0, 0, 0, 1.35),
  place('road-bridge.glb', 200, -320),
  place('bridge-pillar-wide.glb', 200, -320),
  place('road-bend.glb', -400, -200), place('road-bend.glb', 400, -200, Math.PI / 2),
  place('road-bend.glb', 400, 200, Math.PI), place('road-bend.glb', -400, 200, -Math.PI / 2),
  place('construction-barrier.glb', -80, 80), place('construction-barrier.glb', -40, 80),
  place('construction-cone.glb', -80, 55), place('construction-cone.glb', -40, 55),
  place('construction-light.glb', -60, 105)
);

// Les autres variantes restent exposées autour du réseau pour que chaque
// objet fourni puisse être inspecté dans la même map.
const showcase = KENNEY_ROAD_FILES
  .filter(file => !['road-straight.glb', 'road-crossroad.glb'].includes(file))
  .map((file, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const lane = Math.floor(index / 2);
    return place(file, side * (285 + (lane % 3) * 52), -360 + Math.floor(lane / 3) * 58, (index % 4) * Math.PI / 2, .9);
  });

export const KENNEY_ROAD_PLACEMENTS = [...connectedRoads, ...showcase];
