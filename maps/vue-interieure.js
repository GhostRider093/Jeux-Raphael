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
 * Le volant (`assets/car/volant-berline.webp`, avec les mains, à venir) est un
 * second calque, facultatif : s'il existe, il tourne avec la direction.
 */
const IMAGE = 'assets/car/interieur-berline.webp?v=20261002a';
const VOLANT = 'assets/car/volant-berline.webp?v=20261001a';

// Repères dans l'image (en part de sa hauteur), mesurés sur la photo
const CADRAGE_Y = 0.12;       // `object-position` vertical : on garde le haut (pare-brise, planche)
// 2e photo d'Arnaud (01/10/2026, planche carbone et compteurs) : pare-brise de 0,078 à 0,322
const CAPOT = 0.322;          // la base du pare-brise
const HORIZON = 0.25;         // où l'on veut l'horizon : un peu au-dessus du capot
const VOLANT_TOURS = 3.2;     // rotation du volant pour un radian de braquage des roues

const STYLE = `
#habitacle{position:fixed;inset:0;z-index:0;pointer-events:none;display:none;overflow:hidden}
#habitacle img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% ${CADRAGE_Y * 100}%}
#habitacle img.volant{inset:auto;left:50%;bottom:-6vmin;width:min(78vmin,70vw);height:auto;object-fit:contain;
  transform:translateX(-50%) rotate(var(--volant,0deg));transform-origin:50% 50%;display:none}
`;

export function creerHabitacle() {
  let racine = null, volant = null, visible = false;

  function monter() {
    if (racine) return;
    const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
    racine = document.createElement('div'); racine.id = 'habitacle';
    const fond = document.createElement('img'); fond.src = IMAGE; fond.alt = ''; fond.decoding = 'async';
    racine.appendChild(fond);
    volant = document.createElement('img'); volant.className = 'volant'; volant.alt = '';
    volant.onload = () => { volant.style.display = 'block'; };
    volant.onerror = () => { volant.remove(); volant = null; };       // pas encore de volant : rien
    volant.src = VOLANT;
    racine.appendChild(volant);
    // juste après la scène 3D, avant tout le reste : les panneaux, le compteur et
    // les boutons tactiles restent par-dessus l'habitacle
    const scene = document.getElementById('scene');
    if (scene) scene.after(racine); else document.body.prepend(racine);
  }

  /**
   * L'angle (rad) dont la caméra doit plonger sous l'horizontale pour que
   * l'horizon tombe à `HORIZON` dans l'image recadrée.
   */
  function plongee(fovDeg) {
    const W = innerWidth, H = innerHeight;
    // object-fit: cover d'une image carrée
    const cote = Math.max(W, H);
    const haut = (H - cote) * CADRAGE_Y;              // décalage du haut de l'image (≤ 0)
    const yHorizon = haut + HORIZON * cote;           // px depuis le haut de l'écran
    const ndc = 1 - (2 * yHorizon) / H;               // > 0 : au-dessus du centre
    return Math.atan(ndc * Math.tan((fovDeg * Math.PI) / 360));
  }

  return {
    CAPOT,
    plongee,
    /** À chaque image en vue intérieure ; `braquage` : celui des roues (rad, positif à droite = volant dans le sens des aiguilles). */
    montrer(braquage = 0) {
      monter();
      if (!visible) { racine.style.display = 'block'; visible = true; }
      if (volant) volant.style.setProperty('--volant', `${(braquage * VOLANT_TOURS * 180) / Math.PI}deg`);
    },
    cacher() {
      if (visible && racine) { racine.style.display = 'none'; visible = false; }
    },
    get visible() { return visible; },
  };
}
