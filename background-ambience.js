/**
 * L'ambiance de fond — désormais **silencieuse par défaut**.
 *
 * Ce module jouait `background-ambience.ogg` (65 minutes, 15,7 Mo) en boucle
 * dès le **premier clic sur la page**, quelle que soit la page, quel que soit
 * le mode, et sans que rien ne l'ait demandé : on l'entendait sur le menu des
 * mondes, pendant le chargement, en voiture, en trottinette. C'est le « son
 * horrible en fond » — il ne venait pas du jeu, il venait d'ici.
 *
 * Trois corrections, dans cet ordre d'importance :
 *
 * 1. **Plus d'auto-démarrage.** Un son de fond se demande, il ne s'impose pas
 *    au premier clic. Il faut appeler `start()` ou `set(true)`.
 * 2. **Préférence retenue** (`localStorage`) : celui qui l'allume le retrouve,
 *    celui qui l'éteint ne le réentend jamais.
 * 3. **Vrai silence.** `stop()` met en pause *et* rembobine ; l'onglet caché
 *    coupe, et ne redémarre que si l'ambiance était réellement allumée.
 */
(function () {
  'use strict';

  const CLE = 'raphael-ambiance';
  const ambience = new Audio('./assets/audio/background-ambience.ogg?v=background-20260719');
  ambience.loop = true;
  // `none` et non `metadata` : tant que personne n'a demandé l'ambiance, ce
  // fichier de 15 Mo n'a aucune raison de commencer à descendre.
  ambience.preload = 'none';
  ambience.volume = .055;

  let voulue = false;
  try { voulue = localStorage.getItem(CLE) === '1'; } catch (e) { /* mode privé */ }

  function jouer() {
    if (!voulue || document.hidden) return;
    const promise = ambience.play();
    if (promise?.catch) promise.catch(() => {});
  }

  function start() {
    voulue = true;
    try { localStorage.setItem(CLE, '1'); } catch (e) { /* mode privé */ }
    jouer();
  }

  function stop() {
    voulue = false;
    try { localStorage.setItem(CLE, '0'); } catch (e) { /* mode privé */ }
    ambience.pause();
    // Rembobiner : sans cela, une ambiance rallumée reprend au milieu d'une
    // nappe déjà installée, et l'entrée s'entend.
    try { ambience.currentTime = 0; } catch (e) { /* pas encore chargé */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) ambience.pause();
    else jouer();
  });
  window.addEventListener('pagehide', () => ambience.pause());

  window.RaphaelBackgroundAmbience = {
    start,
    stop,
    set: actif => (actif ? start() : stop()),
    basculer: () => { if (voulue) { stop(); return false; } start(); return true; },
    setVolume: value => { ambience.volume = Math.max(0, Math.min(.16, Number(value) || 0)); },
    state: () => ({ voulue, paused: ambience.paused, volume: ambience.volume })
  };
})();
