/**
 * Le coupe-son général — **Maj + M**, sur n'importe quelle page du jeu.
 *
 * Il ne suffit pas de corriger un son de trop à la fois : il faut pouvoir
 * arrêter le bruit tout de suite, sans chercher quel module le produit, sans
 * recharger, et sans que la question se repose au prochain chargement.
 *
 * Ce script se charge **avant tous les autres** et se place à la source : il
 * enveloppe le constructeur d'`AudioContext` et la méthode `play()` des
 * balises audio. Tout ce qui voudra faire du son dans la page devra donc
 * passer par ici, y compris les modules écrits plus tard et ceux qu'on a
 * oubliés. Couper, c'est alors :
 *
 *   — suspendre tous les contextes audio déjà créés,
 *   — mettre en pause toutes les balises `<audio>`,
 *   — refuser les `resume()` et les `play()` suivants,
 *   — suspendre d'office tout contexte créé après coup.
 *
 * Le choix est retenu (`localStorage`) : une page rechargée reste muette.
 *
 * Console : `RaphaelSilence.couper()`, `.remettre()`, `.etat()`.
 */
(function () {
  'use strict';

  const CLE = 'raphael-silence';
  let coupe = false;
  try { coupe = localStorage.getItem(CLE) === '1'; } catch (e) { /* mode privé */ }

  const contextes = new Set();
  const Origine = window.AudioContext || window.webkitAudioContext;

  if (Origine) {
    // Un `Proxy` sur le constructeur : les instances gardent leur prototype,
    // donc rien ne casse — on ne fait que les inscrire au passage.
    const Enveloppe = new Proxy(Origine, {
      construct(cible, args, neuf) {
        const c = Reflect.construct(cible, args, neuf);
        contextes.add(c);
        if (coupe) { try { c.suspend(); } catch (e) { /* déjà suspendu */ } }
        return c;
      },
    });
    window.AudioContext = Enveloppe;
    if (window.webkitAudioContext) window.webkitAudioContext = Enveloppe;

    // `resume()` est le vrai point de passage : beaucoup de modules le
    // rappellent à chaque geste du joueur. Tant qu'on est muet, il ne fait rien.
    const resume = Origine.prototype.resume;
    Origine.prototype.resume = function () {
      if (coupe) return Promise.resolve();
      return resume.apply(this, arguments);
    };
  }

  // Les balises `<audio>` ne passent pas par un contexte : même traitement.
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (coupe) return Promise.resolve();
    return play.apply(this, arguments);
  };

  function appliquer() {
    if (!coupe) return;
    for (const c of contextes) { try { c.suspend(); } catch (e) { /* rien à faire */ } }
    for (const a of document.querySelectorAll('audio, video')) { try { a.pause(); } catch (e) { /* rien */ } }
  }

  function afficher(texte) {
    let bulle = document.getElementById('raphael-silence-bulle');
    if (!bulle) {
      bulle = document.createElement('div');
      bulle.id = 'raphael-silence-bulle';
      bulle.style.cssText = 'position:fixed;left:50%;top:22px;transform:translateX(-50%);'
        + 'z-index:99999;padding:10px 18px;border-radius:10px;pointer-events:none;'
        + 'background:rgba(10,14,20,.88);border:1px solid rgba(255,255,255,.18);'
        + 'color:#eaf1f7;font:600 14px/1 system-ui,sans-serif;letter-spacing:.02em;'
        + 'transition:opacity .25s;';
      document.body.appendChild(bulle);
    }
    bulle.textContent = texte;
    bulle.style.opacity = '1';
    clearTimeout(afficher.minuteur);
    afficher.minuteur = setTimeout(() => { bulle.style.opacity = '0'; }, 1600);
  }

  function couper() {
    coupe = true;
    try { localStorage.setItem(CLE, '1'); } catch (e) { /* mode privé */ }
    appliquer();
    return true;
  }

  function remettre() {
    coupe = false;
    try { localStorage.setItem(CLE, '0'); } catch (e) { /* mode privé */ }
    return false;
  }

  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || !e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    const cible = e.target;
    if (cible && /^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName)) return;
    e.preventDefault();
    if (coupe) { remettre(); afficher('Son rétabli'); }
    else { couper(); afficher('Son coupé — Maj + M pour le remettre'); }
  });

  // Au chargement d'une page déjà mise en sourdine : on réapplique dès que le
  // document existe, puis une fois de plus après, pour les modules qui créent
  // leur contexte au premier geste du joueur.
  addEventListener('DOMContentLoaded', appliquer);
  addEventListener('load', appliquer);

  window.RaphaelSilence = {
    couper, remettre,
    basculer: () => (coupe ? remettre() : couper()),
    etat: () => ({ coupe, contextes: contextes.size }),
  };
})();
