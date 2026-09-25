"""Exporte le corps de chaque FCStd du skatepark modulaire en STL (FreeCADCmd, sans fenêtre).

    "C:/Program Files/FreeCAD 1.0/bin/FreeCADCmd.exe" export_fcstd.py
"""
import glob, os, sys
import FreeCAD, Mesh, MeshPart

ici = os.path.dirname(os.path.abspath(__file__))
for f in sorted(glob.glob(os.path.join(ici, 'modular', '*.FCStd'))):
    doc = FreeCAD.openDocument(f)
    corps = [o for o in doc.Objects if o.TypeId in ('PartDesign::Body', 'Part::Feature') and hasattr(o, 'Shape') and not o.Shape.isNull()]
    bodies = [o for o in corps if o.TypeId == 'PartDesign::Body'] or corps
    if not bodies:
        print('RIEN dans', f, [o.TypeId for o in doc.Objects]); continue
    m = Mesh.Mesh()
    for b in bodies:
        m.addMesh(MeshPart.meshFromShape(Shape=b.Shape, LinearDeflection=0.5, AngularDeflection=0.3, Relative=False))
    out = os.path.join(ici, 'modular', os.path.splitext(os.path.basename(f))[0] + '.stl')
    m.write(out)
    bb = m.BoundBox
    print('OK', os.path.basename(out), 'faces', m.CountFacets, 'bbox', round(bb.XLength, 1), round(bb.YLength, 1), round(bb.ZLength, 1))
    FreeCAD.closeDocument(doc.Name)
