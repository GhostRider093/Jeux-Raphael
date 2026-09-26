/**
 * Le volant de course — Thrustmaster T150 et tout volant vu par le navigateur.
 *
 * Arnaud, 26/09/2026 : « je peux jouer avec mon volant ? — un Thrustmaster
 * T150 ». Le navigateur voit un volant comme une manette générique : des axes
 * et des boutons, dans un ordre qui dépend du volant, du pilote Windows et du
 * mode du pédalier (pédales séparées ou combinées). On ne devine donc rien :
 *
 *   — **un réglage guidé**, une fois : volant au centre et pédales relâchées
 *     (on mesure le repos de chaque axe — une pédale T150 repose à −1, à 0 ou
 *     à +1 selon le mode), puis « tourne à droite », « accélérateur à fond »,
 *     « frein à fond », et trois boutons au choix (frein à main, repartir,
 *     caméra). Chaque étape se valide toute seule quand le geste est vu ;
 *   — le résultat est gardé dans ce navigateur (`nova.volant`) ;
 *   — ensuite `lire()` rend direction, gaz, frein et frein à main, prêts pour
 *     `voiture-pilote.js`. Les boutons « repartir » et « caméra » envoient les
 *     touches R et V : tout ce qui écoute déjà le clavier (la course, le
 *     village) répond sans rien savoir du volant.
 *
 * Un volant de 900° n'a pas besoin d'être tourné d'un demi-tour pour braquer à
 * fond : `sensibilite` (1,5 par défaut, 3 était « super dur ») multiplie
 * l'axe, puis `courbe` (1,6) adoucit le centre. Réglable dans le panneau.
 *
 * Pas de retour de force : le navigateur ne sait pas le piloter.
 */

const CLE = 'nova.volant';
const ZONE_DIRECTION = 0.015;
const ZONE_PEDALE = 0.04;

// v2 (26/09/2026, Arnaud au T150 : « l'axe du volant est super super dur ») :
// sensibilité par défaut 3 → 1,5, et une courbe douce au centre. Un profil
// plus ancien garde ses axes et reçoit ces nouvelles valeurs.
const SENSIBILITE = 1.5, COURBE = 1.6;
// v3 : le repos des pédales est mesuré au relâché ; un profil v2 doit être refait.
const VERSION = 3;
function lireProfil() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(CLE)); } catch { return null; }
  if (p && (p.version || 1) < VERSION) return null;   // à refaire : le bandeau le proposera
  return p;
}
function ecrireProfil(p) { try { localStorage.setItem(CLE, JSON.stringify(p)); } catch { /* navigation privée */ } }

const estVolant = (id) => /wheel|volant|t150|t300|tmx|g29|g920|g923|thrustmaster|fanatec|racing/i.test(id || '');

function manettes() {
  return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
}

const STYLE = `
#volant-bandeau{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:40;display:none;
  font:600 15px/1.3 system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.88);border-radius:12px;padding:9px 14px}
#volant-bandeau button,#volant-panneau button{font:inherit;font-weight:700;border:0;border-radius:9px;padding:6px 12px;margin-left:8px;cursor:pointer;background:#ffd21f;color:#141414}
#volant-bandeau button.non,#volant-panneau button.non{background:#3a4048;color:#fff}
#volant-panneau{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:41;display:none;width:min(440px,92vw);
  font:15px/1.45 system-ui,sans-serif;color:#fff;background:rgba(10,14,20,.94);border-radius:16px;padding:18px 22px;text-align:center}
#volant-panneau h2{margin:0 0 6px;font-size:20px}
#volant-panneau .consigne{font-size:22px;font-weight:800;color:#ffd21f;margin:14px 0 8px}
#volant-panneau .jauge{height:10px;border-radius:5px;background:#2a2f36;overflow:hidden;margin:6px 0}
#volant-panneau .jauge i{display:block;height:100%;width:0;background:#ffd21f}
#volant-panneau input[type=range]{width:70%}
`;

