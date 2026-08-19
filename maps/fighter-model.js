import * as THREE from 'three';

// ══════════════════════════════════════════════════════════════════════════
//  MODELE DU CHASSEUR
// --------------------------------------------------------------------------
//  Chargement, mise a l'echelle et orientation de l'appareil du joueur.
//
//  Le chasseur doit garder exactement la meme apparence dans toutes les zones
//  du jeu : ce module reprend donc a l'identique la mise en place de
//  `world-game.js` — meme cible de taille, meme quart de tour, memes tuyeres.
//
//  DETTE A RESORBER : `world-game.js` porte encore sa propre copie de ce code.
//  Il devra etre bascule ici, une fois ce module eprouve, pour qu'il n'existe
//  qu'une seule definition de l'appareil.
//
//  Le parseur est volontairement maison et minimal : le fichier ne contient
//  que des sommets et des faces, et `OBJLoader` couterait un module de plus
//  pour un resultat identique.
// ══════════════════════════════════════════════════════════════════════════

const CHASSEUR_OBJ = './perso/chasseur.obj?v=mondes-chasseur-original-20260718';

let geometriePromesse = null;

function analyserObj(texte) {
  const positions = [];
  const indices = [];
  for (const ligne of texte.split(/\r?\n/)) {
    if (ligne.startsWith('v ')) {
      const parts = ligne.trim().split(/\s+/);
      positions.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
    } else if (ligne.startsWith('f ')) {
      const parts = ligne.trim().split(/\s+/).slice(1);
      if (parts.length < 3) continue;
      const face = parts.map(part => {
        const valeur = Number.parseInt(part.split('/')[0], 10);
        if (!Number.isFinite(valeur)) return -1;
        return valeur > 0 ? valeur - 1 : positions.length / 3 + valeur;
      }).filter(i => i >= 0);
      for (let i = 1; i < face.length - 1; i++) indices.push(face[0], face[i], face[i + 1]);
    }
  }
  const geometrie = new THREE.BufferGeometry();
  geometrie.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometrie.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometrie.computeVertexNormals();
  geometrie.computeBoundingBox();
  return geometrie;
}

/** La geometrie n'est lue qu'une fois, meme si plusieurs appareils la demandent. */
export function chargerGeometrieChasseur(onProgress) {
  if (geometriePromesse) return geometriePromesse;
  geometriePromesse = fetch(CHASSEUR_OBJ)
    .then(reponse => {
      if (!reponse.ok) throw new Error(`OBJ chasseur introuvable : ${reponse.status}`);
      const total = Number(reponse.headers.get('content-length')) || 0;
      if (!onProgress || !reponse.body) return reponse.text();
      // Le fichier est lourd : sans compte-rendu, l'ecran de chargement
      // ressemble a une page figee.
      const lecteur = reponse.body.getReader();
      const morceaux = [];
      let recu = 0;
      return (function lire() {
        return lecteur.read().then(({ done, value }) => {
          if (done) return new TextDecoder().decode(concatener(morceaux, recu));
          morceaux.push(value);
          recu += value.length;
          onProgress(recu, total);
          return lire();
        });
      })();
    })
    .then(analyserObj);
  return geometriePromesse;
}

function concatener(morceaux, taille) {
  const total = new Uint8Array(taille);
  let offset = 0;
  for (const morceau of morceaux) { total.set(morceau, offset); offset += morceau.length; }
  return total;
}

/** Ramene l'appareil a la taille voulue et le recentre sur son origine. */
function ajuster(racine, taille = 16.5) {
  racine.updateMatrixWorld(true);
  const boite = new THREE.Box3().setFromObject(racine);
  const dimensions = boite.getSize(new THREE.Vector3());
  const plusGrand = Math.max(dimensions.x, dimensions.y, dimensions.z) || 1;
  racine.scale.setScalar(taille / plusGrand);
  racine.updateMatrixWorld(true);
  const centre = new THREE.Box3().setFromObject(racine).getCenter(new THREE.Vector3());
  racine.position.sub(centre);
}

