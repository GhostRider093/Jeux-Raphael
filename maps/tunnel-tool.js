import * as THREE from 'three';
import { createTunnel, TUNNEL_PROFILES } from './tunnel-geometry.js?v=tunnels-20260819d';

// ══════════════════════════════════════════════════════════════════════════
//  OUTIL DE TRACE DES TUNNELS
// --------------------------------------------------------------------------
//  Poser un point dans l'espace avec une souris, qui n'a que deux axes, est le
//  vrai probleme d'un editeur 3D. La reponse tient en deux gestes separes,
//  jamais melanges :
//
//    - saisir un point le fait glisser SUR SON PLAN HORIZONTAL. C'est le geste
//      naturel : on choisit un endroit sur la carte.
//    - saisir sa poignee verticale regle SA HAUTEUR, et rien d'autre.
//
//  Un seul geste qui ferait les deux a la fois donnerait un point qui part en
//  profondeur des qu'on tourne la camera — c'est ce qui rend la plupart des
//  editeurs 3D impraticables a la souris.
//
//  Troisieme piece, aussi importante que les deux autres : chaque point traine
//  une tige jusqu'au sol et y pose une marque. Sans ce rappel, un point en
//  l'air est illisible — on ne sait jamais a quelle verticale il se trouve.
// ══════════════════════════════════════════════════════════════════════════

const MARKER_COLOR = 0x54f6ff;
const MARKER_SELECTED = 0xffc928;
const HANDLE_COLOR = 0x7be5a0;
const STEM_COLOR = 0x2c5f78;

/**
 * @param {object} options
 *   `scene`, `camera`, `renderer`, `controls` (OrbitControls), `groundY`.
 *   `onChange` est appele apres chaque modification du trace.
 */
