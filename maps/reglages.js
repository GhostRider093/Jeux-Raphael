/**
 * L'outil de réglage de la conduite — voiture et trottinette.
 *
 * Trois choses, et rien qui invente :
 *
 *   1. **Le schéma** : chaque paramètre de `REGLAGES` (voiture-physique.js) et du
 *      toucher du pilote, avec son unité, ses bornes et ce qu'il change. Les
 *      valeurs, elles, restent celles des fichiers : ce module ne les copie pas.
 *   2. **Le banc** : des mesures **calculées avec la vraie physique** (`creerPhysique`,
 *      pas à pas, sans rendu) — 0 à 100, vitesse maxi, distance de freinage, rayon
 *      et g en virage, vivacité au coup de volant, frein à main. Quelques
 *      millisecondes, déterministe, le même code que sous les roues : ce que le banc
 *      annonce est ce que le joueur sentira. C'est cela, « fidèle ».
 *   3. **Le panneau** (touche T en jeu) : curseurs par groupe, application à chaud
 *      (`pilote.regler`), télémétrie en direct, banc recalculé à chaque geste,
 *      mémorisation, export JSON, copie en JS prête à coller dans `REGLAGES`.
 *
 * Le même banc tourne en ligne de commande : `node scripts/banc-voiture.mjs gt`.
 * Ce fichier ne touche au DOM que dans `monterPanneau`.
 */
import { creerPhysique, REGLAGES } from './voiture-physique.js?v=pilote-20260925';

// ─────────────────────────────────────────────── le schéma
const P = (cle, nom, unite, min, max, pas, aide) => ({ cle, nom, unite, min, max, pas, aide });

/** Paramètres de la physique, communs aux trois engins. */
export const SCHEMA_PHYSIQUE = [
  { groupe: 'Moteur', params: [
    P('couple', 'Couple maxi', 'N·m', 5, 900, 1, 'La poussée du moteur à son meilleur régime. Tout part de là.'),
    P('regimeCouple', 'Régime du couple', 'tr/min', 500, 9000, 50, 'Où le couple culmine ; au-dessus et en dessous, il retombe.'),
    P('regimeMax', 'Rupteur', 'tr/min', 1000, 10000, 50, 'Le moteur ne donne plus rien dans les 350 derniers tours.'),
    P('ralenti', 'Ralenti', 'tr/min', 0, 1500, 10, 'Régime plancher.'),
    P('freinMoteur', 'Frein moteur', 'N·m', 0, 120, 1, 'Ce qui retient pied levé. Plus haut : la voiture ralentit seule.'),
    P('rendement', 'Rendement', '', 0.6, 1, 0.01, 'Part du couple qui arrive aux roues.'),
  ] },
  { groupe: 'Transmission', params: [
    { cle: 'motrice', nom: 'Roues motrices', choix: [['arriere', 'Propulsion (arrière)'], ['avant', 'Traction (avant)']],
      aide: 'Une propulsion pousse et peut se mettre en travers ; une traction tire et élargit son virage.' },
    { cle: 'rapports', nom: 'Rapports de boîte', liste: true,
      aide: 'Les démultiplications, du premier au dernier, séparées par des virgules. Un seul rapport = engin électrique.' },
    P('pont', 'Pont', '', 1, 8, 0.01, 'Démultiplication finale : multiplie tous les rapports.'),
    P('marche', 'Marche arrière', '', 1, 8, 0.01, 'Démultiplication de la marche arrière.'),
  ] },
  { groupe: 'Châssis', params: [
    P('masse', 'Masse', 'kg', 40, 3000, 5, 'Avec le pilote. Plus lourd : accélère et freine moins, tient mieux le cap.'),
    P('avant', 'CG → essieu avant', 'm', 0.2, 2.5, 0.01, 'Distance du centre de gravité à l’essieu avant.'),
    P('arriere', 'CG → essieu arrière', 'm', 0.2, 2.5, 0.01, 'Distance du centre de gravité à l’essieu arrière. Plus grand : plus de poids devant.'),
    P('hauteurCG', 'Hauteur du CG', 'm', 0.1, 1.2, 0.01, 'Règle le transfert de charge : haut, la voiture plonge au freinage et s’assoit en accélérant.'),
    P('inertie', 'Inertie en lacet', 'kg·m²', 5, 4000, 5, 'Résistance à la rotation. Faible : vif, nerveux ; fort : posé, lent à tourner.'),
    P('voie', 'Voie', 'm', 0.1, 2.2, 0.01, 'Largeur entre les roues (assiette en roulis).'),
    P('rayonRoue', 'Rayon de roue', 'm', 0.05, 0.6, 0.005, 'Convertit le couple en force et la vitesse en régime.'),
  ] },
  { groupe: 'Pneus et freins', params: [
    P('adherence', 'Adhérence', 'µ', 0.4, 2.2, 0.01, 'Le grip des pneus sur bitume sec. 1 = pneu ordinaire, 1,3 = sportif.'),
    P('equilibre', 'Équilibre AR / AV', '', 0.7, 1.5, 0.01, 'Adhérence arrière rapportée à l’avant. > 1 sous-vireur (élargit, pardonne), < 1 survireur (part de l’arrière).'),
    P('freinCouple', 'Couple de freinage', 'N·m', 20, 8000, 10, 'Puissance des freins, toutes roues.'),
    P('repartAvant', 'Répartition AV', '', 0.3, 0.9, 0.01, 'Part du freinage sur l’avant. Trop d’arrière : l’arrière bloque et pivote.'),
  ] },
  { groupe: 'Aides de conduite', params: [
    P('antipatinage', 'Antipatinage', '', 0.3, 1.3, 0.01, 'Part de l’adhérence motrice que le moteur s’autorise. > 1 : plus d’aide, ça patine.'),
    P('stabilite', 'Contrôle de trajectoire', '1/s', 0, 10, 0.1, 'Rappel du lacet vers ce que le volant demande. 0 : aucune aide, la glissade est libre.'),
  ] },
  { groupe: 'Direction', params: [
    P('braquageMax', 'Braquage à l’arrêt', 'rad', 0.1, 1.2, 0.01, 'Angle maxi des roues à basse vitesse (0,5 rad ≈ 29°).'),
    P('braquageVite', 'Braquage à 250 km/h', 'rad', 0.02, 0.6, 0.01, 'Ce qu’il en reste lancé : un coup de volant à fond ne doit pas retourner la voiture.'),
    P('vitesseBraquage', 'Vitesse du volant', 'rad/s', 0.5, 10, 0.1, 'À quelle vitesse les roues suivent la commande.'),
  ] },
  { groupe: 'Aérodynamique et roulement', params: [
    P('appui', 'Appui aérodynamique', 'N/(m/s)²', 0, 3, 0.01, 'Charge ajoutée par la vitesse : plus de grip lancé.'),
    P('scx', 'S·Cx', 'm²', 0.1, 2, 0.01, 'Traînée : plafonne la vitesse maxi.'),
    P('roulement', 'Résistance au roulement', '', 0, 0.05, 0.001, 'Frottement des pneus, à toute vitesse.'),
  ] },
];

