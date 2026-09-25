/**
 * Le mode Voiture — ce qui relie la loi de conduite au village.
 *
 * `voiture-physique.js` sait conduire mais ne sait pas où il roule ;
 * `voiture-model.js` est de la tôle qui ne bouge pas toute seule. Ce fichier
 * fait le reste, et il est écrit pour servir **les deux pages** : la visite du
 * village (`poilhes.html`) et le moteur des Mondes (`mondes.html`, donc le pays
 * qui réunit Poilhes et Capestang). Il ne demande que des fonctions :
 *
 *     solAt(x, z)      altitude du sol praticable (tablier de pont compris)
 *     blockedAt(x, z)  vrai s'il y a un mur ou de l'eau
 *     adherenceAt(x,z) 1 sur le bitume, moins sur la terre — facultatif
 *
 * Ce qu'il ajoute par-dessus la physique :
 *   — quatre roues posées sur le relief : la caisse prend la pente, tangue au
 *     freinage et se penche en virage, et la voiture **décolle** au sommet du
 *     pont du canal au lieu d'y coller ;
 *   — des collisions de boîte : six sondes sur la grille d'obstacles, la voiture
 *     est repoussée le long du mur au lieu de s'y planter ;
 *   — **l'assistance** (`state.assistance`, allumée par défaut sur la berline) :
 *     un mur ne stoppe pas la voiture, il la **guide** — la vitesse est renvoyée
 *     le long de la façade et la caisse se réaligne sur la rue ; hors chaussée,
 *     un rappel très doux ramène vers la route la plus proche sans freiner, et
 *     s'efface dès que le joueur braque ; une voiture coincée contre un mur,
 *     gaz enfoncé, s'en dégage toute seule. Le but : que tout le monde puisse
 *     se balader sans se battre avec les murs. Voir `rappelRoute` ;
 *   — **les glissières** (`state.glissieres`, berline seulement, 25/09/2026) :
 *     `glissiereAt(x, z)` vient de `glissieres.js` — une bande de retenue
 *     derrière chaque lame posée au bord des rues. Le pilote la lit comme un
 *     mur (`obstacleAt`), donc avec l'assistance la glissière est un rail : on
 *     se trompe de trajectoire, on frotte, on continue. La caméra, elle,
 *     ignore les glissières (34 cm de haut, elle passe au-dessus) ;
 *   — une caméra amortie qui suit la trajectoire, pas le capot : en glissade on
 *     voit où l'on va, ce qui est la seule façon de rattraper une glissade ;
 *   — le son du moteur, synthétisé au régime (rien à télécharger), le crissement
 *     des pneus et le souffle du vent ;
 *   — la fumée de gomme et les traces de pneus, qui rendent la glissade lisible.
 *
 * Aucune allocation dans `update()` : vecteurs, quaternions, sondes et
 * particules sont réservés une fois pour toutes.
 */
import * as THREE from 'three';
import { construireVoiture, ECHELLE } from './voiture-model.js?v=pilote-20260925';
import { creerPhysique, REGLAGES } from './voiture-physique.js?v=pilote-20260925';
import { construireEnginTrottinette } from './trottinette.js?v=pilote-20260922';
import { construireEnginQuad } from './quad.js?v=pilote-20260925';

const GRAVITE = 9.81;
// Toucher du volant, **selon la vitesse** — comme une vraie voiture.
//
// À l'arrêt et en manœuvre, il faut tourner beaucoup le volant pour obtenir
// quelque chose : la direction est démultipliée, on se gare au calme. À
// l'allure, la même voiture répond au doigt, et c'est ce qui permet de placer
// une trajectoire au lieu de la corriger sans cesse.
//
// On fait donc varier deux choses avec la vitesse : la vitesse de montée du
// volant, et la courbe d'entrée (plus douce à l'arrêt, plus directe lancée).
// Mesuré au banc, pichenette de 0,15 s : 10,8° de cap avant tout réglage.
// Objet exporté et **lu à chaque image** : l'outil de réglage (`maps/reglages.js`,
// touche T) le modifie à chaud. Les valeurs ci-dessous sont celles du fichier.
export const TOUCHER = {
  monteeArret: 1.9, monteeLancee: 3.4,
  expoArret: 2.3, expoLancee: 1.55,
  vitessePleine: 26,               // m/s (≈ 95 km/h) : au-delà, le toucher ne change plus
  retourVolant: 9.0,
};
/** Les sauts de la trottinette, réglables de la même façon (voir `decoller`). */
export const SAUT_TROTTINETTE = {
  impulsion: 2.6,                  // m/s : le coup de jambes (Espace), 34 cm de haut sur le plat
  envolMax: 7.5,                   // m/s : au-delà, le saut n'est plus un saut mais un lancer
  turboMax: 11.5,                  // m/s sur une bande de lancement (41 km/h), contre 6,9 au moteur seul
  pencheMax: 0.55,                 // rad (≈ 31°) : au-delà, un vrai pilote pose le pied
};
const GARDE = 0.06;            // hauteur du châssis au-dessus du contact des roues (m)
const VUES_AUTO = [
  { dist: 8.2, haut: 3.0, avance: 4.0, fov: 62 },   // poursuite large
  { dist: 5.4, haut: 2.1, avance: 3.0, fov: 58 },   // collé au pare-chocs
  { dist: 0.0, haut: 1.12, avance: 6.0, fov: 70, recul: -0.35, viseHaut: 0.4 },  // capot
];
// Vue « guidon ». La vue capot d'une voiture pose la caméra **35 cm derrière**
// le point de référence : sur une trottinette, ce point est le pilote, et l'on
// se retrouve à regarder son dos. Elle passe donc devant sa tête (+20 cm), à
// hauteur d'yeux, et vise l'horizon : il ne reste dans le cadre que les mains
// sur le guidon et la route.
// Les chiffres sortent d'un calcul, pas d'un tâtonnement : le pilote se tient à
// 34 cm derrière le guidon et ses poignées sont 50 cm plus bas que ses yeux —
// ses mains sont donc **à 65° sous l'horizontale**, et aucune caméra posée à
// hauteur d'yeux ne les voit en regardant droit devant. Il faut plonger le
// regard de 26° : les mains arrivent alors à 39° de l'axe (l'ouverture en vaut
// 40) donc en bas du cadre, et l'horizon reste haut dans l'image.
// Et la caméra ne se colle pas au guidon : **plus elle s'en approche, plus il
// passe sous elle**. Posée au ras du visage du pilote (2 cm devant le centre de
// l'engin), elle garde 36 cm de recul sur les poignées.
// Elle est aussi **au-dessus de ses épaules** (1,58 m) et non à hauteur de
// poitrine : entre les deux, on regarde le long de ses bras, et le bas de
// l'image n'est plus qu'un aplat de blouson noir. Vérifié en masquant le
// pilote — c'était bien lui. Visée à 6 m (`avance` × 3) et 4,05 m plus bas :
// 34°, ce qui met les poignées (59°) dans le cadre et laisse l'horizon haut.
const VUE_GUIDON = { dist: 0.0, haut: 1.58, avance: 2.0, fov: 80, recul: 0.02, viseHaut: -4.05 };
// Sur le quad, la vue « capot » de la voiture tombait dans le dos du pilote
// (constat du 25/09/2026). Ses yeux sont à 1,68 m, sa visière à ~20 cm devant
// le centre de l'engin : la caméra passe 38 cm devant, à hauteur d'yeux, et
// regarde la route un peu en contrebas.
const VUE_QUAD = { dist: 0.0, haut: 1.70, avance: 2.0, fov: 78, recul: 0.38, viseHaut: -2.2 };

/** Facteur de lissage exponentiel : indépendant de la cadence d'images. */
const lissage = (taux, dt) => 1 - Math.exp(-taux * dt);

// ───────────────────────────────────────────────────── masque des chaussées
/**
 * Grille d'adhérence bâtie à partir du ruban de chaussée du village.
 *
 * Les rues sont un vrai volume (`scripts/poilhes/roads.py`) : on rasterise ses
 * triangles dans une grille au mètre, en ne gardant que la chaussée elle-même
 * (|u| ≤ 1 dans `routes_info`, au-delà c'est l'accotement). Le résultat sert à
 * deux choses : l'adhérence sous les roues, et le choix du point de départ —
 * une voiture commence sur la route, pas au milieu d'un jardin.
 *
 * @param {Array} villages [{ decor, x = 0, z = 0 }] — decor vient de poilhes-scene.js
 */
export function creerAdherence(villages) {
  const cartes = [];
  for (const v of villages) {
    const decor = v.decor || v;
    let info, pos, idx;
    try {
      pos = decor.arr('routes_pos'); info = decor.arr('routes_info'); idx = decor.arr('routes_idx');
    } catch (e) { continue; }
    if (!pos || !pos.length) continue;
    const demi = decor.detail || 500;
    const n = Math.ceil(demi * 2);              // une cellule par mètre
    const grille = new Uint8Array(n * n);
    const marquer = (x, z) => {
      const c = ((x + demi) | 0), r = ((z + demi) | 0);
      if (c >= 0 && r >= 0 && c < n && r < n) grille[r * n + c] = 1;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      // hors chaussée (accotement, caniveau) : on ne veut pas y rouler comme sur le bitume
      if (Math.abs(info[a * 4]) > 1.02 && Math.abs(info[b * 4]) > 1.02 && Math.abs(info[c * 4]) > 1.02) continue;
      const ax = pos[a * 3], az = pos[a * 3 + 2];
      const bx = pos[b * 3], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cz = pos[c * 3 + 2];
      // Triangles de ruban : courts et étroits. Marquer les sommets, les milieux
      // d'arêtes et le centre suffit à couvrir la chaussée au mètre près, et
      // coûte cent fois moins cher qu'un remplissage barycentrique.
      marquer(ax, az); marquer(bx, bz); marquer(cx, cz);
      marquer((ax + bx) / 2, (az + bz) / 2);
      marquer((bx + cx) / 2, (bz + cz) / 2);
      marquer((cx + ax) / 2, (cz + az) / 2);
      marquer((ax + bx + cx) / 3, (az + bz + cz) / 3);
    }
    // Le skatepark est du béton : il compte comme de la chaussée. Sans ceci on
    // roulerait dessus avec l'adhérence de l'herbe (0,74 contre 1,0), et une
    // trottinette qui patine au pied d'un tremplin ne le monte pas. C'est aussi
    // ce qui autorise `R` à nous y remettre en selle : le point de départ se
    // cherche sur la chaussée.
    if (decor.parc) decor.parc.marquerAdherence(marquer);
    // Les tabliers de pont (25/09/2026) : pas de ruban, donc pas marqués jusqu'ici.
    // Sans cela, sur un pont, le rappel vers la route tirait la voiture… dans
    // le canal, et `R` ne trouvait pas de chaussée. `ponts_axes` : [n, largeur,
    // x, y, z, …] par tablier (build_village.py).
    try {
      const axes = decor.arr('ponts_axes');
      let k = 0;
      while (axes && k + 2 <= axes.length) {
        const np = axes[k] | 0, w = axes[k + 1];
        k += 2;
        for (let i = 0; i + 1 < np && k + 6 <= axes.length; i++, k += 3) {
          const ax = axes[k], az = axes[k + 2], bx = axes[k + 3], bz = axes[k + 5];
          const L = Math.hypot(bx - ax, bz - az) || 1;
          const nx = -(bz - az) / L, nz = (bx - ax) / L;
          for (let t = 0; t <= L; t += 0.5) {
            const px = ax + (bx - ax) * (t / L), pz = az + (bz - az) * (t / L);
            for (let u = -w / 2; u <= w / 2; u += 0.5) marquer(px + nx * u, pz + nz * u);
          }
        }
        k += 3;                                        // le dernier point du tablier
      }
    } catch (e) { /* village sans ponts */ }
    cartes.push({ grille, n, demi, x: v.x || 0, z: v.z || 0 });
  }

  /** Vrai si le point tombe sur une chaussée. */
  function surRoute(x, z) {
    for (let k = 0; k < cartes.length; k++) {
      const m = cartes[k];
      const lx = x - m.x, lz = z - m.z;
      if (lx < -m.demi || lz < -m.demi || lx >= m.demi || lz >= m.demi) continue;
      if (m.grille[(((lz + m.demi) | 0) * m.n) + ((lx + m.demi) | 0)]) return true;
    }
    return false;
  }

  /** Adhérence sous la roue : bitume sec, ou terre et herbe. */
  function adherenceAt(x, z) { return surRoute(x, z) ? 1 : 0.74; }

  return { adherenceAt, surRoute, cartes };
}