/** Le volant, un seul pour toute la page. */
function creerVolant() {
  let profil = lireProfil();
  const avant = { main: false, repartir: false, vue: false };
  let calibration = null;           // l'état du réglage guidé, quand il est ouvert
  let dom = null;

  function pad() {
    const liste = manettes();
    if (profil) return liste.find((g) => g.id === profil.id) || null;
    return liste.find((g) => estVolant(g.id)) || null;
  }

  function pedale(g, def) {
    if (!def) return 0;
    const v = g.axes[def.axe] ?? def.repos;
    const t = (v - def.repos) / ((def.plein - def.repos) || 1);
    return t < ZONE_PEDALE ? 0 : Math.min(1, (t - ZONE_PEDALE) / (1 - ZONE_PEDALE));
  }
  function bouton(g, i) { return i !== null && i !== undefined && !!g.buttons[i]?.pressed; }

  /** Touche simulée : la course et le village écoutent le clavier. */
  function touche(code) {
    for (const type of ['keydown', 'keyup']) {
      dispatchEvent(new KeyboardEvent(type, { code, key: code.replace('Key', '').toLowerCase(), bubbles: true }));
    }
  }

  /**
   * @returns {null|{direction:number, gaz:number, frein:number, main:boolean, nom:string}}
   *          null si aucun volant réglé n'est branché (ou pendant le réglage)
   */
  /**
   * **Une manette classique** (PS4, Xbox — `mapping: 'standard'`), sans
   * réglage : stick gauche = direction, R2 = accélérateur, L2 = frein, ✕ =
   * frein à main (ou saut), △ = repartir, □ = caméra. Arnaud, 26/09/2026 :
   * « j'ai mis la manette PS4, ça marche pas ».
   */
  function lireManette(m) {
    const x = m.axes[0] || 0;
    const a = Math.abs(x) < 0.12 ? 0 : (Math.abs(x) - 0.12) / 0.88;
    const direction = Math.sign(x) * Math.pow(a, 1.5);
    const v = (i) => m.buttons[i]?.value || 0;
    const etat = { main: bouton(m, 0), repartir: bouton(m, 3), vue: bouton(m, 2) };
    if (etat.repartir && !avant.repartir) touche('KeyR');
    if (etat.vue && !avant.vue) touche('KeyV');
    Object.assign(avant, etat);
    return { direction, gaz: v(7) < 0.05 ? 0 : v(7), frein: v(6) < 0.05 ? 0 : v(6), main: etat.main, nom: m.id };
  }
  function manetteStandard() {
    return manettes().find((m) => m.mapping === 'standard' && !estVolant(m.id)) || null;
  }

  function lire() {
    if (calibration) return null;
    const g = pad();
    if (!g) { const m = manetteStandard(); return m ? lireManette(m) : null; }
    if (!profil) { proposer(g); return null; }
    const brut = (g.axes[profil.direction.axe] || 0) - (profil.direction.centre || 0);
    let d = brut * (profil.direction.inverse ? -1 : 1);
    d = Math.abs(d) < ZONE_DIRECTION ? 0 : d;
    // gain, puis courbe : les petits gestes restent petits, le fond garde tout
    const g1 = Math.min(1, Math.abs(d) * (profil.sensibilite || SENSIBILITE));
    const direction = Math.sign(d) * Math.pow(g1, profil.courbe || COURBE);
    const etat = { main: bouton(g, profil.main), repartir: bouton(g, profil.repartir), vue: bouton(g, profil.vue) };
    if (etat.repartir && !avant.repartir) touche('KeyR');
    if (etat.vue && !avant.vue) touche('KeyV');
    Object.assign(avant, etat);
    return { direction, gaz: pedale(g, profil.gaz), frein: pedale(g, profil.frein), main: etat.main, nom: g.id };
  }

  // ── l'interface ─────────────────────────────────────────────────────────
  function monterDom() {
    if (dom) return dom;
    const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style);
    const bandeau = document.createElement('div'); bandeau.id = 'volant-bandeau'; document.body.appendChild(bandeau);
    const panneau = document.createElement('div'); panneau.id = 'volant-panneau'; document.body.appendChild(panneau);
    dom = { bandeau, panneau };
    return dom;
  }

  let propose = false;
  /** Un volant est branché mais pas réglé : on le propose, une fois. */
  function proposer(g) {
    if (propose) return;
    propose = true;
    const { bandeau } = monterDom();
    bandeau.innerHTML = `🎮 Volant détecté : ${g.id.replace(/\s*\(.*$/, '')}`
      + '<button data-oui>Régler</button><button class="non" data-non>Plus tard</button>';
    bandeau.style.display = 'block';
    bandeau.querySelector('[data-oui]').onclick = () => { bandeau.style.display = 'none'; regler(); };
    bandeau.querySelector('[data-non]').onclick = () => { bandeau.style.display = 'none'; };
  }

  const ETAPES = [
    { cle: 'repos', texte: 'Volant au centre, pieds levés', aide: 'Ne touche à rien une seconde.' },
    { cle: 'direction', texte: 'Tourne le volant à droite', aide: 'Un bon quart de tour.' },
    { cle: 'gaz', texte: 'Accélérateur à fond', aide: 'Puis relâche.' },
    { cle: 'frein', texte: 'Frein à fond', aide: 'Puis relâche.' },
    { cle: 'main', texte: 'Bouton du frein à main', aide: 'Appuie sur le bouton de ton choix.', bouton: true },
    { cle: 'repartir', texte: 'Bouton « repartir » (R)', aide: 'Te remet sur la route pendant la course.', bouton: true },
    { cle: 'vue', texte: 'Bouton « caméra » (V)', aide: 'Change de vue.', bouton: true },
  ];

  /** Ouvre le réglage guidé. */
  function regler({ refaire = false } = {}) {
    // déjà réglé : on montre d'abord les jauges ; « Recommencer » refait tout
    if (profil && !refaire && pad()) { montrerPanneau(); return; }
    const g = pad() || manettes()[0];
    const { panneau } = monterDom();
    if (!g) {
      panneau.innerHTML = '<h2>🎮 Volant</h2><p>Aucun volant vu par le navigateur. Branche-le, puis tourne-le un peu : Chrome ne le montre qu’après un premier geste.</p><button class="non" data-fermer>Fermer</button>';
      panneau.style.display = 'block';
      panneau.querySelector('[data-fermer]').onclick = () => { panneau.style.display = 'none'; };
      return;
    }
    // **À ton rythme** (Arnaud, 26/09/2026 : « j'ai pas le temps d'appuyer, tu
    // comptes tout de suite ») : rien ne se mesure avant « Commencer », chaque
    // geste doit être tenu, et une pause « ✓ Bien reçu » sépare les étapes.
    calibration = { id: g.id, etape: 0, repos: null, t0: 0, commence: false, pause: 0, tenu: 0, dernier: performance.now(),
      nouveau: { id: g.id, version: VERSION, sensibilite: profil?.sensibilite || SENSIBILITE, courbe: profil?.courbe || COURBE }, boutonsRepos: null, pris: new Set() };
    panneau.style.display = 'block';
    afficher();
    requestAnimationFrame(suivre);
  }

  function afficher(jauge = 0) {
    const c = calibration, e = ETAPES[c.etape];
    const { panneau } = dom;
    if (!panneau.querySelector('.consigne')) {
      panneau.innerHTML = `<h2>🎮 Réglage du volant</h2><div class="nom"></div><div class="consigne"></div><div class="aide"></div>`
        + '<div class="jauge"><i></i></div><div class="bas"></div>';
    }
    panneau.querySelector('.nom').textContent = c.id.replace(/\s*\(.*$/, '');
    const enPause = performance.now() < c.pause;
    panneau.querySelector('.consigne').textContent = enPause ? '✓ Bien reçu' : `${c.etape + 1}/${ETAPES.length} · ${e.texte}`;
    panneau.querySelector('.aide').textContent = enPause ? 'Prépare-toi pour la suite…'
      : (c.etape === 0 && !c.commence ? 'Mets le volant droit, lève les pieds, puis clique sur « Commencer ».' : e.aide);
    panneau.querySelector('.jauge i').style.width = `${Math.round(jauge * 100)}%`;
    const bas = panneau.querySelector('.bas');
    if (bas.dataset.etape !== String(c.etape)) {
      bas.dataset.etape = String(c.etape);
      bas.innerHTML = (c.etape === 0 && !c.commence ? '<button data-commencer>Commencer</button>' : '')
        + (e.bouton ? '<button class="non" data-passer>Pas de bouton</button>' : '') + '<button class="non" data-annuler>Annuler</button>';
      const go = bas.querySelector('[data-commencer]');
      if (go) go.onclick = () => { c.commence = true; c.t0 = performance.now(); bas.dataset.etape = ''; afficher(); };
      const passer = bas.querySelector('[data-passer]');
      if (passer) passer.onclick = () => { c.nouveau[e.cle] = null; etapeSuivante(); };
      bas.querySelector('[data-annuler]').onclick = () => { calibration = null; panneau.style.display = 'none'; };
    }
  }

  function etapeSuivante() {
    const c = calibration;
    c.etape++;
    c.pause = performance.now() + 1600;       // « ✓ Bien reçu », puis la consigne suivante
    c.t0 = c.pause;
    c.tenu = 0;
    if (c.etape >= ETAPES.length) { terminer(); return; }
    afficher();
  }

  function suivre() {
    const c = calibration;
    if (!c) return;
    requestAnimationFrame(suivre);
    const g = manettes().find((x) => x.id === c.id);
    if (!g) return;
    const e = ETAPES[c.etape];
    const axes = Array.from(g.axes);
    const maintenant = performance.now();
    const dt = Math.min(0.1, (maintenant - c.dernier) / 1000);
    c.dernier = maintenant;
    if (c.etape === 0 && !c.commence) { afficher(0); return; }
    if (maintenant < c.pause) {
      // pendant la pause, on suit l'état des boutons : un bouton encore tenu
      // de l'étape précédente ne compte pas pour la suivante
      afficher(1);
      if (c.boutonsRepos) c.boutonsRepos = g.buttons.map((b) => b.pressed);
      c.base = null;
      return;
    }
    // La référence de l'étape : les axes tels qu'ils sont quand elle commence.
    // Pas ceux du « pieds levés » : Chrome déclare une pédale à 0 tant qu'elle
    // n'a jamais bougé, et ce faux repos faisait croire à un frein enfoncé —
    // donc à la marche arrière dès qu'on accélérait (Arnaud, 26/09/2026).
    if (!c.base) c.base = axes.slice();
    if (e.cle === 'repos') {
      // une seconde et demie d'immobilité : on retient la valeur de chaque axe
      const t = (maintenant - c.t0) / 1500;
      afficher(Math.min(1, t));
      if (t >= 1) {
        c.repos = axes;
        c.boutonsRepos = g.buttons.map((b) => b.pressed);
        etapeSuivante();
      }
      return;
    }
    if (e.bouton) {
      const i = g.buttons.findIndex((b, k) => b.pressed && !c.boutonsRepos[k] && !c.pris.has(k));
      if (i >= 0) { c.nouveau[e.cle] = i; c.pris.add(i); c.boutonsRepos = g.buttons.map((b) => b.pressed); etapeSuivante(); }
      return;
    }
    // Un axe : celui qui s'écarte le plus de son repos (hors axes déjà pris).
    let meilleur = -1, ecart = 0;
    axes.forEach((v, k) => {
      if (e.cle !== 'frein' && [...c.pris].some((p) => p === `a${k}`)) return;
      if (e.cle === 'frein' && c.nouveau.direction && c.nouveau.direction.axe === k) return;
      const d = Math.abs(v - c.base[k]);
      if (d > ecart) { ecart = d; meilleur = k; }
    });
    afficher(Math.min(1, ecart / 0.6));
    // (pédale relâchée : tous les axes au repos, `meilleur` reste à −1 — c'est
    // justement le moment de valider l'étape, on ne sort donc pas ici)
    // le volant doit être tenu tourné une demi-seconde, pas juste effleuré
    if (e.cle === 'direction') c.tenu = meilleur >= 0 && ecart > 0.12 ? c.tenu + dt : 0;
    if (e.cle === 'direction' && c.tenu >= 0.5) {
      // on attend que le geste soit franc, puis on retient le sens
      c.nouveau.direction = { axe: meilleur, centre: c.repos[meilleur], inverse: axes[meilleur] - c.repos[meilleur] < 0 };
      c.pris.add(`a${meilleur}`);
      etapeSuivante();
    } else if (e.cle === 'gaz' || e.cle === 'frein') {
      // **La pédale : son fond, puis son vrai repos, mesuré au relâché.**
      let p = c.pedale;
      if (!p) {
        if (meilleur < 0 || ecart < 0.5) return;
        p = c.pedale = { axe: meilleur, min: axes[meilleur], max: axes[meilleur], temps: 0, calme: 0, prec: axes[meilleur] };
      }
      const v = axes[p.axe];
      p.min = Math.min(p.min, v); p.max = Math.max(p.max, v);
      p.temps += dt;
      p.calme = Math.abs(v - p.prec) < 0.02 ? p.calme + dt : 0;
      p.prec = v;
      // relâchée = immobile depuis 0,4 s, loin de l'un des deux bouts parcourus
      const loin = Math.max(Math.abs(v - p.min), Math.abs(v - p.max));
      if (p.temps > 0.8 && p.calme >= 0.4 && loin > 0.5) {
        const plein = Math.abs(p.max - v) > Math.abs(p.min - v) ? p.max : p.min;
        c.nouveau[e.cle] = { axe: p.axe, repos: v, plein };
        if (e.cle === 'gaz') c.pris.add(`a${p.axe}`);
        c.pedale = null;
        etapeSuivante();
      }
    }
  }

  function terminer() {
    const c = calibration;
    calibration = null;
    profil = c.nouveau;
    // **Pieds levés, une pédale ne doit rien donner.** Pendant les étapes des
    // boutons, les pieds ne sont pas sur les pédales : si l'une se lit encore
    // « enfoncée », son sens est retourné (Arnaud, 26/09/2026 : « accélérateur
    // et frein inversés, quand je relâche ça part en arrière »).
    const g = manettes().find((x) => x.id === profil.id);
    for (const cle of ['gaz', 'frein']) {
      const def = profil[cle];
      if (g && def && pedale(g, def) > 0.5) { const t = def.repos; def.repos = def.plein; def.plein = t; }
    }
    ecrireProfil(profil);
    montrerPanneau();
  }

  /** Le panneau du volant réglé : jauges en direct, inversions, sensibilité. */
  function montrerPanneau() {
    const { panneau } = monterDom();
    panneau.style.display = 'block';
    const combine = profil.gaz && profil.frein && profil.gaz.axe === profil.frein.axe;
    panneau.innerHTML = '<h2>🎮 Volant réglé</h2>'
      + `<p>Direction : axe ${profil.direction.axe}${profil.direction.inverse ? ' (inversé)' : ''} · `
      + `gaz : axe ${profil.gaz?.axe} · frein : axe ${profil.frein?.axe}${combine ? ' (pédales combinées)' : ''}</p>`
      + `<p>Sensibilité : <b data-s>${profil.sensibilite}</b><br><input type="range" min="0.5" max="4" step="0.1" value="${profil.sensibilite}"></p>`
      + '<p style="opacity:.75;font-size:13px">Plus haut : on braque à fond avec moins de volant.</p>'
      + '<div style="text-align:left;margin:8px 0">Volant<div class="jauge"><i data-j="direction"></i></div>'
      + 'Accélérateur <button class="non" data-inv="gaz">Inverser</button><div class="jauge"><i data-j="gaz"></i></div>'
      + 'Frein <button class="non" data-inv="frein">Inverser</button><div class="jauge"><i data-j="frein"></i></div></div>'
      + '<p style="opacity:.75;font-size:13px">Pieds levés, les deux jauges de pédales doivent être vides.</p>'
      + '<button data-ok>Rouler</button><button class="non" data-refaire>Recommencer</button>';
    // les jauges suivent le volant tant que le panneau est ouvert
    const jauges = () => {
      if (panneau.style.display === 'none' || calibration || !panneau.querySelector('[data-j]')) return;
      requestAnimationFrame(jauges);
      const l = lire();
      if (!l) return;
      panneau.querySelector('[data-j=direction]').style.cssText = `margin-left:${50 + Math.min(0, l.direction) * 50}%;width:${Math.abs(l.direction) * 50}%`;
      panneau.querySelector('[data-j=gaz]').style.width = `${l.gaz * 100}%`;
      panneau.querySelector('[data-j=frein]').style.width = `${l.frein * 100}%`;
    };
    requestAnimationFrame(jauges);
    const r = panneau.querySelector('input');
    r.oninput = () => { profil.sensibilite = +r.value; panneau.querySelector('[data-s]').textContent = r.value; ecrireProfil(profil); };
    r.addEventListener('keydown', (e) => e.stopPropagation());
    panneau.querySelectorAll('[data-inv]').forEach((b) => {
      b.onclick = () => { const def = profil[b.dataset.inv]; if (!def) return; const t = def.repos; def.repos = def.plein; def.plein = t; ecrireProfil(profil); };
    });
    panneau.querySelector('[data-ok]').onclick = () => { panneau.style.display = 'none'; };
    panneau.querySelector('[data-refaire]').onclick = () => regler({ refaire: true });
  }

  // Chrome ne signale un volant qu'au premier geste : on regarde régulièrement.
  addEventListener('gamepadconnected', (e) => { if (!profil && estVolant(e.gamepad.id)) proposer(e.gamepad); });

  return {
    lire, regler,
    get regle() { return !!profil; },
    get branche() { return !!pad(); },
    /** Une manette classique est lue par le pilote (pas besoin de réglage). */
    get manette() { return !pad() && !!manetteStandard(); },
    oublier() { profil = null; try { localStorage.removeItem(CLE); } catch { /* rien */ } },
  };
}

export const volant = creerVolant();
