// ══════════════════════════════════════════════════════════════════════════
//  PANNEAU DE REGLAGE DU POSTE
// --------------------------------------------------------------------------
//  Placer une piece a l'aveugle depuis le code coute un aller-retour par essai
//  et n'est jamais juste. Ce panneau met les poignees entre les mains de celui
//  qui REGARDE l'ecran, puis lui rend les valeurs exactes a figer dans
//  `PIECES` ou dans un appel a `monterSurPiece`.
//
//  TROIS CHOSES QUI FONT QUE C'EST UTILISABLE, et qui manquaient a la premiere
//  version :
//
//    1. F2 ARRETE LE JEU. Regler une piece pendant que l'appareil vole, vire
//       et percute un immeuble est ingerable : la vue change sous les doigts
//       et le decor a bouge avant qu'on ait lu la valeur. Le drapeau
//       `window.__postePause` est lu par la boucle de vol, qui saute alors le
//       pilotage. Rien d'autre ne s'arrete : le poste continue de se rafraichir
//       et l'on voit donc l'effet de chaque cran.
//
//    2. LES FLECHES REGLENT, PAS LA SOURIS. Haut et bas changent de poignee,
//       gauche et droite font moins et plus d'un cran. Un curseur ne permet pas
//       de viser au millimetre ; une touche, si. Maj multiplie le cran par dix.
//
//    3. LE BASCULEMENT EST EN PREMIER. C'est le reglage dont on a besoin neuf
//       fois sur dix — une dalle qui regarde le plafond ou le plancher au lieu
//       du pilote — et il etait noye au milieu des six autres.
//
//  Les valeurs sont celles de l'objet dans le repere de SON PARENT : un ecran
//  monte sur une console se regle dans le repere de cette console. Et la taille
//  est un multiplicateur de l'echelle en place, jamais une cote absolue : on
//  corrige ce que le chargement a calcule. Le signe du miroir est preserve,
//  donc agrandir la console de droite ne la retourne pas.

// Ordre voulu : le basculement d'abord, puis la hauteur et la profondeur, qui
// sont les trois seuls reglages dont on se sert vraiment.
const POIGNEES = [
  { titre: 'basculer av/ar', propriete: 'rotation', axe: 'x', min: -3.2, max: 3.2, pas: .01 },
  { titre: 'hauteur', propriete: 'position', axe: 'y', min: -1.6, max: 1.6, pas: .005 },
  { titre: 'profondeur', propriete: 'position', axe: 'z', min: -1.6, max: 1.6, pas: .005 },
  { titre: 'lateral', propriete: 'position', axe: 'x', min: -1.6, max: 1.6, pas: .005 },
  { titre: 'pivoter g/d', propriete: 'rotation', axe: 'y', min: -3.2, max: 3.2, pas: .01 },
  { titre: 'rouler', propriete: 'rotation', axe: 'z', min: -3.2, max: 3.2, pas: .01 },
  { titre: 'taille', propriete: 'echelle', axe: 'x', min: .2, max: 3, pas: .01 }
];

const STYLE_PANNEAU = 'position:fixed;z-index:9999;right:12px;top:12px;width:268px;padding:10px;'
  + 'background:rgba(4,12,20,.95);border:1px solid rgba(91,224,255,.45);color:#dff7ff;'
  + 'font:600 11px/1.5 Consolas,monospace;pointer-events:auto;user-select:none';
const STYLE_CHOIX = 'width:100%;margin-bottom:8px;padding:4px;background:#06131f;color:#8dffc8;'
  + 'border:1px solid rgba(91,224,255,.4);font:inherit';
const STYLE_SORTIE = 'width:100%;height:74px;margin-top:6px;background:#06131f;color:#8dffc8;'
  + 'border:1px solid rgba(91,224,255,.3);font:inherit;resize:none';
const STYLE_BOUTON = 'width:100%;margin-top:6px;padding:5px;background:#0d2b3d;color:#8dffc8;'
  + 'border:1px solid rgba(91,224,255,.5);font:inherit;cursor:pointer';

/**
 * Ouvre — ou referme — le panneau, et met le jeu en pause tant qu'il est la.
 *
 * @param {Map<string, THREE.Object3D>} placables tout ce qui se regle, par nom
 * @param {object} etat porteur du panneau, pour la bascule
 */
