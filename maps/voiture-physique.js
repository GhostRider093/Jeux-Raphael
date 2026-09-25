/**
 * La loi de conduite — le « moteur » de la voiture, et rien d'autre.
 *
 * Ce fichier ne connaît ni Three.js, ni la scène, ni le village : il reçoit des
 * commandes (gaz, frein, direction, frein à main) et fait avancer un état de
 * véhicule. C'est le même principe que `flight-model.js` pour le chasseur : une
 * voiture qui se conduirait autrement selon la page est exactement ce que ce
 * découpage empêche. `maps/voiture-pilote.js` s'occupe du décor et de la caméra,
 * `maps/voiture-model.js` de la tôle.
 *
 * Le modèle est un « bicycle model » à deux essieux :
 *   — le moteur donne un couple qui dépend du régime, la boîte le multiplie ;
 *   — chaque essieu porte une charge (statique + transfert au freinage et à
 *     l'accélération), et cette charge plafonne l'adhérence disponible ;
 *   — la force latérale d'un pneu suit une courbe de dérive (Pacejka simplifiée) :
 *     elle monte vite, culmine vers huit degrés de dérive, puis redescend — c'est
 *     cette redescente qui fait qu'une voiture part en glissade et qu'on peut la
 *     rattraper au volant et au pied droit ;
 *   — l'ellipse de friction partage l'adhérence entre freiner/accélérer et tourner.
 *
 * Le frein à main bloque le train arrière : son adhérence latérale tombe de
 * moitié, la voiture pivote, et le contre-braquage devient nécessaire. C'est la
 * seule « figure » du jeu, et elle n'est pas scriptée : elle sort du modèle.
 *
 * Aucune allocation : l'état est un objet réutilisé, tout le calcul est scalaire.
 */

const G = 9.81;
const RHO = 1.225;             // masse volumique de l'air (kg/m³)
const PAS_MAX = 1 / 120;       // sous-pas d'intégration : au-delà, la glisse diverge

/**
 * Le mode **arcade** (Arnaud, 25/09/2026 : « il faut que ce soit un peu plus
 * arcade, tant pis, ça fera moins simulation »). Il s'active par `arcade: true`
 * dans un réglage — la berline et le quad, pas la trottinette qui a sa propre
 * loi de saut — et change quatre choses, rien d'autre :
 *  - **on freine droit** : sans commande de direction, le lacet et la vitesse
 *    latérale s'éteignent au freinage, l'engin ne part plus de côté ;
 *  - la marche arrière s'engage plus vite (0,4 s à l'arrêt au lieu de 0,75) et
 *    on en ressort plus vite (0,25 s au lieu de 0,5) ;
 *  - en marche arrière, le couple est multiplié (« beaucoup plus vite ») ;
 *  - le reste (plus de couple, plus de frein) est dans les réglages eux-mêmes.
 */
const ARCADE = {
  freinDroit: 9,          // 1/s : vitesse d'extinction du lacet et de la dérive au freinage
  attenteArriere: 0.40,   // s d'arrêt frein tenu avant d'engager la marche arrière
  attenteAvant: 0.25,     // s d'arrêt gaz tenu avant de repasser en avant
  coupleArriere: 1.6,     // multiplicateur du couple en marche arrière
};

