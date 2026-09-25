/**
 * La mairie de Poilhes et sa place — habillage posé sur le bâtiment généré.
 *
 * Le village sort de la BD TOPO et du LiDAR : la mairie y est une maison jaune
 * de trois niveaux, comme ses voisines. La vraie (photo 3 du diaporama de
 * l'accueil) a une **tour de l'horloge** coiffée d'un campanile d'ardoise, un
 * balcon en fer forgé au-dessus de la porte, deux drapeaux, et une place
 * devant. Arnaud, 25/09/2026 : « la place centrale, la mairie et l'Ostal, il
 * faudrait vraiment les refaire mieux que ça ».
 *
 * Même approche que l'épicerie (`poilhes-commerces.js`) : on ne régénère pas le
 * village, on **pose** sur la façade trouvée au rayon :
 *  - la tour : un fût carré qui traverse le toit, quatre cadrans d'horloge, un
 *    beffroi ouvert avec sa cloche, une flèche d'ardoise et sa girouette ;
 *  - la façade : porte à deux battants dans un encadrement de pierre, trois
 *    marches, balcon en fer forgé, plaque « MAIRIE », devise, deux drapeaux
 *    tricolores en oblique, deux lanternes ;
 *  - la place : une fontaine ronde en pierre, quatre bancs, quatre lampadaires,
 *    un pavage circulaire — posés sur le premier point libre (ni bâti, ni eau,
 *    ni route) autour de l'étiquette « Place de la Mairie ».
 *
 * Tout est en primitives Three.js et en textures dessinées sur canvas : rien à
 * télécharger, rien à régénérer.
 */
import * as THREE from 'three';
import { chercherFacade } from './poilhes-commerces.js?v=voiture-20260921';

/**
 * La façade **qui regarde la place**, pas la plus proche : le point OSM de la
 * mairie est au milieu du bâtiment, et la façade la plus proche était le mur
 * arrière (vu au premier essai : tour, drapeaux et balcon côté jardin). On ne
 * tire que dans un cône de ±70° vers la place, et l'on garde le premier mur
 * qui donne sur du vide.
 */
function facadeVers(murs, blockedAt, x, z, y, versX, versZ) {
  // **On tire depuis la place vers le bâtiment**, pas l'inverse : les murs sont
  // à une face, un rayon parti de l'intérieur traverse la mairie sans la voir
  // et va toucher la maison d'en face (deuxième essai : la tour sur la voisine).
  const rayon = new THREE.Raycaster();
  rayon.far = 60;
  const a0 = Math.atan2(x - versX, z - versZ);               // de la place vers le centre du bâtiment
  const dist = Math.hypot(x - versX, z - versZ);
  const origine = new THREE.Vector3(x - Math.sin(a0) * Math.max(dist, 22), y, z - Math.cos(a0) * Math.max(dist, 22));
  const dir = new THREE.Vector3();
  let meilleur = null;
  for (let k = -10; k <= 10; k++) {
    const a = a0 + k * (Math.PI / 60);
    const sx = Math.sin(a), sz = Math.cos(a);
    dir.set(sx, 0, sz);
    rayon.set(origine, dir);
    const touche = rayon.intersectObject(murs, false)[0];
    if (!touche) continue;
    const p = touche.point;
    // le mur touché doit être celui de la mairie : à moins de 14 m de son centre
    const dc = Math.hypot(p.x - x, p.z - z);
    if (dc > 14) continue;
    if (blockedAt(p.x - sx * 0.9, p.z - sz * 0.9)) continue;      // pas de vide devant
    const note = dc + Math.abs(k) * 0.2;
    // **L'orientation vient de la normale du mur**, pas du rayon : un rayon
    // oblique donnait une entrée de travers et une tour qui sortait de la
    // façade (troisième essai). La normale est prise côté rue.
    let nx = -sx, nz = -sz;
    if (touche.face && touche.face.normal) {
      const nrm = touche.face.normal.clone().transformDirection(murs.matrixWorld);
      if (Math.hypot(nrm.x, nrm.z) > 0.5) {
        nx = nrm.x; nz = nrm.z;
        const l = Math.hypot(nx, nz); nx /= l; nz /= l;
        if (nx * sx + nz * sz > 0) { nx = -nx; nz = -nz; }        // vers d'où vient le rayon
      }
    }
    if (!meilleur || note < meilleur.note) meilleur = { note, point: p.clone(), cap: Math.atan2(nx, nz), sx: nx, sz: nz };
  }
  if (!meilleur) return null;
  meilleur.point.x += meilleur.sx * 0.04;
  meilleur.point.z += meilleur.sz * 0.04;
  return meilleur;
}

