/**
 * Survol de Poilhes au chasseur.
 *
 * C'est le MÊME appareil que la ville et les Mondes, et il se pilote pareil :
 *   - le maillage vient de `window.RaphaelChasseur` (chasseur-model.js),
 *   - la loi de pilotage vient de `window.RaphaelFlightModel` (flight-model.js),
 *     appelée ici dans le même ordre que `maps/world-game.js`.
 * Rien n'est réécrit : un avion qui répondrait autrement selon la page est
 * exactement ce que ces deux fichiers ont été créés pour empêcher.
 *
 * Ce qui est propre au village, et seulement cela : la taille du terrain
 * (1 km détaillé, 6 km de relief au total) et le plancher, qui suit les toits
 * et les houppiers par `surfaceAt` — on rase les tuiles, on ne les traverse pas.
 *
 * Aucune allocation dans update() : vecteurs et quaternions sont réservés.
 */
import * as THREE from 'three';
import { smoothing, rampKey } from '../input-shaping.js';

// Vitesses des Mondes hors circuit de course : l'appareil doit se comporter
// de la même façon partout, y compris dans ce qu'il a dans le pied droit.
const CROISIERE = 38, PLEIN = 72, BOOST = 92;
const PLAFOND = 1400;          // altitude maximale (m)
const GARDE = 9;               // marge au-dessus du relief, des toits et des arbres
const LIMITE = 2900;           // bord du relief lointain (m depuis le centre)
const DEPART = 160;            // altitude d'entrée en vol (m au-dessus du sol)

