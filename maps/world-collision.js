/**
 * Champ de collision statique d'un monde.
 *
 * Les obstacles sont stockes sous forme de boites alignees sur les axes (AABB)
 * reparties dans une grille spatiale plate. Chaque boite est gonflee du rayon
 * du pilote au moment de l'insertion : une requete n'a donc qu'une seule
 * cellule a inspecter, celle qui contient le centre du pilote.
 *
 * Contrainte du projet : aucune allocation dans les boucles d'animation.
 * `queryHit` ne cree ni tableau, ni vecteur, ni chaine de caracteres — elle
 * remplit et renvoie l'objet `field.hit` reutilise a chaque appel.
 */

const CELL_SIZE = 128;
// Decalages qui gardent les index de cellule positifs. Les cartes font au plus
// quelques milliers d'unites, la cle reste donc tres loin de MAX_SAFE_INTEGER.
const GRID_ORIGIN = 1024;
const GRID_STRIDE = 4096;

function cellKey(cellX, cellZ) {
  return (cellX + GRID_ORIGIN) * GRID_STRIDE + (cellZ + GRID_ORIGIN);
}

/**
 * @param {number} playerRadius rayon de la sphere de collision du pilote.
 */
export function createCollisionField(playerRadius = 7) {
  return {
    playerRadius,
    cells: new Map(),
    boxes: [],
    hit: {
      active: false,
      boxIndex: -1,
      depth: 0,
      pushX: 0, pushY: 0, pushZ: 0,
      contactX: 0, contactY: 0, contactZ: 0,
      // Toit de l'obstacle : porte de sortie lorsqu'un appareil se retrouve
      // encastre au coeur d'un volume epais.
      boxMaxY: 0
    }
  };
}

/** Enregistre une boite decrite par ses extremes en coordonnees monde. */
export function addBox(field, minX, minY, minZ, maxX, maxY, maxZ) {
  if (!field) return;
  if (!(maxX > minX) || !(maxY > minY) || !(maxZ > minZ)) return;
  if (!Number.isFinite(minX) || !Number.isFinite(maxY) || !Number.isFinite(maxZ)) return;

  const index = field.boxes.length;
  field.boxes.push({ minX, minY, minZ, maxX, maxY, maxZ });

  // La marge permet a une requete de n'interroger qu'une seule cellule : toute
  // boite susceptible de toucher le pilote dans cette cellule y est presente.
  const margin = field.playerRadius;
  const cellX0 = Math.floor((minX - margin) / CELL_SIZE);
  const cellX1 = Math.floor((maxX + margin) / CELL_SIZE);
  const cellZ0 = Math.floor((minZ - margin) / CELL_SIZE);
  const cellZ1 = Math.floor((maxZ + margin) / CELL_SIZE);
  for (let cellX = cellX0; cellX <= cellX1; cellX++) {
    for (let cellZ = cellZ0; cellZ <= cellZ1; cellZ++) {
      const key = cellKey(cellX, cellZ);
      let bucket = field.cells.get(key);
      if (!bucket) { bucket = []; field.cells.set(key, bucket); }
      bucket.push(index);
    }
  }
}

/** Variante centre + demi-dimensions, pratique pour les objets instancies. */
export function addBoxFromCenter(field, x, y, z, halfWidth, halfHeight, halfDepth) {
  addBox(field, x - halfWidth, y - halfHeight, z - halfDepth, x + halfWidth, y + halfHeight, z + halfDepth);
}

/**
 * Enregistre l'emprise monde d'un objet 3D deja positionne dans la scene.
 * Le `Box3` est fourni par l'appelant pour garder ce module independant de Three.js.
 */
export function addBox3(field, box3) {
  if (!box3 || box3.isEmpty?.()) return;
  addBox(field, box3.min.x, box3.min.y, box3.min.z, box3.max.x, box3.max.y, box3.max.z);
}

/**
 * Teste la sphere du pilote contre les obstacles de la cellule courante.
 * Renvoie l'objet `field.hit` : `active` indique s'il y a contact, `push*`
 * donne la translation minimale qui degage le pilote, `contact*` le point
 * d'impact sur la paroi (utile pour placer les effets visuels).
 */
