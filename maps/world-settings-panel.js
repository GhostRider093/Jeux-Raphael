// ══════════════════════════════════════════════════════════════════════════
//  PANNEAU DU MONDE
// --------------------------------------------------------------------------
//  Un monde du catalogue n'est qu'un bloc de nombres : ciel, brouillard,
//  relief, plan de circulation, populations. `buildWorld` le relit en ENTIER
//  a chaque construction. Editer un monde revient donc a editer ces nombres
//  puis a rebatir : il n'y a aucun etat cache a synchroniser, et c'est ce qui
//  rend ce panneau court.
//
//  Deux vitesses, et c'est tout son interet :
//
//    - un champ marque `live` se voit IMMEDIATEMENT, sans rien reconstruire.
//      La couleur du ciel et le brouillard vivent dans la scene, pas dans la
//      geometrie : on les tire au curseur, en continu.
//    - tout le reste change la geometrie. Rebatir un monde coute une seconde
//      ou deux — on ne le fait donc qu'au RELACHEMENT du curseur (evenement
//      `change`), jamais pendant le glissement (`input`).
//
//  Le panneau ne connait ni Three.js ni la scene : il modifie l'objet monde
//  et previent l'editeur. C'est l'editeur qui sait rebatir.
// ══════════════════════════════════════════════════════════════════════════

/** Les 19 reliefs que `world-builder` sait modeler. */
export const TERRAIN_KINDS = [
  { value: 'space', label: '☄ Espace — aucun sol' },
  { value: 'plains', label: 'Plaine' },
  { value: 'valley', label: 'Vallée' },
  { value: 'forest', label: 'Forêt' },
  { value: 'alpine', label: 'Haute montagne' },
  { value: 'plateau', label: 'Plateau' },
  { value: 'canyon', label: 'Canyon' },
  { value: 'race-canyon', label: 'Canyon de course' },
  { value: 'desert', label: 'Désert' },
  { value: 'basin', label: 'Bassin' },
  { value: 'coast', label: 'Littoral' },
  { value: 'archipelago', label: 'Archipel' },
  { value: 'marsh', label: 'Marais' },
  { value: 'arctic', label: 'Banquise' },
  { value: 'volcanic', label: 'Volcan' },
  { value: 'moon', label: 'Lune' },
  { value: 'sky', label: 'Îles du ciel' },
  { value: 'ruins', label: 'Ruines' },
  { value: 'voxel', label: 'Voxel (par blocs)' }
];

/**
 * Plans de circulation. Seuls les premiers tracent vraiment des routes ; les
 * autres sont des etiquettes d'ambiance que le constructeur laisse passer
 * sans rien dessiner. Ils restent listes : ce sont des valeurs legitimes du
 * catalogue, et un plan sans route est un choix courant.
 */
export const LAYOUTS = [
  { value: 'grid', label: 'Damier — routes' },
  { value: 'boulevards', label: 'Boulevards — routes' },
  { value: 'strip', label: 'Grande avenue — routes' },
  { value: 'airbase', label: 'Base aérienne — pistes' },
  { value: 'ring', label: 'Périphérique — anneau' },
  { value: 'race-circuit', label: 'Circuit de course' },
  { value: 'voxel-village', label: 'Village voxel' },
  { value: 'kingdom', label: 'Royaume — chemins' },
  { value: 'capital', label: 'Capitale — chemins' },
  { value: 'islands', label: 'Îles — pontons' },
  { value: 'flooded', label: 'Terres inondées — pontons' },
  { value: 'sky', label: 'Ciel — passerelles' },
  { value: 'marsh', label: 'Marais — pontons' },
  { value: 'object-lab', label: 'Laboratoire d’objets — sans route' },
  { value: 'canyon', label: 'Canyon — sans route' },
  { value: 'convoy', label: 'Convoi — sans route' },
  { value: 'ice', label: 'Glace — sans route' },
  { value: 'industrial', label: 'Industriel — sans route' },
  { value: 'outpost', label: 'Avant-poste — sans route' },
  { value: 'pass', label: 'Col — sans route' },
  { value: 'spokes', label: 'Rayons — sans route' },
  { value: 'trail', label: 'Piste — sans route' }
];

