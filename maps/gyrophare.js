/**
 * Le gyrophare de la voiture de police (04/10/2026).
 *
 * Arnaud : « le gyrophare est trop rouge, il faudrait qu'il soit bleu et rouge
 * et qu'ils scintillent, comme des lumières ». La rampe du modèle Meshy est
 * peinte d'un seul orange saumon dans l'atlas. On la **sort de la carrosserie**
 * et on la remplace par deux verres :
 *
 *   — la rampe se repère sans rien écrire en dur : c'est tout ce qui dépasse
 *     93,5 % de la hauteur de la voiture (le pavillon culmine vers 88 %) ;
 *   — moitié gauche rouge, moitié droite bleue (côté conducteur rouge, comme
 *     aux États-Unis) ; leurs triangles quittent la carrosserie, sinon les deux
 *     surfaces se battraient pixel par pixel ;
 *   — **double flash alterné** (« wig-wag ») : rouge-rouge, bleu-bleu, 0,6 s le
 *     cycle. Allumé, le verre s'éclaire (émissif), une `PointLight` de sa
 *     couleur éclaire la rue et un halo additif se voit même en plein soleil ;
 *     éteint, le verre reste teinté — on voit qu'il est rouge et bleu.
 *
 * Aucune allocation dans `maj()` : tout est créé au montage.
 *
 *   const gyro = monterGyrophare(voiture);   // après ou avant voiture.pret
 *   gyro.maj(dt);  gyro.allumer(true|false);  gyro.allume
 */
import * as THREE from 'three';

const SEUIL = 0.935;          // part de la hauteur au-dessus de laquelle commence la rampe
const CYCLE = 0.6;            // s : rouge-rouge puis bleu-bleu
const FLASH = 0.075;          // s : durée d'un éclat
const LUMIERE = 26;           // intensité d'une PointLight allumée (candela, lumières physiques)
const PORTEE = 22;            // m

/** Un halo doux, dessiné une fois. */
let textureHalo = null;
function halo() {
  if (textureHalo) return textureHalo;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const d = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  d.addColorStop(0, 'rgba(255,255,255,1)');
  d.addColorStop(0.25, 'rgba(255,255,255,.55)');
  d.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = d;
  g.fillRect(0, 0, 64, 64);
  textureHalo = new THREE.CanvasTexture(c);
  return textureHalo;
}

/** Allumé pendant les deux premiers éclats de sa moitié du cycle ? */
function eclat(t, decalage) {
  const p = ((t / CYCLE + decalage) % 1) * CYCLE;
  return (p < FLASH) || (p > FLASH * 2 && p < FLASH * 3);
}

/**
 * Sépare la rampe de la carrosserie et pose les deux verres.
 * @returns {{verres: THREE.Mesh[], centre: THREE.Vector3}|null}
 */
function decouperRampe(corps) {
  const geo = corps.geometry;
  const pos = geo.attributes.position;
  // La découpe des roues rend une carrosserie **non indexée** (triangles à
  // plat) : on la numérote, ce qui permet ensuite de lui retirer la rampe.
  if (!geo.index) {
    const suite = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) suite[i] = i;
    geo.setIndex(new THREE.BufferAttribute(suite, 1));
  }
  const index = geo.index;
  geo.computeBoundingBox();
  const haut = geo.boundingBox.max.y;
  const seuil = haut * SEUIL;
  const garde = [], gauche = [], droite = [];
  const bMin = new THREE.Vector3(1e9, 1e9, 1e9), bMax = new THREE.Vector3(-1e9, -1e9, -1e9), p = new THREE.Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    if (y < seuil) { garde.push(a, b, c); continue; }
    const x = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    (x < 0 ? gauche : droite).push(a, b, c);
    for (const i of [a, b, c]) {
      p.fromBufferAttribute(pos, i);
      bMin.min(p); bMax.max(p);
    }
  }
  if (gauche.length < 30 || droite.length < 30) return null;
  geo.setIndex(garde);
  const sous = (idx) => {
    const g = new THREE.BufferGeometry();
    for (const [nom, attr] of Object.entries(geo.attributes)) g.setAttribute(nom, attr);
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  };
  return { gauche: sous(gauche), droite: sous(droite), min: bMin, max: bMax };
}

export function monterGyrophare(voiture) {
  const COULEURS = [
    { verre: 0x5a0a0c, feu: 0xff2020, decalage: 0 },      // gauche : rouge
    { verre: 0x0a1f66, feu: 0x2f6bff, decalage: 0.5 },    // droite : bleu
  ];
  const cotes = COULEURS.map((c) => ({
    ...c,
    matiere: new THREE.MeshStandardMaterial({
      color: c.verre, emissive: c.feu, emissiveIntensity: 0,
      roughness: 0.25, metalness: 0, side: THREE.DoubleSide,
    }),
    lumiere: new THREE.PointLight(c.feu, 0, PORTEE, 2),
    halo: new THREE.Sprite(new THREE.SpriteMaterial({
      map: halo(), color: c.feu, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0,
    })),
    allumeCote: false,
  }));
  let monte = false, allume = true, horloge = 0;

  function monter() {
    if (monte) return;
    let corps = null;
    voiture.caisse.traverse((o) => { if (o.isMesh && o.name === 'carrosserie') corps = o; });
    if (!corps) return;
    const r = decouperRampe(corps);
    monte = true;
    if (!r) { console.warn('Gyrophare : rampe introuvable sur le toit'); return; }
    const centreY = (r.min.y + r.max.y) / 2, centreZ = (r.min.z + r.max.z) / 2;
    const demi = (r.max.x - r.min.x) / 4;              // le milieu de chaque moitié
    [r.gauche, r.droite].forEach((g, k) => {
      const c = cotes[k];
      const verre = new THREE.Mesh(g, c.matiere);
      verre.name = 'gyrophare';
      corps.parent.add(verre);
      const x = k === 0 ? -demi : demi;
      c.lumiere.position.set(x, r.max.y + 0.15, centreZ);
      corps.parent.add(c.lumiere);
      c.halo.position.set(x, centreY, centreZ);
      c.halo.scale.setScalar(1.6);
      c.halo.renderOrder = 5;
      corps.parent.add(c.halo);
    });
  }
  if (voiture.pret) voiture.pret.then(monter);

  function maj(dt) {
    horloge += dt;
    if (!monte) monter();
    for (const c of cotes) {
      const on = allume && eclat(horloge, c.decalage);
      if (on === c.allumeCote) continue;
      c.allumeCote = on;
      c.matiere.emissiveIntensity = on ? 2.2 : 0;
      c.lumiere.intensity = on ? LUMIERE : 0;
      c.halo.material.opacity = on ? 0.95 : 0;
    }
  }

  return {
    maj,
    allumer(on) { allume = !!on; },
    get allume() { return allume; },
  };
}