export const REGLAGES = {
  /** Sportive GT : moteur avant, **propulsion**, châssis vif et rattrapable. */
  gt: {
    nom: 'GT rouge',
    motrice: 'arriere',         // essieu moteur : 'arriere' (propulsion) ou 'avant' (traction)
    masse: 1470,                // kg
    avant: 1.24, arriere: 1.42, // distances essieu ↔ centre de gravité (m)
    hauteurCG: 0.46,            // hauteur du centre de gravité (m) — règle le transfert de charge
    inertie: 1980,              // moment d'inertie en lacet (kg·m²)
    voie: 1.64, rayonRoue: 0.345,

    couple: 600,                // couple maxi (N·m) — 500 avant l'arcade du 25/09/2026
    regimeCouple: 5100, regimeMax: 7400, ralenti: 950,
    rapports: [3.38, 2.16, 1.58, 1.24, 1.02, 0.84], pont: 3.60, marche: 3.20,
    rendement: 0.90,
    freinMoteur: 34,            // N·m de frein moteur, pied levé

    adherence: 1.32,            // µ des pneus sur bitume sec
    repartAvant: 0.64,          // part du freinage sur l'avant
    freinCouple: 5200,          // couple de freinage total maxi (N·m aux roues) — 3400 avant l'arcade
    arcade: true,

    // Aides de conduite — c'est ce qui sépare une voiture qu'on conduit d'un
    // châssis de course qui part en tête-à-queue au premier coup de gaz.
    antipatinage: 0.92,         // part de l'adhérence arrière que la traction s'autorise
    stabilite: 2.6,             // rappel du lacet vers la trajectoire voulue (1/s)
    equilibre: 1.08,            // adhérence arrière / avant : > 1 = sous-vireur, donc rattrapable

    braquageMax: 0.50,          // rad à l'arrêt (≈ 29°) — 35° faisait pivoter la voiture sur place
    braquageVite: 0.12,         // rad à 250 km/h — sinon un coup de volant à fond retourne la voiture
    vitesseBraquage: 3.4,       // rad/s de rotation des roues
    appui: 0.55,                // appui aérodynamique (N par (m/s)²)
    scx: 0.64,                  // S·Cx (m²)
    roulement: 0.014,           // coefficient de résistance au roulement
  },

  /**
   * Berline **traction avant** — la voiture de tout le monde, et la plus facile.
   *
   * Ce n'est pas la même voiture avec une case cochée : une traction tire au
   * lieu de pousser, donc elle ne peut pas se mettre en travers sur les gaz.
   * Quand l'avant en demande trop, elle élargit son virage (sous-virage) et il
   * suffit de lever le pied. C'est pour cela qu'elle pardonne.
   *
   * Réglages en conséquence : moins de couple, centre de gravité un peu plus
   * avancé (le poids est sur les roues motrices), antipatinage plus ferme.
   */
  traction: {
    nom: 'Berline bleue',
    motrice: 'avant',
    masse: 1380,
    avant: 1.12, arriere: 1.54,   // moteur en porte-à-faux avant : la masse y est
    hauteurCG: 0.52,
    inertie: 2050,
    voie: 1.58, rayonRoue: 0.345,

    couple: 460,                // 380 avant l'arcade du 25/09/2026
    regimeCouple: 4200, regimeMax: 6600, ralenti: 850,
    rapports: [3.55, 2.05, 1.38, 1.03, 0.82, 0.68], pont: 3.90, marche: 3.40,
    rendement: 0.90,
    freinMoteur: 30,

    adherence: 1.24,
    repartAvant: 0.68,
    freinCouple: 4600,          // 3100 avant l'arcade
    arcade: true,

    antipatinage: 0.86,
    stabilite: 3.0,
    // Rapport d'adhérence arrière / avant. Au-dessus de 1, l'arrière tient mieux
    // que l'avant : la voiture élargit son virage au lieu de partir de l'arrière.
    // Une traction est plus franche là-dessus qu'une propulsion — c'est ce qui
    // la rend rattrapable en levant simplement le pied.
    equilibre: 1.14,

    braquageMax: 0.52,
    braquageVite: 0.13,
    vitesseBraquage: 3.2,
    appui: 0.30,
    scx: 0.72,
    roulement: 0.015,
  },

  /**
   * Trottinette électrique — même loi de conduite, tout autre véhicule.
   *
   * Cent dix kilos avec son pilote, un mètre quinze d'empattement, un centre de
   * gravité haut perché : elle tourne court, elle penche, et elle s'arrête en
   * trois mètres. Pas de boîte (un seul rapport, comme tout engin électrique),
   * 25 km/h en pointe — la limite française, et de toute façon la vitesse à
   * laquelle une trottinette reste conduisible dans une ruelle.
   */
  trottinette: {
    nom: 'Trottinette',
    motrice: 'arriere',
    masse: 110,
    avant: 0.55, arriere: 0.60,
    hauteurCG: 0.85,            // haut : elle plonge au freinage, et cela se voit
    inertie: 42,
    voie: 0.20, rayonRoue: 0.13,

    couple: 26,
    regimeCouple: 2600, regimeMax: 4200, ralenti: 0,
    rapports: [1], pont: 6.2, marche: 6.2,
    rendement: 0.92,
    freinMoteur: 4,

    adherence: 1.05,
    repartAvant: 0.55,
    freinCouple: 190,

    antipatinage: 0.88,
    stabilite: 3.6,
    equilibre: 1.06,

    braquageMax: 0.70,          // elle tourne court, c'est tout son intérêt
    braquageVite: 0.22,
    vitesseBraquage: 3.6,
    appui: 0,
    scx: 0.55,
    roulement: 0.020,
  },

  /**
   * Le quad (25/09/2026) : quatre roues, moteur thermique monocylindre, pilote
   * dessus. Léger et court, il tourne court ; haut sur pattes, il roule un peu
   * dans les virages. Pas d'appui aérodynamique, beaucoup de traînée (le pilote
   * est dans le vent) : il plafonne vers 90 km/h.
   */
  quad: {
    nom: 'Quad',
    motrice: 'arriere',
    masse: 330,                 // 250 kg de quad + le pilote
    avant: 0.60, arriere: 0.63, // empattement 1,23 m (mesuré sur le modèle)
    hauteurCG: 0.55,
    inertie: 130,
    voie: 0.98, rayonRoue: 0.26,

    couple: 58,                 // 38 avant l'arcade du 25/09/2026 (« repartir plus vite »)
    regimeCouple: 5600, regimeMax: 8600, ralenti: 1400,
    rapports: [2.90, 1.95, 1.45, 1.15, 0.95], pont: 4.30, marche: 3.40,
    rendement: 0.90,
    freinMoteur: 5,

    adherence: 1.30,            // 1,15 avant l'arcade : il freine et repart sans patiner
    repartAvant: 0.55,
    freinCouple: 1200,          // 900 avant l'arcade
    arcade: true,

    antipatinage: 0.90,
    stabilite: 3.0,
    equilibre: 1.05,

    braquageMax: 0.62,
    braquageVite: 0.18,
    vitesseBraquage: 3.6,
    appui: 0,
    scx: 1.05,
    roulement: 0.030,
  },
};

