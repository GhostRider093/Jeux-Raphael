(function () {
  'use strict';

  let context = null;
  let shotBuffer = null;
  let loading = null;
  let lastShotAt = -Infinity;

  function ensure() {
    if (!context) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return null;
      context = new AudioContextClass();
      // Un coup isole extrait d'une rafale reelle. L'enregistrement tire a
      // 24 coups/s, le jeu a 13,3 : impossible de le boucler tel quel sans
      // fausser la cadence. On rejoue donc UN coup au rythme du jeu.
      loading = fetch('./assets/sons/canon-coup.wav?v=rafale-reelle-20260908')
        .then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(`Canon ${response.status}`)))
        .then(data => context.decodeAudioData(data))
        .then(buffer => { shotBuffer = buffer; })
        .catch(error => console.warn('[fighter-cannon-audio]', error));
    }
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }

  function fireShot() {
    const audioContext = ensure();
    if (!audioContext || !shotBuffer) return;
    if (audioContext.currentTime - lastShotAt < .052) return;
    lastShotAt = audioContext.currentTime;
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = shotBuffer;
    source.playbackRate.value = .96 + Math.random() * .09;
    // A 13 coups par seconde avec 220 ms de traine, trois coups se superposent
    // en permanence. C'est ce qui fait qu'une mitrailleuse sonne pleine plutot
    // que hachee, mais le cumul sature : chaque coup part donc plus bas.
    gain.gain.value = .27 + Math.random() * .06;
    source.connect(gain).connect(audioContext.destination);
    source.start();
  }

  ['pointerdown', 'keydown', 'touchstart'].forEach(type => {
    window.addEventListener(type, ensure, { passive: true });
  });

  window.RaphaelFighterCannon = {
    fireShot,
    setFiring: () => {},
    stop: () => {},
    isFiring: () => false,
    ready: () => Boolean(shotBuffer),
    loading: () => loading
  };
})();
