/**
 * Shaders procéduraux du village de Poilhes.
 *
 * Chaque matériau est un MeshStandardMaterial de Three.js (lumière, ombres, brouillard
 * et reflets inchangés) dont on remplace la couleur, la rugosité et la normale par
 * des motifs calculés : façades méditerranéennes, tuiles canal, sol, eau, feuillage.
 * Aucune texture externe n'est nécessaire en dehors de l'orthophoto IGN.
 */

/** Bruits et utilitaires GLSL partagés. */
export const NOISE = /* glsl */ `
float h1(float n) { return fract(sin(n * 127.1) * 43758.5453123); }
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
/* Normale perturbée par un relief H (mètres) — méthode des dérivées écran. */
vec3 bumpNormal(vec3 N, vec3 viewPos, float H) {
  vec3 dpdx = dFdx(-viewPos), dpdy = dFdy(-viewPos);
  float Hx = dFdx(H), Hy = dFdy(H);
  vec3 R1 = cross(dpdy, N), R2 = cross(N, dpdx);
  float det = dot(dpdx, R1);
  vec3 grad = sign(det) * (Hx * R1 + Hy * R2);
  return normalize(abs(det) * N - grad);
}
`;

/**
 * Façade : fenêtres, volets, portes, génoise, soubassement et vieillissement.
 * Entrées (varyings) : vFac = (u le long du mur, hauteur au-dessus du sol de référence,
 * longueur du mur, hauteur d'égout), vInfo = (sol local, ligne de toit, graine, style*8+drapeaux).
 */