const inSpace = world => world.terrain?.kind === 'space';
const onGround = world => !inSpace(world);

// ── DESCRIPTION DES REGLAGES ────────────────────────────────────────────────
// `path` est un chemin pointe dans l'objet monde. `live` signale les champs
// qui n'exigent aucune reconstruction.
const GROUPS = [
  {
    name: 'Monde',
    fields: [
      { path: 'terrain.kind', label: 'Type de sol', type: 'select', options: TERRAIN_KINDS },
      { path: 'size', label: 'Taille', type: 'range', min: 800, max: 6000, step: 100 },
      { path: 'seed', label: 'Graine', type: 'seed' }
    ]
  },
  {
    name: 'Ambiance',
    fields: [
      { path: 'sky', label: 'Ciel', type: 'color', live: true },
      { path: 'fog', label: 'Brouillard', type: 'color', live: true },
      { path: 'fogDensity', label: 'Densité', type: 'range', min: 0, max: 0.003, step: 0.00005, digits: 5, live: true }
    ]
  },
  {
    name: 'Relief', when: onGround,
    fields: [
      { path: 'terrain.base', label: 'Altitude de base', type: 'range', min: -400, max: 400, step: 5 },
      { path: 'terrain.amplitude', label: 'Amplitude', type: 'range', min: 0, max: 900, step: 5 },
      { path: 'terrain.scale', label: 'Grain du bruit', type: 'range', min: 0.0005, max: 0.02, step: 0.0005, digits: 4 },
      { path: 'waterLevel', label: 'Niveau de l’eau', type: 'range', min: -1000, max: 300, step: 5 }
    ]
  },
  {
    name: 'Couleurs du sol', when: onGround,
    fields: [
      { path: 'terrain.low', label: 'Bas', type: 'color' },
      { path: 'terrain.mid', label: 'Milieu', type: 'color' },
      { path: 'terrain.high', label: 'Haut', type: 'color' }
    ]
  },
  {
    name: 'Plan de circulation', when: onGround,
    fields: [{ path: 'layout', label: 'Plan', type: 'select', options: LAYOUTS }]
  },
  {
    name: 'Populations', when: onGround,
    fields: [
      { path: 'population.trees', label: 'Arbres', type: 'range', min: 0, max: 3000, step: 10 },
      { path: 'population.rocks', label: 'Rochers', type: 'range', min: 0, max: 3000, step: 10 },
      { path: 'population.buildings', label: 'Immeubles', type: 'range', min: 0, max: 1500, step: 5 },
      { path: 'population.towers', label: 'Pylônes', type: 'range', min: 0, max: 400, step: 1 },
      { path: 'population.crystals', label: 'Cristaux', type: 'range', min: 0, max: 400, step: 1 }
    ]
  },
  {
    name: 'Vide sidéral', when: inSpace,
    fields: [
      { path: 'ambientColor', label: 'Lueur ambiante', type: 'color' },
      { path: 'ambientIntensity', label: 'Intensité', type: 'range', min: 0, max: 3, step: 0.05, digits: 2 }
    ]
  }
];

// ── ACCES AUX VALEURS ───────────────────────────────────────────────────────

function read(world, path) {
  return path.split('.').reduce((node, key) => node?.[key], world);
}

function write(world, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const node = keys.reduce((current, key) => (current[key] ??= {}), world);
  node[last] = value;
}

