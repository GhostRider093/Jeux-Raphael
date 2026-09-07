// ==========================================================================
//  CHASSEUR  -  l'appareil, en un seul exemplaire
// --------------------------------------------------------------------------
//  Avant ce fichier, le chasseur du joueur existait en quatre assemblages
//  distincts — chasseur.js pour la ville, maps/fighter-model.js pour les
//  Mondes et les tunnels, un troisieme monte a la main dans world-game.js,
//  un quatrieme en cones et boites dans air-combat.js — et le maillage
//  lui-meme etait stocke deux fois, 38 Mo chacun, sous deux noms differents
//  pour un contenu identique. La ville ne volait donc pas le meme avion que
//  les Mondes, et personne ne pouvait le voir.
//
//  Ce fichier est le seul endroit qui sait a quoi ressemble l'appareil, ou
//  sont ses canons et ou sont ses reacteurs. Le chemin du modele n'en sort
//  pas : renommer le fichier sur le disque ne touchera aucun appelant.
//
//  ── POINTS D'ANCRAGE ────────────────────────────────────────────────────
//  L'instance porte des reperes vides et nommes. Un appelant qui veut faire
//  partir une traçante de l'aile droite n'a pas a connaitre l'envergure : il
//  demande l'ancrage et le convertit en coordonnees du monde. C'est ce qui
//  evite qu'un troisieme fichier re-mesure l'avion a sa facon.
//
//    museau         nez de l'appareil
//    canonGauche    bouche du canon d'aile gauche
//    canonDroit     bouche du canon d'aile droite
//    rampes[]       quatre points d'emport sous les ailes
//    reacteurs[]    tuyeres, animees par ce fichier
//
//  Script classique, comme flight-model.js : lisible depuis un module comme
//  depuis un script global.
//
//  Repere retenu, celui de tout le jeu : nez vers -Z, ailes sur X, haut +Y.
// ==========================================================================

