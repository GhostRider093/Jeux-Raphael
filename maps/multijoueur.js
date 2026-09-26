/**
 * Le multijoueur de Poilhes City — le côté jeu du salon de village.
 *
 * Arnaud, 26/09/2026 : « passer au multijoueur, surtout plusieurs en ligne ».
 * Le serveur (`multiplayer/village.py`) relaie ; ici :
 *
 *   — **entrer** : bouton 🌐, un pseudo (le même que celui du classement), et
 *     l'on rejoint le salon du village (huit joueurs au plus) ;
 *   — **se voir** : chacun envoie la position et l'orientation de son engin dix
 *     fois par seconde ; les autres apparaissent avec leur vrai engin (berline
 *     bleue, quad, trottinette, hélico) et leur pseudo au-dessus. Entre deux
 *     paquets, la position est lissée : pas de saccades ;
 *   — **courir ensemble** : le 🏁 demande un départ au salon, tout le monde part
 *     au même « GO », et les arrivées s'affichent au fil de l'eau.
 *
 * Si le serveur n'est pas là (site statique), le bouton ne s'affiche pas et le
 * jeu reste en solo : rien ne casse.
 */
import * as THREE from 'three';
import { GLTFLoader } from '../libs/GLTFLoader.js';
import { MeshoptDecoder } from '../libs/meshopt_decoder.module.js';
import { construireVoiture } from './voiture-model.js?v=pilote-20260925';
import { construireEnginQuad } from './quad.js?v=pilote-20260925';
import { construireEnginTrottinette } from './trottinette.js?v=pilote-20260922';

const CADENCE_ENVOI = 0.1;      // s
const LISSAGE = 10;             // 1/s : vitesse à laquelle l'avatar rejoint la dernière position reçue
const NOM_ENGIN = { voiture: 'Berline', quad: 'Quad', trottinette: 'Trottinette', helico: 'Hélico' };

const STYLE = `
#multi-panneau{position:fixed;right:14px;top:14px;z-index:35;display:none;min-width:190px;max-width:260px;
  font:600 13px/1.4 system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.8);border-radius:12px;padding:8px 12px}
#multi-panneau b{color:#ffd21f}
#multi-panneau ul{margin:4px 0 0;padding:0;list-style:none}
#multi-panneau li{padding:1px 0}
#multi-panneau .res{margin-top:6px;border-top:1px solid #fff3;padding-top:5px}
#multi-pseudo{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:42;display:none;
  font:15px/1.4 system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.94);border-radius:16px;padding:18px 22px;text-align:center}
#multi-pseudo input{font:inherit;padding:7px 10px;border-radius:8px;border:0;width:180px}
#multi-pseudo button{font:inherit;font-weight:700;border:0;border-radius:9px;padding:7px 14px;margin:8px 4px 0;cursor:pointer;background:#ffd21f;color:#141414}
#multi-pseudo button.non{background:#3a4048;color:#fff}
`;

function etiquette(texte) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(10,14,20,.78)';
  g.beginPath(); g.roundRect(4, 6, 248, 52, 16); g.fill();
  g.fillStyle = '#ffd21f';
  g.font = '700 32px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(texte.slice(0, 14), 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(3.2, 0.8, 1);
  s.renderOrder = 10;
  return s;
}

/**
 * @param {object} o
 * @param {object} o.jeu      ce que rend `startVillage` (scene, renderer, mode, voiture, quad, trottinette, helico)
 * @param {string} o.village
 * @param {object} [o.course] la course de la boucle (`creerCourseBoucle`), pour courir ensemble
 * @returns {Promise<object|null>} null si le serveur n'est pas joignable
 */
