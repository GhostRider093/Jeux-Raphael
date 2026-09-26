/**
 * La boucle de course dans le village — Poilhes City.
 *
 * Arnaud, 26/09/2026 : « une petite boucle dans Poilhes avec des petites
 * flèches au sol : on part de l'entrée, on va jusqu'au gros pont, on fait une
 * boucle au-dessus, à peu près un kilomètre, on revient au point de départ ;
 * deux tours, et ça crée un classement ».
 *
 * Le tracé est calculé une fois pour toutes sur les rues du jeu
 * (`scripts/poilhes/boucle_village.py` → `maps/<village>/boucle.json`). Ici :
 *   — les flèches au sol (`fleches-sol.js`) et une ligne de départ en damier ;
 *   — le départ : l'engin posé sur la ligne, 3-2-1, et le chrono part ;
 *   — des points de passage tous les 50 m, à prendre dans l'ordre : couper par
 *     une autre rue ne valide pas le tour ;
 *   — deux tours, puis le classement : les dix meilleurs temps, gardés dans
 *     ce navigateur (le serveur de classement n'est pas déployé).
 *
 * Aucune dépendance au pilote : on lit la position de l'engin en cours et l'on
 * se sert de `placer` pour le poser sur la ligne.
 */
import * as THREE from 'three';
import { construireFleches } from './fleches-sol.js?v=arcade-20260926b';

const ECART_PASSAGE = 50;      // m entre deux points de passage
const RAYON_PASSAGE = 22;      // m : on est passé quand on en est plus près (16 avant le 26/09 : trop juste)
const RATTRAPAGE = 3;          // un point raté est validé si l'on atteint l'un des N suivants
const RAYON_ARRIVEE = 11;      // m autour de la ligne
const DECOMPTE = 3;            // s
const NOM_ENGIN = { voiture: 'Berline', quad: 'Quad', trottinette: 'Trottinette' };

// `.1tour` : la course est passée à un seul tour le 26/09/2026, les temps à deux tours ne se comparent pas.
const cleClassement = (village) => `nova.boucle.${village}.1tour`;
function lireClassement(village) {
  try { return JSON.parse(localStorage.getItem(cleClassement(village))) || []; } catch { return []; }
}
function ecrireClassement(village, liste) {
  try { localStorage.setItem(cleClassement(village), JSON.stringify(liste)); } catch { /* navigation privée */ }
}
function lireNom() { try { return localStorage.getItem('nova.boucle.nom') || ''; } catch { return ''; } }
function ecrireNom(n) { try { localStorage.setItem('nova.boucle.nom', n); } catch { /* rien */ } }

