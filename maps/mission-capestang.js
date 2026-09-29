/**
 * Mission : la prise d'assaut de Capestang (Poilhes City, 27/09/2026).
 *
 * Arnaud : « avec le jeu d'hélico, dans le même rouler.html, on va faire la
 * prise d'assaut de Capestang : on vole jusqu'à Capestang, on détruit deux
 * hélicos de combat ennemis ». Puis, le même soir : « plus d'ennemis sur le
 * trajet, sinon c'est trop long ; des objectifs au sol ; de la défense
 * antiaérienne à l'entrée de la ville ; niveau facile ».
 *
 * Le décor est le **pays** (`pays-scene.js`) : Poilhes et Capestang à leur écart
 * réel, 4 km de campagne entre les deux. L'hélicoptère est celui du village
 * (`poilhes-helico.js`, ses commandes et ses armes) : on décolle de Poilhes.
 *
 * Trois phases (`PHASES`) :
 *   1. **le trajet** — deux vagues d'hélicos viennent intercepter, au tiers et
 *      aux deux tiers du chemin ;
 *   2. **l'entrée de la ville** — trois batteries antiaériennes qui tirent des
 *      rafales, deux dépôts de carburant et deux camions à détruire ;
 *   3. **le ciel de Capestang** — les deux hélicos de garde.
 *
 * Niveau facile (`FACILE`) : coque de 150, ennemis moins solides et moins
 * précis, un peu de coque rendue à chaque phase, dégâts de zone des missiles
 * (`helico-armes.js`). Tout ce qui se détruit passe par `ennemis` (hélicos et
 * cibles au sol) : les armes le touchent, le verrouillage le vise.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { construirePays } from './pays-scene.js?v=20260928a';
import { createHelico } from './poilhes-helico.js?v=20260928b';

export const FACILE = {
  coque: 150,
  reparation: 35,                    // coque rendue à la fin de chaque phase
};
export const MISSION = {
  heure: 17.2,
  depart: 'poilhes',                 // on décolle du village…
  cible: 'capestang',                // … pour libérer celui-ci
  // Arnaud, 28/09/2026 : « plus proche des ennemis au départ de l'action ».
  // On part au milieu de la campagne (55 % du chemin Poilhes → Capestang,
  // ~1,8 km de la ville) et la 1re vague surgit presque aussitôt.
  departChemin: 0.55,                // part du chemin Poilhes → Capestang où l'on décolle
  vagues: [0.04, 0.4],               // part du trajet (depuis le départ) où surgit chaque vague
  parVague: 2,
  entree: 520,                       // m du centre de Capestang : la ligne de défense
  approche: 1300,                    // m : la garde de Capestang nous repère à cette distance
};
const ENNEMI = {
  modeles: [
    { fichier: 'assets/fun/helico-ennemi-1.glb?v=1', nom: 'Faucon noir' },
    { fichier: 'assets/fun/helico-ennemi-2.glb?v=1', nom: 'Ombre du désert' },
  ],
  longueur: 15, vie: 70, rayon: 6.5,
  vitesse: 34, altitude: 75, rayonPatrouille: 260, rayonCombat: 200,
  tir: { portee: 700, cadence: 7, rafale: [4, 7], pause: [3.5, 5.5], vitesse: 420, dispersion: 0.065, degats: 1.5 },
};
const DCA = {
  vie: 60, rayon: 5, portee: 900,
  tir: { cadence: 6, rafale: [4, 6], pause: [2.8, 4.2], vitesse: 520, dispersion: 0.08, degats: 1.5 },
};
const PHASES = [
  { id: 'trajet', texte: 'Vole jusqu’à Capestang' },
  { id: 'defense', texte: 'Détruis la défense de l’entrée' },
  { id: 'ciel', texte: 'Abats les hélicos ennemis' },
];

const aleatoire = (a, b) => a + Math.random() * (b - a);

/**
 * @param {object} o
 * @param {HTMLElement} o.conteneur   où mettre le canvas (#scene)
 * @param {(f:number,msg:string)=>void} [o.progression]
 * @param {()=>void} [o.retourAccueil]
 */