export function queryHit(field, x, y, z) {
  const hit = field.hit;
  hit.active = false;
  hit.boxIndex = -1;
  hit.depth = 0;
  if (!field || field.boxes.length === 0) return hit;

  const bucket = field.cells.get(cellKey(Math.floor(x / CELL_SIZE), Math.floor(z / CELL_SIZE)));
  if (!bucket) return hit;

  const radius = field.playerRadius;
  let deepest = 0;

  for (let i = 0; i < bucket.length; i++) {
    const box = field.boxes[bucket[i]];

    // Distance a parcourir sur chaque axe pour sortir de la boite gonflee.
    // Une valeur negative ou nulle signifie qu'il n'y a pas de chevauchement.
    const exitNegX = x - (box.minX - radius);
    if (exitNegX <= 0) continue;
    const exitPosX = (box.maxX + radius) - x;
    if (exitPosX <= 0) continue;
    const exitNegY = y - (box.minY - radius);
    if (exitNegY <= 0) continue;
    const exitPosY = (box.maxY + radius) - y;
    if (exitPosY <= 0) continue;
    const exitNegZ = z - (box.minZ - radius);
    if (exitNegZ <= 0) continue;
    const exitPosZ = (box.maxZ + radius) - z;
    if (exitPosZ <= 0) continue;

    // Axe de degagement le moins couteux. Le passage sous la boite (-Y) est
    // volontairement exclu : les batiments reposent sur le sol, pousser le
    // pilote vers le bas l'enfoncerait dans le relief.
    let depth = exitNegX, axis = 0, sign = -1;
    if (exitPosX < depth) { depth = exitPosX; axis = 0; sign = 1; }
    if (exitPosY < depth) { depth = exitPosY; axis = 1; sign = 1; }
    if (exitNegZ < depth) { depth = exitNegZ; axis = 2; sign = -1; }
    if (exitPosZ < depth) { depth = exitPosZ; axis = 2; sign = 1; }

    if (depth <= deepest) continue;
    deepest = depth;
    hit.active = true;
    hit.boxIndex = bucket[i];
    hit.depth = depth;
    hit.pushX = axis === 0 ? depth * sign : 0;
    hit.pushY = axis === 1 ? depth * sign : 0;
    hit.pushZ = axis === 2 ? depth * sign : 0;
    hit.boxMaxY = box.maxY;
    // Point le plus proche sur la paroi reelle (sans le gonflement).
    hit.contactX = x < box.minX ? box.minX : x > box.maxX ? box.maxX : x;
    hit.contactY = y < box.minY ? box.minY : y > box.maxY ? box.maxY : y;
    hit.contactZ = z < box.minZ ? box.minZ : z > box.maxZ ? box.maxZ : z;
  }

  return hit;
}

const COLUMN_ORIGIN = 4096;
const COLUMN_STRIDE = 16384;

/**
 * Rasterise une geometrie en colonnes verticales et enregistre les volumes
 * batis qui en ressortent.
 *
 * Indispensable pour les modeles de quartier : un fichier comme `chicago.stl`
 * contient une ville entiere dans un maillage unique. Une boite englobante en
 * ferait un bloc plein de plusieurs centaines de metres. En projetant les
 * triangles sur une grille horizontale, chaque colonne batie devient un
 * obstacle et les rues restent traversables.
 *
 * @param {function} iterateTriangles recoit un rappel
 *   `(ax, ay, az, bx, by, bz, cx, cy, cz)` par triangle, en coordonnees monde.
 * @returns {number} nombre de colonnes retenues.
 */
