// ==========================================================================
//  MODELE DE VOL  -  comportement unique de l'appareil
// --------------------------------------------------------------------------
//  La ville (rzphzel.js) et les Mondes (maps/world-game.js) avaient chacun
//  leur propre loi de pilotage, ecrite deux fois avec des valeurs differentes :
//  le meme stick ne donnait pas le meme avion selon la page. Ce fichier est
//  desormais la seule source de verite. Les valeurs retenues sont celles des
//  Mondes, validees en vol le 07/09/2026.
//
//  Ce qui est ICI est le comportement de l'appareil : il doit etre identique
//  partout. Ce qui reste chez l'appelant est la taille du terrain — vitesses
//  de croisiere, plafond, limites du monde, poussee verticale. Un monde plus
//  petit ne change pas la facon dont l'avion repond, seulement la place dont
//  il dispose.
//
//  Script classique, comme combat.js ou chasseur.js : il s'expose sur
//  `window.RaphaelFlightModel` et se lit donc aussi bien depuis un module
//  (les Mondes) que depuis un script global (la ville).
//
//  Aucune fonction n'alloue : toutes sont appelables depuis la boucle de vol.
// ==========================================================================

(function () {
  'use strict';

  const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

  const TUNING = {
    // Taux de rotation, en radians par seconde.
    yawRate: 1.55,
    pitchRate: 1.15,            // adouci : 1,5 etait trop vif
    // Debattement du nez, en radians. 1,38 vaut environ 79 degres, a la montee
    // comme au pique : l'appareil peut vraiment cabrer. La ville plafonnait a
    // 0,5 rad (29 degres), ce qui donnait un avion qui refusait de monter.
    pitchLimit: 1.38,
    // Inclinaison visuelle du nez : elle suit la pente reelle de la
    // trajectoire, pas la commande. Un avion qui monte a la verticale doit
    // avoir le nez a la verticale, meme si le stick est deja revenu au neutre.
    visualPitchLimit: 1.4,
    visualPitchResponse: 11,
    // Roulis d'accompagnement du virage. Purement visuel : il ne participe pas
    // au calcul de la trajectoire.
    bank: .45,
    // Constante de temps de la mise en vitesse.
    speedResponse: 4.4,
    // Poussee verticale directe (touche montee/descente), exprimee en multiple
    // de la vitesse de croisiere du monde. En valeur absolue elle serait fausse
    // partout : 95 unites par seconde traversent en une seconde et demie un
    // ciel qui en fait 143. C'est le rapport qui fait le comportement.
    climbRatio: 2.5,
    // Duree des figures, en secondes.
    rollDuration: 1.05,
    loopDuration: 1.55,
    // Deflexion minimale pour declencher une figure, et seuil de rearmement.
    acroTrigger: .55,
    acroRearm: .28
  };

  // ── CRAN DE POURSUITE ───────────────────────────────────────────────────
  // Les chasseurs ennemis de la ville volent entre 72 et 90 unites par seconde
  // et apparaissent a 230-400 unites ; l'appareil du joueur plafonnait a 72,
  // 90 avec le boost. La poursuite etait donc perdue d'avance : on ne pouvait
  // structurellement rattraper personne.
  //
  // Le cran de poursuite est une manette des gaz au clavier : + le monte, - le
  // descend, et il se garde entre deux images. On le pousse une fois et on
  // pilote, au lieu de tenir une touche pendant toute la chasse.
  const CHASE = {
    min: 1,
    // Crans par seconde de touche maintenue. La consigne ne bouge pas : trois
    // secondes du ralenti a la pleine poursuite, quel que soit le plafond. La
    // cadence suit donc la course a chaque fois qu'on l'allonge.
    rate: 1,
    // Plafond par niveau — c'est ici que la difficulte evoluera. Porte a 4 le
    // 08/09/2026 : en debutant on approche 288 unites par seconde contre 90 a
    // l'ennemi. Les autres niveaux suivent le meme rapport, pour que l'echelle
    // garde sa forme.
    levels: { debutant: 4, confirme: 3.2, expert: 2.6 },
    level: 'debutant'
  };

  function chaseCeiling() {
    return CHASE.levels[CHASE.level] ?? CHASE.levels.debutant;
  }

  /** Cran de poursuite apres une image. `up` et `down` sont les touches + et -. */
  function advanceChase(notch, up, down, dt) {
    const direction = (up ? 1 : 0) - (down ? 1 : 0);
    const next = direction ? notch + direction * CHASE.rate * dt : notch;
    return clamp(next, CHASE.min, chaseCeiling());
  }

  /**
   * Les touches + et - existent en trois exemplaires sur un clavier francais :
   * pave numerique, rangee du haut, et la version non modifiee. On les accepte
   * toutes plutot que d'imposer la bonne.
   */
  function chaseKeys(keys) {
    return {
      up: !!(keys.NumpadAdd || keys.Equal || keys.BracketRight),
      down: !!(keys.NumpadSubtract || keys.Minus || keys.Slash)
    };
  }

  /**
   * Facteur de lissage independant de la frequence d'images.
   *
   * `valeur += (cible - valeur) * dt * k` change de resultat avec le nombre
   * d'images par seconde. `1 - exp(-k * dt)` est la forme exacte : la constante
   * de temps vaut 1/k seconde quel que soit le rythme d'affichage. C'est la
   * difference entre un avion qui repond pareil sur toutes les machines et un
   * avion qui mollit des que la scene se charge.
   */
  function smoothing(rate, dt) {
    return 1 - Math.exp(-rate * dt);
  }

  /** Cap, en radians. Croissant vers la gauche, comme le repere de la scene. */
  function advanceYaw(yaw, yawInput, dt, rateScale) {
    const scale = Number.isFinite(rateScale) ? rateScale : 1;
    return yaw + clamp(yawInput, -1, 1) * TUNING.yawRate * scale * dt;
  }

  /** Assiette commandee, bornee au debattement du nez. */
  function advancePitch(pitch, pitchInput, dt) {
    const next = pitch + clamp(pitchInput, -1, 1) * TUNING.pitchRate * dt;
    return clamp(next, -TUNING.pitchLimit, TUNING.pitchLimit);
  }

  /**
   * Vecteur unitaire de deplacement, ecrit dans `target` (un THREE.Vector3)
   * pour ne rien allouer. Le nez pointe vers -Z au cap zero, comme les modeles.
   */
  function setForward(target, yaw, pitch) {
    const cp = Math.cos(pitch);
    target.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    return target;
  }

  /** Mise en vitesse vers la consigne. */
  function advanceSpeed(speed, targetSpeed, dt) {
    return speed + (targetSpeed - speed) * smoothing(TUNING.speedResponse, dt);
  }

  /** Pente reelle de la trajectoire, en radians. */
  function trajectoryPitch(verticalSpeed, horizontalSpeed) {
    const horizontal = Math.max(.001, Math.abs(horizontalSpeed));
    return clamp(Math.atan2(verticalSpeed, horizontal), -TUNING.visualPitchLimit, TUNING.visualPitchLimit);
  }

  /** Assiette affichee : elle rattrape la pente reelle sans a-coup. */
  function advanceVisualPitch(current, verticalSpeed, horizontalSpeed, dt) {
    const target = trajectoryPitch(verticalSpeed, horizontalSpeed);
    return current + (target - current) * smoothing(TUNING.visualPitchResponse, dt);
  }

  /** Roulis d'accompagnement, en radians. */
  function bankAngle(yawInput) {
    return clamp(yawInput, -1, 1) * TUNING.bank;
  }

  // ── FIGURES ─────────────────────────────────────────────────────────────
  // Tonneau ou looping selon l'axe le plus sollicite au moment du declenchement.

  /** @returns {object|null} la figure a demarrer, ou null si le geste ne suffit pas. */
  function startAerobatic(yawInput, pitchInput) {
    const amplitude = Math.max(Math.abs(yawInput), Math.abs(pitchInput));
    if (amplitude <= TUNING.acroTrigger) return null;
    return Math.abs(yawInput) >= Math.abs(pitchInput)
      ? { type: 'roll', direction: Math.sign(yawInput) || 1, elapsed: 0, duration: TUNING.rollDuration }
      : { type: 'loop', direction: Math.sign(pitchInput) || 1, elapsed: 0, duration: TUNING.loopDuration };
  }

  /**
   * Avance la figure d'une image.
   * @returns {{roll: number, pitch: number, done: boolean}} angles a ajouter a
   *   l'attitude affichee. Le signe suit celui de l'assiette : une rotation X
   *   positive leve le nez.
   */
  function advanceAerobatic(aerobatic, dt, out) {
    const result = out || { roll: 0, pitch: 0, done: true };
    result.roll = 0;
    result.pitch = 0;
    if (!aerobatic) { result.done = true; return result; }
    aerobatic.elapsed += dt;
    const progress = clamp(aerobatic.elapsed / aerobatic.duration, 0, 1);
    const angle = Math.PI * 2 * progress * aerobatic.direction;
    if (aerobatic.type === 'roll') result.roll = angle;
    else result.pitch = angle;
    result.done = progress >= 1;
    return result;
  }

  // ══ ATTITUDE COMPLETE ═══════════════════════════════════════════════════
  //
  //  Le modele ci-dessus decrit l'appareil par un cap et une assiette : deux
  //  angles, mesures par rapport au monde. C'est simple et c'est faux des
  //  qu'on quitte le vol a plat — le roulis n'y est qu'une decoration collee
  //  a l'image, et l'assiette doit etre bornee sous la verticale, sinon les
  //  deux angles se croisent et l'appareil part en vrille de calcul. C'est
  //  pour cela qu'il ne pouvait pas passer sur le dos : c'etait interdit par
  //  construction, pas par choix.
  //
  //  Ici l'orientation est un quaternion, et les commandes tournent l'appareil
  //  autour de SES PROPRES axes. Toute la difference est la : un avion qui
  //  cabre alors qu'il est incline sur l'aile ne monte pas, il vire. C'est ce
  //  qui rend le looping et le tonneau possibles sans aucun cas particulier.
  //
  //  Aucune limite d'assiette, aucun angle a surveiller, aucun croisement
  //  possible. Le quaternion se contente d'accumuler des rotations.

  const TUNING_ATTITUDE = {
    // Vitesses de rotation propres, en radians par seconde.
    // Baissees d'environ un cinquieme : a 2.6 rad/s le moindre appui partait
    // trop vite, l'appareil depassait la cible avant qu'on ait relache. Ces
    // deux valeurs commandent le clavier ET la manette : c'est ici qu'on
    // change le toucher pour tout le monde, pas dans la mise en forme du stick.
    roulis: 2.0,       // le plus rapide : c'est lui qu'on sollicite en premier
    tangage: 1.2,
    lacet: .55,        // la derive, faible : un avion ne vire pas au palonnier
    // Virage induit par l'inclinaison. Un avion incline transforme une part de
    // sa portance en virage, sans que le pilote ne demande quoi que ce soit.
    // Sans cela il faudrait cabrer en meme temps qu'incliner pour tourner, ce
    // qui est juste mais dur — et le jeu deviendrait injouable au clavier.
    virageInduit: .9,
    // Retour au vol a plat quand on lache tout. Un vrai avion est stable ;
    // sans cette aide, la moindre inclinaison resterait pour toujours.
    stabilite: .55
  };

  // Objets de travail reutilises : la boucle de vol ne doit rien allouer.
  let _q = null, _v = null, _axe = null;
  function _prepare(orientation) {
    if (_q) return;
    const Q = orientation.constructor;
    _q = new Q();
    // Le vecteur et l'axe se deduisent du meme espace de noms que le quaternion.
    _axe = { x: 0, y: 0, z: 0 };
  }

  /**
   * Fait tourner l'appareil autour de ses propres axes.
   *
   * @param {object} orientation THREE.Quaternion, modifie sur place.
   * @param {number} roulis   -1 a 1, inclinaison sur l'aile.
   * @param {number} tangage  -1 a 1, nez qui monte ou descend.
   * @param {number} lacet    -1 a 1, derive au palonnier.
   * @param {number} dt       duree de l'image, en secondes.
   */
  function tourner(orientation, roulis, tangage, lacet, dt) {
    _prepare(orientation);
    const T = TUNING_ATTITUDE;
    // L'ordre n'a pas d'importance a l'echelle d'une image : les angles sont
    // petits, les rotations commutent presque. Sur des angles larges il en
    // aurait, et c'est justement pourquoi on ne les accumule pas en Euler.
    appliquer(orientation, 0, 0, 1, clamp(roulis, -1, 1) * T.roulis * dt);
    appliquer(orientation, 1, 0, 0, clamp(tangage, -1, 1) * T.tangage * dt);
    appliquer(orientation, 0, 1, 0, clamp(lacet, -1, 1) * T.lacet * dt);
    orientation.normalize();
  }

  /** Rotation autour d'un axe exprime dans le repere de l'appareil. */
  function appliquer(orientation, x, y, z, angle) {
    if (!angle) return;
    const demi = angle / 2;
    const s = Math.sin(demi);
    _q.set(x * s, y * s, z * s, Math.cos(demi));
    orientation.multiply(_q);
  }

  /**
   * Virage induit par l'inclinaison, applique autour de la verticale DU MONDE
   * et non de l'appareil : c'est la gravite qui fait tourner un avion incline,
   * pas son gouvernail.
   *
   * @param {object} orientation THREE.Quaternion, modifie sur place.
   * @param {object} haut vecteur haut de l'appareil, deja calcule.
   * @param {object} avant vecteur avant de l'appareil, deja calcule.
   */
  function virageInduit(orientation, haut, avant, dt) {
    _prepare(orientation);
    // La composante horizontale du vecteur haut mesure l'inclinaison : elle
    // est nulle a plat, maximale sur la tranche. Son signe donne le sens.
    // `inclinaison` vaut l'oppose de la composante verticale de l'aile droite :
    // positif quand on penche a droite, negatif a gauche.
    const inclinaison = -haut.x * avant.z + haut.z * avant.x;
    // Signe NEGATIF, et c'est tout le sujet : une rotation positive autour de
    // la verticale du monde emmene un nez pointe vers -Z vers la GAUCHE. Pour
    // qu'une inclinaison a droite fasse virer a droite, il faut donc tourner
    // dans le sens negatif. Avec le signe inverse, l'appareil penchait du bon
    // cote mais partait de l'autre.
    const angle = -inclinaison * TUNING_ATTITUDE.virageInduit * dt;
    if (!angle) return;
    const demi = angle / 2, s = Math.sin(demi);
    _q.set(0, s, 0, Math.cos(demi));
    // Multiplication a GAUCHE : la rotation s'applique dans le repere du
    // monde. A droite, elle serait relative a l'appareil et ne ferait pas
    // tourner un avion sur le dos dans le bon sens.
    orientation.premultiply(_q);
    orientation.normalize();
  }

  /**
   * Ramene doucement les ailes a l'horizontale quand le pilote ne demande
   * rien. Sans cette stabilite, la moindre inclinaison resterait acquise et
   * l'appareil deriverait sans fin.
   */
  function stabiliser(orientation, haut, avant, sollicitation, dt) {
    if (sollicitation > .12) return;
    _prepare(orientation);
    const inclinaison = -haut.x * avant.z + haut.z * avant.x;
    // Le roulis s'applique autour de l'axe local Z : une commande negative
    // penche a droite. Pour effacer une inclinaison a droite — donc positive —
    // il faut une rotation positive.
    const angle = inclinaison * TUNING_ATTITUDE.stabilite * dt;
    if (!angle) return;
    const demi = angle / 2, s = Math.sin(demi);
    _q.set(0, 0, s, Math.cos(demi));
    orientation.multiply(_q);
    orientation.normalize();
  }

  window.RaphaelFlightModel = {
    TUNING_ATTITUDE,
    tourner,
    virageInduit,
    stabiliser,
    TUNING,
    CHASE,
    chaseCeiling,
    advanceChase,
    chaseKeys,
    clamp,
    smoothing,
    advanceYaw,
    advancePitch,
    setForward,
    advanceSpeed,
    trajectoryPitch,
    advanceVisualPitch,
    bankAngle,
    startAerobatic,
    advanceAerobatic
  };
})();
