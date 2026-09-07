import * as THREE from 'three';

// ══════════════════════════════════════════════════════════════════════════
//  MODELE DU CHASSEUR  -  adaptateur
// --------------------------------------------------------------------------
//  La dette annoncee dans l'ancienne entete de ce fichier est reglee :
//  l'appareil n'est plus decrit ici. Il l'est une seule fois, dans
//  ../chasseur-model.js, un script classique que la page charge avant ses
//  modules. Ce fichier ne fait plus que traduire son resultat vers la forme
//  attendue par le vol en tunnel : `{ groupe, tuyeres }`.
//
//  Ce qui a disparu avec lui : un parseur OBJ maison qui ne lisait que les
//  sommets et les faces — il jetait les coordonnees de texture, et c'est pour
//  cela que l'appareil etait gris. Le module, lui, charge le modele complet.
// ══════════════════════════════════════════════════════════════════════════

/** Longueur nez-queue de l'appareil dans les tunnels, en unites monde. */
const LONGUEUR_TUNNEL = 16;

/**
 * Finition d'origine des Mondes et des tunnels : metal sombre, sans texture.
 * Elle est reproduite telle quelle pour ne rien changer a ce qui est valide.
 * Passer `null` a la place rendrait l'appareil texture.
 */
function metalSombre() {
  return new THREE.MeshStandardMaterial({
    color: 0x3a4147, roughness: .55, metalness: .35, side: THREE.DoubleSide
  });
}

export async function creerChasseur(onProgress) {
  if (!window.RaphaelChasseur) throw new Error('chasseur-model.js n\'est pas charge');
  const groupe = await window.RaphaelChasseur.construire({
    longueur: LONGUEUR_TUNNEL,
    reacteurs: true,
    missiles: false,
    materiau: metalSombre(),
    onProgress
  });
  return { groupe, tuyeres: groupe.userData.ancrages.tuyeres };
}

/** Appareil de repli, si le modele ne peut pas etre charge. */
export function creerChasseurSimple() {
  const groupe = new THREE.Group();
  groupe.name = 'chasseur-repli';
  const materiau = metalSombre();
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
