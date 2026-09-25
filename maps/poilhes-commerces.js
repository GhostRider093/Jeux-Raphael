/**
 * Les commerces de Poilhes — pour l'instant un seul, mais le vrai.
 *
 * L'épicerie du village s'appelle **Ostal Louis** (épicerie, traiteur). OSM ne
 * connaît qu'un point nommé « Epicerie du Canal » : la position est bonne, le
 * nom ne l'est plus. Ce fichier tient ce que les données publiques ignorent —
 * l'enseigne, le métier, le téléphone, la photo de la devanture — et le pose
 * dans le village.
 *
 * Deux choses seulement, et elles suffisent :
 *   — **la devanture**, qui est la vraie photo du magasin collée sur la façade.
 *     Dessiner un store, un rideau et une vitrine en boîtes donnait une
 *     approximation ; la photo donne la boutique ;
 *   — **l'affiche**, un panneau planté au bord de la rue : « L'ÉPICERIE DU
 *     VILLAGE EST OUVERTE ! ». Si le fichier de l'affiche manque, elle est
 *     redessinée en toile — on ne reste jamais avec un panneau blanc.
 *
 * Rien n'est placé à la main : la façade est **trouvée** en tirant des rayons
 * depuis le point de l'épicerie vers les murs du village. On garde le mur le
 * plus proche, et la devanture se pose dessus, tournée vers la rue. Le jour où
 * le relevé change, elle se replace toute seule.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';

/** Le club de football du village — son blason, planté devant le stade. */
export const CLUB = {
  cle: 'Terrain de sport',
  nom: 'Olympique Midi Lirou',
  modele: 'assets/pub/omlirou.glb?v=1',
  hauteur: 2.35,                       // hauteur du blason seul (m)
  pied: 1.15,                          // hauteur du bas du blason au-dessus du sol (m)
};

/** Ce que le village sait et qu'OpenStreetMap ignore. */
export const EPICERIE = {
  cle: 'Épicerie',                     // genre du lieu OSM auquel tout ceci se rattache
  nom: 'Ostal Louis',
  genre: 'Épicerie · Traiteur',
  tel: '07 68 08 50 68',
  devanture: 'assets/pub/ostal-louis-devanture.webp',   // la photo, en secours
  modele: 'assets/pub/ostal-louis.glb?v=1',             // la boutique en volume (Meshy)
  affiche: 'assets/pub/epicerie-ouverte.jpg',
  slogan: "L'ÉPICERIE DU VILLAGE EST OUVERTE !",
};

const NOIR = 0x1b1e23, OR = '#e9b84e';
const LARGEUR = 3.75;                  // largeur de la devanture sur la façade (m)
const HAUTEUR = 2.90;                  // hauteur de la devanture, trottoir → haut du store (m)

/** Affiche de secours, dessinée en toile si le fichier n'est pas encore là. */
function afficheDessinee() {
  const c = document.createElement('canvas');
  c.width = 768; c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111418';
  g.font = '700 74px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  const mots = ["L'ÉPICERIE", 'DU VILLAGE', 'EST OUVERTE !'];
  mots.forEach((m, i) => g.fillText(m, c.width / 2, 130 + i * 86));
  g.fillRect(70, 390, c.width - 140, 6);
  g.fillStyle = '#20242a';
  g.fillRect(70, 430, c.width - 140, 420);
  g.fillStyle = OR;
  g.font = 'italic 700 64px "Segoe Script", "Brush Script MT", cursive';
  g.fillText('Ostal Louis', c.width / 2, 620);
  g.font = 'italic 600 34px "Segoe Script", "Brush Script MT", cursive';
  g.fillText('Épicerie · Traiteur', c.width / 2, 690);
  g.fillText(EPICERIE.tel, c.width / 2, 750);
  g.fillStyle = '#111418';
  g.font = '600 30px Arial, Helvetica, sans-serif';
  g.fillText('Place de la Liberté · Poilhes', c.width / 2, 920);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Le panonceau qu'on voit de loin : une pastille et son nom, toujours de face. */
function pancarte(texte) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,23,28,.88)';
  g.beginPath();
  g.roundRect(4, 8, 504, 84, 18);
  g.fill();
  g.strokeStyle = OR;
  g.lineWidth = 3;
  g.stroke();
  // la pointe, pour que la pastille désigne un point au sol
  g.beginPath();
  g.moveTo(240, 92); g.lineTo(272, 92); g.lineTo(256, 122); g.closePath();
  g.fillStyle = 'rgba(20,23,28,.88)';
  g.fill();
  g.fillStyle = OR;
  g.font = 'italic 700 46px "Segoe Script", "Brush Script MT", cursive';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(texte, 256, 50);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Cherche la façade la plus proche d'un point, et de quel côté est la rue.
 *
 * On tire des rayons horizontaux tout autour : le premier mur touché donne le
 * point d'accroche, et la direction du tir donne, à l'envers, l'orientation de
 * la devanture. C'est plus sûr que de lire des emprises — ce qu'on voit est ce
 * qu'on touche.
 *
 * @returns {{point: THREE.Vector3, cap: number}|null} cap = rotation Y (rad)
 */
