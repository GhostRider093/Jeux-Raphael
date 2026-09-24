/**
 * Le skatepark du stade — un circuit de trottinette posé sur le terrain de foot.
 *
 * Tout tient dans **une seule fonction**, `profil(u, v)` : la hauteur du béton
 * au-dessus du sol, en mètres, en n'importe quel point du parc. Elle sert deux
 * fois, et c'est tout l'intérêt :
 *
 *   1. à fabriquer le maillage (on l'échantillonne sur une grille) ;
 *   2. à répondre sous les roues (`hauteurAt`, branché dans `walkableAt`).
 *
 * Le décor et la physique ne peuvent donc pas diverger : il n'y a pas deux
 * descriptions du parc à tenir d'accord, il n'y en a qu'une. Changer la hauteur
 * d'un tremplin, c'est changer un chiffre — la rampe *et* ce que la roue sent
 * suivent ensemble. C'est le même choix que pour le village présenté au moteur
 * des Mondes : une pièce, pas deux copies.
 *
 * Le repère est local au parc : `u` vers l'est, `v` vers le sud, l'origine au
 * centre de la dalle. Le sol reste celui du village — le parc **suit le
 * relief**, il ne le remplace pas (76 cm de dénivelé sur les 52 m du terrain,
 * mesurés : personne ne les sent au guidon, et une dalle horizontale posée
 * par-dessus aurait laissé une marche de 40 cm sur deux bords).
 *
 * Emplacement : le stade de l'Olympique Midi Lirou, le seul rectangle vraiment
 * plat et libre du relevé (0 % d'obstacle sur 52 × 56 m).
 *
 * Le plan, depuis le 24/09/2026 (deux lignes de vol, un half-pipe à airs) :
 *
 *   - droite **est** : départ, bande de lancement, gros tremplin (1,8 m, 42°),
 *     trou, réception en pente — la « ligne de vol », faite pour les loopings ;
 *   - droite **sud** : bande de lancement, tremplin convexe (1,6 m), trou, réception ;
 *   - droite **ouest** : table, puis trois bosses qui font décoller à 25 km/h ;
 *   - droite **nord** : le slalom de plots ;
 *   - infield : half-pipe (murs de 2 m, coping, bande de lancement sur le plat :
 *     on sort du mur à la verticale), mur nord et plongeoir.
 *
 * Les **bandes de lancement** (béton bleu à chevrons blancs) poussent la
 * trottinette à 41 km/h : à 25, aucune rampe ne donne le temps d'un looping.
 */
import * as THREE from 'three';

// ─────────────────────────────────────────────────────────── les dimensions
const U = 26, V = 28;              // demi-dimensions de la dalle (m)
const DALLE = 0.07;                // épaisseur de la dalle (m)
const BISEAU = 1.6;                // sur quelle largeur la dalle rejoint l'herbe (m)

// Le tracé : un rectangle aux coins arrondis. `A`/`B` sont les demi-dimensions
// de son axe, `RC` le rayon des virages, `PISTE` la demi-largeur roulable.
const A = 19, B = 21, RC = 9, PISTE = 5;
const DEVERS = 1.55;               // hauteur du relevé au bord extérieur des virages (m)

/** Le centre du parc, en coordonnées du village (mesuré, pas choisi au hasard). */
export const CENTRE = { x: 6.75, z: 133 };

/**
 * Ce qu'on donne à qui veut s'y rendre : la ligne de départ et son cap.
 * En haut de la droite est, cap au sud : la bande de lancement, puis le
 * tremplin — trente mètres et on est en l'air.
 */
export const DEPART = { x: CENTRE.x + 19, z: CENTRE.z - 11.8, cap: Math.PI };

// ─────────────────────────────────────────────────────────── petites formes
/** Marche adoucie : 0 avant, 1 après, sans angle vif (c'est ce qui évite les arêtes). */
const lisse = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Plateau entre `a` et `b`, dont les bords montent et descendent sur `marge`. */
const creneau = (x, a, b, marge) => lisse((x - a) / marge) * lisse((b - x) / marge);

