// =====================================================================
//  Étrier réglable pour scotcher 2 ventilateurs sur un radiateur
// =====================================================================
//
//  Principe :
//    - Un socle central fixe.
//    - Deux bras plats coulissants (droite / gauche), chacun terminé
//      par une patte en L sur laquelle on colle le scotch double-face
//      contre le ventilateur.
//    - Chaque bras a un trou oblong (une "course" de 7.5 mm) traversé
//      par UNE vis centrale M5 commune aux deux bras, empilés l'un sur
//      l'autre au-dessus du socle.
//    - On règle l'écartement des deux pattes à la main (de ecart_max,
//      position ouverte, à ecart_min, position resserrée), puis on
//      serre la vis centrale : elle plaque les deux bras l'un contre
//      l'autre et contre le socle, et les bloque par friction, comme
//      la vis de blocage d'une jambe de force / d'un support de carte
//      graphique.
//
//  Impression (3 pièces) :
//    - 1x socle()  -> piece = "socle"
//    - 2x bras()   -> piece = "bras"  (imprimer 2 fois LA MÊME pièce ;
//      pour le bras gauche, prendre la 2e pièce imprimée et la tourner
//      de 180° autour de l'axe vertical avant montage : la pièce est
//      symétrique, inutile de la mettre en miroir dans le slicer)
//
//  Visserie : 1 vis M5 (tête bombée ou fraisée) + 1 écrou M5,
//    longueur de vis conseillée >= hauteur_socle + 2*epaisseur_bras + 8mm
//    (avec les valeurs par défaut : 6 + 2*4 + 8 = 22 -> prendre du M5x25).
//    Glisser une rondelle large (diamètre >= 23mm, cf. diam_rondelle)
//    sous la tête de vis pour qu'elle plaque bien sur toute la longueur
//    du trou oblong, quelle que soit la position choisie.
//
//  Toutes les cotes sont paramétriques : ajuste ecart_max / ecart_min
//  et les dimensions des pattes à ton radiateur / tes ventilateurs.
// =====================================================================

/* [Rendu] */
piece = "assemblage"; // ["assemblage","socle","bras"]
position_apercu = "ouvert"; // ["ouvert","ferme"] (utilisé seulement si piece = "assemblage")
explosion = 10; // ecart (mm) entre socle/bras en vue eclatee, pour que le CAO
                // les reconnaisse comme 3 corps separes et non une piece collee.
                // Mettre 0 pour voir l'assemblage reellement au contact.

/* [Ecartement exterieur des pattes (mm)] */
ecart_max = 180; // position ouverte
ecart_min = 150; // position resserree (vers le centre)

/* [Bras coulissant] */
epaisseur_bras = 4;
largeur_bras   = 16;

/* [Patte de fixation (semelle collee au scotch double-face)] */
largeur_patte   = 34;
longueur_patte  = 22;
epaisseur_patte = 4;
hauteur_rebord  = 16;  // rebord en L, prend appui sur le bord du radiateur/ventilo
rayon_arrondi   = 2;

/* [Socle central] */
longueur_socle       = 32;
hauteur_socle        = 6;
rayon_arrondi_socle  = 3;

/* [Visserie M5] */
diam_vis          = 5.4;  // passage de la tige (M5 + jeu)
entredeplats_ecrou = 8.3; // ecrou M5 (8mm) + jeu
haut_ecrou        = 4.5;  // hauteur de l'empreinte hexagonale
diam_rondelle     = 23;   // diametre mini de rondelle conseille (info),
                           // doit rester > travel + diam_vis pour toujours
                           // recouvrir le trou oblong, quelle que soit la position
jeu               = 0.3;

$fn = 48;

// ---- Valeurs calculees ----
travel        = (ecart_max - ecart_min) / 2; // course de chaque bras
longueur_bras = ecart_max / 2;               // du centre a l'extremite de la patte, position ouverte
largeur_socle = largeur_bras + 8;

