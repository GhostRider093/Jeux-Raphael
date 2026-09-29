/**
 * Téléphone et tablette (29/09/2026) : les enfants jouent surtout là-dessus.
 *
 * Mesuré en téléphone simulé : 800 Mo de textures en mémoire graphique, alors que
 * Safari ferme l'onglet bien avant (souvent vers 1 Go pour toute la page). La
 * plupart des modèles portent des textures 1024 à 3072 px qu'un écran de téléphone
 * n'affiche jamais en entier. On les ramène à un plafond, une fois chargées.
 *
 *   - téléphone : 512 px ;
 *   - tablette, et ordinateur en qualité Bas : 1024 px ;
 *   - sinon : rien ne change.
 */

export const TACTILE = matchMedia('(pointer: coarse)').matches;
/** 'telephone' | 'tablette' | 'ordinateur' — le petit côté de l'écran tranche. */
export const APPAREIL = !TACTILE ? 'ordinateur'
  : Math.min(screen.width, screen.height) < 600 ? 'telephone' : 'tablette';

/** Le plafond de texture en pixels, ou 0 pour ne rien toucher. */
export function plafondTextures(niveau) {
  if (APPAREIL === 'telephone') return 512;
  if (APPAREIL === 'tablette' || niveau === 'bas') return 1024;
  return 0;
}

const CARTES = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'specularMap', 'lightMap'];
const faites = new WeakSet();

/**
 * Réduit toutes les textures de `racine` plus grandes que `max` (le plus grand côté),
 * en gardant les proportions. Une texture déjà envoyée à la carte est renvoyée
 * plus petite : WebGL libère l'ancienne place. Sans effet sur les textures de
 * données (relief, instances) ni sur les textures compressées.
 * @returns {number} Mo de mémoire graphique rendus (estimation, mipmaps comprises)
 */
export function plafonnerTextures(racine, max) {
  if (!max) return 0;
  let rendu = 0;
  racine.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) {
      for (const cle of CARTES) {
        const t = m[cle];
        if (!t || faites.has(t) || t.isDataTexture || t.isCompressedTexture || t.isVideoTexture) continue;
        faites.add(t);
        const im = t.image;
        if (!im || !im.width || !im.height || Math.max(im.width, im.height) <= max) continue;
        if (typeof im.getContext !== 'function' && typeof ImageBitmap !== 'undefined' && !(im instanceof ImageBitmap)
          && !(im instanceof HTMLImageElement)) continue;
        const k = max / Math.max(im.width, im.height);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.width * k));
        c.height = Math.max(1, Math.round(im.height * k));
        try {
          c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        } catch { continue; }        // image d'une autre origine : on la laisse
        rendu += (im.width * im.height - c.width * c.height) * 4 * 1.33 / 1e6;
        if (typeof im.close === 'function') im.close();   // ImageBitmap : libère la mémoire tout de suite
        t.image = c;
        t.needsUpdate = true;
      }
    }
  });
  return Math.round(rendu);
}