const STUC = 0xe6d9b4;         // le crépi jaune pâle du bâtiment généré
const PIERRE = 0xcfc6b2;
const ARDOISE = 0x3b4049;
const FER = 0x1d1f22;

// ─────────────────────────────────────────────────────────── textures canvas
function canvasTexture(w, h, dessiner) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  dessiner(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Un cadran d'horloge : fond crème, chiffres romains, aiguilles à l'heure du village. */
function texCadran(heure = 10.15) {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#f4efe2'; g.beginPath(); g.arc(128, 128, 124, 0, 6.29); g.fill();
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 6; g.beginPath(); g.arc(128, 128, 118, 0, 6.29); g.stroke();
    g.fillStyle = '#2a2a2a'; g.font = 'bold 26px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const romains = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      g.fillText(romains[i], 128 + Math.cos(a) * 92, 128 + Math.sin(a) * 92);
      g.beginPath(); g.arc(128 + Math.cos(a) * 112, 128 + Math.sin(a) * 112, 3, 0, 6.29); g.fill();
    }
    const h = ((heure % 12) / 12) * Math.PI * 2 - Math.PI / 2, m = ((heure % 1)) * Math.PI * 2 - Math.PI / 2;
    g.strokeStyle = '#1a1a1a'; g.lineCap = 'round';
    g.lineWidth = 9; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(h) * 58, 128 + Math.sin(h) * 58); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(m) * 86, 128 + Math.sin(m) * 86); g.stroke();
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(128, 128, 8, 0, 6.29); g.fill();
  });
}

/** Le drapeau français, deux fois plus large que haut. */
function texDrapeau() {
  return canvasTexture(192, 128, (g) => {
    g.fillStyle = '#0a2a7a'; g.fillRect(0, 0, 64, 128);
    g.fillStyle = '#f4f4f4'; g.fillRect(64, 0, 64, 128);
    g.fillStyle = '#d0202a'; g.fillRect(128, 0, 64, 128);
  });
}

/** Une plaque : fond, liseré, texte centré (une ou deux lignes). */
function texPlaque(lignes, { fond = '#f2eee4', encre = '#1c1c1c', liseré = '#8a8070', police = 'bold 54px Georgia, serif' } = {}) {
  return canvasTexture(512, 160, (g) => {
    g.fillStyle = fond; g.fillRect(0, 0, 512, 160);
    g.strokeStyle = liseré; g.lineWidth = 6; g.strokeRect(8, 8, 496, 144);
    g.fillStyle = encre; g.font = police; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lignes.length;
    lignes.forEach((l, i) => g.fillText(l, 256, 80 + (i - (n - 1) / 2) * 62));
  });
}

