/**
 * Les enseignes des commerces — Poilhes City.
 *
 * Arnaud, 26/09/2026 : « c'est la seule boutique qu'on a dans le village, on
 * fait beaucoup mieux que ça : qu'elles ressortent bien, avec un beau
 * panneau ». Chaque commerce connu reçoit deux pièces :
 *
 *   — un **bandeau** peint sur la façade, au-dessus de la porte : le nom en
 *     grandes capitales, le métier dessous, un liseré doré ;
 *   — une **enseigne drapeau** sur potence, perpendiculaire au mur : c'est
 *     elle qu'on voit en remontant la rue, bien avant la façade.
 *
 * Les deux sont légèrement lumineuses (carte émissive) : elles se lisent au
 * soleil comme la nuit. La façade est trouvée au rayon (`chercherFacade`),
 * comme pour l'épicerie : rien n'est placé à la main.
 */
import * as THREE from 'three';
import { chercherFacade } from './poilhes-commerces.js?v=voiture-20260921';

/**
 * Les commerces, reconnus par leur nom OSM (ou leur genre). `fond` et `encre`
 * font l'identité de chaque boutique : on doit les distinguer d'un coup d'œil.
 */
export const ENSEIGNES = [
  { genre: 'Épicerie', titre: 'OSTAL LOUIS', metier: 'Épicerie · Traiteur', icone: '🧺',
    fond: '#1f4a36', encre: '#f3d27a', bandeau: false },   // la devanture Meshy a déjà sa façade
  { nom: 'Vinauberge', titre: 'VINAUBERGE', metier: 'Hôtel · Vins', icone: '🍷', fond: '#5b1a2b', encre: '#f1d9a6' },
  { nom: 'La Tour Sarrasine', titre: 'LA TOUR SARRASINE', metier: 'Restaurant', icone: '🍽️', fond: '#233a5e', encre: '#f6e3b0' },
  { nom: 'Les platanes', titre: 'LES PLATANES', metier: 'Restaurant · Terrasse', icone: '🌳', fond: '#2f4d1f', encre: '#fbe7a1' },
  { nom: 'Poste Annexe', titre: 'LA POSTE', metier: 'Bureau de poste', icone: '✉️', fond: '#ffcc00', encre: '#1d2a6b' },
];

const OR = '#e9b84e';

/** Le bandeau de façade : 1024 × 256, nom et métier. */
function toileBandeau(e) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = e.fond;
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = OR; g.lineWidth = 10;
  g.strokeRect(14, 14, 996, 228);
  g.lineWidth = 3;
  g.strokeRect(30, 30, 964, 196);
  g.fillStyle = e.encre;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let taille = 118;
  g.font = `800 ${taille}px Georgia, "Times New Roman", serif`;
  while (g.measureText(e.titre).width > 900 && taille > 40) { taille -= 4; g.font = `800 ${taille}px Georgia, serif`; }
  g.fillText(e.titre, 512, 112);
  g.font = 'italic 600 40px Georgia, serif';
  g.fillText(e.metier, 512, 196);
  return c;
}

/** L'enseigne drapeau : 512 × 512, l'icône en grand, le nom en dessous. */
function toileDrapeau(e) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = e.fond;
  g.beginPath(); g.roundRect(8, 8, 496, 496, 60); g.fill();
  g.strokeStyle = OR; g.lineWidth = 14; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '230px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  g.fillText(e.icone, 256, 210);
  g.fillStyle = e.encre;
  let taille = 70;
  g.font = `800 ${taille}px Georgia, serif`;
  while (g.measureText(e.titre).width > 450 && taille > 28) { taille -= 3; g.font = `800 ${taille}px Georgia, serif`; }
  g.fillText(e.titre, 256, 420);
  return c;
}

function matiere(toile, recto = true) {
  const tex = new THREE.CanvasTexture(toile);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.55,
    roughness: 0.55, side: recto ? THREE.FrontSide : THREE.DoubleSide,
  });
}

/**
 * Pose les enseignes de tous les commerces trouvés dans le village.
 * @param {object} o { scene, decor } — decor vient de poilhes-scene.js
 * @returns {Array<THREE.Group>}
 */