const FACADE = /* glsl */ `
varying vec4 vFac;
varying vec4 vInfo;
varying vec3 vWPos;

const vec3 STUCCO_PAL[10] = vec3[10](
  vec3(0.87, 0.80, 0.67), vec3(0.86, 0.72, 0.52), vec3(0.82, 0.74, 0.60), vec3(0.87, 0.73, 0.64),
  vec3(0.80, 0.78, 0.73), vec3(0.89, 0.69, 0.55), vec3(0.91, 0.80, 0.56), vec3(0.93, 0.90, 0.84),
  vec3(0.84, 0.67, 0.50), vec3(0.88, 0.84, 0.74));
const vec3 SHUTTER_PAL[8] = vec3[8](
  vec3(0.36, 0.50, 0.56), vec3(0.30, 0.43, 0.31), vec3(0.47, 0.21, 0.19), vec3(0.58, 0.58, 0.55),
  vec3(0.43, 0.31, 0.21), vec3(0.58, 0.68, 0.71), vec3(0.62, 0.66, 0.52), vec3(0.24, 0.30, 0.38));

/* Moellons : pierres irrégulières (cellules de Voronoï aplaties) noyées dans le mortier. */
vec3 rubbleWall(vec2 p, float seed, out float relief) {
  vec2 q = p * vec2(3.3, 4.9) + seed * 17.0;
  vec2 i = floor(q), f = fract(q);
  float d1 = 8.0, d2 = 8.0;
  vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(h2(i + g), h2(i + g + 41.3)) * 0.8 + 0.1;
      float d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; id = i + g; } else if (d < d2) { d2 = d; }
    }
  }
  float edge = d2 - d1;                                  // 0 sur la limite entre deux pierres
  float stoneMask = smoothstep(0.06, 0.2, edge);
  float k = h2(id);
  vec3 a = srgb(vec3(0.76, 0.68, 0.55)), b = srgb(vec3(0.64, 0.60, 0.53)), c = srgb(vec3(0.79, 0.62, 0.45));
  vec3 st = mix(mix(a, b, k), c, step(0.78, h2(id + 7.0)) * 0.7);
  st *= 0.78 + 0.3 * fbm(p * 6.0 + k * 9.0);
  st *= 0.85 + 0.2 * smoothstep(0.0, 0.5, edge);        // pierres bombées : bords plus sombres
  vec3 mortar = srgb(vec3(0.78, 0.73, 0.64)) * (0.82 + 0.25 * vnoise(p * 24.0));
  relief = stoneMask * 0.03 * smoothstep(0.0, 0.45, edge);
  return mix(mortar, st, stoneMask);
}

/* Pierre : moellons irréguliers (rubble=1) ou pierre de taille (0). */
vec3 stoneWall(vec2 p, float seed, float rubble, out float relief) {
  if (rubble > 0.5) return rubbleWall(p, seed, relief);
  float rh = mix(0.34, 0.26, rubble);
  float row = floor(p.y / rh);
  float ry = fract(p.y / rh);
  float bw = mix(0.72, 0.45, rubble) * (0.8 + 0.4 * h1(row + seed * 13.0));
  float x = p.x / bw + mix(0.5 * mod(row, 2.0), h1(row * 7.3 + seed), rubble);
  float ci = floor(x), fx = fract(x);
  float joint = mix(0.035, 0.08, rubble);
  float m = smoothstep(0.0, joint, fx) * smoothstep(1.0, 1.0 - joint, fx)
          * smoothstep(0.0, joint * 2.0, ry) * smoothstep(1.0, 1.0 - joint * 2.0, ry);
  float id = h2(vec2(ci, row) + seed);
  vec3 a = srgb(vec3(0.78, 0.70, 0.56)), b = srgb(vec3(0.66, 0.62, 0.55)), c = srgb(vec3(0.74, 0.60, 0.44));
  vec3 st = mix(mix(a, b, id), c, step(0.8, h2(vec2(row, ci) + 3.0)) * 0.6);
  st *= 0.84 + 0.28 * fbm(p * 5.0 + id * 9.0);
  vec3 mortar = srgb(vec3(0.72, 0.68, 0.60)) * (0.85 + 0.2 * vnoise(p * 20.0));
  relief = m * (0.012 + 0.02 * rubble * fbm(p * 8.0 + id));
  return mix(mortar, st, m);
}

void facade(out vec3 col, out float rough, out float relief, out float spec, out vec3 glow) {
  float u = vFac.x, v = vFac.y, L = vFac.z, eave = vFac.w;
  // graine arrondie : l'interpolation la bruite légèrement, et les hachages amplifient ce bruit
  float gr = vInfo.x, roofLine = vInfo.y, seed = floor(vInfo.z * 1000.0 + 0.5) / 1000.0;
  float packed = floor(vInfo.w + 0.5);
  float style = floor(packed / 8.0 + 0.01);
  float flags = packed - style * 8.0;
  bool party = mod(flags, 2.0) > 0.5;
  bool street = mod(floor(flags / 2.0), 2.0) > 0.5;
  bool modern = style > 4.5;
  bool oldStyle = style < 1.5;
  vec2 p = vec2(u, v);
  relief = 0.0;
  rough = 0.9;
  spec = 0.0;
  glow = vec3(0.0);
  // taille d'un pixel sur le mur (m) : les motifs plus fins s'estompent au loin (pas de scintillement)
  float pxs = max(length(vec2(dFdx(u), dFdy(u))), length(vec2(dFdx(v), dFdy(v))));
  float fine = 1.0 - smoothstep(0.015, 0.05, pxs);

  // ---------------------------------------------------------------- matériau du mur
  vec3 wall;
  if (style > 0.5 && style < 2.5) {
    wall = stoneWall(p, seed, style < 1.5 ? 1.0 : 0.0, relief);
    wall = mix(srgb(vec3(0.70, 0.64, 0.54)) * 0.9, wall, fine);
    relief *= fine;
  } else if (style > 2.5 && style < 3.5) {             // cave, hangar : enduit clair, bandeaux
    wall = srgb(vec3(0.85, 0.80, 0.69)) * (0.88 + 0.14 * fbm(p * 1.5 + seed));
    wall *= 1.0 - 0.05 * step(0.93, fract(v / 2.2));
  } else if (style > 3.5 && style < 4.5) {             // annexe : parpaing enduit brut
    wall = srgb(mix(vec3(0.74, 0.71, 0.64), vec3(0.82, 0.76, 0.65), seed)) * (0.86 + 0.2 * fbm(p * 4.0));
  } else {
    vec3 base = STUCCO_PAL[int(floor(seed * 9.99))];
    if (modern) base = mix(base, vec3(0.94, 0.92, 0.87), 0.55);
    wall = srgb(base);
    float grain = vnoise(p * 38.0) * 0.5 + vnoise(p * 90.0) * 0.5;
    // La variation de moyenne fréquence est ce qui reste visible à trente mètres :
    // sans elle, un enduit est un aplat, et une façade un carton.
    wall *= (modern ? 0.90 : 0.84) + (modern ? 0.15 : 0.20) * fbm(p * 0.9 + seed * 20.0) + 0.04 * grain;
    wall *= 0.94 + 0.12 * fbm(p * 0.28 + seed * 3.0);             // grandes plaques de reprise
    // les murs ne prennent pas le soleil de la même façon selon l'exposition
    wall *= 0.97 + 0.06 * vnoise(vec2(u * 0.35, v * 0.12) + seed);
    relief = 0.002 * grain;
    // enduit ancien écaillé laissant voir la pierre
    if (!modern) {
      float flake = smoothstep(0.7, 0.76, fbm(p * 0.6 + seed * 40.0)) * step(v - gr, 2.2) * 0.8;
      float r2;
      vec3 st = stoneWall(p, seed, 1.0, r2);
      wall = mix(wall, st, flake);
    }
  }

  // ---------------------------------------------------------------- vieillissement
  float aboveGround = v - gr;
  wall *= mix(0.72, 1.0, smoothstep(0.0, 1.3, aboveGround));                        // remontées d'humidité
  wall *= 1.0 - 0.10 * smoothstep(0.55, 0.9, vnoise(vec2(u * 2.2, v * 0.25) + seed * 5.0)) * (modern ? 0.3 : 1.0);
  if (!modern && style < 2.5 && aboveGround < 0.45 && aboveGround > -0.2) {          // soubassement
    wall = mix(wall, srgb(vec3(0.60, 0.58, 0.54)) * (0.8 + 0.3 * fbm(p * 6.0)), 0.75);
  }

  // ── CHAÎNES D'ANGLE ET BANDEAU ───────────────────────────────────────────
  // Deux traits d'architecture qui se lisent de loin, là où le crépi ne se lit
  // plus : les pierres d'angle qui montent en alternance, et le bandeau qui
  // marque le plancher de l'étage. Réservés aux maisons anciennes de rue.
  if (!modern && style < 2.5 && L > 4.0) {
    float bord = min(u, L - u);
    float hauteurEtage = 2.95;
    if (bord < 0.42 && h1(seed * 61.0) > 0.35) {
      float assise = floor(v / 0.38);
      float saillie = mod(assise, 2.0) > 0.5 ? 0.42 : 0.26;    // pierres longues et courtes
      if (bord < saillie) {
        float j = smoothstep(0.0, 0.03, fract(v / 0.38)) * smoothstep(1.0, 0.97, fract(v / 0.38));
        vec3 pierre = srgb(vec3(0.80, 0.75, 0.64)) * (0.86 + 0.24 * h2(vec2(assise, floor(u / L))));
        pierre *= 0.88 + 0.2 * fbm(p * 5.0 + seed);
        wall = mix(wall, pierre, 0.85 * mix(0.55, 1.0, j));
      }
    }
    float dBandeau = abs(fract(v / hauteurEtage) * hauteurEtage);
    if (h1(seed * 23.0) > 0.55 && v > 2.0 && dBandeau < 0.16) {
      wall *= 0.82 + 0.5 * smoothstep(0.16, 0.0, dBandeau);      // moulure éclairée par-dessus
      wall = mix(wall, srgb(vec3(0.84, 0.80, 0.71)), 0.5);
    }
  }

  col = wall;
  if (party || L < 1.8 || style > 3.5 && style < 4.5 && !street) {
    col *= 0.9 + 0.1 * smoothstep(0.0, 0.6, roofLine - v);
    return;
  }

  // ---------------------------------------------------------------- génoise sous l'égout
  bool eaveEdge = roofLine < eave + 0.35;
  float below = roofLine - v;
  if (eaveEdge && below < 0.40 && below > 0.0 && !modern && style < 3.5) {
    float row = floor(below / 0.13);
    float period = 0.19;
    float x = fract(u / period + row * 0.5);
    float yy = fract(below / 0.13);
    float round_ = length(vec2(x - 0.5, (yy - 0.15) * 1.3));
    float tileEnd = smoothstep(0.42, 0.36, round_);
    float hollow = smoothstep(0.26, 0.2, round_);
    vec3 terracotta = srgb(vec3(0.66, 0.36, 0.24)) * (0.85 + 0.3 * h2(vec2(floor(u / period), row)));
    vec3 mortar = srgb(vec3(0.86, 0.82, 0.72));
    col = mix(mortar, terracotta, tileEnd);
    col *= 1.0 - 0.75 * hollow;
    col *= 0.7 + 0.3 * smoothstep(0.0, 0.4, below);
    col = mix(mix(mortar, terracotta, 0.45) * 0.72, col, fine);
    relief = tileEnd * 0.03 * fine;
    return;
  }
  col *= mix(0.62, 1.0, smoothstep(0.0, 0.7, below));                                   // ombre de l'avancée de toit

  // ---------------------------------------------------------------- ouvertures
  bool industrial = style > 2.5 && style < 3.5;
  bool annex = style > 3.5 && style < 4.5;
  float fh = modern ? 2.75 : (industrial ? 4.5 : 2.95);
  float floors = clamp(floor((eave - 0.25) / fh), 1.0, 6.0);
  float fl = floor(v / fh);
  float fy = v - fl * fh;
  float nb = max(1.0, floor(L / (industrial ? 5.0 : 3.3)));
  float bw = L / nb;
  float bi = floor(u / bw);
  float fx = u - (bi + 0.5) * bw;
  float r = h2(vec2(bi + seed * 31.0, fl + seed * 7.0));
  float r2 = h2(vec2(bi * 3.7 + seed * 11.0, fl * 1.9 + 4.0));
  if (fl < 0.0 || fl >= floors || v > eave - 0.35) return;
  if (annex && fl > 0.5) return;

  float ww = modern ? 1.2 : (industrial ? 1.6 : 0.92);
  float y0 = modern ? 0.9 : 1.0, y1 = modern ? 2.25 : 2.4;
  if (industrial) { y0 = 2.6; y1 = 3.7; }
  int kind = 0;                                             // 0 fenêtre, 1 porte, 2 garage, 3 vitrine
  bool ground0 = fl < 0.5;
  if (ground0) {
    float doorBay = floor(h1(seed * 91.0 + 3.0) * nb);
    if (street && bi == doorBay) { kind = 1; ww = industrial ? 3.2 : 1.0; y0 = 0.0; y1 = industrial ? 3.6 : 2.25; }
    else if ((street && r > 0.78 && !modern) || annex) { kind = 2; ww = min(2.5, bw - 0.5); y0 = 0.0; y1 = 2.3; }
    else if (!street && r < 0.35 && !industrial) return;
  } else if (!modern && r < 0.14) {
    return;                                                  // travée aveugle
  }
  if (annex && kind != 2) return;
  if (ww > bw - 0.35) ww = bw - 0.35;
  if (ww < 0.4) return;

  float hw = ww * 0.5;

  // ── APPUI ET COULURES ────────────────────────────────────────────────────
  // L'eau de pluie s'accumule sur l'appui, déborde et lessive l'enduit : deux
  // traînées sombres sous chaque fenêtre. C'est le détail qui empêche une façade
  // d'être un aplat à trente mètres, bien avant qu'on distingue le crépi.
  float sous = y0 - fy;                                   // > 0 : sous l'ouverture
  if (kind == 0 && sous > 0.0 && abs(fx) < hw + 0.22) {
    float largeur = smoothstep(hw + 0.22, hw - 0.08, abs(fx));
    float coule = exp(-sous * 0.8) * largeur;
    coule *= 0.5 + 0.5 * vnoise(vec2(fx * 16.0, fy * 1.2) + seed * 3.0);
    col *= 1.0 - 0.26 * coule;
  }
  // la pierre d'appui déborde de quelques centimètres, et porte son ombre
  if (kind == 0 && sous > -0.01 && sous < 0.20 && abs(fx) < hw + 0.13) {
    if (sous < 0.09) {
      col = srgb(vec3(0.80, 0.77, 0.70)) * (0.88 + 0.18 * fbm(p * 7.0 + seed));
      col *= 1.0 - 0.35 * smoothstep(0.05, 0.09, sous);   // le nez de l'appui capte la lumière
      rough = 0.8;
      relief = 0.0;
      return;
    }
    col *= 0.68;                                          // ombre portée sous l'appui
    return;
  }

  bool inX = abs(fx) < hw;
  bool inY = fy > y0 && fy < y1;
  float frameW = modern ? 0.06 : 0.14;
  bool inFrame = abs(fx) < hw + frameW && fy > y0 - frameW - (kind == 0 ? 0.06 : 0.0) && fy < y1 + frameW;

  vec3 shutterCol = srgb(SHUTTER_PAL[int(floor(h1(seed * 53.0) * 7.99))]);
  if (modern) shutterCol = srgb(mix(vec3(0.55, 0.56, 0.55), vec3(0.85, 0.85, 0.82), h1(seed * 7.0)));

  // volets battants (anciens) : ouverts contre le mur, ou fermés
  bool closed = !modern && kind == 0 && r2 > 0.72;
  if (!modern && kind == 0 && !closed && abs(fx) >= hw && abs(fx) < hw + hw + 0.02 && inY) {
    float slat = mix(0.5, 0.5 + 0.5 * sin(fy * 6.2831 / 0.075), fine);
    float wear = 0.8 + 0.3 * fbm(p * 3.0 + seed);
    col = shutterCol * (0.72 + 0.28 * slat) * wear;
    float edge = min(abs(abs(fx) - hw), abs(abs(fx) - hw - hw));
    col *= 0.55 + 0.45 * smoothstep(0.0, 0.03, edge);
    relief = 0.0;
    rough = 0.6;
    return;
  }
  if (inFrame && !(inX && inY)) {                               // encadrement
    vec3 frameCol = modern ? srgb(vec3(0.92, 0.92, 0.9)) : srgb(vec3(0.84, 0.79, 0.68)) * (0.85 + 0.2 * fbm(p * 6.0));
    col = kind == 1 && !modern ? srgb(vec3(0.78, 0.72, 0.62)) : frameCol;
    // ombre portée de l'encadrement dans l'embrasure (fausse profondeur, sans relief)
    relief = 0.0;
    return;
  }
  if (!(inX && inY)) return;

  // intérieur de l'ouverture
  float lx = (fx + hw) / ww;          // 0..1
  float ly = (fy - y0) / (y1 - y0);   // 0..1
  relief = 0.0;
  // embrasure : l'ouverture est en retrait, son bord haut et gauche est dans l'ombre
  float reveal = smoothstep(0.0, 0.07, min(fx + hw, y1 - fy));
  col *= 0.55 + 0.45 * reveal;
  if (kind == 1) {                                                // porte en bois à panneaux
    vec3 wood = mix(shutterCol, srgb(vec3(0.36, 0.23, 0.14)), step(0.5, h1(seed * 17.0)));
    float panel = step(0.12, lx) * step(lx, 0.88) * (step(0.1, ly) * step(ly, 0.45) + step(0.52, ly) * step(ly, 0.82));
    col = wood * (0.75 + 0.2 * panel + 0.1 * vnoise(vec2(lx * 3.0, ly * 40.0) * fine)) * (0.55 + 0.45 * reveal);
    if (ly > 0.87 && !industrial) {
      col = srgb(vec3(0.06, 0.07, 0.08)); spec = 1.0; rough = 0.08;
      glow = vec3(1.0, 0.62, 0.3) * 0.5 * step(0.5, h1(seed * 29.0));
    }
    if (abs(lx - 0.5) < 0.012 && industrial) col *= 0.5;
    rough = spec > 0.5 ? rough : 0.7;
    return;
  }
  if (kind == 2) {                                                // porte de garage
    float rib = mix(0.5, 0.5 + 0.5 * sin(ly * 6.2831 * 9.0), fine);
    col = (modern ? srgb(vec3(0.82, 0.82, 0.8)) : shutterCol * 0.9) * (0.78 + 0.22 * rib) * (0.55 + 0.45 * reveal);
    relief = 0.0;
    rough = 0.55;
    return;
  }
  // fenêtre
  bool rolled = modern && ly > 1.0 - h1(seed * 5.0 + bi * 1.3 + fl) * 0.75;
  if (closed || rolled) {
    float slat = mix(0.5, 0.5 + 0.5 * sin(fy * 6.2831 / (modern ? 0.05 : 0.075)), fine);
    col = shutterCol * (0.7 + 0.3 * slat) * (0.55 + 0.45 * reveal);
    relief = 0.0;
    rough = 0.6;
    return;
  }
  float mullion = modern ? 0.02 : 0.03;
  bool bar = fine > 0.3 && abs(lx - 0.5) < mullion / ww * 1.5 || (!modern && (abs(ly - 0.36) < 0.012 || abs(ly - 0.68) < 0.012));
  if (bar || lx < 0.04 || lx > 0.96 || ly < 0.03 || ly > 0.97) {
    col = modern ? srgb(vec3(0.93, 0.93, 0.92)) : srgb(vec3(0.9, 0.88, 0.82)) * 0.95;
    rough = 0.5;
    return;
  }
  // vitre : intérieur sombre + reflet du ciel (rugosité faible)
  float curtain = step(0.5, h1(seed * 3.0 + bi + fl * 5.0)) * smoothstep(0.35, 0.3, abs(lx - 0.5)) * 0.35;
  col = mix(srgb(vec3(0.05, 0.055, 0.06)), srgb(vec3(0.75, 0.72, 0.65)), curtain * (0.6 + 0.4 * vnoise(vec2(lx * 20.0, ly * 3.0))));
  col *= 0.6 + 0.4 * reveal;
  rough = 0.06;
  spec = 1.0;
  // la nuit, une fenêtre sur trois environ est éclairée (rideau = lumière tamisée)
  float lit = step(0.64, h2(vec2(bi * 1.7 + seed * 13.0, fl * 3.1 + seed * 5.0)));
  float warmth = h2(vec2(bi + 3.0, fl + seed * 3.0));
  glow = lit * mix(vec3(1.0, 0.66, 0.34), vec3(0.95, 0.85, 0.7), warmth) * (0.7 + 0.6 * curtain) * reveal;
}
`;

