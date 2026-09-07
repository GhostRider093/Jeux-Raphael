// ==========================================================================
//  JAUGE DE VITESSE  -  affichage commun a la ville et aux Mondes
// --------------------------------------------------------------------------
//  Le cran de poursuite ne servait a rien tant qu'on ne le voyait pas : un
//  « x1.45 » ecrit en texte ne dit pas s'il reste de la marge, ni de combien.
//  Une jauge le dit d'un coup d'oeil, et c'est ce qu'il faut en vol — on n'a
//  pas le temps de lire un nombre.
//
//  Trois informations, de la plus lue a la moins lue :
//    1. la vitesse du moment, en chiffres ;
//    2. la barre de vitesse, avec le repere de la vitesse VISEE : l'ecart
//       entre le remplissage et le repere, c'est l'acceleration en cours ;
//    3. la barre de poursuite, du minimum au plafond du niveau, avec ce qui
//       reste a prendre.
//
//  Script classique, comme flight-model.js : les deux pages y accedent, celle
//  qui est un module comme celle qui ne l'est pas.
//
//  L'element est construit une seule fois. Les mises a jour ne touchent que
//  des transformations et du texte : aucune reconstruction, aucun calcul de
//  mise en page force a chaque image.
// ==========================================================================

(function () {
  'use strict';

  const STYLE = `
    #speed-gauge {
      position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%);
      z-index: 40; width: min(430px, 76vw); padding: 9px 13px 11px;
      display: none; pointer-events: none;
      border: 1px solid rgba(104, 235, 255, .38); border-radius: 10px;
      background: rgba(3, 11, 20, .74); backdrop-filter: blur(8px);
      color: #dff7ff; font: 700 13px Consolas, monospace; letter-spacing: .03em;
      text-shadow: 0 1px 2px #000;
    }
    #speed-gauge.visible { display: block; }
    #speed-gauge .sg-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
    #speed-gauge .sg-speed { font-size: 25px; font-weight: 900; color: #9df0ff; }
    #speed-gauge .sg-speed small { font-size: 12px; font-weight: 700; opacity: .72; margin-left: 3px; }
    #speed-gauge .sg-chase-label { font-size: 12px; opacity: .82; }
    #speed-gauge .sg-chase-label.sg-on { color: #7fe3ff; opacity: 1; }
    /* Les deux pistes partagent leur fond : c'est la meme lecture, a deux
       echelles differentes. */
    #speed-gauge .sg-track {
      position: relative; height: 11px; margin-top: 7px; overflow: hidden;
      border: 1px solid rgba(104, 235, 255, .32); border-radius: 6px;
      background: rgba(2, 17, 25, .82);
    }
    #speed-gauge .sg-track.sg-thin { height: 7px; margin-top: 5px; }
    /* Remplissage pilote par scaleX : pas de recalcul de mise en page. */
    #speed-gauge .sg-fill {
      position: absolute; inset: 0; transform-origin: left center; transform: scaleX(0);
      background: linear-gradient(90deg, #2f8fb0, #7fe3ff);
    }
    #speed-gauge .sg-fill.sg-chase { background: linear-gradient(90deg, #b0742f, #ffd08a); }
    /* Repere de la vitesse visee : l'appareil tend vers lui, il ne l'atteint
       jamais instantanement. */
    #speed-gauge .sg-target {
      position: absolute; top: -2px; bottom: -2px; width: 2px; margin-left: -1px;
      background: #fff; box-shadow: 0 0 6px rgba(255, 255, 255, .8);
    }
    #speed-gauge .sg-scale { display: flex; justify-content: space-between; margin-top: 3px; font-size: 10px; opacity: .6; }
    @media (max-width: 700px) {
      #speed-gauge { width: 86vw; bottom: 9px; padding: 7px 10px 9px; }
      #speed-gauge .sg-speed { font-size: 20px; }
    }
  `;

  // Au-dela de cette duree sans mise a jour, la jauge se cache d'elle-meme.
  // C'est ce qui evite de devoir la debrancher a la main dans chaque page
  // quand on quitte le vol : personne n'oublie un appel qui n'existe pas.
  const IDLE_HIDE_MS = 320;

  let root = null;
  let speedText = null;
  let speedFill = null;
  let speedTarget = null;
  let chaseFill = null;
  let chaseLabel = null;
  let chaseCeilingText = null;
  let lastUpdate = 0;
  let watching = false;

  function build() {
    if (root) return root;
    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.id = 'speed-gauge';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML =
      '<div class="sg-head">'
      + '<span class="sg-speed"><span data-sg="speed">0</span><small>km/h</small></span>'
      + '<span class="sg-chase-label" data-sg="chase-label">POURSUITE x1.00</span>'
      + '</div>'
      + '<div class="sg-track"><div class="sg-fill" data-sg="speed-fill"></div>'
      + '<div class="sg-target" data-sg="speed-target"></div></div>'
      + '<div class="sg-track sg-thin"><div class="sg-fill sg-chase" data-sg="chase-fill"></div></div>'
      + '<div class="sg-scale"><span>x1</span><span data-sg="chase-ceiling">x2</span></div>';
    document.body.appendChild(root);

    const pick = name => root.querySelector(`[data-sg="${name}"]`);
    speedText = pick('speed');
    speedFill = pick('speed-fill');
    speedTarget = pick('speed-target');
    chaseFill = pick('chase-fill');
    chaseLabel = pick('chase-label');
    chaseCeilingText = pick('chase-ceiling');
    return root;
  }

  function watchIdle() {
    if (watching) return;
    watching = true;
    const tick = () => {
      if (performance.now() - lastUpdate > IDLE_HIDE_MS) {
        if (root) root.classList.remove('visible');
        watching = false;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

  /**
   * @param {object} reading
   * @param {number} reading.speed   vitesse du moment, en unites monde par seconde.
   * @param {number} reading.target  vitesse visee, meme unite.
   * @param {number} reading.max     vitesse maximale atteignable, cran de poursuite compris.
   * @param {number} reading.notch   cran de poursuite courant.
   * @param {number} reading.ceiling plafond du cran pour le niveau en cours.
   */
  function update(reading) {
    if (!reading) return;
    build();
    lastUpdate = performance.now();
    root.classList.add('visible');
    watchIdle();

    const max = Math.max(1, reading.max || 1);
    const speed = Math.max(0, reading.speed || 0);
    // Les deux HUD affichaient deja la vitesse en km/h : on garde la meme
    // conversion pour ne pas donner deux chiffres differents pour un meme vol.
    speedText.textContent = Math.round(speed * 3.6);
    speedFill.style.transform = `scaleX(${clamp01(speed / max)})`;
    speedTarget.style.left = `${clamp01((reading.target || 0) / max) * 100}%`;

    const ceiling = Math.max(1.0001, reading.ceiling || 1.0001);
    const notch = Math.max(1, reading.notch || 1);
    chaseFill.style.transform = `scaleX(${clamp01((notch - 1) / (ceiling - 1))})`;
    chaseLabel.textContent = `POURSUITE x${notch.toFixed(2)}`;
    chaseLabel.classList.toggle('sg-on', notch > 1.02);
    chaseCeilingText.textContent = `x${ceiling.toFixed(2).replace(/\.?0+$/, '')}`;
  }

  /** Masquage immediat, quand on sait qu'on quitte le vol. */
  function hide() {
    if (root) root.classList.remove('visible');
  }

  window.RaphaelSpeedGauge = { update, hide };
})();
