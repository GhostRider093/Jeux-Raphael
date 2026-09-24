// ==========================================================================
//  SON DE POUSSEE
// --------------------------------------------------------------------------
//  Deux enregistrements de reacteur, et non plus une synthese.
//
//  L'ancienne version fabriquait le son a la volee : un oscillateur en dents
//  de scie a 46 Hz pour la masse, du bruit blanc filtre en passe-bande pour
//  l'arrachement, une salve de bruit a l'enclenchement. Rien de tout cela ne
//  peut sonner comme un reacteur — un bruit blanc n'a pas d'harmoniques qui
//  montent, et une dent de scie a frequence fixe n'a pas de grain. A pleine
//  poussee, les trois couches saturaient ensemble.
//
//    coup      la montee en puissance d'un vrai survol, prise juste avant le
//              sommet : c'est le geste d'une poussee qui s'etablit.
//    souffle   la boucle moteur, assombrie et epaissie dans le grave pour
//              passer SOUS le son du reacteur au lieu de se battre avec lui.
//
//  Les fichiers sont charges une seule fois, decodes une seule fois, et le
//  souffle tourne en boucle sans discontinuite : son point de raccord a ete
//  fabrique par fondu croise, l'ecart y est de 0,0001.
//
//  Le contexte audio n'est cree qu'au premier geste du joueur : les
//  navigateurs refusent tout son avant une interaction.
//
//  Provenance et droits des enregistrements : assets/sons/PROVENANCE.md
// ==========================================================================

(function () {
  const DOSSIER = './assets/sons/';
  const FICHIER_COUP = 'boost-coup.wav';
  const FICHIER_SOUFFLE = 'boost-souffle.wav';

  // Niveau maximal du souffle tenu. L'ancienne version montait a 0,5 sur le
  // gain principal en plus de ses trois couches : c'est ce cumul qui rendait
  // la poussee insupportable a fond.
  const SOUFFLE_MAX = .34;
  const COUP_NIVEAU = .55;

  let context = null;
  let masterGain = null;
  let souffleSource = null, souffleGain = null, souffleFiltre = null;
  let running = false;
  let coupBuffer = null, souffleBuffer = null;
  let chargement = null;

  function ensure() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    masterGain = context.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(context.destination);
    charger();
    return context;
  }

  /** Telechargement et decodage, une seule fois pour toute la partie. */
  function charger() {
    if (chargement) return chargement;
    const lire = fichier => fetch(DOSSIER + fichier)
      .then(r => r.arrayBuffer())
      .then(donnees => context.decodeAudioData(donnees));
    chargement = Promise.all([lire(FICHIER_COUP), lire(FICHIER_SOUFFLE)])
      .then(([coup, souffle]) => { coupBuffer = coup; souffleBuffer = souffle; })
      .catch(erreur => {
        chargement = null;
        console.warn('[poussee] enregistrements indisponibles', erreur);
      });
    return chargement;
  }

  function start() {
    const c = ensure();
    if (!c || running || !souffleBuffer) return;
    running = true;

    souffleSource = c.createBufferSource();
    souffleSource.buffer = souffleBuffer;
    souffleSource.loop = true;

    // Le filtre s'ouvre avec la poussee. C'est ce glissement qui donne la
    // sensation d'arrachement — un simple volume ne la donne pas.
    souffleFiltre = c.createBiquadFilter();
    souffleFiltre.type = 'lowpass';
    souffleFiltre.frequency.value = 700;
    souffleFiltre.Q.value = .7;

    souffleGain = c.createGain();
    souffleGain.gain.value = .0001;

    souffleSource.connect(souffleFiltre);
    souffleFiltre.connect(souffleGain);
    souffleGain.connect(masterGain);
    souffleSource.start();
  }

  /**
   * @param {number} intensity 0 a 1. Le son suit la poussee en continu.
   */
  function update(intensity) {
    if (!context) return;
    if (!running) { start(); if (!running) return; }
    const value = Math.max(0, Math.min(1, intensity));
    const now = context.currentTime;
    // `setTargetAtTime` lisse la montee : sans lui chaque image produirait un
    // saut de gain audible en crepitement.
    masterGain.gain.setTargetAtTime(value * SOUFFLE_MAX, now, .09);
    souffleGain.gain.setTargetAtTime(.35 + value * .65, now, .08);
    souffleFiltre.frequency.setTargetAtTime(620 + value * 2400, now, .13);
    // Le moteur prend des tours : la lecture accelere legerement. Tres peu —
    // au-dela de 1,15 l'enregistrement se met a siffler.
    if (souffleSource) souffleSource.playbackRate.setTargetAtTime(.94 + value * .18, now, .2);
  }

  /** Coup sec a l'enclenchement de la poussee. */
  function punch() {
    const c = ensure();
    if (!c) return;
    const jouer = () => {
      if (!coupBuffer) return;
      start();
      const source = c.createBufferSource();
      source.buffer = coupBuffer;
      const gain = c.createGain();
      gain.gain.setValueAtTime(COUP_NIVEAU, c.currentTime);
      source.connect(gain);
      gain.connect(c.destination);
      source.start();
    };
    if (coupBuffer) jouer();
    else charger().then(jouer);
  }

  /**
   * Coupe le souffle. Baisser le gain ne suffit pas : `setTargetAtTime` est
   * une approche exponentielle, elle n'atteint jamais zero, et la boucle
   * continuait donc de tourner en fond pour le reste de la partie — un
   * reacteur a -60 dB reste un reacteur qui tourne. On demonte la source, et
   * `start()` la reconstruira a la prochaine poussee.
   */
  function stop() {
    if (!context || !running) return;
    const now = context.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(0, now, .14);
    const source = souffleSource;
    souffleSource = null;
    running = false;
    // On laisse la descente s'entendre, puis on arrete pour de bon.
    setTimeout(() => {
      if (!source) return;
      try { source.stop(); } catch (e) { /* deja arretee */ }
      try { source.disconnect(); } catch (e) { /* deja detachee */ }
    }, 450);
  }

  document.addEventListener('keydown', ensure, { passive: true, once: false });
  document.addEventListener('pointerdown', ensure, { passive: true, once: false });

  window.RaphaelBoostAudio = { ensure, start, update, punch, stop };
})();