export function chercherFacade(murs, blockedAt, x, z, y) {
  const rayon = new THREE.Raycaster();
  rayon.far = 18;
  const origine = new THREE.Vector3(x, y, z);
  const dir = new THREE.Vector3();
  let meilleur = null;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const sx = Math.sin(a), sz = Math.cos(a);
    dir.set(sx, 0, sz);
    rayon.set(origine, dir);
    const touche = rayon.intersectObject(murs, false)[0];
    if (!touche) continue;
    const p = touche.point;
    // **De quel côté est la rue ?** Le point OSM d'un commerce est posé DANS le
    // bâtiment : un rayon part donc de l'intérieur et sort par la façade. Se
    // contenter de « la devanture regarde d'où vient le rayon » la colle alors
    // face au salon. On regarde donc ce qu'il y a de part et d'autre du mur, et
    // la vitrine se tourne du côté libre.
    const dehors = !blockedAt(p.x + sx * 0.9, p.z + sz * 0.9);
    const dedans = !blockedAt(p.x - sx * 0.9, p.z - sz * 0.9);
    if (!dehors && !dedans) continue;                 // mur pris entre deux murs
    const cap = dehors ? Math.atan2(sx, sz) : Math.atan2(-sx, -sz);
    // On préfère la façade la plus proche qui donne réellement sur du vide.
    const note = touche.distance + (dehors ? 0 : 2.5);
    if (!meilleur || note < meilleur.note) meilleur = { note, point: p.clone(), cap, sx: dehors ? sx : -sx, sz: dehors ? sz : -sz };
  }
  if (!meilleur) return null;
  // La devanture se pose sur la peau du mur, pas dedans.
  meilleur.point.x += meilleur.sx * 0.04;
  meilleur.point.z += meilleur.sz * 0.04;
  return meilleur;
}

/**
 * Pose l'épicerie dans le village : devanture sur la façade, affiche au bord de
 * la rue, et une pastille au-dessus des toits pour la trouver en roulant.
 *
 * @param {object} o { scene, decor, loader } — decor vient de poilhes-scene.js
 * @returns {object|null} { root, pin, position, lieu } ou null si le lieu manque
 */