echo(str("Course par bras : ", travel, " mm"));
echo(str("Vis M5 conseillee : longueur >= ", hauteur_socle + 2*epaisseur_bras + 8, " mm"));

// =====================================================================
//  Modules utilitaires
// =====================================================================
module boite_arrondie(l, w, h, r) {
    hull() {
        for (x = [r, l - r], y = [r, w - r])
            translate([x, y, 0]) cylinder(r = r, h = h, $fn = 24);
    }
}

module ecrou_hexa(entredeplats, h) {
    // cylindre a 6 faces : le parametre d de cylinder() est le diametre
    // circonscrit (pointe a pointe), a deduire de l'entre-plats
    cylinder(d = entredeplats / cos(30), h = h, $fn = 6);
}

// =====================================================================
//  Socle central (1x a imprimer)
// =====================================================================
module socle() {
    difference() {
        translate([-longueur_socle/2, -largeur_socle/2, 0])
            boite_arrondie(longueur_socle, largeur_socle, hauteur_socle, rayon_arrondi_socle);

        // passage de la vis, sur toute la hauteur du socle
        translate([0, 0, -1])
            cylinder(d = diam_vis, h = hauteur_socle + 2);

        // empreinte hexagonale de l'ecrou, debouchante sous le socle
        translate([0, 0, -0.5])
            ecrou_hexa(entredeplats_ecrou, haut_ecrou + 0.5);
    }
}

// =====================================================================
//  Bras coulissant + patte (imprimer 2x la meme piece)
//  Repere local : x=0 -> debut de la course de la vis (cote centre)
//                 x=longueur_bras -> extremite de la patte
// =====================================================================
module bras() {
    marge = diam_vis/2 + 3;

    union() {
        // barre plate coulissante
        translate([-marge, -largeur_bras/2, 0])
            boite_arrondie(marge + longueur_bras, largeur_bras, epaisseur_bras, 1.5);

        // patte terminale : semelle + rebord en L
        translate([longueur_bras - longueur_patte, -largeur_patte/2, 0]) {
            boite_arrondie(longueur_patte, largeur_patte, epaisseur_patte, rayon_arrondi);
            translate([longueur_patte - epaisseur_patte, 0, 0])
                cube([epaisseur_patte, largeur_patte, hauteur_rebord]);
        }
    }
}

module bras_perce() {
    difference() {
        bras();
        // trou oblong (course = travel) pour la vis centrale commune
        translate([0, 0, -1])
            hull() {
                cylinder(d = diam_vis, h = epaisseur_bras + 2);
                translate([travel, 0, 0]) cylinder(d = diam_vis, h = epaisseur_bras + 2);
            }
    }
}

// =====================================================================
//  Assemblage (vue eclatee : socle / bras gauche / bras droit sont
//  ecartes de "explosion" mm entre eux pour rester 3 corps distincts
//  a l'export/dans le CAO, au lieu d'une seule piece collee. Mettre
//  explosion = 0 pour verifier l'assemblage reellement au contact.
//  Ne pas imprimer tel quel : exporter separement piece="socle" et
//  piece="bras" (x2).
// =====================================================================
module assemblage(position) {
    dx = (position == "ouvert") ? 0 : -travel;

    z_gauche = hauteur_socle + explosion;
    z_droit  = z_gauche + epaisseur_bras + explosion;

    socle();

    // bras gauche (symetrique)
    mirror([1, 0, 0])
        translate([dx, 0, z_gauche])
            bras_perce();

    // bras droit (au-dessus)
    translate([dx, 0, z_droit])
        bras_perce();
}

// =====================================================================
//  Selection de la piece a afficher / exporter
// =====================================================================
if (piece == "assemblage") {
    assemblage(position_apercu);
} else if (piece == "socle") {
    socle();
} else if (piece == "bras") {
    bras_perce();
}