/**
 * Distance signée à l'axe du tracé : 0 dessus, positif vers l'extérieur.
 *
 * Un rectangle à coins arrondis se mesure en une ligne — on ramène le point
 * dans le quart supérieur droit, on le rabat sur le rectangle intérieur, et il
 * ne reste qu'une distance à un point. Écrire les quatre virages à la main
 * donnait quatre fois le même code, et une marche à chaque raccord.
 */
function sdPiste(u, v) {
  const dx = Math.max(Math.abs(u) - (A - RC), 0);
  const dy = Math.max(Math.abs(v) - (B - RC), 0);
  return Math.hypot(dx, dy) - RC;
}

// ─────────────────────────────────────────────────────────── les morceaux
/** La dalle elle-même, biseautée sur le pourtour pour qu'on y monte sans marche. */
function dalle(u, v) {
  const t = Math.min((U - Math.abs(u)) / BISEAU, (V - Math.abs(v)) / BISEAU);
  return t <= 0 ? 0 : DALLE * Math.min(1, t);
}

/**
 * Les quatre virages relevés.
 *
 * Le dévers ne s'applique que là où le tracé tourne — `k` vaut 1 dans les coins
 * et 0 sur les lignes droites, et passe de l'un à l'autre en deux mètres. Sans
 * ce fondu, la ligne droite plate rencontrait un relevé d'un mètre cinquante
 * par une falaise en travers de la piste.
 */
function virages(u, v) {
  const k = lisse((Math.abs(u) - (A - RC)) / 2.0) * lisse((Math.abs(v) - (B - RC)) / 2.0);
  if (k <= 0) return 0;
  const d = sdPiste(u, v);
  if (d <= 0) return 0;
  if (d <= PISTE) return DEVERS * (d / PISTE) * (d / PISTE) * k;
  // le dos du virage redescend vers l'herbe : on peut le franchir, pas s'y cogner
  const q = (d - PISTE) / 2.4;
  return q >= 1 ? 0 : DEVERS * (1 - q) * k;
}

/**
 * La table (le « box ») de la ligne droite ouest : on la passe à plat ou on la saute.
 * Sa descente est courte (2,6 m) : à 25 km/h, le sol s'y dérobe plus vite que
 * la gravité et l'on décolle du bord au lieu de le suivre.
 */
function table(u, v) {
  const large = creneau(u, -23.6, -14.4, 1.0);
  if (large <= 0 || v < -9.6 || v > 1.6) return 0;
  const H = 1.1;
  let h;
  if (v < -6.1) h = H * lisse((v + 9.6) / 3.5);        // la montée
  else if (v < -1.0) h = H;                            // le plateau
  else h = H * lisse((1.6 - v) / 2.6);                 // la descente, courte
  return h * large;
}

/** Les bosses : trois vagues de 3,2 m, on décolle de chacune à 25 km/h. */
function bosses(u, v) {
  const large = creneau(u, -23.2, -14.8, 1.0);
  if (large <= 0 || v < 4.5 || v > 14.1) return 0;
  return 0.5 * (1 - Math.cos(((v - 4.5) / 3.2) * Math.PI * 2)) / 2 * large;
}

/**
 * Le gros saut de la ligne droite sud : tremplin, trou de 5 m, réception.
 *
 * Le tremplin est **convexe** (exposant 2) : il se cabre en fin de course, ce
 * qui donne la vitesse verticale au lieu de la reprendre. Une rampe droite
 * lance moins haut à vitesse égale, et une rampe concave ne lance pas du tout.
 */
function saut(u, v) {
  const large = creneau(v, 16.6, 25.4, 1.1);
  if (large <= 0) return 0;
  let h = 0;
  if (u > -7.2 && u <= -2.2) h = 1.6 * Math.pow((u + 7.2) / 5, 2.0);
  else if (u >= 2.8 && u < 10.6) {
    // La réception : une face à passer — c'est le trou — puis une pente qui
    // descend dans le sens de la marche, pour absorber la chute.
    h = u < 4.6 ? 1.3 * lisse((u - 2.8) / 1.8) : 1.3 * lisse((10.6 - u) / 6.0);
  }
  return h * large;
}

