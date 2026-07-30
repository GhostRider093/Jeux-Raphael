// ==========================================================================
//  MISE EN FORME DES COMMANDES  -  manette, clavier, capteurs
// --------------------------------------------------------------------------
//  Trois problemes de pilotage traites ici :
//
//  1. Zone morte carree. Tester chaque axe separement cree un centre mort
//     carre : le stick « accroche » sur les diagonales. La zone morte doit
//     etre radiale, calculee sur la magnitude du vecteur.
//
//  2. Reponse lineaire. Une fois la zone morte franchie, l'autorite est
//     immediatement proportionnelle : rien ne bouge, puis tout part d'un coup.
//     Une courbe exponentielle donne de la finesse au centre tout en gardant
//     la pleine autorite a fond de course.
//
//  3. Derive materielle. Un stick use ne revient pas exactement a zero. Si la
//     derive depasse la zone morte, l'appareil vire tout seul. Le recentrage
//     automatique memorise la position de repos au demarrage et la retranche.
//
//  Aucune fonction de ce module n'alloue : les resultats sont ecrits dans des
//  objets reutilises, elles sont donc appelables depuis la boucle d'animation.
// ==========================================================================

const clamp01 = value => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Courbe exponentielle facon radiocommande.
 * `expo` = 0 conserve la reponse lineaire, 1 donne la courbe la plus douce.
 * La pleine autorite est preservee : f(1) = 1 quel que soit `expo`.
 */
export function applyExpo(value, expo) {
  if (!expo) return value;
  return expo * value * value * value + (1 - expo) * value;
}

/**
 * Mise en forme d'un axe isole (gaz, frein, montee).
 */
export function shapeAxis(value, deadZone = .06, expo = .45) {
  const raw = value || 0;
  const magnitude = Math.abs(raw);
  if (magnitude <= deadZone) return 0;
  const normalized = clamp01((magnitude - deadZone) / (1 - deadZone));
  return Math.sign(raw) * applyExpo(normalized, expo);
}

/**
 * Mise en forme d'un stick a deux axes, avec zone morte radiale, courbe
 * exponentielle et recentrage automatique.
 *
 * @param {object} options
 * @param {number} options.deadZone rayon du centre mort, en fraction de course.
 * @param {number} options.expo intensite de la courbe, de 0 a 1.
 * @param {number} options.calibrationSamples nombre de lectures au repos
 *   necessaires avant de figer le centre.
 * @param {number} options.maxCalibration correction de centre maximale
 *   toleree : protege le cas ou le joueur tient deja le stick au demarrage.
 */
export function createStickShaper({
  deadZone = .06,
  expo = .45,
  calibrationSamples = 24,
  maxCalibration = .25,
  restThreshold = .3
} = {}) {
  // Objet resultat reutilise a chaque image.
  const out = { x: 0, y: 0, magnitude: 0 };
  let centerX = 0, centerY = 0;
  let sumX = 0, sumY = 0, samples = 0, calibrated = false;
  // Reglages modifiables en cours de partie : trouver le bon toucher demande
  // de l'essayer manette en main, pas de recompiler.
  let currentDeadZone = deadZone;
  let currentExpo = expo;
  // Derniere lecture brute, pour pouvoir observer ce que la manette envoie
  // vraiment sans instrumenter la boucle de vol.
  let lastRawX = 0, lastRawY = 0;

  /**
   * @returns {{x: number, y: number, magnitude: number}} le meme objet a chaque appel.
   */
  function shape(rawX, rawY) {
    const x = rawX || 0;
    const y = rawY || 0;
    lastRawX = x; lastRawY = y;

    // Recentrage : seules les lectures proches du neutre sont retenues, pour
    // qu'un stick tenu au demarrage ne fausse pas la reference.
    if (!calibrated) {
      if (Math.hypot(x, y) < restThreshold) {
        sumX += x; sumY += y; samples++;
        if (samples >= calibrationSamples) {
          const averageX = sumX / samples;
          const averageY = sumY / samples;
          const drift = Math.hypot(averageX, averageY);
          if (drift <= maxCalibration) { centerX = averageX; centerY = averageY; }
          calibrated = true;
        }
      }
    }

    const dx = x - centerX;
    const dy = y - centerY;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude <= currentDeadZone) {
      out.x = 0; out.y = 0; out.magnitude = 0;
      return out;
    }

    // La courbe s'applique a la magnitude : la direction du stick est
    // preservee exactement, seule son intensite est remise en forme.
    const normalized = clamp01((magnitude - currentDeadZone) / (1 - currentDeadZone));
    const shaped = applyExpo(normalized, currentExpo);
    const ratio = shaped / magnitude;
    out.x = dx * ratio;
    out.y = dy * ratio;
    out.magnitude = shaped;
    return out;
  }

  return {
    shape,
    /** Relance le recentrage, par exemple apres un changement de manette. */
    reset() { centerX = centerY = sumX = sumY = 0; samples = 0; calibrated = false; },
    /** Reglage a chaud. Les champs omis sont laisses tels quels. */
    configure({ deadZone: nextDeadZone, expo: nextExpo } = {}) {
      if (Number.isFinite(nextDeadZone)) currentDeadZone = clamp01(nextDeadZone);
      if (Number.isFinite(nextExpo)) currentExpo = clamp01(nextExpo);
      return { deadZone: currentDeadZone, expo: currentExpo };
    },
    diagnostics: () => ({
      deadZone: currentDeadZone,
      expo: currentExpo,
      calibrated,
      samples,
      center: { x: centerX, y: centerY },
      raw: { x: lastRawX, y: lastRawY },
      shaped: { x: out.x, y: out.y, magnitude: out.magnitude }
    })
  };
}

