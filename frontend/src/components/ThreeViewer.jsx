import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const R = 6371000;

/**
 * Local coordinate system: an equirectangular / small-area ENU approximation
 * centred on the ULPIN parcel's own lat/lon (passed in as `origin`), not on
 * whatever the footprint's first vertex happens to be. Valid at building
 * scale (tens of meters) where earth curvature is negligible:
 *   x = R * cos(originLat) * (lon - originLon) in radians   [east, meters]
 *   y = R * (lat - originLat) in radians                    [north, meters]
 */
function toLocalXY(lon, lat, originLon, originLat) {
  const x = THREE.MathUtils.degToRad(lon - originLon) * R * Math.cos(THREE.MathUtils.degToRad(originLat));
  const y = THREE.MathUtils.degToRad(lat - originLat) * R;
  return [x, y];
}

/**
 * threeD: payload from /api/ulpin/{id}/3d — footprint is the REAL matched OSM
 * polygon (any number of vertices) when isEstimated=false, or a labeled
 * estimated footprint otherwise. Same shape is reused for every floor.
 * highlightFloorLabels: floor labels to tint (overlap indicator)
 * visibleFloorIndex: null = show all, -1 = none, or a floor index to isolate
 */
export default function ThreeViewer({ threeD, highlightFloorLabels = [], visibleFloorIndex = null }) {
  const wrapRef = useRef(null);
  const controlsRef = useRef(null);
  const resetRef = useRef(null);

  useEffect(() => {
    if (!threeD || !wrapRef.current) return;
    const wrap = wrapRef.current;
    wrap.innerHTML = '';
    const w = wrap.clientWidth, h = wrap.clientHeight || 320;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    wrap.appendChild(renderer.domElement);

    scene.add(new THREE.GridHelper(80, 40, 0x2C343C, 0x1F262D));
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const dir = new THREE.DirectionalLight(0xC79A56, 1.1);
    dir.position.set(15, 25, 10);
    scene.add(dir);

    const originLat = threeD.originLatitude;
    const originLon = threeD.originLongitude;

    // Validate: need at least 3 distinct vertices to form a polygon. The backend
    // already repairs self-intersections (shapely buffer(0)) before this arrives.
    const rawPts = threeD.footprint.map(([lon, lat]) => toLocalXY(lon, lat, originLon, originLat));
    const pts = rawPts.map(([x, y]) => new THREE.Vector2(x, y));
    const validPolygon = pts.length >= 3;
    const shape = validPolygon ? new THREE.Shape(pts) : new THREE.Shape([
      new THREE.Vector2(-1, -1), new THREE.Vector2(1, -1), new THREE.Vector2(1, 1), new THREE.Vector2(-1, 1),
    ]);

    const bbox = new THREE.Box3();
    const floorMeshes = [];
    threeD.floors.forEach((floor) => {
      const relBottom = floor.bottomM - threeD.groundElevationM;
      const depth = Math.max(0.05, floor.topM - floor.bottomM);
      // Extrude triangulates the polygon internally (THREE.ShapeGeometry/ExtrudeGeometry
      // use THREE.ShapeUtils.triangulateShape) — arbitrary simple polygons, not just rectangles.
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, relBottom, 0);
      geo.computeBoundingBox();
      bbox.union(geo.boundingBox);

      const highlighted = highlightFloorLabels.includes(floor.label);
      const isRoof = floor.label === 'ROOF';
      const color = highlighted ? 0xBD5B49 : isRoof ? 0x6B5636 : 0x3E5F42;
      const mat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: highlighted ? 0.9 : (isRoof ? 0.6 : 0.8), flatShading: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.userData.floorIndex = floor.index;

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: highlighted ? 0xE38A78 : 0xC79A56 }));

      const visible = visibleFloorIndex == null || visibleFloorIndex === -1 ? visibleFloorIndex !== -1 : visibleFloorIndex === floor.index;
      mesh.visible = visible;
      edges.visible = visible;

      scene.add(mesh);
      scene.add(edges);
      floorMeshes.push(mesh);
    });

    // Auto-frame the ACTUAL footprint's bounding box — works for any shape, not just
    // a rectangle-shaped assumption. Falls back to a sane default if geometry is degenerate.
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 4);
    const dist = maxDim * 1.8;

    function resetView() {
      camera.position.set(center.x + dist * 0.7, center.y + dist * 0.6, center.z + dist * 0.7);
      if (controlsRef.current) {
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
      } else {
        camera.lookAt(center);
      }
    }
    resetRef.current = resetView;
    resetView();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = maxDim * 0.3;
    controls.maxDistance = maxDim * 8;
    controlsRef.current = controls;

    let raf;
    function animate() {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    animate();

    function onResize() {
      const nw = wrap.clientWidth, nh = wrap.clientHeight || 320;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    }
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
    };
  }, [threeD, highlightFloorLabels, visibleFloorIndex]);

  return (
    <div className="three-wrap-outer">
      <div className="three-wrap" ref={wrapRef} />
      <button className="btn ghost small three-reset-btn" onClick={() => resetRef.current && resetRef.current()}>Reset view</button>
    </div>
  );
}

