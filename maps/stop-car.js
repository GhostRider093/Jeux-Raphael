/**
 * Stop Car — la course-poursuite de Poilhes City (04/10/2026).
 *
 * Arnaud : « on va faire une voiture de police… il va falloir poursuivre
 * l'ennemi, sur les 4 courses qui existent, à la suite… on met les deux autres
 * voitures, sans leur nom, un numéro dessus. Il va falloir les frapper pour les
 * arrêter, au moins 5 fois, et la cinquième fois la voiture explose. Une fois
 * que tu as fait les deux voitures, tu as gagné. Les autres voitures peuvent
 * aussi se défendre. »
 *
 * Rien n'est réécrit, tout s'emboîte :
 *   — le circuit : `maps/poilhes/boucle-stopcar.json`, les quatre boucles bout à
 *     bout reliées par les rues (`PISTE=stopcar py scripts/poilhes/boucle_village.py`),
 *     balisé par les mêmes flèches au sol que les courses (`fleches-sol.js`) ;
 *   — les fuyards : les adversaires de l'ordinateur (`course-adversaires.js`)
 *     en mode `poursuite` — numérotés, ils donnent un coup de volant quand on
 *     roule à leur hauteur ; ils partent avec 30 m d'avance ;
 *   — les coups : `chocs.js` signale chaque choc avec le joueur (`onChoc`) et dit
 *     qui fonçait sur qui. Un coup donné à `FORCE_COUP` ou plus compte pour le
 *     fuyard ; un coup reçu compte contre la voiture de police ;
 *   — l'explosion : `world-explosion.js` (celle des hélicos) et le son
 *     d'accident d'Arnaud (`sons-chocs.js`, `accident()`).
 *
 * Perdu si la voiture de police encaisse `PV_POLICE` coups, ou si un fuyard
 * boucle le circuit (il s'est échappé).
 *
 * **L'hélico** (04/10/2026, Arnaud : « quand on a perdu du champ visuel, on
 * peut passer en mode hélicoptère… une aide pour le joueur, une flèche, une
 * croix, un rond… on le localise avec un sonar, et on repasse en voiture
 * derrière le fuyard ») : à plus de `PERDU` m du fuyard le plus proche pendant
 * `PERDU_DELAI` s, **J** (ou le bandeau) fait décoller l'hélico de police
 * au-dessus de la voiture, radio en prime (`radio-police.mp3`). Le fuyard porte
 * un faisceau rouge vertical et un anneau au sol ; une flèche au bord de l'écran
 * (un viseur rond quand il est à l'écran) donne sa direction et sa distance.
 * Sous `RAYON_SONAR` m, le sonar bipe de plus en plus vite et une onde part au
 * sol ; `TEMPS_VERROU` s au-dessus de lui et c'est localisé : on repasse en
 * voiture `DERRIERE` m derrière lui, lancé à sa vitesse. **J** en vol : retour à
 * la voiture laissée sur place.
 *
 * Sirène : l'enregistrement `assets/sons/sirene.mp3` (ou .ogg, .wav). La synthèse
 * écrite d'abord a été écartée (« catastrophique », Arnaud) : sans fichier, la
 * sirène se tait. Touche **H** : sirène. **Échap** : abandonner.
 */
import * as THREE from 'three';
import { creerAdversaires, NIVEAUX } from './course-adversaires.js?v=20261004c';
import { construireFleches } from './fleches-sol.js?v=arcade-20260926b';
import { createExplosionSystem } from './world-explosion.js?v=sons-reels-20260908';
import { accident } from './sons-chocs.js?v=20261004c';

export const COUPS_POUR_ARRETER = 5;   // Arnaud : « au moins 5 fois, la cinquième elle explose »
const PV_POLICE = 10;                  // coups encaissés avant d'être hors service
const FORCE_COUP = 0.15;               // force de choc (0…1) à partir de laquelle un coup compte
const AVANCE = [30, 44];               // m d'avance des deux fuyards au départ
const RECUL = 15;                      // m entre la voiture de police et la ligne
const DECOMPTE = 3;
const SYNTHESE = false;                // la sirène de synthèse, écartée : on attend le bruitage d'Arnaud

