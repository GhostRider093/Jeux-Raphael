/**
 * Le réacteur du chasseur.
 *
 * Deux boucles : le moteur (réaccordé aux gaz) et l'air autour. Elles ne
 * tournent **que pendant le vol**.
 *
 * Ce module démarrait autrefois ses deux boucles au premier clic de la page,
 * avant même qu'un monde soit choisi, et ne s'arrêtait jamais vraiment :
 * `silence()` fait tendre les gains vers zéro sans les y amener, et le
 * contexte audio restait éveillé. En voiture, en trottinette ou sur le menu,
 * un réacteur continuait donc de tourner sous le seuil de l'audible — et
 * remontait au moindre `update()`.
 *
 * Désormais :
 *
 * — **rien ne démarre tout seul** : `update()` est le seul allumage, et il
 *   n'est appelé que par la boucle de vol ;
 * — `stop()` coupe pour de bon : rampes annulées, gains à zéro, sources
 *   arrêtées, contexte suspendu. Les tampons décodés restent en mémoire, un
 *   redémarrage est donc immédiat ;
 * — l'onglet caché, la page quittée et la perte de focus coupent par
 *   **événement**, pas par la boucle d'animation : `requestAnimationFrame`
 *   s'arrête dans un onglet caché, et c'est précisément ce qui laissait le
 *   réacteur ronronner dans le vide.
 */
(function () {
  'use strict';

  const state = {
    context: null,
    engine: null,
    ambience: null,
    engineGain: null,
    ambienceGain: null,
    filter: null,
    started: false,
    loading: null,
    throttle: 0
  };

  // Les tampons décodés survivent à un arrêt : on ne retélécharge pas.
  const tampons = { engine: null, ambience: null };

  function loadBuffer(context, url) {
    return fetch(url)
      .then(response => {
        if (!response.ok) throw new Error(`Audio ${response.status}: ${url}`);
        return response.arrayBuffer();
      })
      .then(data => context.decodeAudioData(data));
  }

  function lancerSources() {
    if (!state.context || !tampons.engine || !tampons.ambience) return;
    state.engine = state.context.createBufferSource();
    state.engine.buffer = tampons.engine;
    state.engine.loop = true;
    state.engine.loopStart = Math.min(2.2, tampons.engine.duration * .08);
    state.engine.loopEnd = Math.max(state.engine.loopStart + 1, tampons.engine.duration - 1.6);
    state.engine.connect(state.engineGain);
    state.engine.start();
    state.ambience = state.context.createBufferSource();
    state.ambience.buffer = tampons.ambience;
    state.ambience.loop = true;
    state.ambience.connect(state.ambienceGain);
    state.ambience.start();
  }

  function ensureStarted() {
    if (state.started) {
      if (state.context?.state === 'suspended') state.context.resume().catch(() => {});
      return state.loading || Promise.resolve();
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return Promise.resolve();
    state.started = true;
    state.context = state.context || new AudioContextClass();
    state.engineGain = state.context.createGain();
    state.ambienceGain = state.context.createGain();
    state.filter = state.context.createBiquadFilter();
    state.filter.type = 'lowpass';
    state.filter.frequency.value = 5200;
    state.engineGain.gain.value = 0;
    state.ambienceGain.gain.value = 0;
    state.engineGain.connect(state.filter).connect(state.context.destination);
    state.ambienceGain.connect(state.context.destination);
    if (tampons.engine && tampons.ambience) {
      lancerSources();
      state.loading = Promise.resolve();
    } else {
      state.loading = Promise.all([
        loadBuffer(state.context, './assets/audio/fighter-jet-engine.ogg'),
        loadBuffer(state.context, './assets/audio/fighter-jet-ambience.ogg')
      ]).then(([engineBuffer, ambienceBuffer]) => {
        tampons.engine = engineBuffer;
        tampons.ambience = ambienceBuffer;
        // Entre-temps, le vol a pu s'arrêter : on ne rallume pas un réacteur
        // que plus personne n'écoute.
        if (state.started) lancerSources();
      }).catch(error => console.warn('[fighter-engine-audio]', error));
    }
    state.context.resume().catch(() => {});
    return state.loading;
  }

  function update(throttle, boosting) {
    state.throttle = Math.max(0, Math.min(1, Number(throttle) || 0));
    ensureStarted().then(() => {
      if (!state.engine || !state.context) return;
      const now = state.context.currentTime;
      const power = Math.max(.12, state.throttle);
      state.engine.playbackRate.setTargetAtTime(.72 + power * .68 + (boosting ? .12 : 0), now, .16);
      state.engineGain.gain.setTargetAtTime(.085 + power * .24 + (boosting ? .055 : 0), now, .12);
      state.ambienceGain.gain.setTargetAtTime(.018 + power * .045, now, .45);
      state.filter.frequency.setTargetAtTime(2300 + power * 7200, now, .18);
    });
  }

  /** Baisse en douceur, sans rien démonter : un passage au ralenti. */
  function silence() {
    if (!state.context) return;
    const now = state.context.currentTime;
    state.engineGain?.gain.setTargetAtTime(0, now, .15);
    state.ambienceGain?.gain.setTargetAtTime(0, now, .3);
  }

  /**
   * Coupe pour de bon. À appeler en quittant le vol — `setTargetAtTime` est
   * une approche exponentielle : elle n'atteint jamais zéro, et un réacteur à
   * -60 dB reste un réacteur qui tourne.
   */
  function stop() {
    if (!state.context) return;
    const now = state.context.currentTime;
    for (const gain of [state.engineGain, state.ambienceGain]) {
      if (!gain) continue;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
    }
    for (const source of [state.engine, state.ambience]) {
      if (!source) continue;
      try { source.stop(); } catch (e) { /* déjà arrêtée */ }
      try { source.disconnect(); } catch (e) { /* déjà détachée */ }
    }
    state.engine = null;
    state.ambience = null;
    state.started = false;
    state.loading = null;
    state.throttle = 0;
    state.context.suspend().catch(() => {});
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', stop);
  window.addEventListener('blur', silence);
  window.RaphaelFighterEngine = {
    start: ensureStarted, update, silence, stop,
    state: () => ({ started: state.started, throttle: state.throttle })
  };
})();
