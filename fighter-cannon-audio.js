// ==========================================================================
//  SON DU CANON  -  deux couches
// --------------------------------------------------------------------------
//  Un canon d'avion entendu depuis le poste, ce n'est pas une suite de coups
//  secs : c'est autant une vibration qu'un claquement. Un echantillon seul,
//  rejoue treize fois par seconde, sonne toujours mince — il lui manque le bas
//  du spectre, celui qui ne s'entend pas vraiment mais qui se sent.
//
//    impact       le coup lui-meme, rejoue a chaque tir, avec une legere
//                 variation de hauteur et de niveau. Deux coups rigoureusement
//                 identiques sonnent mecanique, et c'est ce qui trahit un
//                 echantillon.
//    grondement   le meme enregistrement filtre sous 260 Hz et lisse, en
//                 boucle continue. Il monte quand on tire, retombe quand on
//                 s'arrete.
//
//  Le grondement n'a pas besoin qu'on lui dise d'arreter : il se nourrit des
//  coups. Tant qu'ils arrivent, il monte ; des qu'ils cessent, il s'eteint
//  tout seul. Aucun appelant n'a donc a etre modifie.
//
//  Provenance et droits des enregistrements : assets/sons/PROVENANCE.md
// ==========================================================================

(function () {
  'use strict';

  const VERSION = 'canon-fort-20260908';
  const IMPACT_URL = `./assets/sons/canon-coup.wav?v=${VERSION}`;
  const GRONDEMENT_URL = `./assets/sons/canon-grondement.wav?v=${VERSION}`;

  // Niveau de chaque impact. Le canon tire lentement — sept coups par seconde
  // — donc chaque coup a le temps de s'eteindre avant le suivant et peut
  // partir bien plus fort qu'a la cadence d'une mitrailleuse, ou trois coups
  // sonnaient en permanence ensemble. On depasse volontairement 1 : le
  // limiteur du bus de sortie ramasse les cretes, et c'est ce depassement qui
  // fait la difference entre un canon qu'on entend et un canon qui cogne.
  const IMPACT_NIVEAU = 1.15;
  // La nappe monte avec les impacts : elle ne doit plus seulement se sentir,
  // elle doit porter le coup. Elle reste largement sous l'impact pour ne pas
  // le noyer.
  const GRONDEMENT_NIVEAU = .46;
  // Au-dela de ce silence, on considere que le joueur a lache la detente.
  const SILENCE_ARRET = .19;

  let context = null;
  let sortie = null;
  let shotBuffer = null, rumbleBuffer = null;
  let loading = null;
  let lastShotAt = -Infinity;
  let rumbleSource = null, rumbleGain = null;
  let surveillance = null;

  /**
   * Bus de sortie : tout passe par un limiteur. Le canon part maintenant bien
   * au-dessus de 1 en gain, et sans limiteur les cretes seraient tranchees
   * net par la sortie audio — ca ne s'entend pas comme une detonation plus
   * forte, ca s'entend comme un craquement sale. Le limiteur ecrete
   * proprement : le coup garde son claquement, et il gagne en presence au
   * lieu de gagner en distorsion.
   */
  function busSortie() {
    if (sortie) return sortie;
    const limiteur = context.createDynamicsCompressor();
    limiteur.threshold.value = -3;
    limiteur.knee.value = 0;
    limiteur.ratio.value = 20;
    limiteur.attack.value = .002;
    limiteur.release.value = .12;
    limiteur.connect(context.destination);
    sortie = limiteur;
    return sortie;
  }

  function ensure() {
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      const lire = url => fetch(url)
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${url} : ${r.status}`)))
        .then(d => context.decodeAudioData(d));
      loading = Promise.all([lire(IMPACT_URL), lire(GRONDEMENT_URL)])
        .then(([impact, grondement]) => { shotBuffer = impact; rumbleBuffer = grondement; })
        .catch(error => console.warn('[fighter-cannon-audio]', error));
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }

  /** Demarre la boucle de grondement, silencieuse tant qu'on ne tire pas. */
  function demarrerGrondement() {
    if (rumbleSource || !rumbleBuffer) return;
    rumbleSource = context.createBufferSource();
    rumbleSource.buffer = rumbleBuffer;
    rumbleSource.loop = true;
    rumbleGain = context.createGain();
    rumbleGain.gain.value = .0001;
    rumbleSource.connect(rumbleGain).connect(busSortie());
    rumbleSource.start();
  }

  /**
   * Surveille l'arret du tir. Ne tourne que pendant que le grondement est
   * audible : au repos, aucun minuteur ne consomme quoi que ce soit.
   */
  function surveiller() {
    if (surveillance) return;
    surveillance = setInterval(() => {
      if (!context || !rumbleGain) return;
      if (context.currentTime - lastShotAt > SILENCE_ARRET) {
        rumbleGain.gain.setTargetAtTime(.0001, context.currentTime, .06);
        clearInterval(surveillance);
        surveillance = null;
      }
    }, 70);
  }

  function fireShot() {
    const audioContext = ensure();
    if (!audioContext || !shotBuffer) return;
    // Deux tirs trop rapproches ne s'entendraient pas : ils ne feraient
    // qu'additionner du niveau et saturer.
    if (audioContext.currentTime - lastShotAt < .052) return;
    lastShotAt = audioContext.currentTime;

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = shotBuffer;
    source.playbackRate.value = .96 + Math.random() * .09;
    gain.gain.value = IMPACT_NIVEAU * (.88 + Math.random() * .24);
    source.connect(gain).connect(busSortie());
    source.start();

    demarrerGrondement();
    if (rumbleGain) {
      rumbleGain.gain.setTargetAtTime(GRONDEMENT_NIVEAU, audioContext.currentTime, .05);
      surveiller();
    }
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(type => {
    window.addEventListener(type, ensure, { passive: true });
  });

  window.RaphaelFighterCannon = {
    fireShot,
    setFiring: () => {},
    stop: () => {
      if (rumbleGain && context) rumbleGain.gain.setTargetAtTime(.0001, context.currentTime, .05);
    },
    isFiring: () => Boolean(context) && context.currentTime - lastShotAt < SILENCE_ARRET,
    ready: () => Boolean(shotBuffer),
    loading: () => loading
  };
})();
