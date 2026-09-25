"""Client Meshy : un objet 3D texturé (GLB) à partir d'une phrase.

Meshy est **payant** (crédits) : un objet complet coûte un aperçu (~5 crédits) puis
un affinage texturé (~10 crédits). Le script imprime le solde avant et après pour
qu'on sache ce que ça a coûté.

La clé est lue dans la variable `MESHY_API_KEY`, sinon dans `config/meshy.env`
(dossier ignoré par git) sous la forme `MESHY_API_KEY=msy_...`.

    py scripts/meshy.py balance
    py scripts/meshy.py make "un quad rouge et noir avec son pilote" --nom quad-pilote
    py scripts/meshy.py make "..." --nom quad --style sculpture --sans-refine   # aperçu seul, sans texture
    py scripts/meshy.py get <id_de_tache> --nom quad          # récupérer une tâche déjà finie
    py scripts/meshy.py status <id_de_tache>
    py scripts/meshy.py rig <refine_id> --nom pilote-quad --taille 1.75   # squelette (5 crédits)
    py scripts/meshy.py anims sit                                       # bibliothèque d'animations, gratuit

Le résultat va dans `perso/<nom>/` : `<nom>.glb`, `apercu.png` (la vignette de Meshy)
et `meta.json` (prompt, identifiants de tâches, coût). Pour le voir dans le jeu :
`apercu-glb.html?src=perso/<nom>/<nom>.glb`.

Meshy comprend mieux l'anglais : le prompt est envoyé tel quel, écrire en anglais.
"""
import argparse
import io
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

RACINE = pathlib.Path(__file__).resolve().parents[1]
API = 'https://api.meshy.ai/openapi'


def cle_api():
    cle = os.environ.get('MESHY_API_KEY')
    if not cle:
        env = RACINE / 'config' / 'meshy.env'
        if env.exists():
            for ligne in env.read_text(encoding='utf-8').splitlines():
                if ligne.startswith('MESHY_API_KEY='):
                    cle = ligne.split('=', 1)[1].strip().strip('"\'')
    if not cle:
        sys.exit('Pas de clé : MESHY_API_KEY dans l\'environnement ou dans config/meshy.env')
    return cle


def appel(methode, chemin, corps=None):
    req = urllib.request.Request(API + chemin, method=methode)
    req.add_header('Authorization', 'Bearer ' + cle_api())
    data = None
    if corps is not None:
        data = json.dumps(corps).encode('utf-8')
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data, timeout=60) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        sys.exit(f'Meshy {e.code} sur {methode} {chemin} : {e.read().decode("utf-8", "replace")[:500]}')


def solde():
    return appel('GET', '/v1/balance').get('balance')


def telecharger(url, dest):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, 'wb') as f:
        while True:
            bloc = r.read(1 << 16)
            if not bloc:
                break
            f.write(bloc)


def attendre(tache_id, etiquette):
    """Interroge la tâche jusqu'à SUCCEEDED ; sort du script en cas d'échec."""
    dernier = -1
    while True:
        t = appel('GET', f'/v2/text-to-3d/{tache_id}')
        statut, progres = t.get('status'), t.get('progress', 0)
        if progres != dernier:
            print(f'  {etiquette} {statut} {progres}%', flush=True)
            dernier = progres
        if statut == 'SUCCEEDED':
            return t
        if statut in ('FAILED', 'CANCELED', 'EXPIRED'):
            sys.exit(f'{etiquette} : {statut} — {t.get("task_error")}')
        time.sleep(8)


def sauver(tache, nom, meta):
    dossier = RACINE / 'perso' / nom
    dossier.mkdir(parents=True, exist_ok=True)
    urls = tache.get('model_urls') or {}
    glb = dossier / f'{nom}.glb'
    if urls.get('glb'):
        telecharger(urls['glb'], glb)
        print(f'  GLB : {glb} ({glb.stat().st_size / 1e6:.1f} Mo)')
    if tache.get('thumbnail_url'):
        telecharger(tache['thumbnail_url'], dossier / 'apercu.png')
    meta.update({'tache': {k: v for k, v in tache.items() if k in ('id', 'mode', 'prompt', 'art_style', 'ai_model', 'created_at', 'finished_at')},
                 'glb': str(glb.relative_to(RACINE)).replace('\\', '/')})
    io.open(dossier / 'meta.json', 'w', encoding='utf-8').write(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f'  Aperçu dans le jeu : http://127.0.0.1:8010/apercu-glb.html?src=perso/{nom}/{nom}.glb')
    return glb


