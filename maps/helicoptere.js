/**
 * L'hélicoptère — Poilhes City.
 *
 * Arnaud, 26/09/2026 : « il nous faut un bel hélicoptère, vite fait ». Pas de
 * modèle à télécharger : il est construit ici en quelques volumes (fuselage,
 * verrière, poutre de queue, dérive, patins, rotors), rouge et blanc, avec un
 * gyrophare. Il tourne au-dessus de la boucle de course comme un hélico de
 * télévision qui suit la course : 60 m au-dessus du sol, 25 m/s, penché dans
 * son virage, un léger roulis de houle.
 *
 * Le son est synthétisé : un souffle filtré dont le volume bat au rythme des
 * pales (≈ 11 battements/s), plus fort quand il passe près. Il ne démarre
 * qu'après un premier geste (règle des navigateurs).
 */
import * as THREE from 'three';

export const HELICO = {
  altitude: 60,     // m au-dessus du sol
  rayon: 170,       // m, rayon de l'orbite
  vitesse: 25,      // m/s
  volume: 0.35,
  battement: 11,    // battements de pales par seconde (à l'oreille)
};

/** Le modèle : environ 12 m de long, le nez vers −z. */
function construire() {
  const rouge = new THREE.MeshStandardMaterial({ color: 0xc81e2b, roughness: 0.45, metalness: 0.25 });
  const blanc = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, metalness: 0.15 });
  const noir = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.55, metalness: 0.5 });
  const vitre = new THREE.MeshStandardMaterial({ color: 0x1b3346, roughness: 0.1, metalness: 0.6, transparent: true, opacity: 0.85 });
  const h = new THREE.Group();
  h.name = 'helicoptere';

  // fuselage : une sphère étirée, et un bandeau blanc
  const corps = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), rouge);
  corps.scale.set(1.35, 1.25, 2.6);
  h.add(corps);
  const bande = new THREE.Mesh(new THREE.SphereGeometry(1.01, 24, 4, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.12), blanc);
  bande.scale.copy(corps.scale);
  h.add(bande);
  // verrière, à l'avant
  const verriere = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), vitre);
  verriere.scale.set(1.2, 1.05, 1.5);
  verriere.rotation.x = -Math.PI / 2.4;
  verriere.position.set(0, 0.25, -1.55);
  h.add(verriere);
  // poutre de queue et dérive
  const poutre = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.42, 5.6, 12), rouge);
  poutre.rotation.x = Math.PI / 2;
  poutre.position.set(0, 0.35, 4.6);
  h.add(poutre);
  const derive = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.9), blanc);
  derive.position.set(0, 1.05, 7.2);
  derive.rotation.x = -0.35;
  h.add(derive);
  const empennage = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.5), blanc);
  empennage.position.set(0, 0.4, 6.4);
  h.add(empennage);
  // patins
  for (const cote of [-1, 1]) {
    const patin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.2, 8), noir);
    patin.rotation.x = Math.PI / 2;
    patin.position.set(cote * 1.05, -1.55, 0.1);
    h.add(patin);
    for (const z of [-0.9, 1.0]) {
      const jambe = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 6), noir);
      jambe.position.set(cote * 0.95, -1.2, z);
      jambe.rotation.z = cote * 0.25;
      h.add(jambe);
    }
  }
  // mât et rotor principal : quatre pales et un disque flou
  const mat = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 10), noir);
  mat.position.set(0, 1.45, -0.1);
  h.add(mat);
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.78, -0.1);
  for (let k = 0; k < 4; k++) {
    const pale = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 5.2), noir);
    pale.position.z = 2.6;
    const bras = new THREE.Group();
    bras.rotation.y = (k * Math.PI) / 2;
    bras.add(pale);
    rotor.add(bras);
  }
  const disque = new THREE.Mesh(new THREE.CircleGeometry(5.3, 40),
    new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  disque.rotation.x = -Math.PI / 2;
  rotor.add(disque);
  h.add(rotor);
  // rotor de queue
  const anticouple = new THREE.Group();
  anticouple.position.set(0.28, 1.1, 7.35);
  for (let k = 0; k < 2; k++) {
    const pale = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.3, 0.14), noir);
    pale.rotation.x = (k * Math.PI) / 2;
    anticouple.add(pale);
  }
  h.add(anticouple);
  // gyrophare
  const gyro = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
  gyro.position.set(0, -1.2, 1.2);
  h.add(gyro);

  h.traverse((o) => { if (o.isMesh && o !== disque) o.castShadow = true; });
  return { h, rotor, anticouple, gyro };
}