export function addHeightfield(field, iterateTriangles, options = {}) {
  if (!field) return 0;
  const cellSize = options.cellSize || 14;
  const minHeight = options.minHeight ?? 6;
  const maxColumns = options.maxColumns || 6000;
  // Un triangle couvrant un immense rectangle est une dalle de sol ou un plan
  // de fond : le retenir remplirait la carte de faux obstacles.
  const maxTriangleCells = options.maxTriangleCells || 640;

  const columns = new Map();
  let saturated = false;

  // Le parcours se fait en deux passes. La premiere etablit le plancher et le
  // plafond de chaque colonne. La seconde n'y inscrit l'emprise horizontale
  // que des triangles qui montent vraiment : sans cette separation, une dalle
  // de sol traversant la meme cellule qu'un immeuble ramenerait l'obstacle a
  // la cellule entiere — c'est-a-dire des murs invisibles autour du batiment.
  const forEachCell = (ax, ay, az, bx, by, bz, cx, cy, cz, visit) => {
    const triMinX = Math.min(ax, bx, cx), triMaxX = Math.max(ax, bx, cx);
    const triMinZ = Math.min(az, bz, cz), triMaxZ = Math.max(az, bz, cz);
    const cellX0 = Math.floor(triMinX / cellSize), cellX1 = Math.floor(triMaxX / cellSize);
    const cellZ0 = Math.floor(triMinZ / cellSize), cellZ1 = Math.floor(triMaxZ / cellSize);
    if ((cellX1 - cellX0 + 1) * (cellZ1 - cellZ0 + 1) > maxTriangleCells) return;
    for (let cellX = cellX0; cellX <= cellX1; cellX++) {
      const clipMinX = Math.max(triMinX, cellX * cellSize);
      const clipMaxX = Math.min(triMaxX, (cellX + 1) * cellSize);
      for (let cellZ = cellZ0; cellZ <= cellZ1; cellZ++) {
        visit(
          (cellX + COLUMN_ORIGIN) * COLUMN_STRIDE + (cellZ + COLUMN_ORIGIN),
          clipMinX, clipMaxX,
          Math.max(triMinZ, cellZ * cellSize), Math.min(triMaxZ, (cellZ + 1) * cellSize)
        );
      }
    }
  };

  iterateTriangles((ax, ay, az, bx, by, bz, cx, cy, cz) => {
    if (saturated) return;
    const minY = Math.min(ay, by, cy);
    const maxY = Math.max(ay, by, cy);
    forEachCell(ax, ay, az, bx, by, bz, cx, cy, cz, key => {
      const column = columns.get(key);
      if (column) {
        if (minY < column.minY) column.minY = minY;
        if (maxY > column.maxY) column.maxY = maxY;
      } else if (columns.size >= maxColumns) saturated = true;
      else columns.set(key, { minY, maxY, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    });
  });

  iterateTriangles((ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const maxY = Math.max(ay, by, cy);
    forEachCell(ax, ay, az, bx, by, bz, cx, cy, cz, (key, clipMinX, clipMaxX, clipMinZ, clipMaxZ) => {
      const column = columns.get(key);
      // Un triangle qui ne depasse pas le plancher de la colonne est du sol :
      // il ne doit pas elargir l'obstacle.
      if (!column || maxY - column.minY < minHeight) return;
      if (clipMinX < column.minX) column.minX = clipMinX;
      if (clipMaxX > column.maxX) column.maxX = clipMaxX;
      if (clipMinZ < column.minZ) column.minZ = clipMinZ;
      if (clipMaxZ > column.maxZ) column.maxZ = clipMaxZ;
    });
  });

  let registered = 0;
  columns.forEach(column => {
    // Une colonne plate est du sol, une route ou un socle : on l'ignore.
    if (column.maxY - column.minY < minHeight) return;
    if (column.minX > column.maxX) return;   // aucun triangle montant retenu
    // Un mur sans toit produit une colonne d'epaisseur nulle : on lui donne
    // une paroi minimale, sinon la boite serait rejetee.
    let { minX, maxX, minZ, maxZ } = column;
    if (maxX - minX < .5) { const middle = (minX + maxX) * .5; minX = middle - .25; maxX = middle + .25; }
    if (maxZ - minZ < .5) { const middle = (minZ + maxZ) * .5; minZ = middle - .25; maxZ = middle + .25; }
    addBox(field, minX, column.minY, minZ, maxX, column.maxY, maxZ);
    registered++;
  });
  return registered;
}

/** Nombre d'obstacles enregistres — utile pour les diagnostics. */
export function collisionStats(field) {
  return {
    boxes: field?.boxes.length || 0,
    cells: field?.cells.size || 0,
    playerRadius: field?.playerRadius || 0
  };
}