/** Éclairage de nuit partagé : intensité (0 le jour, 1 la nuit) et carte des flaques de lumière. */
const NIGHT = /* glsl */ `
uniform float uNight;
uniform sampler2D nightMap;
uniform float uHalf;
float lampLight(vec2 xz) {
  vec2 uv = (xz + uHalf) / (2.0 * uHalf);
  return texture2D(nightMap, vec2(uv.x, 1.0 - uv.y)).r;
}
const vec3 LAMP = vec3(1.0, 0.68, 0.36);
`;

/** Installe le shader de façade sur un MeshStandardMaterial. */
export function facadeMaterial(THREE, night) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, night);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aFac; attribute vec4 aInfo;
varying vec4 vFac; varying vec4 vInfo; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFac = aFac; vInfo = aInfo; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\n${NIGHT}\n${FACADE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 fCol, fGlow; float fRough, fRelief, fSpec;
facade(fCol, fRough, fRelief, fSpec, fGlow);
diffuseColor.rgb = fCol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = fRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += fGlow * uNight * 1.8;
totalEmissiveRadiance += diffuseColor.rgb * LAMP * lampLight(vWPos.xz) * smoothstep(7.5, 1.5, vFac.y - vInfo.x) * uNight * 1.3;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = bumpNormal(normal, vViewPosition, fRelief * smoothstep(90.0, 15.0, length(vViewPosition)));`);
  };
  mat.customProgramCacheKey = () => 'poilhes-facade';
  return mat;
}

/** Toits : tuiles canal, terrasses, bacs acier. vRoof = (u, v le long de la pente, graine, type). */
const ROOF = /* glsl */ `
varying vec4 vRoof;
varying vec3 vTint;
varying vec3 vWPos;

void roof(out vec3 col, out float rough, out float relief) {
  float u = vRoof.x, v = vRoof.y, seed = floor(vRoof.z * 1000.0 + 0.5) / 1000.0, kind = floor(vRoof.w + 0.5);
  vec3 tint = srgb(clamp(vTint, 0.0, 1.0));
  vec2 p = vec2(u, v);
  if (kind < 0.5) {
    float cw = 0.205;
    float c = floor(u / cw);
    float s = fract(u / cw);
    float rowL = 0.36;
    float r = floor(v / rowL + 0.37 * h1(c + seed * 50.0));
    float t = fract(v / rowL + 0.37 * h1(c + seed * 50.0));
    bool cover = mod(c, 2.0) > 0.5;
    float prof = sin(3.14159 * s);
    float var = h2(vec2(c, r) + seed * 13.0);
    float tl = dot(tint, vec3(0.3, 0.59, 0.11));
    vec3 vivid = clamp(mix(vec3(tl), tint, 1.7), 0.0, 1.0);
    vec3 base = mix(srgb(vec3(0.72, 0.36, 0.22)), vivid * 1.05, 0.45);
    vec3 tile = base * (0.78 + 0.36 * var) * vec3(1.0 + 0.1 * (var - 0.5), 1.0, 1.0 - 0.14 * (var - 0.5));
    float shade = cover ? 0.8 + 0.32 * prof : 0.58 + 0.26 * (1.0 - prof);
    shade *= mix(0.62, 1.0, smoothstep(0.0, 0.14, t));
    float lichen = smoothstep(0.6, 0.78, fbm(p * 0.6 + seed * 9.0)) * 0.5;
    tile = mix(tile, srgb(vec3(0.62, 0.60, 0.48)), lichen * (cover ? 1.0 : 0.4));
    tile *= 0.9 + 0.15 * vnoise(p * 3.0 + seed);
    col = tile * shade;
    relief = (cover ? prof * 0.045 : -prof * 0.02) + (1.0 - smoothstep(0.0, 0.12, t)) * -0.012;
    rough = 0.72;
  } else if (kind < 1.5) {
    float g = fbm(p * 3.0 + seed * 7.0);
    col = mix(tint, srgb(vec3(0.72, 0.70, 0.66)), 0.4) * (0.82 + 0.3 * g);
    col *= 0.94 + 0.06 * vnoise(p * 40.0);
    relief = 0.004 * g;
    rough = 0.95;
  } else if (kind < 2.5) {
    float wave = 0.5 + 0.5 * sin(u * 6.2831 / 0.076);
    col = mix(srgb(vec3(0.62, 0.63, 0.62)), tint, 0.5) * (0.8 + 0.2 * wave);
    col *= mix(1.0, 0.75, smoothstep(0.55, 0.8, fbm(p * 0.4 + seed)));
    relief = wave * 0.012;
    rough = 0.45;
  } else if (kind < 3.5) {
    // rive : bouts des tuiles canal, alternance creux / couvre
    float t = fract(u / 0.205);
    float tl = dot(tint, vec3(0.3, 0.59, 0.11));
    vec3 base = mix(srgb(vec3(0.62, 0.32, 0.2)), clamp(mix(vec3(tl), tint, 1.6), 0.0, 1.0), 0.4);
    col = base * (0.35 + 0.45 * sin(3.14159 * t));
    relief = 0.0;
    rough = 0.8;
  } else {
    // marche entre deux niveaux de toit : mur enduit
    col = srgb(vec3(0.83, 0.77, 0.66)) * (0.82 + 0.22 * fbm(p * 1.5 + seed * 3.0));
    relief = 0.0;
    rough = 0.9;
  }
}
`;

export function roofMaterial(THREE) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aRoof; attribute vec3 aTint;
varying vec4 vRoof; varying vec3 vTint; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRoof = aRoof; vTint = aTint; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\n${ROOF}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 rCol; float rRough, rRelief;
roof(rCol, rRough, rRelief);
diffuseColor.rgb = rCol;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = rRough;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = bumpNormal(normal, vViewPosition, rRelief * smoothstep(70.0, 8.0, length(vViewPosition)));`);
  };
  mat.customProgramCacheKey = () => 'poilhes-roof';
  return mat;
}

