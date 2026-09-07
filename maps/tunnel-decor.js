import * as THREE from 'three';
import { addBoxFromCenter } from './world-collision.js?v=tunnels-20260829a';

// ══════════════════════════════════════════════════════════════════════════
//  DECOR DES CARTES DE TUNNEL
// --------------------------------------------------------------------------
//  Montagnes et maisons procedurales. Elles ne sont pas la pour decorer : sans
//  rien autour d'un tunnel, on ne sait ni a quelle vitesse on va, ni ou l'on
//  est. Ce sont des reperes avant d'etre des objets.
//
//  Tout est genere par le code — aucun fichier a charger, aucun asset lourd.
// ══════════════════════════════════════════════════════════════════════════

/** Generateur reproductible : la meme graine redonne la meme montagne. */
function alea(graine) {
  let etat = graine * 9301 + 49297;
  return () => {
    etat = (etat * 9301 + 49297) % 233280;
    return etat / 233280;
  };
}

const ROCHE = new THREE.MeshStandardMaterial({ color: 0x54606b, roughness: .96, flatShading: true });
const NEIGE = new THREE.MeshStandardMaterial({ color: 0xd8e8f2, roughness: .8, flatShading: true });
const MUR = new THREE.MeshStandardMaterial({ color: 0xb9a893, roughness: .9 });
const TOIT = new THREE.MeshStandardMaterial({ color: 0x8a3f38, roughness: .85, flatShading: true });
const BOIS = new THREE.MeshStandardMaterial({ color: 0x6b5844, roughness: .95 });

/**
 * Montagne : un cone dont chaque anneau de sommets est bouscule au hasard.
 * Un cone lisse se lit comme un objet pose ; froisse, il se lit comme du
 * relief.
 */
export function creerMontagne({ x, z, rayon, hauteur, graine = 1 }, field) {
  const hasard = alea(graine);
  const groupe = new THREE.Group();
  groupe.name = `montagne-${graine}`;

  const geometrie = new THREE.ConeGeometry(rayon, hauteur, 14, 7);
  const position = geometrie.attributes.position;
  const sommet = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    sommet.fromBufferAttribute(position, i);
    // La pointe reste nette : on ne bouscule que ce qui est sous le sommet.
    const partHaut = (sommet.y + hauteur / 2) / hauteur;
    const amplitude = rayon * .17 * (1 - partHaut * .75);
    position.setX(i, sommet.x + (hasard() - .5) * amplitude);
    position.setZ(i, sommet.z + (hasard() - .5) * amplitude);
    position.setY(i, sommet.y + (hasard() - .5) * hauteur * .045);
  }
  geometrie.computeVertexNormals();
  const roche = new THREE.Mesh(geometrie, ROCHE);
  roche.position.set(x, hauteur / 2, z);
  groupe.add(roche);

  // Calotte de neige, uniquement sur les sommets qui montent assez haut.
  if (hauteur > 800) {
    const calotte = new THREE.Mesh(new THREE.ConeGeometry(rayon * .3, hauteur * .26, 14, 2), NEIGE);
    calotte.position.set(x, hauteur - hauteur * .13, z);
    groupe.add(calotte);
  }

  // Collision : une pile de boites de rayon decroissant. Une boite unique
  // ferait un bloc carre bien plus large que la montagne, et on cognerait
  // dans le vide a plusieurs centaines d'unites du relief.
  if (field) {
    const tranches = 8;
    for (let i = 0; i < tranches; i++) {
      const bas = (i / tranches) * hauteur;
      const haut = ((i + 1) / tranches) * hauteur;
      const demiLargeur = rayon * (1 - i / tranches) * .82;
      addBoxFromCenter(field, x, (bas + haut) / 2, z, demiLargeur, (haut - bas) / 2, demiLargeur);
    }
  }
  return groupe;
}

/** Maison : un corps, un toit a deux pans, une porte. */
export function creerMaison({ x, z, rotation = 0, echelle = 1 }, field) {
  const groupe = new THREE.Group();
  groupe.name = 'maison';
  const largeur = 34 * echelle, profondeur = 26 * echelle, hauteur = 22 * echelle;

  const corps = new THREE.Mesh(new THREE.BoxGeometry(largeur, hauteur, profondeur), MUR);
  corps.position.y = hauteur / 2;
  groupe.add(corps);

  // Toit a deux pans : un prisme, soit un cylindre a quatre cotes pose sur le
  // flanc et tourne d'un huitieme de tour.
  const toit = new THREE.Mesh(
    new THREE.CylinderGeometry(largeur * .62, largeur * .62, profondeur * 1.12, 4, 1),
    TOIT
  );
  toit.rotation.z = Math.PI / 2;
  toit.rotation.y = Math.PI / 4;
  toit.position.y = hauteur + largeur * .28;
  toit.scale.set(.52, 1, 1);
  groupe.add(toit);

  const porte = new THREE.Mesh(
    new THREE.BoxGeometry(largeur * .22, hauteur * .55, 1.2),
    BOIS
  );
  porte.position.set(0, hauteur * .275, profondeur / 2 + .4);
  groupe.add(porte);

  groupe.position.set(x, 0, z);
  groupe.rotation.y = rotation;

  if (field) {
    // Emprise au sol, toit compris : la maison est petite, une seule boite
    // alignee sur les axes suffit largement.
    const demi = Math.max(largeur, profondeur) * .5;
    addBoxFromCenter(field, x, (hauteur + largeur * .3) / 2, z, demi, (hauteur + largeur * .3) / 2, demi);
  }
  return groupe;
}

/** Pose tout le decor d'une carte et rend le groupe correspondant. */
export function creerDecor(carte, field) {
  const groupe = new THREE.Group();
  groupe.name = 'decor';
  (carte.montagnes || []).forEach(m => groupe.add(creerMontagne(m, field)));
  (carte.maisons || []).forEach(m => groupe.add(creerMaison(m, field)));
  return groupe;
}