export function createJet({ scene, camera, groundAt, surfaceAt, keys }) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  const vol = window.RaphaelFlightModel;
  const orientation = new THREE.Quaternion();
  const avant = new THREE.Vector3(0, 0, -1);
  const haut = new THREE.Vector3(0, 1, 0);
  const camAvant = new THREE.Vector3();
  const voulue = new THREE.Vector3();
  const regard = new THREE.Vector3();
  const hautMonde = new THREE.Vector3(0, 1, 0);

  const state = {
    vitesse: CROISIERE, consigne: CROISIERE, cran: 1,
    contact: 0, large: true, lancement: 0, temps: 0,
  };
  let keyYaw = 0, keyPitch = 0, appareil = null, chargement = null, vueArmee = false;

  const tenu = (code) => keys.has(code);
  // Consigne tactile : le glissé du pouce droit tient lieu de manche.
  const doigt = { x: 0, y: 0 };
  function commande(x, y) {
    doigt.x = vol.clamp(x, -1, 1);
    doigt.y = vol.clamp(y, -1, 1);
  }

  /** Charge le chasseur d'origine, aux réglages des Mondes. */
  function load() {
    if (chargement) return chargement;
    chargement = window.RaphaelChasseur.construire({
      longueur: 16,
      reacteurs: true,
      effets: true,
      missiles: true,
      teinte: 0x59636e,
    }).then((obj) => {
      appareil = obj;
      root.add(appareil);
      return appareil;
    });
    return chargement;
  }

  /** Plancher au point (x, z) : le relief, ou le toit et le houppier s'ils dépassent. */
  function plancher(x, z) {
    return Math.max(groundAt(x, z), surfaceAt(x, z)) + GARDE;
  }

  /** Entrée en vol au-dessus de (x, z), cap `yaw`. */
  async function enter(x, z, yaw = 0) {
    await load();
    root.visible = true;
    root.position.set(x, plancher(x, z) + DEPART, z);
    orientation.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    root.quaternion.copy(orientation);
    state.vitesse = PLEIN;
    state.consigne = PLEIN;
    state.cran = 1;
    state.lancement = 2.0;
    state.large = true;
    keyYaw = keyPitch = 0;
    // caméra posée d'emblée derrière l'appareil : pas de long glissé à l'entrée
    avant.set(0, 0, -1).applyQuaternion(orientation);
    camera.up.copy(hautMonde);
    camera.position.copy(root.position).addScaledVector(avant, -112).addScaledVector(hautMonde, 32);
    camera.lookAt(root.position);
  }

  /** Sortie : la verticale de la caméra doit revenir au monde, sinon tout penche. */
  function exit() {
    root.visible = false;
    camera.up.copy(hautMonde);
  }

  function update(dt) {
    if (!root.visible || !appareil) return;
    state.temps += dt;

    // ── COMMANDES ─────────────────────────────────────────────────────────
    // Flèches : gauche/droite = roulis, haut = monter (une flèche est une
    // direction, pas un manche — voir le commentaire de world-game.js).
    keyYaw = rampKey(keyYaw, (tenu('ArrowLeft') ? -1 : 0) + (tenu('ArrowRight') ? 1 : 0), dt);
    keyPitch = rampKey(keyPitch, (tenu('ArrowUp') ? 1 : 0) + (tenu('ArrowDown') ? -1 : 0), dt);
    // Le pouce glissé vers le haut cabre, comme une flèche qui pointe en haut.
    const yawInput = vol.clamp(keyYaw + doigt.x, -1, 1);
    const pitchInput = vol.clamp(keyPitch - doigt.y, -1, 1);
    const montee = vol.clamp((tenu('KeyE') || tenu('PageUp') ? 1 : 0)
      + (tenu('ControlLeft') || tenu('ControlRight') || tenu('PageDown') ? -1 : 0), -1, 1);

    // ── RÉGIME ────────────────────────────────────────────────────────────
    let consigne = CROISIERE;
    if (tenu('KeyW') || tenu('KeyZ')) consigne = PLEIN;                    // Z sur AZERTY
    if (tenu('ShiftLeft') || tenu('ShiftRight')) consigne = BOOST;
    if (tenu('KeyS')) consigne = 0;
    // Cran de poursuite : + et -, dans leurs trois exemplaires de clavier français
    const cranPlus = tenu('NumpadAdd') || tenu('Equal') || tenu('BracketRight');
    const cranMoins = tenu('NumpadSubtract') || tenu('Minus') || tenu('Slash');
    state.cran = vol.advanceChase(state.cran, cranPlus, cranMoins, dt);
    consigne *= state.cran;
    if (state.lancement > 0) {
      state.lancement = Math.max(0, state.lancement - dt);
      consigne = Math.max(consigne, 78);
    }
    state.consigne = consigne;
    state.vitesse = vol.advanceSpeed(state.vitesse, consigne, dt);

    // ── PILOTAGE ──────────────────────────────────────────────────────────
    // L'axe gauche/droite commande le ROULIS : l'appareil vire parce qu'il est
    // incliné, c'est le virage induit qui s'en charge.
    vol.tourner(orientation, -yawInput, pitchInput, 0, dt);
    avant.set(0, 0, -1).applyQuaternion(orientation);
    haut.set(0, 1, 0).applyQuaternion(orientation);
    vol.virageInduit(orientation, haut, avant, dt);
    vol.stabiliser(orientation, haut, avant,
      Math.max(Math.abs(yawInput), Math.abs(pitchInput)), dt);

    // ── DÉPLACEMENT ───────────────────────────────────────────────────────
    const p = root.position;
    const vitesseVerticale = avant.y * state.vitesse + montee * CROISIERE * vol.TUNING.climbRatio;
    p.x += avant.x * state.vitesse * dt;
    p.y += vitesseVerticale * dt;
    p.z += avant.z * state.vitesse * dt;
    p.x = vol.clamp(p.x, -LIMITE, LIMITE);
    p.z = vol.clamp(p.z, -LIMITE, LIMITE);
    const sol = plancher(p.x, p.z);
    if (p.y < sol) {
      // Au contact, l'appareil est remis sur le relief et cabré par la commande
      // de tangage du modèle de vol : le village se visite, il ne se crashe pas.
      p.y = sol;
      if (avant.y < 0.02) vol.tourner(orientation, 0, 1, 0, dt * 2.2);
      vol.stabiliser(orientation, haut, avant, 0, dt * 4);
      state.contact = 0.5;
    } else if (state.contact > 0) {
      state.contact -= dt;
    }
    p.y = Math.min(p.y, PLAFOND);
    root.quaternion.copy(orientation);

    // Régime des réacteurs : c'est lui qui allume les tuyères.
    window.RaphaelChasseur.regime(appareil, Math.min(1, state.vitesse / BOOST));

    placerCamera(dt);
  }

  /** Caméra de poursuite des Mondes : la verticale est celle de l'APPAREIL. */
  function placerCamera(dt) {
    const p = root.position;
    const ratio = Math.min(1, state.vitesse / PLEIN);
    camera.up.copy(haut);
    camAvant.copy(avant);
    const recul = state.large ? 112 : 61 + ratio * 21;
    const hauteur = state.large ? 32 : 15 + ratio * 4;
    voulue.copy(p).addScaledVector(camAvant, -recul).addScaledVector(haut, hauteur);
    // jamais sous le relief : on remonte la caméra plutôt que de la noyer
    const mini = plancher(voulue.x, voulue.z) - GARDE + 4;
    if (voulue.y < mini) voulue.y = mini;
    camera.position.lerp(voulue, smoothing(11, dt));
    regard.copy(p).addScaledVector(avant, 43);
    camera.lookAt(regard);
  }

  /** V : caméra large ou serrée. */
  function basculerVue() {
    state.large = !state.large;
    return state.large;
  }

  /** Lu par le HUD : vitesse en km/h et hauteur au-dessus du sol. */
  function telemetrie() {
    const p = root.position;
    return {
      vitesse: Math.round(state.vitesse * 3.6),
      hauteur: Math.max(0, Math.round(p.y - plancher(p.x, p.z) + GARDE)),
      altitude: Math.round(p.y),
    };
  }

  return { load, enter, exit, update, basculerVue, commande, telemetrie, root, state,
    get vueArmee() { return vueArmee; } };
}
