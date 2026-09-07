// ══════════════════════════════════════════════════════════════════════════
//  CARTES DE TUNNELS
// --------------------------------------------------------------------------
//  Une carte tient en quelques nombres : le trace du tunnel, et de quoi poser
//  le decor autour. La geometrie n'est jamais enregistree, elle est
//  reconstruite au chargement — comme le reste des mondes du jeu.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Trace de l'anneau orbital : un circuit ferme, calcule et non saisi.
 *
 * Dix-huit points suffisent — la courbe fait le reste. Deux ondulations
 * superposees :
 *
 *   - le RAYON respire (3 lobes) : un cercle parfait se pilote manche au
 *     neutre et n'est plus un circuit, juste un couloir qui tourne.
 *   - la HAUTEUR monte et descend (2 grandes bosses, 5 petites) : c'est ce qui
 *     donne les changements de plan, et dans l'espace c'est la seule chose qui
 *     dise au pilote qu'il n'est pas immobile.
 *
 * LES QUATRE NOMBRES NE SONT PAS CHOISIS A L'OEIL. Le modele de vol plafonne
 * le lacet a 1.05 rad/s : a 460 m/s l'appareil ne peut pas tourner plus serre
 * que 438 m de rayon. Un trace plus serre que cela n'est pas « difficile », il
 * est impossible — on racle la paroi quoi qu'on fasse. Une recherche sur
 * grille (240 combinaisons) n'en a laisse passer que 17 ; celle-ci est la plus
 * vivante d'entre elles, avec 600 m de rayon minimal, soit 37 % de marge.
 * C'est la modulation du RAYON qui est dangereuse : au-dela de .08 elle
 * fabrique des epingles involables. La modulation de la HAUTEUR, elle, coute
 * beaucoup moins cher en courbure — le relief est donc gratuit, pas les lobes.
 *
 * Le premier point n'est PAS repete a la fin : `closed: true` referme la
 * courbe toute seule, et le repeter ferait un raccord visible.
 */
function anneauOrbital() {
  const SOMMETS = 18, RAYON = 2400;
  const points = [];
  for (let i = 0; i < SOMMETS; i++) {
    const angle = (i / SOMMETS) * Math.PI * 2;
    const rayon = RAYON * (1 + .08 * Math.sin(angle * 3));
    const hauteur = 420 * Math.sin(angle * 2) + 60 * Math.sin(angle * 5 + 1.1);
    points.push([
      Math.round(Math.cos(angle) * rayon * 10) / 10,
      Math.round(hauteur * 10) / 10,
      Math.round(Math.sin(angle) * rayon * 10) / 10
    ]);
  }
  return points;
}