/** Le toucher du volant (module `voiture-pilote.js`, objet `TOUCHER`). */
export const SCHEMA_TOUCHER = { groupe: 'Toucher du volant (clavier)', params: [
  P('monteeArret', 'Montée à l’arrêt', '1/s', 0.3, 8, 0.1, 'Vitesse à laquelle le volant se tourne en manœuvre.'),
  P('monteeLancee', 'Montée lancé', '1/s', 0.3, 8, 0.1, 'La même à l’allure : plus haut, plus direct.'),
  P('retourVolant', 'Retour au centre', '1/s', 1, 20, 0.5, 'Vitesse à laquelle le volant revient quand on lâche.'),
  P('expoArret', 'Courbe à l’arrêt', '', 1, 3, 0.05, '1 = linéaire ; plus haut, les petits gestes restent petits.'),
  P('expoLancee', 'Courbe lancé', '', 1, 3, 0.05, 'La même à l’allure.'),
  P('vitessePleine', 'Vitesse « lancé »', 'm/s', 3, 60, 1, 'Au-delà, le toucher ne change plus.'),
] };

/** Les sauts de la trottinette (`SAUT_TROTTINETTE` dans `voiture-pilote.js`). */
export const SCHEMA_SAUT = { groupe: 'Sauts et figures (trottinette)', params: [
  P('impulsion', 'Coup de jambes', 'm/s', 0, 6, 0.1, 'Vitesse verticale donnée par Espace (2,6 = 34 cm sur le plat).'),
  P('envolMax', 'Envol maxi', 'm/s', 2, 14, 0.1, 'Plafond de la vitesse verticale au bout d’une rampe.'),
  P('turboMax', 'Bande de lancement', 'm/s', 5, 20, 0.1, 'Vitesse atteinte sur le béton bleu (11,5 = 41 km/h).'),
  P('pencheMax', 'Inclinaison maxi', 'rad', 0.1, 1.2, 0.01, 'Jusqu’où l’engin se couche en virage (0,55 ≈ 31°).'),
] };