/** Sol : orthophoto IGN + masque de revêtement (R asphalte, G gravier, B pavés) + micro-détail. */
export function groundMaterial(THREE, ortho, mask, night) {
  const mat = new THREE.MeshStandardMaterial({ map: ortho, roughness: 0.95, metalness: 0, envMapIntensity: 0.35 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.solMap = { value: mask };
    Object.assign(sh.uniforms, night);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\n${NIGHT}\nuniform sampler2D solMap;\nvarying vec3 vWPos;\nfloat gRelief = 0.0; float gRough = 0.95;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec4 m4 = texture2D(solMap, vMapUv);
  vec3 m = m4.rgb;
  // la photo aérienne contient déjà la lumière du jour : on la ramène à un albédo plausible
  vec3 photo = diffuseColor.rgb;
  float lum = dot(photo, vec3(0.3, 0.59, 0.11));
  photo = mix(vec3(lum), photo, 1.25) * 0.72;
  lum *= 0.72;
  vec2 w = vWPos.xz;
  float dist = length(vViewPosition);
  float nearF = smoothstep(160.0, 20.0, dist);
  // asphalte : grain fin, reprises, marquages et ombres de la photo conservés
  float grain = vnoise(w * 28.0) * 0.5 + vnoise(w * 71.0) * 0.5;
  // enrobé : granulat fin, reprises de goudron, fissures, bandes d'usure des roues
  float aggregate = vnoise(w * 34.0) * 0.45 + vnoise(w * 95.0) * 0.35 + vnoise(w * 210.0) * 0.2;
  vec3 asphalt = srgb(vec3(0.30, 0.295, 0.285)) * (0.84 + 0.34 * smoothstep(0.05, 0.35, lum));
  asphalt *= 0.86 + 0.24 * fbm(w * 0.35);                                                      // vieillissement par plaques
  asphalt *= mix(1.0, 0.68 + 0.68 * aggregate, nearF);                                         // grain visible de près
  asphalt = mix(asphalt, srgb(vec3(0.30, 0.29, 0.28)), smoothstep(0.6, 0.78, fbm(w * 0.9 + 7.0)) * 0.55);   // reprises
  float crack = smoothstep(0.42, 0.47, abs(fbm(w * 1.6 + 3.0) - 0.5)) * smoothstep(0.55, 0.75, vnoise(w * 0.5));
  asphalt *= 1.0 - 0.45 * crack * nearF;                                                       // fissures
  float wear = smoothstep(0.55, 1.0, m.r) * smoothstep(0.98, 0.72, m.r);                        // ni l'axe ni le bord
  asphalt *= 1.0 + 0.1 * wear;
  asphalt = mix(asphalt, photo * 1.15, smoothstep(0.42, 0.62, lum) * 0.55);                     // marquages blancs
  // accotement : la terre et le gravier mordent sur les bords de la chaussée
  float verge = smoothstep(0.08, 0.28, m.r) * smoothstep(0.62, 0.3, m.r);
  vec3 dust = srgb(vec3(0.60, 0.55, 0.45)) * (0.7 + 0.5 * lum) * (0.85 + 0.3 * vnoise(w * 12.0));
  asphalt = mix(asphalt, dust, verge * 0.55);
  // gravier / terre battue
  vec3 gravel = mix(photo, srgb(vec3(0.72, 0.64, 0.50)) * (0.75 + 0.5 * lum), 0.45) * (0.85 + 0.3 * vnoise(w * 45.0) * nearF + 0.1 * fbm(w * 2.0));
  // pavés : calade de galets et dalles
  vec2 cell = w / vec2(0.42, 0.28);
  cell.x += 0.5 * mod(floor(cell.y), 2.0);
  vec2 f = fract(cell);
  float joint = smoothstep(0.0, 0.08, f.x) * smoothstep(1.0, 0.92, f.x) * smoothstep(0.0, 0.12, f.y) * smoothstep(1.0, 0.88, f.y);
  vec3 stone = srgb(vec3(0.72, 0.67, 0.58)) * (0.75 + 0.35 * h2(floor(cell))) * (0.85 + 0.3 * lum);
  vec3 paving = mix(srgb(vec3(0.42, 0.40, 0.36)), stone, mix(1.0, joint, nearF));
  vec3 c = photo;
  c = mix(c, gravel, m.g);
  c = mix(c, asphalt, m.r * 0.9);
  c = mix(c, paving, m.b * 0.85);
  // talus : la photo, vue de dessus, s'étire sur les pentes raides -> herbe sèche, terre, pierre
  vec3 wn = inverseTransformDirection(normalize(vNormal), viewMatrix);
  float steep = smoothstep(0.93, 0.72, wn.y);
  float cliff = smoothstep(0.6, 0.4, wn.y);
  vec2 side = abs(wn.x) > abs(wn.z) ? vWPos.zy : vWPos.xy;
  float tuft = fbm(side * 2.2) * 0.6 + vnoise(side * 14.0) * 0.4;
  vec3 grass = mix(srgb(vec3(0.52, 0.50, 0.32)), srgb(vec3(0.36, 0.40, 0.22)), smoothstep(0.35, 0.7, tuft));
  grass = mix(grass, srgb(vec3(0.55, 0.45, 0.33)), smoothstep(0.62, 0.8, fbm(side * 0.7 + 3.0)));
  float srow = floor(side.y / 0.32);
  vec2 sf = vec2(fract(side.x / 0.6 + 0.5 * mod(srow, 2.0)), fract(side.y / 0.32));
  float sj = smoothstep(0.0, 0.06, sf.x) * smoothstep(1.0, 0.94, sf.x) * smoothstep(0.0, 0.1, sf.y) * smoothstep(1.0, 0.9, sf.y);
  vec3 quay = srgb(vec3(0.66, 0.60, 0.50)) * (0.7 + 0.35 * h2(vec2(floor(side.x / 0.6 + 0.5 * mod(srow, 2.0)), srow))) * mix(0.55, 1.0, sj);
  vec3 bank = mix(grass * (0.8 + 0.25 * lum), quay, cliff);
  float roadMask = max(m.r, max(m.g, m.b));
  c = mix(c, bank, steep * (1.0 - roadMask));
  // micro-détail hors voirie (herbe sèche, terre) quand on est proche
  float bare = 1.0 - max(m.r, max(m.g, m.b));
  c *= mix(1.0, 0.82 + 0.36 * fbm(w * 3.5), bare * nearF * 0.7);
  // ── LÀ OÙ LA PHOTO EST INVENTÉE ───────────────────────────────────────────
  // Sous un arbre ou un toit effacé, l'orthophoto ne montre plus le sol : elle
  // montre une moyenne étalée du voisinage, une tache pâle sans matière. C'est
  // elle qu'on voyait de part et d'autre des routes bordées de platanes. On y
  // repeint un sous-bois — herbe sèche, terre, touffes — accordé à la teinte
  // locale pour que la couture ne se voie pas.
  float invente = m4.a * (1.0 - max(m.r, max(m.g, m.b)));
  if (invente > 0.01) {
    float touffe = fbm(w * 2.6) * 0.6 + vnoise(w * 11.0) * 0.4;
    vec3 herbe = mix(srgb(vec3(0.34, 0.37, 0.21)), srgb(vec3(0.46, 0.45, 0.27)), smoothstep(0.3, 0.72, touffe));
    herbe = mix(herbe, srgb(vec3(0.40, 0.34, 0.25)), smoothstep(0.58, 0.82, fbm(w * 0.8 + 5.0)) * 0.6);
    herbe *= 0.72 + 0.7 * lum;                       // on garde la lumière de la photo
    herbe *= 0.86 + 0.28 * vnoise(w * 26.0) * nearF;
    c = mix(c, herbe, invente * 0.82);
  }
  diffuseColor.rgb = c;
  gRelief = nearF * (m.b * (joint - 1.0) * 0.02 + m.r * grain * 0.004 + bare * fbm(w * 5.0) * 0.03);
  gRough = mix(0.97, 0.92, m.r);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = gRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * LAMP * lampLight(vWPos.xz) * uNight * 1.6;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = bumpNormal(normal, vViewPosition, gRelief);`);
  };
  mat.customProgramCacheKey = () => 'poilhes-ground';
  return mat;
}

/** Eau : canal du Midi (vert profond) ou piscine (turquoise), vaguelettes animées. */
export function waterMaterial(THREE, pool, clock) {
  const mat = new THREE.MeshStandardMaterial({
    color: pool ? 0x3fb6c8 : 0x2e4a33, roughness: pool ? 0.04 : 0.06, metalness: 0.0,
    transparent: true, opacity: pool ? 0.9 : 0.93, envMapIntensity: pool ? 1.0 : 1.3,
  });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = clock;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\nuniform float uTime;\nvarying vec3 vWPos;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec2 w = vWPos.xz;
  ${pool
    ? 'float ca = pow(abs(sin(w.x * 3.1 + uTime * 1.3 + sin(w.y * 2.3 + uTime))) * abs(sin(w.y * 2.7 - uTime * 1.1 + sin(w.x * 1.9))), 0.35);\n  diffuseColor.rgb *= 0.85 + 0.35 * ca;'
    : 'diffuseColor.rgb *= 0.8 + 0.3 * fbm(w * 0.05 + uTime * 0.01);'}
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 w = vWPos.xz;
  float t = uTime;
  float H = 0.0;
  H += sin(dot(w, vec2(0.8, 0.6)) * 1.7 + t * 1.6) * 0.015;
  H += sin(dot(w, vec2(-0.5, 0.9)) * 3.1 + t * 2.1) * 0.008;
  H += (vnoise(w * 1.6 + vec2(t * 0.35, t * 0.2)) - 0.5) * 0.03;
  H += (vnoise(w * 5.0 - vec2(t * 0.5, -t * 0.3)) - 0.5) * 0.008;
  normal = bumpNormal(normal, vViewPosition, H * ${pool ? '0.5' : '1.0'});
}`);
  };
  mat.customProgramCacheKey = () => (pool ? 'poilhes-pool' : 'poilhes-water');
  return mat;
}