export function poserEpicerie({ scene, decor, loader = new THREE.TextureLoader() }) {
  const lieu = (decor.meta.lieux || []).find((p) => p.genre === EPICERIE.cle);
  if (!lieu) return null;
  const solY = decor.groundAt(lieu.x, lieu.z);
  const facade = decor.murs
    ? chercherFacade(decor.murs, decor.blockedAt, lieu.x, lieu.z, solY + 2.2) : null;

  const root = new THREE.Group();
  root.name = 'epicerie';
  const px = facade ? facade.point.x : lieu.x;
  const pz = facade ? facade.point.z : lieu.z;
  root.position.set(px, decor.groundAt(px, pz), pz);
  root.rotation.y = facade ? facade.cap : 0;
  scene.add(root);

  // ── la devanture en volume, la photo en secours ─────────────────────────
  // Le magasin existe en 3D (relevé Meshy, ramené de 84,5 Mo à 1,86 Mo). On le
  // pose sur la façade trouvée ; s'il ne charge pas, la photo prend sa place et
  // la boutique est quand même là — comme le cockpit et sa doublure en CSS.
  const enVolume = new THREE.Group();
  root.add(enVolume);
  new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(EPICERIE.modele).then((gltf) => {
    const objet = gltf.scene;
    objet.updateMatrixWorld(true);
    const boite = new THREE.Box3().setFromObject(objet);
    const t = boite.getSize(new THREE.Vector3());
    // **Pas de rotation.** La devanture du modèle regarde déjà +z, c'est-à-dire
    // la rue une fois le groupe tourné vers elle. La règle « la plus grande
    // dimension horizontale est la largeur », qui marche pour une voiture, se
    // trompe ici : la terrasse avance de deux mètres, donc la profondeur dépasse
    // la largeur. Vérifié à l'œil dans `apercu-glb.html`.
    //
    // L'échelle se prend sur la HAUTEUR : c'est elle qu'on lit dans la rue —
    // du trottoir au haut du store. La largeur suit les proportions du relevé.
    const echelle = HAUTEUR / t.y;
    objet.scale.setScalar(echelle);
    objet.updateMatrixWorld(true);
    const b3 = new THREE.Box3().setFromObject(objet);
    const c3 = b3.getCenter(new THREE.Vector3());
    // Centré sur la façade, posé au sol, et rentré dans le bâtiment : la
    // boutique a quatre mètres de fond, la laisser devant la planterait au
    // milieu de la rue. Seule la terrasse déborde sur le trottoir.
    objet.position.set(-c3.x, -b3.min.y, -b3.max.z + 0.35);
    enVolume.add(objet);
    mur.visible = false;              // la photo n'a plus lieu d'être
    debord.visible = false;
  }).catch((err) => console.warn('Épicerie : modèle 3D indisponible, photo conservée', err));

  // ── la devanture : la photo, à sa taille réelle ─────────────────────────
  // 1 360 × 1 020 px pour 3,75 m de large : la hauteur en découle, on ne
  // déforme pas la boutique. Elle est collée 4 cm devant le crépi, sinon les
  // deux surfaces se disputent le même pixel et l'image clignote.
  const ratio = 1020 / 1360;
  const mur = new THREE.Mesh(
    new THREE.PlaneGeometry(LARGEUR, LARGEUR * ratio),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 }),
  );
  mur.position.set(0, LARGEUR * ratio * 0.5, 0.04);
  mur.receiveShadow = true;
  root.add(mur);
  loader.load(EPICERIE.devanture, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    mur.material.map = tex;
    mur.material.needsUpdate = true;
  });

  // Un débord au-dessus du store : il porte l'ombre, et c'est elle qui empêche
  // la photo d'avoir l'air d'un autocollant posé à plat sur le mur.
  const debord = new THREE.Mesh(
    new THREE.BoxGeometry(LARGEUR * 0.97, 0.10, 0.34),
    new THREE.MeshStandardMaterial({ color: NOIR, roughness: 0.5, metalness: 0.2 }),
  );
  debord.position.set(0, LARGEUR * ratio * 0.955, 0.19);
  debord.castShadow = true;
  root.add(debord);

  // ── l'affiche, plantée au bord de la rue ────────────────────────────────
  const panneau = new THREE.Group();
  // devant la boutique, de biais : on la lit en arrivant, pas en la frôlant
  panneau.position.set(-1.9, 0, 2.4);
  panneau.rotation.y = 0.55;
  root.add(panneau);

  const pied = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 1.05, 10),
    new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.6, metalness: 0.5 }),
  );
  pied.position.y = 0.52;
  pied.castShadow = true;
  panneau.add(pied);

  const affiche = new THREE.Mesh(
    new THREE.PlaneGeometry(0.80, 1.07),
    new THREE.MeshStandardMaterial({ map: afficheDessinee(), roughness: 0.75, side: THREE.DoubleSide }),
  );
  affiche.position.set(0, 1.58, 0.03);
  affiche.castShadow = true;
  panneau.add(affiche);
  const cadre = new THREE.Mesh(
    new THREE.BoxGeometry(0.88, 1.15, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.6 }),
  );
  cadre.position.set(0, 1.58, 0);
  cadre.castShadow = true;
  panneau.add(cadre);
  // La vraie affiche si elle est là ; sinon celle dessinée reste en place.
  loader.load(EPICERIE.affiche, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    affiche.material.map = tex;
    affiche.material.needsUpdate = true;
  }, undefined, () => {});

  // ── la pastille au-dessus des toits ─────────────────────────────────────
  // En voiture, on cherche l'épicerie à trente à l'heure : il lui faut un
  // repère plus haut que les tuiles, pas seulement une étiquette de rue.
  const pin = new THREE.Sprite(new THREE.SpriteMaterial({
    map: pancarte(EPICERIE.nom), transparent: true, depthWrite: false,
  }));
  const hautToit = Math.max(decor.surfaceAt(lieu.x, lieu.z), solY + 6);
  pin.position.set(lieu.x, hautToit + 4.5, lieu.z);
  pin.scale.set(10, 2.5, 1);
  scene.add(pin);

  return { root, pin, position: new THREE.Vector3(lieu.x, solY, lieu.z), lieu };
}