const toHex = value => `#${((value ?? 0) >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
const fromHex = text => parseInt(text.slice(1), 16);

/** Les defauts couvrent les mondes qui omettent un champ — c'est frequent. */
const DEFAULTS = {
  waterLevel: -1000,   // le fond du curseur vaut « aucune eau »
  ambientColor: 0x2b3a5c,
  ambientIntensity: 0.5,
  fogDensity: 0.0006
};

function valueOf(world, field) {
  const found = read(world, field.path);
  if (found !== undefined && found !== null) return found;
  return DEFAULTS[field.path] ?? (field.type === 'color' ? 0x000000 : field.min ?? 0);
}

// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {object} options
 *   `host` l'element qui recoit le panneau · `world` l'objet monde, modifie en
 *   place · `onLive()` apres un reglage sans reconstruction · `onRebuild()`
 *   quand la geometrie doit etre refaite (peut renvoyer une promesse).
 */
export function createWorldSettingsPanel({ host, world, onLive, onRebuild }) {
  const rows = [];
  const blocks = [];
  let busy = false;

  host.textContent = '';

  GROUPS.forEach(group => {
    const block = document.createElement('div');
    block.className = 'ws-group';
    const title = document.createElement('div');
    title.className = 'ws-group-name';
    title.textContent = group.name;
    block.appendChild(title);
    group.fields.forEach(field => block.appendChild(buildRow(field)));
    host.appendChild(block);
    blocks.push({ block, when: group.when });
  });

  function buildRow(field) {
    const row = document.createElement('label');
    row.className = `ws-row ws-${field.type}`;
    const name = document.createElement('span');
    name.className = 'ws-label';
    name.textContent = field.label;
    row.appendChild(name);

    let input;
    let extra = null;

    if (field.type === 'select') {
      input = document.createElement('select');
      field.options.forEach(option => {
        const item = document.createElement('option');
        item.value = option.value;
        item.textContent = option.label;
        input.appendChild(item);
      });
    } else if (field.type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
    } else if (field.type === 'seed') {
      input = document.createElement('input');
      input.type = 'number';
      input.step = '1';
      extra = document.createElement('button');
      extra.type = 'button';
      extra.className = 'ws-dice';
      extra.textContent = '🎲';
      extra.title = 'Tirer une graine au hasard';
      extra.addEventListener('click', () => {
        input.value = String(Math.floor(Math.random() * 90000) + 1000);
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    } else {
      input = document.createElement('input');
      input.type = 'range';
      input.min = String(field.min);
      input.max = String(field.max);
      input.step = String(field.step);
      extra = document.createElement('output');
      extra.className = 'ws-out';
    }

    row.appendChild(input);
    if (extra) row.appendChild(extra);

    const show = () => {
      if (field.type !== 'range') return;
      const value = Number(input.value);
      extra.textContent = field.digits ? value.toFixed(field.digits) : String(Math.round(value));
    };

    const commit = rebuild => {
      let value;
      if (field.type === 'color') value = fromHex(input.value);
      else if (field.type === 'select') value = input.value;
      else value = Number(input.value);
      write(world, field.path, value);
      if (rebuild) apply();
      else onLive?.();
    };

    // `input` suit le curseur, `change` tombe au relachement. Un champ `live`
    // se contente du premier ; les autres attendent le second, sinon chaque
    // pixel de glissement declencherait une reconstruction complete.
    input.addEventListener('input', () => {
      show();
      if (field.live) commit(false);
    });
    input.addEventListener('change', () => {
      show();
      commit(!field.live);
    });

    rows.push({ field, input, show });
    return row;
  }

  /** Recopie l'etat du monde dans les commandes. */
  function refresh() {
    rows.forEach(({ field, input, show }) => {
      const value = valueOf(world, field);
      input.value = field.type === 'color' ? toHex(value) : String(value);
      show();
    });
    blocks.forEach(({ block, when }) => { block.hidden = when ? !when(world) : false; });
  }

  async function apply() {
    if (busy) return;
    busy = true;
    setEnabled(false);
    try { await onRebuild?.(); }
    finally {
      busy = false;
      setEnabled(true);
      refresh();
    }
  }

  function setEnabled(state) {
    host.classList.toggle('ws-busy', !state);
    rows.forEach(({ input }) => { input.disabled = !state; });
  }

  refresh();

  return { refresh, get busy() { return busy; } };
}