export const TUNNEL_MAPS = {
  // Circuit de course, en orbite. Rien autour, rien dedans : que du tunnel.
  // Ni montagnes ni maisons — l'absence de decor est ici le sujet, pas un
  // oubli. Le seul repere est le bandeau lumineux de la paroi.
  'anneau-orbital': {
    label: 'Anneau orbital',
    espace: true,
    tunnel: {
      profile: 'round',
      radius: 95,
      wall: 26,
      closed: true,
      lightColor: 0x7ad4ff,
      points: anneauOrbital()
    }
  },

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
// Une carte tracee dans l'editeur vit d'abord dans le navigateur, et seulement
// ensuite sur le serveur. Cet ordre n'est pas un detail :
//
//   - le mode solo doit tourner en site statique, sans Python. Si la lecture
//     passait par le reseau, ouvrir un tunnel sans serveur ne donnerait rien.
//   - une ecriture locale ne peut pas echouer a moitie. Le travail est acquis
//     avant qu'on tente quoi que ce soit sur le reseau.
//
// Le serveur est donc un second exemplaire, jamais la source. `listerCartes()`
// reste synchrone et ne regarde que le navigateur ; c'est `synchroniser()`,
// appele a l'ouverture d'une page, qui va chercher ce qui a ete trace ailleurs
// et le verse dans le stockage local.

const CLE = 'nova-tunnel-maps-v1';
const API = '/api/tunnel-maps';
// Sans profil manette ni session, l'API repond 401 ou 404 : c'est un cas
// normal, pas une panne. Toutes les fonctions reseau renvoient null et la page
// continue sur le stockage local.
const DELAI_RESEAU_MS = 4000;

async function appel(chemin, options = {}) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_RESEAU_MS);
  try {
    const reponse = await fetch(`${API}${chemin}`, {
      signal: controleur.signal, cache: 'no-store', credentials: 'same-origin', ...options
    });
    const estJson = (reponse.headers.get('content-type') || '').includes('application/json');
    if (!reponse.ok || !estJson) return null;
    return await reponse.json().catch(() => null);
  } catch {
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

function lireStockage() {
  try {
    return JSON.parse(localStorage.getItem(CLE)) || {};
  } catch {
    // Un stockage illisible ne doit pas empecher de jouer : on repart a vide.
    return {};
  }
}

function ecrireStockage(cartes) {
  try {
    localStorage.setItem(CLE, JSON.stringify(cartes));
    return true;
  } catch (erreur) {
    console.error('[tunnel-maps] enregistrement impossible', erreur);
    return false;
  }
}

/** Toutes les cartes connues : catalogue du jeu et croquis locaux. */
export function listerCartes() {
  const locales = lireStockage();
  return { ...TUNNEL_MAPS, ...locales };
}

/** Vrai pour les cartes livrees avec le jeu : ni effacables, ni ecrasables. */
export function estCarteDuCatalogue(id) {
  return Object.hasOwn(TUNNEL_MAPS, id);
}

/**
 * Recupere les cartes du serveur et les verse dans le stockage local.
 * En cas de doublon, la plus recemment enregistree gagne — c'est le seul
 * arbitrage possible entre deux navigateurs qui ne se connaissent pas.
 *
 * @returns {Promise<boolean>} vrai si le serveur a repondu.
 */
export async function synchroniser() {
  const distant = await appel('', { method: 'GET' });
  if (!distant?.maps) return false;
  const locales = lireStockage();
  let change = false;
  Object.entries(distant.maps).forEach(([id, carte]) => {
    const connue = locales[id];
    if (connue && Date.parse(connue.enregistree || 0) > Date.parse(carte.enregistree || 0)) return;
    locales[id] = carte;
    change = true;
  });
  if (change) ecrireStockage(locales);
  return true;
}

/** Ecriture locale, immediate et autoritaire. */
export function enregistrerCarte(id, carte) {
  const cartes = lireStockage();
  cartes[id] = { ...carte, id, enregistree: new Date().toISOString() };
  return ecrireStockage(cartes);
}

/**
 * Second exemplaire sur le serveur. A appeler apres `enregistrerCarte`, dont
 * on republie la version horodatee — sinon les deux exemplaires porteraient
 * deux dates differentes et la synchro suivante croirait a une modification.
 *
 * @returns {Promise<boolean>} vrai si le serveur a bien enregistre.
 */
export async function publierCarte(id) {
  const carte = lireStockage()[id];
  if (!carte) return false;
  const reponse = await appel(`/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(carte)
  });
  return !!reponse?.ok;
}

/**
 * Efface des deux cotes. Le local part en premier et sans condition : une
 * carte qu'on vient de supprimer ne doit pas reapparaitre parce que le
 * serveur etait injoignable.
 *
 * @returns {Promise<{local:boolean, serveur:boolean}>}
 */
export async function supprimerCarte(id) {
  if (estCarteDuCatalogue(id)) return { local: false, serveur: false };
  const cartes = lireStockage();
  delete cartes[id];
  const local = ecrireStockage(cartes);
  const reponse = await appel(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { local, serveur: !!reponse?.ok };
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
    // 60 caracteres : la limite du serveur. Sans cette coupe, un nom a
    // rallonge s'enregistrerait ici et serait refuse la-bas, sans que rien ne
    // le dise. La coupe passe avant le retrait des tirets, sinon elle peut en
    // laisser un a la fin.
    .slice(0, 60)
    .replace(/^-+|-+$/g, '') || 'carte';
}
