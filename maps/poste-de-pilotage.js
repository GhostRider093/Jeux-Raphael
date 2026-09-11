import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { basculerReglage } from './poste-reglage.js?v=reglage-20260908b';

// ══════════════════════════════════════════════════════════════════════════
//  POSTE DE PILOTAGE — vol en tunnel
// --------------------------------------------------------------------------
//  Deux postes, et non un seul, parce qu'ils ne servent pas a la meme chose :
//
//    niveau 1  VERRIERE   — montants fins, casquette basse, collimateur.
//                           Ce qu'on garde quand on court dans un tube.
//    niveau 2  POSTE      — la verriere, plus une planche de bord galbee,
//                           trois ecrans vivants, manche et manette animes.
//
//  POURQUOI CE FICHIER EXISTE PLUTOT QUE L'ANCIEN. Le cockpit d'Eurofighter
//  de `cockpit-view.js` vient d'un kit a IMPRIMER en 3D : des millimetres, de
//  la visserie posee a plat sur le plateau, aucune normale dans les
//  geometries, et des « ecrans » qui sont des trous prevus pour y glisser des
//  feuilles de papier. C'est la maquette d'un objet de bureau. Ici tout est
//  construit, a l'echelle du jeu, et concu autour d'une seule question : que
//  cache le poste ? A 460 m/s dans un tube de 95 m de rayon, ce qu'on ne voit
//  pas coute plus cher que ce qu'on affiche.
//
//  MONTAGE. Le groupe est un enfant de la CAMERA, et la camera un enfant de
//  l'appareil. Consequences, toutes voulues :
//    · le poste est solidaire du regard au pixel pres, sans un calcul de
//      position dans la boucle de vol ;
//    · le roulis vient de l'appareil, donc l'horizon bascule tout seul — et
//      resterait juste si le vol passait un jour au tonneau ou au vol sur le
//      dos, ce que le modele Euler de la page ne permet pas encore.
//
//  Aucune allocation dans `mettreAJour` : les vecteurs de travail sont crees
//  une fois, et les ecrans se redessinent a 8 Hz, pas a chaque image — un
//  televersement de texture par image et par ecran couterait plus cher que
//  tout le reste du poste.
// ══════════════════════════════════════════════════════════════════════════

// L'appareil mesure 16 unites du nez a la queue (`maps/fighter-model.js`), et
// l'unite vaut le metre. Toutes les cotes ci-dessous sont donc des metres, et
// se lisent depuis l'oeil du pilote : -Z devant, +Y en haut, +X a droite.
const OEIL_AU_COLLIMATEUR = 1.15;   // distance du reticule
const OEIL_A_LA_PLANCHE = 1.02;     // distance de la planche de bord

const ACIER = { color: 0x1c2229, roughness: .58, metalness: .45 };
const CADRE = { color: 0x262e36, roughness: .5, metalness: .55 };
const VERT_ECRAN = 0x54f6ff;

// ── LES PIECES REELLES DU POSTE ─────────────────────────────────────────────
//  Le poste dessine reste le squelette : verriere, arche, collimateur, ecrans
//  vivants. Ce qui se touche — manche, planche de bord, console des gaz,
//  siege — vient de quatre modeles. Cinq choses a savoir avant d'y toucher.
//
//  ELLES ARRIVENT APRES. Le poste est construit et affiche sans elles ; les
//  primitives d'origine tiennent la place et ne sont retirees qu'a l'entree de
//  leur remplacante. Si un fichier manque, sa doublure reste : le poste n'a
//  jamais de trou. `ready` demeure tenue d'avance, donc aucun telechargement
//  ne retarde l'affichage du monde.
//
//  ELLES SONT LEGERES, ET CE N'EST PAS UN HASARD. Telles que sorties du
//  generateur, les quatre pesaient 149 Mo — non pas en geometrie mais en
//  textures, trois PNG par piece dont un de 18 Mo. Ramenees a 1024 px, en
//  WebP, geometrie a 30 % et meshopt, elles font 2,3 Mo a elles quatre pour
//  180 000 triangles. Ne jamais reinstaller les fichiers bruts.
//
//  D'OU LE DECODEUR. Le meshopt impose `setMeshoptDecoder` ; sans lui le
//  chargement echoue en silence et il ne reste que les doublures.
//
//  ELLES SE POSENT TOUTES SEULES. Leurs cotes sont normalisees et n'ont aucun
//  rapport avec des metres. On mesure la boite englobante APRES rotation — ce
//  qui compte est la hauteur telle qu'elle sera vue, pas celle du fichier —
//  puis on ramene a la cote voulue et on place le point d'ancrage : `pied`
//  pour ce qui repose sur le plancher du poste, `centre` pour ce qui flotte
//  devant l'oeil.
//
//  ELLES SONT D'UN SEUL TENANT. Une coque et un materiau par piece : aucun
//  bouton, aucune manette detachable. Seule la piece entiere peut bouger.
const PIECES = {
  // MANCHE ET BRAS NE FONT QU'UN SEUL OBJET, et c'est voulu. Les versions
  // precedentes montaient un bras genere separement SUR une poignee generee
  // ailleurs : les deux ne s'epousaient jamais, la main flottait a cote ou
  // traversait la poignee, et le poing serrait une barre a embouts dont il
  // fallait esperer que le manche la recouvre. Modelises ensemble, la prise
  // est juste par construction et il n'y a plus rien a faire coincider.
  //
  // Le groupe `manche` tourne avec les commandes : l'avant-bras suit donc la
  // poignee sans un seul calcul de plus, comme le bras separe le faisait.
  //
  // ALLEGE, ET IL LE FALLAIT. Brut, il pesait 92,5 Mo pour 2 997 044
  // triangles. Passe par la recette maison — textures en 1024, geometrie a
  // 1,2 %, meshopt — il tombe a 524 Ko et 35 964 triangles sans difference
  // visible : la carte de normales rend le detail que la geometrie a perdu.
  // Le brut reste dans Downloads. Ne jamais reinstaller un fichier de sortie
  // de generateur tel quel.
  //
  // Pas de `rotation` : il est exporte Y vers le haut, manche debout et
  // avant-bras partant vers le pilote. C'est deja la bonne orientation.
  //
  // `reglage` : releve au panneau F2 le 08/09/2026, devant l'ecran. Il prend
  // le pas sur `hauteur`, `ancrage` et `rotation`, qui ne servent plus que de
  // secours si on efface le releve.
  manche:  {
    url: './assets/cockpit/bras-manche.glb', hauteur: .40, ancrage: 'pied',
    reglage: { position: [.015, .445, .010], rotation: [-.250, 0, -.010], echelle: .5513 }
  },
  // `coupeHaute` : la planche de bord est livree avec un cadre de pare-brise
  // ferme par une vitre BLANCHE ET OPAQUE. Posee telle quelle devant l'oeil,
  // c'est un mur. On jette donc tout ce qui depasse 66 % de sa hauteur, cadre
  // et vitre compris, et il ne reste que la face a instruments — celle qu'on
  // est venu chercher. Le poste garde sa propre arche, qui elle est ouverte.
  planche: { url: './assets/cockpit/planche-de-bord.glb',  hauteur: .60, ancrage: 'pied', position: [0, -.80, -.95], coupeHaute: .66, ecransVol: true },
  console: { url: './assets/cockpit/console-laterale.glb', hauteur: .40, ancrage: 'centre', position: [-.52, -.44, -.70], ecranCode: 'systeme' },
  // Une seule console a ete generee, et un poste en a deux. Celle de droite
  // est la meme en miroir. Un miroir inverse le sens d'enroulement des faces,
  // que le rendu supprimerait : d'ou `miroir`, qui passe les materiaux en
  // double face. Les normales, elles, restent justes — Three transporte la
  // matrice inverse transposee.
  consoleDroite: { url: './assets/cockpit/console-laterale.glb', hauteur: .40, ancrage: 'centre', position: [.52, -.44, -.70], miroir: true, ecranCode: 'nav' },
  // Le siege n'est PAS monte, et ce n'est pas un oubli : le poste est un
  // enfant de la camera, donc solidaire de l'oeil. Un siege se trouve derriere
  // l'oeil ; il ne serait visible sous aucun angle, dans aucun des trois
  // niveaux, et couterait 45 000 triangles pour rien. Le fichier reste sous la
  // main pour une vue exterieure ou un pilote a la troisieme personne.
  siege:   { url: './assets/cockpit/siege.glb',            hauteur: 1.10, ancrage: 'pied', position: [0, -1.05, .30] }
  // Il n'y a plus de piece `bras` : la main et l'avant-bras sont dans le
  // manche. `assets/cockpit/bras-pilote.glb` reste sur le disque, inutilise —
  // c'est celui dont le poing serrait une barre a deux embouts.
};

