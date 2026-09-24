"""Écriture d'un paquet binaire unique (village.bin) décrit par un index JSON.

Chaque tableau est aligné sur 4 octets. L'index donne pour chaque nom :
offset (octets), count (éléments), type ('f32', 'u32', 'u16', 'u8'), itemSize.
"""
import numpy as np

# f16 : demi-précision. Trois chiffres significatifs suffisent aux coordonnées de
# texture d'un toit ou d'une façade (le pas est de 3 cm sur 30 m), et le fichier
# fond de moitié. À réserver aux attributs, jamais aux positions : sur un village
# de 1,3 km, le demi-flottant ne descend pas sous le demi-mètre.
TYPES = {"f32": np.float32, "f16": np.float16, "u32": np.uint32,
         "u16": np.uint16, "u8": np.uint8, "i16": np.int16}


class Packer:
    def __init__(self):
        self.chunks = []
        self.index = {}
        self.size = 0

    def add(self, name, array, kind, item_size=1):
        a = np.ascontiguousarray(np.asarray(array).reshape(-1), dtype=TYPES[kind])
        raw = a.tobytes()
        pad = (-len(raw)) % 4
        self.index[name] = {"offset": self.size, "count": int(a.size), "type": kind, "itemSize": item_size}
        self.chunks.append(raw + b"\0" * pad)
        self.size += len(raw) + pad

    def write(self, path):
        with open(path, "wb") as fh:
            for c in self.chunks:
                fh.write(c)
        return self.index