const STYLE = `
#sc-hud{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:30;display:none;
  background:rgba(10,14,22,.82);color:#eef2f7;border-radius:14px;padding:8px 16px;
  font:600 15px system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);white-space:nowrap}
#sc-hud .l{display:flex;gap:18px;align-items:center;justify-content:center}
#sc-hud .pts{letter-spacing:2px;font-size:14px}
#sc-hud .mort{opacity:.45;text-decoration:line-through}
#sc-hud small{display:block;text-align:center;opacity:.65;font-weight:500;font-size:12px;margin-top:3px}
#sc-decompte{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:31;
  font:900 120px system-ui,sans-serif;color:#fff;text-shadow:0 0 30px #2f6bff,0 0 60px #ff2020;pointer-events:none}
#sc-fin{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:32;display:none;
  background:rgba(10,14,22,.92);color:#eef2f7;border-radius:18px;padding:22px 30px;text-align:center;
  font:500 16px system-ui,sans-serif;min-width:300px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#sc-fin h2{margin:0 0 8px;font-size:30px}
#sc-fin .t{font-size:26px;font-weight:800;margin:6px 0 12px}
#sc-fin button{margin:12px 6px 0;padding:9px 18px;border:0;border-radius:10px;font:700 15px system-ui;cursor:pointer;background:#2a3140;color:#fff}
#sc-fin button.go{background:#2f6bff}
#sc-aide{position:fixed;bottom:110px;left:50%;transform:translateX(-50%);z-index:30;display:none;
  background:rgba(10,14,22,.86);color:#fff;border-radius:12px;padding:9px 16px;font:700 16px system-ui,sans-serif;
  box-shadow:0 6px 24px rgba(0,0,0,.35);white-space:nowrap;cursor:pointer;border:2px solid #2f6bff}
#sc-aide.perdu{border-color:#ff4d3a;animation:sc-clign 1s infinite}
@keyframes sc-clign{50%{border-color:#2f6bff}}
#sc-aide .barre{display:inline-block;vertical-align:middle;width:120px;height:12px;margin:0 8px;border-radius:6px;background:rgba(255,255,255,.18);overflow:hidden}
#sc-aide .barre i{display:block;height:100%;background:linear-gradient(90deg,#5fd3ff,#2f6bff)}
#sc-fleche{position:fixed;left:0;top:0;z-index:29;display:none;pointer-events:none;width:0;height:0}
#sc-fleche .f{position:absolute;left:-22px;top:-22px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;
  font:900 38px system-ui;color:#ff3b30;text-shadow:0 0 8px #000,0 0 3px #000}
#sc-fleche .rond{position:absolute;left:-30px;top:-30px;width:60px;height:60px;border:4px solid #ff3b30;border-radius:50%;
  box-shadow:0 0 12px #ff3b30, inset 0 0 8px #ff3b30;display:none}
#sc-fleche .rond::before,#sc-fleche .rond::after{content:'';position:absolute;background:#ff3b30;left:50%;top:50%}
#sc-fleche .rond::before{width:2px;height:22px;transform:translate(-50%,-50%)}
#sc-fleche .rond::after{width:22px;height:2px;transform:translate(-50%,-50%)}
#sc-fleche .d{position:absolute;left:-60px;top:30px;width:120px;text-align:center;font:800 14px system-ui;color:#fff;text-shadow:0 0 4px #000,0 0 2px #000}
@media (max-width:600px){#sc-hud{font-size:13px;padding:6px 10px}#sc-hud .l{gap:10px}#sc-decompte{font-size:80px}}
`;

const chrono = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const points = (n, total) => '●'.repeat(Math.min(n, total)) + '○'.repeat(Math.max(0, total - n));

/** La jauge des coups au-dessus d'un fuyard : un sprite redessiné à chaque coup. */
function creerJauge(couleur) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 48;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(2.6, 0.49, 1);
  s.renderOrder = 10;
  function dessiner(coups) {
    g.clearRect(0, 0, 256, 48);
    g.fillStyle = 'rgba(10,14,20,.78)';
    g.beginPath(); g.roundRect(4, 4, 248, 40, 14); g.fill();
    for (let i = 0; i < COUPS_POUR_ARRETER; i++) {
      g.beginPath();
      g.arc(48 + i * 40, 24, 12, 0, Math.PI * 2);
      g.fillStyle = i < coups ? '#ff4d3a' : 'rgba(255,255,255,.18)';
      g.fill();
      g.lineWidth = 2; g.strokeStyle = couleur; g.stroke();
    }
    tex.needsUpdate = true;
  }
  dessiner(0);
  return { sprite: s, dessiner };
}