/** Pavage de pierre : dalles décalées sur fond sable. */
function texPavage() {
  const t = canvasTexture(256, 256, (g) => {
    g.fillStyle = '#b9ae98'; g.fillRect(0, 0, 256, 256);
    let s = 7;
    const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let y = 0; y < 256; y += 32) {
      const dec = (y / 32) % 2 ? 32 : 0;
      for (let x = -32; x < 256; x += 64) {
        const v = 170 + r() * 40;
        g.fillStyle = `rgb(${v | 0},${(v - 10) | 0},${(v - 28) | 0})`;
        g.fillRect(x + dec + 2, y + 2, 60, 28);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ─────────────────────────────────────────────────────────── petits éléments
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
function boite(w, h, d, m, x = 0, y = 0, z = 0, parent) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = true; b.receiveShadow = true;
  if (parent) parent.add(b);
  return b;
}

/** La tour de l'horloge, son beffroi et sa flèche. `base` = y où le fût commence (dans le bâtiment). */
function tour({ base, sommetToit }) {
  const g = new THREE.Group();
  const cote = 3.0;
  const stuc = mat(STUC), pierre = mat(PIERRE), ardoise = mat(ARDOISE, { roughness: 0.55 });
  const hFut = sommetToit + 2.6 - base;          // le fût dépasse le faîte de 2,6 m
  boite(cote, hFut, cote, stuc, 0, base + hFut / 2, 0, g);
  // chaînages d'angle en pierre
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) boite(0.3, hFut, 0.3, pierre, sx * (cote / 2 - 0.1), base + hFut / 2, sz * (cote / 2 - 0.1), g);
  // corniche sous les cadrans
  const yCad = base + hFut - 1.0;
  boite(cote + 0.5, 0.18, cote + 0.5, pierre, 0, yCad - 1.1, 0, g);
  // les quatre cadrans
  const cadran = new THREE.MeshStandardMaterial({ map: texCadran(), roughness: 0.6 });
  const rc = 0.78;
  for (const [rx, rz, ry] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
    const c = new THREE.Mesh(new THREE.CircleGeometry(rc, 32), cadran);
    c.position.set(rx * (cote / 2 + 0.02), yCad, rz * (cote / 2 + 0.02));
    c.rotation.y = ry;
    g.add(c);
    const cadre = new THREE.Mesh(new THREE.TorusGeometry(rc + 0.06, 0.06, 8, 32), pierre);
    cadre.position.copy(c.position); cadre.rotation.y = ry;
    g.add(cadre);
  }
  // corniche haute, puis le beffroi ouvert : dalle, quatre piliers, arcs suggérés par un linteau
  const yHaut = base + hFut;
  boite(cote + 0.6, 0.22, cote + 0.6, pierre, 0, yHaut + 0.11, 0, g);
  const hBef = 2.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) boite(0.34, hBef, 0.34, pierre, sx * (cote / 2 - 0.25), yHaut + 0.22 + hBef / 2, sz * (cote / 2 - 0.25), g);
  // garde-corps en fer entre les piliers
  const fer = mat(FER, { metalness: 0.6, roughness: 0.5 });
  for (const [x, z, w, d] of [[0, cote / 2 - 0.25, cote - 0.7, 0.04], [0, -(cote / 2 - 0.25), cote - 0.7, 0.04], [cote / 2 - 0.25, 0, 0.04, cote - 0.7], [-(cote / 2 - 0.25), 0, 0.04, cote - 0.7]]) {
    boite(w, 0.04, d, fer, x, yHaut + 1.05, z, g);
    boite(w, 0.04, d, fer, x, yHaut + 0.45, z, g);
  }
  // la cloche
  const bronze = mat(0x6b5a2e, { metalness: 0.7, roughness: 0.4 });
  const cloche = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 0.6, 20), bronze);
  cloche.position.set(0, yHaut + 0.22 + hBef - 0.55, 0);
  g.add(cloche);
  boite(cote - 0.6, 0.08, 0.08, fer, 0, yHaut + 0.22 + hBef - 0.2, 0, g);
  // toit du beffroi : dalle, puis la flèche d'ardoise à quatre pans et sa girouette
  const yToit = yHaut + 0.22 + hBef;
  boite(cote + 0.7, 0.24, cote + 0.7, pierre, 0, yToit + 0.12, 0, g);
  const fleche = new THREE.Mesh(new THREE.ConeGeometry((cote + 0.9) / Math.SQRT2, 3.6, 4), ardoise);
  fleche.position.set(0, yToit + 0.24 + 1.8, 0);
  fleche.rotation.y = Math.PI / 4;
  fleche.castShadow = true;
  g.add(fleche);
  const tige = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 8), fer);
  tige.position.set(0, yToit + 0.24 + 3.6 + 0.7, 0);
  g.add(tige);
  const boule = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), mat(0xd9b24c, { metalness: 0.8, roughness: 0.3 }));
  boule.position.set(0, yToit + 0.24 + 3.6 + 0.4, 0);
  g.add(boule);
  const coq = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.03), fer);
  coq.position.set(0.18, yToit + 0.24 + 3.6 + 1.25, 0);
  g.add(coq);
  return g;
}

