// ==========================================================================
//  SON DE POUSSEE
// --------------------------------------------------------------------------
//  Souffle de sur-regime synthetise a la volee : aucun fichier a telecharger,
//  fonctionne hors ligne. Meme approche que fighter-cannon-audio.js.
//
//  Trois couches se superposent :
//    grondement  oscillateur grave, la masse
//    souffle     bruit blanc filtre en passe-bande qui monte, l'arrachement
//    coup        salve courte a l'enclenchement, le « punch »
//
//  Le contexte audio n'est cree qu'au premier geste du joueur : les
//  navigateurs refusent tout son avant une interaction.
// ==========================================================================

(function () {
  let context = null;
  let noiseBuffer = null;
  let rumble = null, rumbleGain = null;
  let breath = null, breathGain = null, breathFilter = null;
  let masterGain = null;
  let running = false;

  function ensure() {
    if (context) return context;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();

    masterGain = context.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(context.destination);

    // Bruit blanc de deux secondes, boucle : suffisant pour un souffle continu.
    const length = context.sampleRate * 2;
    noiseBuffer = context.createBuffer(1, length, context.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    return context;
  }

  function start() {
    const c = ensure();
    if (!c || running) return;
    running = true;

    rumble = c.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 46;
    rumbleGain = c.createGain();
    rumbleGain.gain.value = .0001;
    const rumbleFilter = c.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 180;
    rumble.connect(rumbleFilter); rumbleFilter.connect(rumbleGain); rumbleGain.connect(masterGain);
    rumble.start();

    breath = c.createBufferSource();
    breath.buffer = noiseBuffer;
    breath.loop = true;
    breathFilter = c.createBiquadFilter();
    breathFilter.type = 'bandpass';
    breathFilter.frequency.value = 620;
    breathFilter.Q.value = .8;
    breathGain = c.createGain();
    breathGain.gain.value = .0001;
    breath.connect(breathFilter); breathFilter.connect(breathGain); breathGain.connect(masterGain);
    breath.start();
  }

  /**
   * @param {number} intensity 0 a 1. Le son suit la poussee en continu.
   */
  function update(intensity) {
    if (!context || !running) return;
    const value = Math.max(0, Math.min(1, intensity));
    const now = context.currentTime;
    // `setTargetAtTime` lisse la montee : sans lui chaque image produirait un
    // saut de gain audible en crepitement.
    masterGain.gain.setTargetAtTime(value * .5, now, .08);
    rumbleGain.gain.setTargetAtTime(.5 + value * .5, now, .1);
    breathGain.gain.setTargetAtTime(.25 + value * .75, now, .07);
    // La bande monte avec la poussee : c'est ce glissement qui donne la
    // sensation d'arrachement plutot qu'un simple volume.
    breathFilter.frequency.setTargetAtTime(520 + value * 2600, now, .12);
    rumble.frequency.setTargetAtTime(42 + value * 34, now, .15);
  }

  /** Coup sec a l'enclenchement de la poussee. */
  function punch() {
    const c = ensure();
    if (!c) return;
    start();
    const source = c.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2400, c.currentTime);
    filter.frequency.exponentialRampToValueAtTime(220, c.currentTime + .5);
    const gain = c.createGain();
    gain.gain.setValueAtTime(.85, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .55);
    source.connect(filter); filter.connect(gain); gain.connect(c.destination);
    source.start();
    source.stop(c.currentTime + .6);
  }

  function stop() {
    if (!context || !running) return;
    masterGain.gain.setTargetAtTime(0, context.currentTime, .12);
  }

  document.addEventListener('keydown', ensure, { passive: true, once: false });
  document.addEventListener('pointerdown', ensure, { passive: true, once: false });

  window.RaphaelBoostAudio = { ensure, start, update, punch, stop };
})();