function creerSon() {
  let ctx = null, gain = null, battement = null;
  function demarrer() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    const n = ctx.sampleRate * 2;
    const tampon = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = tampon.getChannelData(0);
    let brun = 0;
    for (let i = 0; i < n; i++) { brun = (brun + 0.03 * (Math.random() * 2 - 1)) / 1.03; d[i] = brun * 4; }
    const src = ctx.createBufferSource(); src.buffer = tampon; src.loop = true;
    const filtre = ctx.createBiquadFilter(); filtre.type = 'lowpass'; filtre.frequency.value = 420;
    // le « flap-flap » : un oscillateur basse fréquence module le volume
    battement = ctx.createGain(); battement.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = HELICO.battement;
    const profondeur = ctx.createGain(); profondeur.gain.value = 0.5;
    lfo.connect(profondeur).connect(battement.gain);
    gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(filtre).connect(battement).connect(gain).connect(ctx.destination);
    src.start(); lfo.start();
    return true;
  }
  function maj(force) { if (gain) gain.gain.setTargetAtTime(force * HELICO.volume, ctx.currentTime, 0.2); }
  function pause() { if (ctx) ctx.suspend(); }
  return { demarrer, maj, pause };
}

/**
 * @param {object} o
 * @param {THREE.Scene} o.scene
 * @param {THREE.Camera} o.camera
 * @param {Function} o.solAt      (x, z) => altitude du sol
 * @param {{x:number, z:number}} o.centre  le centre de l'orbite (la boucle de course)
 */
export function creerHelicoptere({ scene, camera, solAt, centre }) {
  const { h, rotor, anticouple, gyro } = construire();
  scene.add(h);
  const son = creerSon();
  let sonne = false;
  const armer = () => { sonne = son.demarrer(); };
  addEventListener('pointerdown', armer, { once: true, capture: true });
  addEventListener('keydown', armer, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) son.pause(); else if (sonne) son.demarrer(); });

  const w = HELICO.vitesse / HELICO.rayon;       // rad/s sur l'orbite
  let angle = Math.random() * Math.PI * 2, t = 0, avant = performance.now();
  const d = new THREE.Vector3();
  function image(maintenant) {
    requestAnimationFrame(image);
    const dt = Math.min(0.1, (maintenant - avant) / 1000);
    avant = maintenant;
    if (document.hidden) return;
    t += dt;
    angle += w * dt;
    const x = centre.x + Math.cos(angle) * HELICO.rayon;
    const z = centre.z + Math.sin(angle) * HELICO.rayon;
    const y = Math.max(solAt(x, z), solAt(centre.x, centre.z)) + HELICO.altitude + Math.sin(t * 0.4) * 4;
    h.position.set(x, y, z);
    // cap tangent à l'orbite (sens des aiguilles vu d'en haut), nez vers −z
    const tx = -Math.sin(angle), tz = Math.cos(angle);
    h.rotation.set(0, 0, 0);
    h.rotation.order = 'YXZ';
    h.rotation.y = Math.atan2(-tx, -tz);
    h.rotation.x = -0.08 + Math.sin(t * 0.7) * 0.02;   // nez un peu baissé : il avance
    h.rotation.z = 0.22;                               // penché vers le centre du virage
    rotor.rotation.y += dt * 38;
    anticouple.rotation.x += dt * 60;
    gyro.visible = (t % 1.2) < 0.15;
    if (sonne) {
      d.copy(h.position).sub(camera.position);
      son.maj(Math.min(1, (90 / Math.max(40, d.length())) ** 2));
    }
  }
  requestAnimationFrame(image);
  return { objet: h, reglages: HELICO };
}