/** Feuillage : couleur réelle (instance) modulée en touffes de feuilles, sous-bois plus sombre. */
export function foliageMaterial(THREE) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vLocal = position;
vec4 wp = modelMatrix * vec4(transformed, 1.0);
#ifdef USE_INSTANCING
wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#endif
vWPos = wp.xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\nvarying vec3 vWPos; varying vec3 vLocal;\nfloat fRelief = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 q = vWPos * 2.2;
  float clumps = fbm(q.xz + q.y * 0.7) ;
  float leaves = vnoise(vWPos.xz * 9.0 + vWPos.y * 7.0);
  float inner = smoothstep(-0.9, 0.6, vLocal.y);            // bas du houppier plus sombre
  diffuseColor.rgb *= (0.55 + 0.75 * clumps) * (0.8 + 0.35 * leaves) * mix(0.55, 1.1, inner);
  fRelief = (clumps * 0.25 + leaves * 0.06);
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = bumpNormal(normal, vViewPosition, fRelief * smoothstep(120.0, 10.0, length(vViewPosition)));`);
  };
  mat.customProgramCacheKey = () => 'poilhes-foliage';
  return mat;
}

/** Pierre générique (ponts, murs de soutènement) : appareil de pierres sur coordonnées monde. */
export function stoneMaterial(THREE) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWNorm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\nvarying vec3 vWPos; varying vec3 vWNorm;\nfloat sRelief = 0.0;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 an = abs(vWNorm);
  vec2 p = an.y > 0.7 ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
  float row = floor(p.y / 0.3);
  float x = p.x / 0.55 + 0.5 * mod(row, 2.0);
  vec2 f = vec2(fract(x), fract(p.y / 0.3));
  float m = smoothstep(0.0, 0.05, f.x) * smoothstep(1.0, 0.95, f.x) * smoothstep(0.0, 0.1, f.y) * smoothstep(1.0, 0.9, f.y);
  float id = h2(vec2(floor(x), row));
  diffuseColor.rgb *= mix(0.72, (0.85 + 0.3 * id) * (0.85 + 0.25 * fbm(p * 4.0)), m);
  sRelief = m * 0.02;
}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = bumpNormal(normal, vViewPosition, sRelief * smoothstep(60.0, 8.0, length(vViewPosition)));`);
  };
  mat.customProgramCacheKey = () => 'poilhes-stone';
  return mat;
}

