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

  // ── LE PIEGE DES DEUX COPIES ────────────────────────────────────────────
  // Le maillage existe en double sur le disque. Les deux fichiers ont la meme
  // geometrie — 196 743 sommets, meme boite, memes UV — mais celui du dossier
  // « chasseur-texture » contient DEUX lignes `l` en fin de fichier, deux
  // aretes isolees oubliees a l'export.
  //
  // Cela suffit a tout casser : des qu'OBJLoader rencontre un `l`, il bascule
  // l'objet courant en type « Line » et jette ses 393 725 faces. L'appareil
  // n'etait donc pas un maillage mais un nuage de segments, dessine en blanc,
  // sans ombrage et sans texture possible. C'est la « bouillie blanche » de la
  // ville : un defaut de chargement, pas un mauvais modele.
  //
  // On charge donc la copie propre pour la geometrie, et la texture reste dans
  // le dossier de l'autre. Ne pas « simplifier » en revenant a un seul chemin
  // sans avoir verifie que le fichier ne contient aucune ligne `l`.
  const DOSSIER = './perso/';
  const FICHIER_OBJ = 'chasseur.obj';
  const DOSSIER_TEXTURE = './perso/chasseur-texture/';
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
    texture = new THREE.TextureLoader().setPath(DOSSIER_TEXTURE).load(`${FICHIER_TEXTURE}?v=${VERSION}`);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    else texture.encoding = THREE.sRGBEncoding;
    texture.anisotropy = 8;
    return texture;
  }

  /**
    * Finition texturee. `teinte` multiplie la texture : c'est ce qui permet
    * d'assombrir l'appareil sans perdre ses panneaux, ses rivets et ses
    * marquages. Une matiere unie, elle, les efface tous.
    */
  function materiauParDefaut(teinte) {
    return new THREE.MeshStandardMaterial({
      map: chargerTexture(),
      color: teinte ?? 0x9fb3c2,
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
      const materiau = materiauParDefaut();   // teinte reglee par instance
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
  let dernierTemps = performance.now();

  // -- EFFETS DE JET -------------------------------------------------------
  // Lampe et etincelles. Poses uniquement sur l'appareil du joueur, par
  // l'option `effets` : une lampe par tuyere sur les dix ennemis en patrouille
  // ferait vingt lumieres dynamiques dans la scene, et le shader s'effondre.

  // Sprite rond des etincelles, peint une fois dans un canvas : l'effet ne
  // depend ainsi d'aucun fichier a telecharger.
  let spriteEtincelle = null;
  function textureEtincelle() {
    if (spriteEtincelle) return spriteEtincelle;
    const toile = document.createElement('canvas');
    toile.width = toile.height = 64;
    const pinceau = toile.getContext('2d');
    const degrade = pinceau.createRadialGradient(32, 32, 0, 32, 32, 32);
    degrade.addColorStop(0, 'rgba(255,255,255,1)');
    degrade.addColorStop(.35, 'rgba(255,201,110,.85)');
    degrade.addColorStop(1, 'rgba(255,120,20,0)');
    pinceau.fillStyle = degrade;
    pinceau.fillRect(0, 0, 64, 64);
    spriteEtincelle = new THREE.CanvasTexture(toile);
    return spriteEtincelle;
  }

  // Bruit nuageux, peint une fois et raccorde sur ses bords : c'est lui qui
  // casse l'aplat. Sans texture, un cone additif reste un cone — de pres on
  // voit le polygone et la coupure nette a la bouche.
  let bruitPlume = null;
  function textureBruit() {
    if (bruitPlume) return bruitPlume;
    const N = 128;
    const toile = document.createElement('canvas');
    toile.width = toile.height = N;
    const p = toile.getContext('2d');
    p.fillStyle = '#202020';
    p.fillRect(0, 0, N, N);
    p.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * N, y = Math.random() * N;
      const r = 6 + Math.random() * 26;
      const force = .25 + Math.random() * .55;
      // Neuf fois, decale d'une tuile : les taches qui debordent reviennent de
      // l'autre cote, et la texture se raccorde sans couture visible.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const g = p.createRadialGradient(x + dx * N, y + dy * N, 0, x + dx * N, y + dy * N, r);
          g.addColorStop(0, `rgba(255,255,255,${force})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          p.fillStyle = g;
          p.beginPath();
          p.arc(x + dx * N, y + dy * N, r, 0, Math.PI * 2);
          p.fill();
        }
      }
    }
    bruitPlume = new THREE.CanvasTexture(toile);
    bruitPlume.wrapS = bruitPlume.wrapT = THREE.RepeatWrapping;
    return bruitPlume;
  }

  // Deux matieres pour toutes les tuyeres du jeu : meme texture, deux vitesses
  // de defilement. La couleur et l'extinction sont peintes dans les sommets,
  // donc une seule matiere suffit pour les trois couches du jet.
  let plumeLente = null, plumeRapide = null;
  function matieresPlume() {
    if (plumeLente) return;
    const faire = (repeatY) => {
      const carte = textureBruit().clone();
      carte.needsUpdate = true;
      carte.wrapS = carte.wrapT = THREE.RepeatWrapping;
      carte.repeat.set(2, repeatY);
      return new THREE.MeshBasicMaterial({
        map: carte, vertexColors: true, color: 0xffffff,
        transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide
      });
    };
    plumeLente = faire(1.4);
    plumeRapide = faire(2.2);
  }

  function defilerPlume(t) {
    if (!plumeLente) return;
    // Vers -Y : la texture remonte du cote de la bouche vers la pointe, donc
    // le jet a l'air de fuir vers l'arriere.
    plumeLente.map.offset.y = (-t * 1.15) % 1;
    plumeRapide.map.offset.y = (-t * 2.45) % 1;
  }

  const ETINCELLES = 110;

  /**
   * Lampe + trainee d'etincelles pour une tuyere. L'effet est pose a cote du
   * groupe `reacteurs` et non dedans : ce groupe est mis a l'echelle a chaque
   * image pour faire respirer les cones, et la lampe serait etiree avec.
   */
  function fabriquerEffets(longueur, rayon) {
    const effet = new THREE.Group();
    effet.name = 'reacteur-effets';

    const lampe = new THREE.PointLight(0xff8c3a, 1, rayon * 20, 2);
    lampe.position.z = longueur * .35;
    effet.add(lampe);

    const graineX = new Float32Array(ETINCELLES);
    const graineY = new Float32Array(ETINCELLES);
    const ages = new Float32Array(ETINCELLES);
    const vies = new Float32Array(ETINCELLES);
    for (let i = 0; i < ETINCELLES; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.sqrt(Math.random()) * rayon * .5;
      graineX[i] = Math.cos(angle) * distance;
      graineY[i] = Math.sin(angle) * distance;
      ages[i] = Math.random();          // desynchronise : la trainee est pleine des la premiere image
      vies[i] = .35 + Math.random() * .45;
    }
    const geometrie = new THREE.BufferGeometry();
    geometrie.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ETINCELLES * 3), 3));
    const nuage = new THREE.Points(geometrie, new THREE.PointsMaterial({
      map: textureEtincelle(),
      size: rayon * 1.4,
      sizeAttenuation: true,
      color: 0xffb257,
      transparent: true,
      opacity: .85,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    nuage.frustumCulled = false;        // les points sortent de leur boite d'origine
    effet.add(nuage);

    // Disque de bouche : un panneau toujours face camera, donc sans silhouette.
    // C'est le point chaud que l'oeil cherche quand on regarde une tuyere de pres.
    const bouche = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textureEtincelle(), color: 0xffd9a8,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    bouche.scale.setScalar(rayon * 3);
    effet.add(bouche);

    // Diamants de choc : les noeuds brillants alignes dans le jet. C'est le
    // detail qui distingue une postcombustion d'un cone orange.
    const diamants = [];
    [.16, .30, .46, .64].forEach(part => {
      const d = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textureEtincelle(), color: 0xdff0ff,
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      d.userData.part = part;
      d.visible = false;
      effet.add(d);
      diamants.push(d);
    });

    effet.userData = { lampe, nuage, graineX, graineY, ages, vies, longueur, rayon, bouche, diamants };
    return effet;
  }

  function animerEffets(liste, regime, postcombustion, vacillement, dt) {
    for (const effet of liste) {
      const { lampe, nuage, graineX, graineY, ages, vies, longueur, rayon, bouche, diamants } = effet.userData;

      // Eclairage physique (three r158) : l'intensite suit le carre de la
      // portee, sans quoi le meme reglage eblouit l'avion de la ville et reste
      // invisible sur celui des Mondes, trois fois plus grand.
      const portee = rayon * (14 + regime * 18);
      lampe.distance = portee;
      lampe.intensity = portee * portee * (.05 + regime * .06 + postcombustion * .09) * vacillement;
      lampe.color.setHex(postcombustion > .3 ? 0xffd9a0 : 0xff8c3a);

      const allonge = longueur * (1.5 + regime * 2.2);
      const tableau = nuage.geometry.attributes.position.array;
      for (let i = 0; i < ETINCELLES; i++) {
        ages[i] += dt / vies[i];
        if (ages[i] >= 1) {             // l'etincelle s'eteint : elle renait dans la buse
          ages[i] -= 1;
          vies[i] = .35 + Math.random() * .45;
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.sqrt(Math.random()) * rayon * .5;
          graineX[i] = Math.cos(angle) * distance;
          graineY[i] = Math.sin(angle) * distance;
        }
        const age = ages[i];
        const evasement = 1 + age * 1.8;   // le jet s'ouvre en s'eloignant
        tableau[i * 3] = graineX[i] * evasement;
        tableau[i * 3 + 1] = graineY[i] * evasement;
        tableau[i * 3 + 2] = age * allonge;
      }
      nuage.geometry.attributes.position.needsUpdate = true;
      nuage.material.opacity = (.35 + regime * .5) * vacillement;
      nuage.material.size = rayon * (1.2 + postcombustion * .9);

      bouche.scale.setScalar(rayon * (2.4 + regime * 1.6) * vacillement);
      bouche.material.opacity = .55 + regime * .45;

      // Les diamants ne sortent qu'en postcombustion, et se resserrent vers la
      // bouche quand la poussee monte.
      for (const d of diamants) {
        d.visible = postcombustion > .02;
        if (!d.visible) continue;
        d.position.z = allonge * d.userData.part * (1 - postcombustion * .18);
        const pulse = .85 + Math.sin(d.userData.part * 30 + vacillement * 9) * .15;
        d.scale.setScalar(rayon * (1.5 - d.userData.part) * postcombustion * 2.2 * pulse);
        d.material.opacity = postcombustion * (1 - d.userData.part * .6);
      }
    }
  }

  function animerTuyeres() {
    const maintenant = performance.now();
    const dt = Math.min(.05, (maintenant - dernierTemps) * .001);   // borne : un retour d'onglet ne teleporte pas la trainee
    dernierTemps = maintenant;
    const t = maintenant * .001;
    const vacillement = .9 + Math.sin(t * 45) * .07 + Math.sin(t * 27) * .05;
    defilerPlume(t);                  // une seule matiere partagee : un appel suffit
    for (const groupe of tuyeres) {
      if (!groupe.parent) { tuyeres.delete(groupe); continue; }
      const regime = Math.max(.25, Math.min(1, groupe.userData.regime ?? .45));
      // Au-dela de 80% de regime, la postcombustion : le jet blanchit et s'allonge.
      const postcombustion = Math.max(0, (regime - .8) / .2);
      groupe.children.forEach(tuyere => {
        tuyere.scale.z = (.6 + regime * .8) * vacillement;
        tuyere.scale.x = tuyere.scale.y = .9 + (vacillement - .9);
      });
      if (groupe.userData.effets) animerEffets(groupe.userData.effets, regime, postcombustion, vacillement, dt);
    }
    if (tuyeres.size) requestAnimationFrame(animerTuyeres);
    else boucleTuyeres = false;
  }

  function fabriquerTuyere(longueur, rayon) {
    matieresPlume();
    const groupe = new THREE.Group();
    groupe.add(new THREE.Mesh(
      new THREE.TorusGeometry(rayon * 1.05, rayon * .14, 10, 24),
      new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: .42, metalness: .7 })
    ));
    const cone = (r, h, couleur, intensite, matiere) => {
      const geometrie = new THREE.ConeGeometry(r, h, 28, 1, true);
      // Couleur ET extinction peintes dans les sommets. En melange additif le
      // noir n'ajoute rien : un degrade vers le noir eteint la pointe sans
      // aucun canal alpha, et la silhouette du cone disparait.
      const pos = geometrie.attributes.position;
      const teintes = new Float32Array(pos.count * 3);
      const c = new THREE.Color(couleur);
      for (let i = 0; i < pos.count; i++) {
        const versLaPointe = (pos.getY(i) + h / 2) / h;   // 0 a la bouche, 1 a la pointe
        const f = Math.pow(1 - versLaPointe, 1.7) * intensite;
        teintes[i * 3] = c.r * f;
        teintes[i * 3 + 1] = c.g * f;
        teintes[i * 3 + 2] = c.b * f;
      }
      geometrie.setAttribute('color', new THREE.BufferAttribute(teintes, 3));
      const maille = new THREE.Mesh(geometrie, matiere);
      maille.rotation.x = -Math.PI / 2;   // apex vers +Z, donc vers l'arriere
      maille.position.z = h / 2;
      return maille;
    };
    groupe.add(cone(rayon, longueur, 0xff6a10, 1.1, plumeLente));
    groupe.add(cone(rayon * .6, longueur * .78, 0xffae2e, 1.5, plumeRapide));
    groupe.add(cone(rayon * .3, longueur * .5, 0xfff3b0, 2.0, plumeRapide));
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
   * @param {boolean} options.effets ajoute la lampe de jet et les etincelles.
   *   Reserve a l'appareil du joueur : c'est une lumiere dynamique par tuyere.
   * @param {boolean} options.missiles pose les quatre rampes sous les ailes.
   * @param {THREE.Material} options.materiau remplace la finition texturee.
   * @param {number} options.teinte couleur multipliant la texture, pour
   *   assombrir ou colorer l'appareil sans effacer ses marquages.
   * @param {function} options.onProgress recoit (octets recus, octets totaux)
   *   pendant le premier chargement du modele, et lui seul.
   * @returns {Promise<THREE.Group>} l'appareil, ancrages compris.
   */
  async function construire({ longueur = 5, reacteurs = true, effets = false, missiles = false, materiau = null, teinte = null, onProgress = null } = {}) {
    const gabarit = await chargerGabarit(onProgress);
    const cellule = gabarit.clone(true);
    // Une matiere fournie remplace tout ; sinon on garde la texture et on ne
    // change que sa teinte. Chaque instance a la sienne, d'ou la copie.
    const matiere = materiau || materiauParDefaut(teinte);
    cellule.traverse(noeud => { if (noeud.isMesh) noeud.material = matiere; });

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
      const effetsPoses = [];
      [-ecartement, ecartement].forEach(dx => {
        const tuyere = fabriquerTuyere(longueurTuyere, rayon);
        tuyere.position.set(dx, hauteur, arriere - cotes.longueur * .005);
        groupe.add(tuyere);
        tuyeresPosees.push(tuyere);
        if (effets) {
          const effet = fabriquerEffets(longueurTuyere, rayon);
          effet.position.copy(tuyere.position);
          appareil.add(effet);           // frere du groupe, donc hors de sa mise a l'echelle
          effetsPoses.push(effet);
        }
      });
      appareil.add(groupe);
      groupe.userData.regime = .45;
      if (effetsPoses.length) groupe.userData.effets = effetsPoses;
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