export async function lancerMission({ conteneur, progression = () => {}, retourAccueil = () => {} }) {
  // ── moteur ──────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  conteneur.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xc9dcec, 0.00015);
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 9000);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  const keys = new Set();
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const decor = await construirePays({ scene, renderer, camera, onProgress: progression });
  decor.setTime(MISSION.heure);
  const village = (nom) => decor.villages.find((v) => (v.village || v.nom || '').toLowerCase().startsWith(nom)) || decor.villages[0];
  const dep = village(MISSION.depart), arr = village(MISSION.cible);
  const plancher = (x, z) => Math.max(decor.groundAt(x, z), decor.surfaceAt(x, z));
  /** Un point dégagé (ni toit ni houppier) près de (x, z), en spirale. */
  function degage(x, z, rayon = 120, demi = 7) {
    for (let r = 0; r <= rayon; r += 6) {
      for (let a = 0; a < Math.PI * 2; a += r ? 6 / r : 7) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        let libre = true;
        for (const [dx, dz] of [[0, 0], [demi, 0], [-demi, 0], [0, demi], [0, -demi]]) {
          if (decor.surfaceAt(px + dx, pz + dz) > decor.groundAt(px + dx, pz + dz) + 0.4) { libre = false; break; }
        }
        if (libre) return [px, pz];
      }
    }
    return [x, z];
  }

  // Ombres autour du joueur (le pays fait 8 km : on recadre, comme pays-world).
  const sun = decor.sun, sunDir = decor.sunDir;
  {
    const c = sun.shadow.camera;
    c.left = -420; c.right = 420; c.top = 420; c.bottom = -420; c.far = 2200;
    c.updateProjectionMatrix();
  }

  // ── le joueur ───────────────────────────────────────────────────────────
  const helico = createHelico({ scene, camera, groundAt: decor.groundAt, surfaceAt: decor.surfaceAt, keys, renderer });
  const versCap = Math.atan2(-(arr.x - dep.x), -(arr.z - dep.z));
  const k0 = MISSION.departChemin;
  const [x0, z0] = degage(dep.x + (arr.x - dep.x) * k0, dep.z + (arr.z - dep.z) * k0);
  helico.root.position.set(x0, plancher(x0, z0), z0);
  helico.root.rotation.y = versCap;
  camera.position.set(x0 + Math.sin(versCap) * 30, plancher(x0, z0) + 14, z0 + Math.cos(versCap) * 30);
  helico.enter();
  const joueur = { coque: FACILE.coque, vivant: true };
  const trajet = Math.hypot(arr.x - x0, arr.z - z0);
  // l'axe Poilhes → Capestang, unitaire, et sa perpendiculaire
  const ax = (arr.x - x0) / trajet, az = (arr.z - z0) / trajet, px = -az, pz = ax;

  // ── les ennemis : tout ce qui se détruit ────────────────────────────────
  progression(0.97, 'Ennemis…');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const modeles = await Promise.all(ENNEMI.modeles.map((m) => loader.loadAsync(m.fichier).then((g) => preparerModele(g.scene, ENNEMI.longueur)).catch(() => null)));
  const ennemis = [];
  helico.setCiblesAir(() => ennemis);
  const ui = monterInterface();

  function toucher(degats) {
    if (!this.vivante) return;
    this.vie -= degats; this.flash = 0.12;
    if (this.etat === 'patrouille') this.etat = 'combat';
    if (this.vie <= 0) detruire(this);
  }

  /** Un hélicoptère ennemi. `groupe` : 'vague1', 'vague2' ou 'garde'. */
  function creerHelico(k, x, z, groupe, etat = 'combat') {
    const corps = modeles[k % modeles.length];
    if (!corps) return null;
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    root.add(corps.clone(true));
    const disque = new THREE.Mesh(new THREE.CircleGeometry(ENNEMI.longueur * 0.42, 40),
      new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    disque.rotation.x = -Math.PI / 2;
    disque.position.y = new THREE.Box3().setFromObject(root).max.y - 0.3;
    root.add(disque);
    scene.add(root);
    root.position.set(x, plancher(x, z) + ENNEMI.altitude, z);
    const e = {
      sorte: 'helico', groupe, nom: ENNEMI.modeles[k % ENNEMI.modeles.length].nom, root, disque,
      position: root.position, rayon: ENNEMI.rayon, vie: ENNEMI.vie, vieMax: ENNEMI.vie, vivante: true, etat,
      angle: Math.random() * Math.PI * 2, cap: 0, v: new THREE.Vector3(), vy: 0, tourne: 0,
      rafaleReste: 0, prochainTir: aleatoire(1.5, 3.5), prochaineBalle: 0,
      orbite: Math.random() < 0.5 ? 1 : -1, flash: 0, toucher, marqueur: ui.marqueur('helico'),
    };
    ennemis.push(e);
    return e;
  }

  // les hélicos de garde, au-dessus de Capestang
  [0, 1].forEach((k) => {
    const a = k * Math.PI;
    creerHelico(k, arr.x + Math.cos(a) * ENNEMI.rayonPatrouille, arr.z + Math.sin(a) * ENNEMI.rayonPatrouille, 'garde', 'patrouille');
  });

  // ── la défense de l'entrée : batteries antiaériennes, dépôts, camions ───
  const entree = { x: arr.x - ax * MISSION.entree, z: arr.z - az * MISSION.entree };
  const matKaki = new THREE.MeshStandardMaterial({ color: 0x4d5436, roughness: 0.8 });
  const matSombre = new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 0.7, metalness: 0.3 });
  const matCuve = new THREE.MeshStandardMaterial({ color: 0xb8b2a2, roughness: 0.55, metalness: 0.2 });
  const matRouge = new THREE.MeshStandardMaterial({ color: 0xa4231b, roughness: 0.6 });
  function poserAuSol(objet, x, z, cap = 0) {
    const [gx, gz] = degage(x, z, 60, 5);
    objet.position.set(gx, decor.groundAt(gx, gz), gz);
    objet.rotation.y = cap;
    objet.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(objet);
    return objet;
  }
  function cibleSol(sorte, nom, objet, vie, rayon, extra = {}) {
    const centre = new THREE.Vector3();
    const e = {
      sorte, groupe: 'defense', nom, root: objet, position: centre, rayon, vie, vieMax: vie, vivante: true,
      etat: 'garde', flash: 0, toucher, marqueur: ui.marqueur(sorte === 'dca' ? 'dca' : 'sol'),
      rafaleReste: 0, prochainTir: aleatoire(1, 3), prochaineBalle: 0, ...extra,
    };
    centre.copy(objet.position).add(new THREE.Vector3(0, 1.8, 0));
    ennemis.push(e);
    return e;
  }
  // trois batteries : au milieu de la route et de part et d'autre
  [-70, 0, 70].forEach((d, k) => {
    const g = new THREE.Group();
    const socle = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.0, 1.2, 16), matKaki);
    socle.position.y = 0.6; g.add(socle);
    const tourelle = new THREE.Group(); tourelle.position.y = 1.2; g.add(tourelle);
    const caisse = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.6, 2.6), matKaki);
    caisse.position.y = 0.8; tourelle.add(caisse);
    const berceau = new THREE.Group(); berceau.position.set(0, 1.4, -0.6); tourelle.add(berceau);
    for (const s of [-0.45, 0.45]) {
      const canon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 4.2, 10), matSombre);
      canon.rotation.x = Math.PI / 2; canon.position.set(s, 0, -2.0); berceau.add(canon);
    }
    poserAuSol(g, entree.x + px * d, entree.z + pz * d, versCap);
    cibleSol('dca', `Batterie ${k + 1}`, g, DCA.vie, DCA.rayon, { tourelle, berceau });
  });
  // deux dépôts de carburant, derrière la ligne
  [-35, 35].forEach((d, k) => {
    const g = new THREE.Group();
    const cuve = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 7.5, 18), matCuve);
    cuve.rotation.z = Math.PI / 2; cuve.position.y = 2.6; g.add(cuve);
    const bande = new THREE.Mesh(new THREE.CylinderGeometry(2.45, 2.45, 0.8, 18), matRouge);
    bande.rotation.z = Math.PI / 2; bande.position.y = 2.6; g.add(bande);
    for (const s of [-2.6, 2.6]) {
      const pied = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.4, 3.6), matSombre);
      pied.position.set(s, 0.7, 0); g.add(pied);
    }
    poserAuSol(g, entree.x + ax * 60 + px * d, entree.z + az * 60 + pz * d, versCap + Math.PI / 2);
    cibleSol('sol', `Dépôt ${k + 1}`, g, 40, 5.5);
  });
  // deux camions, sur la route de l'entrée
  [-18, 18].forEach((d, k) => {
    const g = new THREE.Group();
    const cabine = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.2), matKaki);
    cabine.position.set(0, 1.7, -2.6); g.add(cabine);
    const plateau = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.2, 5.2), matKaki);
    plateau.position.set(0, 1.7, 1.2); g.add(plateau);
    const bache = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 5.2, 12, 1, false, 0, Math.PI), matSombre);
    bache.rotation.x = Math.PI / 2; bache.rotation.z = Math.PI / 2; bache.position.set(0, 2.8, 1.2); g.add(bache);
    for (const [rx, rz] of [[-1.25, -2.4], [1.25, -2.4], [-1.25, 1.6], [1.25, 1.6], [-1.25, 3.0], [1.25, 3.0]]) {
      const roue = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 12), matSombre);
      roue.rotation.z = Math.PI / 2; roue.position.set(rx, 0.55, rz); g.add(roue);
    }
    poserAuSol(g, entree.x - ax * 25 + px * d, entree.z - az * 25 + pz * d, versCap);
    cibleSol('sol', `Camion ${k + 1}`, g, 30, 4.5);
  });

  // ── les tirs ennemis : traçantes rouges ─────────────────────────────────
  const geoBalle = new THREE.BoxGeometry(0.28, 0.28, 9);
  const matBalle = new THREE.MeshBasicMaterial({ color: 0xff4020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const balles = Array.from({ length: 120 }, () => {
    const m = new THREE.Mesh(geoBalle, matBalle);
    m.visible = false; m.frustumCulled = false; scene.add(m);
    return { m, v: new THREE.Vector3(), vie: 0, degats: 0 };
  });
  let prochaine = 0;
  const tmp = new THREE.Vector3(), vise = new THREE.Vector3(), cible = new THREE.Vector3();
  function tirer(depuis, tir) {
    const b = balles[prochaine]; prochaine = (prochaine + 1) % balles.length;
    b.m.position.copy(depuis);
    // on vise le joueur là où il sera, avec une dispersion
    const p = helico.root.position;
    const d = b.m.position.distanceTo(p);
    const t = d / tir.vitesse;
    vise.set(p.x + vitJoueur.x * t, p.y + 1.5, p.z + vitJoueur.z * t).sub(b.m.position).normalize();
    const s = tir.dispersion;
    vise.x += aleatoire(-s, s); vise.y += aleatoire(-s, s); vise.z += aleatoire(-s, s);
    vise.normalize();
    b.v.copy(vise).multiplyScalar(tir.vitesse);
    b.m.lookAt(tmp.copy(b.m.position).add(vise));
    b.vie = 1100 / tir.vitesse;
    b.degats = tir.degats;
    b.m.visible = true;
    if (window.RaphaelFighterCannon && d < 350 && Math.random() < 0.3) window.RaphaelFighterCannon.fireShot();
  }

  function detruire(e) {
    e.vivante = false;
    helico.exploser(e.position.clone());
    if (e.sorte === 'helico') { e.etat = 'chute'; e.vy = 2; }
    else {
      e.etat = 'detruit';
      // l'épave : noircie, affaissée, et qui fume
      e.root.traverse((o) => { if (o.isMesh) o.material = matEpave; });
      e.root.scale.y = 0.55;
      e.fumeLongtemps = 25;
    }
    annoncer(`${e.nom} ${e.sorte === 'helico' ? 'abattu' : 'détruit'} !`, 'bon');
  }
  const matEpave = new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 1 });

  // ── état de la mission ──────────────────────────────────────────────────
  let phase = 0, fini = false, chrono = 0;
  const vitJoueur = new THREE.Vector3(), avantJoueur = new THREE.Vector3();
  const vaguesLancees = MISSION.vagues.map(() => false);

  function annoncer(texte, genre = '') {
    ui.annonce.textContent = texte;
    ui.annonce.className = 'annonce ' + genre;
    ui.annonce.style.opacity = '1';
    clearTimeout(ui.annonceT);
    ui.annonceT = setTimeout(() => { ui.annonce.style.opacity = '0'; }, 2600);
  }
  annoncer('Prise d’assaut de Capestang — décolle !');

  function blesser(degats) {
    if (!joueur.vivant || fini) return;
    joueur.coque = Math.max(0, joueur.coque - degats);
    ui.flash.style.opacity = '0.45';
    setTimeout(() => { ui.flash.style.opacity = '0'; }, 90);
    if (joueur.coque <= 0) {
      joueur.vivant = false;
      helico.exploser(helico.root.position.clone());
      helico.exit();
      terminer(false);
    }
  }
  function reparer() {
    joueur.coque = Math.min(FACILE.coque, joueur.coque + FACILE.reparation);
  }

  function terminer(victoire) {
    fini = true;
    const temps = formatTemps(chrono);
    let record = null;
    if (victoire) {
      try {
        const avant = +localStorage.getItem('mission-capestang-record-2') || 0;
        if (!avant || chrono < avant) localStorage.setItem('mission-capestang-record-2', String(chrono));
        record = formatTemps(Math.min(avant || chrono, chrono));
      } catch { /* navigation privée */ }
    }
    const abattus = ennemis.filter((e) => !e.vivante).length;
    ui.fin.innerHTML = victoire
      ? `<h2>Capestang est prise !</h2><p>Défense de l’entrée rasée, ciel dégagé : ${abattus} objectifs détruits.</p>
         <p class="chiffres">Temps <b>${temps}</b>${record ? ` · record <b>${record}</b>` : ''} · coque <b>${Math.round(joueur.coque / FACILE.coque * 100)} %</b></p>`
      : `<h2>Abattu…</h2><p>La prise de Capestang attendra — ${abattus} objectifs détruits.</p><p class="chiffres">Temps <b>${temps}</b></p>`;
    const boutons = document.createElement('div');
    boutons.className = 'boutons';
    const rejouer = document.createElement('button'); rejouer.textContent = 'Rejouer';
    rejouer.onclick = () => location.reload();
    const accueil = document.createElement('button'); accueil.textContent = 'Accueil';
    accueil.onclick = retourAccueil;
    boutons.append(rejouer, accueil);
    ui.fin.append(boutons);
    ui.fin.hidden = false;
  }

  // ── la boucle ───────────────────────────────────────────────────────────
  const horloge = new THREE.Clock();
  const foyer = new THREE.Vector3(), texel = (2 * 420) / sun.shadow.mapSize.x;
  const avantPos = new THREE.Vector3().copy(helico.root.position);
  let fumeeT = 0;
  function image() {
    requestAnimationFrame(image);
    const dt = Math.min(0.05, horloge.getDelta());
    if (!fini) chrono += dt;
    helico.update(dt);
    const p = helico.root.position;
    vitJoueur.copy(p).sub(avantPos).divideScalar(Math.max(dt, 1e-3));
    avantPos.copy(p);
    avantJoueur.set(-Math.sin(helico.root.rotation.y), 0, -Math.cos(helico.root.rotation.y));

    // les vagues du trajet : elles surgissent devant, entre le joueur et Capestang
    const fait = 1 - Math.hypot(p.x - arr.x, p.z - arr.z) / trajet;
    MISSION.vagues.forEach((f, i) => {
      if (vaguesLancees[i] || fait < f || !joueur.vivant) return;
      vaguesLancees[i] = true;
      for (let k = 0; k < MISSION.parVague; k++) {
        const cote = k % 2 ? 1 : -1;
        creerHelico(i + k, p.x + ax * 650 + px * cote * 160, p.z + az * 650 + pz * cote * 160, `vague${i + 1}`);
      }
      annoncer(`Interception ! ${MISSION.parVague} hélicos en approche`, 'alerte');
    });
    // les phases
    const vivants = (f) => ennemis.filter((e) => e.vivante && f(e)).length;
    const dEntree = Math.hypot(p.x - entree.x, p.z - entree.z);
    if (phase === 0 && (dEntree < 900 || vivants((e) => e.groupe === 'defense') < 7)) {
      phase = 1; annoncer('La défense de l’entrée ! Batteries antiaériennes', 'alerte');
    }
    if (phase === 1 && vivants((e) => e.groupe === 'defense') === 0) {
      phase = 2; reparer(); annoncer('Défense rasée ! Réparations — la garde décolle', 'bon');
      for (const e of ennemis) if (e.groupe === 'garde' && e.etat === 'patrouille') e.etat = 'combat';
    }
    for (const e of ennemis) {
      if (e.sorte === 'helico') {
        if (e.etat === 'patrouille' && joueur.vivant && e.position.distanceTo(p) < MISSION.approche && phase >= 2) e.etat = 'combat';
        piloterHelico(e, dt, p);
      } else piloterSol(e, dt, p);
      if (e.fumeLongtemps > 0) {
        e.fumeLongtemps -= dt; e.fumeT = (e.fumeT || 0) - dt;
        if (e.fumeT <= 0) { e.fumeT = 0.25; fumerNoir(e.position); }
      }
    }
    // une vague entièrement abattue : un peu de coque rendue
    MISSION.vagues.forEach((f, i) => {
      const g = `vague${i + 1}`;
      if (!vaguesLancees[i] || ennemis.some((e) => e.groupe === g && e.vivante)) return;
      if (!ennemis.some((e) => e.groupe === g && e.repare)) {
        ennemis.filter((e) => e.groupe === g).forEach((e) => { e.repare = true; });
        reparer();
      }
    });
    if (!fini && phase === 2 && ennemis.every((e) => e.etat === 'detruit' || (!e.vivante && e.sorte !== 'helico'))) terminer(true);

    // balles ennemies
    for (const b of balles) {
      if (b.vie <= 0) continue;
      b.vie -= dt;
      for (let k = 0; k < 4; k++) {
        b.m.position.addScaledVector(b.v, dt / 4);
        if (joueur.vivant && b.m.position.distanceTo(cible.copy(p).add(tmp.set(0, 1.5, 0))) < 4.2) {
          blesser(b.degats); b.vie = 0; break;
        }
        if (b.m.position.y < plancher(b.m.position.x, b.m.position.z)) { b.vie = 0; break; }
      }
      if (b.vie <= 0) b.m.visible = false;
    }

    // le décor
    decor.tick(dt);
    decor.sky.position.copy(camera.position);
    foyer.set(Math.round(camera.position.x / texel) * texel, 0, Math.round(camera.position.z / texel) * texel);
    foyer.y = decor.groundAt(foyer.x, foyer.z);
    sun.target.position.copy(foyer);
    sun.position.copy(foyer).addScaledVector(sunDir, 900);

    majInterface(fait);
    renderer.render(scene, camera);
  }

  function clignoter(e, dt) {
    if (e.flash > 0) { e.flash -= dt; e.root.children[0].visible = Math.floor(e.flash * 40) % 2 === 0; }
    else if (e.root.children[0]) e.root.children[0].visible = true;
  }

  function rafale(e, dt, pret, depuis, tir) {
    e.prochainTir -= dt;
    if (e.rafaleReste > 0) {
      e.prochaineBalle -= dt;
      if (e.prochaineBalle <= 0) { tirer(depuis, tir); e.rafaleReste--; e.prochaineBalle = 1 / tir.cadence; }
    } else if (e.prochainTir <= 0 && pret) {
      e.rafaleReste = Math.round(aleatoire(...tir.rafale));
      e.prochainTir = aleatoire(...tir.pause);
    }
  }

  function piloterSol(e, dt, p) {
    if (!e.vivante || e.sorte !== 'dca') { if (e.vivante) clignoter(e, dt); return; }
    clignoter(e, dt);
    const d = e.position.distanceTo(p);
    if (!joueur.vivant || fini || d > DCA.portee) return;
    // la tourelle suit le joueur, le berceau lève les canons
    const cap = Math.atan2(-(p.x - e.position.x), -(p.z - e.position.z)) - e.root.rotation.y;
    let ec = cap - e.tourelle.rotation.y; ec = Math.atan2(Math.sin(ec), Math.cos(ec));
    e.tourelle.rotation.y += ec * Math.min(1, dt * 2);
    const site = Math.atan2(p.y - e.position.y, Math.hypot(p.x - e.position.x, p.z - e.position.z));
    e.berceau.rotation.x += (Math.max(0, site) - e.berceau.rotation.x) * Math.min(1, dt * 2);
    e.berceau.getWorldPosition(tmp);
    rafale(e, dt, Math.abs(ec) < 0.3, tmp, DCA.tir);
  }

  function piloterHelico(e, dt, p) {
    e.disque.rotation.z += dt * 30;
    if (e.etat === 'detruit') return;
    if (e.etat === 'chute') {
      // il tombe en tournoyant, fume, et s'écrase
      e.vy -= 9.8 * dt;
      e.position.y += e.vy * dt;
      e.position.addScaledVector(e.v, dt);
      e.v.multiplyScalar(1 - dt * 0.4);
      e.cap += dt * 5;
      e.root.rotation.set(0.35, e.cap, 0.5);
      fumeeT -= dt;
      if (fumeeT <= 0) { fumeeT = 0.08; fumerNoir(e.position); }
      if (e.position.y <= plancher(e.position.x, e.position.z) + 1) {
        helico.exploser(e.position.clone());
        e.etat = 'detruit';
        e.root.visible = false;
      }
      return;
    }
    let cx, cz, alt;
    if (e.etat === 'patrouille' || !joueur.vivant) {
      e.angle += (ENNEMI.vitesse * 0.45 / ENNEMI.rayonPatrouille) * dt;
      cx = arr.x + Math.cos(e.angle) * ENNEMI.rayonPatrouille;
      cz = arr.z + Math.sin(e.angle) * ENNEMI.rayonPatrouille;
      alt = plancher(cx, cz) + ENNEMI.altitude;
    } else {
      // combat : il tourne autour du joueur, à distance de tir
      e.angle += e.orbite * (ENNEMI.vitesse * 0.55 / ENNEMI.rayonCombat) * dt;
      cx = p.x + Math.cos(e.angle) * ENNEMI.rayonCombat;
      cz = p.z + Math.sin(e.angle) * ENNEMI.rayonCombat;
      alt = Math.max(plancher(cx, cz) + 35, p.y + 8 + Math.sin(e.angle * 2) * 12);
    }
    tmp.set(cx - e.position.x, 0, cz - e.position.z);
    const d = tmp.length();
    const vVoulue = Math.min(ENNEMI.vitesse, d * 0.6);
    if (d > 0.1) tmp.multiplyScalar(vVoulue / d);
    e.v.lerp(tmp, 1 - Math.exp(-1.5 * dt));
    e.position.addScaledVector(e.v, dt);
    e.position.y += (alt - e.position.y) * (1 - Math.exp(-1.2 * dt));
    e.position.y = Math.max(e.position.y, plancher(e.position.x, e.position.z) + 12);
    const visee = e.etat === 'combat' && joueur.vivant;
    const capVoulu = visee ? Math.atan2(-(p.x - e.position.x), -(p.z - e.position.z)) : Math.atan2(-e.v.x, -e.v.z);
    let ec = capVoulu - e.cap; ec = Math.atan2(Math.sin(ec), Math.cos(ec));
    e.tourne = ec;
    e.cap += ec * Math.min(1, dt * 2.2);
    const penche = Math.max(-0.35, Math.min(0.35, e.v.length() / ENNEMI.vitesse * 0.25));
    e.root.rotation.set(-penche * 0.8, e.cap, -e.tourne * 0.3);
    clignoter(e, dt);
    if (!visee || fini) return;
    tmp.copy(e.position).add(cible.set(0, 1, 0));
    rafale(e, dt, e.position.distanceTo(p) < ENNEMI.tir.portee && Math.abs(ec) < 0.4, tmp, ENNEMI.tir);
  }

  // fumée noire des épaves
  const texFumee = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(30,30,30,.9)'); r.addColorStop(1, 'rgba(30,30,30,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const fumees = Array.from({ length: 140 }, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFumee, transparent: true, depthWrite: false, opacity: 0 }));
    s.visible = false; scene.add(s);
    return { s, vie: 0 };
  });
  let prochaineFumee = 0;
  function fumerNoir(pos) {
    const f = fumees[prochaineFumee]; prochaineFumee = (prochaineFumee + 1) % fumees.length;
    f.s.position.copy(pos); f.vie = 2.2; f.s.visible = true;
  }
  setInterval(() => {
    for (const f of fumees) {
      if (f.vie <= 0) continue;
      f.vie -= 0.05;
      const k = Math.max(0, f.vie / 2.2);
      f.s.material.opacity = 0.7 * k;
      const t = 3 + (1 - k) * 12; f.s.scale.set(t, t, 1);
      f.s.position.y += 0.15;
      if (f.vie <= 0) f.s.visible = false;
    }
  }, 50);

  // ── HUD ─────────────────────────────────────────────────────────────────
  const proj = new THREE.Vector3();
  function majInterface(fait) {
    const ph = PHASES[phase];
    const restant = (f) => ennemis.filter((e) => e.vivante && f(e)).length;
    const detail = phase === 0
      ? `${(Math.max(0, 1 - fait) * trajet / 1000).toFixed(1).replace('.', ',')} km`
      : phase === 1
        ? `${restant((e) => e.sorte === 'dca')} batterie${restant((e) => e.sorte === 'dca') > 1 ? 's' : ''} · ${restant((e) => e.sorte === 'sol')} cible${restant((e) => e.sorte === 'sol') > 1 ? 's' : ''}`
        : `${restant((e) => e.sorte === 'helico')} hélico${restant((e) => e.sorte === 'helico') > 1 ? 's' : ''}`;
    ui.objectif.innerHTML = `<small>Phase ${phase + 1}/3</small><b>${ph.texte}</b><span>${detail}</span>`;
    // la flèche : vers Capestang, puis vers l'entrée
    const but = phase === 0 ? entree : arr;
    const versC = Math.atan2(but.x - helico.root.position.x, but.z - helico.root.position.z);
    const nez = Math.atan2(avantJoueur.x, avantJoueur.z);
    ui.fleche.style.transform = `rotate(${(-(versC - nez) * 180 / Math.PI).toFixed(1)}deg)`;
    ui.fleche.style.display = phase < 2 ? 'block' : 'none';
    ui.coque.style.width = `${joueur.coque / FACILE.coque * 100}%`;
    const k = joueur.coque / FACILE.coque;
    ui.coque.style.background = k > 0.5 ? '#5fd35f' : k > 0.25 ? '#ffcf4a' : '#ff4a3a';
    const t = helico.telemetrie ? helico.telemetrie() : null;
    ui.tele.textContent = t ? `${t.vitesse} km/h · ${t.hauteur} m sol · ${formatTemps(chrono)}` : formatTemps(chrono);
    // les marqueurs
    const verrou = helico.verrou ? helico.verrou() : null;
    for (const e of ennemis) {
      const m = e.marqueur;
      const dist = e.position.distanceTo(helico.root.position);
      // au sol : on ne les montre qu'à l'approche, sinon ils encombrent le trajet
      if (!e.vivante || !joueur.vivant || (e.sorte !== 'helico' && dist > 2200)) { m.style.display = 'none'; continue; }
      proj.copy(e.position).project(camera);
      const devant = proj.z < 1;
      let x = (proj.x * 0.5 + 0.5) * innerWidth, y = (-proj.y * 0.5 + 0.5) * innerHeight;
      if (!devant) { x = innerWidth - x; y = innerHeight - 40; }
      x = Math.max(30, Math.min(innerWidth - 30, x)); y = Math.max(30, Math.min(innerHeight - 30, y));
      m.style.display = 'block';
      m.style.transform = `translate(${x - 22}px, ${y - 22}px)`;
      m.classList.toggle('verrou', e === verrou);
      m.querySelector('i').textContent = `${Math.round(dist)} m`;
      m.querySelector('b').style.width = `${Math.max(0, e.vie / e.vieMax * 100)}%`;
    }
  }

  requestAnimationFrame(image);
  progression(1, 'Prêt');
  return { helico, ennemis, decor, joueur, get phase() { return phase; } };
}

