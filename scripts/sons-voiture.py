"""Prépare les bruitages de la voiture à partir des enregistrements bruts.

Trois fichiers sortent de `assets/sons/` :

    moteur-boucle.mp3     tenue de moteur, bouclable sans couture
    moteur-demarrage.mp3  le démarreur, joué une fois à l'entrée
    frein.mp3             le crissement de freinage, joué au coup par coup

Le travail n'est pas une conversion, c'est un montage — et c'est pour cela qu'il
est ici et pas fait à la main :

1. **Repérer la partie stable.** Un enregistrement de voiture est un passage :
   elle arrive, elle passe, elle s'éloigne. Boucler le fichier entier donnerait
   un moteur qui monte et redescend en rond. On cherche donc la fenêtre où le
   niveau varie le moins, et c'est elle qu'on garde.
2. **Aplatir l'enveloppe.** Même dans la partie stable, le niveau dérive. On
   divise par sa propre enveloppe lissée : le moteur garde son timbre, il perd
   sa trajectoire.
3. **Fondu croisé circulaire.** Le début de la boucle est mélangé avec ce qui
   suivait la fin. Sans cela, on entend un clic à chaque tour — c'est le défaut
   qui trahit une boucle, plus que sa durée.

Lancer :  py scripts/sons-voiture.py
Les sources attendues sont dans le dossier des téléchargements (voir SOURCES).
"""
import os
import pathlib
import subprocess
import sys
import wave

import numpy as np

RACINE = pathlib.Path(__file__).resolve().parent.parent
SORTIE = RACINE / "assets" / "sons"
TELECHARGEMENTS = pathlib.Path(os.environ.get("USERPROFILE", "")) / "Downloads"

# Le choix de la source n'est pas indifférent, et il se mesure. Comparées :
#   « Bruitage - voiture »      : 7,5 s de hauteur stable, et c'est une montée ;
#                                 50,7 % d'énergie sous 120 Hz, 2,4 % au-dessus de
#                                 2 kHz — étouffé.
#   « car acceleration sound fx » : idem, une accélération de 56 à 378 Hz.
#   « Porsche 991-2 GT3 »       : **32,5 s à 112 Hz**, niveau régulier, 18,8 %
#                                 d'énergie entre 2 et 8 kHz — le grain du flat-six.
# C'est un régime TENU : rien à aplatir, rien à transposer.
SOURCES = {
    "boucle": "Porsche 991-2 GT3 Touring 2018 Craie W30.mp3",
    "demarrage": "VOITURE #9 Démarrage (bruitage gratuit).mp3",
    "frein": "VOITURE #17 Freinage (bruitage gratuit).mp3",
}

SR = 44100


def lire(mp3: pathlib.Path) -> np.ndarray:
    """Décode un mp3 en mono 44,1 kHz, flottants entre -1 et 1."""
    tmp = pathlib.Path(os.environ.get("TEMP", ".")) / "son-voiture-tmp.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp3),
                    "-ac", "1", "-ar", str(SR), str(tmp)], check=True)
    with wave.open(str(tmp), "rb") as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    return x.astype(np.float32) / 32768.0


def ecrire(x: np.ndarray, nom: str, debit: str = "128k") -> None:
    """Écrit un mp3 depuis un signal flottant."""
    SORTIE.mkdir(parents=True, exist_ok=True)
    tmp = pathlib.Path(os.environ.get("TEMP", ".")) / "son-voiture-out.wav"
    crete = float(np.max(np.abs(x))) or 1.0
    pcm = np.clip(x / crete * 0.92, -1, 1)
    with wave.open(str(tmp), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((pcm * 32767).astype(np.int16).tobytes())
    cible = SORTIE / nom
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp),
                    "-b:a", debit, str(cible)], check=True)
    print(f"  {nom} : {len(x) / SR:.2f} s, {cible.stat().st_size // 1024} Ko")