// -- LA PLANCHE EN IMAGE -----------------------------------------------------
//
//  Une image detouree remplace la planche 3D, les consoles et la verriere. Le
//  gain n'est pas qu'esthetique : le poste genere pesait plusieurs Mo pour un
//  rendu plastique, la voici a 122 Ko.
//
//  ELLE EST DANS LA SCENE, PAS EN CALQUE HTML. C'est le point a ne pas
//  retourner. Un calque HTML se pose au-dessus du canevas, donc au-dessus du
//  manche et du bras : la main disparaitrait derriere la planche. Montee en
//  panneau 3D a 1,15 m de l'oeil, elle reste DERRIERE le manche pose a 0,80 m,
//  qui passe devant tout seul, sans une ligne de tri.
//
//  ELLE SE RECADRE A CHAQUE IMAGE. La hauteur visible a une distance donnee
//  depend du champ, qui bouge avec la vitesse ; la largeur depend de la forme
//  de la fenetre. Une taille figee laisserait des bandes de ciel sur les cotes
//  en 21/9, et un lisere sous la planche des que le champ change. Trois lignes
//  de trigonometrie par image reglent les deux cas.
//
//  ET ELLE RESTE REGLABLE. Le recadrage automatique ecraserait tout reglage
//  fait au panneau F2 : l'image est donc portee par un GROUPE, lui seul inscrit
//  au registre. F2 deplace le porteur, le recadrage travaille sur le panneau
//  qu'il contient, et les deux se composent au lieu de se battre.
const IMAGE_POSTE = {
  url: './assets/cockpit/planche-image.webp',
  distance: 1.15,
  hauteurEcran: 1,   // fraction de la hauteur visible occupee par l'image
  couvrirLargeur: true,
  // Fraction de la photo, a gauche et a droite, autorisee a s'etirer sur un
  // ecran plus large que l'image. 14 % de 1672 px = 234 px : la bande de danger
  // jaune et noire de la console gauche commence a 17 %, elle reste donc dans
  // la partie protegee. Monter ce chiffre adoucit l'etirement mais y fait
  // entrer des details reconnaissables — c'est le compromis, et il se regle ici.
  margeEtirable: .14,
  ancrage: 'bas',
  opacite: 1,
  remontee: 0,       // en fractions de la hauteur visible, 0 = cale sur le bord
  // Releve au panneau F2 le 08/09/2026, devant l'ecran.
  reglage: { position: [0, -.285, -.090], rotation: [0, -.010, 0], echelle: 1.08 }
};

// La verriere separee, EN SOMMEIL depuis le 08/09/2026.
//
//  `actif: false` — et ce n'est pas un oubli. La photo du poste porte
//  desormais sa propre verriere, montants et arceau compris : garder ce calque
//  par-dessus faisait apparaitre DEUX arceaux qui se croisaient. Rien n'est
//  supprime pour autant — le fichier reste dans assets, le mecanisme reste
//  branche, et `actif: true` la rallume. Tant qu'elle dort, sa texture n'est
//  meme pas telechargee : 365 Ko economises a chaque chargement.
//
//  Ce qui suit decrit son fonctionnement, valable le jour ou on la rallume.
//
//  SON OPACITE SUIT LA LUMIERE, ce qui n'est pas un detail. Une verriere n'est
//  pas une decoupe : le verre sombre laisse passer le monde et seuls les
//  reflets et les ferrures se voient. L'alpha du fichier a donc ete tiree de
//  la luminance de la photo, en degrade — un decoupage franc aurait pose une
//  plaque grise en travers du ciel. Les 60 % ci-dessous s'appliquent par
//  dessus, sur le panneau entier.
//
//  ELLE EST PLUS PRES DE L'OEIL QUE LA PLANCHE (1,05 contre 1,15) : la ou les
//  montants recouvrent les longerons, c'est la verriere qui doit gagner. Le
//  manche, a 0,78, reste devant les deux.
const VERRIERE_IMAGE = {
  actif: false,
  url: './assets/cockpit/verriere-image.webp',
  distance: 1.05,
  hauteurEcran: 1,
  couvrirLargeur: true,
  margeEtirable: .14,
  ancrage: 'haut',
  opacite: .42,
  remontee: 0,
  // Releve au panneau F2 le 08/09/2026, devant l'ecran.
  reglage: { position: [0, -.355, -.425], rotation: [.100, 0, 0], echelle: 1.35 }
};