// ─────────────────────────────────────────────── le banc
const H = 1 / 120;

/** Fait rouler une physique neuve avec des commandes constantes jusqu'à `arret`. */
function rouler(physique, cmd, mu, dureeMax, arret) {
  let t = 0;
  while (t < dureeMax) {
    physique.pas(H, cmd, mu);
    t += H;
    if (arret && arret(physique.etat, t)) break;
  }
  return t;
}

/**
 * Le banc d'essai : tout est mesuré en faisant avancer la vraie loi de conduite.
 * @param {object} reglage une entrée de REGLAGES (ou un réglage modifié)
 * @returns {object} mesures, avec `vitesseRef` (km/h) qui adapte les épreuves à l'engin
 */
export function banc(reglage) {
  const copie = (r) => JSON.parse(JSON.stringify(r));
  const leger = reglage.rapports.length === 1 && reglage.masse < 400;   // trottinette
  const vitesseRef = leger ? 20 : 100;                                  // km/h
  const vRef = vitesseRef / 3.6;
  const out = { vitesseRef };

  // 0 → vitesseRef, puis vitesse maxi (plein gaz, ligne droite)
  {
    const p = creerPhysique(copie(reglage)); p.poser(0, 0, 0);
    let tRef = null;
    rouler(p, { gaz: 1, frein: 0, direction: 0, main: false }, 1, 45, (e, t) => {
      if (tRef === null && e.u >= vRef) tRef = t;
      return false;
    });
    out.tAccel = tRef;                          // s, null si jamais atteinte
    out.vmax = p.etat.u * 3.6;                  // km/h après 45 s
  }
  // freinage vitesseRef → 0 : distance
  {
    const p = creerPhysique(copie(reglage)); p.poser(0, 0, 0);
    p.etat.u = vRef;
    // en 6e (ou dernier rapport) pour ne pas partir en marche arrière
    p.etat.rapport = reglage.rapports.length; p.etat.cible = p.etat.rapport;
    const z0 = p.etat.z;
    rouler(p, { gaz: 0, frein: 1, direction: 0, main: false }, 1, 20, (e) => e.u < 0.3);
    out.dFrein = Math.abs(p.etat.z - z0);       // m
  }
  // virage tenu : à la moitié de vitesseRef, volant à fond pendant 4 s, gaz pour tenir
  {
    const p = creerPhysique(copie(reglage)); p.poser(0, 0, 0);
    const v0 = vRef * 0.5;
    p.etat.u = v0;
    p.etat.rapport = Math.min(reglage.rapports.length, 3); p.etat.cible = p.etat.rapport;
    rouler(p, { gaz: 0.35, frein: 0, direction: 1, main: false }, 1, 4);
    const e = p.etat;
    out.virageV = e.u * 3.6;
    out.virageG = Math.abs(e.charge);
    out.rayon = Math.abs(e.lacet) > 1e-3 ? Math.abs(e.vitesse / e.lacet) : null;
    out.deriveAv = Math.abs(e.glisseAv) * 180 / Math.PI;
    out.deriveAr = Math.abs(e.glisseAr) * 180 / Math.PI;
    out.caractere = out.deriveAr > out.deriveAv * 1.15 ? 'survireur' : out.deriveAv > out.deriveAr * 1.15 ? 'sous-vireur' : 'neutre';
  }
  // vivacité : à 60 % de vitesseRef, volant à fond, cap pris en 0,5 s
  {
    const p = creerPhysique(copie(reglage)); p.poser(0, 0, 0);
    p.etat.u = vRef * 0.6;
    p.etat.rapport = Math.min(reglage.rapports.length, 3); p.etat.cible = p.etat.rapport;
    rouler(p, { gaz: 0.3, frein: 0, direction: 1, main: false }, 1, 0.5);
    out.vivacite = Math.abs(p.etat.yaw) * 180 / Math.PI;     // degrés de cap en 0,5 s
  }
  // frein à main : à la moitié de vitesseRef, volant à fond + frein à main 1,5 s
  if (!leger) {
    const p = creerPhysique(copie(reglage)); p.poser(0, 0, 0);
    p.etat.u = vRef * 0.5;
    p.etat.rapport = Math.min(reglage.rapports.length, 3); p.etat.cible = p.etat.rapport;
    let lacetMax = 0;
    rouler(p, { gaz: 0, frein: 0, direction: 1, main: true }, 1, 1.5, (e) => { lacetMax = Math.max(lacetMax, Math.abs(e.lacet)); return false; });
    out.mainLacet = lacetMax * 180 / Math.PI;                // °/s
    out.mainDerive = Math.abs(p.etat.glisseAr) * 180 / Math.PI;
  }
  return out;
}

