// ulvheim.js — bâtiments et ruines vikings placés en anneau autour de la ville
// Chargé par raphael2.html après rzphzel.js

(function () {

  // Échelle : les STL sont en mm pour impression 3D.
  // À 0.09 → bâtiment principal ~11 × 12 × 6 unités monde (taille d'une maison).
  const SCALE = 0.09;

  // Rotation STL → Three.js : les STL sont Z-up, Three.js est Y-up.
  const STL_FIX_X = -Math.PI / 2;

  const ASSET_ROOT = './assets/Ulvheim/';

  // Chaque entrée : fichier GLB, position (x, z), rotation Y (face vers la ville)
  const PLACEMENTS = [
    { file: 'ulvheim-A-1.glb',        x:   29.4, z:  145.0, ry: 3.34 },
    { file: 'ulvheim-A-2.glb',        x:   85.8, z:  113.1, ry: 3.79 },
    { file: 'ulvheim-A-1-ruin1.glb',  x:  121.1, z:   62.0, ry: 4.24 },
    { file: 'ulvheim-A-1-ruin2.glb',  x:  148.0, z:    3.6, ry: 4.69 },
    { file: 'ulvheim-A-1-ruin3.glb',  x:  129.4, z:  -58.5, ry: 5.14 },
    { file: 'ulvheim-A-1-ruin4.glb',  x:   87.4, z: -104.2, ry: 5.59 },
    { file: 'ulvheim-A-1-ruin5.glb',  x:   36.4, z: -143.4, ry: 6.03 },
    { file: 'ulvheim-A-2-ruin1A.glb', x:  -28.2, z: -139.2, ry: 6.48 },
    { file: 'ulvheim-A-2-ruin1B.glb', x:  -82.2, z: -108.4, ry: 6.93 },
    { file: 'ulvheim-A-2-ruin2A.glb', x: -131.7, z:  -67.4, ry: 7.38 },
    { file: 'ulvheim-A-2-ruin2B.glb', x: -142.0, z:   -3.5, ry: 7.83 },
    { file: 'ulvheim-A-2-ruin3A.glb', x: -123.9, z:   56.0, ry: 8.28 },
    { file: 'ulvheim-A-2-ruin3B.glb', x:  -95.1, z:  113.4, ry: 8.73 },
    { file: 'ulvheim-A-2-ruin5.glb',  x:  -35.0, z:  137.6, ry: 9.18 },
  ];

  function waitForScene(cb) {
    if (window.scene && window.THREE && window.GLTFLoader) { cb(); return; }
    window.addEventListener('sceneready', cb, { once: true });
    // Fallback polling si l'événement n'est pas émis
    const t = setInterval(() => {
      if (window.scene && window.THREE && window.GLTFLoader) { clearInterval(t); cb(); }
    }, 200);
  }

  function placeBuilding(placement) {
    const loader = new window.GLTFLoader();
    loader.load(ASSET_ROOT + placement.file, gltf => {
      const root = gltf.scene;

      // Corriger orientation STL (Z-up → Y-up)
      root.rotation.x = STL_FIX_X;
      root.updateMatrixWorld(true);

      // Appliquer l'échelle
      root.scale.setScalar(SCALE);
      root.updateMatrixWorld(true);

      // Recentrer le modèle au sol (y=0)
      const box = new window.THREE.Box3().setFromObject(root);
      root.position.x = placement.x - (box.min.x + box.max.x) / 2 * SCALE;
      root.position.z = placement.z - (box.min.z + box.max.z) / 2 * SCALE;
      root.position.y = -box.min.y;

      // Orienter vers le centre de l'île
      root.rotation.y = placement.ry;

      // Matériau pierre/bois pour les ruines
      const isRuin = placement.file.includes('ruin');
      root.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow    = true;
        node.receiveShadow = true;
        node.material = new window.THREE.MeshStandardMaterial({
          color:     isRuin ? 0x7a6a58 : 0x8a7a68,
          roughness: isRuin ? 0.92     : 0.85,
          metalness: 0.04,
        });
      });

      window.scene.add(root);

      // Rendre collidable si le tableau existe dans rzphzel.js
      if (Array.isArray(window.collidableObjects)) {
        window.collidableObjects.push(root);
      }
    });
  }

  // ── Stade Las Vegas Allegiant ──────────────────────────────────────────────
  // GLB Meshy AI, déjà Y-up (pas de rotation STL), placé au nord de l'île séparé de la ville.
  // scale 5 → ~56 × 37 × 60 unités monde. Position z=132 → 30 unités de marge avec la ville.
  function placeLasVegas() {
    const loader = new window.GLTFLoader();
    loader.load('./assets/lasvegas_allegiant.glb', gltf => {
      const root = gltf.scene;

      root.scale.setScalar(5);
      root.updateMatrixWorld(true);

      // Centrer sur X et Z, poser sur le sol
      const box    = new window.THREE.Box3().setFromObject(root);
      const center = box.getCenter(new window.THREE.Vector3());
      root.position.x -= center.x;
      root.position.z = 132 - center.z;
      root.position.y -= box.min.y;

      root.traverse(node => {
        if (!node.isMesh) return;
        node.castShadow    = true;
        node.receiveShadow = true;
      });

      window.scene.add(root);
    });
  }

  waitForScene(() => {
    PLACEMENTS.forEach(p => placeBuilding(p));
    placeLasVegas();
  });

})();