/** 83.4 → « 1:23.4 » */
export function chrono(t) {
  if (t === null || t === undefined) return '—';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

const STYLE = `
#boucle-hud{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:30;display:none;
  font:600 18px/1.2 system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.72);border-radius:14px;
  padding:8px 18px;text-align:center;letter-spacing:.02em;pointer-events:none}
#boucle-hud b{font-size:26px;font-variant-numeric:tabular-nums}
#boucle-hud small{display:block;font-weight:500;font-size:13px;opacity:.8}
#boucle-decompte{position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:31;
  font:800 140px/1 system-ui,sans-serif;color:#ffd21f;text-shadow:0 6px 0 #141414;pointer-events:none}
#boucle-fin{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:32;display:none;
  min-width:320px;max-width:92vw;font:15px/1.4 system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.92);
  border-radius:16px;padding:18px 22px;text-align:center}
#boucle-fin h2{margin:0 0 4px;font-size:22px}
#boucle-fin .temps{font-size:34px;font-weight:800;color:#ffd21f;font-variant-numeric:tabular-nums}
#boucle-fin table{width:100%;border-collapse:collapse;margin:10px 0;font-variant-numeric:tabular-nums}
#boucle-fin td{padding:3px 6px;text-align:left;white-space:nowrap}#boucle-fin td.t{text-align:right}
#boucle-fin tr.moi{background:rgba(255,210,31,.22)}
#boucle-fin input{font:inherit;padding:6px 8px;border-radius:8px;border:0;width:150px}
#boucle-fin button{font:inherit;font-weight:600;padding:7px 14px;border-radius:9px;border:0;margin:4px;cursor:pointer}
#boucle-fin .go{background:#ffd21f;color:#141414}
`;

/**
 * @param {object} o
 * @param {object} o.jeu       ce que rend `startVillage` (scene, walkableAt, mode, voiture…)
 * @param {string} o.village   'poilhes'
 * @returns {Promise<object|null>} { demarrer(), abandonner(), actif } — null si le village n'a pas de boucle
 */
export async function creerCourseBoucle({ jeu, village }) {
  let data = null;
  try {
    const res = await fetch(`maps/${village}/boucle.json`, { cache: 'no-cache' });
    if (res.ok) data = await res.json();
  } catch { /* pas de boucle */ }
  if (!data || !Array.isArray(data.points) || data.points.length < 3) return null;

  const P = data.points;
  const TOURS = data.tours || 2;
  const solAt = (x, z) => jeu.walkableAt(x, z);

  // ── le décor : flèches et ligne de départ ───────────────────────────────
  const root = new THREE.Group();
  root.name = 'course-boucle';
  root.add(construireFleches(P, solAt, { pas: 6, largeur: 2.2, longueur: 2.8, debut: 14, boucle: true, decalage: 1.2 }));
  {
    // damier de 7 m sur 1,4 m, en travers de la rue
    const c = document.createElement('canvas'); c.width = 160; c.height = 32;
    const g = c.getContext('2d');
    for (let i = 0; i < 20; i++) for (let j = 0; j < 4; j++) {
      g.fillStyle = (i + j) % 2 ? '#141414' : '#f4f4f4'; g.fillRect(i * 8, j * 8, 8, 8);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(7, 1.4); geo.rotateX(-Math.PI / 2);
    const ligne = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    const d = data.depart;
    ligne.position.set(d.x, solAt(d.x, d.z) + 0.08, d.z);
    ligne.rotation.y = d.cap;
    ligne.renderOrder = 3;
    root.add(ligne);
  }
  jeu.scene.add(root);

  // Points de passage : tous les ECART_PASSAGE m le long du tour.
  const passages = [];
  {
    let cumul = 0, prochain = ECART_PASSAGE;
    for (let i = 1; i < P.length; i++) {
      cumul += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      if (cumul >= prochain) { passages.push({ x: P[i][0], z: P[i][1], i }); prochain += ECART_PASSAGE; }
    }
  }

  // ── l'interface ─────────────────────────────────────────────────────────
  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const hud = document.createElement('div'); hud.id = 'boucle-hud'; document.body.appendChild(hud);
  const decompteEl = document.createElement('div'); decompteEl.id = 'boucle-decompte'; document.body.appendChild(decompteEl);
  const fin = document.createElement('div'); fin.id = 'boucle-fin'; document.body.appendChild(fin);

  // ── l'état de la course ─────────────────────────────────────────────────
  let onChange = null;
  const course = { actif: false, phase: null, t: 0, decompte: 0, tour: 1, passage: 0, tours: [], debutTour: 0, engin: null };

  function piloteCourant() {
    const m = jeu.mode;
    return m === 'voiture' ? jeu.voiture : m === 'quad' ? jeu.quad : m === 'trottinette' ? jeu.trottinette : null;
  }

  function poserSurLaLigne(p) {
    const d = data.depart;
    p.placer(d.x, d.z, d.cap);
    p.etat.yaw = d.cap;
    p.etat.u = p.etat.v = p.etat.lacet = 0;
  }

  function demarrer() {
    // Pas d'engin ? La berline par défaut.
    if (!piloteCourant()) jeu.setMode('voiture');
    const p = piloteCourant();
    if (!p) return;
    fin.style.display = 'none';
    Object.assign(course, {
      actif: true, phase: 'decompte', t: 0, decompte: DECOMPTE, tour: 1, passage: 0, tours: [], debutTour: 0,
      engin: jeu.mode,
    });
    poserSurLaLigne(p);
    hud.style.display = 'block';
    decompteEl.style.display = 'flex';
  }

  function abandonner() {
    course.actif = false; course.phase = null;
    hud.style.display = 'none'; decompteEl.style.display = 'none';
  }

  function majHud() {
    const meilleur = lireClassement(village)[0];
    hud.innerHTML = `Tour ${Math.min(course.tour, TOURS)}/${TOURS} · <b>${chrono(course.t)}</b>`
      + `<small>Point ${course.passage}/${passages.length}`
      + (course.tours.length ? ` · tour 1 : ${chrono(course.tours[0])}` : '')
      + (meilleur ? ` · record ${chrono(meilleur.temps)}` : '')
      + ` · R : repartir du dernier point · Échap : abandonner</small>`;
  }

  /** Le tableau des dix meilleurs, la ligne `moi` surlignée. */
  function tableau(moi) {
    const liste = lireClassement(village);
    if (!liste.length) return '<p>Pas encore de temps : à toi d’ouvrir le classement !</p>';
    const jour = (t) => { const d = new Date(t); return `${d.getDate()}/${d.getMonth() + 1}`; };
    return `<table><tr style="opacity:.7"><td></td><td>Pilote</td><td>Engin</td><td class="t">Meilleur tour</td><td class="t">Temps</td><td class="t">Le</td></tr>`
      + liste.map((r, i) => `<tr class="${moi && r.date === moi.date ? 'moi' : ''}"><td>${i + 1}.</td><td>${r.nom}</td><td>${r.engin}</td>`
        + `<td class="t">${chrono(r.meilleurTour)}</td><td class="t"><b>${chrono(r.temps)}</b></td><td class="t">${jour(r.date)}</td></tr>`).join('')
      + '</table>';
  }

  /** Le classement à tout moment (bouton 🏆 de la page). */
  function montrerClassement() {
    if (course.actif) return;
    fin.innerHTML = `<h2>🏆 Classement</h2><div>Boucle de ${village.charAt(0).toUpperCase() + village.slice(1)} · ${(data.longueur / 1000).toFixed(1).replace('.', ',')} km × ${TOURS} tour${TOURS > 1 ? 's' : ''}</div>`
      + tableau(null)
      + `<button class="go" id="boucle-courir">Courir</button><button id="boucle-fermer">Fermer</button>`;
    fin.style.display = 'block';
    fin.querySelector('#boucle-courir').onclick = () => demarrer();
    fin.querySelector('#boucle-fermer').onclick = () => { fin.style.display = 'none'; };
  }

  /**
   * **Départ lancé** (Arnaud, 26/09/2026 : « j'ai fait plusieurs tours, ça ne
   * s'est pas arrêté, pas de classement » — le chrono n'existait qu'après le
   * bouton 🏁). Franchir la ligne dans le sens de la course, en roulant, lance
   * le chrono sans décompte. Six secondes de répit après une arrivée.
   */
  let etaitSurLaLigne = false, repitJusqua = 0;
  function departLance() {
    const p = piloteCourant();
    if (!p || fin.style.display === 'block' || performance.now() < repitJusqua) { etaitSurLaLigne = false; return; }
    const d = data.depart;
    const sur = Math.hypot(p.etat.x - d.x, p.etat.z - d.z) < 8;
    let ecartCap = p.etat.yaw - d.cap;
    ecartCap = Math.atan2(Math.sin(ecartCap), Math.cos(ecartCap));
    if (sur && !etaitSurLaLigne && p.etat.u > 2 && Math.abs(ecartCap) < 0.9) {
      Object.assign(course, {
        actif: true, phase: 'course', t: 0, decompte: 0, tour: 1, passage: 0, tours: [], debutTour: 0, engin: jeu.mode,
      });
      hud.style.display = 'block';
      decompteEl.textContent = 'GO !';
      decompteEl.style.display = 'flex';
      setTimeout(() => { if (course.phase === 'course') decompteEl.style.display = 'none'; }, 700);
    }
    etaitSurLaLigne = sur;
  }

  function terminer() {
    repitJusqua = performance.now() + 6000;
    course.actif = false; course.phase = 'fini';
    hud.style.display = 'none';
    const temps = course.t;
    const nomEngin = NOM_ENGIN[course.engin] || course.engin;
    fin.innerHTML = `<h2>Arrivée !</h2><div class="temps">${chrono(temps)}</div>`
      + `<div>${course.tours.map((t, i) => `Tour ${i + 1} : ${chrono(t)}`).join(' · ')} — ${nomEngin}</div>`
      + `<div style="margin-top:10px"><input id="boucle-nom" maxlength="16" placeholder="Ton nom" value="${lireNom().replace(/"/g, '')}">`
      + `<button class="go" id="boucle-enr">Enregistrer</button></div><div id="boucle-rang" style="font-weight:700;margin-top:6px"></div>`
      + `<div id="boucle-table"></div>`
      + `<button class="go" id="boucle-rejouer">Rejouer</button><button id="boucle-fermer">Fermer</button>`;
    fin.style.display = 'block';
    const montrer = (moi) => { fin.querySelector('#boucle-table').innerHTML = tableau(moi); };
    montrer(null);
    let enregistre = false;
    const enregistrer = () => {
      if (enregistre) return;
      const nom = (fin.querySelector('#boucle-nom').value || 'Anonyme').trim().slice(0, 16).replace(/[<>&]/g, '') || 'Anonyme';
      ecrireNom(nom);
      const moi = { nom, temps: Math.round(temps * 10) / 10, engin: nomEngin, date: Date.now(),
        meilleurTour: Math.round(Math.min(...course.tours) * 10) / 10 };
      const liste = [...lireClassement(village), moi].sort((a, b) => a.temps - b.temps).slice(0, 10);
      ecrireClassement(village, liste);
      enregistre = true;
      fin.querySelector('#boucle-enr').disabled = true;
      montrer(moi);
      // la place obtenue, dite en clair
      const rang = lireClassement(village).findIndex((r) => r.date === moi.date);
      fin.querySelector('#boucle-rang').textContent = rang < 0 ? 'Hors du top 10' : rang === 0 ? '🥇 Nouveau record !' : `${rang + 1}ᵉ place`;
      if (onChange) onChange();
    };
    fin.querySelector('#boucle-enr').onclick = enregistrer;
    fin.querySelector('#boucle-nom').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') enregistrer(); });
    fin.querySelector('#boucle-nom').addEventListener('keyup', (e) => e.stopPropagation());
    fin.querySelector('#boucle-rejouer').onclick = () => { enregistrer(); demarrer(); };
    fin.querySelector('#boucle-fermer').onclick = () => { enregistrer(); fin.style.display = 'none'; };
  }

  // ── la boucle d'animation ───────────────────────────────────────────────
  let avant = performance.now();
  function image(maintenant) {
    requestAnimationFrame(image);
    const dt = Math.min(0.1, (maintenant - avant) / 1000);
    avant = maintenant;
    if (!course.actif) { departLance(); return; }
    const p = piloteCourant();
    if (!p || jeu.mode !== course.engin) { abandonner(); return; }

    if (course.phase === 'decompte') {
      course.decompte -= dt;
      poserSurLaLigne(p);              // on ne part pas avant le « Go »
      const n = Math.ceil(course.decompte);
      decompteEl.textContent = n > 0 ? String(n) : 'GO !';
      if (course.decompte <= 0) {
        course.phase = 'course';
        setTimeout(() => { if (course.phase !== 'decompte') decompteEl.style.display = 'none'; }, 700);
      }
      course.t = 0;
      majHud();
      return;
    }

    course.t += dt;
    const x = p.etat.x, z = p.etat.z;
    if (course.passage < passages.length) {
      // Un point un peu raté (une autre rue, un coin coupé) ne bloque plus le
      // tour : atteindre l'un des suivants le valide aussi.
      for (let j = course.passage; j < Math.min(passages.length, course.passage + RATTRAPAGE); j++) {
        const c = passages[j];
        if (Math.hypot(x - c.x, z - c.z) < RAYON_PASSAGE) { course.passage = j + 1; break; }
      }
    } else {
      const d = data.depart;
      if (Math.hypot(x - d.x, z - d.z) < RAYON_ARRIVEE) {
        course.tours.push(course.t - course.debutTour);
        course.debutTour = course.t;
        if (course.tour >= TOURS) { terminer(); return; }
        course.tour++;
        course.passage = 0;
      }
    }
    majHud();
  }
  requestAnimationFrame(image);

  /**
   * **R en course** (Arnaud, 26/09/2026 : « il faut une position pour repartir
   * un peu plus loin, sur la route, parce que là c'est bloqué ») : retour au
   * dernier point de passage validé (ou à la ligne), au milieu de la rue, dans
   * le sens de la course, à l'arrêt. Le chrono continue.
   */
  function repartir() {
    const p = piloteCourant();
    if (!p || course.phase !== 'course') return;
    const c = course.passage > 0 ? passages[course.passage - 1] : { x: data.depart.x, z: data.depart.z, i: 0 };
    const suivant = P[Math.min(P.length - 1, c.i + 5)];
    const cap = Math.atan2(-(suivant[0] - c.x), -(suivant[1] - c.z));
    p.placer(c.x, c.z, cap);
    p.etat.yaw = cap;
    p.etat.u = p.etat.v = p.etat.lacet = 0;
  }

  // En phase de capture : le R du pilote (« remettre sur la route la plus
  // proche ») ne doit pas passer après nous et nous renvoyer dans l'impasse.
  addEventListener('keydown', (e) => {
    if (!course.actif) return;
    if (e.code === 'Escape') abandonner();
    else if (e.code === 'KeyR' && course.phase === 'course') {
      e.stopImmediatePropagation(); e.preventDefault();
      if (!e.repeat) repartir();
    }
  }, true);

  return {
    demarrer, abandonner, montrerClassement,
    /** Meilleur temps enregistré, ou null. */
    record: () => { const r = lireClassement(village)[0]; return r ? { ...r, texte: chrono(r.temps) } : null; },
    /** Appelé quand un temps entre au classement. */
    set onChange(f) { onChange = f; },
    get actif() { return course.actif; },
    longueur: data.longueur, tours: TOURS,
    classement: () => lireClassement(village),
  };
}