export function poserEnseignes({ scene, decor }) {
  const lieux = decor.meta.lieux || [];
  const poses = [];
  const fer = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.5, metalness: 0.6 });
  for (const e of ENSEIGNES) {
    const lieu = lieux.find((p) => (e.nom && p.nom === e.nom) || (!e.nom && p.genre === e.genre));
    if (!lieu) continue;
    const solY = decor.groundAt(lieu.x, lieu.z);
    const facade = decor.murs ? chercherFacade(decor.murs, decor.blockedAt, lieu.x, lieu.z, solY + 2.2) : null;
    if (!facade) {
      // Pas de façade à portée (l'hôtel Vinauberge, posé au milieu de sa
      // cour) : un panneau sur pied, à deux faces, là où la carte le met.
      const pied = new THREE.Group();
      pied.name = `enseigne-${e.titre}`;
      // Le point de la carte peut tomber dans le bâti : on cherche, en spirale,
      // le premier endroit dégagé sur deux mètres autour.
      let fx = lieu.x, fz = lieu.z;
      const libre = (x, z) => !decor.blockedAt(x, z) && !decor.blockedAt(x + 1.2, z) && !decor.blockedAt(x - 1.2, z)
        && !decor.blockedAt(x, z + 1.2) && !decor.blockedAt(x, z - 1.2);
      chercher: for (let r = 0; r <= 40; r += 1) {
        for (let a = 0; a < Math.PI * 2; a += r ? 0.8 / r : 7) {
          const x = lieu.x + Math.cos(a) * r, z = lieu.z + Math.sin(a) * r;
          if (libre(x, z)) { fx = x; fz = z; break chercher; }
        }
      }
      pied.position.set(fx, decor.groundAt(fx, fz), fz);
      const mat = matiere(toileDrapeau(e));
      const geo = new THREE.PlaneGeometry(1.8, 1.8);
      for (const sens of [0, Math.PI]) {
        const face = new THREE.Mesh(geo, mat);
        face.rotation.y = sens;
        face.position.set(0, 2.9, sens ? -0.03 : 0.03);
        pied.add(face);
      }
      for (const x of [-0.8, 0.8]) {
        const poteau = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.8, 0.08), fer);
        poteau.position.set(x, 1.9, 0);
        poteau.castShadow = true;
        pied.add(poteau);
      }
      scene.add(pied);
      poses.push(pied);
      continue;
    }

    const root = new THREE.Group();
    root.name = `enseigne-${e.titre}`;
    const px = facade.point.x, pz = facade.point.z;
    root.position.set(px, decor.groundAt(px, pz), pz);
    root.rotation.y = facade.cap;                   // +z du groupe = vers la rue
    scene.add(root);

    // ── le bandeau, au-dessus de la porte ──────────────────────────────────
    if (e.bandeau !== false) {
      const L = 4.4, H = 1.1;
      const cadre = new THREE.Mesh(new THREE.BoxGeometry(L + 0.16, H + 0.16, 0.08), fer);
      cadre.position.set(0, 3.35, 0.05);
      cadre.castShadow = true;
      root.add(cadre);
      const bandeau = new THREE.Mesh(new THREE.PlaneGeometry(L, H), matiere(toileBandeau(e)));
      bandeau.position.set(0, 3.35, 0.1);
      root.add(bandeau);
    }

    // ── l'enseigne drapeau, sur sa potence ─────────────────────────────────
    // Côté droit de la porte, perpendiculaire au mur : on la lit de face en
    // remontant la rue, dans les deux sens.
    const cote = e.bandeau === false ? 2.6 : 2.5;   // m depuis l'axe de la façade
    const potence = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.35), fer);
    potence.position.set(cote, 4.55, 0.68);
    root.add(potence);
    // Deux faces dos à dos, chacune à l'endroit : une seule face double
    // montrerait le nom en miroir à ceux qui arrivent de l'autre côté.
    const mat = matiere(toileDrapeau(e));
    const geo = new THREE.PlaneGeometry(1.15, 1.15);
    for (const sens of [1, -1]) {
      const face = new THREE.Mesh(geo, mat);
      face.rotation.y = sens * Math.PI / 2;         // perpendiculaire au mur
      face.position.set(cote + sens * 0.012, 3.92, 0.82);
      root.add(face);
    }
    for (const dz of [0.3, 1.3]) {                  // les deux crochets
      const crochet = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), fer);
      crochet.position.set(cote, 4.5, dz + 0.02);
      root.add(crochet);
    }
    poses.push(root);
  }
  console.info(`[village] enseignes : ${poses.length} commerces`);
  return poses;
}
