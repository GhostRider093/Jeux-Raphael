// ══════════════════════════════════════════════════════════════════════════
//  SENSIBILITE DES COMMANDES — reglage en vol
// --------------------------------------------------------------------------
//  Un appareil trop nerveux ne se corrige pas en recompilant : il se corrige
//  manette en main, en vol, en voyant l'effet. Ce module ne fait que ca —
//  porter trois nombres, les afficher, les retenir.
//
//  IL NE PILOTE RIEN. `world-game.js` lui demande ses facteurs et les applique
//  lui-meme. Aucune dependance dans l'autre sens, aucun calcul dans la boucle
//  de vol : `facteurs()` rend le meme objet a chaque appel.
//
//  TROIS REGLAGES, ET PAS UN DE PLUS :
//
//    · SENSIBILITE — divise l'ordre de virage. C'est celui qui repond a
//      « l'avion part trop fort a gauche et a droite ». Il agit sur toutes les
//      sources a la fois, manette, clavier et ecran tactile : l'appareil ne
//      doit pas tourner autrement selon ce qu'on tient dans les mains.
//    · ZONE MORTE — le rayon mort au centre du stick. Un stick use ne revient
//      pas a zero ; sous cette valeur, l'appareil garde son cap.
//    · DOUCEUR — la courbe. A fond de course l'autorite reste entiere ; seules
//      les petites corrections sont adoucies. C'est le reglage a monter quand
//      on veut viser sans que l'appareil sursaute.
//
//  Les deux derniers sont passes a `input-shaping.js`, qui les applique. Le
//  premier est rendu a `world-game.js`.
// ══════════════════════════════════════════════════════════════════════════

const CLE = 'nova-mondes-sensibilite-v1';

// Valeurs d'origine : 1 ne change rien au pilotage actuel. Le jour ou l'on
// touche aux vitesses de rotation du modele de vol, c'est ici qu'il faut
// revenir — pas ailleurs.
const DEFAUTS = { sensibilite: 1, zoneMorte: .10, douceur: .35 };

const CURSEURS = [
  {
    nom: 'sensibilite', titre: 'Sensibilité', min: .2, max: 1.5, pas: .05,
    afficher: v => `${Math.round(v * 100)} %`,
    aide: 'Plus bas, l\'appareil tourne moins vite pour la même inclinaison du stick.'
  },
  {
    nom: 'zoneMorte', titre: 'Zone morte', min: 0, max: .35, pas: .01,
    afficher: v => `${Math.round(v * 100)} %`,
    aide: 'Le stick est ignoré sous ce rayon. À monter si l\'avion dérive stick lâché.'
  },
  {
    nom: 'douceur', titre: 'Douceur au centre', min: 0, max: 1, pas: .05,
    afficher: v => v.toFixed(2),
    aide: 'Adoucit les petites corrections sans rien retirer à fond de course.'
  }
];

const STYLE = `
#reglage-sensibilite {
  position: fixed; z-index: 60; top: 16px; right: 16px; width: 310px; display: none;
  padding: 14px 16px 16px; box-sizing: border-box;
  background: rgba(4,12,20,.92); border: 1px solid rgba(150,205,230,.36);
  color: #bdefff; font-family: "Bahnschrift SemiCondensed","Segoe UI Variable Display",sans-serif;
  box-shadow: 0 18px 42px rgba(0,0,0,.55);
}
#reglage-sensibilite.ouvert { display: block; }
#reglage-sensibilite h2 { margin: 0 0 3px; font-size: 13px; letter-spacing: 2px;
  text-transform: uppercase; color: #78dff6; }
#reglage-sensibilite .sous { margin: 0 0 12px; font-size: 11.5px; color: #7fa6b8; }
#reglage-sensibilite .champ { margin-bottom: 13px; }
#reglage-sensibilite .tete { display: flex; justify-content: space-between; font-size: 12.5px; }
#reglage-sensibilite .tete b { font-weight: 400; }
#reglage-sensibilite .tete i { font-style: normal; font-weight: 700; color: #eaf8ff;
  font-variant-numeric: tabular-nums; }
#reglage-sensibilite input { width: 100%; margin: 5px 0 2px; accent-color: #54f6ff; }
#reglage-sensibilite .aide { font-size: 11px; line-height: 1.45; color: #6f93a4; }
#reglage-sensibilite .actif input { accent-color: #ffd34d; }
#reglage-sensibilite .actif .tete i { color: #ffd34d; }
#reglage-sensibilite button { width: 100%; margin-top: 4px; padding: 7px; cursor: pointer;
  background: rgba(120,223,246,.12); border: 1px solid rgba(150,205,230,.4);
  color: #bdefff; font-family: inherit; font-size: 12px; letter-spacing: 1.2px;
  text-transform: uppercase; }
#reglage-sensibilite button:hover { background: rgba(120,223,246,.22); }
#reglage-sensibilite .manette { margin-top: 11px; font-size: 11px; line-height: 1.5; color: #6f93a4; }
`;

function lire() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE)) || {};
    const valeurs = { ...DEFAUTS };
    // On ne recopie que ce qu'on connait, et seulement si c'est un nombre : un
    // stockage abime ne doit pas pouvoir mettre la sensibilite a `null` et
    // figer l'appareil en vol.
    for (const { nom, min, max } of CURSEURS) {
      // `typeof` avant tout : `Number(null)` vaut ZERO et franchirait
      // `Number.isFinite`. Un reglage efface reviendrait alors a la sensibilite
      // minimale au lieu de la valeur d'origine, et l'appareil ne tournerait
      // presque plus sans qu'on comprenne pourquoi.
      const valeur = brut[nom];
      if (typeof valeur === 'number' && Number.isFinite(valeur)) {
        valeurs[nom] = Math.min(max, Math.max(min, valeur));
      }
    }
    return valeurs;
  } catch {
    return { ...DEFAUTS };
  }
}