/**
 * La ligne de vol de la droite est, dans le sens nord → sud : bande de
 * lancement (v de −11 à −6), tremplin de 1,8 m à 42° (v de −5 à −1), trou de
 * 6 m, réception en pente (v de 5 à 17). Prise à 41 km/h, elle donne 1,5 s
 * d'air, trois mètres de haut et seize de long — mesuré — de quoi boucler un
 * looping. Prise à 25, on tombe dans le trou : le prix de l'oubli de la bande bleue.
 */
function ligneEst(u, v) {
  const large = creneau(u, 14.4, 23.6, 1.0);
  if (large <= 0) return 0;
  let h = 0;
  if (v > -5.0 && v <= -1.0) h = 1.8 * Math.pow((v + 5.0) / 4.0, 2.0);
  else if (v >= 5.0 && v < 17.0) h = v < 7.0 ? 1.4 * lisse((v - 5.0) / 2.0) : 1.4 * lisse((17.0 - v) / 10.0);
  return h * large;
}

/**
 * Le half-pipe de l'infield, 19 m de long, deux murs de 2 m.
 *
 * La transition est un vrai arc de cercle (R = 5 m) : `R − √(R² − x²)` part à
 * l'horizontale en bas et finit à la verticale en haut, ce qu'aucune parabole
 * ne fait proprement. Au-dessus, un deck plat, puis un dos en pente — on peut
 * donc y monter par-derrière, ce qui est la seule façon d'y entrer quand on n'a
 * pas le droit de prendre l'escalier qu'on n'a pas construit.
 */
const HP = { v: 3.0, plat: 2.5, R: 5, mur: 2.0, deck: 1.4, dos: 3.0, u: 9.6 };
function halfpipe(u, v) {
  const bout = creneau(u, -HP.u, HP.u, 2.2);
  if (bout <= 0) return 0;
  const d = Math.abs(v - HP.v);
  const { plat: PLAT, R, mur: MUR, deck: DECK, dos: DOS } = HP;
  let h = 0;
  if (d <= PLAT) h = 0;
  else if (d <= PLAT + 4) { const x = d - PLAT; h = R - Math.sqrt(R * R - x * x); }
  else if (d <= PLAT + 4 + DECK) h = MUR;
  else if (d <= PLAT + 4 + DECK + DOS) h = MUR * lisse((PLAT + 4 + DECK + DOS - d) / DOS);
  return h * bout;
}

/** Le mur nord : 19 m de courbe face à l'infield, deck en haut, dos en pente côté piste. */
function murNord(u, v) {
  const large = creneau(u, -9.6, 9.6, 1.8);
  // **Les deux bornes en v comptent autant que les tests qui suivent.** Sans la
  // premiere, la chaine `else if` renvoyait la hauteur du deck pour TOUT le nord
  // du parc : la ligne droite se retrouvait deux metres plus haut, mesure a
  // +2,60 m sur son axe.
  if (large <= 0 || v <= -19.6 || v > -10.8) return 0;
  const H = 2.15;
  let h = 0;
  if (v > -19.6 && v <= -15.6) h = H * lisse((v + 19.6) / 4.0);      // le dos, depuis la droite nord
  else if (v <= -14.2) h = H;                                        // le deck
  else {
    // La face, côté infield : **la même courbe que le half-pipe**, verticale en
    // haut et tangente au sol en bas. Écrite à l'envers (`√(1 − w²)`), elle
    // donnait un toboggan plat sur le dessus et une falaise de 65° au pied —
    // exactement ce qu'on ne veut ni voir ni descendre.
    const w = (-10.8 - v) / 3.4;                                     // 1 sur le deck, 0 au sol
    h = H * (1 - Math.sqrt(Math.max(0, 1 - w * w)));
  }
  return h * large;
}

/**
 * Le plongeoir : la tour au milieu du mur nord, 2,6 m, à pic.
 *
 * `√(1 − x²)` donne une face à **tangente verticale en haut** : on bascule dans
 * le vide, on n'y descend pas en pente. C'est le « plongeant » du skatepark, et
 * c'est aussi ce qui déclenche l'envol côté physique (le sol se dérobe plus vite
 * que la chute libre).
 */