/**
 * La sirène : un enregistrement s'il existe (`assets/sons/sirene.*`), sinon deux
 * dents de scie filtrées dont la hauteur monte et descend (le « wail » américain).
 */
function creerSirene() {
  let ctx = null, gain = null, osc = [], lfo = null, tampon = null, source = null, allumee = false;
  const FICHIERS = ['assets/sons/sirene.mp3', 'assets/sons/sirene.ogg', 'assets/sons/sirene.wav'];
  function contexte() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    gain = ctx.createGain(); gain.gain.value = 0; gain.connect(ctx.destination);
    // un fichier déposé remplace la synthèse (le bruitage promis par Arnaud)
    (async () => {
      for (const f of FICHIERS) {
        try {
          const r = await fetch(f);
          if (!r.ok) continue;
          tampon = await ctx.decodeAudioData(await r.arrayBuffer());
          if (allumee) { arreterSources(); demarrerSources(); }
          return;
        } catch { /* suivant */ }
      }
    })();
    return ctx;
  }
  function arreterSources() {
    for (const o of osc) { try { o.stop(); o.disconnect(); } catch { /* déjà fait */ } }
    osc = [];
    if (lfo) { try { lfo.stop(); lfo.disconnect(); } catch { /* déjà fait */ } lfo = null; }
    if (source) { try { source.stop(); source.disconnect(); } catch { /* déjà fait */ } source = null; }
  }
  function demarrerSources() {
    if (tampon) {
      source = ctx.createBufferSource(); source.buffer = tampon; source.loop = true;
      const g = ctx.createGain(); g.gain.value = 4;             // sortie ≈ 0,28 : l'enregistrement est fort (−16 dB en moyenne)
      source.connect(g); g.connect(gain); source.start();
      return;
    }
    // Pas de synthèse : Arnaud l'a jugée « catastrophique » (04/10/2026). Sans
    // fichier, la sirène se tait — le gyrophare suffit.
    if (!SYNTHESE) return;
    const filtre = ctx.createBiquadFilter(); filtre.type = 'lowpass'; filtre.frequency.value = 2600; filtre.Q.value = 0.7;
    filtre.connect(gain);
    lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 0.32;   // un aller-retour en ~3 s
    const ampleur = ctx.createGain(); ampleur.gain.value = 380;
    lfo.connect(ampleur);
    for (const d of [0, 7]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = 1000; o.detune.value = d;
      ampleur.connect(o.frequency);
      o.connect(filtre); o.start(); osc.push(o);
    }
    lfo.start();
  }
  return {
    allumer(on) {
      if (on === allumee) return;
      if (on && !contexte()) return;
      allumee = on;
      if (!ctx) return;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      if (on) { arreterSources(); demarrerSources(); gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.07, t + 0.25); }
      else { gain.gain.setValueAtTime(gain.gain.value, t); gain.gain.linearRampToValueAtTime(0, t + 0.2); setTimeout(() => { if (!allumee) arreterSources(); }, 300); }
    },
    get allumee() { return allumee; },
  };
}

/**
 * @param {object} o
 * @param {object} o.jeu      ce que rend `startVillage` (la voiture doit être la police)
 * @param {string} o.village
 * @param {object} o.chocs    le module des chocs (pour `onChoc`)
 * @param {string} [o.niveau] niveau des fuyards (`NIVEAUX` des adversaires)
 * @param {Function} [o.obstacles] () => les boîtes du trafic
 * @returns {Promise<object|null>} null si le village n'a pas de circuit Stop Car
 */
