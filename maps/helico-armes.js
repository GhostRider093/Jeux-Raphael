/**
 * Les armes du gunship — mitrailleuse et missiles.
 *
 * Arnaud, 26/09/2026 : « l'hélicoptère de combat, au même titre que l'avion,
 * il faut lui mettre des missiles et des mitrailleuses ». On reprend ce que le
 * jeu a déjà : les sons du canon et du missile du chasseur
 * (`fighter-cannon-audio.js`, `fighter-missile-audio.js`, chargés à la
 * demande), l'explosion des Mondes (`world-explosion.js`) et les impacts du
 * village (`poilhes-impact.js`).
 *
 *   — les tirs partent 18° vers le bas ; un **réticule rouge** au sol montre
 *     où ils tomberont ;
 *   — **mitrailleuse** (F maintenue, clic gauche, R1) : deux canons qui
 *     alternent, 16 coups/s, traçantes à 650 m/s ; un coup qui touche le sol ou
 *     un toit y laisse un impact ;
 *   — **missiles** (G, clic droit, L1) : un par flanc, 0,6 s entre deux ; ils
 *     accélèrent jusqu'à 170 m/s en laissant une traînée, et explosent au
 *     contact du sol, d'un toit ou au bout de 1,5 km ;
 *   — pour rire : une explosion à moins de 9 m d'un figurant (stégosaure,
 *     mafieux, cycliste…) le renverse ; il se relève au bout de 15 s.
 *
 * La collision est une marche le long du trajet contre `plancher(x, z)` (le
 * sol, les toits, les houppiers) : pas de lancer de rayon sur deux millions de
 * triangles. Tout est préalloué.
 */
import * as THREE from 'three';
import { createImpacts } from './poilhes-impact.js?v=voiture-20260921';
import { createExplosionSystem } from './world-explosion.js';

// `plongee` : les tirs partent 18° sous l'horizontale, comme la tourelle sous le nez
// d'un hélicoptère de combat — à l'horizontale, les missiles allaient exploser à
// 1,5 km, hors de vue. Un réticule au sol montre où ils tomberont.
const PLONGEE = 0.31;
const MITRAILLE = { cadence: 16, vitesse: 650, portee: 900, canons: [[-0.95, 0.9, -5.5], [0.95, 0.9, -5.5]] };
const MISSILE = { intervalle: 0.6, vitesse0: 55, vitesseMax: 170, accel: 140, portee: 1500, pylones: [[-2.1, 0.7, -1], [2.1, 0.7, -1]] };

function chargerScript(src) {
  return new Promise((ok) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = ok;
    document.head.appendChild(s);
  });
}

/**
 * @param {object} o { scene, camera, root, plancher, renderer } — `root` : le groupe de l'hélicoptère
 */