def enveloppe(x: np.ndarray, fenetre: int) -> np.ndarray:
    """Niveau efficace lissé, de la même longueur que le signal."""
    carre = np.convolve(x ** 2, np.ones(fenetre) / fenetre, mode="same")
    return np.sqrt(np.maximum(carre, 1e-9))


def partie_stable(x: np.ndarray, duree: float) -> int:
    """Début (en échantillons) de la fenêtre où le niveau varie le moins."""
    pas = SR // 10
    env = np.array([np.sqrt((x[i:i + pas] ** 2).mean()) for i in range(0, len(x) - pas, pas)])
    L = max(4, int(duree * 10))
    if len(env) <= L:
        return 0
    notes = [env[i:i + L].std() / max(1e-6, env[i:i + L].mean()) for i in range(len(env) - L)]
    # on écarte les fenêtres presque muettes : « stable » n'est pas « silencieux »
    seuil = 0.35 * env.max()
    for i in np.argsort(notes):
        if env[i:i + L].mean() > seuil:
            return int(i) * pas
    return int(np.argmin(notes)) * pas


def hauteur(x: np.ndarray, sr: int = SR, bas: float = 60.0, haut: float = 460.0) -> float:
    """Fréquence dominante d'un morceau de signal, dans la bande utile."""
    if len(x) < 512:
        return 0.0
    sp = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    fr = np.fft.rfftfreq(len(x), 1 / sr)
    m = (fr > bas) & (fr < haut)
    return float(fr[m][np.argmax(sp[m])])


def aplatir_hauteur(seg: np.ndarray):
    """Rend la hauteur constante, et la renvoie.

    L'enregistrement fourni est une **accélération** : le moteur y monte de 122
    à 380 Hz sans jamais tenir un régime. Bouclé tel quel, il monterait en rond
    — et le jeu, qui réaccorde la boucle au compte-tours, se retrouverait à
    piloter une hauteur qui bouge déjà toute seule.

    On mesure donc la hauteur au fil du temps et on relit le morceau à vitesse
    variable : plus lentement là où le moteur était haut, plus vite là où il
    était bas. Le timbre reste, la montée disparaît.
    """
    saut = SR // 40                       # 25 ms
    fenetre = SR // 10
    temps, f0 = [], []
    for i in range(0, len(seg) - fenetre, saut):
        f = hauteur(seg[i:i + fenetre])
        if f > 0:
            temps.append(i)
            f0.append(f)
    if len(f0) < 6:
        return seg, hauteur(seg)
    f0 = np.array(f0, dtype=np.float64)
    # lissage : une hauteur mesurée saute d'une octave dès qu'une harmonique domine
    f0 = np.convolve(f0, np.ones(5) / 5, mode="same")
    f0[:2], f0[-2:] = f0[2], f0[-3]
    cible = float(np.median(f0))
    vitesse = np.interp(np.arange(len(seg)), temps, f0) / cible
    position = np.cumsum(vitesse)
    position -= position[0]
    lecture = np.interp(np.arange(int(position[-1])), position, np.arange(len(seg)))
    return np.interp(lecture, np.arange(len(seg)), seg).astype(np.float32), cible