export function createTunnelTool({ scene, camera, renderer, controls, groundY = 0, onChange }) {
  const group = new THREE.Group();
  group.name = 'tunnel-tool';
  scene.add(group);

  const points = [];
  const markers = [];
  let selectedIndex = -1;
  let tunnel = null;
  let mode = 'trace';                 // 'trace' pose des points, 'move' les deplace

  const spec = { profile: 'round', radius: 44, wall: 14 };

  // ── REPERES VISUELS ───────────────────────────────────────────────────────
  // Tout l'outillage se dessine PAR-DESSUS la geometrie, profondeur ignoree :
  // les points de controle sont au centre du tunnel, donc enfermes dedans. Un
  // point qu'on ne voit pas est un point qu'on ne peut pas attraper.
  const devant = { depthTest: false, depthWrite: false, transparent: true };
  const RENDER_ORDER = 10;

  const markerGeometry = new THREE.SphereGeometry(1, 16, 12);
  const stems = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: STEM_COLOR, ...devant })
  );
  stems.name = 'tunnel-stems';
  stems.renderOrder = RENDER_ORDER;
  group.add(stems);

  const traceLine = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: MARKER_COLOR, ...devant })
  );
  traceLine.name = 'tunnel-trace';
  traceLine.renderOrder = RENDER_ORDER;
  group.add(traceLine);

  // La paroi est translucide pendant l'edition : on doit voir le trace et les
  // points a travers, sans quoi on travaille a l'aveugle des que la camera
  // passe derriere le tunnel. Le materiau appartient a l'outil, donc il n'est
  // cree qu'une fois et survit aux reconstructions.
  const previewMaterial = new THREE.MeshStandardMaterial({
    color: 0x5a6a78, roughness: .9, metalness: .05, emissive: 0x16222c,
    side: THREE.DoubleSide, transparent: true, opacity: .5, depthWrite: false
  });

  // Poignee de hauteur du point selectionne : une tige et un cone, poses juste
  // au-dessus du marqueur. Elle n'apparait que sur la selection, pour ne pas
  // encombrer le trace.
  const handle = new THREE.Group();
  handle.name = 'tunnel-handle';
  const handleStem = new THREE.Mesh(
    new THREE.CylinderGeometry(.12, .12, 1, 8),
    new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, ...devant })
  );
  handleStem.position.y = .5;
  const handleTip = new THREE.Mesh(
    new THREE.ConeGeometry(.42, 1.1, 12),
    new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, ...devant })
  );
  handleTip.position.y = 1.5;
  handle.add(handleStem, handleTip);
  handle.renderOrder = RENDER_ORDER + 1;
  handleStem.renderOrder = RENDER_ORDER + 1;
  handleTip.renderOrder = RENDER_ORDER + 1;
  handle.visible = false;
  group.add(handle);

  // ── OUTILLAGE DE POINTAGE ─────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
  // Vecteurs reutilises : rien ne doit etre alloue pendant un glissement.
  const hitPoint = new THREE.Vector3();
  const grabOffset = new THREE.Vector3();
  const axisOrigin = new THREE.Vector3();
  const toOrigin = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  let dragging = null;   // { kind: 'move' | 'height', index }

  function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  // ── CONSTRUCTION ──────────────────────────────────────────────────────────

  function rebuildTunnel() {
    if (tunnel) { group.remove(tunnel.mesh); tunnel.dispose(); tunnel = null; }
    if (points.length < 2) return;
    tunnel = createTunnel({
      ...spec,
      name: 'tunnel-apercu',
      material: previewMaterial,
      points: points.map(p => [p.x, p.y, p.z])
    });
    group.add(tunnel.mesh);
  }

  function refreshVisuals() {
    // Tiges de rappel : deux sommets par point, du point jusqu'au sol.
    const stemPositions = new Float32Array(points.length * 6);
    points.forEach((p, i) => {
      stemPositions.set([p.x, p.y, p.z, p.x, groundY, p.z], i * 6);
    });
    stems.geometry.dispose();
    stems.geometry = new THREE.BufferGeometry();
    stems.geometry.setAttribute('position', new THREE.BufferAttribute(stemPositions, 3));

    const linePositions = new Float32Array(points.length * 3);
    points.forEach((p, i) => linePositions.set([p.x, p.y, p.z], i * 3));
    traceLine.geometry.dispose();
    traceLine.geometry = new THREE.BufferGeometry();
    traceLine.geometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));

    markers.forEach((marker, i) => {
      marker.position.copy(points[i]);
      marker.material.color.setHex(i === selectedIndex ? MARKER_SELECTED : MARKER_COLOR);
    });

    handle.visible = selectedIndex >= 0;
    if (selectedIndex >= 0) handle.position.copy(points[selectedIndex]);
  }

  function notify() {
    rebuildTunnel();
    refreshVisuals();
    onChange?.(getSpec());
  }

  function addPoint(x, y, z) {
    const point = new THREE.Vector3(x, y, z);
    points.push(point);
    const marker = new THREE.Mesh(
      markerGeometry,
      new THREE.MeshBasicMaterial({ color: MARKER_COLOR, ...devant })
    );
    marker.renderOrder = RENDER_ORDER;
    marker.userData.index = markers.length;
    markers.push(marker);
    group.add(marker);
    selectedIndex = points.length - 1;
    notify();
    return selectedIndex;
  }

  function removeSelected() {
    if (selectedIndex < 0) return;
    points.splice(selectedIndex, 1);
    const [marker] = markers.splice(selectedIndex, 1);
    group.remove(marker);
    marker.material.dispose();
    markers.forEach((m, i) => { m.userData.index = i; });
    selectedIndex = Math.min(selectedIndex, points.length - 1);
    notify();
  }

  // ── GESTES ────────────────────────────────────────────────────────────────

  function onPointerDown(event) {
    // Le clic droit reste a OrbitControls : c'est lui qui tourne la vue.
    if (event.button !== 0) return;
    updatePointer(event);

    // 1. La poignee de hauteur passe avant tout : elle recouvre son marqueur.
    if (handle.visible && raycaster.intersectObject(handle, true).length) {
      dragging = { kind: 'height', index: selectedIndex };
      axisOrigin.copy(points[selectedIndex]);
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      return;
    }

    // 2. Un marqueur : on le selectionne, et le glissement le deplace au sol.
    const touche = raycaster.intersectObjects(markers, false)[0];
    if (touche) {
      selectedIndex = touche.object.userData.index;
      dragging = { kind: 'move', index: selectedIndex };
      dragPlane.set(dragPlane.normal, -points[selectedIndex].y);
      if (raycaster.ray.intersectPlane(dragPlane, hitPoint)) {
        grabOffset.copy(points[selectedIndex]).sub(hitPoint);
      } else {
        grabOffset.set(0, 0, 0);
      }
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      refreshVisuals();
      return;
    }

    // 3. Le sol : en mode trace, on pose un nouveau point.
    if (mode === 'trace' && raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
      addPoint(hitPoint.x, groundY, hitPoint.z);
      return;
    }

    selectedIndex = -1;
    refreshVisuals();
  }

  function onPointerMove(event) {
    if (!dragging) return;
    updatePointer(event);
    const point = points[dragging.index];

    if (dragging.kind === 'move') {
      // Deplacement a plat : la hauteur du point ne bouge pas d'un pouce.
      dragPlane.set(dragPlane.normal, -point.y);
      if (!raycaster.ray.intersectPlane(dragPlane, hitPoint)) return;
      point.x = hitPoint.x + grabOffset.x;
      point.z = hitPoint.z + grabOffset.z;
    } else {
      // Hauteur : on cherche le point de l'axe vertical le plus proche du
      // rayon de la souris. Meme calcul que l'etirement de l'editeur de cartes.
      const ray = raycaster.ray;
      toOrigin.copy(axisOrigin).sub(ray.origin);
      const alignement = ray.direction.y;              // axe vertical : (0,1,0)
      const denominateur = 1 - alignement * alignement;
      // Regard rasant l'axe : la solution part a l'infini, on ne bouge pas.
      if (Math.abs(denominateur) < 1e-6) return;
      const long = (toOrigin.y - alignement * toOrigin.dot(ray.direction)) / denominateur;
      point.y = axisOrigin.y + long;
    }
    notify();
  }

  function onPointerUp(event) {
    if (!dragging) return;
    dragging = null;
    controls.enabled = true;
    if (renderer.domElement.hasPointerCapture?.(event.pointerId)) {
      renderer.domElement.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event) {
    if (event.code === 'Delete' || event.code === 'Backspace') removeSelected();
    if (event.code === 'Escape') { selectedIndex = -1; refreshVisuals(); }
  }

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  // Le menu contextuel volerait le clic droit, qui sert a tourner la vue.
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('keydown', onKeyDown);

  function getSpec() {
    return { ...spec, points: points.map(p => [
      Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10
    ]) };
  }

  return {
    group,
    getSpec,
    get pointCount() { return points.length; },
    get selectedIndex() { return selectedIndex; },
    get profiles() { return TUNNEL_PROFILES; },

    setMode(next) { mode = next; },
    getMode() { return mode; },

    setProfile(name) { spec.profile = name; notify(); },
    setRadius(value) { spec.radius = value; notify(); },
    setWall(value) { spec.wall = value; notify(); },

    addPoint,
    removeSelected,

    /** Remplace le trace courant, par exemple au chargement d'une carte. */
    load(next) {
      markers.forEach(m => { group.remove(m); m.material.dispose(); });
      markers.length = 0;
      points.length = 0;
      selectedIndex = -1;
      Object.assign(spec, { profile: next.profile, radius: next.radius, wall: next.wall });
      (next.points || []).forEach(p => addPoint(p[0], p[1], p[2]));
      selectedIndex = -1;
      notify();
    },

    /**
     * Garde les marqueurs et la poignee lisibles quel que soit l'eloignement.
     * Appele a chaque image — sans allocation.
     */
    updateScale() {
      markers.forEach(marker => {
        const taille = camera.position.distanceTo(marker.position) * .018;
        marker.scale.setScalar(Math.max(.8, taille));
      });
      if (handle.visible && selectedIndex >= 0) {
        tmp.copy(points[selectedIndex]);
        const taille = camera.position.distanceTo(tmp) * .05;
        handle.scale.setScalar(Math.max(2, taille));
      }
    },

    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      removeEventListener('keydown', onKeyDown);
      scene.remove(group);
    }
  };
}