/** Ciel : dégradé physique simplifié, halo et disque solaire, nuages d'altitude. */
export function skyMaterial(THREE) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uTime: { value: 0 },
      uNight: { value: 0 },
      uZenith: { value: new THREE.Color(0x2f6fb8) },
      uHorizon: { value: new THREE.Color(0xbfd6ea) },
      uSunColor: { value: new THREE.Color(0xfff1d8) },
    },
    vertexShader: /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}`,
    fragmentShader: /* glsl */ `
${NOISE}
uniform vec3 uSun; uniform float uTime; uniform float uNight;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(y, 0.45));
  float s = max(dot(d, uSun), 0.0);
  float up = smoothstep(-0.14, 0.02, uSun.y);          // le halo s'éteint quand le soleil est bien couché
  col += uSunColor * (pow(s, 6.0) * 0.35 + pow(s, 64.0) * 0.6) * up;
  col += uSunColor * smoothstep(0.9994, 0.9998, s) * 8.0 * step(0.0, uSun.y);
  // nuages : couche plane projetée
  if (d.y > 0.02) {
    vec2 cp = d.xz / d.y * 1.4 + vec2(uTime * 0.004, uTime * 0.002);
    float c = fbm(cp * 1.3) * 0.7 + fbm(cp * 4.0) * 0.3;
    float cover = smoothstep(0.52, 0.78, c) * smoothstep(0.02, 0.2, d.y);
    vec3 cloud = mix(uHorizon * 1.05, vec3(1.0), 0.6) * (0.75 + 0.45 * pow(s, 3.0));
    cloud = mix(cloud, uSunColor, pow(s, 12.0) * 0.5);
    col = mix(col, cloud, cover * 0.85);
  }
  // étoiles, visibles quand la nuit est tombée
  if (d.y > 0.0 && uNight > 0.01) {
    vec3 cell = floor(d * 420.0);
    float h = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))) * 43758.5453);
    float twinkle = 0.7 + 0.3 * sin(uTime * 2.0 + h * 60.0);
    col += vec3(0.9, 0.93, 1.0) * step(0.9982, h) * twinkle * uNight * smoothstep(0.0, 0.25, d.y) * 1.6;
  }
  // sous l'horizon : brume chaude
  if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.8, smoothstep(0.0, -0.3, d.y));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
}