/** L'entrée : porte, marches, balcon, plaques, drapeaux, lanternes. Repère : x le long de la façade, +z vers la rue. */
function entree() {
  const g = new THREE.Group();
  const pierre = mat(PIERRE), bois = mat(0x4a2e1c, { roughness: 0.7 }), fer = mat(FER, { metalness: 0.6, roughness: 0.5 });
  // encadrement et porte à deux battants
  boite(2.9, 3.3, 0.16, pierre, 0, 1.65, 0.04, g);
  boite(2.2, 2.9, 0.08, bois, 0, 1.45, 0.1, g);
  boite(0.04, 2.9, 0.1, pierre, 0, 1.45, 0.12, g);
  for (const sx of [-1, 1]) {
    const poignee = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), mat(0xc9a24a, { metalness: 0.8, roughness: 0.3 }));
    poignee.position.set(sx * 0.2, 1.1, 0.17); g.add(poignee);
    // panneaux de porte en relief
    boite(0.8, 1.0, 0.03, mat(0x5a3a24), sx * 0.55, 2.0, 0.15, g);
    boite(0.8, 0.9, 0.03, mat(0x5a3a24), sx * 0.55, 0.65, 0.15, g);
  }
  // trois marches
  for (let i = 0; i < 3; i++) boite(3.6 + i * 0.5, 0.16, 0.36 + i * 0.36, pierre, 0, 0.08 + (2 - i) * 0.16, 0.2 + i * 0.18, g);
  // balcon en fer forgé au-dessus de la porte
  boite(3.4, 0.14, 0.9, pierre, 0, 3.55, 0.45, g);
  for (let i = 0; i <= 16; i++) boite(0.03, 1.0, 0.03, fer, -1.6 + i * 0.2, 4.12, 0.88, g);
  for (const z of [0.88]) boite(3.4, 0.05, 0.05, fer, 0, 4.62, z, g);
  for (const sx of [-1, 1]) { for (let i = 0; i <= 4; i++) boite(0.03, 1.0, 0.03, fer, sx * 1.68, 4.12, 0.04 + i * 0.21, g); boite(0.05, 0.05, 0.9, fer, sx * 1.68, 4.62, 0.45, g); }
  // porte-fenêtre du balcon
  boite(1.6, 2.4, 0.06, mat(0x2c3a4a, { roughness: 0.3, metalness: 0.2 }), 0, 4.85, 0.03, g);
  boite(1.9, 2.7, 0.04, pierre, 0, 4.85, 0.01, g);
  // plaques : « MAIRIE » au-dessus du balcon, la devise sous le balcon
  const plaqueMairie = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.8), new THREE.MeshStandardMaterial({ map: texPlaque(['MAIRIE'], { police: 'bold 84px Georgia, serif' }), roughness: 0.7 }));
  plaqueMairie.position.set(0, 6.55, 0.06); g.add(plaqueMairie);
  const devise = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.75), new THREE.MeshStandardMaterial({ map: texPlaque(['RÉPUBLIQUE FRANÇAISE', 'LIBERTÉ · ÉGALITÉ · FRATERNITÉ'], { fond: '#1f3f8f', encre: '#ffffff', liseré: '#ffffff', police: 'bold 30px Georgia, serif' }), roughness: 0.7 }));
  devise.position.set(0, 3.9, 0.06); devise.scale.set(1, 0.8, 1); g.add(devise);
  // deux drapeaux en oblique, de part et d'autre du balcon
  const toile = new THREE.MeshStandardMaterial({ map: texDrapeau(), side: THREE.DoubleSide, roughness: 0.9 });
  for (const sx of [-1, 1]) {
    const hampe = new THREE.Group();
    hampe.position.set(sx * 2.4, 5.2, 0.1);
    hampe.rotation.z = -sx * 0.55;               // penchée vers la rue et vers l'extérieur
    hampe.rotation.x = 0.5;
    const tige = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 8), mat(0x8a6a3a));
    tige.position.y = 1.2; hampe.add(tige);
    const drapeau = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), toile);
    drapeau.position.set(sx * 0.75, 1.75, 0);
    drapeau.rotation.y = sx * 0.2;
    hampe.add(drapeau);
    g.add(hampe);
    // lanterne murale
    const lanterne = new THREE.Group();
    lanterne.position.set(sx * 2.0, 2.9, 0.3);
    boite(0.05, 0.05, 0.5, fer, 0, 0, -0.15, lanterne);
    const verre = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.3), new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd27a, emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }));
    verre.position.set(0, -0.28, 0.05); lanterne.add(verre);
    boite(0.4, 0.06, 0.4, fer, 0, -0.05, 0.05, lanterne);
    g.add(lanterne);
  }
  return g;
}