function plongeoir(u, v) {
  const large = creneau(u, -4.8, 4.8, 1.0);
  if (large <= 0 || v <= -19.8 || v > -10.6) return 0;
  const H = 2.6;
  let h = 0;
  if (v > -19.8 && v <= -16.0) h = H * lisse((v + 19.8) / 3.8);      // la montée, dos au parc
  else if (v <= -12.8) h = H;                                        // la plateforme
  else {
    const w = (-10.6 - v) / 2.2;                                     // 1 en haut, 0 au sol
    h = H * (1 - Math.sqrt(Math.max(0, 1 - w * w)));
  }
  return h * large;
}

/**
 * La hauteur du béton au-dessus du sol, en un point du parc.
 *
 * Les morceaux se combinent au **maximum** et jamais par addition : deux pièces
 * qui se touchent forment alors une seule masse continue, au lieu d'une bosse de
 * la somme des deux là où elles se recouvrent.
 */
export function profil(u, v) {
  if (u < -U || u > U || v < -V || v > V) return 0;
  let h = dalle(u, v);
  const pieces = [virages(u, v), table(u, v), bosses(u, v), saut(u, v), ligneEst(u, v),
                  halfpipe(u, v), murNord(u, v), plongeoir(u, v)];
  for (let i = 0; i < pieces.length; i++) if (pieces[i] > h) h = pieces[i];
  return h;
}

/**
 * Les bandes de lancement : null hors bande, sinon l'abscisse le long de la
 * bande (pour peindre les chevrons). Trois bandes : avant le tremplin est,
 * avant le tremplin sud, et sur le plat du half-pipe — chaque passage y reprend
 * de la vitesse, et l'on sort du mur de plus en plus haut.
 */
function bande(u, v) {
  if (u > 15.0 && u < 23.0 && v > -11.0 && v < -6.0) return { t: v + 11.0 };
  if (u > -20.0 && u < -9.0 && Math.abs(v - 21.0) < 3.4) return { t: u + 20.0 };
  if (Math.abs(u) < 8.0 && Math.abs(v - HP.v) < 2.2) return { t: Math.abs(v - HP.v) };
  return null;
}

// ───────────────────────────────────────────────────────────── les couleurs
const ASPHALTE = new THREE.Color(0x4f545c);
const BETON = new THREE.Color(0x929ba1);
const BETON_HAUT = new THREE.Color(0xb3b8bd);
const USE = new THREE.Color(0x3f444b);
const BLANC = new THREE.Color(0xe8ecef);
const TURBO = new THREE.Color(0x2a63c9);
const TURBO_CLAIR = new THREE.Color(0x9ec3ff);
const LEVRE = new THREE.Color(0xe0483a);

// ───────────────────────────────────────────────────────────── construction
/**
 * Bâtit le parc et rend de quoi l'interroger.
 *
 * @param {object} o { decor, centre }
 * @returns {object} { root, hauteurAt, surParc, turboAt, marquerAdherence, depart }
 */
