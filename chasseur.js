// ==========================================================================
//  CHASSEUR DE LA VILLE  -  pose l'appareil dans la scene
// --------------------------------------------------------------------------
//  L'appareil est decrit une seule fois, dans chasseur-model.js. Ce fichier
//  ne fait plus que le poser et lui transmettre le regime moteur.
//
//  Il faisait 160 lignes auparavant : chargement de l'OBJ, texture, materiau,
//  mise a l'echelle, tuyeres et leur animation. Tout cela existait aussi,
//  ecrit autrement et avec d'autres valeurs, dans trois autres fichiers — et
//  le maillage etait charge depuis un fichier different de celui des Mondes.
//  La ville et les Mondes volent desormais le meme avion.
//
//  Dependances (scope global) : THREE, window.RaphaelChasseur, player,
//  hasRenderableMesh(), removePlayerPlaceholder().
// ==========================================================================

let chasseurModel = null;
let wargunModel = null;
let chasseurRegimeEnCours = false;

/**
 * Transmet le regime moteur aux tuyeres. C'est la seule chose que le module
 * de l'appareil ne peut pas deviner : elle depend de la boucle de vol.
 */
function suivreRegimeChasseur() {
  requestAnimationFrame(suivreRegimeChasseur);
  const appareil = chasseurModel || wargunModel;
  if (!appareil || !appareil.parent) return;
  const vitesse = typeof flightSpeed === "number" ? Math.abs(flightSpeed) : 0;
  window.RaphaelChasseur?.regime(appareil, Math.max(.25, Math.min(1, vitesse / 72)));
}

/**
 * @param {string} etiquette nom du mode, pour les messages de console.
 * @param {THREE.Material|null} materiau finition, ou null pour la texture.
 * @param {function} recevoir recoit l'appareil construit.
 */
function poserAppareilVille(etiquette, materiau, recevoir) {
  if (!window.RaphaelChasseur) {
    console.error(`[${etiquette}] chasseur-model.js n'est pas charge`);
    return;
  }
  // La longueur nez-queue vaut 5 unites : c'est la cote de reference de la
  // ville depuis toujours, elle est simplement nommee maintenant.
  window.RaphaelChasseur.construire({ longueur: 5, reacteurs: true, missiles: true, materiau })
    .then(appareil => {
      recevoir(appareil);
      player.add(appareil);
      if (hasRenderableMesh(appareil)) removePlayerPlaceholder();
      document.body.dataset.fighterTexture = "loaded";
      if (!chasseurRegimeEnCours) { chasseurRegimeEnCours = true; suivreRegimeChasseur(); }
      console.log(`[${etiquette}] appareil pose`);
    })
    .catch(erreur => {
      document.body.dataset.fighterTexture = "error";
      console.error(`[${etiquette}] ECHEC chargement de l'appareil :`, erreur);
    });
}

function loadChasseurModel() {
  poserAppareilVille("chasseur", null, appareil => { chasseurModel = appareil; });
}

// Le Wargun est le meme appareil, en finition metal nu : une matiere, pas un
// second modele. C'etait pourtant un cinquieme assemblage recopie a la main.
function loadWargunModel() {
  const metal = new THREE.MeshStandardMaterial({
    color: 0x6d7883, roughness: .38, metalness: .82, side: THREE.DoubleSide
  });
  poserAppareilVille("wargun", metal, appareil => { wargunModel = appareil; });
}