function construirePanneauImage(reglages) {
  // `transparent` SANS `depthWrite` : un pixel vide ne doit rien ecrire dans le
  // tampon de profondeur, sinon le ciel s'efface derriere une vitre invisible.
  // `depthTest` reste actif — c'est lui qui laisse passer le manche devant.
  // `toneMapped` desactive : la scene est en ACES, qui assombrirait une photo
  // deja etalonnee.
  const materiau = new THREE.MeshBasicMaterial({
    transparent: true, depthWrite: false, depthTest: true, toneMapped: false,
    opacity: reglages.opacite
  });
  // TROIS COLONNES, PAS UN QUAD. Un plan d'un seul tenant ne peut etre elargi
  // qu'en etirant tout ce qu'il porte : sur un 5120x1440 la planche partait a
  // 2,00x en largeur, ecrans et manette des gaz compris, pendant que le manche
  // et l'avant-bras — qui sont en 3D — gardaient leurs vraies proportions. Ce
  // sont ces deux mesures cote a cote qui trahissaient la deformation.
  //
  // Avec quatre colonnes de sommets, la bande centrale porte le tableau de bord
  // a son rapport exact et ne bouge JAMAIS ; seules les deux bandes exterieures
  // s'allongent pour rejoindre les bords de l'ecran. Elles ne contiennent que du
  // fuselage sombre et du vide transparent, ou un etirement ne se lit pas.
  const panneau = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 3, 1), materiau);
  panneau.name = reglages.nom + '-image';
  panneau.frustumCulled = false;
  const porteur = new THREE.Group();
  porteur.name = reglages.nom + '-image-porteur';
  porteur.frustumCulled = false;
  porteur.visible = false;               // tant que la texture n'est pas la
  porteur.add(panneau);
  // Releve du panneau F2, pose sur le PORTEUR et non sur le panneau. C'est
  // toute la raison d'etre du porteur : le recadrage automatique reecrit la
  // taille et la position du panneau a chaque image et effacerait un reglage
  // pose dessus. Sur le porteur, les deux se composent — le recadrage garde le
  // panneau colle a son bord d'ecran, le releve l'incline, l'eloigne et le
  // dimensionne par-dessus.
  if (reglages.reglage) {
    porteur.position.set(...reglages.reglage.position);
    porteur.rotation.set(...reglages.reglage.rotation);
    porteur.scale.setScalar(reglages.reglage.echelle);
  }

  let rapport = 16 / 9;

  /**
   * Place les quatre colonnes de sommets dans la TEXTURE : 0, marge, 1-marge, 1.
   * Les colonnes de la geometrie, elles, seront posees a chaque image par
   * `cadrer` — c'est la dissociation des deux qui produit l'etirement selectif.
   *
   * `PlaneGeometry(1, 1, 3, 1)` engendre ses sommets rangee par rangee, quatre
   * par rangee : l'indice d'une colonne vaut donc `rangee * 4 + colonne`.
   */
  let marge = .14;
  function poserColonnesUv() {
    marge = THREE.MathUtils.clamp(reglages.margeEtirable ?? .14, .02, .45);
    const uv = panneau.geometry.attributes.uv;
    const colonnes = [0, marge, 1 - marge, 1];
    for (let colonne = 0; colonne < 4; colonne++) {
      uv.setX(colonne, colonnes[colonne]);
      uv.setX(colonne + 4, colonnes[colonne]);
    }
    uv.needsUpdate = true;
  }
  poserColonnesUv();
  // En sommeil : aucune requete reseau, aucun panneau a l'image. Resoudre a
  // `null` suffit — les appelants traitent deja ce cas, qui est celui d'une
  // texture manquante.
  const pret = reglages.actif === false ? Promise.resolve(null) : new Promise(resolve => {
    new THREE.TextureLoader().load(reglages.url, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      materiau.map = texture;
      materiau.needsUpdate = true;
      rapport = texture.image.width / texture.image.height;
      resolve(porteur);
    }, undefined, erreur => {
      console.warn(`[poste] image « ${reglages.nom} » non chargee`, erreur);
      resolve(null);
    });
  });

  /**
   * Recale le panneau sur le champ et la forme reelles de la fenetre.
   *
   * C'EST LA HAUTEUR QUI COMMANDE, ET C'EST UNE CORRECTION. La premiere
   * version calait l'image sur la LARGEUR visible et laissait la hauteur
   * suivre le rapport de l'image. Sur une fenetre 16/9 le resultat tombait
   * juste, ce qui masquait le defaut ; sur une fenetre large — un ecran
   * 5120x1305, rapport 3,92, contre 1,78 pour l'image — la hauteur calculee
   * depassait de plus du double celle de l'ecran. La planche devenait enorme
   * et le ciel disparaissait. La taille apparente du poste ne doit dependre
   * que du champ, jamais de la forme de la fenetre.
   *
   * LA LARGEUR NE FAIT QUE SUIVRE, et `couvrirLargeur` l'etend au besoin pour
   * atteindre les bords : laisser l'image plus etroite que l'ecran montrerait du
   * ciel a gauche et a droite de la planche, la ou le fuselage devrait
   * continuer, et la ruinerait d'un coup.
   *
   * MAIS CE SUPPLEMENT DE LARGEUR NE VA PLUS A TOUT LE MONDE. Il est verse
   * entierement aux deux bandes exterieures ; la bande centrale garde la largeur
   * que son rapport lui donne, a n'importe quelle forme de fenetre. Sur un
   * 1920x1080 les trois bandes retombent exactement sur l'ancien cadrage — le
   * supplement y est nul — et rien ne change. Sur un 5120x1440, la planche cesse
   * d'etre etiree 2,00x : elle est intacte, et ce sont les flancs qui s'allongent.
   */
  function cadrer(camera) {
    if (!camera || !camera.isPerspectiveCamera) return;
    const d = reglages.distance;
    const hauteurVue = 2 * d * Math.tan(camera.fov * Math.PI / 360);
    const hauteur = hauteurVue * reglages.hauteurEcran;
    const largeurNaturelle = hauteur * rapport;
    let largeur = largeurNaturelle;
    if (reglages.couvrirLargeur) largeur = Math.max(largeur, hauteurVue * camera.aspect);
    // Demi-largeur de la bande centrale, mesuree sur l'image SANS etirement.
    const demiCentre = largeurNaturelle * (.5 - marge);
    const bords = [-largeur / 2, -demiCentre, demiCentre, largeur / 2];
    const sommets = panneau.geometry.attributes.position;
    for (let colonne = 0; colonne < 4; colonne++) {
      sommets.setX(colonne, bords[colonne]);
      sommets.setX(colonne + 4, bords[colonne]);
    }
    sommets.needsUpdate = true;
    // La largeur vit desormais dans les sommets : l'echelle ne porte plus que la
    // hauteur. La laisser porter la largeur re-etirerait d'un coup le centre
    // qu'on vient de proteger, et tout ce travail ne servirait a rien.
    panneau.scale.set(1, hauteur, 1);
    // Cale sur un bord de l'ecran, jamais centre : la planche pousse depuis le
    // bas, la verriere depuis le haut, et le bord colle quoi qu'il arrive au
    // champ. Sans ca on verrait passer un lisere de ciel a chaque changement
    // de vitesse.
    const bord = reglages.ancrage === 'haut' ? hauteurVue / 2 - hauteur / 2 : -hauteurVue / 2 + hauteur / 2;
    panneau.position.set(0, bord + hauteurVue * reglages.remontee, -d);
  }

  /**
   * Change le cadrage a chaud. Les trois poignees ne font pas la meme chose,
   * et confondre les deux premieres coute une demi-heure :
   *
   *   `hauteurEcran` fraction de la hauteur visible occupee par l'image.
   *              C'EST LA POIGNEE DE TAILLE. 1 = l'image fait toute la hauteur,
   *              .7 = la planche est plus petite et le ciel gagne. La largeur
   *              suit toute seule et ne laisse jamais de trou sur les cotes.
   *   `remontee` descend ou remonte l'image, en fractions de la hauteur
   *              visible. C'EST LA BONNE POIGNEE POUR VOIR PLUS DE CIEL :
   *              une valeur negative fait couler la planche vers le bas, le
   *              ciel gagne du terrain, et les cotes restent couverts.
   *   `distance` eloigne le panneau. Ne change RIEN a sa taille apparente,
   *              puisque le recadrage suit — sert seulement a le garder
   *              derriere le manche, pose a 0,80 m de l'oeil.
   *   `margeEtirable` part de la photo, a gauche et a droite, qui a le droit de
   *              s'etirer sur un ecran large. Ne se voit QUE hors du 16/9.
   *              Plus grand = etirement plus doux mais reparti sur des details
   *              reconnaissables ; plus petit = centre mieux protege mais flancs
   *              plus tires.
   */
  function regler(patch = {}) {
    Object.assign(reglages, patch);
    if (patch.opacite !== undefined) materiau.opacity = patch.opacite;
    if (patch.margeEtirable !== undefined) poserColonnesUv();
    return { ...reglages };
  }

  return { porteur, pret, cadrer, regler };
}

/**
 * Jette les triangles situes au-dessus d'une fraction de la hauteur du modele.
 * Un triangle n'est retire que si ses TROIS sommets sont au-dessus du seuil :
 * la tranche reste ainsi franche au lieu de s'effilocher.
 */
function couperAuDessus(modele, fraction) {
  // Les hauteurs se mesurent dans le repere du MODELE, pas dans celui de la
  // geometrie. Deux raisons, toutes deux payees a l'essai :
  //   · la scene exportee porte un noeud « convert » qui redresse le modele —
  //     dans les donnees brutes, la verticale est sur Z, pas sur Y ;
  //   · les positions sont quantifiees (KHR_mesh_quantization, pose par
  //     gltf-transform), donc `getY()` rend un entier brut sans rapport avec
  //     une cote.
  // `fromBufferAttribute` puis la matrice monde repondent aux deux : couper a
  // 66 % coupait sinon a 15 %, et il ne restait que le socle.
  modele.updateMatrixWorld(true);
  const sommet = new THREE.Vector3();
  modele.traverse(objet => {
    if (!objet.isMesh) return;
    const geometrie = objet.geometry;
    const sommets = geometrie.attributes.position;
    const versLeMonde = objet.matrixWorld;
    const hauteurDe = i => sommet.fromBufferAttribute(sommets, i).applyMatrix4(versLeMonde).y;

    let bas = Infinity, haut = -Infinity;
    for (let i = 0; i < sommets.count; i++) {
      const y = hauteurDe(i);
      if (y < bas) bas = y;
      if (y > haut) haut = y;
    }
    const seuil = bas + (haut - bas) * fraction;

    const index = geometrie.index;
    const total = index ? index.count : sommets.count;
    const gardes = [];
    for (let i = 0; i < total; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      if (hauteurDe(a) <= seuil || hauteurDe(b) <= seuil || hauteurDe(c) <= seuil) gardes.push(a, b, c);
    }
    geometrie.setIndex(gardes);
    geometrie.computeBoundingBox();
    geometrie.computeBoundingSphere();
  });
}

/**
 * Monte un objet sur une piece a des valeurs MESUREES, dans le repere de cette
 * piece. C'est la forme que rend le panneau F2 : on regle a l'ecran, on copie,
 * on colle ici. Aucune fraction devinee, aucun aller-retour.
 *
 * L'echelle est absolue et non un facteur : le panneau la donne telle quelle,
 * et elle contient deja la compensation de l'echelle de la piece porteuse.
 */