export function construireSkatepark({ decor, centre = CENTRE }) {
  const cx = centre.x, cz = centre.z;
  const root = new THREE.Group();
  root.name = 'skatepark';
  root.position.set(cx, 0, cz);

  // 40 cm : la transition du half-pipe (R = 5 m) reste ronde, et le maillage
  // tient en 36 000 triangles. À 30 cm il en faisait 65 000 pour un gain qu'on
  // ne voit pas ; à 60 cm, les courbes deviennent des facettes.
  const PAS = 0.4;
  const nu = Math.round((2 * U) / PAS) + 1, nv = Math.round((2 * V) / PAS) + 1;
  const pos = new Float32Array(nu * nv * 3);
  const col = new Float32Array(nu * nv * 3);
  const hauteurs = new Float32Array(nu * nv);      // le profil seul, pour la pente
  const teinte = new THREE.Color();

  for (let j = 0; j < nv; j++) {
    const v = -V + j * PAS;
    for (let i = 0; i < nu; i++) {
      const u = -U + i * PAS;
      const k = j * nu + i;
      const h = profil(u, v);
      hauteurs[k] = h;
      pos[k * 3] = u;
      pos[k * 3 + 1] = decor.groundAt(cx + u, cz + v) + h;
      pos[k * 3 + 2] = v;
    }
  }

  // Les couleurs se décident après coup : la pente se lit sur les voisins, et
  // c'est elle qui distingue une transition d'un deck.
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      const u = -U + i * PAS, v = -V + j * PAS;
      const h = hauteurs[k];
      const hu = hauteurs[j * nu + Math.min(nu - 1, i + 1)] - hauteurs[j * nu + Math.max(0, i - 1)];
      const hv = hauteurs[Math.min(nv - 1, j + 1) * nu + i] - hauteurs[Math.max(0, j - 1) * nu + i];
      const pente = Math.hypot(hu, hv) / (2 * PAS);

      const surPiste = Math.abs(sdPiste(u, v)) <= PISTE;
      if (h < DALLE + 0.04) teinte.copy(surPiste ? ASPHALTE : BETON);
      else teinte.copy(BETON).lerp(BETON_HAUT, Math.min(1, h / 2.2));
      if (pente > 0.55) teinte.lerp(USE, Math.min(0.55, (pente - 0.55) * 0.8));
      // Les bandes de lancement : bleues, à chevrons blancs tous les 1,6 m.
      const b = bande(u, v);
      if (b && h < DALLE + 0.04) teinte.copy(((b.t % 1.6) + 1.6) % 1.6 < 0.45 ? TURBO_CLAIR : TURBO);
      // Les lèvres des tremplins, en rouge : on voit d'où l'on part.
      const levreSud = u > -2.7 && u <= -2.2 && Math.abs(v - 21) < 4.2;
      const levreEst = v > -1.5 && v <= -1.0 && u > 14.6 && u < 23.4;
      if (levreSud || levreEst) teinte.copy(LEVRE);
      // La ligne de départ, en travers de la droite est, juste avant la bande.
      if (u > 15.0 && u < 23.0 && Math.abs(v + 11.8) < 0.3) teinte.copy(BLANC);
      col[k * 3] = teinte.r; col[k * 3 + 1] = teinte.g; col[k * 3 + 2] = teinte.b;
    }
  }

  const idx = new Uint32Array((nu - 1) * (nv - 1) * 6);
  let t = 0;
  for (let j = 0; j < nv - 1; j++) {
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      idx[t++] = a; idx[t++] = c; idx[t++] = b;
      idx[t++] = b; idx[t++] = c; idx[t++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  // **0,32 sur la couleur du matériau, et ce n'est pas un caprice de teinte.**
  // Tout le village est peint par des shaders maison qui font leur propre
  // lumière ; le parc, lui, est une `MeshStandardMaterial` ordinaire et reçoit
  // en plein les 2,2 de ciel et les 2,6 de soleil de la scène. À pleine
  // luminance, le béton virait au blanc bleuté et le tracé disparaissait. Les
  // couleurs des sommets restent donc lisibles (du gris de béton), et c'est le
  // matériau qui les ramène dans l'éclairage du village.
  const beton = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x959595, vertexColors: true, roughness: 1.0, metalness: 0,
  }));
  beton.castShadow = true;
  beton.receiveShadow = true;
  root.add(beton);

  root.add(construireSlalom(decor, cx, cz));
  root.add(construireCopings(decor, cx, cz));

  /** Le sol du parc en un point du village : sol du terrain + béton. */
  function hauteurAt(x, z) {
    const u = x - cx, v = z - cz;
    if (u < -U || u > U || v < -V || v > V) return -1e9;
    return decor.groundAt(x, z) + profil(u, v);
  }

  /** Vrai sur la dalle : c'est du béton, donc l'adhérence du bitume. */
  function surParc(x, z) {
    const u = x - cx, v = z - cz;
    return u >= -U && u <= U && v >= -V && v <= V;
  }

  /** Vrai sur une bande de lancement : le pilote y pousse la trottinette. */
  function turboAt(x, z) {
    return bande(x - cx, z - cz) !== null;
  }

  /**
   * Tamponne la dalle dans la grille d'adhérence de la voiture.
   *
   * La grille est bâtie à partir des rubans de chaussée du relevé ; le parc
   * n'en fait pas partie, et sans ceci on roulerait sur le béton avec
   * l'adhérence de l'herbe (0,74 contre 1,0) — une trottinette qui glisse au
   * pied d'un tremplin ne le monte pas.
   */
  function marquerAdherence(marquer) {
    for (let u = -U; u <= U; u += 1) for (let v = -V; v <= V; v += 1) marquer(cx + u, cz + v);
  }

  return { root, hauteurAt, surParc, turboAt, marquerAdherence, profil, centre: { x: cx, z: cz }, depart: DEPART };
}