export function creerArmes({ scene, camera, root, plancher, renderer = null }) {
  // les sons du chasseur, chargés une fois
  if (!window.RaphaelFighterCannon) chargerScript('./fighter-cannon-audio.js?v=canon-lent-20260908');
  if (!window.RaphaelMissileAudio) chargerScript('./fighter-missile-audio.js?v=impact-sync-20260719');

  // **Pas de lumière qui apparaît et disparaît.** Impacts et explosions portent
  // chacun une PointLight : dès que le nombre de lumières visibles change,
  // Three.js recompile TOUS les matériaux du village — mesuré, 5 s par image au
  // premier tir. On retire ces lumières-là et l'on garde une seule lumière
  // d'éclair, toujours présente, qui s'allume à l'explosion.
  const avantSystemes = scene.children.length;
  const impacts = createImpacts({ scene });
  const explosions = createExplosionSystem({ scene, camera });
  for (const o of scene.children.slice(avantSystemes)) {
    const lumieres = [];
    o.traverse((c) => { if (c.isLight) lumieres.push(c); });
    for (const l of lumieres) { l.intensity = 0; l.parent.remove(l); }
  }
  const eclair = new THREE.PointLight(0xffa050, 0, 70, 2);
  scene.add(eclair);
  let eclairVie = 0;
  let cibles = () => [];
  // ── les cibles en l'air (27/09/2026, la prise d'assaut de Capestang) ─────
  // Chacune : { position: Vector3, rayon, vivante, toucher(degats) }. Un ennemi
  // dans le cône de visée (VERROU) est « verrouillé » : les balles partent vers
  // lui au lieu de plonger à 18°, et les missiles le poursuivent. C'est de
  // l'arcade : sans cela, toucher un hélicoptère qui bouge au canon fixe
  // demanderait un simulateur.
  let ciblesAir = () => [];
  let verrou = null;
  const VERROU = { angle: 0.22, portee: 950, virageMissile: 3.2 };

  // ── les traçantes ───────────────────────────────────────────────────────
  const N_BALLES = 64;
  const geoBalle = new THREE.BoxGeometry(0.32, 0.32, 12);
  const matBalle = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const balles = [];
  for (let i = 0; i < N_BALLES; i++) {
    const m = new THREE.Mesh(geoBalle, matBalle);
    m.visible = false; m.frustumCulled = false;
    scene.add(m);
    balles.push({ m, v: new THREE.Vector3(), vie: 0 });
  }
  let prochaineBalle = 0, canon = 0, attenteTir = 0;

  // ── les missiles et leur fumée ──────────────────────────────────────────
  const geoMissile = new THREE.CylinderGeometry(0.13, 0.13, 1.9, 8);
  geoMissile.rotateX(Math.PI / 2);
  const matMissile = new THREE.MeshStandardMaterial({ color: 0xcfd3d6, roughness: 0.4, metalness: 0.5 });
  const matFlamme = new THREE.SpriteMaterial({ color: 0xffa040, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const missiles = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(geoMissile, matMissile);
    const flamme = new THREE.Sprite(matFlamme);
    flamme.scale.set(1.2, 1.2, 1); flamme.position.z = 1.2;
    m.add(flamme);
    m.visible = false; m.frustumCulled = false;
    scene.add(m);
    missiles.push({ m, dir: new THREE.Vector3(), vitesse: 0, parcouru: 0, vie: false, fumee: 0 });
  }
  let pylone = 0, attenteMissile = 0;
  const texFumee = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const d = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    d.addColorStop(0, 'rgba(235,235,235,.9)'); d.addColorStop(1, 'rgba(235,235,235,0)');
    g.fillStyle = d; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const bouffees = [];
  for (let i = 0; i < 160; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFumee, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false; scene.add(s);
    bouffees.push({ s, vie: 0 });
  }
  let prochaineBouffee = 0;
  function fumer(p) {
    const b = bouffees[prochaineBouffee]; prochaineBouffee = (prochaineBouffee + 1) % bouffees.length;
    b.s.position.copy(p); b.vie = 1.6; b.s.visible = true;
  }

  // ── les figurants renversés ─────────────────────────────────────────────
  const renverses = new Map();       // objet -> temps restant
  function souffler(p) {
    for (const o of cibles()) {
      if (!o || renverses.has(o)) continue;
      if (o.position.distanceTo(p) < 9) {
        renverses.set(o, 15);
        o.userData.avantRenverse = o.rotation.z;
        o.rotation.z = (Math.random() < 0.5 ? -1 : 1) * 1.45;
      }
    }
  }

  const tmp = new THREE.Vector3(), q = new THREE.Quaternion(), avant = new THREE.Vector3();

  // ── le réticule : où les tirs tomberont ─────────────────────────────────
  const reticule = new THREE.Group();
  {
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    const anneau = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.2, 40), mat);
    anneau.rotation.x = -Math.PI / 2;
    reticule.add(anneau);
    for (let k = 0; k < 4; k++) {
      const trait = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 2.2), mat);
      trait.rotation.x = -Math.PI / 2;
      const a = (k * Math.PI) / 2;
      trait.rotation.z = a;
      trait.position.set(Math.sin(a) * 4.4, 0, Math.cos(a) * 4.4);
      reticule.add(trait);
    }
    reticule.renderOrder = 5;
    reticule.visible = false;
    scene.add(reticule);
  }
  const origineVisee = new THREE.Vector3(), dirVisee = new THREE.Vector3();
  function viser() {
    root.updateMatrixWorld(true);
    origineVisee.set(0, 0.9, -5.5).applyMatrix4(root.matrixWorld);
    root.getWorldQuaternion(q);
    dirVisee.set(0, -Math.sin(PLONGEE), -Math.cos(PLONGEE)).applyQuaternion(q);
    for (let d = 0; d < MITRAILLE.portee; d += 3) {
      tmp.copy(origineVisee).addScaledVector(dirVisee, d);
      const sol = plancher(tmp.x, tmp.z);
      if (tmp.y <= sol) {
        reticule.position.set(tmp.x, sol + 0.15, tmp.z);
        // il grossit avec la distance : à 250 m, un anneau de 6 m n'est qu'un point
        reticule.scale.setScalar(Math.min(6, Math.max(1, reticule.position.distanceTo(camera.position) / 45)));
        reticule.visible = true;
        return;
      }
    }
    reticule.visible = false;
  }

  /** La cible vivante que ce point touche (à `marge` près), ou null. */
  function toucheEnLair(p, marge) {
    for (const c of ciblesAir()) {
      if (c && c.vivante && c.position.distanceTo(p) < c.rayon + marge) return c;
    }
    return null;
  }

  function exploser(p) {
    eclair.position.set(p.x, p.y + 3, p.z);
    eclairVie = 0.5;
    const sol = plancher(p.x, p.z);
    explosions.spawn(p.clone(), 1.3, sol);
    impacts.spawn(p.clone(), new THREE.Vector3(0, 1, 0), 2.2);
    if (window.RaphaelMissileAudio) window.RaphaelMissileAudio.playDestruction();
    souffler(p);
  }

  /** L'ennemi le plus proche de l'axe du nez, dans le cône et à portée — ou null. */
  const nez = new THREE.Vector3(), versCible = new THREE.Vector3();
  function chercherVerrou() {
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(q);
    nez.set(0, 0, -1).applyQuaternion(q);
    nez.y = 0; nez.normalize();
    let meilleur = null, score = Infinity;
    for (const c of ciblesAir()) {
      if (!c || !c.vivante) continue;
      versCible.copy(c.position).sub(root.position);
      const d = versCible.length();
      if (d > VERROU.portee || d < 1) continue;
      const horiz = Math.hypot(versCible.x, versCible.z) || 1;
      const angle = Math.acos(Math.max(-1, Math.min(1, (versCible.x * nez.x + versCible.z * nez.z) / horiz)));
      if (angle > VERROU.angle) continue;
      if (angle * 400 + d < score) { score = angle * 400 + d; meilleur = c; }
    }
    return meilleur;
  }

  function tirerBalle() {
    const b = balles[prochaineBalle]; prochaineBalle = (prochaineBalle + 1) % N_BALLES;
    const c = MITRAILLE.canons[canon]; canon = 1 - canon;
    root.updateMatrixWorld(true);
    b.m.position.set(c[0], c[1], c[2]).applyMatrix4(root.matrixWorld);
    root.getWorldQuaternion(q);
    avant.set(0, -Math.sin(PLONGEE), -Math.cos(PLONGEE)).applyQuaternion(q);
    if (verrou) {
      // verrouillé : droit sur la cible, avec un peu de dispersion
      avant.copy(verrou.position).sub(b.m.position).normalize();
      avant.x += (Math.random() - 0.5) * 0.02; avant.y += (Math.random() - 0.5) * 0.02; avant.z += (Math.random() - 0.5) * 0.02;
      avant.normalize();
    }
    b.v.copy(avant).multiplyScalar(MITRAILLE.vitesse);
    b.m.lookAt(tmp.copy(b.m.position).sub(avant));     // la traçante dans l'axe du tir
    b.vie = MITRAILLE.portee / MITRAILLE.vitesse;
    b.m.visible = true;
    if (window.RaphaelFighterCannon) window.RaphaelFighterCannon.fireShot();
  }

  function tirerMissile() {
    const m = missiles.find((x) => !x.vie);
    if (!m) return;
    const p = MISSILE.pylones[pylone]; pylone = 1 - pylone;
    root.updateMatrixWorld(true);
    m.m.position.set(p[0], p[1], p[2]).applyMatrix4(root.matrixWorld);
    root.getWorldQuaternion(q);
    m.dir.set(0, -Math.sin(PLONGEE), -Math.cos(PLONGEE)).applyQuaternion(q);
    m.cible = verrou;                                  // tête chercheuse, si l'on a verrouillé
    if (verrou) m.dir.set(0, 0, -1).applyQuaternion(q);
    m.m.lookAt(tmp.copy(m.m.position).sub(m.dir));   // le nez du missile dans le sens du tir
    m.vitesse = MISSILE.vitesse0; m.parcouru = 0; m.vie = true; m.m.visible = true;
    if (window.RaphaelMissileAudio) window.RaphaelMissileAudio.playLaunch();
  }

  /**
   * @param {number} dt
   * @param {{mitrailleuse:boolean, missile:boolean}} commandes (null : ne tire pas)
   */
  function update(dt, commandes) {
    verrou = commandes ? chercherVerrou() : null;
    if (commandes) viser(); else reticule.visible = false;
    if (commandes) {
      attenteTir -= dt; attenteMissile -= dt;
      if (commandes.mitrailleuse && attenteTir <= 0) { tirerBalle(); attenteTir = 1 / MITRAILLE.cadence; }
      if (commandes.missile && attenteMissile <= 0) { tirerMissile(); attenteMissile = MISSILE.intervalle; }
    }
    for (const b of balles) {
      if (b.vie <= 0) continue;
      b.vie -= dt;
      // on avance par petits pas : une balle à 650 m/s fait 11 m par image
      const pas = Math.ceil((MITRAILLE.vitesse * dt) / 3);
      let touche = false;
      for (let k = 0; k < pas && !touche; k++) {
        b.m.position.addScaledVector(b.v, dt / pas);
        const cible = toucheEnLair(b.m.position, 0);
        if (cible) { cible.toucher(4, b.m.position); impacts.spawn(b.m.position.clone(), tmp.set(0, 1, 0).clone(), 0.8); touche = true; break; }
        const sol = plancher(b.m.position.x, b.m.position.z);
        if (b.m.position.y <= sol) {
          b.m.position.y = sol + 0.05;
          impacts.spawn(b.m.position.clone(), tmp.set(0, 1, 0).clone(), 0.55);
          touche = true;
        }
      }
      if (touche || b.vie <= 0) { b.vie = 0; b.m.visible = false; }
    }
    for (const m of missiles) {
      if (!m.vie) continue;
      m.vitesse = Math.min(MISSILE.vitesseMax, m.vitesse + MISSILE.accel * dt);
      if (m.cible && m.cible.vivante) {
        // la tête chercheuse : le cap tourne vers la cible, à vitesse limitée
        versCible.copy(m.cible.position).sub(m.m.position).normalize();
        const k = Math.min(1, VERROU.virageMissile * dt);
        m.dir.lerp(versCible, k).normalize();
        m.m.lookAt(tmp.copy(m.m.position).sub(m.dir));
      }
      const d = m.vitesse * dt;
      const pas = Math.ceil(d / 3);
      let boum = false;
      for (let k = 0; k < pas && !boum; k++) {
        m.m.position.addScaledVector(m.dir, d / pas);
        const cible = toucheEnLair(m.m.position, 2.5);
        if (cible) { cible.toucher(45, m.m.position); boum = true; }
        else if (m.m.position.y <= plancher(m.m.position.x, m.m.position.z)) boum = true;
      }
      m.parcouru += d;
      m.fumee -= dt;
      if (m.fumee <= 0) { fumer(m.m.position); m.fumee = 0.025; }
      if (boum || m.parcouru > MISSILE.portee) {
        exploser(m.m.position);
        m.vie = false; m.m.visible = false;
      }
    }
    for (const b of bouffees) {
      if (b.vie <= 0) continue;
      b.vie -= dt;
      const k = b.vie / 1.6;
      b.s.material.opacity = 0.55 * k;
      const t = 1.2 + (1 - k) * 4;
      b.s.scale.set(t, t, 1);
      b.s.position.y += dt * 0.6;
      if (b.vie <= 0) b.s.visible = false;
    }
    for (const [o, reste] of renverses) {
      const r = reste - dt;
      if (r <= 0) { o.rotation.z = o.userData.avantRenverse || 0; renverses.delete(o); }
      else renverses.set(o, r);
    }
    impacts.update(dt);
    explosions.update(dt);
    if (eclairVie > 0) { eclairVie -= dt; eclair.intensity = Math.max(0, eclairVie / 0.5) * 900; }
    else eclair.intensity = 0;
  }

  /**
   * **Préchauffage.** Au premier tir, le navigateur compilait d'un coup les
   * programmes graphiques des traçantes, des impacts et de l'explosion : l'image
   * gelait une seconde (mesuré : 60 → 1 image/s). On les compile d'avance, loin
   * sous le sol, quand on prend l'hélicoptère.
   */
  let prechauffe = false;
  function prechauffer() {
    if (prechauffe || !renderer) return;
    prechauffe = true;
    const loin = new THREE.Vector3(camera.position.x, -5000, camera.position.z);
    const temoins = [balles[0].m, missiles[0].m, bouffees[0].s, reticule];
    for (const o of temoins) { o.position.copy(loin); o.visible = true; }
    impacts.spawn(loin.clone(), new THREE.Vector3(0, 1, 0), 1);
    explosions.spawn(loin.clone(), 1, loin.y);
    try { renderer.compile(scene, camera); } catch (e) { /* pas grave : on compilera au premier tir */ }
    for (const o of temoins) o.visible = false;
  }

  return {
    update, prechauffer,
    /** Ce qui peut être renversé par une explosion (figurants). */
    setCibles(f) { cibles = f; },
    /** Les cibles en l'air (ennemis) : `f()` rend [{ position, rayon, vivante, toucher(degats) }]. */
    setCiblesAir(f) { ciblesAir = f; },
    /** La cible verrouillée en ce moment, ou null. */
    verrou: () => verrou,
    /** Une explosion ailleurs que sous un missile (un ennemi abattu). */
    exploser: (p) => exploser(p),
  };
}