/**
 * @param {object} options
 * @param {{configure: Function}} options.stick le `createStickShaper` du vol,
 *   a qui sont repercutees la zone morte et la douceur.
 * @returns `facteurs()` pour la boucle de vol, `basculer()` pour la touche.
 */
export function creerReglageSensibilite({ stick = null } = {}) {
  const valeurs = lire();
  // Objet rendu tel quel a chaque image, jamais recree.
  const facteurs = { virage: valeurs.sensibilite };

  const panneau = document.createElement('section');
  panneau.id = 'reglage-sensibilite';
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);

  panneau.innerHTML = `
    <h2>Sensibilité</h2>
    <p class="sous">Réglable en vol · conservé d'une partie à l'autre</p>
    ${CURSEURS.map(({ nom, titre, min, max, pas, aide }) => `
      <div class="champ" data-champ="${nom}">
        <div class="tete"><b>${titre}</b><i id="rs-v-${nom}"></i></div>
        <input type="range" id="rs-${nom}" min="${min}" max="${max}" step="${pas}">
        <div class="aide">${aide}</div>
      </div>`).join('')}
    <button id="rs-defaut">Valeurs d'origine</button>
    <p class="manette">Manette : croix directionnelle haut et bas pour choisir
      le réglage, gauche et droite pour le changer. Le clavier marche aussi.</p>
  `;
  document.body.appendChild(panneau);

  function appliquer() {
    facteurs.virage = valeurs.sensibilite;
    stick?.configure({ deadZone: valeurs.zoneMorte, expo: valeurs.douceur });
  }

  function afficher() {
    for (const { nom, afficher: format } of CURSEURS) {
      panneau.querySelector(`#rs-${nom}`).value = valeurs[nom];
      panneau.querySelector(`#rs-v-${nom}`).textContent = format(valeurs[nom]);
    }
  }

  function enregistrer() {
    try { localStorage.setItem(CLE, JSON.stringify(valeurs)); } catch { /* stockage refuse */ }
  }

  function poser(nom, valeur) {
    const curseur = CURSEURS.find(item => item.nom === nom);
    valeurs[nom] = Math.min(curseur.max, Math.max(curseur.min, valeur));
    appliquer();
    afficher();
    enregistrer();
  }

  for (const { nom } of CURSEURS) {
    panneau.querySelector(`#rs-${nom}`).addEventListener('input', evenement => {
      poser(nom, Number(evenement.target.value));
    });
  }
  panneau.querySelector('#rs-defaut').addEventListener('click', () => {
    Object.assign(valeurs, DEFAUTS);
    appliquer();
    afficher();
    enregistrer();
  });

  // ── PILOTAGE A LA MANETTE ─────────────────────────────────────────────────
  // Le reglage se fait manette en main : demander de lacher le stick pour
  // aller chercher une souris, c'est perdre la sensation qu'on voulait juger.
  let choisi = 0;
  function surligner() {
    panneau.querySelectorAll('.champ').forEach((champ, index) => {
      champ.classList.toggle('actif', index === choisi);
    });
  }
  surligner();

  function deplacer(pas) {
    choisi = (choisi + pas + CURSEURS.length) % CURSEURS.length;
    surligner();
  }
  function ajuster(sens) {
    const curseur = CURSEURS[choisi];
    poser(curseur.nom, valeurs[curseur.nom] + sens * curseur.pas);
  }

  function ouvert() { return panneau.classList.contains('ouvert'); }
  function basculer(force) {
    panneau.classList.toggle('ouvert', force === undefined ? undefined : !!force);
    return ouvert();
  }

  // La croix directionnelle est lue par impulsion, pas en continu : maintenue,
  // elle ferait defiler le reglage d'un bout a l'autre en une demi-seconde.
  const CROIX = { haut: 12, bas: 13, gauche: 14, droite: 15 };
  const enfonce = { haut: false, bas: false, gauche: false, droite: false };
  function lireManette(pad) {
    if (!ouvert() || !pad || !pad.buttons) return;
    for (const [nom, index] of Object.entries(CROIX)) {
      const actif = !!pad.buttons[index]?.pressed;
      if (actif && !enfonce[nom]) {
        if (nom === 'haut') deplacer(-1);
        else if (nom === 'bas') deplacer(1);
        else if (nom === 'gauche') ajuster(-1);
        else ajuster(1);
      }
      enfonce[nom] = actif;
    }
  }

  function lireClavier(code) {
    if (!ouvert()) return false;
    if (code === 'ArrowUp') { deplacer(-1); return true; }
    if (code === 'ArrowDown') { deplacer(1); return true; }
    if (code === 'ArrowLeft') { ajuster(-1); return true; }
    if (code === 'ArrowRight') { ajuster(1); return true; }
    return false;
  }

  appliquer();
  afficher();

  const api = {
    facteurs: () => facteurs,
    basculer, ouvert, lireManette, lireClavier,
    valeurs: () => ({ ...valeurs }),
    poser
  };
  if (typeof window !== 'undefined') window.RaphaelSensibilite = api;
  return api;
}