export async function creerMultijoueur({ jeu, village, course = null }) {
  try {
    const r = await fetch('/api/health', { cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
  } catch { return null; }

  const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
  const panneau = document.createElement('div'); panneau.id = 'multi-panneau'; document.body.appendChild(panneau);
  const fenetrePseudo = document.createElement('div'); fenetrePseudo.id = 'multi-pseudo'; document.body.appendChild(fenetrePseudo);

  let ws = null, moi = null, salon = null, resultats = [];
  const autres = new Map();          // id -> { pseudo, engin, avatar, cible, quat, etiquette }
  let helicoModele = null;

  // ── les avatars ─────────────────────────────────────────────────────────
  function modeleHelico() {
    if (!helicoModele) {
      helicoModele = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync('assets/fun/helicoptere.glb').then((g) => {
        const o = g.scene;
        o.rotation.y = -Math.PI / 2;
        const b = new THREE.Box3().setFromObject(o), t = b.getSize(new THREE.Vector3());
        o.scale.setScalar(17 / Math.max(t.x, t.z));
        o.updateMatrixWorld(true);
        const b2 = new THREE.Box3().setFromObject(o), c = b2.getCenter(new THREE.Vector3());
        o.position.set(-c.x, -b2.min.y, -c.z);
        const racine = new THREE.Group(); racine.add(o);
        return racine;
      });
    }
    return helicoModele;
  }
  function construireAvatar(engin) {
    const groupe = new THREE.Group();
    if (engin === 'helico') {
      modeleHelico().then((m) => groupe.add(m.clone())).catch(() => {});
    } else if (engin === 'quad') {
      groupe.add(construireEnginQuad({ renderer: jeu.renderer }).root);
    } else if (engin === 'trottinette') {
      groupe.add(construireEnginTrottinette({ renderer: jeu.renderer }).root);
    } else {
      const v = construireVoiture({ renderer: jeu.renderer });
      v.setTeinte && v.setTeinte('bleu');           // la berline bleue, la seule depuis le 26/09
      groupe.add(v.root);
    }
    groupe.traverse((o) => { o.visible = true; });
    return groupe;
  }
  function majAvatar(id, e) {
    let a = autres.get(id);
    if (!a) return;
    if (!a.avatar || a.engin !== e.engin) {
      if (a.avatar) jeu.scene.remove(a.avatar);
      a.engin = e.engin;
      a.avatar = construireAvatar(e.engin);
      a.etiquette = etiquette(a.pseudo);
      a.etiquette.position.y = e.engin === 'helico' ? 7 : 2.8;
      a.avatar.add(a.etiquette);
      a.avatar.position.set(e.x, e.y, e.z);
      jeu.scene.add(a.avatar);
    }
    a.cible.set(e.x, e.y, e.z);
    a.quat.set(e.qx, e.qy, e.qz, e.qw);
    a.kmh = e.kmh;
  }

  // ── l'engin du joueur ───────────────────────────────────────────────────
  function monEngin() {
    const m = jeu.mode;
    const p = m === 'voiture' ? jeu.voiture : m === 'quad' ? jeu.quad : m === 'trottinette' ? jeu.trottinette : null;
    if (p && p.root) return { root: p.root, engin: m, kmh: p.etat ? p.etat.kmh : 0 };
    if (m === 'helico' && jeu.helico) return { root: jeu.helico.root, engin: 'helico', kmh: jeu.helico.telemetrie().vitesse };
    return null;
  }
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  function envoyerEtat() {
    const e = monEngin();
    if (!e || !ws || ws.readyState !== 1) return;
    e.root.getWorldPosition(pos);
    e.root.getWorldQuaternion(quat);
    ws.send(JSON.stringify({ type: 'etat', x: pos.x, y: pos.y, z: pos.z, qx: quat.x, qy: quat.y, qz: quat.z, qw: quat.w, kmh: e.kmh, engin: e.engin }));
  }

  // ── le panneau ──────────────────────────────────────────────────────────
  function peindre() {
    if (!moi) { panneau.style.display = 'none'; return; }
    panneau.style.display = 'block';
    const noms = [`<li>🟡 ${moi.pseudo} (toi)</li>`, ...[...autres.values()].map((a) => `<li>🔵 ${a.pseudo}${a.engin ? ' · ' + (NOM_ENGIN[a.engin] || a.engin) : ''}</li>`)];
    panneau.innerHTML = `🌐 <b>${salon}</b> · ${autres.size + 1} joueur${autres.size ? 's' : ''}<ul>${noms.join('')}</ul>`
      + (resultats.length ? `<div class="res">🏁 Course : ${resultats.map((r, i) => `${i + 1}. ${r.pseudo} ${r.temps.toFixed(1)} s`).join(' · ')}</div>` : '');
  }

  // ── la connexion ────────────────────────────────────────────────────────
  function connecter(pseudo) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/village/ws/${village}?pseudo=${encodeURIComponent(pseudo)}`);
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'bienvenue') {
        moi = { id: m.id, pseudo: (m.joueurs.find((j) => j.id === m.id) || {}).pseudo || pseudo };
        salon = m.salon.charAt(0).toUpperCase() + m.salon.slice(1);
        for (const j of m.joueurs) if (j.id !== m.id) autres.set(String(j.id), { pseudo: j.pseudo, cible: new THREE.Vector3(), quat: new THREE.Quaternion() });
      } else if (m.type === 'arrive') {
        autres.set(String(m.id), { pseudo: m.pseudo, cible: new THREE.Vector3(), quat: new THREE.Quaternion() });
      } else if (m.type === 'part') {
        const a = autres.get(String(m.id));
        if (a && a.avatar) jeu.scene.remove(a.avatar);
        autres.delete(String(m.id));
      } else if (m.type === 'etats') {
        for (const [id, e] of Object.entries(m.joueurs)) majAvatar(id, e);
      } else if (m.type === 'depart') {
        // tout le salon part au même « GO » : le décompte local dure 3 s
        resultats = [];
        if (course) setTimeout(() => course.demarrer(), Math.max(0, (m.dans - 3) * 1000));
      } else if (m.type === 'resultats') {
        resultats = m.resultats;
      }
      peindre();
    };
    ws.onclose = () => {
      for (const a of autres.values()) if (a.avatar) jeu.scene.remove(a.avatar);
      autres.clear(); moi = null; ws = null; peindre();
    };
  }
  function deconnecter() { if (ws) ws.close(); }

  function demanderPseudo() {
    let nom = '';
    try { nom = localStorage.getItem('nova.boucle.nom') || ''; } catch { /* rien */ }
    fenetrePseudo.innerHTML = '<h3 style="margin:0 0 8px">🌐 Jouer en ligne</h3>'
      + `<p style="margin:0 0 10px;opacity:.8">Salon de ${village.charAt(0).toUpperCase() + village.slice(1)} · 8 joueurs au plus</p>`
      + `<input maxlength="16" placeholder="Ton pseudo" value="${nom.replace(/"/g, '')}"><br>`
      + '<button data-go>Entrer</button><button class="non" data-non>Annuler</button>';
    fenetrePseudo.style.display = 'block';
    const input = fenetrePseudo.querySelector('input');
    input.focus();
    const go = () => {
      const p = (input.value || '').trim().slice(0, 16) || 'Pilote';
      try { localStorage.setItem('nova.boucle.nom', p); } catch { /* rien */ }
      fenetrePseudo.style.display = 'none';
      connecter(p);
    };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    fenetrePseudo.querySelector('[data-go]').onclick = go;
    fenetrePseudo.querySelector('[data-non]').onclick = () => { fenetrePseudo.style.display = 'none'; };
  }

  // ── la boucle d'animation ───────────────────────────────────────────────
  let avant = performance.now(), envoi = 0;
  function image(t) {
    requestAnimationFrame(image);
    const dt = Math.min(0.1, (t - avant) / 1000); avant = t;
    if (!ws) return;
    envoi += dt;
    if (envoi >= CADENCE_ENVOI) { envoi = 0; envoyerEtat(); }
    const k = 1 - Math.exp(-LISSAGE * dt);
    for (const a of autres.values()) {
      if (!a.avatar) continue;
      a.avatar.position.lerp(a.cible, k);
      a.avatar.quaternion.slerp(a.quat, k);
    }
  }
  requestAnimationFrame(image);
  addEventListener('beforeunload', deconnecter);

  // la course à plusieurs : l'arrivée est annoncée au salon
  if (course) {
    course.onArrivee = (temps, engin) => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'arrivee', temps, engin }));
    };
  }

  return {
    get connecte() { return !!moi; },
    entrer: demanderPseudo, sortir: deconnecter,
    /** Le 🏁 en ligne : c'est le salon qui donne le départ, à tout le monde. */
    demanderDepart() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'course' })); },
    get joueurs() { return [...autres.values()].map((a) => a.pseudo); },
  };
}