def boucler(x: np.ndarray, duree: float = 2.0, fondu: float = 0.35,
            hauteur_cible: float = 140.0) -> np.ndarray:
    """Découpe une boucle sans couture dans la partie stable de l'enregistrement.

    `hauteur_cible` : la boucle est ensuite **transposée** à cette fréquence.
    Le jeu réaccorde la boucle au compte-tours, mais en restant entre 0,55 et
    2,6 fois sa vitesse — au-delà, un moteur sonne comme un jouet. Une boucle
    prise à 6 600 tr/min ne peut donc pas descendre au ralenti : on la ramène
    vers le milieu de la plage (140 Hz ≈ 2 800 tr/min), et elle couvre alors
    de 1 500 à 7 300 tr/min.
    """
    L, F = int(duree * SR), int(fondu * SR)
    debut = partie_stable(x, duree + fondu)
    # on prend large : aplatir la hauteur et la transposer raccourcissent le morceau
    seg = x[debut:debut + int((L + F) * 1.8)]
    # 2a. hauteur rendue constante (l'enregistrement est une accélération)
    seg, boucler.hauteur = aplatir_hauteur(seg)
    if hauteur_cible and boucler.hauteur > 0:
        # transposition par relecture : un pas de lecture < 1 ralentit, donc grave
        k = hauteur_cible / boucler.hauteur
        seg = np.interp(np.arange(0, len(seg) - 1, k), np.arange(len(seg)), seg).astype(np.float32)
        boucler.hauteur = hauteur_cible
    if len(seg) < L + F:
        seg = np.pad(seg, (0, L + F - len(seg)))
    # 2b. l'enveloppe est aplatie : le timbre reste, la trajectoire s'en va
    env = enveloppe(seg, SR // 8)
    seg = seg / np.maximum(env, env.mean() * 0.25) * env.mean()
    # 3. fondu croisé circulaire : le début reçoit ce qui suivait la fin
    y = seg[:L].copy()
    f = np.linspace(0, 1, F, dtype=np.float32)
    y[:F] = y[:F] * f + seg[L:L + F] * (1 - f)
    return y


def evenement(x: np.ndarray, avant: float = 0.25, apres: float = 0.35) -> np.ndarray:
    """Isole le passage sonore : du premier réveil au dernier souffle."""
    pas = SR // 20
    env = np.array([np.sqrt((x[i:i + pas] ** 2).mean()) for i in range(0, len(x) - pas, pas)])
    seuil = 0.30 * env.max()      # le corps du son, pas ses abords
    forts = np.where(env > seuil)[0]
    if len(forts) == 0:
        return x
    a = max(0, int((forts[0] * pas) - avant * SR))
    b = min(len(x), int((forts[-1] * pas) + apres * SR))
    y = x[a:b].copy()
    # petits fondus aux extrémités : un son qui commence net claque
    n = min(int(0.03 * SR), len(y) // 4)
    y[:n] *= np.linspace(0, 1, n, dtype=np.float32)
    y[-n:] *= np.linspace(1, 0, n, dtype=np.float32)
    return y


def main() -> int:
    manquants = [f for f in SOURCES.values() if not (TELECHARGEMENTS / f).exists()]
    if manquants:
        print("Fichiers source introuvables dans", TELECHARGEMENTS)
        for f in manquants:
            print("  -", f)
        return 1

    print("Montage des bruitages de la voiture :")
    brut = lire(TELECHARGEMENTS / SOURCES["boucle"])
    # `hauteur_cible=None` : la Porsche tient déjà son régime, on garde sa
    # hauteur naturelle. Transposer un enregistrement propre ne fait que
    # l'abîmer — on ne corrige que ce qui est de travers.
    boucle = boucler(brut, duree=2.2, fondu=0.40, hauteur_cible=None)
    ecrire(boucle, "moteur-boucle.mp3")

    demarrage = lire(TELECHARGEMENTS / SOURCES["demarrage"])
    # le démarreur, c'est le début : lancement, allumage, et l'on coupe avant
    # que le ralenti ne s'installe — c'est la boucle qui prend le relais.
    ecrire(evenement(demarrage[: int(4.0 * SR)]), "moteur-demarrage.mp3")

    frein = lire(TELECHARGEMENTS / SOURCES["frein"])
    # `avant` très court : un bruit de freinage doit commencer AU crissement.
    # Avec un quart de seconde de marge, le son arrivait après le coup de frein
    # du joueur — on l'entendait « en retard » alors qu'il partait à l'heure.
    ecrire(evenement(frein, avant=0.015, apres=0.30), "frein.mp3")

    # Le régime de l'enregistrement : le jeu s'en sert pour réaccorder la boucle.
    f0 = getattr(boucler, "hauteur", hauteur(boucle))
    print(f"\nHauteur tenue par la boucle : {f0:.0f} Hz, soit environ {f0 / 3 * 60:.0f} tr/min.")
    print("C'est la valeur à mettre dans `SONS.regimeBoucle` (maps/voiture-pilote.js).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