function monterSurPiece(modele, objet, position, rotation, echelle) {
  objet.position.set(...position);
  objet.rotation.set(...rotation);
  objet.scale.setScalar(echelle);
  // La console de droite est un miroir : sans defaire son signe, le texte de
  // l'ecran qu'on lui monte se lirait a l'envers.
  if (modele.scale.x < 0) objet.scale.x *= -1;
  modele.add(objet);
  return objet;
}

// ── L'ENVIRONNEMENT DU POSTE ────────────────────────────────────────────────
//  Les quatre pieces sont en PBR metal/rugosite. Sans carte d'environnement,
//  un metal ne reflete RIEN : il rend plat, mat, plastique — et c'est ce qui
//  faisait que le poste ne ressemblait a rien malgre des textures correctes.
//  Le ton de la scene est deja bon (ACES), il manquait le reflet.
//
//  On ne charge pas un HDRI : on fabrique une petite salle et on en tire une
//  carte par PMREM. Zero octet telecharge, et la salle porte exactement ce
//  qu'un cockpit doit refleter — un ciel clair au-dessus, un sol sombre en
//  dessous, une ouverture lumineuse a l'avant, deux joues laterales douces.
//
//  Elle n'est posee QUE sur les pieces du poste, pas sur la scene : le monde a
//  son propre eclairage, regle monde par monde, et une carte globale le
//  deraillerait partout.
let environnement = null;
function environnementDuPoste(rendu) {
  if (environnement || !rendu) return environnement;
  const salle = new THREE.Scene();
  salle.add(new THREE.Mesh(
    new THREE.BoxGeometry(10, 6, 10),
    new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: 0x222b35 })
  ));
  // Les couleurs depassent 1 : le PMREM rend dans une cible demi-flottante,
  // donc ces panneaux se comportent en sources et non en peinture claire.
  const panneau = (couleur, force, largeur, hauteur, position, rotation) => {
    const materiau = new THREE.MeshBasicMaterial({ color: couleur });
    materiau.color.multiplyScalar(force);
    const plan = new THREE.Mesh(new THREE.PlaneGeometry(largeur, hauteur), materiau);
    plan.position.set(...position);
    plan.rotation.set(...rotation);
    salle.add(plan);
  };
  panneau(0x9ec8ff, 3.4, 10, 10, [0, 2.98, 0], [Math.PI / 2, 0, 0]);
  panneau(0x161b21, 1.0, 10, 10, [0, -2.98, 0], [-Math.PI / 2, 0, 0]);
  panneau(0xfff0d8, 2.6, 5.5, 3.2, [0, .7, -4.98], [0, 0, 0]);
  panneau(0x7493ad, 1.3, 3.4, 3.4, [-4.98, .4, 0], [0, Math.PI / 2, 0]);
  panneau(0x7493ad, 1.3, 3.4, 3.4, [4.98, .4, 0], [0, -Math.PI / 2, 0]);

  const generateur = new THREE.PMREMGenerator(rendu);
  environnement = generateur.fromScene(salle, .04).texture;
  generateur.dispose();
  salle.traverse(objet => {
    objet.geometry?.dispose();
    objet.material?.dispose();
  });
  return environnement;
}

/** Pose la carte d'environnement sur tous les materiaux d'une branche. */
function habiller(racine, carte) {
  if (!carte) return;
  racine.traverse(objet => {
    const materiau = objet.material;
    if (!materiau) return;
    for (const m of Array.isArray(materiau) ? materiau : [materiau]) {
      if (!m.isMeshStandardMaterial) continue;
      m.envMap = carte;
      m.envMapIntensity = .85;
      m.needsUpdate = true;
    }
  });
}

let chargeur = null;
// Cache par FICHIER et non par piece : les deux consoles sont le meme modele,
// et il ne se telecharge qu'une fois.
const telechargements = new Map();
function chargerPiece(nom) {
  const { url } = PIECES[nom];
  if (!telechargements.has(url)) {
    chargeur = chargeur || new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    telechargements.set(url, chargeur.loadAsync(url).catch(erreur => {
      telechargements.delete(url);
      throw erreur;
    }));
  }
  return telechargements.get(url);
}

/** Met une piece a l'echelle et la pose selon son ancrage. */
function poserPiece(modele, piece) {
  if (piece.coupeHaute) couperAuDessus(modele, piece.coupeHaute);
  if (piece.rotation) modele.rotation.set(...piece.rotation);
  modele.updateMatrixWorld(true);
  const boite = new THREE.Box3().setFromObject(modele);
  const taille = boite.getSize(new THREE.Vector3());
  const centre = boite.getCenter(new THREE.Vector3());
  const facteur = piece.hauteur / (taille.y || 1);
  modele.scale.setScalar(facteur);
  const bas = piece.ancrage === 'pied' ? boite.min.y : centre.y;
  modele.position.set(-centre.x * facteur, -bas * facteur, -centre.z * facteur);
  if (piece.miroir) {
    modele.scale.x *= -1;
    modele.position.x *= -1;
    modele.traverse(objet => {
      if (!objet.isMesh) return;
      objet.material = objet.material.clone();
      objet.material.side = THREE.DoubleSide;
    });
  }
  if (piece.position) modele.position.add(new THREE.Vector3(...piece.position));
  // RELEVE DU PANNEAU F2. Il ne s'ajoute pas au placement automatique : il le
  // REMPLACE. C'est la position finale telle qu'elle a ete lue a l'ecran, et
  // c'est precisement ce qui la rend reproductible — `hauteur`, `ancrage` et
  // `position` repassent par un recentrage sur la boite englobante, qui
  // deformerait un chiffre releve a l'oeil. Les deux voies coexistent : une
  // piece sans `reglage` garde le placement calcule.
  const facteurFinal = piece.reglage ? piece.reglage.echelle : facteur;
  if (piece.reglage) {
    modele.position.set(...piece.reglage.position);
    modele.rotation.set(...piece.reglage.rotation);
    modele.scale.setScalar(piece.reglage.echelle);
  }
  // Collees a l'oeil comme le reste du poste : sans cela Three les retire de
  // l'image des que la camera tourne.
  modele.traverse(objet => { objet.frustumCulled = false; });
  // Retenu pour les ecrans montes DESSUS : un enfant vit dans le repere du
  // modele, donc a son echelle. Sans ce facteur, une dalle de 17 cm arriverait
  // a 33 cm sur une piece reduite de moitie.
  modele.userData.facteurPoste = facteurFinal;
  // La boite mesuree ci-dessus est dans le repere PROPRE du modele : il
  // n'avait alors ni echelle ni position. C'est la seule utilisable pour y
  // accrocher quelque chose. Une `Box3.setFromObject` faite APRES l'ajout au
  // poste rendrait des coordonnees monde — donc la position de l'avion dans la
  // ville, puisque le poste est enfant de la camera.
  modele.userData.boiteLocale = boite.clone();
  return modele;
}

/**
 * Monte un objet du poste SUR une piece chargee, a une position donnee en
 * fractions de sa boite englobante. C'est ce qui remplace les coordonnees
 * fixes : un ecran ne peut plus se retrouver a cote de la dalle qu'il doit
 * couvrir, puisqu'il est place par rapport a la piece elle-meme.
 *
 * @param {number[]} fractions [x, y, z] dans la boite, 0 = min, 1 = max
 */
function monterParFractions(modele, objet, fractions, rotation) {
  const facteur = modele.userData.facteurPoste || 1;
  const boite = modele.userData.boiteLocale;
  const taille = boite.getSize(new THREE.Vector3());
  objet.position.set(
    boite.min.x + taille.x * fractions[0],
    boite.min.y + taille.y * fractions[1],
    boite.min.z + taille.z * fractions[2]
  );
  objet.rotation.set(...rotation);
  // L'enfant vit a l'echelle du modele : on la defait pour qu'une dalle de
  // 17 cm en fasse 17. Et sur la console de droite, qui est un miroir, on
  // defait aussi le miroir — sans quoi son texte se lit a l'envers.
  objet.scale.setScalar(1 / facteur);
  if (modele.scale.x < 0) objet.scale.x *= -1;
  modele.add(objet);
  return objet;
}