// ────────────────────────────────────────────────────────────── son moteur
/**
 * Le moteur s'entend, et il est synthétisé : deux dents de scie désaccordées au
 * régime, une basse à l'octave, un filtre qui s'ouvre avec les gaz. Aucun
 * fichier audio, donc aucun chargement, et le son suit exactement le régime —
 * ce qu'un enregistrement en boucle ne sait pas faire.
 */
// Sons enregistrés, s'ils sont là. Déposer les fichiers suffit : le moteur de
// synthèse s'efface devant eux. Formats : mp3, ogg ou wav.
const SONS = {
  // On essaie plusieurs extensions : le fichier déposé n'a pas à être converti.
  // mp3 puis wav : deux essais suffisent, et chaque essai manqué laisse un 404
  // dans la console. Inutile d'en aligner cinq pour un fichier qui n'existe pas.
  demarrage: ['assets/sons/moteur-demarrage.mp3', 'assets/sons/moteur-demarrage.wav'],
  boucle: ['assets/sons/moteur-boucle.mp3', 'assets/sons/moteur-boucle.wav'],
  frein: ['assets/sons/frein.mp3', 'assets/sons/frein.wav'],
  // La trottinette a sa propre boucle, et elle est **facultative** : déposer
  // `assets/sons/trottinette-boucle.mp3` (ou .wav, .ogg) suffit, la synthèse
  // s'efface devant elle. Aucun fichier, aucune erreur — on garde le roulement.
  trottinette: ['assets/sons/trottinette-boucle.mp3', 'assets/sons/trottinette-boucle.wav'],
  // Régime de la boucle, **mesuré** et non supposé (`scripts/sons-voiture.py`).
  // La source est un enregistrement de Porsche GT3 à régime tenu : 112 Hz sans
  // la moindre dérive sur 32 s, soit 2 240 tr/min à trois allumages par tour.
  // Rien n'a été transposé — on ne corrige que ce qui est de travers.
  regimeBoucle: 2200,
};

function creerSon({ electrique = false } = {}) {
  let ctx = null, noeuds = null;
  let echantillons = null;      // { demarrage, boucle } décodés, ou null
  let lecture = null;           // la source en cours pour la boucle enregistrée
  let regimeLisse = 0;          // le régime qu'ENTEND l'oreille, pas celui du moteur
  let dernierFrein = -9;        // date du dernier crissement de frein joué (s)

  /**
   * Forme d'onde du moteur : une fondamentale et ses partielles décroissantes.
   *
   * La première version empilait deux dents de scie dans un passe-bas résonant
   * (Q = 3,5). Une dent de scie contient TOUTES les harmoniques en 1/n, et une
   * résonance en rajoute une par-dessus : cela donnait une guêpe dans un bocal,
   * fatigante en trente secondes. Ici le spectre est choisi — fort sur les trois
   * premières partielles, éteint au-delà de la huitième — et le filtre ne résonne
   * plus. C'est la différence entre un moteur et un buzzer.
   */
  function ondeMoteur(actx) {
    const amplitudes = [0, 1, 0.62, 0.38, 0.26, 0.17, 0.11, 0.07, 0.04, 0.025];
    const reel = new Float32Array(amplitudes.length);
    return actx.createPeriodicWave(reel, Float32Array.from(amplitudes));
  }

  /** Saturation douce : arrondit les crêtes au lieu de les écrêter net. */
  function courbeSaturation() {
    const n = 1024;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(x * 1.8) / Math.tanh(1.8);
    }
    return c;
  }

  function demarrer() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    const sortie = ctx.createGain();
    sortie.gain.value = 0;
    sortie.connect(ctx.destination);

    const chaleur = ctx.createWaveShaper();
    chaleur.curve = courbeSaturation();
    chaleur.oversample = '2x';
    chaleur.connect(sortie);

    const filtre = ctx.createBiquadFilter();
    filtre.type = 'lowpass';
    filtre.frequency.value = 700;
    filtre.Q.value = 0.7;          // 3,5 auparavant : c'est la résonance qui sifflait
    filtre.connect(chaleur);

    // Trois voix : la fondamentale d'allumage, sa sous-octave (le « lourd » d'un
    // gros moteur) et une jumelle désaccordée, qui donne le battement d'un moteur
    // jamais parfaitement régulier.
    const onde = ondeMoteur(ctx);
    const osc = [];
    // Une trottinette électrique n'a **pas** de moteur thermique : ni explosions,
    // ni sous-octave, ni enregistrement de six-cylindres. Reste le sifflement du
    // moteur-roue — et il se fabrique autrement.
    //
    // La première version reprenait tout du moteur à essence : la forme d'onde
    // riche en harmoniques, le passe-bas, et la saturation. À 300 ou 500 Hz, un
    // spectre taillé pour une fondamentale de 40 Hz met ses partielles en plein
    // milieu de la bande où l'oreille est la plus sensible, et la saturation en
    // rajoute. Cela ne siffle pas, cela **scie** — insupportable en trente
    // secondes.
    //
    // Ici : deux **sinus** (la fondamentale et sa quinte, très en retrait), qui
    // ne passent ni par le filtre ni par la saturation. Un sinus n'a aucune
    // harmonique : il ne peut pas devenir agressif, quelle que soit sa hauteur.
    const voix = electrique ? [[1, 0, 0.55], [1.5, 4, 0.16]] : [[1, 0, 0.5], [0.5, 0, 0.32], [1, 9, 0.22]];
    let siffle = null, roulement = null, filtreRoulement = null;
    if (electrique) {
      siffle = ctx.createGain();
      // **Le sifflement passe au second plan.** Deux sinus qui montent avec la
      // vitesse, c'est une sirène, pas une trottinette : ce qu'on entend
      // vraiment en roulant, c'est la gomme sur le bitume. Le moteur-roue ne
      // reste qu'en filigrane, et seulement quand on accélère.
      siffle.gain.value = 0.22;
      siffle.connect(sortie);

      // Le roulement : du bruit blanc filtré. Deux secondes suffisent — bouclé,
      // du bruit reste du bruit, on n'entend pas le raccord. Rien à télécharger.
      const n = Math.floor(ctx.sampleRate * 2);
      const tampon = ctx.createBuffer(1, n, ctx.sampleRate);
      const c = tampon.getChannelData(0);
      let precedent = 0;
      for (let i = 0; i < n; i++) {
        // Bruit légèrement « rose » : un blanc pur siffle dans les aigus, et
        // c'est exactement le défaut qu'on cherche à fuir.
        const blanc = Math.random() * 2 - 1;
        precedent = precedent * 0.72 + blanc * 0.28;
        c[i] = precedent * 2.2;
      }
      const src = ctx.createBufferSource();
      src.buffer = tampon;
      src.loop = true;
      filtreRoulement = ctx.createBiquadFilter();
      filtreRoulement.type = 'bandpass';
      filtreRoulement.frequency.value = 260;
      filtreRoulement.Q.value = 0.55;      // large : une bande étroite sonne comme un sifflet
      roulement = ctx.createGain();
      roulement.gain.value = 0;
      src.connect(filtreRoulement); filtreRoulement.connect(roulement); roulement.connect(sortie);
      src.start();
    }
    for (const [rapport, detune, vol] of voix) {
      const o = ctx.createOscillator();
      if (electrique) o.type = 'sine'; else o.setPeriodicWave(onde);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g); g.connect(siffle || filtre);
      o.start();
      o.userRapport = rapport;
      osc.push(o);
    }

    // bruit blanc partagé : admission, crissement de pneus, vent
    const taille = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, taille, ctx.sampleRate);
    const donnees = buffer.getChannelData(0);
    for (let i = 0; i < taille; i++) donnees[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    // Admission : un souffle sourd qui monte avec les gaz. C'est lui qui fait
    // entendre « un moteur qui tire », et pas seulement une note.
    const admission = ctx.createBiquadFilter();
    admission.type = 'lowpass';
    admission.frequency.value = 900;
    const gainAdmission = ctx.createGain();
    gainAdmission.gain.value = 0;
    source.connect(admission); admission.connect(gainAdmission); gainAdmission.connect(filtre);

    // Crissement : bande étroite mais **basse** et discrète. À 2,1 kHz avec un Q
    // de 6, c'était un sifflement qui perçait les oreilles.
    const crissement = ctx.createBiquadFilter();
    crissement.type = 'bandpass';
    crissement.frequency.value = 1400;
    crissement.Q.value = 1.8;
    const gainCrissement = ctx.createGain();
    gainCrissement.gain.value = 0;
    source.connect(crissement); crissement.connect(gainCrissement); gainCrissement.connect(sortie);

    const vent = ctx.createBiquadFilter();
    vent.type = 'lowpass';
    vent.frequency.value = 520;
    const gainVent = ctx.createGain();
    gainVent.gain.value = 0;
    source.connect(vent); vent.connect(gainVent); gainVent.connect(sortie);
    source.start();

    noeuds = { sortie, filtre, osc, gainCrissement, gainVent, gainAdmission, source,
               roulement, filtreRoulement };
    // Une trottinette n'a que faire d'un démarreur, d'une boucle de six-cylindres
    // et d'un crissement de freinage : on ne les télécharge même pas.
    if (electrique) chargerEchantillons(['trottinette']);
    else chargerEchantillons();
  }

  /**
   * Va chercher les enregistrements. S'il n'y en a pas — c'est le cas tant que
   * personne n'a déposé de fichier — on garde la synthèse, et **rien ne casse** :
   * un 404 sur un bruitage ne doit pas priver le jeu de son moteur.
   */
  async function chargerEchantillons(cles = ['demarrage', 'boucle', 'frein']) {
    if (echantillons !== null) return;
    echantillons = {};
    for (const cle of cles) {
      for (const url of SONS[cle]) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          echantillons[cle] = await ctx.decodeAudioData(await res.arrayBuffer());
          break;
        } catch (e) { /* format illisible : on essaie le suivant */ }
      }
    }
    // Les enregistrements de voiture ne concernent pas l'engin électrique : il
    // garde sa voix de synthèse, son vent et ses freins.
    if (!electrique && echantillons.boucle) basculerSurEnregistrement();
    if (!electrique && echantillons.demarrage) jouerUneFois(echantillons.demarrage, 0.7);
    // Le jour où un enregistrement de trottinette est déposé, il remplace la
    // synthèse exactement comme celui de la voiture remplace la sienne.
    if (electrique && echantillons.trottinette) {
      echantillons.boucle = echantillons.trottinette;
      basculerSurEnregistrement();
    }
  }

  /** Un coup unique : le démarreur. */
  function jouerUneFois(buffer, volume) {
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    g.gain.value = volume;
    src.buffer = buffer;
    src.connect(g); g.connect(ctx.destination);
    src.start();
  }

  /**
   * Passe de la synthèse à l'enregistrement : les oscillateurs se taisent, la
   * boucle tourne et c'est sa **vitesse de lecture** qui suit le régime — un
   * moteur qui monte dans les tours, c'est d'abord une fréquence qui monte.
   */
  function basculerSurEnregistrement() {
    if (!echantillons.boucle || lecture) return;
    for (const o of noeuds.osc) o.disconnect();
    const src = ctx.createBufferSource();
    src.buffer = echantillons.boucle;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g); g.connect(noeuds.filtre);
    src.start();
    lecture = { src, gain: g };
  }

  /** Suit le régime, les gaz, la glisse et la vitesse. Appelé à chaque image. */
  function maj(etat, gaz, dt, cmd, choc = 0) {
    if (!ctx || !noeuds) return;
    if (document.hidden) { silence(); return; }
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.02;

    // Le régime ENTENDU suit le régime réel avec un retard : un passage de
    // rapport fait chuter le compte-tours d'un coup, et une fréquence qui saute
    // s'entend comme un défaut, pas comme une boîte de vitesses.
    const cible = Math.max(600, etat.regime);
    regimeLisse += (cible - regimeLisse) * Math.min(1, dt * 9);

    if (lecture) {
      // Bornes de réaccord. Une seule boucle ne peut pas couvrir 900 à 7 400
      // tr/min — huit fois — sans qu'on entende la bande magnétique. On accepte
      // de 0,5 à 3 fois, ce qui couvre 1 100 à 6 600 tr/min ; au-delà, la
      // hauteur cesse de monter mais le timbre reste crédible.
      const rapport = Math.min(3.0, Math.max(0.5, regimeLisse / SONS.regimeBoucle));
      lecture.src.playbackRate.setTargetAtTime(rapport, t, 0.05);
      lecture.gain.gain.setTargetAtTime(0.5 + gaz * 0.4, t, 0.08);
    } else {
      if (electrique) {
        // **Ce qu'on entend d'une trottinette, c'est la gomme sur le bitume.**
        // Le roulement monte avec la vitesse et s'éclaircit avec elle ; il
        // s'éteint à l'arrêt, ce qui reste la signature d'un engin électrique.
        const v = etat.vitesse;
        noeuds.filtreRoulement.frequency.setTargetAtTime(180 + v * 62, t, 0.10);
        noeuds.roulement.gain.setTargetAtTime(Math.min(1, v / 5.5), t, 0.12);
        // Le moteur-roue ne reste qu'en filigrane, et **surtout à l'accélération** :
        // à vitesse stabilisée, un moteur-roue ne s'entend presque pas.
        const f = 150 + v * 26;
        for (const o of noeuds.osc) o.frequency.setTargetAtTime(f * (o.userRapport || 1), t, 0.12);
        noeuds.gainAdmission.gain.setTargetAtTime(0, t, 0.2);
      } else {
        // Fréquence d'allumage : trois temps par tour, comme un six-cylindres.
        const f = Math.max(22, (regimeLisse / 60) * 3);
        for (const o of noeuds.osc) o.frequency.setTargetAtTime(f * (o.userRapport || 1), t, 0.05);
        // Le filtre s'ouvre avec la charge : sourd au ralenti, clair à fond.
        noeuds.filtre.frequency.setTargetAtTime(420 + regimeLisse * 0.30 + gaz * 1500, t, 0.07);
        noeuds.gainAdmission.gain.setTargetAtTime(0.02 + gaz * 0.05, t, 0.10);
      }
    }

    // Volume d'ensemble. **Deux barèmes, et c'est nécessaire** : la synthèse est
    // un signal plein, un enregistrement mp3 est déjà normalisé et passe bien
    // plus bas dans la même chaîne. Au même réglage, le moteur s'entendait à
    // peine à côté du démarreur.
    const charge = electrique
      // À l'arrêt, plus rien : le silence fait partie du personnage.
      // Et le reste du temps, **très bas** : 0,014 au lieu de 0,06. Un moteur-roue
      // s'entend à peine, il ne couvre ni le vent ni les pas. Le sifflement ne
      // monte franchement qu'à l'accélération — c'est le seul moment où un engin
      // électrique se fait entendre, et cela suffit à donner la sensation.
      // Un bruit large s'écoute sans fatigue là où un sinus agace : on peut donc
      // monter (0,05 contre 0,014) sans retomber dans le sifflement scié.
      ? Math.min(0.05, etat.vitesse * 0.008) * (0.55 + gaz * 0.45)
      : lecture
        // Et quand on l'allume, il ne hurle pas : 0,16 au ralenti et 0,39 à
        // fond, au lieu de 0,34 et 0,78. Un enregistrement mp3 est déjà
        // normalisé — le monter comme une synthèse le rend assourdissant.
        ? 0.16 + gaz * 0.18 + Math.min(0.05, etat.vitesse * 0.0012)
        : 0.045 + gaz * 0.055 + Math.min(0.02, etat.vitesse * 0.0006);
    noeuds.sortie.gain.setTargetAtTime(charge, t, 0.10);

    const glisse = Math.max(Math.abs(etat.glisseAr), Math.abs(etat.glisseAv));
    // Un choc contre un mur crisse aussi : les pneus sont chassés de côté.
    const crisse = Math.max(choc, etat.vitesse > 5
      ? Math.min(0.05, Math.max(0, glisse - 0.22) * 0.22 + Math.max(0, etat.patinage - 1.1) * 0.03)
      : 0);
    noeuds.gainCrissement.gain.setTargetAtTime(crisse, t, 0.08);

    // Freinage appuyé : l'enregistrement part une fois, pas en boucle — et pas
    // au moindre effleurement de la pédale. Il faut de la vitesse, de la
    // pression, et qu'on n'en ait pas déjà joué un il y a une seconde et demie.
    if (!electrique && echantillons && echantillons.frein && cmd
        && (cmd.frein > 0.30 || cmd.main) && etat.vitesse > 7
        && ctx.currentTime - dernierFrein > 1.2) {
      dernierFrein = ctx.currentTime;
      jouerUneFois(echantillons.frein, Math.min(0.5, 0.12 + etat.vitesse * 0.008));
    }
    noeuds.gainVent.gain.setTargetAtTime(Math.min(0.035, etat.vitesse * 0.0007), t, 0.25);
  }

  /**
   * Coupe le son — vraiment.
   *
   * Baisser les gains ne suffit pas : un contexte audio qui tourne continue de
   * consommer, et le moindre réveil le rend à nouveau audible. On annule donc les
   * rampes en cours, on tombe à zéro, on arrête la boucle enregistrée, puis on
   * **suspend** le contexte. C'est ce qui manquait au moteur qu'on entendait
   * encore alors que personne ne jouait.
   */
  function silence() {
    if (!ctx || !noeuds) return;
    const t = ctx.currentTime;
    for (const g of [noeuds.sortie, noeuds.gainCrissement, noeuds.gainVent, noeuds.gainAdmission]) {
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(0, t, 0.03);
    }
    if (lecture) lecture.gain.gain.setTargetAtTime(0, t, 0.03);
    setTimeout(() => { if (ctx && ctx.state === 'running') ctx.suspend(); }, 160);
  }

  // **Un onglet en arrière-plan doit se taire par un événement, pas par la
  // boucle.** `requestAnimationFrame` s'y arrête net : la mise à jour du son
  // n'est plus appelée, les gains restent à leur dernière valeur, et le moteur
  // ronronne dans un onglet qu'on ne regarde même plus.
  const enVeille = () => { if (document.hidden) silence(); };
  document.addEventListener('visibilitychange', enVeille);
  addEventListener('pagehide', silence);
  addEventListener('blur', enVeille);

  return {
    demarrer, maj, silence,
    // Diagnostic : savoir en une ligne si l'on entend l'enregistrement ou la
    // synthèse. Sans cela, on règle à l'aveugle ce qu'on croit entendre.
    diagnostic: () => ({
      contexte: ctx ? ctx.state : 'absent',
      enregistrements: echantillons ? Object.keys(echantillons) : [],
      source: electrique ? 'sifflement électrique' : (lecture ? 'enregistrement' : 'synthèse'),
      regimeEntendu: Math.round(regimeLisse),
      // Le niveau réellement envoyé aux haut-parleurs, et la hauteur du
      // sifflement : un son « trop fort » se mesure au lieu de se deviner.
      niveau: noeuds ? +noeuds.sortie.gain.value.toFixed(4) : 0,
      hauteur: noeuds && noeuds.osc[0] ? Math.round(noeuds.osc[0].frequency.value) : 0,
    }),
  };
}