/**
 * Les copings : le tube d'acier sur la lèvre des murs du half-pipe et du mur
 * nord. Purement visuel — la physique voit la courbe, pas le tube — mais c'est
 * ce qui fait qu'un mur de béton se lit comme une rampe et non comme un talus.
 * Chaque lèvre est découpée en tronçons de 3,2 m qui suivent le relief du
 * terrain : un tube droit de 19 m flotterait d'un côté et s'enterrerait de l'autre.
 */
function construireCopings(decor, cx, cz) {
  const groupe = new THREE.Group();
  groupe.name = 'copings';
  const acier = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.35, metalness: 0.8 });
  const TRONCON = 3.2;
  const geo = new THREE.CylinderGeometry(0.055, 0.055, TRONCON + 0.04, 10);
  geo.rotateZ(Math.PI / 2);          // le long de u
  const levres = [
    { v: HP.v - (HP.plat + 4), u0: -HP.u, u1: HP.u, h: HP.mur },
    { v: HP.v + (HP.plat + 4), u0: -HP.u, u1: HP.u, h: HP.mur },
    { v: -14.2, u0: -9.6, u1: -5.0, h: 2.15 },
    { v: -14.2, u0: 5.0, u1: 9.6, h: 2.15 },
  ];
  for (const L of levres) {
    for (let u = L.u0; u < L.u1 - 0.01; u += TRONCON) {
      const fin = Math.min(u + TRONCON, L.u1);
      const milieu = (u + fin) / 2;
      const tube = new THREE.Mesh(geo, acier);
      tube.scale.x = (fin - u) / TRONCON;
      tube.position.set(milieu, decor.groundAt(cx + milieu, cz + L.v) + L.h + 0.02, L.v);
      // le tube suit la pente du terrain le long de la lèvre
      const y0 = decor.groundAt(cx + u, cz + L.v), y1 = decor.groundAt(cx + fin, cz + L.v);
      tube.rotation.z = Math.atan2(y1 - y0, fin - u);
      tube.castShadow = true;
      groupe.add(tube);
    }
  }
  return groupe;
}

/**
 * Les plots du slalom, sur la ligne droite nord.
 *
 * Ils ne comptent pas dans le profil : un cône de chantier n'arrête pas une
 * trottinette, il se renverse. Tant qu'on ne les fait pas tomber, mieux vaut
 * pouvoir les toucher que buter dessus comme sur un rocher.
 */
function construireSlalom(decor, cx, cz) {
  const N = 7;
  const geo = new THREE.ConeGeometry(0.21, 0.62, 12, 3, false);
  geo.translate(0, 0.31, 0);
  // Bandes blanches cuites dans les sommets : pas de texture, et un plot se
  // reconnaît de loin à ses bandes, pas à sa couleur.
  const c = new THREE.Color();
  const n = geo.attributes.position.count;
  const couleurs = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const y = geo.attributes.position.getY(i);
    const blanc = y > 0.3 && y < 0.44;
    c.set(blanc ? 0xf2f4f6 : 0xf2621f);
    couleurs[i * 3] = c.r; couleurs[i * 3 + 1] = c.g; couleurs[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(couleurs, 3));
  const plots = new THREE.InstancedMesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xbdbdbd, vertexColors: true, roughness: 0.75 }),
    N,
  );
  plots.name = 'slalom';
  plots.castShadow = true;
  const m = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    // Un slalom se court en quinconce : les plots alternent de part et d'autre
    // de l'axe, sinon on passe tout droit a cote de la file.
    const u = 9 - i * 3;
    const v = -21 + (i % 2 ? 1.7 : -1.7);
    // La dalle suit le relief : le plot se pose sur le profil, pas a une
    // hauteur ecrite en dur — sinon il flotte d'un cote du terrain et
    // s'enterre de l'autre.
    m.makeTranslation(u, decor.groundAt(cx + u, cz + v) + profil(u, v), v);
    plots.setMatrixAt(i, m);
  }
  plots.instanceMatrix.needsUpdate = true;
  plots.computeBoundingSphere();
  return plots;
}
