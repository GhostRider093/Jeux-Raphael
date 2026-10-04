/**
 * La vue intérieure de la berline (01/10/2026).
 *
 * Arnaud : « mets-moi ça pour la vue intérieure de la berline bleue » — une
 * photo d'habitacle (`assets/car/interieur-berline.webp`, préparée par
 * `scripts/interieur/preparer_interieur.py` : vitres transparentes, verre du
 * rétroviseur retiré). Elle est posée **par-dessus** le rendu, plein écran ;
 * le village se voit à travers le pare-brise et les vitres.
 *
 * L'image est fixe : c'est la caméra qui s'aligne sur elle. On calcule où
 * tombe, à l'écran, la ligne du capot (la base du pare-brise) une fois l'image
 * recadrée, et l'on incline le regard pour que l'horizon se pose juste
 * au-dessus — la route se voit par le pare-brise, pas derrière la planche de
 * bord.
 *
 * Le volant (`assets/car/volant-berline.webp`, avec les mains, généré le 02/10/2026) est un
 * second calque, facultatif : s'il existe, il tourne avec la direction.
 */
const IMAGE = 'assets/car/interieur-berline.webp?v=20261002a';
const VOLANT = 'assets/car/volant-berline.webp?v=20261002a';

// Repères dans l'image (en part de sa hauteur), mesurés sur la photo
const CADRAGE_Y = 0.12;       // `object-position` vertical : on garde le haut (pare-brise, planche)
// 2e photo d'Arnaud (01/10/2026, planche carbone et compteurs) : pare-brise de 0,078 à 0,322
const CAPOT = 0.322;          // la base du pare-brise
const HORIZON = 0.25;         // où l'on veut l'horizon : un peu au-dessus du capot
const VOLANT_TOURS = 3.2;     // rotation du volant pour un radian de braquage des roues
// Le volant (02/10/2026) : posé devant les compteurs, côté conducteur. Son image est un carré
// centré sur le moyeu où la jante fait VOLANT_JANTE du côté (`scripts/interieur/preparer_volant.py`).
const VOLANT_U = 0.245;       // moyeu, en part de la largeur de la photo
const VOLANT_V = 0.50;        // moyeu, en part de sa hauteur
const VOLANT_D = 0.36;        // diamètre de la jante, en part du côté de la photo
const VOLANT_JANTE = 0.5;
const VOLANT_MAX = 40;        // degrés : les bras tournent avec le volant, au-delà ils partent à l'horizontale
// 03/10/2026, Arnaud : « on ne voit pas assez de la course » — tout l'habitacle (photo + volant)
// descend de DESCENTE (en part du côté de la photo) ; le pare-brise grandit, le ciel passe au-dessus.
// Réglable en direct avec `?reglage` (curseurs en haut à droite, valeur gardée dans ce navigateur).
const DESCENTE = 0.12;
const CLE_REGLAGE = 'nova-habitacle-reglage';

const STYLE = `
#habitacle{position:fixed;inset:0;z-index:0;pointer-events:none;display:none;overflow:hidden}
#habitacle .toit{position:absolute;left:0;right:0;top:0;height:0;background:#141416}
#habitacle img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% ${CADRAGE_Y * 100}%}
#habitacle img.volant{inset:auto;height:auto;object-fit:contain;
  transform:translate(-50%,-50%) rotate(var(--volant,0deg));transform-origin:50% 50%;display:none}
`;

