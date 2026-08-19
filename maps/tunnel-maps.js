// ══════════════════════════════════════════════════════════════════════════
//  CARTES DE TUNNELS
// --------------------------------------------------------------------------
//  Une carte tient en quelques nombres : le trace du tunnel, et de quoi poser
//  le decor autour. La geometrie n'est jamais enregistree, elle est
//  reconstruite au chargement — comme le reste des mondes du jeu.
// ══════════════════════════════════════════════════════════════════════════

export const TUNNEL_MAPS = {
  // Trace pose par Arnaud dans l'editeur, le 19 aout 2026, repris tel quel.
  'essai-raphael': {
    label: 'Tracé d\'essai',
    tunnel: {
      profile: 'square',
      radius: 72,
      wall: 20,
      points: [
        [1466.3, 1323.5, 1345.5],
        [-479.6, 70, 2038.1],
        [220, 506.3, -60],
        [520, 40, 60],
        [-465.5, 0, -284],
        [145.3, 0, -412.5],
        [134.1, 0, -650.3],
        [360.9, 0, -270.6],
        [578.8, 0, -593.2],
        [-275.2, 0, -1240.5],
        [-1226.7, 0, -848.8],
        [-1526, 0, 350.5],
        [-1103.9, 0, 1187.8],
        [362, 0, 856.1],
        [962.7, 0, 202.7],
        [834.5, 193.5, -238.4],
        [3745.5, 0, -972.4],
        [4827.5, 0, 484.6],
        [1862.8, 0, 414.1]
      ]
    },
    // Le decor n'est la que pour donner l'echelle et de quoi se reperer : sans
    // rien autour, on ne sait pas a quelle vitesse on va ni ou l'on est.
    montagnes: [
      { x: -2100, z: -1600, rayon: 900, hauteur: 1150, graine: 11 },
      { x: 2600, z: 1800, rayon: 1150, hauteur: 1500, graine: 27 },
      { x: 3900, z: -2200, rayon: 780, hauteur: 900, graine: 43 }
    ],
    maisons: [
      { x: 640, z: 520, rotation: .6, echelle: 1 },
      { x: 520, z: 690, rotation: -1.2, echelle: .8 }
    ]
  }
};

// ── CARTES ENREGISTREES ─────────────────────────────────────────────────────
// Les cartes tracees dans l'editeur vivent dans le navigateur. Le stockage est
// local et sans serveur : c'est un carnet de croquis, pas une publication. Une
// carte qui merite d'etre gardee sera reversee dans le catalogue ci-dessus.

const CLE = 'nova-tunnel-maps-v1';

function lireStockage() {
  try {
    return JSON.parse(localStorage.getItem(CLE)) || {};
  } catch {
    // Un stockage illisible ne doit pas empecher de jouer : on repart a vide.
    return {};
  }
}

/** Toutes les cartes connues : catalogue du jeu et croquis locaux. */
export function listerCartes() {
  const locales = lireStockage();
  return { ...TUNNEL_MAPS, ...locales };
}

export function enregistrerCarte(id, carte) {
  const cartes = lireStockage();
  cartes[id] = { ...carte, enregistree: new Date().toISOString() };
  try {
    localStorage.setItem(CLE, JSON.stringify(cartes));
    return true;
  } catch (erreur) {
    console.error('[tunnel-maps] enregistrement impossible', erreur);
    return false;
  }
}

export function supprimerCarte(id) {
  const cartes = lireStockage();
  delete cartes[id];
  localStorage.setItem(CLE, JSON.stringify(cartes));
}

export function getTunnelMap(id) {
  const cartes = listerCartes();
  return cartes[id] || cartes['essai-raphael'];
}

/** Identifiant de fichier a partir d'un nom saisi a la main. */
export function slug(nom) {
  return (nom || 'carte').toLowerCase()
    // Les accents sont detaches par NFD puis retires. La plage est ecrite en
    // echappements : ces caracteres sont invisibles dans un editeur, et une
    // classe litterale se casse a la premiere relecture distraite.
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'carte';
}
