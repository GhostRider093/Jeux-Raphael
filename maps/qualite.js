/**
 * Niveaux de qualité du rendu — Bas, Moyen, Élevé — comme dans un vrai jeu.
 *
 * Le joueur choisit ; la machine ne décide qu'une fois, au premier lancement,
 * en se mesurant elle-même. Un automatisme qui dégrade en cours de partie donne
 * l'impression d'un jeu qui bégaie : ici, rien ne change sans qu'on l'ait demandé.
 *
 * Les trois leviers ont été mesurés sur une RTX 4070 Ti en 1080p (24/09/2026) :
 *   - les ombres douces 4096² doublent presque le coût d'une image (2,75 → 1,63 ms) ;
 *   - la définition : le ratio de pixels multiplie le travail par pixel (ratio 2 = ×4) ;
 *   - le feuillage : 84 cartes par arbre, ~440 000 triangles découpés à l'alpha.
 * Tout s'applique à chaud : définition et ombres sur le rendu, feuillage par la
 * plage de dessin des cartes (`setDrawRange`), sans reconstruire la scène. Seul
 * l'anticrénelage est figé à la création du rendu : il suit le niveau mémorisé
 * au prochain chargement.
 *
 * Pourquoi mesurer et non lire le nom de la carte graphique : Chrome le donne,
 * Firefox et Safari le masquent, et « Intel Iris Xe » ne dit rien de l'écran 4K
 * ni des dix autres onglets. On rend une quarantaine d'images sur une vue fixe,
 * chaque lot fermé par une lecture d'un pixel qui force la carte à finir son
 * travail (sinon on ne mesure que le temps d'envoi des commandes, et la
 * synchronisation verticale plafonne tout à 16,7 ms). Médiane, pas moyenne.
 */

export const NIVEAUX = {
  bas: {
    cle: 'bas', nom: 'Bas', ratio: 1, ombres: 0, cartes: 20, aa: false,
    detail: 'Sans ombres, définition simple, feuillage clairsemé. Pour un portable sans carte graphique.',
  },
  moyen: {
    cle: 'moyen', nom: 'Moyen', ratio: 1.5, ombres: 2048, cartes: 42, aa: true,
    detail: 'Ombres 2048, définition moyenne, feuillage à moitié. Pour une carte graphique d’entrée de gamme.',
  },
  eleve: {
    cle: 'eleve', nom: 'Élevé', ratio: 2, ombres: 4096, cartes: 84, aa: true,
    detail: 'Ombres douces 4096, définition native, tout le feuillage. Pour une carte graphique récente.',
  },
};
export const ORDRE = ['bas', 'moyen', 'eleve'];
const CLE = 'nova.qualite';
/** Seuils de recommandation, en ms par image mesurées au niveau Élevé. */
const SEUILS = { eleve: 8, moyen: 20 };

/** Le niveau mémorisé dans ce navigateur, ou null au premier lancement. */
export function lireChoix() {
  try { const v = localStorage.getItem(CLE); return v in NIVEAUX ? v : null; } catch { return null; }
}
export function enregistrerChoix(cle) {
  try { localStorage.setItem(CLE, cle); } catch { /* navigation privée : on garde le choix en mémoire */ }
}
export function oublierChoix() {
  try { localStorage.removeItem(CLE); } catch { /* idem */ }
}

/** Niveau conseillé d'après le temps par image mesuré au niveau Élevé. */
export function recommander(ms) {
  if (ms < SEUILS.eleve) return 'eleve';
  if (ms < SEUILS.moyen) return 'moyen';
  return 'bas';
}

/**
 * Applique un niveau au jeu en cours : définition, ombres, feuillage.
 * @param {{renderer, scene, sun, decor}} jeu ce que `startVillage` renvoie
 */