/**
 * Crée le mode Voiture.
 *
 * @param {object} o { scene, camera, renderer, solAt, blockedAt, adherenceAt,
 *                     keys, bounds, surRoute, glissiereAt }
 */
export function creerPilote({
  scene, camera, renderer = null, solAt, blockedAt = () => false,
  adherenceAt = () => 1, surRoute = null, keys, bounds = 2900, couleur = 0xc21d24,
  engin = 'voiture', turboAt = null, glissiereAt = null,
}) {
  // Le pilote mène ce qu'on lui donne : une voiture, ou la trottinette rendue
  // sous la même forme. Tout le reste — suspension, collisions, caméra, son —
  // ne change pas d'une ligne.
  const surDeuxRoues = engin === 'trottinette';
  // Le quad (25/09/2026) : quatre roues comme une voiture, mais court, léger,
  // sans caisse qui roule, et il saute (seuil d'envol bas, comme la trottinette).
  const surQuad = engin === 'quad';
  // **Le seuil d'envol appartient à l'engin.** Il valait 8 m/s pour tout le
  // monde — au-dessus de la vitesse de pointe de la trottinette (6,9 m/s) : elle
  // ne pouvait littéralement pas décoller, et un tremplin n'était qu'une bosse
  // dont on glissait. Une voiture, elle, ne doit pas s'envoler au moindre
  // trottoir : son seuil ne bouge pas.
  const SEUIL_ENVOL = surDeuxRoues ? 1.5 : (surQuad ? 3 : 8);
  // Depuis le 24/09/2026, la trottinette ne décolle plus sur un seuil de
  // hauteur mais sur une comparaison d'accélérations (voir `update`) : le
  // seuil de vitesse n'est plus qu'un garde-fou contre le sur-place.
  // À deux roues, ces plafonds sont ceux de `SAUT_TROTTINETTE`, lus à l'usage :
  // l'outil de réglage les change à chaud.
  const ENVOL_MAX_VOITURE = 6.5;  // m/s : au-delà, le saut n'est plus un saut mais un lancer
  // Inclinaison maximale d'un engin à deux roues, en radians (≈ 31°). Au-delà,
  // un vrai pilote pose le pied : on ne cherche pas l'angle d'une moto de
  // course sur une trottinette de village.
  // (`SAUT_TROTTINETTE.pencheMax`)
  const VUES = surDeuxRoues ? [VUES_AUTO[0], VUES_AUTO[1], VUE_GUIDON]
             : surQuad ? [VUES_AUTO[0], VUES_AUTO[1], VUE_QUAD] : VUES_AUTO;
  const voiture = surDeuxRoues ? construireEnginTrottinette({ renderer })
                : surQuad ? construireEnginQuad({ renderer })
                          : construireVoiture({ renderer, couleur });
  // On part sur une copie du réglage : `changerReglage` écrit dedans, et deux
  // voitures ne doivent pas se partager le même objet.
  const { etat, pas, poser, changerReglage, reglage } =
    creerPhysique({ ...(surDeuxRoues ? REGLAGES.trottinette : surQuad ? REGLAGES.quad : REGLAGES.gt) });
  const son = creerSon({ electrique: surDeuxRoues });

  const root = voiture.root;
  root.visible = false;
  scene.add(root);
  scene.add(voiture.ombre);
  voiture.ombre.visible = false;

  // ── objets de travail (jamais réalloués) ────────────────────────────────
  const position = root.position;
  const roueMonde = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const solRoue = [0, 0, 0, 0];
  const debattement = [0, 0, 0, 0];
  const camVoulue = new THREE.Vector3();
  let roulisCam = 0;                  // roulis de caméra lissé : pas d'à-coups
  const camCible = new THREE.Vector3();
  const avant = new THREE.Vector3();
  const droite = new THREE.Vector3();
  const travail = new THREE.Vector3();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');

  // Position locale des roues, dans l'ordre du modèle (AVG, AVD, ARG, ARD).
  //
  // **Une trottinette n'a pas l'empattement d'une voiture.** Lire le sol sur un
  // rectangle de 2,66 × 1,60 m sous un engin qui mesure 1,15 m entre ses axes
  // lissait tout ce qu'il passait : sur un tremplin, les « roues avant »
  // quittaient la rampe 1,33 m avant que l'engin n'arrive au bord, la moyenne
  // des quatre s'effondrait, et le saut partait *avant* le tremplin — mesuré,
  // l'engin retombait 75 cm sous la rampe qu'il était en train de monter.
  // Les deux roues réelles sont donc doublées côte à côte : le code de
  // suspension ne change pas d'une ligne, il lit enfin les bonnes distances.
  // La berline est affichée à `ECHELLE` (0,85 depuis le 25/09/2026, « 15 % de
  // moins, notamment en largeur ») : roues, empattement, voie et sondes suivent,
  // sinon la physique roulerait sur une voiture qui n'est plus celle qu'on voit.
  // Le quad : roues mesurées sur le modèle (voie 0,98 m, empattement 1,23 m,
  // 1,85 × 1,23 m hors tout), à l'échelle 1.
  const E = (surDeuxRoues || surQuad) ? 1 : ECHELLE;
  const ROUES = surDeuxRoues
    ? [[-0.26, -0.58], [0.26, -0.58], [-0.26, 0.57], [0.26, 0.57]]
    : surQuad
    ? [[-0.49, -0.62], [0.49, -0.62], [-0.49, 0.61], [0.49, 0.61]]
    : [[-0.80 * E, -1.34 * E], [0.80 * E, -1.34 * E], [-0.80 * E, 1.32 * E], [0.80 * E, 1.32 * E]];
  const EMPATTEMENT = surDeuxRoues ? 1.15 : surQuad ? 1.23 : 2.66 * E;   // pour l'assiette : tangage
  const VOIE = surDeuxRoues ? 0.52 : surQuad ? 0.98 : 1.60 * E;          // pour l'assiette : roulis
  // Sondes de collision : quatre coins et deux flancs, en coordonnées voiture.
  const SONDES = surDeuxRoues
    ? [[-0.30, -1.05], [0.30, -1.05], [-0.30, 1.05], [0.30, 1.05], [-0.32, 0], [0.32, 0]]
    : surQuad
    ? [[-0.58, -0.92], [0.58, -0.92], [-0.58, 0.92], [0.58, 0.92], [-0.62, 0], [0.62, 0]]
    : [[-0.92 * E, -2.02 * E], [0.92 * E, -2.02 * E], [-0.92 * E, 2.02 * E], [0.92 * E, 2.02 * E], [-0.98 * E, 0], [0.98 * E, 0]];

  const state = {
    y: 0, vy: 0, enLair: false, tangage: 0, roulis: 0,
    // Ce que le sol monte sous les roues, lissé. C'est lui qui devient la
    // vitesse d'envol au bout d'un tremplin (voir `update`).
    montee: 0, elan: 0, appuiPrec: null,
    // Sauts et figures de la trottinette (voir `decoller`, `figuresEnLair`, `atterrir`).
    vitesseSol: 0, air: 0, sautLatch: false, sautCooldown: 0,
    tangageAir: 0, tangageVit: 0, figureVit: 0, spin: 0, spinVit: 0, demandeExpire: 0,
    flipLatch: false, spinLatch: false, figureDemandee: null, cabreTenu: false,
    chute: 0, figure: null, figureN: 0, turbo: 0,
    vue: 0, dist: VUES[0].dist, fov: VUES[0].fov,
    choc: 0, vueForcee: false, allumage: 0,
    // Clignotants automatiques du quad : côté allumé, et jusqu'à quand (ms).
    clignoCote: 0, clignoJusqua: 0,
    // Assistance de conduite (voir l'en-tête) : coincé depuis combien de temps,
    // direction de la route la plus proche, prochain balayage de la grille.
    assistance: !surDeuxRoues, coince: 0, versRoute: null, prochainScan: 0, horsRoute: 0,
    // Les glissières retiennent la berline ; la trottinette passe au travers
    // (Arnaud la refait lui-même). Case à cocher dans l'outil de réglage.
    glissieres: !surDeuxRoues && !!glissiereAt,
    // Les réglages de l'assistance, modifiables à chaud (voir l'en-tête).
    reglagesAssistance: {
      rail: 0.5,           // part de la vitesse d'impact renvoyée le long du mur (0,66 avant le 25/09)
      pousse: 0.07,        // m par image de dégagement hors d'un mur, au plus (0,14 avant le 25/09)
      realigner: 1.2,      // rad/s de réalignement de la caisse sur le mur touché
      degager: 0.6,        // m/s de recul quand on est coincé gaz enfoncé
      rappelVolant: 0.45,  // part du volant que le rappel vers la route peut prendre
      rappelRoues: 3,      // nombre de roues hors chaussée à partir duquel on rappelle
      herbe: 0.5,          // 0 = herbe d'origine, 1 = herbe aussi adhérente que le bitume
    },
    chocSon: 0,   // petit crissement d'un choc contre un mur, s'éteint en un quart de seconde
    // **Les bruitages s'entendent d'emblée**, voiture comme trottinette — décision
    // d'Arnaud du 24/09/2026 (« remettre surtout les bruitages de la voiture »).
    // Le moteur de la voiture avait été rendu muet par défaut : ce qu'on lui
    // reprochait alors, c'était de démarrer tout seul et de tourner sans fin ;
    // le vrai fauteur de bruit était en fait l'ambiance de fond (voir
    // `background-ambience.js`), corrigée depuis. Un moteur porté par
    // l'accélération est ce qu'on veut entendre quand l'engin roule.
    // **M** le coupe, le bouton « ♪ Moteur » aussi, **Maj + M** coupe toute la page.
    son: true,
  };

  // ── fumée de gomme ───────────────────────────────────────────────────────
  const FUMEE = 26;
  const fumee = [];
  {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const rad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
    rad.addColorStop(0, 'rgba(235,235,235,.72)');
    rad.addColorStop(1, 'rgba(225,225,225,0)');
    g.fillStyle = rad; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < FUMEE; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.userData.vie = 0;
      scene.add(s);
      fumee.push(s);
    }
  }
  let prochaineFumee = 0;
  function lacherFumee(x, y, z) {
    const s = fumee[prochaineFumee];
    prochaineFumee = (prochaineFumee + 1) % FUMEE;
    s.position.set(x, y + 0.15, z);
    s.scale.setScalar(0.7);
    s.material.opacity = 0.5;
    s.userData.vie = 1.1;
    s.visible = true;
  }

  // ── traces de pneus ──────────────────────────────────────────────────────
  // Multiplication : un rectangle blanc ne fait rien, un rectangle gris assombrit
  // la route. La trace s'efface en revenant vers le blanc, sans coût de tri.
  const TRACES = 160;
  const traces = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.26, 0.85),
    new THREE.MeshBasicMaterial({
      blending: THREE.MultiplyBlending, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
    TRACES,
  );
  traces.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  traces.count = TRACES;
  traces.frustumCulled = false;
  traces.visible = false;
  scene.add(traces);
  const traceMat = new THREE.Matrix4();
  const traceQuat = new THREE.Quaternion();
  const traceEch = new THREE.Vector3(1, 1, 1);
  const traceVie = new Float32Array(TRACES);
  const traceCouleur = new THREE.Color();
  let prochaineTrace = 0;
  {
    // toutes les instances commencent « effacées » (blanches) et hors du sol
    traceMat.makeScale(0.0001, 0.0001, 0.0001);
    for (let i = 0; i < TRACES; i++) {
      traces.setMatrixAt(i, traceMat);
      traces.setColorAt(i, traceCouleur.setRGB(1, 1, 1));
    }
  }
  function poserTrace(x, y, z, yaw, force) {
    const i = prochaineTrace;
    prochaineTrace = (prochaineTrace + 1) % TRACES;
    traceQuat.setFromEuler(euler.set(-Math.PI / 2, yaw, 0));
    traceMat.compose(travail.set(x, y + 0.035, z), traceQuat, traceEch);
    traces.setMatrixAt(i, traceMat);
    traceVie[i] = 8 * Math.min(1, force);
    traces.instanceMatrix.needsUpdate = true;
  }

  // ── commandes ────────────────────────────────────────────────────────────
  const cmd = { gaz: 0, frein: 0, direction: 0, main: false, saut: false, flip: false, spin: false, cabre: 0 };
  let volant = 0;                     // position brute du volant, avant courbe
  const doigt = { x: 0, y: 0 };       // manche tactile : x dirige, y accélère ou freine
  let mainTactile = false;
  const tenue = (code) => keys && keys.has(code);

  /** Consigne tactile, entre −1 et 1. */
  function commande(x, y) {
    doigt.x = THREE.MathUtils.clamp(x, -1, 1);
    doigt.y = THREE.MathUtils.clamp(y, -1, 1);
  }
  function setMain(actif) { mainTactile = !!actif; }

  function lireCommandes(dt) {
    const gauche = tenue('ArrowLeft') || tenue('KeyA') || tenue('KeyQ');
    const droit = tenue('ArrowRight') || tenue('KeyD');
    const avance = tenue('ArrowUp') || tenue('KeyW') || tenue('KeyZ');
    const recule = tenue('ArrowDown') || tenue('KeyS');
    // Le volant revient au centre tout seul, et ne part pas à fond d'un coup :
    // au clavier, c'est ce qui sépare une voiture d'un curseur.
    // Signe : la commande est naturelle — positif = à droite. C'est
    // `voiture-physique.js` qui porte la convention (latéral positif vers la
    // droite, lacet positif vers la gauche comme le `yaw` de Three.js), et elle
    // y est cohérente de bout en bout : dérives, moment, termes de Coriolis,
    // accélération latérale. Retourner la commande ici « corrigeait » le volant
    // mais laissait la caisse pencher du mauvais côté en virage.
    const vise = THREE.MathUtils.clamp((droit ? 1 : 0) - (gauche ? 1 : 0) + doigt.x, -1, 1);
    // Le volant monte lentement et **revient vite** au centre : on corrige une
    // trajectoire plus souvent qu'on n'engage un virage.
    // `k` = 0 à l'arrêt, 1 à l'allure : c'est lui qui donne son caractère au
    // volant. Le retour au centre, lui, ne change pas — on veut toujours pouvoir
    // relâcher vite.
    const k = Math.min(1, Math.abs(etat.u) / TOUCHER.vitessePleine);
    const montee = TOUCHER.monteeArret + (TOUCHER.monteeLancee - TOUCHER.monteeArret) * k;
    volant += (vise - volant) * lissage(vise === 0 ? TOUCHER.retourVolant : montee, dt);
    // Courbe exponentielle : les petits gestes restent petits, le fond de course
    // garde toute son autorité. Sans elle, une simple pichenette sur la flèche
    // faisait tourner la voiture de onze degrés — mesuré à 60 km/h ; avec, moins
    // de trois, et un virage tenu vaut toujours cinquante. C'est la même idée que
    // l'expo du manche dans `input-shaping.js`, pour la même raison.
    const expo = TOUCHER.expoArret + (TOUCHER.expoLancee - TOUCHER.expoArret) * k;
    cmd.direction = Math.sign(volant) * Math.pow(Math.abs(volant), expo);
    const gazVise = Math.max(avance ? 1 : 0, Math.max(0, -doigt.y));
    const freinVise = Math.max(recule ? 1 : 0, Math.max(0, doigt.y));
    cmd.gaz += (gazVise - cmd.gaz) * lissage(11, dt);
    cmd.frein += (freinVise - cmd.frein) * lissage(16, dt);
    // À deux roues, Espace n'est pas un frein à main : c'est le coup de jambes
    // qui fait sauter (`decoller`). F et G lancent les figures en l'air, et les
    // flèches haut / bas y inclinent l'engin — au sol elles restent gaz et frein.
    cmd.main = surDeuxRoues ? false : (tenue('Space') || mainTactile);
    cmd.saut = surDeuxRoues && (tenue('Space') || mainTactile);
    cmd.flip = surDeuxRoues && tenue('KeyF');
    cmd.spin = surDeuxRoues && tenue('KeyG');
    // Clignotants (quad) : ils suivent le volant tout seuls — un coup de guidon
    // franc d'un côté les allume, ils restent une seconde après qu'on a
    // redressé. X : feux de détresse, tant qu'on l'appuie.
    if (voiture.setClignotant) {
      const franc = Math.abs(cmd.direction) > 0.45 ? Math.sign(cmd.direction) : 0;
      if (franc) { state.clignoCote = franc; state.clignoJusqua = performance.now() + 1000; }
      const auto = performance.now() < state.clignoJusqua ? state.clignoCote : 0;
      voiture.setClignotant(tenue('KeyX') ? 2 : (auto || 0));
    }
    cmd.cabre = surDeuxRoues ? THREE.MathUtils.clamp((avance ? 1 : 0) - (recule ? 1 : 0) - doigt.y, -1, 1) : 0;
  }

  // ── obstacles ────────────────────────────────────────────────────────────
  /**
   * Ce contre quoi la carrosserie bute : les murs et l'eau du décor, plus la
   * bande de retenue des glissières quand elles sont actives. C'est la seule
   * fonction que lisent les collisions, le rappel et le placement — la caméra
   * garde `blockedAt`, une glissière ne lui cache rien.
   */
  const obstacleAt = (x, z) => blockedAt(x, z) || (state.glissieres && glissiereAt(x, z));

  // ── entrée, sortie ───────────────────────────────────────────────────────
  /** Cherche la route la plus proche, sinon la première cellule libre. */
  function placer(x, z, yaw) {
    let px = x, pz = z, trouve = false;
    if (surRoute) {
      for (let r = 0; r <= 90 && !trouve; r += 2) {
        for (let a = 0; a < Math.PI * 2; a += r ? 1.6 / r : 7) {
          const ex = x + Math.cos(a) * r, ez = z + Math.sin(a) * r;
          if (surRoute(ex, ez) && !obstacleAt(ex, ez)) { px = ex; pz = ez; trouve = true; break; }
        }
      }
    }
    if (!trouve) {
      for (let r = 0; r <= 60 && !trouve; r += 1) {
        for (let a = 0; a < Math.PI * 2; a += r ? 1.2 / r : 7) {
          const ex = x + Math.cos(a) * r, ez = z + Math.sin(a) * r;
          if (!obstacleAt(ex, ez)) { px = ex; pz = ez; trouve = true; break; }
        }
      }
    }
    // Cap : on suit la rue. On garde la direction où la chaussée continue le
    // plus loin, la plus proche du regard — se garer en travers d'une ruelle
    // n'a aucun intérêt.
    let capChoisi = yaw, meilleur = -1;
    if (surRoute) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        let d = 0;
        while (d < 34 && surRoute(px - Math.sin(a) * (d + 2), pz - Math.cos(a) * (d + 2))) d += 2;
        const accord = d + 8 * Math.cos(a - yaw);
        if (accord > meilleur) { meilleur = accord; capChoisi = a; }
      }
    }
    // **Au milieu de la rue** (Arnaud, 25/09/2026 : « le R doit vraiment nous
    // remettre au milieu de la route, c'est très important »). Le point trouvé
    // ci-dessus est le plus proche, donc au bord ; on mesure la chaussée à
    // gauche et à droite du cap choisi et l'on se recentre.
    if (surRoute && trouve) {
      const rx = Math.cos(capChoisi), rz = -Math.sin(capChoisi);   // « droite » pour ce cap
      let dD = 0, dG = 0;
      while (dD < 12 && surRoute(px + rx * (dD + 0.25), pz + rz * (dD + 0.25)) && !blockedAt(px + rx * (dD + 0.25), pz + rz * (dD + 0.25))) dD += 0.25;
      while (dG < 12 && surRoute(px - rx * (dG + 0.25), pz - rz * (dG + 0.25)) && !blockedAt(px - rx * (dG + 0.25), pz - rz * (dG + 0.25))) dG += 0.25;
      const recentre = (dD - dG) / 2;
      px += rx * recentre; pz += rz * recentre;
    }
    poser(px, pz, capChoisi);
    state.y = solAt(px, pz) + GARDE;
    state.vy = 0;
    state.enLair = false;
    state.montee = 0;
    state.elan = 0;
    state.appuiPrec = null;
    state.tangage = state.roulis = 0;
    state.vitesseSol = 0; state.air = 0; state.tangageAir = 0; state.tangageVit = 0;
    state.spin = 0; state.spinVit = 0; state.chute = 0; state.figureDemandee = null;
  }

  function enter(x, z, yaw = 0) {
    placer(x, z, yaw);
    root.visible = true;
    voiture.ombre.visible = true;
    traces.visible = true;
    state.vue = 0;
    state.dist = VUES[0].dist;
    if (state.son) son.demarrer();
    majCamera(1, true);
  }

  /** Allume ou coupe le moteur — touche M. Rend l'état pour l'affichage. */
  function basculerSon() {
    state.son = !state.son;
    if (state.son) son.demarrer(); else son.silence();
    return state.son;
  }

  function exit() {
    root.visible = false;
    voiture.ombre.visible = false;
    traces.visible = false;
    son.silence();
    if (camera.fov !== state.fovOrigine && state.fovOrigine) {
      camera.fov = state.fovOrigine;
      camera.updateProjectionMatrix();
    }
  }

  function basculerVue() {
    state.vue = (state.vue + 1) % VUES.length;
  }

  /** Remet la voiture sur la route la plus proche, dans son cap actuel. */
  function redresser() { placer(etat.x, etat.z, etat.yaw); }

  // ── sauts et figures (trottinette) ───────────────────────────────────────
  /** Quitte le sol à la vitesse verticale donnée ; les figures partent de zéro. */
  function decoller(vy) {
    state.enLair = true;
    state.vy = vy;
    state.air = 0;
    state.tangageAir = 0;
    state.tangageVit = 0;
    state.figureVit = 0;
    state.spin = 0;
    state.spinVit = 0;
    state.flipLatch = cmd.flip;
    state.spinLatch = cmd.spin;
    // Une figure demandée dans la demi-seconde avant le bord compte : on
    // appuie souvent un peu avant de décoller, pas exactement dessus.
    if (state.demandeExpire <= 0) state.figureDemandee = null;
    // Une flèche déjà tenue au décollage (le gaz, presque toujours) ne doit
    // pas devenir une inclinaison : elle ne compte qu'une fois relâchée puis
    // reprise. Sans ce verrou, plein gaz sur un tremplin = double backflip
    // involontaire, mesuré.
    state.cabreTenu = cmd.cabre !== 0;
  }

  /**
   * Temps de vol restant. Le sol d'arrivée n'est pas celui d'en dessous — au
   * bout d'un tremplin, dessous, c'est le trou — mais celui où l'on va
   * retomber : on vise, on regarde le sol là-bas, et on recommence une fois.
   */
  function tempsDeVolRestant() {
    const vx = -Math.sin(etat.yaw) * etat.u, vz = -Math.cos(etat.yaw) * etat.u;
    let solArrivee = solAt(etat.x, etat.z), T = 0;
    for (let i = 0; i < 2; i++) {
      const h = Math.max(0, state.y - (solArrivee + GARDE));
      T = (state.vy + Math.sqrt(Math.max(0, state.vy * state.vy + 2 * GRAVITE * h))) / GRAVITE;
      const s = solAt(etat.x + vx * T, etat.z + vz * T);
      if (s > -1e8) solArrivee = s;
    }
    return T;
  }

  /**
   * Vrai si, laissée à elle-même, la trottinette serait à `marge` au-dessus du
   * sol dans `tau` secondes : c'est la définition d'un décollage. On regarde
   * le sol là où l'on sera, pas sous les roues — au sommet d'une bosse le sol
   * fuit devant, et au bord d'une table il n'y a plus rien.
   */
  function vaDecoller(vy, tau, marge) {
    const vx = -Math.sin(etat.yaw) * etat.u, vz = -Math.cos(etat.yaw) * etat.u;
    // Quatre points le long du chemin, pas seulement le dernier : depuis le
    // milieu d'un tremplin, le point d'arrivée est déjà au-dessus du trou alors
    // que la rampe, entre les deux, est encore au-dessus de la trajectoire. On
    // partait deux mètres trop tôt, on retombait sur la rampe une image plus
    // tard, et ce faux départ effaçait l'élan avant le vrai bord.
    for (let k = 1; k <= 4; k++) {
      const t = tau * k / 4;
      const yLibre = state.y + vy * t - 0.5 * GRAVITE * t * t;
      const solLa = solAt(etat.x + vx * t, etat.z + vz * t);
      if (solLa < -1e8 || yLibre - (solLa + GARDE) <= marge) return false;
    }
    return true;
  }

  /**
   * Demande une figure : 'flip' (looping arrière — ou avant si l'on pousse sur
   * la flèche bas), 'spin' (tour complet). Au sol, la demande attend le prochain
   * saut ; en l'air, elle part tout de suite. C'est ce que fait le bouton tactile.
   */
  function figure(type) { state.figureDemandee = type; }

  /**
   * En l'air, la trottinette tourne. Une figure demandée est **calibrée pour se
   * boucler juste avant l'atterrissage** : un looping sur un saut d'une seconde
   * tourne à un tour par seconde, sur un saut d'une demi-seconde deux fois plus
   * vite (plafonné : au-delà de deux tours par seconde on ne lit plus rien).
   * Les flèches haut / bas ajoutent une inclinaison libre, c'est ce qui permet
   * de rattraper une réception — ou de la rater.
   */
  function figuresEnLair(dt) {
    if (cmd.flip && !state.flipLatch) state.figureDemandee = 'flip';
    if (cmd.spin && !state.spinLatch) state.figureDemandee = 'spin';
    state.flipLatch = cmd.flip;
    state.spinLatch = cmd.spin;
    if (state.figureDemandee) {
      const T = Math.max(0.45, tempsDeVolRestant() - 0.06);
      const omega = Math.min(2 * Math.PI / T, 13);
      if (state.figureDemandee === 'flip') state.figureVit += omega * (cmd.cabre < -0.3 ? -1 : 1);
      else state.spinVit += omega * (cmd.direction < -0.2 ? -1 : 1);
      state.figureDemandee = null;
    }
    // L'inclinaison libre s'amortit ; la figure, elle, tourne rond jusqu'au
    // bout — l'amortir la faisait retomber à 260° : chute à chaque looping.
    if (cmd.cabre === 0) state.cabreTenu = false;
    if (!state.cabreTenu) state.tangageVit += cmd.cabre * 5 * dt;
    state.tangageVit *= Math.max(0, 1 - 0.35 * dt);
    state.tangageAir += (state.figureVit + state.tangageVit) * dt;
    state.spin += state.spinVit * dt;
  }

  /**
   * Retour au sol : droit, c'est une figure réussie ; à l'envers, c'est une
   * chute. « Droit » tolère 60° de tangage et 57° de vrille : ce qui reste se
   * résorbe au sol au lieu de sauter d'un coup, et c'est ce qu'on voit comme
   * une réception un peu lourde.
   */
  // La foule acclame une figure réussie — léger, en fond, jamais sur une chute.
  // Un enregistrement (assets/sons/acclamation.mp3, 5,5 s), rejoué du début à
  // chaque figure ; il suit le bouton du son (M) comme les autres bruitages.
  // Deux enregistrements depuis le 25/09/2026 (« Cris d'encouragements
  // spectacle », 3,6 s, fourni par Arnaud) : la foule ne dit pas toujours la
  // même chose, on tire au sort.
  const acclamations = ['assets/sons/acclamation.mp3?v=foule-20260924', 'assets/sons/encouragements.mp3?v=foule-20260925']
    .map((src) => { const a = new Audio(src); a.preload = 'auto'; return a; });
  // … et « uh-oh » sur une chute (assets/sons/uh-oh.mp3).
  const uhOh = new Audio('assets/sons/uh-oh.mp3?v=foule-20260924');
  uhOh.preload = 'auto';
  function jouerUneFois(piste, volume) {
    if (!state.son) return;
    piste.volume = volume;
    piste.currentTime = 0;
    const p = piste.play();
    if (p?.catch) p.catch(() => {});
  }
  const acclamer = (force) => jouerUneFois(acclamations[Math.random() < 0.5 ? 0 : 1], 0.22 * force);

  function atterrir() {
    const toursFlip = Math.round(state.tangageAir / (2 * Math.PI));
    const resteFlip = state.tangageAir - toursFlip * 2 * Math.PI;
    const toursSpin = Math.round(state.spin / (2 * Math.PI));
    const resteSpin = state.spin - toursSpin * 2 * Math.PI;
    const droit = Math.abs(resteFlip) < 1.05 && Math.abs(resteSpin) < 1.0;
    state.tangageAir = 0;
    state.tangageVit = 0;
    state.figureVit = 0;
    state.spin = resteSpin;
    state.spinVit = 0;
    state.tangage += resteFlip;
    state.vitesseSol = 0;
    const noms = [];
    if (toursFlip > 0) noms.push(toursFlip === 1 ? 'Backflip' : toursFlip === 2 ? 'Double backflip' : `${toursFlip} backflips`);
    if (toursFlip < 0) noms.push(toursFlip === -1 ? 'Frontflip' : toursFlip === -2 ? 'Double frontflip' : `${-toursFlip} frontflips`);
    if (toursSpin) noms.push(String(Math.abs(toursSpin) * 360));
    if (!droit) {
      // Réception à l'envers : on tombe, on perd trois quarts de la vitesse,
      // et l'engin tangue une seconde le temps de se rasseoir.
      etat.u *= 0.25;
      state.chute = 1.0;
      state.figure = { nom: 'Chute !', detail: noms.join(' + '), n: ++state.figureN };
      jouerUneFois(uhOh, 0.35);
    } else if (noms.length) {
      state.figure = { nom: noms.join(' + '), detail: `${state.air.toFixed(1)} s en l’air`, n: ++state.figureN };
      acclamer(Math.min(1, 0.6 + noms.length * 0.2));
    } else if (state.air > 0.9) {
      state.figure = { nom: 'Gros saut', detail: `${state.air.toFixed(1)} s en l’air`, n: ++state.figureN };
      acclamer(0.6);
    }
    if (state.vy < -6) etat.u *= 0.93;
  }

  // ── collisions ───────────────────────────────────────────────────────────
  const normale = new THREE.Vector2();
  /**
   * Repousse la voiture hors des murs. On teste six points de la carrosserie ;
   * pour chacun qui touche, la sortie est la moyenne des directions libres —
   * ce qui donne une normale utilisable sans jamais lire la géométrie du
   * bâtiment, dont on n'a ici qu'une grille de cases occupées.
   */
  function collisions(dt) {
    const s = Math.sin(etat.yaw), c = Math.cos(etat.yaw);
    let touche = 0;
    state.choc = 0;
    normale.set(0, 0);
    for (let i = 0; i < SONDES.length; i++) {
      const lx = SONDES[i][0], lz = SONDES[i][1];
      const px = etat.x + c * lx - s * lz;
      const pz = etat.z - s * lx - c * lz;
      if (!obstacleAt(px, pz)) continue;
      touche++;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a);
        if (!obstacleAt(px + dx * 1.5, pz + dz * 1.5)) { normale.x += dx; normale.y += dz; }
      }
    }
    if (!touche) return;
    if (normale.lengthSq() < 1e-4) { normale.set(-Math.sin(etat.yaw), -Math.cos(etat.yaw)); }
    normale.normalize();

    // vitesse monde, projetée sur la normale du mur
    const vx = -s * etat.u + c * etat.v;
    const vz = -c * etat.u - s * etat.v;
    const vn = vx * normale.x + vz * normale.y;
    state.choc = Math.max(state.choc, Math.max(0, -vn));
    if (vn < -2.5) state.chocSon = Math.max(state.chocSon, Math.min(0.06, (-vn) * 0.008));
    // Dégagement progressif : 6 cm par image et par sonde au lieu de 16. Une
    // poussée trop franche fait rebondir la voiture entre deux murs d'une ruelle,
    // et c'est ce va-et-vient qu'on voyait comme un tremblement.
    // Adouci le 25/09/2026 (« les rebonds sont un peu trop forts ») : 3 cm par
    // sonde, 7 cm au plus — la composante qui rentre est de toute façon retirée
    // plus bas, la poussée n'a qu'à résorber la pénétration d'une image.
    const pousse = Math.min(state.reglagesAssistance.pousse, 0.03 * touche);
    etat.x += normale.x * pousse;
    etat.z += normale.y * pousse;
    if (vn < 0 && state.assistance) {
      // Assistance : le mur est un rail. La vitesse qui rentrait dans la façade
      // est **renvoyée le long du mur** (aux deux tiers) au lieu d'être perdue :
      // une voiture lancée qui accroche un angle continue sa route, un peu
      // freinée, jamais plantée. C'est ce qui rend les ruelles amusantes au
      // lieu de pénibles.
      const tx0 = -normale.y, tz0 = normale.x;
      const vt = vx * tx0 + vz * tz0;
      const sens = vt >= 0 ? 1 : -1;
      const tx = tx0 * sens, tz = tz0 * sens;
      const vitesse = Math.abs(vt) * 0.97 + (-vn) * state.reglagesAssistance.rail;
      const fx = tx * vitesse, fz = tz * vitesse;
      etat.u = -(fx * s + fz * c);
      etat.v = fx * c - fz * s;
      etat.lacet *= 0.55;
      // La caisse se réaligne sur la rue : un petit pas de cap vers le mur,
      // dans le sens où l'on roule. Pas à l'arrêt, une voiture garée ne pivote pas.
      if (Math.abs(etat.u) > 1.5) {
        const capMur = Math.atan2(-tx, -tz);
        let ecart = capMur - etat.yaw;
        ecart = Math.atan2(Math.sin(ecart), Math.cos(ecart));
        if (etat.u < 0) ecart = Math.atan2(Math.sin(ecart + Math.PI), Math.cos(ecart + Math.PI));
        const pasMax = state.reglagesAssistance.realigner * dt;
        etat.yaw += THREE.MathUtils.clamp(ecart, -pasMax, pasMax);
      }
    } else if (vn < 0) {
      // On retire la composante qui rentre dans le mur — presque sans rebond :
      // une façade renvoie une voiture, elle ne la catapulte pas. Le glissement
      // le long du mur, lui, est à peine freiné, sinon frôler un angle arrête
      // net une voiture lancée et l'on passe son temps à repartir de zéro.
      const nx = vx - vn * normale.x * 1.0, nz = vz - vn * normale.y * 1.0;
      const fx = nx * 0.95, fz = nz * 0.95;
      etat.u = -(fx * s + fz * c);
      etat.v = fx * c - fz * s;
      etat.lacet *= 0.70;   // moins de coup de raquette en lacet
    }
    // Coincé : nez dans un mur, gaz enfoncé, et rien ne bouge depuis une demi-
    // seconde. On recule d'un pas dans la direction libre et on tourne la caisse
    // vers elle, jusqu'à ce que ça reparte — sans que le joueur ait à trouver
    // la marche arrière.
    if (state.assistance) {
      const veut = (cmd.gaz || 0) > 0.3 || (cmd.frein || 0) > 0.3;
      if (veut && Math.abs(etat.u) < 0.8) state.coince += dt; else state.coince = 0;
      if (state.coince > 0.5) {
        const r = state.reglagesAssistance;
        etat.x += normale.x * r.degager * dt;
        etat.z += normale.y * r.degager * dt;
        const capLibre = Math.atan2(-normale.x, -normale.y);
        let ecart = capLibre - etat.yaw;
        ecart = Math.atan2(Math.sin(ecart), Math.cos(ecart));
        const pasMax = 0.6 * dt;
        etat.yaw += THREE.MathUtils.clamp(ecart, -pasMax, pasMax);
      }
    }
  }

  // ── rappel vers la route ─────────────────────────────────────────────────
  /**
   * Hors chaussée, ramène **très doucement** vers la route la plus proche — en
   * tournant le volant, jamais en déplaçant la voiture : la caisse ne bouge que
   * par ses pneus, sinon elle « ne colle plus à la route ». Jamais de frein.
   * Le rappel s'efface dès que le joueur braque — on l'aide, on ne conduit pas
   * à sa place — et il ne s'éveille qu'avec trois roues dans l'herbe : la
   * chaussée n'est connue qu'au mètre près, et frôler un bord n'est pas sortir.
   * La grille des chaussées est balayée cinq fois par seconde, sur seize
   * directions et douze rayons : deux cents lectures, rien.
   * S'appelle AVANT la physique, puisqu'il agit sur la commande.
   */
  function rappelRoute(dt) {
    if (!state.assistance || !surRoute || surDeuxRoues || state.enLair) { state.versRoute = null; return; }
    if (state.horsRoute < state.reglagesAssistance.rappelRoues) { state.versRoute = null; return; }
    state.prochainScan -= dt;
    if (state.prochainScan <= 0 || !state.versRoute) {
      state.prochainScan = 0.2;
      let trouve = null;
      for (let r = 2; r <= 24 && !trouve; r += 2) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const ex = etat.x + Math.cos(a) * r, ez = etat.z + Math.sin(a) * r;
          if (surRoute(ex, ez) && !obstacleAt(ex, ez)) { trouve = { dx: Math.cos(a), dz: Math.sin(a), dist: r }; break; }
        }
      }
      state.versRoute = trouve;
    }
    const vr = state.versRoute;
    if (!vr) return;
    // Force : réduite par le braquage du joueur, nulle à l'arrêt.
    const libre = 1 - Math.min(1, Math.abs(cmd.direction || 0) * 1.4);
    const roule = Math.min(1, Math.abs(etat.u) / 4);
    const force = libre * roule;
    if (force <= 0) return;
    // Cap : on vise la route, dans le sens de marche ; l'écart devient un peu
    // de volant (positif = droite, comme `cmd.direction`).
    let capRoute = Math.atan2(-vr.dx, -vr.dz);
    if (etat.u < 0) capRoute += Math.PI;
    let ecart = capRoute - etat.yaw;
    ecart = Math.atan2(Math.sin(ecart), Math.cos(ecart));
    const volant = -THREE.MathUtils.clamp(ecart / 0.6, -1, 1) * state.reglagesAssistance.rappelVolant * force;
    cmd.direction = THREE.MathUtils.clamp((cmd.direction || 0) + volant, -1, 1);
  }

  // ── caméra ───────────────────────────────────────────────────────────────
  function majCamera(dt, immediat = false) {
    // Une trottinette fait deux mètres de long : la caméra d'une GT la perdrait
    // au fond du cadre. Le recul est réduit d'un tiers.
    const echelleVue = surDeuxRoues ? 0.62 : 1;
    if (!state.fovOrigine) state.fovOrigine = camera.fov;
    const vue = VUES[state.vue];
    avant.set(-Math.sin(etat.yaw), 0, -Math.cos(etat.yaw));
    droite.set(-avant.z, 0, avant.x);

    if (vue.dist === 0) {
      // Vue capot : la caméra est sur la voiture, elle en prend l'assiette.
      camVoulue.copy(position)
        .addScaledVector(avant, vue.recul === undefined ? -0.35 : vue.recul)
        .add(travail.set(0, vue.haut, 0));
      camera.position.copy(camVoulue);
      camCible.copy(position).addScaledVector(avant, vue.avance * 3)
        .add(travail.set(0, vue.haut + (vue.viseHaut === undefined ? 0.4 : vue.viseHaut), 0));
      camera.lookAt(camCible);
      // Le regard suit l'inclinaison sans la copier : une trottinette se couche
      // à 31°, et une image qui bascule d'autant donne le mal de mer. Un tiers
      // suffit à la sentir.
      camera.rotateZ(-state.roulis * (surDeuxRoues ? 0.33 : 0.5));
    } else {
      // En poursuite, la caméra recule dans l'axe de la **trajectoire** : en
      // glissade, on regarde où la voiture va, pas où pointe son capot.
      const vx = -Math.sin(etat.yaw) * etat.u + Math.cos(etat.yaw) * etat.v;
      const vz = -Math.cos(etat.yaw) * etat.u - Math.sin(etat.yaw) * etat.v;
      const rapide = Math.min(1, etat.vitesse / 9);
      travail.set(vx, 0, vz);
      if (travail.lengthSq() > 0.01) travail.normalize(); else travail.copy(avant);
      travail.lerp(avant, 1 - 0.55 * rapide).normalize();

      const recul = vue.dist * echelleVue * (1 + Math.min(0.35, etat.vitesse / 160));
      camVoulue.copy(position).addScaledVector(travail, -recul);
      camVoulue.y = position.y + vue.haut;
      // La caméra ne traverse pas les murs : on la ramène jusqu'à ce qu'elle soit libre.
      let d = recul;
      while (d > 2.2 && blockedAt(camVoulue.x, camVoulue.z)) {
        d -= 0.8;
        camVoulue.copy(position).addScaledVector(travail, -d);
        camVoulue.y = position.y + vue.haut;
      }
      const solCam = solAt(camVoulue.x, camVoulue.z) + 1.1;
      if (camVoulue.y < solCam) camVoulue.y = solCam;

      camera.position.lerp(camVoulue, immediat ? 1 : lissage(6.5, dt));
      camCible.copy(position).addScaledVector(avant, vue.avance).add(travail.set(0, 1.05, 0));
      camera.lookAt(camCible);
      // léger roulis de caméra : il se sent plus qu'il ne se voit, et il porte la vitesse
      // Roulis de caméra : sur la seule accélération latérale, **lissée**. Le
      // terme en lacet réagissait aux à-coups — un frottement de mur faisait
      // trembler tout l'écran, ce qui est le défaut le plus fatigant d'un jeu.
      roulisCam += (THREE.MathUtils.clamp(etat.charge * 0.030, -0.09, 0.09) - roulisCam) * lissage(4, dt);
      camera.rotateZ(roulisCam);
    }

    const fovVise = vue.fov + Math.min(14, etat.vitesse * 0.22);
    if (Math.abs(camera.fov - fovVise) > 0.15) {
      camera.fov += (fovVise - camera.fov) * (immediat ? 1 : lissage(3.5, dt));
      camera.updateProjectionMatrix();
    }
  }

  // ── boucle ───────────────────────────────────────────────────────────────
  /**
   * Une image de conduite.
   * @param {number} dt secondes
   * @param {object} tactile { x, y, active } — le manche du téléphone, facultatif
   */
  function update(dt, tactile) {
    if (!root.visible) return;
    if (dt > 0.05) dt = 0.05;
    if (tactile) {
      if (tactile.active) commande(tactile.x, tactile.y);
      else if (!tactile.active && (doigt.x || doigt.y)) commande(0, 0);
    }
    lireCommandes(dt);

    // Adhérence moyenne sous les quatre roues : deux roues dans l'herbe, et la
    // voiture tire de ce côté — c'est ce qui rend les bas-côtés dangereux.
    const s = Math.sin(etat.yaw), c = Math.cos(etat.yaw);
    let mu = 0, horsRoute = 0;
    for (let i = 0; i < 4; i++) {
      const lx = ROUES[i][0], lz = ROUES[i][1];
      const px = etat.x + c * lx - s * lz;
      const pz = etat.z - s * lx - c * lz;
      roueMonde[i].set(px, 0, pz);
      solRoue[i] = solAt(px, pz);
      const a = adherenceAt(px, pz);
      mu += a;
      if (a < 1) horsRoute++;
    }
    mu /= 4;
    state.horsRoute = horsRoute;
    // Assistance : l'herbe tient moins mal — deux roues dans le bas-côté
    // tirent encore, mais ne retournent plus la voiture.
    if (state.assistance) mu = 1 - (1 - mu) * (1 - state.reglagesAssistance.herbe);
    // Le rappel vers la route tourne le volant : il passe avant la physique.
    rappelRoute(dt);
    // En l'air, les roues ne tiennent rien : on ne pilote pas un avion.
    pas(dt, cmd, state.enLair ? 0.06 : mu);
    collisions(dt);

    // bord du monde : on ne sort pas de la carte
    etat.x = THREE.MathUtils.clamp(etat.x, -bounds, bounds);
    etat.z = THREE.MathUtils.clamp(etat.z, -bounds, bounds);

    // ── assiette et suspension ────────────────────────────────────────────
    let sol = 0;
    for (let i = 0; i < 4; i++) {
      const px = etat.x + c * ROUES[i][0] - s * ROUES[i][1];
      const pz = etat.z - s * ROUES[i][0] - c * ROUES[i][1];
      solRoue[i] = solAt(px, pz);
      roueMonde[i].set(px, solRoue[i], pz);
      sol += solRoue[i] / 4;
    }
    const appui = sol + GARDE;
    if (state.enLair) {
      state.vy -= GRAVITE * dt;
      state.y += state.vy * dt;
      state.air += dt;
      if (surDeuxRoues) figuresEnLair(dt);
      if (state.y <= appui) {
        // atterrissage : la caisse encaisse, et un gros saut coûte de la vitesse
        state.y = appui;
        if (surDeuxRoues) atterrir(); else if (state.vy < -6) etat.u *= 0.93;
        state.vy = 0;
        state.enLair = false;
        // Un contact d'une ou deux images sur une rampe n'est pas un
        // atterrissage : l'élan de la rampe reste en mémoire pour le vrai bord.
        if (!(surDeuxRoues && state.air < 0.12)) { state.montee = 0; state.elan = 0; }
        state.appuiPrec = appui;
      }
    } else {
      const monte = appui - state.y;
      // **Une voiture colle à la route.** Elle ne décolle que si le terrain se
      // dérobe plus vite que la chute libre : c'est le sommet d'un dos d'âne, pas
      // une descente de colline. Le critère est donc physique — la vitesse de
      // descente qu'il faudrait pour suivre le sol, comparée à ce que la gravité
      // peut faire dans le même temps — et non un seuil fixe en mètres, qui
      // faisait sauter la voiture dans la moindre pente un peu raide.
      const chuteNecessaire = monte / dt;                 // m/s (négatif = le sol fuit)
      const chuteLibre = -GRAVITE * dt * 55;              // ce que la gravité autorise
      // Vitesse à laquelle le sol monte sous les roues, lissée sur quelques
      // images : sur une rampe, c'est exactement la vitesse verticale que
      // l'engin a prise. On la lui rend au décollage.
      const vitesseSol = (appui - (state.appuiPrec === null ? appui : state.appuiPrec)) / Math.max(dt, 1e-3);
      state.vitesseSol = vitesseSol;
      state.montee += (vitesseSol - state.montee) * lissage(surDeuxRoues ? 24 : 14, dt);
      state.appuiPrec = appui;
      // **L'élan garde le meilleur de la rampe, et l'oublie en une seconde.**
      // Au moment précis où la roue quitte le béton, la montée instantanée est
      // déjà retombée — c'est justement parce que le sol se dérobe qu'on
      // décolle. Lancer avec cette valeur-là revenait à glisser du bout du
      // tremplin. On lance donc avec ce que la rampe a réellement donné.
      state.elan = Math.max(state.montee, state.elan - dt * (surDeuxRoues ? 5 : 2.2));
      if (surDeuxRoues) {
        if (state.sautCooldown > 0) state.sautCooldown -= dt;
        // F ou G pressés au sol : la demande vaut une demi-seconde, le temps d'arriver au bord.
        if (cmd.flip && !state.flipLatch) { state.figureDemandee = 'flip'; state.demandeExpire = 0.5; }
        if (cmd.spin && !state.spinLatch) { state.figureDemandee = 'spin'; state.demandeExpire = 0.5; }
        state.flipLatch = cmd.flip;
        state.spinLatch = cmd.spin;
        if (state.demandeExpire > 0) state.demandeExpire -= dt;
        if (cmd.saut && !state.sautLatch && state.sautCooldown <= 0 && etat.vitesse > 0.4) {
          // Le coup de jambes : on saute quand on le décide, pas quand le sol
          // veut bien. Au bout d'un tremplin, il s'ajoute à ce que la rampe donne.
          decoller(Math.max(0, state.elan) + SAUT_TROTTINETTE.impulsion);
          state.sautCooldown = 0.35;
        } else if (etat.vitesse > SEUIL_ENVOL
                   && (vaDecoller(Math.max(0, Math.min(state.elan, SAUT_TROTTINETTE.envolMax)), 0.16, 0.04) || chuteNecessaire < chuteLibre)) {
          // **On décolle quand la trajectoire libre passe au-dessus du sol.**
          // Lancée avec la vitesse verticale que la rampe lui a donnée, la
          // trottinette serait-elle à quatre centimètres au-dessus du béton dans
          // 0,16 s ? Alors elle y est déjà : c'est un décollage, au sommet d'une
          // bosse comme au bord d'une table, et il part au vrai point de
          // séparation. L'ancienne règle attendait que le sol ait fui de quinze
          // centimètres en une image, c'est-à-dire une falaise : on collait aux
          // bosses et on décollait trop tard, quand on décollait. Une simple
          // comparaison d'accélérations (le sol fuit plus vite que g) partait
          // trop tôt et donnait des envols d'une image, à quelques millimètres.
          decoller(Math.max(0, Math.min(state.elan, SAUT_TROTTINETTE.envolMax)));
        } else {
          state.y += monte * lissage(monte > 0 ? 26 : 22, dt);
        }
        state.sautLatch = cmd.saut;
        // Bande de lancement : le béton bleu pousse jusqu'à 41 km/h.
        if (turboAt && etat.u > 0.5 && turboAt(etat.x, etat.z)) {
          etat.u = Math.min(etat.u + 18 * dt, SAUT_TROTTINETTE.turboMax);
          state.turbo = 0.25;
        }
      } else if (surQuad && chuteNecessaire < chuteLibre && etat.vitesse > SEUIL_ENVOL) {
        // Seul le quad décolle encore à quatre roues. **La berline ne saute
        // plus** (Arnaud, 25/09/2026 : « le saut, c'est un vrai problème ») :
        // elle suit le sol par sa suspension, même au bout d'un tremplin.
        state.enLair = true;
        // **On est projeté, on ne tombe pas.** Repartir à la vitesse de chute
        // libre revenait à glisser du bout du tremplin : la roue quittait le
        // béton et descendait aussitôt. Ce qu'on garde, c'est ce que la rampe a
        // mis dans la caisse — plafonné, sinon un dos d'âne pris vite devient
        // une catapulte.
        state.vy = Math.max(chuteLibre, Math.min(state.elan, ENVOL_MAX_VOITURE));
      } else {
        // Suspension : ferme à la montée, ferme aussi à la descente — c'est cette
        // dissymétrie qui donnait l'impression de flotter en descendant.
        state.y += monte * lissage(monte > 0 ? 26 : 22, dt);
      }
    }
    if (state.turbo > 0) state.turbo -= dt;
    if (state.chute > 0) state.chute -= dt;
    position.set(etat.x, state.y, etat.z);

    // pente du terrain, lue sur les quatre roues, plus le transfert de charge
    const penteTangage = Math.atan2((solRoue[0] + solRoue[1]) / 2 - (solRoue[2] + solRoue[3]) / 2, EMPATTEMENT);
    const penteRoulis = Math.atan2((solRoue[0] + solRoue[2]) / 2 - (solRoue[1] + solRoue[3]) / 2, VOIE);
    // En l'air, la trottinette suit sa trajectoire du nez — cabrée en montant,
    // piquée en descendant — et y ajoute la rotation de ses figures.
    const tangageVise = state.enLair
      ? (surDeuxRoues ? Math.atan2(state.vy, Math.max(2.5, Math.abs(etat.u))) * 0.5 + state.tangageAir : state.vy * 0.02)
      : penteTangage + THREE.MathUtils.clamp(etat.ax * 0.011, -0.09, 0.09);
    // Signes du roulis, vérifiés plutôt que devinés : une rotation positive
    // autour de l'axe arrière lève le côté droit. Un virage à droite penche donc
    // la caisse **vers l'extérieur**, côté droit en l'air (charge positive), et
    // une roue gauche posée plus haut que la droite doit au contraire baisser
    // le côté droit — d'où le moins devant la pente.
    // **Un engin à deux roues se penche DANS le virage.** Une voiture prend
    // appui sur quatre roues et bascule vers l'extérieur ; une trottinette, elle,
    // tombe à l'intérieur, et c'est la force centrifuge qui retient cette chute.
    // L'angle ne s'invente pas, il se calcule : tan(θ) = accélération latérale / g,
    // et l'accélération latérale d'une trajectoire courbe vaut vitesse × lacet.
    //
    // On la prend là, et **non sur `etat.charge`** (la force des pneus) : en
    // dessous de 8 m/s la physique retombe progressivement sur la cinématique
    // d'Ackermann, et la trottinette ne dépasse jamais 6,9 m/s — `charge` y
    // serait presque muet, et la trottinette resterait plate.
    //
    // Signe : `lacet` positif tourne à gauche, et un roulis positif lève le côté
    // droit, c'est-à-dire penche l'engin à gauche. Virage à gauche → `u·lacet`
    // positif → on penche à gauche. Les deux conventions vont dans le même sens,
    // vérifié en jeu plutôt que déduit — sur cette physique, deux corrections de
    // signe faites en parallèle se sont déjà annulées.
    const penche = surDeuxRoues && !state.enLair
      ? THREE.MathUtils.clamp(Math.atan2(etat.u * etat.lacet, GRAVITE), -SAUT_TROTTINETTE.pencheMax, SAUT_TROTTINETTE.pencheMax)
      : THREE.MathUtils.clamp(etat.charge * 0.055, -0.1, 0.1);
    const roulisVise = (state.enLair ? 0 : -penteRoulis) + penche
      + (state.chute > 0 ? Math.sin(state.chute * 38) * 0.30 * state.chute : 0);
    // Un looping ne se lisse pas : en l'air, à deux roues, l'assiette est celle
    // de la figure, exactement. Le lissage reprend à l'atterrissage.
    if (surDeuxRoues && state.enLair) state.tangage = tangageVise;
    else state.tangage += (tangageVise - state.tangage) * lissage(surDeuxRoues ? 9 : 16, dt);
    // Ce qui reste d'une vrille se résorbe au sol.
    if (!state.enLair && state.spin) state.spin -= state.spin * lissage(8, dt);
    // Se pencher demande un geste, pas un ressort de suspension : à deux roues
    // le roulis suit un peu plus vite, sinon l'engin part en virage avant d'y
    // être couché.
    state.roulis += (roulisVise - state.roulis) * lissage(surDeuxRoues ? 11 : 9, dt);
    // **Rien ne passe sous le sol.** La hauteur de la caisse est une moyenne des
    // quatre roues, lissée ; son inclinaison est lissée à part. Entre les deux,
    // au passage d'une bordure, d'un dos d'âne ou d'un fossé, un coin de la
    // caisse — l'arrière surtout, avec son porte-à-faux — pouvait se retrouver
    // sous le relief pendant quelques images. On relève la caisse d'autant.
    if (!state.enLair && !surDeuxRoues) {
      const sT = Math.sin(state.tangage), cT = Math.cos(state.tangage), sR = Math.sin(state.roulis);
      let releve = 0;
      for (let i = 0; i < 4; i++) {
        // attache de la roue sur la caisse inclinée, moins le débattement possible
        const attache = state.y - GARDE + ROUES[i][0] * sR * cT - ROUES[i][1] * sT;
        releve = Math.max(releve, solRoue[i] - 0.12 - attache);
      }
      for (let i = 0; i < 4; i++) {
        // coins de la caisse (pare-chocs) : le sol y est lu directement
        const lx = SONDES[i][0], lz = SONDES[i][1];
        const coin = state.y + lx * sR * cT - lz * sT;
        const solCoin = solAt(etat.x + c * lx - s * lz, etat.z - s * lx - c * lz);
        releve = Math.max(releve, solCoin - 0.04 - coin);
      }
      if (releve > 0) { state.y += releve; position.y = state.y; }
    }
    euler.set(state.tangage, etat.yaw + state.spin, state.roulis);
    root.quaternion.setFromEuler(euler);
    // La caisse se penche **en plus** de la voiture : les roues restent au sol.
    voiture.caisse.rotation.x = THREE.MathUtils.clamp(-etat.ax * 0.004, -0.035, 0.035);
    // À deux roues il n'y a pas de caisse sur ressorts qui roule de son côté :
    // l'engin entier est déjà couché dans le virage. Ajouter ce roulis par-dessus
    // ferait pencher la trottinette plus que son propre angle d'équilibre.
    voiture.caisse.rotation.z = surDeuxRoues
      ? 0
      : THREE.MathUtils.clamp(etat.charge * 0.030, -0.06, 0.06);

    // débattement : chaque roue rattrape le sol sous elle — **depuis son point
    // d'attache sur la caisse inclinée**, pas depuis le centre de la voiture.
    // Les roues sont filles de `root`, qui porte tangage et roulis : mesurer
    // l'écart depuis le centre appliquait la pente deux fois, et sur un relief
    // les roues arrière s'enfonçaient en montée, flottaient en descente.
    {
      const sT = Math.sin(state.tangage), cT = Math.cos(state.tangage), sR = Math.sin(state.roulis);
      for (let i = 0; i < 4; i++) {
        const attache = state.y - GARDE + ROUES[i][0] * sR * cT - ROUES[i][1] * sT;
        const vise = THREE.MathUtils.clamp(solRoue[i] - attache, -0.12, 0.12);
        debattement[i] += (vise - debattement[i]) * lissage(14, dt);
      }
    }
    voiture.majRoues(etat.braquage, etat.rotationRoue / E, debattement);   // roue plus petite : tourne plus vite
    voiture.setFreinage(etat.freinage > 0);
    if (voiture.setRecul) voiture.setRecul(etat.rapport < 0);
    state.chocSon *= Math.exp(-dt / 0.25);
    if (state.chocSon < 0.002) state.chocSon = 0;

    // ombre de contact, posée à plat sur le terrain sous la voiture
    voiture.ombre.position.set(etat.x, sol + 0.045, etat.z);
    voiture.ombre.rotation.z = -etat.yaw;
    voiture.ombre.material.opacity = state.enLair ? 0.35 : 0.85;

    // ── fumée et traces ───────────────────────────────────────────────────
    const glisse = Math.abs(etat.glisseAr);
    const patine = Math.max(0, etat.patinage - 1);
    const gomme = !state.enLair && etat.vitesse > 3.5 && (glisse > 0.16 || patine > 0.15);
    if (gomme) {
      state.allumage += dt;
      if (state.allumage > 0.045) {
        state.allumage = 0;
        const i = Math.random() < 0.5 ? 2 : 3;
        lacherFumee(roueMonde[i].x, roueMonde[i].y, roueMonde[i].z);
        for (const k of [2, 3]) {
          poserTrace(roueMonde[k].x, roueMonde[k].y, roueMonde[k].z, etat.yaw,
            Math.min(1, glisse * 2.5 + patine));
        }
      }
    }
    for (let i = 0; i < FUMEE; i++) {
      const p = fumee[i];
      if (!p.visible) continue;
      p.userData.vie -= dt;
      if (p.userData.vie <= 0) { p.visible = false; p.material.opacity = 0; continue; }
      p.position.y += dt * 0.85;
      p.scale.addScalar(dt * 2.6);
      p.material.opacity = Math.max(0, p.userData.vie * 0.42);
    }
    let tracesVivantes = false;
    for (let i = 0; i < TRACES; i++) {
      if (traceVie[i] <= 0) continue;
      traceVie[i] -= dt;
      tracesVivantes = true;
      const v = Math.max(0, traceVie[i]) / 8;
      const g = 1 - 0.55 * Math.min(1, v * 1.6);
      traces.setColorAt(i, traceCouleur.setRGB(g, g, g));
    }
    if (tracesVivantes && traces.instanceColor) traces.instanceColor.needsUpdate = true;

    majCamera(dt);
    if (state.son) son.maj(etat, cmd.gaz, dt, cmd, state.chocSon);
  }

  /** Ce que le HUD affiche. */
  function telemetrie() {
    return {
      kmh: etat.kmh,
      rapport: etat.passage > 0 ? '—' : (etat.rapport < 0 ? 'R' : String(etat.rapport)),
      regime: Math.round(etat.regime),
      regimeMax: reglage.regimeMax,
      glisse: Math.min(1, Math.abs(etat.glisseAr) / 0.35),
      enLair: state.enLair,
      air: state.air,
      figure: state.figure,
      turbo: state.turbo > 0,
    };
  }

  // ── choix de la voiture ─────────────────────────────────────────────────
  /**
   * Change de voiture : la peinture ET la mécanique.
   *
   * Ce n'est pas un habillage. « rouge » est une propulsion de 500 N·m qui se
   * met en travers si on la brusque ; « bleue » est une traction de 380 N·m qui
   * élargit son virage au lieu de partir de l'arrière — 5° de dérive au lieu de
   * 22 à fond de volant, mesuré. La seconde se conduit sans rien savoir.
   */
  const VOITURES = {
    rouge: { teinte: 'rouge', reglage: REGLAGES.gt },
    bleue: { teinte: 'bleu', reglage: REGLAGES.traction },
  };
  let choix = 'rouge';
  function choisirVoiture(nom) {
    const v = VOITURES[nom];
    if (surDeuxRoues || surQuad || !v || nom === choix) return choix;
    choix = nom;
    changerReglage(v.reglage);
    voiture.setTeinte(v.teinte);
    return choix;
  }

  /** Phares et feux : le village le dit quand il passe la nuit. */
  function setNuit(actif) { voiture.setNuit(actif); }

  return {
    root, state, etat, voiture, son,
    enter, exit, update, basculerVue, basculerSon, redresser, commande, setMain, setNuit, figure,
    choisirVoiture, voitureChoisie: () => choix,
    telemetrie, placer,
    // L'outil de réglage (touche T) lit `reglage` et applique par `regler`.
    reglage, regler: changerReglage,
    setAssistance: (on) => { state.assistance = !!on; state.coince = 0; state.versRoute = null; },
    reglagesAssistance: state.reglagesAssistance,
    // Les glissières ne se proposent que si le village en a construit.
    ...(glissiereAt ? { setGlissieres: (on) => { state.glissieres = !!on; state.coince = 0; } } : {}),
    get position() { return position; },
  };
}