/**
 * Plante le blason du club devant le stade.
 *
 * Le panneau regarde la rue la plus proche — celle par où l'on arrive — et non
 * le centre du terrain : un blason que seuls les joueurs voient ne sert à rien.
 * Il est monté sur deux poteaux, comme un vrai panneau de club.
 *
 * @param {object} o { scene, decor }
 * @returns {Promise<object|null>} { root } ou null si le village n'a pas de stade
 */
export async function poserBlasonClub({ scene, decor }) {
  const stade = (decor.meta.lieux || []).find((p) => p.genre === CLUB.cle);
  if (!stade) return null;

  // La rue la plus proche donne le sens : on tourne le blason vers elle.
  let rue = null, mieux = 1e9;
  for (const r of decor.meta.rues || []) {
    const d = Math.hypot(r.x - stade.x, r.z - stade.z);
    if (d < mieux) { mieux = d; rue = r; }
  }
  const vers = rue ? Math.atan2(rue.x - stade.x, rue.z - stade.z) : 0;
  // On s'avance du terrain vers la rue, et on s'arrête dès que le sol est libre.
  let px = stade.x, pz = stade.z;
  for (let d = 4; d <= Math.min(mieux, 60); d += 2) {
    const x = stade.x + Math.sin(vers) * d, z = stade.z + Math.cos(vers) * d;
    if (decor.blockedAt(x, z)) break;
    px = x; pz = z;
  }
  // deux mètres en retrait de la rue : un panneau ne se plante pas sur la chaussée
  px -= Math.sin(vers) * 2.5;
  pz -= Math.cos(vers) * 2.5;

  const root = new THREE.Group();
  root.name = 'blason-club';
  root.position.set(px, decor.groundAt(px, pz), pz);
  root.rotation.y = vers;
  scene.add(root);

  const acier = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.5, metalness: 0.7 });
  for (const cote of [-1, 1]) {
    const poteau = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, CLUB.pied + 0.9, 10), acier);
    poteau.position.set(cote * 0.78, (CLUB.pied + 0.9) / 2, 0);
    poteau.castShadow = true;
    root.add(poteau);
  }

  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(CLUB.modele);
  const blason = gltf.scene;
  blason.updateMatrixWorld(true);
  const boite = new THREE.Box3().setFromObject(blason);
  const t = boite.getSize(new THREE.Vector3());
  blason.scale.setScalar(CLUB.hauteur / t.y);
  blason.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(blason);
  const c2 = b2.getCenter(new THREE.Vector3());
  // centré sur les poteaux, posé à hauteur d'homme, la face vers la rue (+z)
  blason.position.set(-c2.x, CLUB.pied - b2.min.y, -c2.z);
  blason.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    // Meshy cuit metalness = 1 : sans cela le blason devient un miroir noir.
    if (o.material) { o.material.metalness = 0.15; o.material.roughness = 0.7; o.material.side = THREE.DoubleSide; }
  });
  root.add(blason);
  return { root, position: root.position.clone() };
}