/**
 * Chaussée : enrobé, empierré ou pavé, peints sur le ruban de `roads.py`.
 *
 * Rien ici ne vient de la photo aérienne : elle est prise au zénith à midi, donc
 * elle ne sait ni où finit la chaussée ni ce qu'est un caniveau, et dans les rues
 * étroites elle n'est qu'une ombre. Tout est reconstruit à partir de la géométrie :
 *
 *   aInfo.x = u    écart à l'axe (±1 = bord de chaussée, au-delà l'accotement)
 *   aInfo.y = s    distance le long de la rue, en mètres — c'est elle qui cadence
 *                  les pointillés de l'axe et les reprises de goudron
 *   aInfo.z = revêtement (0 enrobé, 1 empierré, 2 pavé)
 *   aInfo.w = demi-largeur réelle : une ruelle de 3 m n'a pas de marquage
 */
export function roadMaterial(THREE, night) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0, envMapIntensity: 0.3 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, night);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aInfo;
attribute float aFin;
varying vec4 vInfo;
varying float vFin;
varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vInfo = aInfo;
vFin = aFin;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${NOISE}
${NIGHT}
varying vec4 vInfo;
varying float vFin;
varying vec3 vWPos;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec2 w = vWPos.xz;
  float u = vInfo.x, s = vInfo.y, revet = vInfo.z, demi = vInfo.w;
  float au = abs(u);
  float dist = length(vViewPosition);
  float pres = smoothstep(220.0, 25.0, dist);          // le grain n'existe que de près

  // ── ENROBÉ ────────────────────────────────────────────────────────────────
  float granulat = vnoise(w * 33.0) * 0.45 + vnoise(w * 88.0) * 0.35 + vnoise(w * 190.0) * 0.20;
  vec3 bitume = srgb(vec3(0.255, 0.252, 0.248));
  bitume *= 0.88 + 0.26 * fbm(w * 0.32);                                  // plaques et âge
  bitume *= mix(1.0, 0.74 + 0.58 * granulat, pres);                       // gravillons
  // reprises : les bandes de goudron sombres qui recousent la chaussée
  float reprise = smoothstep(0.62, 0.78, fbm(w * 0.85 + 11.0));
  bitume = mix(bitume, srgb(vec3(0.20, 0.198, 0.196)), reprise * 0.55);
  // bandes de roulement : deux couloirs polis, plus clairs et plus lisses
  float roue = exp(-pow((au - 0.52) * 4.2, 2.0));
  bitume *= 1.0 + 0.09 * roue;
  // fissures, plus nombreuses au bord qu'à l'axe
  float fis = smoothstep(0.44, 0.48, abs(fbm(w * 1.7 + 3.0) - 0.5)) * smoothstep(0.35, 0.95, au);
  bitume *= 1.0 - 0.5 * fis * pres;
  // le bord s'effrite et la terre remonte
  float bord = smoothstep(0.86, 1.0, au);
  bitume = mix(bitume, srgb(vec3(0.42, 0.38, 0.30)), bord * 0.45 * (0.6 + 0.6 * vnoise(w * 9.0)));

  // ── MARQUAGES ─────────────────────────────────────────────────────────────
  // Seulement si la rue est assez large ; sinon on peindrait des lignes dans une ruelle.
  // On ne peint pas de bandes au milieu d'un carrefour : les marquages s'effacent
  // aux cinq derniers mètres d'un tronçon, là où il en rejoint un autre.
  float large = smoothstep(2.3, 2.9, demi) * smoothstep(1.5, 5.5, vFin);
  // Les bandes se mesurent en MÈTRES, pas en fraction de chaussée : une peinture
  // de 15 cm reste de 15 cm, qu'on soit sur une départementale ou une avenue.
  float m = au * demi;                                                    // écart à l'axe, en mètres
  float axe = smoothstep(0.085, 0.065, m) * step(0.77, fract(s / 13.0));  // T1 : 3 m de trait, 10 m de vide
  float bordM = demi - 0.35;                                              // rive à 35 cm du bord
  float rive = smoothstep(0.09, 0.06, abs(m - bordM));
  float peinture = clamp(axe + rive, 0.0, 1.0) * large;
  peinture *= 0.55 + 0.45 * smoothstep(0.35, 0.75, vnoise(w * 6.0));      // usure
  bitume = mix(bitume, srgb(vec3(0.82, 0.80, 0.74)), peinture * 0.85);

  // ── CANIVEAU ET ACCOTEMENT ────────────────────────────────────────────────
  float caniveau = smoothstep(1.0, 1.05, au) * smoothstep(1.12, 1.05, au);
  bitume = mix(bitume, srgb(vec3(0.46, 0.44, 0.40)) * (0.8 + 0.3 * vnoise(w * 18.0)), caniveau * 0.8);
  float accot = smoothstep(1.06, 1.16, au);
  vec3 terre = srgb(vec3(0.44, 0.40, 0.31)) * (0.8 + 0.4 * vnoise(w * 14.0));
  terre = mix(terre, srgb(vec3(0.34, 0.38, 0.24)), smoothstep(0.5, 0.8, fbm(w * 2.4)) * 0.5);
  vec3 chaussee = mix(bitume, terre, accot);

  // ── EMPIERRÉ ET PAVÉ ──────────────────────────────────────────────────────
  vec3 pierre = srgb(vec3(0.62, 0.56, 0.44)) * (0.78 + 0.44 * vnoise(w * 26.0));
  pierre *= 0.9 + 0.2 * fbm(w * 1.1);
  pierre = mix(pierre, srgb(vec3(0.40, 0.42, 0.28)), smoothstep(0.75, 1.0, au) * 0.5);   // herbe au bord
  vec2 cell = w / vec2(0.34, 0.24);
  cell.x += 0.5 * mod(floor(cell.y), 2.0);
  vec2 f = fract(cell);
  float joint = smoothstep(0.0, 0.09, f.x) * smoothstep(1.0, 0.91, f.x)
              * smoothstep(0.0, 0.13, f.y) * smoothstep(1.0, 0.87, f.y);
  vec3 pave = mix(srgb(vec3(0.34, 0.32, 0.29)), srgb(vec3(0.66, 0.61, 0.53)) * (0.7 + 0.45 * h2(floor(cell))), mix(1.0, joint, pres));

  vec3 c = chaussee;
  c = mix(c, pierre, step(0.5, revet) * step(revet, 1.5));
  c = mix(c, pave, step(1.5, revet));
  diffuseColor.rgb = c;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
{
  // Les bandes de roulement sont polies par les pneus : c'est ce contraste de
  // brillance qui fait lire une route mouillée de lumière rasante le soir.
  float au2 = abs(vInfo.x);
  float roue2 = exp(-pow((au2 - 0.52) * 4.2, 2.0));
  roughnessFactor = mix(0.95, 0.74, roue2) + 0.06 * smoothstep(1.05, 1.2, au2);
}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
{
  // Nuit : la chaussée s'éteint, sauf sous les lanternes.
  float halo = lampLight(vWPos.xz);
  gl_FragColor.rgb *= mix(1.0, 0.24 + 0.1 * halo, uNight);
  gl_FragColor.rgb += LAMP * halo * uNight * 0.30;
}`);
  };
  return mat;
}

/**
 * Cartes de feuillage : la même ramille répétée quatre-vingts fois par arbre.
 *
 * Sans traitement, les quatre-vingts cartes sont identiques et l'œil le voit tout
 * de suite : un houppier qui se répète. Une graine par carte suffit à casser ça —
 * teinte, clarté, et un léger retournement de la texture.
 *
 * S'y ajoute la translucidité : une feuille éclairée par-derrière s'allume. C'est
 * ce qui distingue un arbre d'un tas de carton vert, surtout au soleil rasant.
 */
export function leafMaterial(THREE, map) {
  const mat = new THREE.MeshStandardMaterial({
    map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.82, metalness: 0,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aGraine;
varying float vGraine;
varying vec3 vFeuilleWPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGraine = aGraine;
vec4 fwp = modelMatrix * vec4(transformed, 1.0);
#ifdef USE_INSTANCING
fwp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#endif
vFeuilleWPos = fwp.xyz;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
// un quart de tour au hasard, et parfois un miroir : la même ramille ne se
// reconnaît plus d'une carte à l'autre
{
  float r = floor(aGraine * 4.0);
  vec2 uvc = vMapUv - 0.5;
  if (r > 2.5) uvc = vec2(-uvc.y, uvc.x);
  else if (r > 1.5) uvc = -uvc;
  else if (r > 0.5) uvc = vec2(uvc.y, -uvc.x);
  if (fract(aGraine * 7.0) > 0.5) uvc.x = -uvc.x;
  vMapUv = uvc + 0.5;
}
#endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${NOISE}
varying float vGraine;
varying vec3 vFeuilleWPos;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // teinte propre à la carte : du vert-jaune au vert profond
  float g = vGraine;
  float chaud = 0.82 + 0.36 * fract(g * 13.0);
  diffuseColor.rgb *= vec3(chaud, 0.92 + 0.16 * fract(g * 29.0), 0.80 + 0.22 * fract(g * 53.0));
  // les cartes du bas sont dans l'ombre du houppier
  diffuseColor.rgb *= 0.78 + 0.34 * smoothstep(-1.0, 1.0, vFeuilleWPos.y * 0.0 + fract(g * 97.0));
  diffuseColor.rgb *= 0.9 + 0.2 * vnoise(vFeuilleWPos.xz * 3.0);
}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
{
  // Translucidité : la lumière qui traverse la feuille. On la prend sur le soleil
  // (la première lumière directionnelle) et on l'ajoute quand on regarde à contre-jour.
  #if NUM_DIR_LIGHTS > 0
    vec3 versLum = normalize(directionalLights[0].direction);
    float dos = max(0.0, dot(normalize(vViewPosition), -versLum));
    reflectedLight.indirectDiffuse += directionalLights[0].color * pow(dos, 2.2) * 0.55 * diffuseColor.rgb;
  #endif
}`);
  };
  return mat;
}