// Liberation d'une branche entiere : geometries, textures, materiaux. Sert au
// retrait de la doublure comme a la fermeture du poste.
function libererBranche(racine) {
  racine.traverse(objet => {
    if (objet.geometry) objet.geometry.dispose();
    const materiau = objet.material;
    if (!materiau) return;
    for (const m of Array.isArray(materiau) ? materiau : [materiau]) {
      for (const cle of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap']) {
        m[cle]?.dispose();
      }
      m.dispose();
    }
  });
}

/** Un materiau lumineux qui ne depend d'aucune lampe : le poste est a l'ombre. */
function materiauEcran(texture) {
  return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
}

/**
 * Trace de collimateur : un dessin blanc sur fond transparent, projete devant
 * le pilote. Le fond DOIT etre transparent et le melange additif : un
 * collimateur est une image reflechie sur une lame de verre, il eclaircit le
 * paysage, il ne le masque jamais.
 */
function toileSymbologie(largeur, hauteur, dessiner) {
  const toile = document.createElement('canvas');
  toile.width = largeur;
  toile.height = hauteur;
  const ctx = toile.getContext('2d');
  ctx.strokeStyle = '#8dffc8';
  ctx.fillStyle = '#8dffc8';
  ctx.lineWidth = 3;
  ctx.font = '600 26px Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  dessiner(ctx);
  const texture = new THREE.CanvasTexture(toile);
  texture.anisotropy = 4;
  return { toile, ctx, texture };
}

function planCollimateur(texture, largeur, hauteur, distance) {
  const plan = new THREE.Mesh(
    new THREE.PlaneGeometry(largeur, hauteur),
    new THREE.MeshBasicMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    })
  );
  plan.position.z = -distance;
  // Le collimateur se dessine par-dessus tout : sans cela, une paroi frolee
  // de trop pres passe devant le reticule.
  plan.renderOrder = 30;
  plan.frustumCulled = false;
  return plan;
}

/** Montant de verriere : un tube fin entre deux points. */
function montant(depuis, vers, rayon, materiau) {
  const axe = new THREE.Vector3().subVectors(vers, depuis);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(rayon, rayon, axe.length(), 8), materiau);
  tube.position.copy(depuis).addScaledVector(axe, .5);
  tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axe.clone().normalize());
  return tube;
}

// ── NIVEAU 1 : LA VERRIERE ──────────────────────────────────────────────────
function construireVerriere(materiauStructure, champ) {
  const groupe = new THREE.Group();
  groupe.name = 'verriere';

  // Arceau de pare-brise. Il est DEVANT le pilote, pas au-dessus de sa tete :
  // une arche posee sur la nuque est hors du champ, elle ne coute que des
  // sommets. Une demi-torique est deja une arche dans le plan XY — la coucher
  // d'un quart de tour en ferait un cerceau horizontal, invisible.
  //
  // L'arche est calculee A PARTIR DU CHAMP DE VISION, pas posee en metres.
  // Les mondes ouvrent a 72 degres en poste, le reste du jeu vole a 62 : une
  // cote figee coifferait le cadre dans un cas et barrerait le centre dans
  // l'autre. On vise donc toujours 84 % de la demi-image, et la geometrie
  // suit. A 62 degres cela redonne exactement 0,78 m de rayon, la valeur
  // trouvee au banc.
  const AVANT = -1.45, ASSISE = -.05;
  const demiImage = Math.abs(AVANT) * Math.tan(champ * Math.PI / 360);
  const RAYON_ARCEAU = demiImage * .84 - ASSISE;
  const arceau = new THREE.Mesh(
    new THREE.TorusGeometry(RAYON_ARCEAU, .022, 8, 26, Math.PI),
    materiauStructure
  );
  arceau.position.set(0, ASSISE, AVANT);
  groupe.add(arceau);

  // Les montants partent des pieds de l'arche et filent vers l'arriere en
  // MONTANT, les rails en DESCENDANT. Ce n'est pas un detail de style : une
  // piece qui passe pres de l'oeil au niveau de l'oeil balaye tout le centre
  // de l'image en projection, si fine soit-elle. Au-dessus et en dessous, les
  // memes pieces sortent du cadre par le haut et par le bas, et la ligne de
  // vol reste degagee. C'est aussi la vraie geometrie d'une verriere en
  // goutte : rails sous les coudes, arceau au-dessus des yeux.
  for (const cote of [-1, 1]) {
    groupe.add(montant(
      new THREE.Vector3(cote * RAYON_ARCEAU, ASSISE, AVANT),
      new THREE.Vector3(cote * RAYON_ARCEAU * .70, .52, .40),
      .021, materiauStructure
    ));
    groupe.add(montant(
      new THREE.Vector3(cote * RAYON_ARCEAU * .79, -.42, AVANT + .1),
      new THREE.Vector3(cote * RAYON_ARCEAU * .77, -.50, .40),
      .028, materiauStructure
    ));
  }

  // Casquette : une bande basse et etroite. Elle sert de repere pour le bas de
  // l'image et masque la jonction avec la planche ; elle ne doit surtout pas
  // avancer, c'est le defaut exact de l'ancien poste.
  const casquette = new THREE.Mesh(
    new THREE.CylinderGeometry(.62, .62, .1, 22, 1, true, Math.PI * .62, Math.PI * .76),
    materiauStructure
  );
  casquette.rotation.x = Math.PI / 2;
  casquette.position.set(0, -.30, -.86);
  casquette.scale.set(1, 1, .5);
  groupe.add(casquette);

  return groupe;
}

