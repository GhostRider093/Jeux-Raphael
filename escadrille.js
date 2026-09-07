// ══════════════════════════════════════════════════════════════════════════
//  ESCADRILLE — les ailiers du joueur
// --------------------------------------------------------------------------
//  Des chasseurs amis qui volent avec toi. Ce fichier ne connait que le vol en
//  formation ; l'engagement et le tir viendront s'y greffer.
//
//  Il ne cree ni scene, ni joueur, ni modele : `air-combat.js` lui passe une
//  arene (voir `attacher`). Un seul appareil est defini dans le jeu, un seul
//  radar, un seul HUD — l'ailier doit s'y ranger, pas en ouvrir un deuxieme.
//
//  TROIS POINTS QUI FONT LA DIFFERENCE entre un ailier credible et un drone
//  colle au joueur. Ils sont la raison d'etre de la moitie du code ci-dessous.
//
//   1. Le creneau se calcule sur un cap LISSE, jamais sur le cap instantane du
//      joueur. Dans un virage serre, le creneau brut balaye l'espace a une
//      vitesse que l'ailier ne peut pas suivre : il tremble, part en biais, et
//      donne l'impression d'un objet accroche par un elastique.
//   2. Sous quelques metres d'ecart, on ne corrige plus. Une correction qui ne
//      s'arrete jamais vibre autour de sa cible.
//   3. L'ailier doit pouvoir voler PLUS VITE que le joueur. Un ailier plafonne
//      a la vitesse du joueur ne rattrape aucun retard : il decroche a la
//      premiere accélération et ne revient jamais.
//
//  Aucune allocation dans la boucle : tous les vecteurs de travail sont crees
//  une fois, en tete de fichier, et reutilises.
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const CFG = {
    nombre: 2,
    // Le creneau, dans le repere du joueur : de cote, un peu plus bas, en
    // arriere. L'echelon decale evite que l'ailier bouche la vue et le place
    // la ou un ailier se tient vraiment.
    lateral: 30, vertical: -6, recul: 26,
    capLissage: 2.1,        // vitesse de rattrapage du cap lisse (plus haut = plus nerveux)
    gainRattrapage: 1.35,   // energie mise a refermer l'ecart au creneau
    reactivite: 2.6,        // inertie de l'appareil : lissage de sa vitesse
    zoneMorte: 4,           // en dessous, l'ecart est considere comme nul (point 2)
    margeVitesse: 1.9,      // l'ailier peut voler 1.9x la vitesse du joueur (point 3)
    vitesseMin: 48, vitesseMax: 260,
    distanceSecurite: 22,   // en deca, l'ailier s'ecarte du joueur
    gardeSol: 26,
    reapparition: 15
  };

  const allies = [];
  let arene = null;

  // ── Vecteurs de travail, alloues une fois ───────────────────────────────
  let avant, droite, haut, capLisse, creneau, ecart, vitesseVoulue, appui, regard;
  let positionPrecedente = null, vitesseJoueur = 0, pret = false;

  function preparerVecteurs(THREE) {
    if (pret) return;
    avant = new THREE.Vector3(0, 0, -1);
    droite = new THREE.Vector3(1, 0, 0);
    haut = new THREE.Vector3(0, 1, 0);
    capLisse = new THREE.Vector3(0, 0, -1);
    creneau = new THREE.Vector3();
    ecart = new THREE.Vector3();
    vitesseVoulue = new THREE.Vector3();
    appui = new THREE.Vector3();
    regard = new THREE.Vector3();
    pret = true;
  }

  /**
   * Branchement depuis `air-combat.js`. L'arene porte tout ce que l'escadrille
   * n'a pas a redefinir : la scene, le joueur, la liste ou publier les ailiers,
   * et les fonctions deja ecrites (cap d'un appareil, hauteur du terrain,
   * fabrication d'un chasseur).
   */
  function attacher(nouvelleArene) {
    arene = nouvelleArene;
    preparerVecteurs(arene.THREE);
    for (let i = allies.length; i < CFG.nombre; i++) faireApparaitre(i);
  }

  /**
   * Le creneau du ieme ailier : alternativement a droite et a gauche, et de
   * plus en plus en arriere a mesure que l'escadrille s'allonge.
   */
  function creneauDe(index) {
    const cote = index % 2 === 0 ? 1 : -1;
    const rang = Math.floor(index / 2) + 1;
    return {
      lateral: CFG.lateral * rang * cote,
      vertical: CFG.vertical * rang,
      recul: CFG.recul * rang
    };
  }

  function faireApparaitre(index) {
    const THREE = arene.THREE;
    // Livree alliee : bleu clair. L'ennemi est rouge et noir, le contraste doit
    // se lire en une fraction de seconde, de loin et de dos.
    const mesh = arene.makeFighter(0x4fa8ff);
    mesh.name = `ailier-${index}`;
    const place = creneauDe(index);
    mesh.position.copy(arene.player.position)
      .add(new THREE.Vector3(place.lateral, place.vertical, place.recul));
    arene.scene.add(mesh);

    const ailier = {
      mesh,
      vel: new THREE.Vector3(),
      creneau: place,
      etat: 'FORMATION',
      sante: 100,
      mort: false,
      reapparition: 0,
      roulis: 0
    };
    allies.push(ailier);
    arene.allies.push(ailier);
    return ailier;
  }

  /**
   * Vitesse du joueur, mesuree sur son deplacement reel plutot que lue dans une
   * variable de la page : la ville et la vallee ne nomment pas leur vitesse de
   * la meme maniere, et un ailier ne doit pas dependre de ce detail.
   */
  function mesurerVitesseJoueur(dt) {
    const position = arene.player.position;
    if (!positionPrecedente) {
      positionPrecedente = position.clone();
      return;
    }
    const parcouru = positionPrecedente.distanceTo(position);
    positionPrecedente.copy(position);
    if (dt <= 0) return;
    // Lissage : une image longue ne doit pas faire croire a un coup de frein.
    vitesseJoueur += (parcouru / dt - vitesseJoueur) * Math.min(1, dt * 3.5);
  }

  /** Le cap lisse du joueur — le point 1 de l'en-tete. */
  function suivreCap(dt) {
    const instantane = arene.forwardOf(arene.player);
    capLisse.lerp(instantane, Math.min(1, dt * CFG.capLissage));
    if (capLisse.lengthSq() < 1e-4) capLisse.copy(instantane);
    capLisse.normalize();
    avant.copy(capLisse);
    droite.crossVectors(avant, haut).normalize();
    if (droite.lengthSq() < 1e-4) droite.set(1, 0, 0);
  }

  function volerEnFormation(ailier, dt) {
    // Ou l'ailier devrait etre, maintenant.
    creneau.copy(arene.player.position)
      .addScaledVector(droite, ailier.creneau.lateral)
      .addScaledVector(haut, ailier.creneau.vertical)
      .addScaledVector(avant, -ailier.creneau.recul);

    const solCreneau = arene.terrainY(creneau.x, creneau.z) + CFG.gardeSol;
    if (creneau.y < solCreneau) creneau.y = solCreneau;

    ecart.copy(creneau).sub(ailier.mesh.position);
    const distance = ecart.length();

    // Point 2 : sous la zone morte, plus aucune correction de position. On se
    // contente de voler dans l'axe, a la vitesse du joueur.
    const correction = distance < CFG.zoneMorte ? 0 : CFG.gainRattrapage;

    const plafond = Math.min(
      CFG.vitesseMax,
      Math.max(CFG.vitesseMin, vitesseJoueur * CFG.margeVitesse)
    );

    // Vitesse voulue = suivre le cap a la vitesse du joueur, plus ce qu'il faut
    // pour refermer l'ecart. Les deux termes se composent : l'ailier ne fonce
    // pas sur un point, il vole dans la meme direction en se recalant.
    vitesseVoulue.copy(avant).multiplyScalar(Math.max(vitesseJoueur, CFG.vitesseMin));
    if (correction > 0) vitesseVoulue.addScaledVector(ecart, correction);

    // Anti-collision : personne ne traverse le joueur. L'ailier est pousse vers
    // l'exterieur de son propre cote, jamais vers le centre.
    appui.copy(ailier.mesh.position).sub(arene.player.position);
    const separation = appui.length();
    if (separation < CFG.distanceSecurite && separation > 1e-3) {
      appui.divideScalar(separation);
      vitesseVoulue.addScaledVector(appui, (CFG.distanceSecurite - separation) * 9);
    }

    if (vitesseVoulue.length() > plafond) vitesseVoulue.setLength(plafond);

    // Garde au sol : un ailier qui laboure le terrain n'est pas un ailier.
    const sol = arene.terrainY(ailier.mesh.position.x, ailier.mesh.position.z);
    if (ailier.mesh.position.y - sol < CFG.gardeSol) {
      vitesseVoulue.y = Math.max(vitesseVoulue.y, plafond * .35);
    }

    ailier.vel.lerp(vitesseVoulue, Math.min(1, dt * CFG.reactivite));
    ailier.mesh.position.addScaledVector(ailier.vel, dt);

    // Orientation : le nez dans l'axe de vol, et le roulis pris dans le virage.
    // Sans roulis, l'ailier glisse de cote comme un curseur.
    regard.copy(ailier.mesh.position).add(ailier.vel);
    ailier.mesh.lookAt(regard);
    const viree = droite.dot(ailier.vel) / Math.max(1, plafond);
    ailier.roulis += (-viree * 1.15 - ailier.roulis) * Math.min(1, dt * 3.2);
    ailier.mesh.rotateZ(ailier.roulis);
  }

  function update(dt) {
    if (!arene || !pret || dt <= 0) return;
    mesurerVitesseJoueur(dt);
    suivreCap(dt);
    for (const ailier of allies) {
      if (ailier.mort) {
        ailier.reapparition -= dt;
        if (ailier.reapparition <= 0) remettreEnLigne(ailier);
        continue;
      }
      volerEnFormation(ailier, dt);
    }
  }

  /** Un ailier abattu revient au creneau, pas a un point fixe de la carte. */
  function remettreEnLigne(ailier) {
    ailier.mort = false;
    ailier.sante = 100;
    ailier.vel.set(0, 0, 0);
    ailier.mesh.position.copy(arene.player.position)
      .addScaledVector(droite, ailier.creneau.lateral)
      .addScaledVector(haut, ailier.creneau.vertical)
      .addScaledVector(avant, -ailier.creneau.recul);
    arene.scene.add(ailier.mesh);
  }

  function abattre(ailier) {
    if (ailier.mort) return;
    ailier.mort = true;
    ailier.reapparition = CFG.reapparition;
    arene.scene.remove(ailier.mesh);
  }

  function enVol() {
    let compte = 0;
    for (const ailier of allies) if (!ailier.mort) compte++;
    return compte;
  }

  window.RaphaelEscadrille = {
    CFG, allies, attacher, update, abattre, enVol,
    diagnostics: () => ({
      attachee: !!arene,
      ailiers: allies.length,
      enVol: enVol(),
      vitesseJoueur: Math.round(vitesseJoueur),
      ecarts: allies.map(a => a.mort ? -1 : Math.round(a.mesh.position.distanceTo(arene.player.position)))
    })
  };
})();