/** Couple moteur (N·m) au régime demandé : plateau large, chute franche au rupteur. */
function coupleMoteur(r, rpm) {
  if (rpm < r.ralenti) rpm = r.ralenti;
  const a = (rpm - r.regimeCouple) / (r.regimeCouple * 0.78);
  let c = r.couple * (1 - 0.42 * a * a);
  // en bas, le moteur ne pousse pas encore : sinon la voiture démarre comme un train
  if (rpm < 1900) c *= 0.52 + 0.48 * (rpm - r.ralenti) / (1900 - r.ralenti);
  // rupteur : les 350 derniers tours ne donnent plus rien, on est prié de passer
  if (rpm > r.regimeMax - 350) c *= Math.max(0, (r.regimeMax - rpm) / 350);
  return c > 0 ? c : 0;
}

/**
 * Force latérale d'un essieu (N) ; `derive` en radians, `charge` en newtons.
 * Courbe magique simplifiée : B la raideur, C la forme, le plafond étant la
 * charge portée multipliée par l'adhérence disponible.
 */
function forcePneu(derive, charge, mu) {
  // B = raideur, C = forme. À 9,2 / 1,45 le pic est pointu et la chute brutale :
  // le pneu lâche d'un coup, la voiture pivote avant qu'on ait senti venir quoi
  // que ce soit. À 7,6 / 1,28, le plateau est large et le décrochage s'annonce.
  const B = 7.6, C = 1.28;
  return -mu * charge * Math.sin(C * Math.atan(B * derive));
}

/**
 * Crée l'état d'une voiture et sa fonction d'avancement.
 *
 * @param {object} reglage entrée de REGLAGES
 * @returns {{etat: object, pas: Function, poser: Function, reglage: object}}
 */