export function basculerReglage(placables, etat) {
  if (etat.panneau) {
    etat.panneau.remove();
    window.removeEventListener('keydown', etat.clavier, true);
    etat.panneau = null;
    window.__postePause = false;
    return 'panneau ferme — le jeu repart';
  }

  // La pause est posee AVANT le premier rendu du panneau : sinon l'appareil
  // continue de voler pendant qu'on lit les valeurs de depart.
  window.__postePause = true;

  const panneau = document.createElement('div');
  panneau.style.cssText = STYLE_PANNEAU;

  const choix = document.createElement('select');
  choix.style.cssText = STYLE_CHOIX;
  for (const nom of placables.keys()) choix.add(new Option(nom, nom));
  panneau.append(choix);

  let active = 0;
  const lignes = [];

  for (const poignee of POIGNEES) {
    const ligne = document.createElement('div');
    ligne.style.cssText = 'padding:1px 3px';
    const titre = document.createElement('span');
    titre.textContent = poignee.titre;
    titre.style.cssText = 'display:inline-block;width:100px';
    const valeur = document.createElement('span');
    valeur.style.cssText = 'float:right;color:#8dffc8';
    const curseur = document.createElement('input');
    curseur.type = 'range';
    curseur.min = poignee.min;
    curseur.max = poignee.max;
    curseur.step = poignee.pas;
    curseur.style.cssText = 'width:100%;margin:0 0 3px';
    ligne.append(titre, valeur, curseur);
    panneau.append(ligne);
    lignes.push({ ...poignee, ligne, titre, valeur, curseur });
  }

  const sortie = document.createElement('textarea');
  sortie.readOnly = true;
  sortie.style.cssText = STYLE_SORTIE;
  const bouton = document.createElement('button');
  bouton.textContent = 'COPIER LES VALEURS';
  bouton.style.cssText = STYLE_BOUTON;
  const aide = document.createElement('div');
  aide.style.cssText = 'margin-top:6px;font-weight:400;color:rgba(223,247,255,.6)';
  aide.innerHTML = 'JEU EN PAUSE.<br>↑ ↓ changent de poignee<br>← → font moins et plus (Maj = x10)<br>F2 ferme et relance';
  panneau.append(sortie, bouton, aide);

  // Echelle de depart de l'objet choisi, et signe de son miroir eventuel.
  let tailleDepart = 1;
  let signeMiroir = 1;

  const objetCourant = () => placables.get(choix.value);

  function lire(objet, poignee) {
    if (poignee.propriete !== 'echelle') return objet[poignee.propriete][poignee.axe];
    return tailleDepart ? Math.abs(objet.scale.x) / tailleDepart : 1;
  }

  function ecrire(objet, poignee, valeur) {
    if (poignee.propriete !== 'echelle') {
      objet[poignee.propriete][poignee.axe] = valeur;
      return;
    }
    const k = tailleDepart * valeur;
    objet.scale.set(k * signeMiroir, k, k);
  }

  function ecrireSortie(objet) {
    const p = objet.position;
    const r = objet.rotation;
    sortie.value = [
      choix.value,
      `position: [${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${p.z.toFixed(3)}]`,
      `rotation: [${r.x.toFixed(3)}, ${r.y.toFixed(3)}, ${r.z.toFixed(3)}]`,
      `echelle: ${Math.abs(objet.scale.x).toFixed(4)}`
    ].join('\n');
  }

  function rafraichir() {
    const objet = objetCourant();
    if (!objet) return;
    for (const [index, ligne] of lignes.entries()) {
      const valeur = lire(objet, ligne);
      ligne.curseur.value = valeur;
      ligne.valeur.textContent = ligne.propriete === 'echelle'
        ? `${valeur.toFixed(2)} x`
        : valeur.toFixed(3);
      // La poignee active est celle que les fleches commandent : elle doit se
      // voir d'un coup d'oeil, sans quoi on regle a l'aveugle une seconde fois.
      const choisie = index === active;
      ligne.ligne.style.background = choisie ? 'rgba(91,224,255,.16)' : 'transparent';
      ligne.titre.style.color = choisie ? '#8dffc8' : '#54f6ff';
    }
    ecrireSortie(objet);
  }

  function choisirObjet() {
    const objet = objetCourant();
    if (!objet) return;
    signeMiroir = Math.sign(objet.scale.x) || 1;
    tailleDepart = Math.abs(objet.scale.x) || 1;
    rafraichir();
  }

  for (const ligne of lignes) {
    ligne.curseur.addEventListener('input', () => {
      const objet = objetCourant();
      if (!objet) return;
      active = lignes.indexOf(ligne);
      ecrire(objet, ligne, parseFloat(ligne.curseur.value));
      rafraichir();
    });
  }
  choix.addEventListener('change', choisirObjet);
  bouton.addEventListener('click', () => {
    navigator.clipboard?.writeText(sortie.value);
    bouton.textContent = 'COPIE';
    setTimeout(() => { bouton.textContent = 'COPIER LES VALEURS'; }, 1200);
  });

  // Le clavier est capte en phase de CAPTURE et l'evenement est arrete net :
  // les fleches pilotent l'avion dans ce jeu, et le pilotage ne doit pas
  // recevoir un seul appui pendant le reglage.
  etat.clavier = evenement => {
    const touches = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (!touches.includes(evenement.key)) return;
    evenement.preventDefault();
    evenement.stopPropagation();
    if (evenement.key === 'ArrowUp' || evenement.key === 'ArrowDown') {
      active = (active + (evenement.key === 'ArrowDown' ? 1 : lignes.length - 1)) % lignes.length;
      rafraichir();
      return;
    }
    const objet = objetCourant();
    if (!objet) return;
    const ligne = lignes[active];
    const cran = ligne.pas * (evenement.shiftKey ? 10 : 1) * (evenement.key === 'ArrowRight' ? 1 : -1);
    const valeur = Math.min(ligne.max, Math.max(ligne.min, lire(objet, ligne) + cran));
    ecrire(objet, ligne, valeur);
    rafraichir();
  };
  window.addEventListener('keydown', etat.clavier, true);

  choisirObjet();
  document.body.append(panneau);
  etat.panneau = panneau;
  return 'panneau ouvert — jeu en pause, F2 pour reprendre';
}