(function () {
  'use strict';

  // THREE n'est une variable globale que dans la ville : les Mondes et les
  // tunnels ne l'exposent pas, ils l'importent dans leurs modules. Plutot que
  // d'exiger de chaque page qu'elle le pose sur `window` — encore une
  // dependance implicite, exactement ce qui a produit quatre chasseurs — le
  // module va le chercher par la table d'imports de la page.
  let THREE = window.THREE || null;
  async function assurerThree() {
    if (THREE) return THREE;
    THREE = await import('three');
    return THREE;
  }

  // Le maillage existe en double sur le disque sous deux noms. On ne charge
  // que celui-ci ; l'autre n'est plus reference par personne et pourra
  // disparaitre une fois la bascule verifiee en vol.
  const DOSSIER = './perso/chasseur-texture/';
  const FICHIER_OBJ = 'Meshy_AI_Avion_type_chasseur_d_0708033342_texture.obj';
  const FICHIER_TEXTURE = 'Meshy_AI_Avion_type_chasseur_d_0708033342_texture.png';
  const VERSION = 'chasseur-unique-20260907';

  // Position des ancrages, en fraction des cotes de l'appareil. Les canons
  // sont poses juste en dedans des rampes a missiles exterieures : un chasseur
  // tire de ses ailes, pas de son axe.
  const ANCRAGES = {
    canonEcart: .25,      // fraction de l'envergure, de part et d'autre de l'axe
    canonAvance: .34,     // fraction de la longueur, vers l'avant
    canonHauteur: -.06,   // fraction de la hauteur, sous l'axe
    rampeInterieure: .25, // fractions de l'envergure
    rampeExterieure: .42
  };

  let gabaritPromise = null;
  let texture = null;

  function chargerTexture() {
    if (texture) return texture;
    texture = new THREE.TextureLoader().setPath(DOSSIER).load(`${FICHIER_TEXTURE}?v=${VERSION}`);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 8;
    return texture;
  }

  function materiauParDefaut() {
    return new THREE.MeshStandardMaterial({
      map: chargerTexture(),
      color: 0x9fb3c2,
      roughness: .72,
      metalness: .08,
      side: THREE.DoubleSide
    });
  }

  /**
   * Trouve un OBJLoader, quelle que soit la page.
   *
   * La ville le pose sur `window` depuis son bloc de demarrage ; les Mondes et
   * les tunnels ne le font pas. Plutot que d'exiger de chaque page qu'elle
   * prepare le terrain — c'est exactement le genre de dependance implicite qui
   * a produit quatre chasseurs differents — le module va le chercher lui-meme.
   */
  function attendreLoader() {
    if (window.OBJLoader) return Promise.resolve(window.OBJLoader);
    return import('./libs/loaders/OBJLoader.js')
      .then(module => module.OBJLoader)
      .catch(() => new Promise(resolve => {
        window.addEventListener('objloaderready', () => resolve(window.OBJLoader), { once: true });
      }));
  }

  /**
   * Gabarit partage, charge une seule fois. Il sort deja tourne dans le repere
   * du jeu et centre sur lui-meme : les appelants n'ont plus a le redresser,
   * c'est justement la correction que chacun refaisait a sa maniere.
   */
  function chargerGabarit(onProgress) {
    if (gabaritPromise) return gabaritPromise;
    gabaritPromise = assurerThree().then(attendreLoader).then(Loader => new Loader()
      .setPath(DOSSIER)
      .loadAsync(`${FICHIER_OBJ}?v=${VERSION}`, evenement => {
        // Le modele pese 38 Mo : le vol en tunnel affiche une barre pendant
        // son telechargement, il lui faut la progression.
        if (onProgress && evenement) onProgress(evenement.loaded, evenement.total);
      })
    ).then(objet => {
      const materiau = materiauParDefaut();
      objet.traverse(noeud => {
        if (!noeud.isMesh) return;
        noeud.material = materiau;
        noeud.castShadow = true;
        noeud.receiveShadow = true;
        // Le maillage sort du champ de la camera de poursuite quand l'appareil
        // remplit l'ecran : sans cela il clignote au ras du cockpit.
        noeud.frustumCulled = false;
      });
      // Le modele est modelise nez vers -X. Un quart de tour l'aligne sur la
      // convention du jeu, nez vers -Z.
      objet.rotation.set(0, -Math.PI / 2, 0);
      objet.updateMatrixWorld(true);
      const boite = new THREE.Box3().setFromObject(objet);
      objet.position.sub(boite.getCenter(new THREE.Vector3()));
      const cellule = new THREE.Group();
      cellule.name = 'cellule';
      cellule.add(objet);
      cellule.updateMatrixWorld(true);
      const cotes = new THREE.Box3().setFromObject(cellule).getSize(new THREE.Vector3());
      cellule.userData.cotes = { envergure: cotes.x, hauteur: cotes.y, longueur: cotes.z };
      return cellule;
    }).catch(erreur => {
      gabaritPromise = null;
      throw erreur;
    });
    return gabaritPromise;
  }

  // ── REACTEURS ───────────────────────────────────────────────────────────
  // Une seule boucle pour toutes les tuyeres du jeu. Chacune lit le regime de
  // son appareil dans `userData.regime`, ecrit par la boucle de vol.
  const tuyeres = new Set();
  let boucleTuyeres = false;

  function animerTuyeres() {
    const t = performance.now() * .001;
    const vacillement = .9 + Math.sin(t * 45) * .07 + Math.sin(t * 27) * .05;
    for (const groupe of tuyeres) {
      if (!groupe.parent) { tuyeres.delete(groupe); continue; }
      const regime = Math.max(.25, Math.min(1, groupe.userData.regime ?? .45));
      groupe.children.forEach(tuyere => {
        tuyere.scale.z = (.6 + regime * .8) * vacillement;
        tuyere.scale.x = tuyere.scale.y = .9 + (vacillement - .9);
      });
    }
    if (tuyeres.size) requestAnimationFrame(animerTuyeres);
    else boucleTuyeres = false;
  }

  function fabriquerTuyere(longueur, rayon) {
    const groupe = new THREE.Group();
    groupe.add(new THREE.Mesh(
      new THREE.TorusGeometry(rayon * 1.05, rayon * .14, 10, 24),
      new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: .42, metalness: .7 })
    ));
    const cone = (r, h, couleur, opacite) => {
      const maille = new THREE.Mesh(
        new THREE.ConeGeometry(r, h, 18, 1, true),
        new THREE.MeshBasicMaterial({
          color: couleur, transparent: true, opacity: opacite,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
        })
      );
      maille.rotation.x = -Math.PI / 2;   // apex vers +Z, donc vers l'arriere
      maille.position.z = h / 2;
      return maille;
    };
    groupe.add(cone(rayon, longueur, 0xff6a10, .5));
    groupe.add(cone(rayon * .6, longueur * .78, 0xffae2e, .7));
    groupe.add(cone(rayon * .3, longueur * .5, 0xfff3b0, .95));
    return groupe;
  }

  function fabriquerMissile(longueur) {
    const groupe = new THREE.Group();
    const corps = new THREE.Mesh(
      new THREE.CylinderGeometry(longueur * .055, longueur * .055, longueur * .78, 10),
      new THREE.MeshStandardMaterial({ color: 0xd7dde3, roughness: .45, metalness: .35 })
    );
    corps.rotation.x = Math.PI / 2;
    groupe.add(corps);
    const ogive = new THREE.Mesh(
      new THREE.ConeGeometry(longueur * .055, longueur * .22, 10),
      new THREE.MeshStandardMaterial({ color: 0x8f2016, roughness: .5 })
    );
    ogive.rotation.x = -Math.PI / 2;
    ogive.position.z = -longueur * .5;
    groupe.add(ogive);
    return groupe;
  }

  function repere(nom, x, y, z) {
    const point = new THREE.Object3D();
    point.name = nom;
    point.position.set(x, y, z);
    return point;
  }

  /**
   * Fabrique un appareil complet.
   *
   * @param {object} options
   * @param {number} options.longueur longueur nez-queue voulue, en unites de
   *   monde. L'envergure vaut environ 1,03 fois cette valeur.
   * @param {boolean} options.reacteurs pose les tuyeres et leur animation.
   * @param {boolean} options.missiles pose les quatre rampes sous les ailes.
   * @param {THREE.Material} options.materiau remplace la finition texturee.
   * @param {function} options.onProgress recoit (octets recus, octets totaux)
   *   pendant le premier chargement du modele, et lui seul.
   * @returns {Promise<THREE.Group>} l'appareil, ancrages compris.
   */
  async function construire({ longueur = 5, reacteurs = true, missiles = false, materiau = null, onProgress = null } = {}) {
    const gabarit = await chargerGabarit(onProgress);
    const cellule = gabarit.clone(true);
    if (materiau) cellule.traverse(noeud => { if (noeud.isMesh) noeud.material = materiau; });

    // Mise a l'echelle sur la longueur nez-queue et non sur la plus grande
    // dimension : sur cet appareil la plus grande dimension est l'envergure,
    // et « longueur » ne voudrait alors rien dire.
    const brut = gabarit.userData.cotes;
    const echelle = longueur / brut.longueur;
    const cotes = {
      longueur,
      envergure: brut.envergure * echelle,
      hauteur: brut.hauteur * echelle
    };

    const appareil = new THREE.Group();
    appareil.name = 'chasseur';
    cellule.scale.setScalar(echelle);
    appareil.add(cellule);

    const arriere = cotes.longueur * .5;
    const museau = repere('museau', 0, 0, -arriere);
    const ecart = cotes.envergure * ANCRAGES.canonEcart;
    const avance = -cotes.longueur * ANCRAGES.canonAvance;
    const hauteurCanon = cotes.hauteur * ANCRAGES.canonHauteur;
    const canonGauche = repere('canon-gauche', -ecart, hauteurCanon, avance);
    const canonDroit = repere('canon-droit', ecart, hauteurCanon, avance);
    appareil.add(museau, canonGauche, canonDroit);

    const rampes = [];
    if (missiles) {
      const longueurMissile = cotes.longueur * .28;
      const hauteurRampe = -cotes.hauteur * .42;
      [-ANCRAGES.rampeExterieure, -ANCRAGES.rampeInterieure,
        ANCRAGES.rampeInterieure, ANCRAGES.rampeExterieure].forEach((fraction, index) => {
        const rampe = fabriquerMissile(longueurMissile);
        rampe.name = `rampe-${index + 1}`;
        rampe.position.set(cotes.envergure * fraction, hauteurRampe, index % 2 ? -cotes.longueur * .04 : cotes.longueur * .06);
        appareil.add(rampe);
        rampes.push(rampe);
      });
    }

    const tuyeresPosees = [];
    if (reacteurs) {
      const groupe = new THREE.Group();
      groupe.name = 'reacteurs';
      const longueurTuyere = cotes.longueur * .2;
      const rayon = Math.max(.06, cotes.envergure * .04);
      const ecartement = cotes.envergure * .15;
      const hauteur = -cotes.hauteur * .05;
      [-ecartement, ecartement].forEach(dx => {
        const tuyere = fabriquerTuyere(longueurTuyere, rayon);
        tuyere.position.set(dx, hauteur, arriere - cotes.longueur * .005);
        groupe.add(tuyere);
        tuyeresPosees.push(tuyere);
      });
      appareil.add(groupe);
      groupe.userData.regime = .45;
      tuyeres.add(groupe);
      if (!boucleTuyeres) { boucleTuyeres = true; requestAnimationFrame(animerTuyeres); }
      appareil.userData.reacteurs = groupe;
    }

    appareil.userData.cotes = cotes;
    appareil.userData.ancrages = { museau, canonGauche, canonDroit, rampes, tuyeres: tuyeresPosees };
    // Les modules de combat existants animent `flames` : la cle doit exister.
    appareil.userData.flames = tuyeresPosees;
    appareil.userData.missileRacks = rampes;
    return appareil;
  }

  /**
   * Regime des reacteurs, de 0 a 1. Appele par la boucle de vol : c'est la
   * seule chose que ce fichier ne peut pas deviner tout seul.
   */
  function regime(appareil, valeur) {
    const groupe = appareil?.userData?.reacteurs;
    if (groupe) groupe.userData.regime = valeur;
  }

  /**
   * Position d'un ancrage dans le repere du monde, ecrite dans `cible` pour ne
   * rien allouer dans une boucle de tir.
   */
  function ancrageMonde(appareil, nom, cible) {
    const ancrages = appareil?.userData?.ancrages;
    const point = ancrages && (ancrages[nom] || null);
    if (!point) return cible.set(0, 0, 0);
    return point.getWorldPosition(cible);
  }

  window.RaphaelChasseur = { construire, chargerGabarit, regime, ancrageMonde, ANCRAGES };
})();