function creerTuyere(longueur, rayon) {
  const groupe = new THREE.Group();
  [[rayon, longueur, 0xff6a10, .5],
   [rayon * .6, longueur * .78, 0xffae2e, .7],
   [rayon * .3, longueur * .5, 0xfff3b0, .95]].forEach(([r, h, couleur, opacite]) => {
    const flamme = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: couleur, transparent: true, opacity: opacite,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
      })
    );
    flamme.rotation.x = -Math.PI / 2;
    flamme.position.z = h / 2;
    groupe.add(flamme);
  });
  return groupe;
}

/**
 * Construit l'appareil complet, nez vers -Z.
 * @returns `{ groupe, tuyeres }` — `tuyeres` sert a faire vivre la poussee.
 */
export async function creerChasseur(onProgress) {
  const geometrie = await chargerGeometrieChasseur(onProgress);
  const maillage = new THREE.Mesh(geometrie, new THREE.MeshStandardMaterial({
    color: 0x3a4147, roughness: .55, metalness: .35
  }));
  maillage.castShadow = true;
  maillage.receiveShadow = true;
  // Le modele sort de Meshy couche sur le flanc : ce quart de tour est celui
  // qui met le nez dans l'axe de vol. Ne pas y toucher sans revoir le jeu.
  maillage.rotation.set(0, -Math.PI / 2, 0);
  // Un appareil colle a la camera sort souvent du volume teste par Three, qui
  // le fait alors disparaitre a l'image : on le declare toujours visible.
  maillage.frustumCulled = false;

  // Deux niveaux, et c'est indispensable : `ajuster` recentre en DEPLACANT son
  // groupe, qui ne se trouve donc plus a l'origine. Une enveloppe exterieure
  // rattrape ce decalage, si bien que la racine rendue est bien centree sur le
  // point de vol — sans elle, l'appareil derive loin de sa propre position et
  // ses tuyeres restent en arriere.
  const interne = new THREE.Group();
  interne.add(maillage);
  ajuster(interne);
  interne.updateMatrixWorld(true);

  const groupe = new THREE.Group();
  groupe.name = 'chasseur';
  groupe.add(interne);
  groupe.updateMatrixWorld(true);

  const boite = new THREE.Box3().setFromObject(groupe);
  const dimensions = boite.getSize(new THREE.Vector3());
  const centre = boite.getCenter(new THREE.Vector3());
  const longueur = Math.min(4.8, dimensions.z * .34);
  const rayon = Math.min(.58, Math.max(.2, dimensions.y * .18));
  const ecart = dimensions.x * .13;
  const tuyeres = [-ecart, ecart].map(x => {
    const flamme = creerTuyere(longueur, rayon);
    flamme.position.set(centre.x + x, centre.y - dimensions.y * .05, boite.max.z - dimensions.z * .02);
    groupe.add(flamme);
    return flamme;
  });

  return { groupe, tuyeres };
}

/** Appareil de repli, si le modele ne peut pas etre charge. */
export function creerChasseurSimple() {
  const groupe = new THREE.Group();
  groupe.name = 'chasseur-repli';
  const materiau = new THREE.MeshStandardMaterial({ color: 0x3a4147, roughness: .55, metalness: .35 });
  const fuselage = new THREE.Mesh(new THREE.ConeGeometry(1.6, 13, 12), materiau);
  fuselage.rotation.x = -Math.PI / 2;
  groupe.add(fuselage);
  const ailes = new THREE.Mesh(new THREE.BoxGeometry(15, .5, 3.4), materiau);
  ailes.position.z = 1.6;
  groupe.add(ailes);
  const derive = new THREE.Mesh(new THREE.BoxGeometry(.5, 3, 2.4), materiau);
  derive.position.set(0, 1.5, 4.6);
  groupe.add(derive);
  return { groupe, tuyeres: [] };
}