/** La place : pavage, fontaine, bancs, lampadaires. Repère local, origine au centre. */
function place({ rayon = 7.5 } = {}) {
  const g = new THREE.Group();
  const pierre = mat(PIERRE), fer = mat(FER, { metalness: 0.6, roughness: 0.5 });
  const pav = texPavage(); pav.repeat.set(rayon / 1.2, rayon / 1.2);
  const sol = new THREE.Mesh(new THREE.CircleGeometry(rayon, 48), new THREE.MeshStandardMaterial({ map: pav, roughness: 0.95 }));
  sol.rotation.x = -Math.PI / 2; sol.position.y = 0.04; sol.receiveShadow = true; g.add(sol);
  // fontaine : bassin, eau, colonne, vasque
  const bassin = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.4, 0.7, 32, 1, true), pierre);
  bassin.position.y = 0.35; bassin.material.side = THREE.DoubleSide; g.add(bassin);
  const margelle = new THREE.Mesh(new THREE.TorusGeometry(2.3, 0.16, 10, 40), pierre);
  margelle.rotation.x = Math.PI / 2; margelle.position.y = 0.72; g.add(margelle);
  const eau = new THREE.Mesh(new THREE.CircleGeometry(2.25, 32), new THREE.MeshStandardMaterial({ color: 0x4f88a8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 }));
  eau.rotation.x = -Math.PI / 2; eau.position.y = 0.58; g.add(eau);
  const colonne = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.3, 16), pierre); colonne.position.y = 1.2; g.add(colonne);
  const vasque = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.35, 0.35, 24, 1, true), pierre); vasque.position.y = 1.95; vasque.material.side = THREE.DoubleSide; g.add(vasque);
  const eau2 = eau.clone(); eau2.geometry = new THREE.CircleGeometry(0.9, 24); eau2.position.y = 2.05; g.add(eau2);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.7 }));
  jet.position.y = 2.5; g.add(jet);
  // quatre bancs et quatre lampadaires, en couronne
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const banc = new THREE.Group();
    banc.position.set(Math.cos(a) * (rayon - 1.6), 0.04, Math.sin(a) * (rayon - 1.6));
    banc.rotation.y = -a + Math.PI / 2;
    const bois = mat(0x6b4a2a);
    boite(1.8, 0.06, 0.45, bois, 0, 0.45, 0, banc);
    boite(1.8, 0.4, 0.05, bois, 0, 0.75, -0.22, banc);
    for (const sx of [-0.75, 0.75]) { boite(0.06, 0.45, 0.45, fer, sx, 0.22, 0, banc); boite(0.06, 0.45, 0.06, fer, sx, 0.72, -0.22, banc); }
    g.add(banc);
    const b = (i / 4) * Math.PI * 2;
    const lamp = new THREE.Group();
    lamp.position.set(Math.cos(b) * (rayon - 0.9), 0.04, Math.sin(b) * (rayon - 0.9));
    const fut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 3.6, 10), fer); fut.position.y = 1.8; lamp.add(fut);
    const lanterne = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.36), new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd27a, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }));
    lanterne.position.y = 3.75; lamp.add(lanterne);
    const chapeau = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.25, 4), fer); chapeau.position.y = 4.1; chapeau.rotation.y = Math.PI / 4; lamp.add(chapeau);
    g.add(lamp);
  }
  return g;
}

/**
 * Pose la mairie et sa place dans le village.
 *
 * @param {object} o { scene, decor } — decor vient de poilhes-scene.js (meta, murs, blockedAt, groundAt, arr)
 * @returns {object|null} { root, tour, entree, place } ou null si le lieu manque
 */