/**
 * Mise en forme d'une gachette.
 *
 * Le repos d'un axe de gachette n'est pas normalise d'une manette a l'autre :
 * -1 sur la plupart des pads, 0 sur certains sticks, +1 sur quelques modeles.
 * Sans apprentissage de ce repos, un axe non actionne est lu comme une commande
 * permanente — c'est ainsi qu'une manette posee sur la table peut freiner en
 * continu et donner l'impression que l'accelerateur ne repond plus.
 *
 * @returns un objet dont `shape(raw)` renvoie la deflexion, de 0 a 1.
 */
export function createTriggerShaper({ deadZone = .06, expo = .2, calibrationSamples = 20 } = {}) {
  let rest = null;
  let sum = 0, samples = 0;

  function shape(raw) {
    const value = raw || 0;
    if (rest === null) {
      sum += value;
      samples++;
      // Le repos est fige apres quelques lectures. Une gachette deja enfoncee
      // au chargement decale la reference, mais elle se recale au relachement
      // via `reset()`.
      if (samples >= calibrationSamples) rest = sum / samples;
      return 0;
    }
    // La course utile depend du repos appris : -1 laisse deux unites de course,
    // 0 n'en laisse qu'une, +1 inverse le sens.
    const span = rest > .5 ? -(rest + 1) : (1 - rest);
    if (Math.abs(span) < .05) return 0;
    const deflection = clamp01((value - rest) / span);
    if (deflection <= deadZone) return 0;
    return applyExpo(clamp01((deflection - deadZone) / (1 - deadZone)), expo);
  }

  return {
    shape,
    reset() { rest = null; sum = 0; samples = 0; },
    diagnostics: () => ({ rest, samples, deadZone, expo })
  };
}

/**
 * Facteur de lissage independant de la frequence d'images.
 *
 * `lerp(cible, dt * k)` donne un resultat qui change avec le framerate et
 * devient incoherent des que `dt` varie. `1 - exp(-k * dt)` est la forme
 * exacte : la constante de temps vaut 1/k seconde quel que soit le rythme.
 */
export function smoothing(rate, dt) {
  return 1 - Math.exp(-rate * dt);
}

/**
 * Rampe clavier.
 *
 * Une touche est binaire : sans rampe l'ordre passe de 0 a 1 en une image, ce
 * qui interdit tout ajustement fin. La montee est progressive, le retour au
 * neutre volontairement plus rapide pour que relacher la touche arrete net.
 */
export function rampKey(current, target, dt, riseRate = 12, releaseRate = 26) {
  const rate = target === 0 ? releaseRate : riseRate;
  return current + (target - current) * smoothing(rate, dt);
}