// ── LE COLLIMATEUR ──────────────────────────────────────────────────────────
function construireCollimateur() {
  const groupe = new THREE.Group();
  groupe.name = 'collimateur';

  // Reticule fixe : l'avion pointe la ou il vole.
  const { texture: texReticule } = toileSymbologie(256, 256, ctx => {
    ctx.beginPath();
    ctx.arc(128, 128, 26, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of [[128, 84, 128, 102], [128, 154, 128, 172],
                                    [84, 128, 102, 128], [154, 128, 172, 128]]) {
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();
    ctx.fillRect(126, 126, 4, 4);
  });
  groupe.add(planCollimateur(texReticule, .3, .3, OEIL_AU_COLLIMATEUR));

  // Echelle de tangage. Chaque barreau porte son angle ; l'ensemble bascule
  // avec le roulis et coulisse avec l'assiette. C'est le seul instrument qui
  // dit, dans un tunnel sans horizon, si l'on monte ou si l'on descend.
  const echelle = new THREE.Group();
  echelle.name = 'echelle-tangage';
  for (let angle = -30; angle <= 30; angle += 10) {
    if (angle === 0) continue;
    const { texture } = toileSymbologie(256, 64, ctx => {
      ctx.beginPath();
      // Barreau interrompu au centre : le reticule doit rester lisible.
      ctx.moveTo(10, 32); ctx.lineTo(88, 32);
      ctx.moveTo(168, 32); ctx.lineTo(246, 32);
      // Les crans pointent vers l'horizon : vers le bas quand on est au-dessus.
      const sens = angle > 0 ? 1 : -1;
      ctx.moveTo(10, 32); ctx.lineTo(10, 32 + sens * 12);
      ctx.moveTo(246, 32); ctx.lineTo(246, 32 + sens * 12);
      ctx.stroke();
      if (angle < 0) ctx.setLineDash([8, 8]);
      ctx.fillText(String(Math.abs(angle)), 128, 32);
    });
    const barreau = planCollimateur(texture, .34, .085, OEIL_AU_COLLIMATEUR);
    barreau.position.y = 0;
    barreau.userData.angle = angle;
    echelle.add(barreau);
  }
  groupe.add(echelle);

  // Ligne d'horizon : un barreau plein, sans chiffre.
  const { texture: texHorizon } = toileSymbologie(256, 32, ctx => {
    ctx.beginPath();
    ctx.moveTo(4, 16); ctx.lineTo(94, 16);
    ctx.moveTo(162, 16); ctx.lineTo(252, 16);
    ctx.stroke();
  });
  const horizon = planCollimateur(texHorizon, .42, .05, OEIL_AU_COLLIMATEUR);
  horizon.userData.angle = 0;
  echelle.add(horizon);

  return { groupe, echelle };
}

// ── NIVEAU 2 : LA PLANCHE DE BORD ───────────────────────────────────────────
function construireEcran(largeur, hauteur, position) {
  const toile = document.createElement('canvas');
  toile.width = 256;
  toile.height = 256;
  const texture = new THREE.CanvasTexture(toile);
  const ecran = new THREE.Mesh(new THREE.PlaneGeometry(largeur, hauteur), materiauEcran(texture));
  ecran.position.copy(position);
  // Les ecrans sont inclines vers le pilote : une dalle a plat sur la planche
  // ne renvoie qu'un reflet rasant et devient illisible.
  ecran.rotation.x = .62;
  ecran.userData.toile = toile;
  ecran.userData.ctx = toile.getContext('2d');
  ecran.userData.texture = texture;
  return ecran;
}

function construirePlanche(materiauStructure, materiauCadre) {
  const groupe = new THREE.Group();
  groupe.name = 'planche';

  // Le bandeau galbe. Un cylindre tronque plutot qu'une boite : une planche de
  // bord epouse l'assise du pilote, et l'arc rattrape la deformation de la
  // perspective sur les bords de l'image.
  const bandeau = new THREE.Mesh(
    new THREE.CylinderGeometry(.95, .95, .46, 26, 1, true, Math.PI * .70, Math.PI * .60),
    materiauCadre
  );
  bandeau.rotation.x = Math.PI / 2;
  bandeau.position.set(0, -.52, -OEIL_A_LA_PLANCHE + .1);
  bandeau.scale.set(1, 1, .62);
  // Doublure : ce bandeau cede la place a la vraie planche de bord des
  // qu'elle est chargee. Les trois ecrans, eux, restent — ils sont vivants et
  // aucun modele ne sait afficher une vitesse.
  const doublurePlanche = new THREE.Group();
  doublurePlanche.add(bandeau);
  groupe.add(doublurePlanche);

  const ecrans = [
    construireEcran(.20, .20, new THREE.Vector3(-.26, -.47, -.90)),
    construireEcran(.24, .22, new THREE.Vector3(0, -.50, -.94)),
    construireEcran(.20, .20, new THREE.Vector3(.26, -.47, -.90))
  ];
  ecrans.forEach(ecran => groupe.add(ecran));

  // Consoles laterales : deux joues qui ferment le poste sur les cotes. Les
  // deux sont des doublures — la vraie console vient a gauche, et son miroir
  // a droite.
  const doublureConsole = new THREE.Group();
  for (const cote of [-1, 1]) {
    const joue = new THREE.Mesh(new THREE.BoxGeometry(.14, .3, .82), materiauStructure);
    joue.position.set(cote * .48, -.46, -.52);
    joue.rotation.z = cote * -.16;
    doublureConsole.add(joue);
  }
  groupe.add(doublureConsole);

  // Les ecrans de servitude des deux consoles. Ils ne sont pas des doublures :
  // aucun modele ne sait afficher un texte qui change.
  const ecransConsole = [construireEcranConsole(-1), construireEcranConsole(1)];
  ecransConsole.forEach(ecran => groupe.add(ecran));

  // Le manche, entre les genoux, et la manette des gaz a gauche. Ils bougent :
  // c'est le seul retour visuel qui dise que la commande est bien passee, et
  // c'est ce qui manque le plus quand on doute d'une manette.
  const manche = new THREE.Group();
  // Ces deux primitives ne sont qu'une doublure. Elles tiennent la place tant
  // que le vrai manche n'est pas arrive, et le poste n'a donc jamais de trou
  // entre son affichage et la fin du telechargement.
  const doublureManche = new THREE.Group();
  const colonne = new THREE.Mesh(new THREE.CylinderGeometry(.017, .022, .3, 10), materiauStructure);
  colonne.position.y = .15;
  doublureManche.add(colonne);
  const poignee = new THREE.Mesh(new THREE.CapsuleGeometry(.032, .09, 4, 10), materiauCadre);
  poignee.position.y = .33;
  doublureManche.add(poignee);
  manche.add(doublureManche);
  // A 0,80 m devant l'oeil, la demi-hauteur visible est de 0,48 m : la poignee,
  // qui se trouve 0,33 m au-dessus du pied du manche, tombe a -0,29 et se voit.
  // Plus pres ou plus bas, le manche est hors cadre et son animation ne sert a
  // personne — c'est ce que le banc a mesure sur la premiere version.
  manche.position.set(0, -.84, -.78);
  groupe.add(manche);

  const gaz = new THREE.Group();
  const levier = new THREE.Mesh(new THREE.BoxGeometry(.035, .035, .2), materiauStructure);
  levier.position.z = -.1;
  gaz.add(levier);
  const pommeau = new THREE.Mesh(new THREE.SphereGeometry(.038, 10, 8), materiauCadre);
  pommeau.position.z = -.2;
  gaz.add(pommeau);
  gaz.position.set(-.46, -.38, -.66);
  groupe.add(gaz);

  return { groupe, ecrans, ecransConsole, manche, doublureManche, doublurePlanche, doublureConsole, gaz };
}

// ── ASSIETTE LUE SUR LA CAMERA ──────────────────────────────────────────────
// L'echelle de tangage a besoin de savoir ou est l'horizon. Plutot que de
// reclamer deux angles a chaque page — qui les nomment differemment et ne les
// tiennent pas toujours a jour — on les deduit de l'orientation reelle de la
// camera. Le poste est ainsi juste partout, sans rien demander a personne.
const _avant = new THREE.Vector3();
const _droite = new THREE.Vector3();
const _horizon = new THREE.Vector3();
const _croix = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const HAUT_MONDE = new THREE.Vector3(0, 1, 0);

function assietteDe(camera, sortie) {
  camera.getWorldQuaternion(_quat);
  _avant.set(0, 0, -1).applyQuaternion(_quat).normalize();
  _droite.set(1, 0, 0).applyQuaternion(_quat).normalize();
  sortie.tangage = Math.asin(Math.max(-1, Math.min(1, _avant.y)));
  _horizon.crossVectors(_avant, HAUT_MONDE);
  // Nez a la verticale : l'horizon n'a plus de direction, le roulis n'a plus
  // de sens. On garde la derniere valeur plutot que de faire tressauter
  // l'echelle sur une division par presque zero.
  if (_horizon.lengthSq() > 1e-6) {
    _horizon.normalize();
    _croix.crossVectors(_horizon, _droite);
    sortie.roulis = Math.atan2(_croix.dot(_avant), _horizon.dot(_droite));
  }
  return sortie;
}

// ── LES ECRANS, REDESSINES ──────────────────────────────────────────────────
function peindreCompteur(ctx, titre, valeur, unite) {
  ctx.fillStyle = '#04120f';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(84,246,255,.28)';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 240, 240);
  ctx.fillStyle = '#54f6ff';
  ctx.textAlign = 'center';
  ctx.font = '600 30px Consolas, monospace';
  ctx.fillText(titre, 128, 48);
  ctx.font = '700 78px Consolas, monospace';
  ctx.fillText(valeur, 128, 132);
  ctx.font = '600 26px Consolas, monospace';
  ctx.fillStyle = 'rgba(84,246,255,.65)';
  ctx.fillText(unite, 128, 182);
}

/** Ecran central : ou l'on se trouve sur le circuit, vu de dessus. */
function peindrePlan(ctx, avancement, poussee) {
  ctx.fillStyle = '#04120f';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(84,246,255,.3)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(128, 118, 74, 0, Math.PI * 2);
  ctx.stroke();
  // Le point du pilote sur la boucle. L'angle suit l'avancement : c'est faux
  // au metre pres — le circuit n'est pas un cercle — mais c'est juste au tour
  // pres, et c'est la seule chose qu'on lit d'un coup d'oeil.
  const angle = avancement * Math.PI * 2 - Math.PI / 2;
  ctx.fillStyle = '#8dffc8';
  ctx.beginPath();
  ctx.arc(128 + Math.cos(angle) * 74, 118 + Math.sin(angle) * 74, 11, 0, Math.PI * 2);
  ctx.fill();
  // Jauge de poussee, en bas.
  ctx.fillStyle = 'rgba(84,246,255,.22)';
  ctx.fillRect(30, 214, 196, 18);
  ctx.fillStyle = '#54f6ff';
  ctx.fillRect(30, 214, Math.round(196 * Math.min(1, Math.max(0, poussee))), 18);
}

// ── LE CODE QUI DEFILE SUR LES CONSOLES ─────────────────────────────────────
//  Les deux consoles laterales ont une dalle noire au milieu, et une dalle
//  noire dans un poste d'avion ne dit rien. On y pose un ecran de servitude
//  qui debite du code : a gauche l'etat des systemes, a droite la navigation.
//  Ce n'est pas du decor gratuit — c'est ce qui donne l'impression que
//  l'appareil calcule pendant qu'on vole.
//
//  Le texte DEFILE mais n'est pas reecrit a chaque image : les lignes sont
//  tirees une fois d'un vivier fixe, et seul le decalage vertical bouge. Rien
//  n'est alloue dans la boucle.
const LIGNES_SYSTEME = [
  'INS ALIGN . . . . OK', 'HYD 1 3100 PSI', 'HYD 2 3080 PSI',
  'GEN L ONLINE', 'GEN R ONLINE', 'FUEL XFER AUTO', 'BLEED NORM',
  'EGT 612 C', 'N1 88.4 %', 'N2 96.1 %', 'OIL 42 PSI',
  'RADAR STBY>SCAN', 'ECM PASSIVE', 'CHAFF 30 / FLARE 30',
  'IFF MODE 4 OK', 'DL LINK 16 SYNC', 'BIT PASS 0 FAULT'
];
const LIGNES_NAV = [
  'WPT 04 / 12', 'BRG 271 DEG', 'DIST 18.4 NM', 'ETE 00:04:12',
  'GS 486 KT', 'TAS 512 KT', 'WIND 240 / 18', 'DRIFT -3.1',
  'LAT 43 41.2 N', 'LON 007 16.8 E', 'MAG VAR 2.1 E',
  'ALT SEL 1200 M', 'VS +0.0 M/S', 'TCAS 3 TRACKS', 'TERR CLR 340 M'
];

function construireEcranConsole(cote) {
  const toile = document.createElement('canvas');
  toile.width = 256;
  toile.height = 192;
  const texture = new THREE.CanvasTexture(toile);
  const ecran = new THREE.Mesh(new THREE.PlaneGeometry(.21, .155), materiauEcran(texture));
  // Pose sur la face de la console : inclinee vers le pilote, et tournee vers
  // l'axe du poste pour ne pas etre vue par la tranche.
  ecran.position.set(cote * .505, -.35, -.652);
  ecran.rotation.set(-.34, cote * .30, 0);
  ecran.userData.ctx = toile.getContext('2d');
  ecran.userData.texture = texture;
  ecran.userData.lignes = cote < 0 ? LIGNES_SYSTEME : LIGNES_NAV;
  ecran.userData.titre = cote < 0 ? 'SYSTEMES' : 'NAVIGATION';
  return ecran;
}

/** Une page de code, decalee. `defilement` avance d'une ligne par appel. */
function peindreCode(ctx, lignes, titre, defilement) {
  ctx.fillStyle = '#03110d';
  ctx.fillRect(0, 0, 256, 192);
  ctx.fillStyle = 'rgba(84,246,255,.16)';
  ctx.fillRect(0, 0, 256, 22);
  ctx.fillStyle = '#54f6ff';
  ctx.font = '700 14px Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(titre, 8, 16);
  ctx.font = '600 13px Consolas, monospace';
  for (let i = 0; i < 11; i++) {
    const ligne = lignes[(defilement + i) % lignes.length];
    // La ligne du bas s'efface : c'est ce qui fait lire un defilement plutot
    // qu'une liste qui saute.
    ctx.fillStyle = i === 10 ? 'rgba(141,255,200,.35)' : i === 0 ? 'rgba(84,246,255,.45)' : '#8dffc8';
    ctx.fillText(ligne, 8, 40 + i * 14);
  }
}

/**
 * Construit le poste complet.
 *
 * @param {object} options
 * @param {THREE.Camera} options.camera camera hote. Le poste s'y accroche seul
 *   et y lit son assiette ; la camera doit etre dans la scene, sinon ses
 *   enfants ne sont jamais rendus.
 * @param {THREE.WebGLRenderer} options.rendu le rendu, pour fabriquer la carte
 *   d'environnement du poste. Sans lui les pieces restent mates.
 * @param {number} options.champ champ de vision en degres AU MOMENT DU POSTE
 *   — 72 dans les mondes, 62 ailleurs. Il commande la taille de l'arche.
 *
 * @returns `definirNiveau(0|1|2)` pour la touche V, `mettreAJour` pour la
 *   boucle de vol, plus `ready` et `setVisible` pour tenir le meme contrat que
 *   l'ancien `cockpit-view.js` et se substituer a lui sans rien reecrire.
 */
export function creerPosteDePilotage({ camera = null, champ = 62, rendu = null } = {}) {
  const materiauStructure = new THREE.MeshStandardMaterial(ACIER);
  const materiauCadre = new THREE.MeshStandardMaterial(CADRE);

  const groupe = new THREE.Group();
  groupe.name = 'poste-de-pilotage';
  // Le poste est colle a l'oeil : il sort du volume teste par Three, qui le
  // ferait disparaitre a l'image sans cette declaration.
  groupe.frustumCulled = false;

  const verriere = construireVerriere(materiauStructure, champ);
  const { groupe: collimateur, echelle } = construireCollimateur();
  const { groupe: planche, ecrans, ecransConsole, manche, doublureManche, doublurePlanche, doublureConsole, gaz } = construirePlanche(materiauStructure, materiauCadre);

  // Une lampe propre au poste. Sans elle, le cockpit est noir dans l'espace :
  // il n'y a aucune lumiere ambiante a l'ombre d'une verriere, et le soleil de
  // la scene ne le touche que d'un cote.
  const lampe = new THREE.PointLight(0x9fd8ff, 1.1, 4, 1.6);
  lampe.position.set(0, .1, .2);
  groupe.add(lampe);

  habiller(groupe, environnementDuPoste(rendu));
  groupe.add(verriere, collimateur, planche);

  // Le manche quitte la planche pour se rattacher au poste. Les deux groupes
  // sont a l'origine : rien ne bouge a l'image. Mais la planche peut desormais
  // s'eteindre en entier sans emporter le manche et le bras, c'est-a-dire la
  // seule chose qui bouge encore une fois l'image posee.
  groupe.add(manche);

  const { porteur: porteurImage, pret: imagePrete, cadrer: cadrerImage, regler: reglerImage } =
    construirePanneauImage({ ...IMAGE_POSTE, nom: 'planche' });
  const { porteur: porteurVerriere, pret: verrierePrete, cadrer: cadrerVerriere, regler: reglerVerriere } =
    construirePanneauImage({ ...VERRIERE_IMAGE, nom: 'verriere' });
  groupe.add(porteurImage, porteurVerriere);
  if (camera) camera.add(groupe);

  // Entree des quatre pieces (voir PIECES plus haut). Chacune remplace sa
  // doublure a son arrivee, independamment des autres : une piece manquante
  // n'empeche pas les autres de se poser. Le siege manque a l'appel, voir
  // PIECES : il tomberait derriere l'oeil.
  const installations = [
    { nom: 'manche',  hote: manche,  doublure: doublureManche },
    { nom: 'planche', hote: planche, doublure: doublurePlanche },
    { nom: 'console', hote: planche, doublure: doublureConsole },
    { nom: 'consoleDroite', hote: planche, doublure: null }
  ];
  for (const { nom, hote, doublure } of installations) {
    chargerPiece(nom).then(gltf => {
      const modele = poserPiece(gltf.scene.clone(true), PIECES[nom]);
      habiller(modele, environnementDuPoste(rendu));
      hote.add(modele);

      // Les ecrans passent SUR la piece des qu'elle arrive. Tant qu'elle n'est
      // pas la ils restent a leur place de secours dans le poste, et si elle ne
      // vient jamais ils y restent : on ne perd pas un afficheur parce qu'un
      // fichier manque.
      placables.set(nom, modele);
      const piece = PIECES[nom];
      if (piece.ecranCode) {
        const ecran = ecransConsole[piece.ecranCode === 'systeme' ? 0 : 1];
        monterParFractions(modele, ecran, [.5, .63, .88], [-.36, 0, 0]);
      }
      if (piece.ecransVol) {
        // Valeurs relevees au panneau F2, dans le repere de la planche. Celles
        // de l'ecran VITESSE sont mesurees ; celles des deux autres en sont
        // deduites par symetrie — meme hauteur, meme profondeur, meme
        // basculement, le lateral et le pivot changes de signe.
        monterSurPiece(modele, ecrans[0], [-1.510, .677, .149], [-.360, .400, .060], 1.3373);
        monterSurPiece(modele, ecrans[1], [0, .677, .149], [-.360, 0, 0], 1.3373);
        monterSurPiece(modele, ecrans[2], [1.510, .677, .149], [-.360, -.400, -.060], 1.3373);
      }
      if (!doublure) return;
      hote.remove(doublure);
      libererBranche(doublure);
    }).catch(erreur => {
      console.warn(`[poste] piece « ${nom} » non chargee, doublure conservee`, erreur);
    });
  }

  // Tout ce qui se regle a la main, par nom. Les pieces telechargees s'y
  // ajoutent a leur arrivee. C'est ce registre que lit le panneau F2.
  const placables = new Map([
    ['manche (groupe)', manche],
    ['planche image', porteurImage],
    ['verriere image', porteurVerriere],
    ['gaz', gaz],
    ['ecran vitesse', ecrans[0]],
    ['ecran plan', ecrans[1]],
    ['ecran altitude', ecrans[2]],
    ['ecran systemes', ecransConsole[0]],
    ['ecran navigation', ecransConsole[1]]
  ]);
  const etatReglage = { panneau: null };
  const reglage = () => basculerReglage(placables, etatReglage);

  let niveau = 0;
  // Vrai des que la texture est arrivee. Tant qu'elle n'est pas la, le poste
  // 3D reste affiche : une image qui manque ne laisse jamais un cockpit vide.
  let modeImage = false;
  let horlogeEcrans = 0;
  let defilementCode = 0, ligneCode = 0;
  const barreaux = echelle.children;
  // Assiette relue a chaque image, jamais reallouee.
  const assiette = { tangage: 0, roulis: 0 };

  function definirNiveau(valeur) {
    niveau = valeur;
    groupe.visible = valeur > 0;
    // Les trois pieces que l'image remplace. Elles restent CONSTRUITES et
    // seulement eteintes : `definirImage(false)` les rallume a l'instant.
    verriere.visible = valeur >= 1 && !modeImage;
    collimateur.visible = valeur >= 1 && !modeImage;
    planche.visible = valeur >= 2 && !modeImage;
    porteurImage.visible = valeur >= 2 && modeImage;
    porteurVerriere.visible = valeur >= 1 && modeImage && VERRIERE_IMAGE.actif !== false;
    // Le manche n'est plus enfant de la planche : sans cette ligne il
    // apparaitrait au niveau 1, ou seule la verriere doit se voir.
    manche.visible = valeur >= 2;
    lampe.visible = valeur >= 1;
    return niveau;
  }
  definirNiveau(0);

  imagePrete.then(porteur => {
    if (!porteur) return;
    modeImage = true;
    definirNiveau(niveau);   // relit les visibilites avec le mode a jour
  });
  verrierePrete.then(() => definirNiveau(niveau));

  /** Bascule entre la planche en image et les pieces 3D qu'elle remplace. */
  function definirImage(actif) {
    modeImage = !!actif;
    definirNiveau(niveau);
    return modeImage;
  }

  /**
   * L'assiette n'est PAS demandee a l'appelant : elle est lue sur la camera.
   * `tangage` et `roulis` restent acceptes pour une page qui les tiendrait
   * elle-meme, mais rien n'oblige a les fournir.
   *
   * @param {object} etat
   * @param {number} [etat.tangage] assiette, en radians
   * @param {number} [etat.roulis] inclinaison, en radians
   * @param {number} etat.vitesse en m/s
   * @param {number} etat.altitude en metres
   * @param {number} etat.poussee de 0 a 1
   * @param {number} etat.avancement position sur le tour, de 0 a 1
   * @param {number} etat.commandeX position du manche, -1 a 1
   * @param {number} etat.commandeY position du manche, -1 a 1
   * @param {number} dt secondes depuis l'image precedente
   */
  function mettreAJour(etat, dt) {
    if (niveau === 0) return;

    // Avant tout le reste : la planche en image suit le champ et la forme de
    // la fenetre, qui ont pu changer depuis l'image precedente.
    if (modeImage) {
      cadrerImage(camera);
      if (VERRIERE_IMAGE.actif !== false) cadrerVerriere(camera);
    }

    if (camera) assietteDe(camera, assiette);
    const tangage = Number.isFinite(etat.tangage) ? etat.tangage : assiette.tangage;
    const roulis = Number.isFinite(etat.roulis) ? etat.roulis : assiette.roulis;

    // Echelle de tangage : chaque barreau se place a son angle, moins
    // l'assiette. Le facteur convertit des radians en metres sur le plan du
    // collimateur — la petite approximation des angles, largement valable sur
    // les 30 degres affiches.
    const parRadian = OEIL_AU_COLLIMATEUR;
    for (const barreau of barreaux) {
      const vise = barreau.userData.angle * Math.PI / 180;
      barreau.position.y = (vise - tangage) * parRadian;
      // Au-dela du cadre du collimateur, le barreau n'a plus rien a dire.
      barreau.visible = Math.abs(barreau.position.y) < .34;
    }
    echelle.rotation.z = -roulis;

    if (niveau < 2) return;

    // Manche et manette : le geste du pilote, rendu visible.
    manche.rotation.x = etat.commandeY * .22;
    manche.rotation.z = -etat.commandeX * .26;
    gaz.rotation.x = -.5 + etat.poussee * .8;

    // Les ecrans ne se redessinent que huit fois par seconde. Un televersement
    // de texture par image et par ecran couterait plus que tout le poste.
    horlogeEcrans -= dt;
    if (horlogeEcrans > 0) return;
    horlogeEcrans = .125;

    peindreCompteur(ecrans[0].userData.ctx, 'VITESSE', String(Math.round(etat.vitesse)), 'm/s');
    peindrePlan(ecrans[1].userData.ctx, etat.avancement || 0, etat.poussee);
    peindreCompteur(ecrans[2].userData.ctx, 'ALTITUDE', String(Math.round(etat.altitude)), 'metres');
    for (const ecran of ecrans) ecran.userData.texture.needsUpdate = true;

    // Le code des consoles defile d'une ligne tous les quatre rafraichissements,
    // soit deux lignes par seconde : assez pour que ca vive, assez lent pour
    // qu'on puisse lire.
    defilementCode = (defilementCode + 1) % 4;
    if (defilementCode === 0) {
      ligneCode++;
      for (const ecran of ecransConsole) {
        peindreCode(ecran.userData.ctx, ecran.userData.lignes, ecran.userData.titre, ligneCode);
        ecran.userData.texture.needsUpdate = true;
      }
    }
  }

  function dispose() {
    if (camera) camera.remove(groupe);
    libererBranche(groupe);
  }

  // F2 ouvre et referme le panneau de reglage. Placer une piece a l'aveugle
  // depuis le code coute un aller-retour par essai ; la regler en regardant
  // l'ecran ne coute rien.
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', evenement => {
      if (evenement.key !== 'F2') return;
      evenement.preventDefault();
      reglage();
    });
  }

  const api = {
    groupe, definirNiveau, mettreAJour, dispose, reglage, placables,
    definirImage,
    // Reglage a vue depuis la console :
    //   RaphaelPoste.cadrageImage({ remontee: -.18 })
    cadrageImage: reglerImage,
    // RaphaelPoste.cadrageVerriere({ opacite: .4, remontee: .05 })
    cadrageVerriere: reglerVerriere,
    niveau: () => niveau,
    image: () => modeImage,
    // Contrat repris de l'ancien `cockpit-view.js`, pour se substituer a lui
    // sans toucher au reste. `ready` est tenue d'avance : ce poste est
    // construit, pas telecharge — il n'y a rien a attendre, et c'est
    // precisement ce qui remplace un GLB de 168 ko qui pouvait manquer.
    ready: Promise.resolve(),
    setVisible(visible) { return definirNiveau(visible ? 2 : 0); }
  };

  // Reglage a vue depuis la console, comme l'ancien poste :
  // RaphaelPoste.definirNiveau(1)
  if (typeof window !== 'undefined') window.RaphaelPoste = api;
  return api;
}