export function poserMairie({ scene, decor }) {
  const lieux = decor.meta.lieux || [];
  const lieu = lieux.find((p) => p.type === 'townhall' || p.genre === 'Mairie');
  if (!lieu) return null;
  const bati = (decor.meta.batiments || []).find((b) => b.nom === lieu.nom) || null;
  const solY = decor.groundAt(lieu.x, lieu.z);
  const rue = (decor.meta.rues || []).find((r) => /place de la mairie/i.test(r.nom || ''));
  const cx = bati ? bati.x : lieu.x, cz = bati ? -bati.n : lieu.z;
  const facade = !decor.murs ? null
    : (rue && facadeVers(decor.murs, decor.blockedAt, cx, cz, solY + 2.2, rue.x, rue.z))
      || chercherFacade(decor.murs, decor.blockedAt, lieu.x, lieu.z, solY + 2.2);

  const root = new THREE.Group();
  root.name = 'mairie';
  scene.add(root);

  // ── l'entrée, sur la façade ─────────────────────────────────────────────
  const px = facade ? facade.point.x : lieu.x, pz = facade ? facade.point.z : lieu.z;
  const cap = facade ? facade.cap : 0;
  const porte = entree();
  porte.position.set(px, decor.groundAt(px, pz), pz);
  porte.rotation.y = cap;
  root.add(porte);

  // ── la tour, dans l'axe de l'entrée, en retrait dans le bâtiment ────────
  const sol = bati ? bati.sol : solY;
  const faite = bati ? bati.toit : solY + 12;
  const tx = px - Math.sin(cap) * 2.7, tz = pz - Math.cos(cap) * 2.7;
  const clocher = tour({ base: sol + 6, sommetToit: faite });
  clocher.position.set(tx, 0, tz);
  clocher.rotation.y = cap;
  root.add(clocher);

  // ── la place : premier point libre autour de l'étiquette « Place de la Mairie »
  let placeGroupe = null;
  if (rue) {
    const libre = trouverPlace(decor, rue.x, rue.z, 6.5);
    if (libre) {
      placeGroupe = place({ rayon: 6.5 });
      placeGroupe.position.set(libre.x, decor.groundAt(libre.x, libre.z), libre.z);
      root.add(placeGroupe);
    }
  }
  return { root, tour: clocher, entree: porte, place: placeGroupe, facade, lieu };
}

/**
 * Un disque de `rayon` mètres sans bâti, sans eau et à plus de 2 m de toute
 * chaussée, le plus près possible de (x, z). Les routes sont lues dans l'axe
 * des rubans (`routes_pos`, un sommet sur neuf) : quelques milliers de points,
 * un balayage suffit.
 */
function trouverPlace(decor, x, z, rayon) {
  let axes = null;
  try {
    const pos = decor.arr('routes_pos');
    const n = (pos.length / 27) | 0;
    axes = new Float32Array(n * 2);
    for (let r = 0; r < n; r++) { axes[r * 2] = pos[(r * 9 + 4) * 3]; axes[r * 2 + 1] = pos[(r * 9 + 4) * 3 + 2]; }
  } catch (e) { axes = null; }
  const loinDesRoutes = (cx, cz, marge) => {
    if (!axes) return true;
    const m2 = marge * marge;
    for (let i = 0; i < axes.length; i += 2) {
      const dx = axes[i] - cx, dz = axes[i + 1] - cz;
      if (dx * dx + dz * dz < m2) return false;
    }
    return true;
  };
  const libre = (cx, cz) => {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      for (const f of [0.35, 0.7, 1.0]) {
        if (decor.blockedAt(cx + Math.cos(a) * rayon * f, cz + Math.sin(a) * rayon * f)) return false;
      }
    }
    return !decor.blockedAt(cx, cz) && loinDesRoutes(cx, cz, rayon + 1.0);
  };
  for (let r = 0; r <= 40; r += 2) {
    const pas = r ? Math.max(8, Math.round(r * 2)) : 1;
    for (let k = 0; k < pas; k++) {
      const a = (k / pas) * Math.PI * 2;
      const cx = x + Math.cos(a) * r, cz = z + Math.sin(a) * r;
      if (libre(cx, cz)) return { x: cx, z: cz };
    }
  }
  return null;
}