/** Écorce : cannelures verticales et lichen. Un tronc uni se voit de loin. */
export function barkMaterial(THREE) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x6d5c47, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vEcorce;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvEcorce = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE}\nvarying vec3 vEcorce;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float ang = atan(vEcorce.z, vEcorce.x);
  float y = vEcorce.y;
  // cannelures : elles ondulent lentement en montant, sinon on voit un tuyau rayé
  float sillon = vnoise(vec2(ang * 3.4, y * 0.9)) * 0.6 + vnoise(vec2(ang * 9.0, y * 2.1)) * 0.4;
  float plaque = smoothstep(0.42, 0.62, fbm(vec2(ang * 2.0, y * 0.5)));
  vec3 sombre = srgb(vec3(0.19, 0.16, 0.12));
  vec3 clair = srgb(vec3(0.40, 0.36, 0.29));           // le platane se desquame en plaques claires
  diffuseColor.rgb = mix(sombre, clair, plaque * 0.45 + sillon * 0.18);
  diffuseColor.rgb *= 0.70 + 0.34 * sillon;
  // lichen au pied, côté nord
  diffuseColor.rgb = mix(diffuseColor.rgb, srgb(vec3(0.42, 0.46, 0.33)),
    smoothstep(0.5, 0.0, y) * smoothstep(0.35, 0.75, vnoise(vec2(ang * 5.0, y * 3.0))) * 0.4);
}`);
  };
  return mat;
}