// ─────────────────────────────── outils
function formatTemps(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Met le modèle à la bonne taille, les patins à zéro et le nez vers −z. Le nez
 * d'un hélicoptère : le bout de l'axe long qui porte le plus de matière (cabine,
 * canon, roquettes) ; l'autre bout n'est qu'une poutre de queue et une dérive.
 */
function preparerModele(objet, longueur) {
  objet.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    if (o.material && o.material.metalness > 0.6) { o.material.metalness = 0.35; o.material.roughness = 0.5; }
  });
  objet.updateMatrixWorld(true);
  let b = new THREE.Box3().setFromObject(objet, true);
  const longX = (b.max.x - b.min.x) > (b.max.z - b.min.z);
  const c = b.getCenter(new THREE.Vector3());
  const demi = (longX ? b.max.x - b.min.x : b.max.z - b.min.z) / 2;
  const v = new THREE.Vector3();
  let plus = 0, moins = 0;
  objet.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const a = (longX ? v.x - c.x : v.z - c.z) / demi;
      // on ne compte que la moitié basse : les pales, en haut, s'étendent des deux côtés
      if (v.y > c.y) continue;
      if (a > 0.35) plus++; else if (a < -0.35) moins++;
    }
  });
  const nezPositif = plus > moins;
  objet.rotation.y = longX ? (nezPositif ? Math.PI / 2 : -Math.PI / 2) : (nezPositif ? Math.PI : 0);
  const g = new THREE.Group();
  g.add(objet);
  g.updateMatrixWorld(true);
  b = new THREE.Box3().setFromObject(g, true);
  const t = b.getSize(new THREE.Vector3());
  g.scale.setScalar(longueur / Math.max(t.x, t.z));
  g.updateMatrixWorld(true);
  b = new THREE.Box3().setFromObject(g, true);
  const cc = b.getCenter(new THREE.Vector3());
  g.position.set(-cc.x, -b.min.y, -cc.z);
  return g;
}