def cmd_make(a):
    avant = solde()
    print(f'Solde avant : {avant} crédits')
    corps = {'mode': 'preview', 'prompt': a.prompt, 'art_style': a.style, 'ai_model': a.modele,
             'topology': 'triangle', 'target_polycount': a.polycount, 'should_remesh': True}
    if a.negatif:
        corps['negative_prompt'] = a.negatif
    apercu_id = appel('POST', '/v2/text-to-3d', corps)['result']
    print(f'Aperçu lancé : {apercu_id}')
    apercu = attendre(apercu_id, 'aperçu')
    meta = {'prompt': a.prompt, 'style': a.style, 'modele': a.modele, 'apercu_id': apercu_id}
    final = apercu
    if not a.sans_refine:
        refine_id = appel('POST', '/v2/text-to-3d', {'mode': 'refine', 'preview_task_id': apercu_id, 'enable_pbr': True})['result']
        print(f'Affinage lancé : {refine_id}')
        final = attendre(refine_id, 'affinage')
        meta['refine_id'] = refine_id
    apres = solde()
    meta['credits'] = {'avant': avant, 'apres': apres, 'cout': (avant - apres) if None not in (avant, apres) else None}
    sauver(final, a.nom, meta)
    print(f'Solde après : {apres} crédits (coût {meta["credits"]["cout"]})')


def cmd_get(a):
    t = attendre(a.id, 'tâche')
    sauver(t, a.nom, {'tache_id': a.id})


def cmd_rig(a):
    """Rigging d'un humanoïde texturé (5 crédits) : squelette + GLB riggé dans perso/<nom>/."""
    avant = solde()
    rid = appel('POST', '/v1/rigging', {'input_task_id': a.id, 'height_meters': a.taille})['result']
    print(f'Rigging lancé : {rid}')
    dernier = -1
    while True:
        t = appel('GET', f'/v1/rigging/{rid}')
        if t.get('progress', 0) != dernier:
            dernier = t.get('progress', 0); print(f'  rigging {t.get("status")} {dernier}%', flush=True)
        if t.get('status') == 'SUCCEEDED': break
        if t.get('status') in ('FAILED', 'CANCELED', 'EXPIRED'): sys.exit(f'rigging : {t.get("status")} — {t.get("task_error")}')
        time.sleep(8)
    dossier = RACINE / 'perso' / a.nom; dossier.mkdir(parents=True, exist_ok=True)
    res = t.get('result') or {}
    fichiers = {}
    for k, url in res.items():
        if isinstance(url, str) and url.startswith('http'):
            ext = url.split('?')[0].rsplit('.', 1)[-1].lower()
            if ext not in ('glb', 'fbx', 'png', 'usdz'): ext = 'bin'
            dest = dossier / f'{a.nom}-{k}.{ext}'
            telecharger(url, dest); fichiers[k] = dest.relative_to(RACINE).as_posix()
            print(f'  {k} : {dest} ({dest.stat().st_size / 1e6:.1f} Mo)')
    apres = solde()
    meta_p = dossier / 'meta.json'
    meta = json.loads(meta_p.read_text(encoding='utf-8')) if meta_p.exists() else {}
    meta['rigging'] = {'id': rid, 'taille_m': a.taille, 'fichiers': fichiers, 'credits': {'avant': avant, 'apres': apres}}
    io.open(meta_p, 'w', encoding='utf-8').write(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f'Solde après : {apres} crédits (coût {avant - apres})')


def cmd_anims(a):
    d = appel('GET', '/v1/animations/library?search=' + a.recherche)
    for i in (d if isinstance(d, list) else d.get('result', [])):
        print(f'{i.get("action_id"):>4}  {i.get("name")}  [{i.get("category")}/{i.get("sub_category")}]')


def cmd_status(a):
    t = appel('GET', f'/v2/text-to-3d/{a.id}')
    print(json.dumps({k: t.get(k) for k in ('id', 'mode', 'status', 'progress', 'task_error', 'model_urls', 'thumbnail_url')}, ensure_ascii=False, indent=2))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest='cmd', required=True)
    sp.add_parser('balance')
    m = sp.add_parser('make')
    m.add_argument('prompt')
    m.add_argument('--nom', required=True, help='nom du dossier de sortie dans perso/')
    m.add_argument('--style', default='realistic', choices=['realistic', 'sculpture'])
    m.add_argument('--modele', default='latest', help='meshy-4, meshy-5, latest')
    m.add_argument('--polycount', type=int, default=30000)
    m.add_argument('--negatif', default='', help='ce qu\'on ne veut pas voir')
    m.add_argument('--sans-refine', action='store_true', help='aperçu seul, sans texture (moins cher)')
    g = sp.add_parser('get')
    g.add_argument('id'); g.add_argument('--nom', required=True)
    s = sp.add_parser('status'); s.add_argument('id')
    r = sp.add_parser('rig'); r.add_argument('id', help='id de la tâche refine'); r.add_argument('--nom', required=True); r.add_argument('--taille', type=float, default=1.7)
    an = sp.add_parser('anims'); an.add_argument('recherche')
    a = p.parse_args()
    if a.cmd == 'balance':
        print(f'{solde()} crédits')
    elif a.cmd == 'make':
        cmd_make(a)
    elif a.cmd == 'get':
        cmd_get(a)
    elif a.cmd == 'rig':
        cmd_rig(a)
    elif a.cmd == 'anims':
        cmd_anims(a)
    else:
        cmd_status(a)


if __name__ == '__main__':
    main()