export async function creerStopCar({ jeu, village, chocs, niveau = 'facile', obstacles = null }) {
  let data;
  try {
    const r = await fetch(`maps/${village}/boucle-stopcar.json?v=20261004a`, { cache: 'no-cache' });
    if (!r.ok) return null;
    data = await r.json();
  } catch { return null; }
  const solAt = (x, z) => jeu.walkableAt(x, z);
  const P = data.points;

  const adv = creerAdversaires({ jeu, data, tours: 1, poursuite: true });
  adv.niveau = niveau === 'aucun' ? 'facile' : niveau;
  if (obstacles) adv.obstacles = obstacles;

  // ── le décor : les flèches de tout le circuit ───────────────────────────
  const root = new THREE.Group();
  root.name = 'stop-car';
  root.add(construireFleches(P, solAt, { largeur: 2.2, longueur: 2.8, debut: 14, boucle: true, decalage: 1.2,
    virages: { pasDroit: 28, pasVirage: 4, avant: 22, seuil: 0.35, grand: 1.35 } }));
  root.visible = false;
  jeu.scene.add(root);

  const explosions = createExplosionSystem({ scene: jeu.scene, camera: jeu.camera });
  const sirene = creerSirene();

  // ── l'interface ─────────────────────────────────────────────────────────
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const hud = document.createElement('div'); hud.id = 'sc-hud'; document.body.appendChild(hud);
  const decompteEl = document.createElement('div'); decompteEl.id = 'sc-decompte'; document.body.appendChild(decompteEl);
  const fin = document.createElement('div'); fin.id = 'sc-fin'; document.body.appendChild(fin);

  // ── l'état ──────────────────────────────────────────────────────────────
  const partie = { phase: null, t: 0, decompte: 0, degats: 0 };
  const suivi = new Map();               // pilote → { coups, jauge }

  const pilote = () => (jeu.mode === 'voiture' ? jeu.voiture : null);

  function majHud() {
    const fuyards = adv.pilotes.map((p) => {
      const s = suivi.get(p);
      const c = s ? s.coups : 0;
      return `<span class="${p.mort ? 'mort' : ''}">🚗 ${p.numero} <span class="pts">${points(c, COUPS_POUR_ARRETER)}</span></span>`;
    }).join('');
    const pv = PV_POLICE - partie.degats;
    hud.innerHTML = `<div class="l"><span>🚓 Stop Car · <b>${chrono(partie.t)}</b></span>${fuyards}`
      + `<span>Police <span class="pts" style="color:${pv > 3 ? '#7fd1ff' : '#ff6a5a'}">${'▮'.repeat(Math.max(0, pv))}${'▯'.repeat(Math.min(PV_POLICE, partie.degats))}</span></span></div>`
      + (matchMedia('(pointer: coarse)').matches ? '' : '<small>Percute-les pour les arrêter · H : sirène · J : hélico (fuyard perdu) · R : sur la route · Échap : abandonner</small>');
  }

  function placerPolice() {
    const p = pilote();
    if (!p) return;
    const d = data.depart;
    const x = d.x + Math.sin(d.cap) * RECUL, z = d.z + Math.cos(d.cap) * RECUL;   // l'avant est (−sin, −cos)
    p.placer(x, z, d.cap);
    p.etat.yaw = d.cap;
    p.etat.u = p.etat.v = p.etat.lacet = 0;
  }

  function demarrer() {
    if (jeu.mode !== 'voiture') jeu.setMode('voiture');
    if (!pilote()) return;
    fin.style.display = 'none';
    root.visible = true;
    placerPolice();
    adv.preparer('voiture', RECUL);
    // Les fuyards partent devant : ils fuient, on ne les met pas en grille à côté de nous.
    adv.pilotes.forEach((p, i) => {
      p.s = AVANCE[i] || 30 + i * 14;
      p.lat = p.latGrille = p.file;
      const j = creerJauge(p.couleur);
      j.sprite.position.y = 3.55;
      p.groupe.add(j.sprite);
      suivi.set(p, { coups: 0, jauge: j });
    });
    Object.assign(partie, { phase: 'decompte', t: 0, decompte: DECOMPTE, degats: 0 });
    hud.style.display = 'block';
    decompteEl.style.display = 'flex';
    sirene.allumer(true);
    majHud();
  }

  function arreterTout() {
    if (aide.vue === 'helico') revenirVoiture(null);
    aide.perdu = 0;
    balise.visible = false; flecheEl.style.display = 'none'; montrerAide('');
    epaves.length = 0;
    adv.arreter();
    suivi.clear();
    root.visible = false;
    hud.style.display = 'none';
    decompteEl.style.display = 'none';
    sirene.allumer(false);
    partie.phase = null;
  }

  function terminer(gagne, raison) {
    partie.phase = 'fini';
    balise.visible = false; flecheEl.style.display = 'none'; montrerAide('');
    sirene.allumer(false);
    const t = partie.t;
    fin.innerHTML = gagne
      ? `<h2>🚓 Arrêtés !</h2><div>Les deux fuyards sont hors d'état de nuire.</div><div class="t">${chrono(t)}</div>`
        + `<div style="opacity:.8">${NIVEAUX[adv.niveau].icone} ${NIVEAUX[adv.niveau].nom} · ${partie.degats} coup${partie.degats > 1 ? 's' : ''} encaissé${partie.degats > 1 ? 's' : ''}</div>`
      : `<h2>${raison === 'echappe' ? '💨 Ils se sont échappés' : '💥 Voiture hors service'}</h2>`
        + `<div>${raison === 'echappe' ? 'Un fuyard a bouclé le circuit.' : `La voiture de police a encaissé ${PV_POLICE} coups.`}</div><div class="t">${chrono(t)}</div>`;
    fin.innerHTML += '<button class="go" id="sc-rejouer">Rejouer</button><button id="sc-fermer">Fermer</button>';
    fin.style.display = 'block';
    fin.querySelector('#sc-rejouer').onclick = () => { arreterTout(); demarrer(); };
    fin.querySelector('#sc-fermer').onclick = () => { arreterTout(); fin.style.display = 'none'; };
    hud.style.display = 'none';
  }

  /**
   * L'explosion — refaite le 04/10/2026 (Arnaud : « cette espèce de petite
   * explosion ridicule »). Une vraie destruction, en trois temps :
   *   1. une grosse boule de feu (×3,2) et deux répliques décalées ;
   *   2. la voiture **saute** (7 m/s vers le haut) en tournoyant, et retombe ;
   *   3. la carcasse, **noircie**, brûle encore `BRULE` secondes (petites
   *      flammes régulières), puis disparaît.
   * La voiture n'est plus un corps pour les chocs dès le premier instant
   * (`mort`) : on ne se cogne pas dans une épave qui vole.
   */
  const BRULE = 6;
  const epaves = [];                     // { p, t, vy, rx, rz, y0, prochainFeu }
  const tmpFeu = new THREE.Vector3();
  function exploser(p) {
    p.mort = true;
    const g = p.groupe, pos = g.position;
    const moi = pilote();
    const dist = moi ? Math.hypot(moi.etat.x - pos.x, moi.etat.z - pos.z) : 0;
    explosions.spawn(tmpFeu.set(pos.x, pos.y + 1.2, pos.z), 3.2, pos.y);
    setTimeout(() => explosions.spawn(tmpFeu.set(pos.x + 1.4, pos.y + 0.9, pos.z - 1.1), 1.9, pos.y), 260);
    setTimeout(() => explosions.spawn(tmpFeu.set(pos.x - 1.2, pos.y + 1.6, pos.z + 1.3), 1.6, pos.y), 520);
    accident(dist);
    // carcasse : toutes les matières assombries (copiées : le trafic partage les siennes)
    g.traverse((o) => {
      if (!o.isMesh || !o.material || o.isSprite) return;
      const m = o.material.clone();
      if (m.color) m.color.multiplyScalar(0.13);
      if (m.emissive) m.emissive.setRGB(0, 0, 0);
      o.material = m;
    });
    // la jauge et le numéro n'ont plus lieu d'être
    g.traverse((o) => { if (o.isSprite) o.visible = false; });
    epaves.push({ p, t: 0, vy: 7, rx: (Math.random() - 0.5) * 5, rz: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 2), y0: pos.y, prochainFeu: 0.9 });
  }
  /** Une image des épaves : le saut, la chute, les flammes, la disparition. */
  function majEpaves(dt) {
    for (let i = epaves.length - 1; i >= 0; i--) {
      const e = epaves[i], g = e.p.groupe;
      e.t += dt;
      if (g.position.y > e.y0 || e.vy > 0) {
        e.vy -= 9.81 * dt;
        g.position.y = Math.max(e.y0, g.position.y + e.vy * dt);
        g.rotation.x += e.rx * dt;
        g.rotation.z += e.rz * dt;
        if (g.position.y <= e.y0 && e.vy < 0) {
          // l'épave retombe : couchée sur le flanc ou sur le toit, au plus proche
          e.vy = 0;
          g.rotation.x = Math.round(g.rotation.x / (Math.PI / 2)) * (Math.PI / 2);
          g.rotation.z = Math.round(g.rotation.z / (Math.PI / 2)) * (Math.PI / 2);
          explosions.spawn(tmpFeu.set(g.position.x, e.y0 + 0.6, g.position.z), 1.3, e.y0);
        }
      }
      e.prochainFeu -= dt;
      if (e.prochainFeu <= 0 && e.t < BRULE) {
        e.prochainFeu = 0.55 + Math.random() * 0.4;
        explosions.spawn(tmpFeu.set(g.position.x + (Math.random() - 0.5) * 1.6, e.y0 + 0.9, g.position.z + (Math.random() - 0.5) * 2.4), 0.55, e.y0);
      }
      if (e.t > BRULE + 1.2) { g.visible = false; epaves.splice(i, 1); }
    }
  }

  // ── l'hélico : perdre de vue, chercher, localiser au sonar ─────────────
  const PERDU = 100;            // m : au-delà, le fuyard est perdu de vue
  const PERDU_DELAI = 1.5;      // s perdu avant de proposer l'hélico
  const RAYON_SONAR = 30;       // m (à l'horizontale) : le sonar accroche
  const TEMPS_VERROU = 2;       // s au-dessus du fuyard pour le localiser
  const ALTITUDE = 45;          // m : décollage au-dessus de la voiture
  const DERRIERE = 18;          // m : où l'on repose la voiture, derrière le fuyard
  const helico = jeu.helico || null;
  const radio = new Audio('assets/sons/radio-police.mp3?v=20261004a');
  radio.preload = 'auto'; radio.volume = 0.6;
  const aide = { vue: 'voiture', perdu: 0, verrou: 0, voiture: null, ping: 0, onde: 0 };

  const rouge = (opacite) => new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: opacite,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const balise = new THREE.Group();
  balise.visible = false;
  const faisceau = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.8, 140, 16, 1, true), rouge(0.3));
  faisceau.position.y = 70;
  const anneauGeo = new THREE.RingGeometry(6, 7.4, 48); anneauGeo.rotateX(-Math.PI / 2);
  const anneau = new THREE.Mesh(anneauGeo, rouge(0.75));
  anneau.position.y = 0.35;
  const ondeGeo = new THREE.RingGeometry(0.92, 1, 64); ondeGeo.rotateX(-Math.PI / 2);
  const onde = new THREE.Mesh(ondeGeo, new THREE.MeshBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  onde.position.y = 0.4;
  balise.add(faisceau, anneau, onde);
  jeu.scene.add(balise);

  const aideEl = document.createElement('div'); aideEl.id = 'sc-aide'; document.body.appendChild(aideEl);
  const flecheEl = document.createElement('div'); flecheEl.id = 'sc-fleche';
  flecheEl.innerHTML = '<div class="f">➤</div><div class="rond"></div><div class="d"></div>';
  document.body.appendChild(flecheEl);
  const flecheF = flecheEl.querySelector('.f'), flecheRond = flecheEl.querySelector('.rond'), flecheD = flecheEl.querySelector('.d');
  aideEl.addEventListener('click', () => basculerHelico());
  let texteAide = '';
  /** Le bandeau d'aide ; `progres` (0…1) ajoute la barre du sonar après `texte`. */
  function montrerAide(texte, classe = '', progres = null, suite = '') {
    const cle = texte + '|' + (progres === null ? '' : Math.round(progres * 20)) + '|' + suite;
    if (cle === texteAide) return;
    texteAide = cle;
    aideEl.style.display = texte ? 'block' : 'none';
    aideEl.className = classe;
    aideEl.textContent = texte;
    if (progres !== null) {
      const b = document.createElement('span'); b.className = 'barre';
      const i = document.createElement('i'); i.style.width = `${Math.round(progres * 100)}%`;
      b.appendChild(i); aideEl.appendChild(b);
      aideEl.appendChild(document.createTextNode(suite));
    }
  }

  /** Le bip du sonar : un sinus bref qui s'éteint (aucun fichier). */
  let ctxSonar = null;
  function bip(aigu) {
    try {
      if (!ctxSonar) ctxSonar = new (window.AudioContext || window.webkitAudioContext)();
      if (ctxSonar.state === 'suspended') ctxSonar.resume();
      const t = ctxSonar.currentTime;
      const o = ctxSonar.createOscillator(), g = ctxSonar.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(aigu ? 1560 : 1180, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctxSonar.destination);
      o.start(t); o.stop(t + 0.4);
    } catch { /* pas de son : tant pis */ }
  }

  /** Le fuyard vivant le plus proche d'un point. */
  const proche = { p: null, d: Infinity };
  function plusProche(x, z) {
    proche.p = null; proche.d = Infinity;
    for (const p of adv.pilotes) {
      if (p.mort || !p.groupe.visible) continue;
      const d = Math.hypot(p.groupe.position.x - x, p.groupe.position.z - z);
      if (d < proche.d) { proche.d = d; proche.p = p; }
    }
    return proche;
  }

  function passerHelico() {
    const v = jeu.voiture;
    if (!helico || !v) return;
    aide.voiture = { x: v.etat.x, z: v.etat.z, cap: v.etat.yaw };
    helico.root.position.set(v.etat.x, solAt(v.etat.x, v.etat.z) + ALTITUDE, v.etat.z);
    helico.root.rotation.set(0, v.etat.yaw, 0);
    jeu.setMode('helico');
    aide.vue = 'helico'; aide.verrou = 0; aide.ping = 0;
    sirene.allumer(false);
    radio.currentTime = 0;
    radio.play().catch(() => {});
  }
  /** Retour en voiture : derrière le fuyard `p` (localisé), ou là où on l'avait laissée. */
  function revenirVoiture(p = null) {
    jeu.setMode('voiture');
    const v = jeu.voiture;
    aide.vue = 'voiture'; aide.perdu = 0; aide.verrou = 0;
    balise.visible = false; flecheEl.style.display = 'none';
    montrerAide('');
    if (v) {
      if (p) {
        // en arrière **sur le tracé** : en ligne droite, dans un virage, on tombait dans une façade
        const t = adv.pointDuTrace(Math.max(0, p.s - DERRIERE), 0);
        v.placer(t.x, t.z, t.cap);
        v.etat.yaw = t.cap;
        v.etat.u = Math.max(8, p.v * 0.9); v.etat.v = v.etat.lacet = 0;
      } else if (aide.voiture) {
        v.placer(aide.voiture.x, aide.voiture.z, aide.voiture.cap);
        v.etat.yaw = aide.voiture.cap;
        v.etat.u = v.etat.v = v.etat.lacet = 0;
      }
    }
    if (partie.phase === 'course') sirene.allumer(true);
  }
  function basculerHelico() {
    if (partie.phase !== 'course') return;
    if (aide.vue === 'helico') revenirVoiture(null);
    else if (aide.perdu > PERDU_DELAI) passerHelico();
  }

  const proj = new THREE.Vector3();
  function majAide(dt) {
    if (aide.vue === 'voiture') {
      const v = jeu.voiture;
      if (!v || !helico) return;
      const { d } = plusProche(v.etat.x, v.etat.z);
      aide.perdu = d > PERDU && d < Infinity ? aide.perdu + dt : 0;
      montrerAide(aide.perdu > PERDU_DELAI ? '🚁 Fuyard perdu de vue — J : hélico' : '', 'perdu');
      return;
    }
    // ── en vol ──
    const h = helico.root.position;
    const { p, d } = plusProche(h.x, h.z);
    if (!p) { balise.visible = false; flecheEl.style.display = 'none'; return; }
    const g = p.groupe.position;
    balise.visible = true;
    balise.position.copy(g);
    const pouls = 1 + 0.12 * Math.sin(partie.t * 6);
    anneau.scale.set(pouls, 1, pouls);
    faisceau.material.opacity = 0.22 + 0.1 * Math.sin(partie.t * 4);
    // la flèche au bord de l'écran, ou le viseur rond posé sur lui
    proj.set(g.x, g.y + 1.2, g.z).project(jeu.camera);
    const derriere = proj.z > 1;
    let x = derriere ? -proj.x : proj.x, y = derriere ? -proj.y : proj.y;
    const aLEcran = !derriere && Math.abs(x) < 0.9 && Math.abs(y) < 0.9;
    if (!aLEcran) { const k = 0.86 / Math.max(Math.abs(x), Math.abs(y), 1e-3); x *= k; y *= k; }
    flecheEl.style.display = 'block';
    flecheEl.style.transform = `translate(${(x * 0.5 + 0.5) * innerWidth}px, ${(-y * 0.5 + 0.5) * innerHeight}px)`;
    flecheF.style.display = aLEcran ? 'none' : 'flex';
    flecheRond.style.display = aLEcran ? 'block' : 'none';
    flecheF.style.transform = `rotate(${-Math.atan2(y, x)}rad)`;
    flecheD.textContent = `${p.numero} · ${Math.round(d)} m`;
    // le sonar : il bipe de plus en plus vite en approchant, une onde part au sol
    const portee = RAYON_SONAR * 3;
    if (d < portee) {
      aide.ping -= dt;
      if (aide.ping <= 0) {
        aide.ping = 0.25 + 0.9 * Math.min(1, d / portee);
        bip(d < RAYON_SONAR);
        aide.onde = 0;
      }
    }
    aide.onde += dt;
    const r = 2 + aide.onde * 38;
    onde.scale.set(r, 1, r);
    onde.material.opacity = d < portee ? Math.max(0, 0.8 - aide.onde * 1.1) : 0;
    if (d < RAYON_SONAR) aide.verrou += dt; else aide.verrou = Math.max(0, aide.verrou - dt * 0.5);
    if (d < portee) montrerAide('📡 Sonar', '', Math.min(1, aide.verrou / TEMPS_VERROU), `reste au-dessus de ${p.numero}`);
    else montrerAide(`🚁 Suis la flèche : ${p.numero} à ${Math.round(d)} m · J : revenir à la voiture`);
    if (aide.verrou >= TEMPS_VERROU) {
      bip(true);
      revenirVoiture(p);
    }
  }

  // ── les coups ───────────────────────────────────────────────────────────
  // les fuyards sont des corps pour le module des chocs (sinon on les traverse)
  chocs.ajouterSource(() => adv.corps());
  const avantChoc = chocs.onChoc;
  chocs.onChoc = (e) => {
    if (avantChoc) avantChoc(e);
    if (partie.phase !== 'course' || !e.autre.pilote) return;
    const p = e.autre.pilote;
    const s = suivi.get(p);
    if (!s || p.mort || e.force < FORCE_COUP) return;
    if (e.attaquant === 'joueur') {
      s.coups++;
      s.jauge.dessiner(s.coups);
      if (s.coups >= COUPS_POUR_ARRETER) exploser(p);
    } else {
      partie.degats++;
    }
    majHud();
    if (adv.pilotes.every((q) => q.mort)) setTimeout(() => terminer(true), 3500);
    else if (partie.degats >= PV_POLICE) terminer(false, 'police');
  };

  // ── la boucle ───────────────────────────────────────────────────────────
  let avant = performance.now(), dernierHud = 0;
  function image(tms) {
    requestAnimationFrame(image);
    const dt = Math.min(0.1, (tms - avant) / 1000); avant = tms;
    if (dt <= 0 || document.hidden) return;
    explosions.update(dt);
    majEpaves(dt);
    if (!partie.phase || partie.phase === 'fini') { if (partie.phase === 'fini') adv.maj(dt, pilote()); return; }
    if (partie.phase === 'decompte') {
      partie.decompte -= dt;
      const n = Math.ceil(partie.decompte);
      decompteEl.textContent = n > 0 ? String(n) : 'GO !';
      // on ne bouge pas avant le GO : la voiture reste sur sa marque
      const p = pilote();
      if (p && n > 0) placerPolice();
      if (partie.decompte <= 0) {
        partie.phase = 'course';
        adv.go();
        setTimeout(() => { if (partie.phase === 'course') decompteEl.style.display = 'none'; }, 700);
      }
      adv.maj(dt, pilote());
      return;
    }
    partie.t += dt;
    adv.maj(dt, pilote());
    majAide(dt);
    if (adv.pilotes.some((p) => !p.mort && p.arrivee !== null)) { terminer(false, 'echappe'); return; }
    if (tms - dernierHud > 200) { dernierHud = tms; majHud(); }
  }
  requestAnimationFrame(image);

  addEventListener('keydown', (e) => {
    if (!partie.phase) return;
    if (e.code === 'KeyH' && partie.phase !== 'fini' && aide.vue === 'voiture') sirene.allumer(!sirene.allumee);
    if (e.code === 'KeyJ') basculerHelico();
    if (e.code === 'Escape' && partie.phase !== 'fini') { arreterTout(); }
  });

  return {
    demarrer, abandonner: arreterTout,
    essaiExplosion: (k = 0) => { const p = adv.pilotes[k]; if (p && !p.mort) exploser(p); },   // poignée de test
    get partie() { return partie; },
    get aide() { return aide; },                // poignée de test : vue, perdu, verrou
    adversaires: adv,
    sirene,
    longueur: data.longueur,
  };
}