export function creerHabitacle() {
  let racine = null, fond = null, toit = null, volant = null, visible = false, cadre = '';
  const reglage = { descente: DESCENTE, horizon: HORIZON };
  const enReglage = /[?&]reglage(?:[=&]|$)/.test(location.search);
  if (enReglage) {
    try { Object.assign(reglage, JSON.parse(localStorage.getItem(CLE_REGLAGE) || '{}')); } catch { /* rien */ }
  }

  /** Le haut de la photo à l'écran (px, ≤ 0 tant qu'elle ne descend pas), image carrée en `cover`. */
  function hautImage(cote) {
    return (innerHeight - cote) * CADRAGE_Y + reglage.descente * cote;
  }

  /** Pose le volant sur la photo telle que `object-fit: cover` l'affiche. */
  function placerVolant() {
    const W = innerWidth, H = innerHeight, cle = W + 'x' + H + ':' + reglage.descente;
    if (cle === cadre) return;
    cadre = cle;
    const cote = Math.max(W, H);
    if (fond) fond.style.transform = `translateY(${(reglage.descente * cote).toFixed(1)}px)`;
    // la photo descendue laisse un vide au-dessus (son cadre la rogne au bord haut) : on prolonge le ciel de toit
    if (toit) toit.style.height = `${(reglage.descente * cote + 1).toFixed(1)}px`;
    if (!volant) return;
    const gauche = (W - cote) * 0.5, haut = hautImage(cote);
    volant.style.left = `${gauche + VOLANT_U * cote}px`;
    volant.style.top = `${haut + VOLANT_V * cote}px`;
    volant.style.width = `${(VOLANT_D / VOLANT_JANTE) * cote}px`;
  }

  function monter() {
    if (racine) return;
    const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
    racine = document.createElement('div'); racine.id = 'habitacle';
    fond = document.createElement('img'); fond.src = IMAGE; fond.alt = ''; fond.decoding = 'async';
    racine.appendChild(fond);
    toit = document.createElement('div'); toit.className = 'toit'; racine.appendChild(toit);
    volant = document.createElement('img'); volant.className = 'volant'; volant.alt = '';
    volant.onload = () => { volant.style.display = 'block'; };
    volant.onerror = () => { volant.remove(); volant = null; };       // pas encore de volant : rien
    volant.src = VOLANT;
    racine.appendChild(volant);
    // juste après la scène 3D, avant tout le reste : les panneaux, le compteur et
    // les boutons tactiles restent par-dessus l'habitacle
    const scene = document.getElementById('scene');
    if (scene) scene.after(racine); else document.body.prepend(racine);
    if (enReglage) panneauReglage();
  }

  /** `?reglage` : deux curseurs pour caler l'habitacle en roulant, la valeur à recopier dans DESCENTE / HORIZON. */
  function panneauReglage() {
    const p = document.createElement('div');
    p.style.cssText = 'position:fixed;top:8px;right:8px;z-index:9999;background:rgba(0,0,0,.75);color:#fff;'
      + 'font:13px system-ui;padding:8px 10px;border-radius:8px;display:grid;gap:4px;pointer-events:auto';
    const ligne = (nom, min, max) => {
      const l = document.createElement('label');
      const c = document.createElement('input'); c.type = 'range'; c.min = min; c.max = max; c.step = 0.005;
      c.value = reglage[nom]; c.style.width = '160px';
      const v = document.createElement('b');
      const maj = () => { v.textContent = ` ${nom} ${Number(reglage[nom]).toFixed(3)}`; };
      c.oninput = () => {
        reglage[nom] = Number(c.value); maj();
        try { localStorage.setItem(CLE_REGLAGE, JSON.stringify(reglage)); } catch { /* rien */ }
      };
      // les flèches du clavier pilotent la voiture : le curseur ne les garde pas
      c.addEventListener('keydown', (e) => { e.preventDefault(); c.blur(); });
      maj(); l.append(c, v); p.appendChild(l);
    };
    ligne('descente', 0, 0.35);
    ligne('horizon', 0.1, 0.35);
    p.style.display = 'none';
    racine.reglage = p;
    document.body.appendChild(p);
  }

  /**
   * L'angle (rad) dont la caméra doit plonger sous l'horizontale pour que
   * l'horizon tombe à `HORIZON` dans l'image recadrée.
   */
  function plongee(fovDeg) {
    const W = innerWidth, H = innerHeight;
    // object-fit: cover d'une image carrée
    const cote = Math.max(W, H);
    const haut = hautImage(cote);                     // le haut de l'image à l'écran
    const yHorizon = haut + reglage.horizon * cote;           // px depuis le haut de l'écran
    const ndc = 1 - (2 * yHorizon) / H;               // > 0 : au-dessus du centre
    return Math.atan(ndc * Math.tan((fovDeg * Math.PI) / 360));
  }

  return {
    CAPOT,
    plongee,
    /** À chaque image en vue intérieure ; `braquage` : celui des roues (rad, positif à droite = volant dans le sens des aiguilles). */
    montrer(braquage = 0) {
      monter();
      if (!visible) { racine.style.display = 'block'; visible = true; if (racine.reglage) racine.reglage.style.display = 'grid'; }
      placerVolant();
      if (volant) {
        const angle = Math.max(-VOLANT_MAX, Math.min(VOLANT_MAX, (braquage * VOLANT_TOURS * 180) / Math.PI));
        volant.style.setProperty('--volant', `${angle.toFixed(1)}deg`);
      }
    },
    cacher() {
      if (visible && racine) { racine.style.display = 'none'; visible = false; if (racine.reglage) racine.reglage.style.display = 'none'; }
    },
    get visible() { return visible; },
  };
}
