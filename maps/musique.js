/**
 * La playlist du jeu, partout — les dix « SP-12000 Soul Run » d'Arnaud.
 *
 * Arnaud, 26/09/2026 : « rajoute la musique partout, dans le chasseur aussi ;
 * c'est dommage de ne pas l'avoir ». Poilhes City (`rouler.html`) a sa propre
 * playlist depuis le 24/09 ; ce module sert les autres pages (les Mondes, la
 * visite de Poilhes) avec les mêmes morceaux, le même ordre au hasard, et la
 * **même préférence** : couper la musique ici la coupe aussi dans Poilhes City
 * (clé `poilhes-city-musique`, partagée).
 *
 * Les navigateurs interdisent le son avant un premier geste : la lecture part
 * au premier clic ou à la première touche. Un petit bouton ♪ (en bas à gauche,
 * ou là où on le place) coupe et rallume.
 */
const CLE_MUSIQUE = 'poilhes-city-musique';
const CLE_DERNIERE = 'poilhes-city-derniere-piste';
const MORCEAUX = 10;

function melanger(liste) {
  for (let i = liste.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [liste[i], liste[j]] = [liste[j], liste[i]];
  }
  return liste;
}

/**
 * @param {object} [o]
 * @param {number} [o.volume=0.3]
 * @param {boolean} [o.bouton=true]   ajouter le bouton ♪
 * @param {string}  [o.base='']       préfixe des chemins (page dans un sous-dossier)
 * @param {string}  [o.place]         où poser le bouton (CSS : `right:14px;top:90px`…)
 * @returns {{ jouer(), couper(), basculer(), get active() }}
 */
export function creerMusique({ volume = 0.3, bouton = true, base = '', place = 'left:14px;bottom:14px' } = {}) {
  const ordre = melanger([...Array(MORCEAUX).keys()].map((k) => k + 1));
  try {
    const derniere = +localStorage.getItem(CLE_DERNIERE);
    if (derniere && ordre[0] === derniere) ordre.push(ordre.shift());
  } catch { /* mode privé */ }
  let piste = 0;
  const audio = new Audio(`${base}assets/musique/accueil-soul-run-${ordre[0]}.mp3?v=musique-20260925`);
  audio.preload = 'auto';
  audio.volume = volume;
  audio.addEventListener('ended', () => {
    piste = (piste + 1) % ordre.length;
    audio.src = `${base}assets/musique/accueil-soul-run-${ordre[piste]}.mp3?v=musique-20260925`;
    jouer();
  });

  let voulue = true;
  try { voulue = localStorage.getItem(CLE_MUSIQUE) !== '0'; } catch { /* mode privé */ }

  function jouer() {
    if (!voulue) return;
    const p = audio.play();
    const retenir = () => { try { localStorage.setItem(CLE_DERNIERE, String(ordre[piste])); } catch { /* rien */ } };
    if (p?.then) p.then(retenir).catch(() => {}); else retenir();
  }
  function couper() { audio.pause(); }

  let el = null;
  function peindre() { if (el) { el.textContent = voulue ? '♪' : '♪̸'; el.title = voulue ? 'Couper la musique' : 'Remettre la musique'; el.style.opacity = voulue ? '1' : '0.55'; } }
  function basculer() {
    voulue = !voulue;
    try { localStorage.setItem(CLE_MUSIQUE, voulue ? '1' : '0'); } catch { /* rien */ }
    peindre();
    if (voulue) jouer(); else couper();
    return voulue;
  }

  if (bouton) {
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'bouton-musique';
    el.style.cssText = `position:fixed;${place};z-index:50;width:42px;height:42px;border-radius:50%;border:0;`
      + 'font:700 20px system-ui,sans-serif;color:#141414;background:#ffd21f;cursor:pointer;box-shadow:0 2px 8px #0006';
    el.addEventListener('click', (e) => { e.stopPropagation(); el.blur(); basculer(); });
    document.body.appendChild(el);
    peindre();
  }

  // Le son n'a le droit de partir qu'après un geste.
  const premierGeste = () => jouer();
  document.addEventListener('pointerdown', premierGeste, { once: true, capture: true });
  document.addEventListener('keydown', premierGeste, { once: true, capture: true });
  // Onglet caché : on se tait, et on reprend au retour.
  document.addEventListener('visibilitychange', () => { if (document.hidden) couper(); else jouer(); });

  return { jouer, couper, basculer, get active() { return voulue; }, audio };
}
