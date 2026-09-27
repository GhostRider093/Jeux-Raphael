/**
 * Mission : la prise d'assaut de Capestang (Poilhes City, 27/09/2026).
 *
 * Arnaud : « avec le jeu d'hélico, dans le même rouler.html, on va faire la
 * prise d'assaut de Capestang : on vole d'abord jusqu'à Capestang, on détruit
 * deux hélicos de combat ennemis ». Première étape d'une mission à paliers.
 *
 * Le décor est le **pays** (`pays-scene.js`) : Poilhes et Capestang à leur écart
 * réel, 4 km de campagne entre les deux. L'hélicoptère est celui du village
 * (`poilhes-helico.js`, ses commandes et ses armes) : on décolle de Poilhes.
 * Les deux ennemis sont des modèles Meshy (`assets/fun/helico-ennemi-1|2.glb`) :
 * ils patrouillent au-dessus de Capestang, et dès qu'on approche ils viennent
 * tourner autour de nous en tirant des rafales. Nos balles et nos missiles les
 * touchent quand ils sont verrouillés (cône devant le nez, `helico-armes.js`).
 *
 * Paliers (`PALIERS`) : 1. rallier Capestang ; 2. abattre les deux hélicos.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { construirePays } from './pays-scene.js';
import { createHelico } from './poilhes-helico.js?v=20260927m';

export const MISSION = {
  heure: 17.2,
  depart: 'poilhes',                 // on décolle du village…
  cible: 'capestang',                // … pour libérer celui-ci
  approche: 1300,                    // m : les ennemis nous repèrent à cette distance
  arrivee: 700,                      // m du centre de Capestang : palier 1 réussi
  coque: 100,                        // points de vie du joueur
};
const ENNEMI = {
  modeles: [
    { fichier: 'assets/fun/helico-ennemi-1.glb?v=1', nom: 'Faucon noir' },
    { fichier: 'assets/fun/helico-ennemi-2.glb?v=1', nom: 'Ombre du désert' },
  ],
  longueur: 15, vie: 100, rayon: 6.5,
  vitesse: 34, altitude: 75, rayonPatrouille: 260, rayonCombat: 190,
  // Réglé pour un combat d'une minute environ : à 3 dégâts, 0,03 de dispersion
  // et 2,2 à 3,8 s de pause, deux ennemis vidaient la coque en dix secondes.
  tir: { portee: 750, cadence: 8, rafale: [5, 8], pause: [3.0, 4.8], vitesse: 420, dispersion: 0.055, degats: 2 },
};
const PALIERS = [
  { id: 'rallier', texte: 'Vole jusqu’à Capestang' },
  { id: 'abattre', texte: 'Abats les hélicoptères ennemis' },
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

  // Ombres autour du joueur (le pays fait 8 km : on recadre, comme pays-world).
  const sun = decor.sun, sunDir = decor.sunDir;
  {
    const c = sun.shadow.camera;
    c.left = -420; c.right = 420; c.top = 420; c.bottom = -420; c.far = 2200;
    c.updateProjectionMatrix();
  }

  // ── le joueur ───────────────────────────────────────────────────────────
  const helico = createHelico({ scene, camera, groundAt: decor.groundAt, surfaceAt: decor.surfaceAt, keys, renderer });
  // on décolle du bord de Poilhes tourné vers Capestang
  const versCap = Math.atan2(-(arr.x - dep.x), -(arr.z - dep.z));
  let x0 = dep.x + (arr.x - dep.x) * 0.06, z0 = dep.z + (arr.z - dep.z) * 0.06;
  // un terrain dégagé à côté (pas un houppier, pas un toit) pour poser les patins
  cherche: for (let r = 0; r <= 120; r += 6) {
    for (let a = 0; a < Math.PI * 2; a += r ? 6 / r : 7) {
      const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
      let libre = true;
      for (const [dx, dz] of [[0, 0], [7, 0], [-7, 0], [0, 7], [0, -7]]) {
        if (decor.surfaceAt(x + dx, z + dz) > decor.groundAt(x + dx, z + dz) + 0.4) { libre = false; break; }
      }
      if (libre) { x0 = x; z0 = z; break cherche; }
    }
  }
  helico.root.position.set(x0, plancher(x0, z0), z0);
  helico.root.rotation.y = versCap;
  camera.position.set(x0 + Math.sin(versCap) * 30, plancher(x0, z0) + 14, z0 + Math.cos(versCap) * 30);
  helico.enter();
  const joueur = { coque: MISSION.coque, vivant: true };

  // ── les ennemis ─────────────────────────────────────────────────────────
  progression(0.98, 'Hélicoptères ennemis…');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const ennemis = [];
  const modeles = await Promise.all(ENNEMI.modeles.map((m) => loader.loadAsync(m.fichier).catch(() => null)));
  modeles.forEach((gltf, i) => {
    if (!gltf) return;
    const corps = preparerModele(gltf.scene, ENNEMI.longueur);
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    root.add(corps);
    // un disque flou : les pales tournent
    const disque = new THREE.Mesh(new THREE.CircleGeometry(ENNEMI.longueur * 0.42, 40),
      new THREE.MeshBasicMaterial({ color: 0x151515, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    disque.rotation.x = -Math.PI / 2;
    disque.position.y = new THREE.Box3().setFromObject(corps).max.y - 0.3;
    root.add(disque);
    scene.add(root);
    const angle = i * Math.PI;
    const e = {
      nom: ENNEMI.modeles[i].nom, root, disque, position: root.position, rayon: ENNEMI.rayon,
      vie: ENNEMI.vie, vivante: true, etat: 'patrouille', angle, cap: 0,
      v: new THREE.Vector3(), vy: 0, tourne: 0, rafaleReste: 0, prochainTir: aleatoire(1, 3), prochaineBalle: 0,
      orbite: Math.random() < 0.5 ? 1 : -1, flash: 0,
      toucher(degats) {
        if (!this.vivante) return;
        this.vie -= degats; this.flash = 0.12;
        if (this.etat === 'patrouille') this.etat = 'combat';
        if (this.vie <= 0) abattre(this);
      },
    };
    root.position.set(arr.x + Math.cos(angle) * ENNEMI.rayonPatrouille, 0, arr.z + Math.sin(angle) * ENNEMI.rayonPatrouille);
    root.position.y = plancher(root.position.x, root.position.z) + ENNEMI.altitude;
    ennemis.push(e);
  });
  helico.setCiblesAir(() => ennemis);

  // ── les tirs ennemis : traçantes rouges ─────────────────────────────────
  const geoBalle = new THREE.BoxGeometry(0.28, 0.28, 9);
  const matBalle = new THREE.MeshBasicMaterial({ color: 0xff4020, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const balles = Array.from({ length: 80 }, () => {
    const m = new THREE.Mesh(geoBalle, matBalle);
    m.visible = false; m.frustumCulled = false; scene.add(m);
    return { m, v: new THREE.Vector3(), vie: 0 };
  });
  let prochaine = 0;
  const tmp = new THREE.Vector3(), vise = new THREE.Vector3();
  function tirEnnemi(e) {
    const b = balles[prochaine]; prochaine = (prochaine + 1) % balles.length;
    b.m.position.copy(e.position).add(tmp.set(0, 1, 0));
    // on vise le joueur là où il sera, avec une dispersion
    const p = helico.root.position;
    const d = b.m.position.distanceTo(p);
    const t = d / ENNEMI.tir.vitesse;
    vise.set(p.x + vitJoueur.x * t, p.y + 1.5, p.z + vitJoueur.z * t).sub(b.m.position).normalize();
    const s = ENNEMI.tir.dispersion;
    vise.x += aleatoire(-s, s); vise.y += aleatoire(-s, s); vise.z += aleatoire(-s, s);
    vise.normalize();
    b.v.copy(vise).multiplyScalar(ENNEMI.tir.vitesse);
    b.m.lookAt(tmp.copy(b.m.position).add(vise));
    b.vie = ENNEMI.tir.portee * 1.3 / ENNEMI.tir.vitesse;
    b.m.visible = true;
    if (window.RaphaelFighterCannon && d < 350 && Math.random() < 0.35) window.RaphaelFighterCannon.fireShot();
  }

  function abattre(e) {
    e.vivante = false;
    e.etat = 'chute';
    e.vy = 2;
    helico.exploser(e.position.clone());
    annoncer(`${e.nom} abattu !`, 'bon');
  }

  // ── l'interface ─────────────────────────────────────────────────────────
  const ui = monterInterface();
  let palier = 0, fini = false, chrono = 0;
  const vitJoueur = new THREE.Vector3(), avantJoueur = new THREE.Vector3();
  let fumeeT = 0;

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

  function terminer(victoire) {
    fini = true;
    const temps = formatTemps(chrono);
    let record = null;
    if (victoire) {
      try {
        const avant = +localStorage.getItem('mission-capestang-record') || 0;
        if (!avant || chrono < avant) localStorage.setItem('mission-capestang-record', String(chrono));
        record = formatTemps(Math.min(avant || chrono, chrono));
      } catch { /* navigation privée */ }
    }
    ui.fin.innerHTML = victoire
      ? `<h2>Capestang : ciel dégagé !</h2><p>Les deux hélicoptères ennemis sont au sol.</p>
         <p class="chiffres">Temps <b>${temps}</b>${record ? ` · record <b>${record}</b>` : ''} · coque <b>${Math.round(joueur.coque)} %</b></p>`
      : `<h2>Abattu…</h2><p>La prise de Capestang attendra.</p><p class="chiffres">Temps <b>${temps}</b></p>`;
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
  function image() {
    requestAnimationFrame(image);
    const dt = Math.min(0.05, horloge.getDelta());
    if (!fini) chrono += dt;
    helico.update(dt);
    const p = helico.root.position;
    vitJoueur.copy(p).sub(avantPos).divideScalar(Math.max(dt, 1e-3));
    avantPos.copy(p);
    avantJoueur.set(-Math.sin(helico.root.rotation.y), 0, -Math.cos(helico.root.rotation.y));

    // paliers
    const dCap = Math.hypot(p.x - arr.x, p.z - arr.z);
    if (palier === 0 && dCap < MISSION.arrivee) { palier = 1; annoncer('Capestang en vue — abats les hélicos !', 'bon'); }
    for (const e of ennemis) {
      if (e.etat === 'patrouille' && joueur.vivant && e.position.distanceTo(p) < MISSION.approche) {
        e.etat = 'combat';
        if (palier === 0) { palier = 1; annoncer('Contact ! Deux hélicos ennemis', 'alerte'); }
      }
      piloterEnnemi(e, dt, p);
    }
    const restants = ennemis.filter((e) => e.vivante).length;
    if (!fini && ennemis.length && restants === 0 && ennemis.every((e) => e.etat === 'detruit')) terminer(true);

    // balles ennemies
    for (const b of balles) {
      if (b.vie <= 0) continue;
      b.vie -= dt;
      const pas = 4;
      for (let k = 0; k < pas; k++) {
        b.m.position.addScaledVector(b.v, dt / pas);
        if (joueur.vivant && b.m.position.distanceTo(tmp.copy(p).add(vise.set(0, 1.5, 0))) < 4.2) {
          blesser(ENNEMI.tir.degats); b.vie = 0; break;
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

    majInterface(dCap, restants);
    renderer.render(scene, camera);
  }

  function piloterEnnemi(e, dt, p) {
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
    // le nez : vers le joueur en combat, vers sa route en patrouille
    const visee = e.etat === 'combat' && joueur.vivant;
    const capVoulu = visee ? Math.atan2(-(p.x - e.position.x), -(p.z - e.position.z)) : Math.atan2(-e.v.x, -e.v.z);
    let ec = capVoulu - e.cap; ec = Math.atan2(Math.sin(ec), Math.cos(ec));
    e.tourne = ec;
    e.cap += ec * Math.min(1, dt * 2.2);
    const penche = Math.max(-0.35, Math.min(0.35, e.v.length() / ENNEMI.vitesse * 0.25));
    e.root.rotation.set(-penche * 0.8, e.cap, -e.tourne * 0.3);
    // le flash quand il est touché
    if (e.flash > 0) { e.flash -= dt; e.root.children[0].visible = Math.floor(e.flash * 40) % 2 === 0; }
    else e.root.children[0].visible = true;
    // tir : des rafales quand le joueur est devant et à portée
    if (!visee || fini) return;
    const dist = e.position.distanceTo(p);
    e.prochainTir -= dt;
    if (e.rafaleReste > 0) {
      e.prochaineBalle -= dt;
      if (e.prochaineBalle <= 0) { tirEnnemi(e); e.rafaleReste--; e.prochaineBalle = 1 / ENNEMI.tir.cadence; }
    } else if (e.prochainTir <= 0 && dist < ENNEMI.tir.portee && Math.abs(ec) < 0.4) {
      e.rafaleReste = Math.round(aleatoire(...ENNEMI.tir.rafale));
      e.prochainTir = aleatoire(...ENNEMI.tir.pause);
    }
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
  const fumees = Array.from({ length: 90 }, () => {
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
  function majInterface(dCap, restants) {
    const pal = PALIERS[Math.min(palier, PALIERS.length - 1)];
    ui.objectif.innerHTML = palier === 0
      ? `<b>${pal.texte}</b><span>${(dCap / 1000).toFixed(1).replace('.', ',')} km</span>`
      : `<b>${pal.texte}</b><span>${restants} restant${restants > 1 ? 's' : ''}</span>`;
    // la flèche vers Capestang, par rapport au nez
    const versC = Math.atan2(arr.x - helico.root.position.x, arr.z - helico.root.position.z);
    const nez = Math.atan2(avantJoueur.x, avantJoueur.z);
    ui.fleche.style.transform = `rotate(${(-(versC - nez) * 180 / Math.PI).toFixed(1)}deg)`;
    ui.fleche.style.display = palier === 0 ? 'block' : 'none';
    ui.coque.style.width = `${joueur.coque}%`;
    ui.coque.style.background = joueur.coque > 50 ? '#5fd35f' : joueur.coque > 25 ? '#ffcf4a' : '#ff4a3a';
    const t = helico.telemetrie ? helico.telemetrie() : null;
    ui.tele.textContent = t ? `${t.vitesse} km/h · ${t.hauteur} m sol · ${formatTemps(chrono)}` : formatTemps(chrono);
    // les marqueurs des ennemis
    const verrou = helico.verrou ? helico.verrou() : null;
    ennemis.forEach((e, i) => {
      const m = ui.marqueurs[i];
      if (!m) return;
      if (!e.vivante || !joueur.vivant) { m.style.display = 'none'; return; }
      proj.copy(e.position).project(camera);
      const devant = proj.z < 1;
      let x = (proj.x * 0.5 + 0.5) * innerWidth, y = (-proj.y * 0.5 + 0.5) * innerHeight;
      if (!devant) { x = innerWidth - x; y = innerHeight - 40; }
      x = Math.max(30, Math.min(innerWidth - 30, x)); y = Math.max(30, Math.min(innerHeight - 30, y));
      m.style.display = 'block';
      m.style.transform = `translate(${x - 26}px, ${y - 26}px)`;
      m.classList.toggle('verrou', e === verrou);
      m.querySelector('i').textContent = `${Math.round(e.position.distanceTo(helico.root.position))} m · ${Math.max(0, Math.round(e.vie))}`;
    });
  }

  requestAnimationFrame(image);
  progression(1, 'Prêt');
  return { helico, ennemis, decor, joueur };
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
    align-items: center; backdrop-filter: blur(8px); }
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
  #mission-ui .marqueur { position: absolute; left: 0; top: 0; width: 52px; height: 52px; display: none;
    border: 2px solid rgba(255,90,60,.9); border-radius: 6px; }
  #mission-ui .marqueur.verrou { border-color: #ffcf4a; box-shadow: 0 0 12px rgba(255,207,74,.8); border-width: 3px; }
  #mission-ui .marqueur i { position: absolute; top: 56px; left: 50%; transform: translateX(-50%); white-space: nowrap;
    font-style: normal; font-size: 12px; font-weight: 700; color: #ff9a80; text-shadow: 0 1px 3px #000; }
  #mission-ui .marqueur.verrou i { color: #ffcf4a; }
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
    <div class="bord"><small>Coque</small><div class="jauge"><i></i></div><small class="tele"></small></div>
    <div class="aide"><b>Z / ↑</b> avancer · <b>Q D</b> pivoter · <b>Espace</b> monter · <b>Maj / C</b> descendre ·
      <b>F</b> ou clic gauche : mitrailleuse · <b>G</b> ou clic droit : missiles · <b>V</b> caméra ·
      un ennemi dans le cadre jaune est verrouillé : les tirs le suivent</div>
    <div class="marqueur"><i></i></div><div class="marqueur"><i></i></div>
    <div class="fin" hidden></div>`;
  document.body.appendChild(racine);
  const $ = (s) => racine.querySelector(s);
  return {
    racine, objectif: $('.objectif'), fleche: $('.fleche'), annonce: $('.annonce'), flash: $('.flash'),
    coque: $('.jauge i'), tele: $('.tele'), fin: $('.fin'), marqueurs: [...racine.querySelectorAll('.marqueur')],
  };
}
