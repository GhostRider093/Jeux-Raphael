#!/usr/bin/env node
// ==========================================================================
//  BANC D'ESSAI DE LA CONDUITE — en ligne de commande, sans navigateur
// --------------------------------------------------------------------------
//  La même physique que sous les roues (`maps/voiture-physique.js`), les mêmes
//  épreuves que le panneau de réglage (touche T en jeu, `maps/reglages.js`) :
//  0 → 100, vitesse maxi, freinage, virage tenu, vivacité, frein à main.
//
//    node scripts/banc-voiture.mjs                 # les trois engins du fichier
//    node scripts/banc-voiture.mjs gt              # un seul
//    node scripts/banc-voiture.mjs reglages.json   # un fichier exporté par le panneau
//    node scripts/banc-voiture.mjs gt --json       # sortie brute, pour un autre outil
//
//  Un fichier JSON est soit un réglage nu (les clés de REGLAGES), soit le
//  paquet du panneau { engin, reglage, toucher, saut }.
// ==========================================================================
import { readFileSync } from 'node:fs';
import { REGLAGES } from '../maps/voiture-physique.js';
import { banc, lignesBanc } from '../maps/reglages.js';

const args = process.argv.slice(2);
const brut = args.includes('--json');
const cibles = args.filter((a) => !a.startsWith('--'));

function charger(nom) {
  if (REGLAGES[nom]) return { nom: `${nom} — ${REGLAGES[nom].nom}`, reglage: REGLAGES[nom] };
  const j = JSON.parse(readFileSync(nom, 'utf8'));
  const reglage = j.reglage || j;
  if (!reglage.rapports) throw new Error(`${nom} : pas un réglage (il manque "rapports")`);
  return { nom: `${nom}${j.engin ? ` — ${j.engin}` : ''}`, reglage };
}

const liste = (cibles.length ? cibles : Object.keys(REGLAGES)).map(charger);
const sortie = {};
for (const { nom, reglage } of liste) {
  const m = banc(reglage);
  sortie[nom] = m;
  if (brut) continue;
  console.log(`\n${nom}`);
  const L = lignesBanc(m);
  const larg = Math.max(...L.map(([k]) => k.length));
  for (const [k, v] of L) console.log(`  ${k.padEnd(larg)}  ${v}`);
}
if (brut) console.log(JSON.stringify(sortie, null, 2));