export function appliquer(jeu, niveau) {
  const { renderer, scene, sun, decor } = jeu;
  renderer.setPixelRatio(Math.min(devicePixelRatio, niveau.ratio));
  const ombres = niveau.ombres > 0;
  if (renderer.shadowMap.enabled !== ombres) {
    renderer.shadowMap.enabled = ombres;
    // les programmes sont compilés avec ou sans ombres : il faut les refaire
    scene.traverse((o) => {
      const m = o.material;
      if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((x) => { x.needsUpdate = true; });
    });
  }
  if (ombres && sun && sun.shadow.mapSize.x !== niveau.ombres) {
    sun.shadow.mapSize.set(niveau.ombres, niveau.ombres);
    // la cible de rendu a été allouée à l'ancienne taille : on la jette, Three la recrée
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  if (decor && decor.feuillage) decor.feuillage.regler(niveau.cartes);
}

/**
 * Mesure le temps de rendu d'une image, en ms, au réglage courant.
 * Suspend la boucle du jeu le temps de la mesure et la remet.
 * @returns {Promise<number>} médiane, en ms par image
 */
export async function mesurer(jeu, { lots = 14, parLot = 4, echauffement = 5 } = {}) {
  // Cinq lots d'échauffement : après un changement de niveau, les programmes
  // se recompilent et les premières images coûtent le double. Mesuré : sans
  // cet échauffement, le niveau Bas paraissait plus lent que l'Élevé.
  const { renderer, scene, camera, tick } = jeu;
  const gl = renderer.getContext();
  const pixel = new Uint8Array(4);
  renderer.setAnimationLoop(null);
  const mesures = [];
  for (let lot = 0; lot < lots; lot++) {
    await new Promise((res) => requestAnimationFrame(res));
    const t0 = performance.now();
    for (let k = 0; k < parLot; k++) renderer.render(scene, camera);
    // lire un pixel oblige la carte à terminer tout ce qui précède
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    if (lot >= echauffement) mesures.push((performance.now() - t0) / parLot);
  }
  if (tick) renderer.setAnimationLoop(tick);
  mesures.sort((a, b) => a - b);
  return mesures[Math.floor(mesures.length / 2)];
}

/**
 * Le panneau de réglage : trois boutons, le niveau conseillé, un compteur
 * d'images par seconde, et « Retester ». Le HTML est fourni par la page ;
 * ici, seulement le comportement.
 *
 * Attendu dans `racine` : des `[data-niveau]`, un `#qualite-fps`, un
 * `#qualite-note`, un `#btn-retester`.
 */
export function monterPanneau({ racine, jeu, initial, onChoix = () => {} }) {
  const boutons = [...racine.querySelectorAll('[data-niveau]')];
  const fpsEl = racine.querySelector('#qualite-fps');
  const noteEl = racine.querySelector('#qualite-note');
  const retester = racine.querySelector('#btn-retester');
  let courant = initial, conseille = null, mesure = null;

  function peindre() {
    boutons.forEach((b) => {
      b.classList.toggle('on', b.dataset.niveau === courant);
      b.classList.toggle('conseille', b.dataset.niveau === conseille);
      b.title = NIVEAUX[b.dataset.niveau].detail + (b.dataset.niveau === conseille ? ' — conseillé pour cette machine.' : '');
    });
    if (noteEl) {
      noteEl.textContent = conseille
        ? `Conseillé : ${NIVEAUX[conseille].nom} (${mesure.toFixed(1)} ms par image mesurés en Élevé).`
        : 'Aucune mesure : cliquer sur « Retester ».';
    }
  }

  function choisir(cle, { memoriser = true } = {}) {
    courant = cle;
    appliquer(jeu, NIVEAUX[cle]);
    if (memoriser) enregistrerChoix(cle);
    peindre();
    onChoix(cle);
  }

  /** Mesure en Élevé, conseille, et applique le conseil si `appliquerConseil`. */
  async function tester({ appliquerConseil = false } = {}) {
    if (retester) retester.disabled = true;
    // Rallumer les ombres recompile tous les programmes, et la carte met
    // environ trois secondes à retrouver son rythme (mesuré : 3,5 ms puis
    // 1,8 ms pour la même image). On laisse la boucle tourner avant de mesurer.
    const recompile = !jeu.renderer.shadowMap.enabled;
    appliquer(jeu, NIVEAUX.eleve);
    if (recompile) await new Promise((r) => setTimeout(r, 3000));
    mesure = await mesurer(jeu);
    conseille = recommander(mesure);
    if (appliquerConseil) choisir(conseille);
    else appliquer(jeu, NIVEAUX[courant]);
    if (retester) retester.disabled = false;
    peindre();
    return { ms: mesure, conseille };
  }

  boutons.forEach((b) => b.addEventListener('click', () => choisir(b.dataset.niveau)));
  if (retester) retester.addEventListener('click', () => tester());

  // compteur : la moyenne des intervalles entre images sur une demi-seconde.
  // Avec la synchronisation verticale il plafonne à la fréquence de l'écran,
  // comme dans n'importe quel jeu : c'est ce que le joueur attend.
  if (fpsEl) {
    let n = 0, depuis = performance.now();
    const boucle = (t) => {
      n++;
      if (t - depuis >= 500) {
        fpsEl.textContent = String(Math.round(n * 1000 / (t - depuis)));
        n = 0; depuis = t;
      }
      requestAnimationFrame(boucle);
    };
    requestAnimationFrame(boucle);
  }
  peindre();
  return { choisir, tester, get courant() { return courant; } };
}
