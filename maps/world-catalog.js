import { KENNEY_ROAD_LIBRARY, KENNEY_ROAD_PLACEMENTS } from './kenney-road-assets.js';

export const PLAYER_MODES = [
  { id: 'chasseur', name: 'Chasseur', icon: '✈', type: 'flight', description: 'Vol rapide, exploration aérienne et rase-mottes.' },
  { id: 'robot', name: 'Robot Titan', icon: '◆', type: 'ground', description: 'Exploration terrestre lourde et franchissement.' }
];

export const ASSET_LIBRARY = {
  paris: { url: './assets/parisian_street_collection_04.glb', targetSize: 150, rotateX: -Math.PI / 2, rotateZ: -Math.PI / 2, label: 'Quartier parisien' },
  stadium: { url: './assets/lasvegas_allegiant.glb', targetSize: 210, label: 'Grand stade' },
  motocross: { url: './assets/Motocross/Motocross.glb', targetSize: 24, rotateX: -Math.PI / 2, label: 'Moto-cross' },
  ulvheimA1: { url: './assets/Ulvheim/ulvheim-A-1.glb', targetSize: 115, rotateX: -Math.PI / 2, label: 'Forteresse Ulvheim A1' },
  ulvheimA2: { url: './assets/Ulvheim/ulvheim-A-2.glb', targetSize: 115, rotateX: -Math.PI / 2, label: 'Forteresse Ulvheim A2' },
  ruin1: { url: './assets/Ulvheim/ulvheim-A-1-ruin1.glb', targetSize: 78, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 1' },
  ruin2: { url: './assets/Ulvheim/ulvheim-A-1-ruin2.glb', targetSize: 72, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 2' },
  ruin3: { url: './assets/Ulvheim/ulvheim-A-1-ruin3.glb', targetSize: 72, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 3' },
  ruin4: { url: './assets/Ulvheim/ulvheim-A-1-ruin4.glb', targetSize: 70, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 4' },
  ruin5: { url: './assets/Ulvheim/ulvheim-A-1-ruin5.glb', targetSize: 82, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 5' },
  ruin1A: { url: './assets/Ulvheim/ulvheim-A-2-ruin1A.glb', targetSize: 62, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 1A' },
  ruin1B: { url: './assets/Ulvheim/ulvheim-A-2-ruin1B.glb', targetSize: 58, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 1B' },
  ruin2A: { url: './assets/Ulvheim/ulvheim-A-2-ruin2A.glb', targetSize: 68, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 2A' },
  ruin2B: { url: './assets/Ulvheim/ulvheim-A-2-ruin2B.glb', targetSize: 62, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 2B' },
  ruin3A: { url: './assets/Ulvheim/ulvheim-A-2-ruin3A.glb', targetSize: 58, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 3A' },
  ruin3B: { url: './assets/Ulvheim/ulvheim-A-2-ruin3B.glb', targetSize: 52, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim 3B' },
  ruinA2Five: { url: './assets/Ulvheim/ulvheim-A-2-ruin5.glb', targetSize: 72, rotateX: -Math.PI / 2, label: 'Ruine Ulvheim A2-5' }
};

Object.assign(ASSET_LIBRARY, KENNEY_ROAD_LIBRARY);

const allModes = ['chasseur', 'robot'];

export const WORLD_MAPS = [
  {
    id: 'nova-city', name: 'Nova City', icon: '▦', category: 'Ville futuriste', seed: 1107, size: 1500,
    tagline: 'Une métropole verticale traversée par des boulevards aériens.',
    description: 'Tours lumineuses, périphérique circulaire, stade central et quartiers denses forment une ville pensée pour le vol entre les immeubles comme pour les poursuites au sol.',
    sky: 0x163b61, fog: 0x6b91ad, fogDensity: 0.00072, waterLevel: -18,
    terrain: { kind: 'plains', base: 2, amplitude: 12, scale: 0.004, low: 0x284c45, mid: 0x4d6a52, high: 0x7d806d },
    layout: 'grid', population: { trees: 70, rocks: 25, buildings: 145, towers: 22, crystals: 0 },
    landmarks: [{ type: 'spire', x: 0, z: -40, scale: 2.4 }, { type: 'dome', x: -270, z: 180, scale: 1.7 }, { type: 'helipad', x: 250, z: -230, scale: 1.4 }],
    assets: [{ key: 'stadium', x: 280, z: 250, rotation: 0.35 }, { key: 'paris', x: -310, z: -260, rotation: -0.6 }],
    spawn: { ground: [-40, 0, 330], air: [0, 120, 430] }, mission: 'Patrouille des districts',
    objectives: ['Passer sous la tour Nova', 'Rejoindre le stade', 'Boucler le périphérique'], modes: allModes
  },
  {
    id: 'emerald-forest', name: 'Forêt Émeraude', icon: '♣', category: 'Forêt profonde', seed: 2403, size: 1500,
    tagline: 'Une forêt immense, des clairières secrètes et une route oubliée.',
    description: 'La canopée dense cache un ancien observatoire, un lac central et des ruines. Les sentiers étroits favorisent le robot tandis que les trouées permettent le passage du chasseur.',
    sky: 0x6f9d92, fog: 0x8eaa83, fogDensity: 0.00125, waterLevel: -4,
    terrain: { kind: 'forest', base: 8, amplitude: 48, scale: 0.006, low: 0x193d25, mid: 0x2f6b37, high: 0x71844c },
    layout: 'trail', population: { trees: 620, rocks: 115, buildings: 4, towers: 2, crystals: 12 },
    landmarks: [{ type: 'dome', x: 220, z: -270, scale: 1.25 }, { type: 'arch', x: -310, z: 160, scale: 1.7 }, { type: 'lake-island', x: 40, z: 20, scale: 2.2 }],
    assets: [{ key: 'ruin3B', x: -300, z: 150, rotation: 0.7 }, { key: 'ruin1B', x: 245, z: -250, rotation: -0.2 }],
    spawn: { ground: [0, 0, 390], air: [0, 135, 450] }, mission: 'Le signal sous la canopée',
    objectives: ['Trouver la clairière', 'Atteindre l’observatoire', 'Localiser les cristaux'], modes: allModes
  },
  {
    id: 'white-peaks', name: 'Les Pics Blancs', icon: '▲', category: 'Haute montagne', seed: 3309, size: 1700,
    tagline: 'Crêtes enneigées, cols étroits et base perchée.',
    description: 'Un massif vertical avec trois sommets majeurs, une vallée glaciaire et des plateformes d’atterrissage. Le relief offre un terrain de slalom aérien spectaculaire.',
    sky: 0x7fb3d5, fog: 0xdbe9f1, fogDensity: 0.00065, waterLevel: -40,
    terrain: { kind: 'alpine', base: 5, amplitude: 255, scale: 0.0048, low: 0x415750, mid: 0x77786d, high: 0xf2f4f4, snowLine: 130 },
    layout: 'pass', population: { trees: 120, rocks: 240, buildings: 7, towers: 5, crystals: 8 },
    landmarks: [{ type: 'helipad', x: -280, z: -180, scale: 1.1 }, { type: 'spire', x: 330, z: 110, scale: 1.15 }, { type: 'bridge', x: 0, z: -240, scale: 2.1 }],
    assets: [{ key: 'ruin3A', x: -285, z: -170, rotation: 1.1 }],
    spawn: { ground: [0, 0, 420], air: [0, 210, 500] }, mission: 'Franchissement des trois cols',
    objectives: ['Passer le col nord', 'Se poser sur l’hélipad', 'Survoler le sommet blanc'], modes: allModes
  },
  {
    id: 'red-canyon', name: 'Canyon Rouge', icon: '≋', category: 'Canyon désertique', seed: 4512, size: 1700,
    tagline: 'Un labyrinthe minéral taillé pour le rase-mottes.',
    description: 'De hautes falaises rouges dessinent plusieurs corridors reliés par des arches naturelles. Une piste de contrebande traverse le fond du canyon.',
    sky: 0xb67858, fog: 0xc38d6b, fogDensity: 0.00062, waterLevel: -80,
    terrain: { kind: 'canyon', base: 5, amplitude: 175, scale: 0.0055, low: 0x6f2f20, mid: 0xa54f32, high: 0xd68b58 },
    layout: 'canyon', population: { trees: 12, rocks: 330, buildings: 9, towers: 3, crystals: 18 },
    landmarks: [{ type: 'arch', x: -250, z: -160, scale: 2.3 }, { type: 'arch', x: 290, z: 70, scale: 1.8 }, { type: 'pyramid', x: 100, z: -360, scale: 1.6 }],
    assets: [{ key: 'motocross', x: 60, z: 350, rotation: 0.4 }, { key: 'ruin2B', x: 120, z: -330, rotation: 0.15 }],
    spawn: { ground: [0, 0, 440], air: [0, 105, 520] }, mission: 'La route des contrebandiers',
    objectives: ['Traverser deux arches', 'Suivre la piste rouge', 'Découvrir le dépôt caché'], modes: allModes
  },
  {
    id: 'azure-archipelago', name: 'Archipel Azur', icon: '◉', category: 'Îles tropicales', seed: 5821, size: 1700,
    tagline: 'Douze îles, des lagons et des passages au ras de l’eau.',
    description: 'Un archipel lumineux organisé autour d’un lagon profond. Les ponts relient les îles principales tandis que les plus petites cachent des balises et des ruines.',
    sky: 0x4aa8d8, fog: 0x9ad7e8, fogDensity: 0.00048, waterLevel: 8,
    terrain: { kind: 'archipelago', base: -24, amplitude: 82, scale: 0.007, low: 0xe0c37d, mid: 0x4c8b3f, high: 0x8d9a69 },
    layout: 'islands', population: { trees: 230, rocks: 90, buildings: 12, towers: 8, crystals: 10 },
    landmarks: [{ type: 'lighthouse', x: -420, z: -180, scale: 1.5 }, { type: 'bridge', x: 0, z: 160, scale: 2.8 }, { type: 'dome', x: 360, z: 290, scale: 1.0 }],
    assets: [{ key: 'ruin1A', x: 350, z: 270, rotation: -0.4 }],
    spawn: { ground: [0, 0, 360], air: [0, 115, 480] }, mission: 'Les douze balises',
    objectives: ['Survoler le lagon', 'Atteindre le phare', 'Traverser le grand pont'], modes: allModes
  },
  {
    id: 'ulvheim-kingdom', name: 'Royaume d’Ulvheim', icon: '♜', category: 'Royaume en ruines', seed: 6104, size: 1600,
    tagline: 'Deux forteresses rivales séparées par un champ de ruines.',
    description: 'Les modèles Ulvheim forment ici un royaume complet : citadelles, villages détruits, pont fortifié et cercle cérémoniel au centre.',
    sky: 0x566477, fog: 0x87929b, fogDensity: 0.0009, waterLevel: -10,
    terrain: { kind: 'ruins', base: 8, amplitude: 52, scale: 0.006, low: 0x384339, mid: 0x59604b, high: 0x87816f },
    layout: 'kingdom', population: { trees: 170, rocks: 160, buildings: 18, towers: 10, crystals: 0 },
    landmarks: [{ type: 'arena', x: 0, z: 0, scale: 1.8 }, { type: 'bridge', x: 0, z: -250, scale: 2.1 }, { type: 'spire', x: 0, z: 310, scale: 1.3 }],
    assets: [{ key: 'ulvheimA1', x: -300, z: -160, rotation: 0.6 }, { key: 'ulvheimA2', x: 310, z: 140, rotation: -2.3 }, { key: 'ruin5', x: 0, z: 260, rotation: 0.1 }],
    spawn: { ground: [0, 0, 420], air: [0, 145, 500] }, mission: 'Réunifier les deux citadelles',
    objectives: ['Visiter les deux forteresses', 'Traverser le pont royal', 'Rejoindre l’arène centrale'], modes: allModes
  },
  {
    id: 'delta-airbase', name: 'Base Delta', icon: '⌁', category: 'Base aérienne', seed: 7208, size: 1600,
    tagline: 'Pistes croisées, hangars renforcés et zone d’essai.',
    description: 'Une immense base pensée pour le chasseur mais entièrement accessible au sol. Les pistes dessinent un triangle autour d’un bunker central.',
    sky: 0x7699b5, fog: 0xb9c7cf, fogDensity: 0.0005, waterLevel: -60,
    terrain: { kind: 'plains', base: 2, amplitude: 8, scale: 0.004, low: 0x485b40, mid: 0x647154, high: 0x828574 },
    layout: 'airbase', population: { trees: 45, rocks: 20, buildings: 42, towers: 14, crystals: 0 },
    landmarks: [{ type: 'hangar', x: -220, z: 20, scale: 2.0 }, { type: 'radar', x: 270, z: -210, scale: 1.8 }, { type: 'helipad', x: 270, z: 250, scale: 1.6 }],
    assets: [{ key: 'stadium', x: -430, z: -360, rotation: 0.8 }],
    spawn: { ground: [0, 0, 380], air: [0, 70, 500] }, mission: 'Essais de qualification Delta',
    objectives: ['Décoller de la piste 01', 'Passer la tour radar', 'Atterrir sur la piste croisée'], modes: allModes
  },
  {
    id: 'paris-2099', name: 'Paris 2099', icon: '◇', category: 'Ville historique', seed: 8301, size: 1400,
    tagline: 'Des rues anciennes sous une nouvelle ligne d’horizon.',
    description: 'Le quartier parisien existant devient le cœur d’une ville étendue, entourée de places, jardins géométriques et tours contemporaines.',
    sky: 0x665f80, fog: 0x9e94a9, fogDensity: 0.00085, waterLevel: -25,
    terrain: { kind: 'plains', base: 3, amplitude: 10, scale: 0.004, low: 0x45534a, mid: 0x65705e, high: 0x8b897d },
    layout: 'boulevards', population: { trees: 140, rocks: 15, buildings: 105, towers: 12, crystals: 0 },
    landmarks: [{ type: 'spire', x: 0, z: -250, scale: 1.9 }, { type: 'dome', x: 300, z: 220, scale: 1.2 }, { type: 'arch', x: -300, z: 250, scale: 1.5 }],
    assets: [{ key: 'paris', x: 0, z: 0, rotation: 0 }, { key: 'ruin1B', x: -330, z: 260, rotation: 0.6 }],
    spawn: { ground: [0, 0, 380], air: [0, 105, 470] }, mission: 'Le tour des monuments',
    objectives: ['Traverser le quartier ancien', 'Contourner la grande flèche', 'Rejoindre les jardins'], modes: allModes
  },
  {
    id: 'neon-vegas', name: 'Vegas Néon', icon: '✦', category: 'Ville nocturne', seed: 9417, size: 1500,
    tagline: 'Un stade monumental au milieu d’un désert de lumières.',
    description: 'Boulevards fluorescents, tours colorées et grand stade composent un terrain nocturne spectaculaire pour les vols bas et les courses terrestres.',
    sky: 0x080b24, fog: 0x302b59, fogDensity: 0.00078, waterLevel: -70,
    terrain: { kind: 'desert', base: 1, amplitude: 24, scale: 0.005, low: 0x5f4030, mid: 0x8d633c, high: 0xb88e5c },
    layout: 'strip', population: { trees: 18, rocks: 75, buildings: 130, towers: 28, crystals: 35 },
    landmarks: [{ type: 'spire', x: -280, z: -180, scale: 2.3 }, { type: 'arena', x: 270, z: 260, scale: 1.7 }, { type: 'pyramid', x: 340, z: -270, scale: 1.9 }],
    assets: [{ key: 'stadium', x: 0, z: 100, rotation: 0 }, { key: 'motocross', x: -300, z: 300, rotation: 1.2 }],
    spawn: { ground: [0, 0, 420], air: [0, 120, 510] }, mission: 'La boucle des lumières',
    objectives: ['Faire le tour du stade', 'Passer entre les tours néon', 'Atteindre la pyramide'], modes: allModes
  },
  {
    id: 'iron-basin', name: 'Bassin de Fer', icon: '⚙', category: 'Monde mécanique', seed: 10509, size: 1500,
    tagline: 'Une mine automatisée devenue terrain d’expérimentation.',
    description: 'Carrières, convoyeurs, cheminées et cristaux d’énergie structurent un bassin industriel idéal pour le robot et les attaques en piqué.',
    sky: 0x37444a, fog: 0x6d7775, fogDensity: 0.001, waterLevel: -30,
    terrain: { kind: 'basin', base: -4, amplitude: 72, scale: 0.006, low: 0x2c3433, mid: 0x505652, high: 0x837c68 },
    layout: 'industrial', population: { trees: 8, rocks: 230, buildings: 65, towers: 35, crystals: 70 },
    landmarks: [{ type: 'reactor', x: 0, z: 0, scale: 2.0 }, { type: 'bridge', x: -240, z: 180, scale: 1.8 }, { type: 'radar', x: 310, z: -250, scale: 1.5 }],
    assets: [{ key: 'ruin2A', x: -250, z: 190, rotation: 0.4 }, { key: 'motocross', x: 200, z: 300, rotation: -0.5 }],
    spawn: { ground: [0, 0, 400], air: [0, 125, 500] }, mission: 'Réactivation du réacteur',
    objectives: ['Inspecter les trois cheminées', 'Traverser le convoyeur', 'Atteindre le cœur énergétique'], modes: allModes
  },
  {
    id: 'fire-caldera', name: 'Caldeira de Feu', icon: '♨', category: 'Volcan', seed: 11613, size: 1600,
    tagline: 'Un anneau volcanique autour d’un lac de lave.',
    description: 'La caldeira forme un circuit naturel. Des plateformes scientifiques occupent les hauteurs et des coulées incandescentes coupent les routes au sol.',
    sky: 0x3a2025, fog: 0x8d4a37, fogDensity: 0.00105, waterLevel: -100,
    terrain: { kind: 'volcanic', base: 4, amplitude: 165, scale: 0.005, low: 0x271d1b, mid: 0x574039, high: 0x9a725b, lavaLevel: 18 },
    layout: 'ring', population: { trees: 0, rocks: 350, buildings: 12, towers: 9, crystals: 46 },
    landmarks: [{ type: 'crater', x: 0, z: 0, scale: 3.0 }, { type: 'helipad', x: -330, z: -210, scale: 1.2 }, { type: 'dome', x: 300, z: 230, scale: 1.4 }],
    assets: [{ key: 'ruin4', x: 300, z: 220, rotation: 2.1 }],
    spawn: { ground: [0, 0, 500], air: [0, 180, 560] }, mission: 'Surveillance de la caldeira',
    objectives: ['Boucler le cratère', 'Atteindre la station ouest', 'Survoler le lac de lave'], modes: allModes
  },
  {
    id: 'arctic-citadel', name: 'Citadelle Arctique', icon: '❄', category: 'Banquise', seed: 12721, size: 1600,
    tagline: 'Une forteresse isolée au milieu des glaces fracturées.',
    description: 'Plaques de glace, crevasses, pylônes et citadelle composent un monde lumineux où les longues lignes de vue alternent avec des passages étroits.',
    sky: 0xa5cde0, fog: 0xddeef4, fogDensity: 0.00082, waterLevel: -2,
    terrain: { kind: 'arctic', base: 8, amplitude: 58, scale: 0.007, low: 0x7ca4af, mid: 0xc4dce2, high: 0xf8fbfc },
    layout: 'ice', population: { trees: 0, rocks: 190, buildings: 18, towers: 12, crystals: 85 },
    landmarks: [{ type: 'spire', x: 0, z: -220, scale: 1.8 }, { type: 'bridge', x: -260, z: 120, scale: 1.9 }, { type: 'dome', x: 300, z: 270, scale: 1.3 }],
    assets: [{ key: 'ulvheimA2', x: 0, z: -260, rotation: Math.PI }, { key: 'ruin3A', x: 300, z: 250, rotation: -1.1 }],
    spawn: { ground: [0, 0, 420], air: [0, 135, 520] }, mission: 'Le relais polaire',
    objectives: ['Rejoindre la citadelle', 'Traverser la crevasse', 'Activer le relais sud'], modes: allModes
  },
  {
    id: 'sunken-coast', name: 'Côte Engloutie', icon: '≈', category: 'Littoral submergé', seed: 13805, size: 1600,
    tagline: 'Une ancienne ville dont seules les hauteurs émergent encore.',
    description: 'Routes noyées, toits transformés en îlots et ponts brisés créent une navigation hybride. Le chasseur suit la côte tandis que le robot emprunte les digues et explore les ruines.',
    sky: 0x6b9eae, fog: 0x86b3ba, fogDensity: 0.001, waterLevel: 22,
    terrain: { kind: 'coast', base: -14, amplitude: 68, scale: 0.006, low: 0xbcae79, mid: 0x55734a, high: 0x77796b },
    layout: 'flooded', population: { trees: 85, rocks: 100, buildings: 55, towers: 10, crystals: 6 },
    landmarks: [{ type: 'lighthouse', x: -360, z: -250, scale: 1.6 }, { type: 'bridge', x: 100, z: 50, scale: 2.7 }, { type: 'dome', x: 340, z: 250, scale: 1.0 }],
    assets: [{ key: 'paris', x: 50, z: -100, rotation: 0.2 }, { key: 'ruin2B', x: 340, z: 250, rotation: -0.8 }],
    spawn: { ground: [-100, 0, 390], air: [0, 125, 500] }, mission: 'Cartographier la zone noyée',
    objectives: ['Suivre la digue', 'Passer le pont brisé', 'Rejoindre le phare'], modes: allModes
  },
  {
    id: 'sahara-convoy', name: 'Convoi du Sahara', icon: '☀', category: 'Désert ouvert', seed: 14911, size: 1800,
    tagline: 'Dunes géantes, oasis et longue route de ravitaillement.',
    description: 'Une carte très large pour la vitesse : la route traverse un océan de dunes, passe par trois oasis et s’achève dans une cité minérale.',
    sky: 0xd19b63, fog: 0xe0bb86, fogDensity: 0.00048, waterLevel: -90,
    terrain: { kind: 'desert', base: 3, amplitude: 62, scale: 0.0048, low: 0xb2733d, mid: 0xd39a55, high: 0xe9c47e },
    layout: 'convoy', population: { trees: 24, rocks: 140, buildings: 24, towers: 6, crystals: 14 },
    landmarks: [{ type: 'oasis', x: -320, z: 100, scale: 1.5 }, { type: 'pyramid', x: 340, z: -280, scale: 2.1 }, { type: 'arch', x: 0, z: 340, scale: 1.7 }],
    assets: [{ key: 'motocross', x: 0, z: 360, rotation: 0 }, { key: 'ruin5', x: 330, z: -270, rotation: 0.5 }],
    spawn: { ground: [0, 0, 520], air: [0, 120, 600] }, mission: 'Escorter le convoi',
    objectives: ['Suivre la route des dunes', 'Contrôler les trois oasis', 'Atteindre la cité minérale'], modes: allModes
  },
  {
    id: 'sky-islands', name: 'Îles du Ciel', icon: '☁', category: 'Archipel aérien', seed: 15027, size: 1500,
    tagline: 'Des plateaux suspendus au-dessus d’une mer de nuages.',
    description: 'Des îles rocheuses semblent flotter autour d’une tour centrale. Les ponts énergétiques permettent au robot de circuler pendant que le chasseur slalome entre les masses.',
    sky: 0x6ca7d9, fog: 0xd4e8f4, fogDensity: 0.00055, waterLevel: -70,
    terrain: { kind: 'sky', base: 60, amplitude: 120, scale: 0.008, low: 0x546759, mid: 0x738b62, high: 0xd1d5bd },
    layout: 'sky', population: { trees: 110, rocks: 180, buildings: 16, towers: 12, crystals: 90 },
    landmarks: [{ type: 'spire', x: 0, z: 0, scale: 3.0 }, { type: 'bridge', x: -250, z: 50, scale: 2.5 }, { type: 'bridge', x: 260, z: -80, scale: 2.3 }],
    assets: [{ key: 'ruin1', x: -290, z: 80, rotation: 0.4 }, { key: 'ruin2A', x: 280, z: -100, rotation: -0.3 }],
    spawn: { ground: [0, 0, 350], air: [0, 220, 480] }, mission: 'La tour au-dessus des nuages',
    objectives: ['Traverser un pont céleste', 'Contourner la flèche centrale', 'Atteindre l’île extérieure'], modes: allModes
  },
  {
    id: 'crystal-marsh', name: 'Marais de Cristal', icon: '✧', category: 'Marais fantastique', seed: 16133, size: 1450,
    tagline: 'Des eaux sombres éclairées par des cristaux géants.',
    description: 'Un marais brumeux parsemé d’îlots, de passerelles et de formations luminescentes. Les repères visuels changent complètement entre le jour et les zones d’ombre.',
    sky: 0x243f4b, fog: 0x49656a, fogDensity: 0.00145, waterLevel: 10,
    terrain: { kind: 'marsh', base: 2, amplitude: 28, scale: 0.009, low: 0x263d32, mid: 0x3c5d43, high: 0x65785a },
    layout: 'marsh', population: { trees: 310, rocks: 75, buildings: 5, towers: 3, crystals: 160 },
    landmarks: [{ type: 'dome', x: 0, z: -260, scale: 1.2 }, { type: 'bridge', x: -220, z: 100, scale: 2.0 }, { type: 'arena', x: 280, z: 210, scale: 1.3 }],
    assets: [{ key: 'ruin3B', x: 0, z: -250, rotation: 0.8 }, { key: 'ruin1A', x: 280, z: 210, rotation: -0.4 }],
    spawn: { ground: [0, 0, 360], air: [0, 110, 460] }, mission: 'La lumière du marais',
    objectives: ['Suivre les cristaux bleus', 'Traverser les passerelles', 'Atteindre le sanctuaire'], modes: allModes
  },
  {
    id: 'lunar-outpost', name: 'Avant-poste Lunaire', icon: '☾', category: 'Lune', seed: 17239, size: 1600,
    tagline: 'Faible gravité, grands cratères et station isolée.',
    description: 'Une surface minérale très lisible, ponctuée de dômes, antennes et champs de cristaux. Les longues bosses permettent au robot d’effectuer de grands sauts.',
    sky: 0x050713, fog: 0x313442, fogDensity: 0.00038, waterLevel: -120,
    terrain: { kind: 'moon', base: 2, amplitude: 72, scale: 0.008, low: 0x30313a, mid: 0x5d5f69, high: 0x9a9ba2 },
    layout: 'outpost', population: { trees: 0, rocks: 300, buildings: 28, towers: 18, crystals: 95 },
    landmarks: [{ type: 'dome', x: 0, z: -220, scale: 2.1 }, { type: 'radar', x: 300, z: 240, scale: 1.8 }, { type: 'crater', x: -320, z: 170, scale: 2.4 }],
    assets: [{ key: 'ruinA2Five', x: 0, z: -220, rotation: 0.2 }],
    spawn: { ground: [0, 0, 420], air: [0, 145, 520] }, mission: 'Rétablir les communications',
    objectives: ['Contourner le grand cratère', 'Rejoindre le dôme central', 'Activer l’antenne est'], modes: allModes
  },
  {
    id: 'forgotten-kingdom', name: 'Le Royaume Oublié', icon: '♛', category: 'Vallée médiévale', seed: 18347, size: 1700,
    tagline: 'Une capitale en ruines au fond d’une vallée fortifiée.',
    description: 'Cette grande carte rassemble les ruines Ulvheim en une capitale cohérente : remparts, villages, temple, place royale et routes de montagne.',
    sky: 0x73829a, fog: 0xa5a99d, fogDensity: 0.00082, waterLevel: -8,
    terrain: { kind: 'valley', base: 6, amplitude: 110, scale: 0.0055, low: 0x334b32, mid: 0x64704d, high: 0x92917d },
    layout: 'capital', population: { trees: 280, rocks: 210, buildings: 34, towers: 16, crystals: 4 },
    landmarks: [{ type: 'arena', x: 0, z: 0, scale: 2.1 }, { type: 'bridge', x: 0, z: 280, scale: 2.2 }, { type: 'spire', x: 0, z: -330, scale: 1.7 }],
    assets: [{ key: 'ulvheimA1', x: 0, z: -300, rotation: Math.PI }, { key: 'ruin1', x: -300, z: 40, rotation: 0.8 }, { key: 'ruin2', x: 300, z: 80, rotation: -0.7 }, { key: 'ruin4', x: 0, z: 300, rotation: 0 }],
    spawn: { ground: [0, 0, 440], air: [0, 155, 540] }, mission: 'Retrouver la place royale',
    objectives: ['Entrer par la porte sud', 'Explorer les deux villages', 'Atteindre la citadelle'], modes: allModes
  },
  {
    id: 'storm-frontier', name: 'Frontière de l’Orage', icon: 'ϟ', category: 'Plateau tempétueux', seed: 19451, size: 1700,
    tagline: 'Éoliennes, falaises et éclairs au-dessus d’un plateau isolé.',
    description: 'Une carte rapide aux longues crêtes, marquée par des tours énergétiques et une station météo. Les changements d’altitude sont francs et lisibles.',
    sky: 0x27364e, fog: 0x59687a, fogDensity: 0.00105, waterLevel: -35,
    terrain: { kind: 'plateau', base: 12, amplitude: 125, scale: 0.005, low: 0x2e4939, mid: 0x56684c, high: 0x818076 },
    layout: 'spokes', population: { trees: 95, rocks: 260, buildings: 15, towers: 38, crystals: 24 },
    landmarks: [{ type: 'radar', x: 0, z: -260, scale: 2.2 }, { type: 'spire', x: -330, z: 220, scale: 1.5 }, { type: 'helipad', x: 330, z: 240, scale: 1.3 }],
    assets: [{ key: 'ruin2A', x: 0, z: -250, rotation: 0.4 }, { key: 'ruin1B', x: 330, z: 240, rotation: -0.2 }],
    spawn: { ground: [0, 0, 430], air: [0, 165, 530] }, mission: 'Traverser le front orageux',
    objectives: ['Passer les pylônes', 'Rejoindre la station météo', 'Atteindre l’hélipad est'], modes: allModes
  },
  {
    id: 'blockcraft-valley', name: 'Vallée des Blocs', icon: '▦', category: 'Aventure voxel', seed: 20573, size: 1500,
    tagline: 'Une grande map cubique entre rivière, village, mine et château.',
    description: 'Un monde entièrement construit en blocs : collines à étages, forêt cubique, rivière sinueuse, village coloré, cristaux à récolter et forteresse dominant la vallée.',
    sky: 0x78bbed, fog: 0xb7d9e8, fogDensity: 0.00052, waterLevel: 4,
    terrain: { kind: 'voxel', base: 16, amplitude: 76, scale: 0.0054, step: 6, blockSize: 20, low: 0x6d4b2c, mid: 0x4e963d, high: 0xd6d1b8 },
    layout: 'voxel-village', population: { trees: 260, rocks: 190, buildings: 34, towers: 0, crystals: 58 },
    landmarks: [
      { type: 'voxel-village', x: -250, z: 70, scale: 1.25 },
      { type: 'voxel-mine', x: 330, z: 220, scale: 1.35 },
      { type: 'voxel-castle', x: -290, z: -280, scale: 1.45 },
      { type: 'bridge', x: 170, z: 80, scale: 1.15 }
    ],
    assets: [],
    spawn: { ground: [0, 0, 470], air: [0, 155, 540] }, mission: 'Le cœur de la Vallée des Blocs',
    objectives: ['Traverser le village cubique', 'Explorer l’entrée de la mine', 'Rejoindre le château des hauteurs'], modes: allModes
  },
  {
    id: 'titan-race-canyon', name: 'Canyon des Titans', icon: '⛰', category: 'Course aérienne', seed: 21691, size: 1800,
    tagline: 'Des parois gigantesques transforment la montagne en circuit pour chasseurs.',
    description: 'Un grand circuit rapide alterne lignes droites, courbes ouvertes, chicane, S et épingle entre les falaises, avec chronomètre et meilleur temps.',
    sky: 0x4e7292, fog: 0x7c8991, fogDensity: 0.00072, waterLevel: -110,
    terrain: { kind: 'race-canyon', base: 25, amplitude: 230, scale: 0.0048, raceRadius: 600, low: 0x332f2c, mid: 0x655a4c, high: 0xb3a78d },
    layout: 'race-circuit', combat: false, population: { trees: 34, rocks: 360, buildings: 6, towers: 14, crystals: 28 },
    landmarks: [
      { type: 'radar', x: 0, z: 0, scale: 2.4 },
      { type: 'helipad', x: 0, z: 465, scale: 1.45 },
      { type: 'arch', x: 0, z: -350, scale: 1.5 }
    ],
    raceCourse: [
      { x: 0, z: 650, clearance: 72 },
      { x: 310, z: 650, clearance: 78 },
      { x: 585, z: 500, clearance: 70 },
      { x: 650, z: 210, clearance: 90 },
      { x: 470, z: 35, clearance: 68 },
      { x: 620, z: -135, clearance: 82 },
      { x: 520, z: -430, clearance: 66 },
      { x: 230, z: -650, clearance: 92 },
      { x: -130, z: -650, clearance: 74 },
      { x: -420, z: -520, clearance: 84 },
      { x: -610, z: -270, clearance: 70 },
      { x: -390, z: -105, clearance: 96 },
      { x: -610, z: 45, clearance: 76 },
      { x: -575, z: 345, clearance: 88 },
      { x: -360, z: 565, clearance: 70 },
      { x: -95, z: 470, clearance: 82 }
    ],
    assets: [],
    spawn: { ground: [0, 0, 430], air: [0, 120, 430] }, mission: 'Le Grand Prix des Titans',
    objectives: ['Franchir les 16 anneaux dans l’ordre (+50 points)', 'Éviter de rater un anneau (-20 points)', 'Obtenir le meilleur total à l’arrivée'], modes: allModes
  },
  {
    id: 'kenney-road-lab', name: 'Ville des Routes 3D', icon: '▦', category: 'Objets 3D Kenney', seed: 22817, size: 1400,
    tagline: 'Une map laboratoire construite uniquement avec les 72 objets du City Kit Roads.',
    description: 'Routes, croisements, virages, pont, lampadaires, panneaux et zone de chantier sont disposés dans une grande grille jouable afin de tester le kit depuis le sol ou avec le chasseur.',
    sky: 0x6f9fbd, fog: 0xb8cbd2, fogDensity: 0.00055, waterLevel: -80,
    terrain: { kind: 'plains', base: 0, amplitude: 0, scale: 0.004, low: 0x4f6a4c, mid: 0x4f6a4c, high: 0x4f6a4c },
    layout: 'object-lab', population: { trees: 0, rocks: 0, buildings: 0, towers: 0, crystals: 0 },
    landmarks: [], assets: KENNEY_ROAD_PLACEMENTS,
    spawn: { ground: [0, 0, 440], air: [0, 115, 520] }, mission: 'Inspection du nouveau kit routier',
    objectives: ['Parcourir les 72 objets 3D', 'Traverser le rond-point et le pont', 'Inspecter la zone de chantier'], modes: allModes
  }
];

// Les cartes sont authored dans leur repere historique puis etendues ici. Cela
// double largeur et longueur (surface x4) sans grossir les objets 3D.
const WORLD_LINEAR_SCALE = 2;
const WORLD_POPULATION_SCALE = 2.5;
const scaleXZ = item => {
  if (Number.isFinite(item?.x)) item.x *= WORLD_LINEAR_SCALE;
  if (Number.isFinite(item?.z)) item.z *= WORLD_LINEAR_SCALE;
};

WORLD_MAPS.forEach(world => {
  world.size *= WORLD_LINEAR_SCALE;
  if (Number.isFinite(world.terrain?.raceRadius)) world.terrain.raceRadius *= WORLD_LINEAR_SCALE;
  Object.keys(world.population || {}).forEach(key => {
    world.population[key] = Math.ceil(world.population[key] * WORLD_POPULATION_SCALE);
  });
  (world.landmarks || []).forEach(scaleXZ);
  (world.assets || []).forEach(scaleXZ);
  (world.raceCourse || []).forEach(scaleXZ);
  ['ground', 'air'].forEach(kind => {
    const spawn = world.spawn?.[kind];
    if (spawn) { spawn[0] *= WORLD_LINEAR_SCALE; spawn[2] *= WORLD_LINEAR_SCALE; }
  });
});

export function getWorld(id) {
  return WORLD_MAPS.find(world => world.id === id) || WORLD_MAPS[0];
}

export function getMode(id) {
  return PLAYER_MODES.find(mode => mode.id === id) || PLAYER_MODES[0];
}

export function getPortalRoute(id) {
  const index = Math.max(0, WORLD_MAPS.findIndex(world => world.id === id));
  const current = WORLD_MAPS[index];
  const destination = WORLD_MAPS[(index + 1) % WORLD_MAPS.length];
  // Le portail se trouve dans la moitié nord, à l'opposé des départs au sud.
  // Plusieurs emplacements sont évalués afin d'éviter les monuments et les
  // gros GLB propres à chaque map.
  const candidates = [];
  [-0.36, -0.29, -0.22].forEach(zFactor => {
    [-0.32, -0.16, 0, 0.16, 0.32].forEach(xFactor => {
      candidates.push({ x: Math.round(current.size * xFactor), z: Math.round(current.size * zFactor) });
    });
  });
  const blockers = [
    ...(current.assets || []).map(item => ({
      x: item.x, z: item.z,
      radius: (ASSET_LIBRARY[item.key]?.targetSize || 60) * (item.scale || 1) * .9 + 42
    })),
    ...(current.landmarks || []).map(item => ({ x: item.x, z: item.z, radius: 34 * (item.scale || 1) + 32 }))
  ];
  const score = candidate => blockers.length
    ? Math.min(...blockers.map(item => Math.hypot(candidate.x - item.x, candidate.z - item.z) - item.radius))
    : current.size;
  // La rotation du tableau évite que toutes les maps choisissent exactement
  // le même couloir quand plusieurs positions obtiennent un score équivalent.
  const rotated = candidates.slice(index % candidates.length).concat(candidates.slice(0, index % candidates.length));
  const chosen = rotated.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best, rotated[0]);
  return {
    destination,
    x: chosen.x,
    z: chosen.z
  };
}