function monterInterface() {
  const style = document.createElement('style');
  style.textContent = `
  #mission-ui { position: fixed; inset: 0; pointer-events: none; font: 14px system-ui, sans-serif; color: #fff; z-index: 6; }
  #mission-ui .objectif { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); padding: 10px 18px;
    background: rgba(14,18,26,.78); border: 1px solid rgba(255,207,74,.5); border-radius: 12px; display: flex; gap: 14px;
    align-items: center; backdrop-filter: blur(8px); white-space: nowrap; }
  #mission-ui .objectif small { color: #c9d1dc; font-size: 11px; text-transform: uppercase; letter-spacing: .6px; }
  #mission-ui .objectif b { font-size: 16px; }
  #mission-ui .objectif span { color: #ffcf4a; font-weight: 700; font-variant-numeric: tabular-nums; }
  #mission-ui .fleche { position: absolute; top: 74px; left: 50%; width: 0; height: 0; margin-left: -14px;
    border-left: 14px solid transparent; border-right: 14px solid transparent; border-bottom: 30px solid #ffcf4a;
    transform-origin: 14px 20px; filter: drop-shadow(0 2px 4px rgba(0,0,0,.6)); }
  #mission-ui .bord { position: absolute; left: 16px; bottom: 16px; width: 280px; padding: 10px 12px;
    background: rgba(14,18,26,.78); border-radius: 12px; backdrop-filter: blur(8px); }
  #mission-ui .bord .jauge { height: 10px; background: rgba(255,255,255,.12); border-radius: 5px; overflow: hidden; margin: 6px 0; }
  #mission-ui .bord .jauge i { display: block; height: 100%; width: 100%; background: #5fd35f; transition: width .15s; }
  #mission-ui .bord small { color: #c9d1dc; }
  #mission-ui .aide { position: absolute; right: 16px; bottom: 16px; max-width: 360px; padding: 9px 12px; font-size: 12px;
    background: rgba(14,18,26,.7); border-radius: 12px; color: #d9dfe8; line-height: 1.45; }
  #mission-ui .aide b { color: #fff; }
  #mission-ui .marqueur { position: absolute; left: 0; top: 0; width: 44px; height: 44px; display: none;
    border: 2px solid rgba(255,90,60,.9); border-radius: 6px; }
  #mission-ui .marqueur.dca { border-color: rgba(255,150,40,.95); border-radius: 50%; }
  #mission-ui .marqueur.sol { border-color: rgba(255,210,90,.9); border-style: dashed; }
  #mission-ui .marqueur.verrou { border-color: #ffcf4a; box-shadow: 0 0 12px rgba(255,207,74,.8); border-width: 3px; border-style: solid; }
  #mission-ui .marqueur i { position: absolute; top: 52px; left: 50%; transform: translateX(-50%); white-space: nowrap;
    font-style: normal; font-size: 12px; font-weight: 700; color: #ff9a80; text-shadow: 0 1px 3px #000; }
  #mission-ui .marqueur.verrou i { color: #ffcf4a; }
  #mission-ui .marqueur .vie { position: absolute; top: 46px; left: 4px; right: 4px; height: 3px; background: rgba(0,0,0,.5); }
  #mission-ui .marqueur .vie b { display: block; height: 100%; background: #ff5a3c; }
  #mission-ui .annonce { position: absolute; top: 34%; left: 50%; transform: translateX(-50%); font-size: clamp(22px, 3.2vw, 38px);
    font-weight: 900; text-shadow: 0 3px 12px rgba(0,0,0,.8); transition: opacity .5s; opacity: 0; text-align: center; }
  #mission-ui .annonce.bon { color: #ffcf4a; }
  #mission-ui .annonce.alerte { color: #ff6a50; }
  #mission-ui .flash { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 40%, rgba(255,30,20,.9));
    opacity: 0; transition: opacity .12s; }
  #mission-ui .fin { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: auto; text-align: center;
    background: rgba(14,18,26,.92); border: 1px solid rgba(255,207,74,.6); border-radius: 18px; padding: 26px 34px; min-width: 320px; }
  #mission-ui .fin[hidden] { display: none; }
  #mission-ui .fin h2 { margin: 0 0 8px; font-size: 28px; color: #ffcf4a; }
  #mission-ui .fin .chiffres b { color: #ffcf4a; }
  #mission-ui .fin .boutons { display: flex; gap: 10px; justify-content: center; margin-top: 14px; }
  #mission-ui .fin button { font: 700 15px system-ui; padding: 10px 22px; border-radius: 12px; border: 1px solid #ffcf4a;
    background: #ffcf4a; color: #1b1600; cursor: pointer; }
  #mission-ui .fin button + button { background: transparent; color: #ffcf4a; }
  @media (max-width: 640px) { #mission-ui .aide { display: none; } #mission-ui .bord { width: calc(100vw - 32px); } }
  `;
  document.head.appendChild(style);
  const racine = document.createElement('div');
  racine.id = 'mission-ui';
  racine.innerHTML = `
    <div class="flash"></div>
    <div class="objectif"></div>
    <div class="fleche"></div>
    <div class="annonce"></div>
    <div class="bord"><small>Coque · niveau facile</small><div class="jauge"><i></i></div><small class="tele"></small></div>
    <div class="aide">Flèches : piloter comme l’avion · <b>Z</b> plein gaz · <b>+ / −</b> ou croix ↑ ↓ : vitesse · <b>S</b> s’arrêter · <b>E / Espace</b> monter · <b>Ctrl / C</b> descendre ·
      <b>F</b> ou clic gauche : mitrailleuse · <b>G</b> ou clic droit : missiles · molette ou stick droit : viser plus bas · <b>V</b> caméra ·
      une cible dans le cadre jaune est verrouillée : les tirs la suivent</div>
    <div class="fin" hidden></div>`;
  document.body.appendChild(racine);
  const $ = (s) => racine.querySelector(s);
  return {
    racine, objectif: $('.objectif'), fleche: $('.fleche'), annonce: $('.annonce'), flash: $('.flash'),
    coque: $('.jauge i'), tele: $('.tele'), fin: $('.fin'),
    /** Un cadre de plus : 'helico' (rouge), 'dca' (rond orange), 'sol' (tirets). */
    marqueur(genre) {
      const m = document.createElement('div');
      m.className = `marqueur ${genre}`;
      m.innerHTML = '<div class="vie"><b></b></div><i></i>';
      racine.append(m);
      return m;
    },
  };
}