/** Le banc en lignes de texte, pour la console comme pour le panneau. */
export function lignesBanc(m) {
  const f = (x, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : x.toFixed(d));
  const L = [
    [`0 → ${m.vitesseRef} km/h`, m.tAccel === null ? 'jamais' : `${f(m.tAccel, 2)} s`],
    ['Vitesse maxi', `${f(m.vmax, 0)} km/h`],
    [`Freinage ${m.vitesseRef} → 0`, `${f(m.dFrein, 1)} m`],
    [`Virage à fond à ${f(m.virageV, 0)} km/h`, `${f(m.virageG, 2)} g · rayon ${f(m.rayon, 1)} m`],
    ['Dérive AV / AR', `${f(m.deriveAv, 1)}° / ${f(m.deriveAr, 1)}° → ${m.caractere}`],
    ['Vivacité (cap en 0,5 s)', `${f(m.vivacite, 1)}°`],
  ];
  if (m.mainLacet !== undefined) L.push(['Frein à main', `${f(m.mainLacet, 0)}°/s, dérive AR ${f(m.mainDerive, 0)}°`]);
  return L;
}

// ─────────────────────────────────────────────── mémoire et échange
const CLE = (nom) => `nova.reglages.${nom.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

export function lireMemorise(nom) {
  try { const v = localStorage.getItem(CLE(nom)); return v ? JSON.parse(v) : null; } catch { return null; }
}
export function memoriser(nom, paquet) {
  try { localStorage.setItem(CLE(nom), JSON.stringify(paquet)); } catch { /* navigation privée */ }
}
export function oublier(nom) {
  try { localStorage.removeItem(CLE(nom)); } catch { /* idem */ }
}

/** Le réglage écrit comme une entrée de `REGLAGES`, prêt à coller dans le fichier. */
export function enJS(reglage, cle = 'perso') {
  const lignes = Object.entries(reglage).map(([k, v]) => {
    const val = Array.isArray(v) ? `[${v.map((x) => +x).join(', ')}]` : typeof v === 'string' ? `'${v}'` : String(+(+v).toFixed(4));
    return `    ${k}: ${val},`;
  });
  return `  ${cle}: {\n${lignes.join('\n')}\n  },`;
}

/**
 * Applique un paquet mémorisé { reglage, toucher, saut } à un pilote et aux
 * objets de réglage du module pilote. Sans effet si rien n'est mémorisé.
 */
export function appliquerMemorise(pilote, toucher = null, saut = null) {
  const nom = pilote.reglage && pilote.reglage.nom;
  if (!nom) return false;
  const paquet = lireMemorise(nom);
  if (!paquet) return false;
  if (paquet.reglage) pilote.regler(paquet.reglage);
  if (toucher && paquet.toucher) Object.assign(toucher, paquet.toucher);
  if (saut && paquet.saut) Object.assign(saut, paquet.saut);
  return true;
}

// ─────────────────────────────────────────────── le panneau
/**
 * Monte le panneau dans `racine` pour un pilote donné.
 *
 * @param {object} o
 * @param {HTMLElement} o.racine  le conteneur (vidé)
 * @param {object} o.pilote       ce que `creerPilote` renvoie (`reglage`, `regler`, `etat`)
 * @param {object} [o.toucher]    l'objet TOUCHER du pilote (module)
 * @param {object} [o.saut]       l'objet SAUT_TROTTINETTE (module), pour la trottinette
 * @param {object} [o.base]       le réglage d'origine (défaut : `REGLAGES` par le nom)
 * @returns {{ demonter(), majTelemetrie() }}
 */
export function monterPanneau({ racine, pilote, toucher = null, saut = null, base = null }) {
  const reglage = pilote.reglage;
  const nom = reglage.nom || 'Engin';
  const origine = base || Object.values(REGLAGES).find((r) => r.nom === nom) || reglage;
  const baseR = JSON.parse(JSON.stringify(origine));
  const baseT = toucher ? { ...toucher } : null;
  const baseS = saut ? { ...saut } : null;
  const groupes = [...SCHEMA_PHYSIQUE];
  // L'assistance de conduite (mur-rail, rappel vers la route) vit dans l'état du
  // pilote, pas dans la physique : une case à cocher, si le pilote la propose.
  const SCHEMA_ASSISTANCE = pilote.setAssistance && pilote.state
    ? { groupe: 'Assistance de conduite', params: [
        { cle: 'assistance', nom: 'Assistance', bool: true,
          aide: 'Le mur devient un rail, rappel doux vers la route, dégagement automatique quand on est coincé.' },
        // Les glissières au bord des rues (glissieres.js) : retenue physique,
        // proposée seulement quand le village en a construit.
        ...(pilote.setGlissieres ? [{ cle: 'glissieres', nom: 'Glissières', bool: true,
          aide: 'Les glissières au bord des rues retiennent l’engin sur la chaussée. Décoché : on passe au travers.' }] : []),
      ] }
    : null;
  if (SCHEMA_ASSISTANCE) groupes.push(SCHEMA_ASSISTANCE);
  if (toucher) groupes.push(SCHEMA_TOUCHER);
  if (saut) groupes.push(SCHEMA_SAUT);
  const cibleDe = (g) => (g === SCHEMA_TOUCHER ? toucher : g === SCHEMA_SAUT ? saut : g === SCHEMA_ASSISTANCE ? pilote.state : reglage);
  const champs = new Map();          // cle -> { input, range, groupe }

  racine.innerHTML = '';
  const tete = document.createElement('div');
  tete.className = 'reglages-tete';
  tete.innerHTML = `<b>Réglages · ${nom}</b><span class="reglages-tele" id="reglages-tele">—</span>`;
  racine.appendChild(tete);

  const bancEl = document.createElement('div');
  bancEl.className = 'reglages-banc';
  racine.appendChild(bancEl);

  const corps = document.createElement('div');
  corps.className = 'reglages-corps';
  racine.appendChild(corps);

  function valeur(g, p) { return cibleDe(g)[p.cle]; }
  function poser(g, p, v) {
    const cible = cibleDe(g);
    if (cible === reglage) pilote.regler({ [p.cle]: v });
    else if (p.bool && p.cle === 'assistance') pilote.setAssistance(v);
    else if (p.bool && p.cle === 'glissieres') pilote.setGlissieres(v);
    else cible[p.cle] = v;
  }

  for (const g of groupes) {
    const det = document.createElement('details');
    det.open = g === groupes[0];
    det.innerHTML = `<summary>${g.groupe}</summary>`;
    for (const p of g.params) {
      const ligne = document.createElement('label');
      ligne.className = 'reglages-ligne';
      ligne.title = p.aide || '';
      const v = valeur(g, p);
      if (p.bool) {
        ligne.innerHTML = `<span>${p.nom}</span><input type="checkbox"${v ? ' checked' : ''}>`;
        ligne.querySelector('input').addEventListener('change', (e) => { poser(g, p, e.target.checked); });
      } else if (p.choix) {
        ligne.innerHTML = `<span>${p.nom}</span><select>${p.choix.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
        ligne.querySelector('select').addEventListener('change', (e) => { poser(g, p, e.target.value); rafraichir(); });
      } else if (p.liste) {
        ligne.innerHTML = `<span>${p.nom}</span><input type="text" value="${(v || []).join(', ')}">`;
        ligne.querySelector('input').addEventListener('change', (e) => {
          const arr = e.target.value.split(/[,;\s]+/).map(Number).filter((x) => x > 0);
          if (arr.length) { poser(g, p, arr); rafraichir(); }
        });
      } else {
        ligne.innerHTML = `<span>${p.nom}<small>${p.unite}</small></span>`
          + `<input type="range" min="${p.min}" max="${p.max}" step="${p.pas}" value="${v}">`
          + `<input type="number" min="${p.min}" max="${p.max}" step="${p.pas}" value="${v}">`;
        const [range, num] = ligne.querySelectorAll('input');
        const applique = (x) => { const n = +x; if (!Number.isFinite(n)) return; range.value = n; num.value = n; poser(g, p, n); rafraichir(); };
        range.addEventListener('input', (e) => applique(e.target.value));
        num.addEventListener('change', (e) => applique(e.target.value));
        champs.set(p.cle, { range, num, g, p });
      }
      det.appendChild(ligne);
    }
    corps.appendChild(det);
  }

  const boutons = document.createElement('div');
  boutons.className = 'reglages-boutons';
  boutons.innerHTML = `<button data-act="retablir" title="Revenir aux valeurs du fichier">Rétablir</button>`
    + `<button data-act="memoriser" title="Garder dans ce navigateur, appliqué à chaque partie">Mémoriser</button>`
    + `<button data-act="oublier" title="Effacer ce qui est mémorisé">Oublier</button>`
    + `<button data-act="json" title="Télécharger un fichier JSON">Exporter</button>`
    + `<button data-act="charger" title="Charger un fichier JSON exporté">Charger…</button>`
    + `<button data-act="js" title="Copier le réglage prêt à coller dans REGLAGES">Copier en JS</button>`
    + `<input type="file" accept="application/json" hidden>`
    + `<span class="reglages-note" id="reglages-note"></span>`;
  racine.appendChild(boutons);
  const note = boutons.querySelector('#reglages-note');
  const fichier = boutons.querySelector('input[type=file]');

  function paquet() {
    return { engin: nom, date: new Date().toISOString(), reglage: JSON.parse(JSON.stringify(reglage)),
             toucher: toucher ? { ...toucher } : undefined, saut: saut ? { ...saut } : undefined };
  }
  function appliquerPaquet(pq) {
    if (pq.reglage) pilote.regler(pq.reglage);
    if (toucher && pq.toucher) Object.assign(toucher, pq.toucher);
    if (saut && pq.saut) Object.assign(saut, pq.saut);
    relireChamps();
    rafraichir();
  }
  function relireChamps() {
    for (const { range, num, g, p } of champs.values()) {
      const v = valeur(g, p);
      range.value = v; num.value = v;
    }
    corps.querySelectorAll('select').forEach((s) => { s.value = reglage.motrice; });
    const liste = corps.querySelector('input[type=text]');
    if (liste) liste.value = (reglage.rapports || []).join(', ');
  }
  boutons.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'retablir') {
      pilote.regler(JSON.parse(JSON.stringify(baseR)));
      if (toucher) Object.assign(toucher, baseT);
      if (saut) Object.assign(saut, baseS);
      relireChamps(); rafraichir(); note.textContent = 'Valeurs du fichier.';
    } else if (act === 'memoriser') {
      memoriser(nom, paquet()); note.textContent = 'Mémorisé : appliqué à chaque partie.';
    } else if (act === 'oublier') {
      oublier(nom); note.textContent = 'Oublié. Les valeurs courantes restent jusqu’au rechargement.';
    } else if (act === 'json') {
      const blob = new Blob([JSON.stringify(paquet(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `reglages-${CLE(nom).slice(14)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      note.textContent = 'Fichier JSON téléchargé.';
    } else if (act === 'charger') {
      fichier.click();
    } else if (act === 'js') {
      const txt = enJS(reglage, CLE(nom).slice(14).replace(/-/g, '_'));
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
        () => { note.textContent = 'Copié : à coller dans REGLAGES (voiture-physique.js).'; },
        () => { console.log(txt); note.textContent = 'Presse-papiers refusé : le JS est dans la console.'; });
    }
  });
  fichier.addEventListener('change', () => {
    const f = fichier.files[0];
    if (!f) return;
    f.text().then((t) => { try { appliquerPaquet(JSON.parse(t)); note.textContent = `Chargé : ${f.name}`; } catch (err) { note.textContent = 'Fichier illisible.'; } });
    fichier.value = '';
  });

  let attente = 0;
  function rafraichir() {
    clearTimeout(attente);
    attente = setTimeout(() => {
      const m = banc(reglage);
      bancEl.innerHTML = lignesBanc(m).map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    }, 120);
  }
  rafraichir();

  const teleEl = tete.querySelector('#reglages-tele');
  function majTelemetrie() {
    const e = pilote.etat;
    if (!e) return;
    teleEl.textContent = `${e.kmh} km/h · ${e.rapport < 0 ? 'R' : e.rapport || '—'} · ${Math.round(e.regime)} tr/min · `
      + `${Math.abs(e.charge).toFixed(2)} g · dérive ${(Math.abs(e.glisseAv) * 57.3).toFixed(0)}° / ${(Math.abs(e.glisseAr) * 57.3).toFixed(0)}°`
      + (e.patinage > 1 ? ' · patine' : '');
  }

  return { demonter() { racine.innerHTML = ''; }, majTelemetrie, relireChamps };
}