export function creerPhysique(reglage = REGLAGES.gt) {
  const r = reglage;
  const L = r.avant + r.arriere;

  const etat = {
    x: 0, z: 0, yaw: 0,
    u: 0,              // vitesse longitudinale, repère voiture (m/s, > 0 : vers l'avant)
    v: 0,              // vitesse latérale (m/s, > 0 : vers la droite)
    lacet: 0,          // vitesse de rotation (rad/s)
    braquage: 0,       // angle réel des roues avant (rad), il suit la commande
    rapport: 1,        // 1..6, −1 en marche arrière, 0 pendant un passage
    cible: 1,          // rapport visé pendant un passage
    regime: r.ralenti,
    passage: 0,        // temps restant du changement de rapport (s)
    arret: 0,          // temps passé quasi à l'arrêt (sert à engager la marche arrière)
    glisseAv: 0, glisseAr: 0,   // dérive des essieux (rad) — fumée et crissement s'y branchent
    patinage: 0,       // > 1 : la puissance dépasse l'adhérence, les roues patinent
    charge: 0,         // accélération latérale (g) — la caisse s'y penche
    freinage: 0,       // 0 ou 1, pour les feux stop
    ax: 0,             // accélération longitudinale (m/s²), relue pour le transfert de charge
    vitesse: 0,        // module de la vitesse au sol (m/s)
    kmh: 0,
    rotationRoue: 0,   // angle cumulé des roues (rad), pour les faire tourner
  };

  /** Repose la voiture à un endroit, à l'arrêt. */
  function poser(x, z, yaw) {
    etat.x = x; etat.z = z; etat.yaw = yaw;
    etat.u = etat.v = etat.lacet = 0;
    etat.braquage = 0; etat.rapport = 1; etat.cible = 1; etat.regime = r.ralenti;
    etat.passage = 0; etat.arret = 0; etat.glisseAv = etat.glisseAr = 0;
    etat.patinage = 0; etat.charge = 0; etat.ax = 0; etat.vitesse = etat.kmh = 0;
  }

  /** Régime moteur correspondant à la vitesse, sur le rapport engagé. */
  function regimeRoues(vitesse, rapport) {
    if (!rapport) return etat.regime;
    const ratio = rapport < 0 ? r.marche : r.rapports[rapport - 1];
    const rpm = Math.abs(vitesse) / r.rayonRoue * ratio * r.pont * 60 / (2 * Math.PI);
    return rpm < r.ralenti ? r.ralenti : rpm;
  }

  /** Boîte automatique : monte au rupteur, redescend quand le moteur traîne. */
  function boite(dt, gaz) {
    if (etat.passage > 0) {
      etat.passage -= dt;
      if (etat.passage <= 0) { etat.passage = 0; etat.rapport = etat.cible; }
      return;
    }
    if (etat.rapport < 0) return;
    const rpm = etat.regime;
    if (etat.rapport < r.rapports.length && rpm > r.regimeMax - 420 && gaz > 0.15) {
      etat.cible = etat.rapport + 1; etat.passage = 0.22;
    } else if (etat.rapport > 1 && rpm < 2500) {
      // on ne rétrograde que si le rapport inférieur ne tape pas dans le rupteur
      if (regimeRoues(etat.u, etat.rapport - 1) < r.regimeMax - 700) {
        etat.cible = etat.rapport - 1; etat.passage = 0.18;
      }
    }
  }

  /**
   * Avance la voiture d'un temps dt.
   *
   * @param {number} dt   secondes (le pilote l'écrête)
   * @param {object} cmd  { gaz, frein, direction, main } — gaz et frein dans [0,1],
   *                      direction dans [-1,1] : **positif à droite**, comme la
   *                      touche. Le repère intérieur (latéral positif à droite,
   *                      lacet positif à gauche comme le `yaw` de Three.js) est
   *                      l'affaire de ce fichier, pas celle de l'appelant ;
   *                      main : frein à main
   * @param {number} mu   adhérence du sol (1 sur le bitume, moins sur la terre)
   */
  function pas(dt, cmd, mu = 1) {
    const sous = Math.ceil(dt / PAS_MAX) || 1;
    const h = dt / sous;
    for (let k = 0; k < sous; k++) integrer(h, cmd, mu);
    etat.vitesse = Math.hypot(etat.u, etat.v);
    etat.kmh = Math.round(etat.vitesse * 3.6);
    etat.freinage = (cmd.main || (cmd.frein > 0.05 && etat.u > 0.5)) ? 1 : 0;
  }

  function integrer(h, cmd, muSol) {
    const gazIn = cmd.gaz || 0, freinIn = cmd.frein || 0;

    // ── marche arrière ────────────────────────────────────────────────────
    // Un seul pédalier : à l'arrêt, garder le frein engage la marche arrière, et
    // l'on ressort en avant de la même façon. C'est ce que fait tout jeu de
    // voiture jouable à deux touches, et cela évite une commande de plus.
    if (Math.abs(etat.u) < 0.6) etat.arret += h; else etat.arret = 0;
    let gaz = gazIn, frein = freinIn;
    // 0,75 s, et pas 0,35 : à 0,35 s, finir un freinage touche par touche suffisait
    // à engager la marche arrière, et la voiture repartait en arrière toute seule
    // alors qu'on croyait s'arrêter. Il faut désormais **vouloir** reculer.
    // En arcade, on attend moins (voir `ARCADE`).
    const attenteAr = r.arcade ? ARCADE.attenteArriere : 0.75;
    const attenteAv = r.arcade ? ARCADE.attenteAvant : 0.5;
    if (etat.rapport > 0 && freinIn > 0.5 && etat.arret > attenteAr && Math.abs(etat.u) < 0.35) {
      etat.rapport = -1; etat.cible = -1; etat.passage = 0; etat.arret = 0;
    } else if (etat.rapport < 0) {
      gaz = freinIn; frein = gazIn;              // en marche arrière, les pédales s'échangent
      if (gazIn > 0.5 && etat.arret > attenteAv && etat.u > -0.35) {
        etat.rapport = 1; etat.cible = 1; etat.arret = 0;
      }
    }

    // ── direction ─────────────────────────────────────────────────────────
    // Le braquage disponible se referme avec la vitesse : à 200 km/h, un coup de
    // volant à fond ne doit pas envoyer la voiture dans une façade.
    const v = Math.abs(etat.u);
    const dispo = r.braquageMax - (r.braquageMax - r.braquageVite) * Math.min(1, v / 62);
    const vise = (cmd.direction || 0) * dispo;
    const ecart = vise - etat.braquage;
    const pasVolant = r.vitesseBraquage * h;
    etat.braquage += Math.abs(ecart) < pasVolant ? ecart : Math.sign(ecart) * pasVolant;

    // ── moteur et transmission ────────────────────────────────────────────
    etat.regime = regimeRoues(etat.u, etat.passage > 0 ? 0 : etat.rapport);
    boite(h, gaz);
    let force = 0;
    if (etat.passage <= 0 && etat.rapport !== 0) {
      const ratio = (etat.rapport < 0 ? -r.marche : r.rapports[etat.rapport - 1]) * r.pont;
      let couple = coupleMoteur(r, etat.regime) * gaz - r.freinMoteur * (1 - gaz);
      // Arcade : la marche arrière pousse fort (« beaucoup plus vite »).
      if (r.arcade && etat.rapport < 0 && couple > 0) couple *= ARCADE.coupleArriere;
      force = couple * ratio * r.rendement / r.rayonRoue;
    }

    // ── charges sur les essieux ───────────────────────────────────────────
    // La charge statique vient de la position du centre de gravité ; le transfert
    // vient de l'accélération longitudinale du pas précédent. C'est lui qui fait
    // qu'on tourne mieux en entrant sur les freins.
    const poids = r.masse * G;
    const appui = r.appui * etat.u * etat.u;
    const transfert = r.masse * etat.ax * r.hauteurCG / L;
    let chargeAv = poids * r.arriere / L + appui * 0.44 - transfert;
    let chargeAr = poids * r.avant / L + appui * 0.56 + transfert;
    if (chargeAv < 200) chargeAv = 200;   // une roue délestée ne tire plus, mais ne disparaît pas
    if (chargeAr < 200) chargeAr = 200;

    const mu = r.adherence * muSol;
    // Le train arrière tient un peu plus que l'avant : la voiture élargit sa
    // trajectoire quand on en demande trop, au lieu de partir de l'arrière. Un
    // sous-virage léger se rattrape en levant le pied, un survirage non.
    const muAr = cmd.main ? mu * 0.50 : mu * r.equilibre;   // frein à main : le train arrière lâche

    // ── dérives ───────────────────────────────────────────────────────────
    const vitesseRef = Math.max(2.2, v);         // sous 2 m/s, la dérive n'a plus de sens
    const sens = etat.u >= 0 ? 1 : -1;
    // Convention, et c'est elle qui a fait tourner la voiture à l'envers :
    // `v` compte positif **vers la droite**, `lacet` positif fait tourner **à
    // gauche** (c'est le sens de `yaw` dans Three.js). Un lacet à gauche emmène
    // donc l'essieu avant vers la gauche : sa vitesse « vers la droite » baisse.
    const deriveAv = Math.atan2(etat.v - r.avant * etat.lacet, vitesseRef) - etat.braquage * sens;
    const deriveAr = Math.atan2(etat.v + r.arriere * etat.lacet, vitesseRef);
    etat.glisseAv = deriveAv; etat.glisseAr = deriveAr;

    let fyAv = forcePneu(deriveAv, chargeAv, mu);
    let fyAr = forcePneu(deriveAr, chargeAr, muAr);

    // ── longitudinal : traction, freins, ellipse de friction ──────────────
    const freinForce = frein * r.freinCouple / r.rayonRoue;
    // **Quel essieu tire ?** Une traction met sa force devant, une propulsion
    // derrière — et tout le comportement en découle : la première élargit son
    // virage quand on en demande trop, la seconde se met en travers.
    const avantMoteur = r.motrice === 'avant';
    let fxAv = (avantMoteur ? force : 0) - freinForce * r.repartAvant * sens;
    let fxAr = (avantMoteur ? 0 : force) - freinForce * (1 - r.repartAvant) * sens;
    // roues arrière bloquées : plus de traction arrière, un frottement pur qui s'oppose
    if (cmd.main) fxAr = -muAr * chargeAr * 0.85 * sens;

    // L'adhérence est un disque : ce qu'on dépense à pousser ne pousse plus de
    // côté. Sans ce partage, on accélère à fond en plein virage sans conséquence.
    const limAv = mu * chargeAv, limAr = muAr * chargeAr;
    // `patinage` est mesuré sur ce que le moteur DEMANDE, avant l'écrêtage :
    // c'est lui qui déclenche la fumée et le crissement, et il doit continuer à
    // dire « tu en demandes trop » même quand l'antipatinage vient d'intervenir.
    // Le patinage se mesure sur l'essieu MOTEUR, avant écrêtage : c'est lui qui
    // déclenche la fumée et le crissement, et il doit continuer à dire « tu en
    // demandes trop » même quand l'antipatinage vient d'intervenir.
    const limMot = avantMoteur ? limAv : limAr;
    etat.patinage = Math.abs(avantMoteur ? fxAv : fxAr) / (limMot > 1 ? limMot : 1);
    // Antipatinage : hors frein à main, la traction reste sous le seuil de glisse.
    if (!cmd.main) {
      const tract = r.antipatinage * limMot;
      if (avantMoteur) {
        if (fxAv > tract) fxAv = tract; else if (fxAv < -tract) fxAv = -tract;
      } else if (fxAr > tract) fxAr = tract;
      else if (fxAr < -tract) fxAr = -tract;
    }
    const partAv = Math.min(1, Math.abs(fxAv) / limAv);
    const partAr = Math.min(1, Math.abs(fxAr) / limAr);
    fyAv *= Math.sqrt(Math.max(0, 1 - partAv * partAv));
    fyAr *= Math.sqrt(Math.max(0, 1 - partAr * partAr));
    if (Math.abs(fxAv) > limAv) fxAv = Math.sign(fxAv) * limAv;
    if (Math.abs(fxAr) > limAr) fxAr = Math.sign(fxAr) * limAr;

    // ── résistances ───────────────────────────────────────────────────────
    const trainee = 0.5 * RHO * r.scx * etat.u * Math.abs(etat.u);
    const roulement = r.roulement * poids * sens * Math.min(1, v / 1.5);

    // ── intégration dans le repère voiture ────────────────────────────────
    const cosB = Math.cos(etat.braquage);
    const ax = (fxAv * cosB + fxAr - trainee - roulement) / r.masse;
    const ay = (fyAv * cosB + fyAr) / r.masse;
    // Une force vers la droite appliquée à l'avant fait pivoter la voiture vers
    // la droite, c'est-à-dire dans le sens des lacets négatifs — d'où les signes.
    let moment = (r.arriere * fyAr - r.avant * fyAv * cosB) / r.inertie;
    // Contrôle de trajectoire. Le volant demande un rayon (Ackermann) ; on
    // compare la rotation réelle à celle-là et on rappelle doucement vers elle.
    // C'est l'ESP des voitures de série, et c'est ce qui manque pour qu'une
    // propulsion soit conduisible par quelqu'un qui n'a pas de volant à retour
    // d'effort. Frein à main tiré, le rappel est coupé : la glissade reste.
    if (!cmd.main) {
      // Le volant demande un rayon (Ackermann), mais l'adhérence plafonne la
      // rotation réellement tenable : µ·g / v. Sans ce plafond, le rappel
      // **impose** le lacet géométrique — 3,3 rad/s à fond de volant à 60 km/h,
      // quatre fois ce que les pneus peuvent tenir — et c'est alors l'aide
      // elle-même qui met la voiture en travers.
      const tenable = (mu * G) / (Math.abs(etat.u) > 4 ? Math.abs(etat.u) : 4);
      let vise = -etat.u * Math.tan(etat.braquage) / L;
      if (vise > tenable) vise = tenable; else if (vise < -tenable) vise = -tenable;
      // Et l'on ne pousse jamais la voiture à tourner davantage : on ne freine
      // que l'excès de rotation. Tourner reste le travail des pneus.
      if (Math.abs(etat.lacet) > Math.abs(vise)) moment += (vise - etat.lacet) * r.stabilite;
    }

    etat.ax = ax;
    etat.charge = ay / G;
    etat.u += (ax - etat.lacet * etat.v) * h;
    etat.v += (ay + etat.lacet * etat.u) * h;
    etat.lacet += moment * h;

    // À l'arrêt, le modèle bruite : on éteint proprement les restes de mouvement.
    if (Math.abs(etat.u) < 0.35 && gaz < 0.05) {
      etat.u *= 0.86; etat.v *= 0.72; etat.lacet *= 0.72;
      if (Math.abs(etat.u) < 0.02) etat.u = 0;
    }
    // Garde-fou : au-delà, le lacet ne veut plus rien dire (choc, tête-à-queue fou).
    if (etat.lacet > 3.2) etat.lacet = 3.2;
    else if (etat.lacet < -3.2) etat.lacet = -3.2;

    // ── basse vitesse : la cinématique reprend la main ────────────────────
    // Un modèle de pneus ne veut plus rien dire à l'arrêt : la dérive, qui est
    // un rapport de vitesses, explose dès que la vitesse tend vers zéro, les
    // forces saturent et la voiture pirouette sur place au moindre coup de
    // volant. Sous 8 m/s on retombe donc progressivement sur la géométrie
    // d'Ackermann — l'essieu arrière suit, l'avant braque, la voiture tourne
    // exactement comme sur un parking. Frein à main tiré, on n'y touche pas :
    // le tête-à-queue volontaire reste possible.
    if (!cmd.main) {
      const vitesseAbs = Math.abs(etat.u);
      const melange = vitesseAbs > 8 ? 1 : (vitesseAbs < 3 ? 0 : (vitesseAbs - 3) / 5);
      if (melange < 1) {
        const lacetCine = -etat.u * Math.tan(etat.braquage) / L;
        const vCine = -r.arriere * lacetCine;
        etat.lacet = etat.lacet * melange + lacetCine * (1 - melange);
        etat.v = etat.v * melange + vCine * (1 - melange);
      }
    }

    // **Arcade : on freine droit.** Frein appuyé, volant au centre, frein à
    // main lâché : ce qui reste de rotation et de dérive s'éteint. Dès qu'on
    // touche à la direction, le modèle reprend ses droits.
    if (r.arcade && !cmd.main && frein > 0.25 && Math.abs(cmd.direction || 0) < 0.06) {
      const k = Math.exp(-ARCADE.freinDroit * h);
      etat.lacet *= k; etat.v *= k;
    }

    etat.yaw += etat.lacet * h;
    const s = Math.sin(etat.yaw), c = Math.cos(etat.yaw);
    // Repère du projet : l'avant est −z quand yaw vaut 0, la droite est +x.
    etat.x += (-s * etat.u + c * etat.v) * h;
    etat.z += (-c * etat.u - s * etat.v) * h;
    etat.rotationRoue += (etat.u / r.rayonRoue) * h;
  }

  /**
   * Change de voiture sans rien reconstruire : les valeurs du nouveau réglage
   * sont recopiées dans celui que la boucle tient déjà. Le pilote, la caméra et
   * le son continuent de tourner ; seule la mécanique change sous eux.
   */
  function changerReglage(nouveau) {
    Object.assign(r, nouveau);
    etat.rapport = Math.min(etat.rapport, r.rapports.length);
    return r;
  }

  return { etat, pas, poser, changerReglage, reglage: r };
}
