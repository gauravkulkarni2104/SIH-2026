import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

const R = 6371000;

// ── coordinate helpers ──────────────────────────────────────────────────────
function toLocalXY(lon, lat, originLon, originLat) {
  const x = THREE.MathUtils.degToRad(lon - originLon) * R * Math.cos(THREE.MathUtils.degToRad(originLat));
  const y = THREE.MathUtils.degToRad(lat - originLat) * R;
  return [x, y];
}

// ── floor color palette ─────────────────────────────────────────────────────
// B1 (underground) → ground → mid → upper → roof
function floorColor(floorLabel, isHighlighted) {
  if (isHighlighted)          return { hex: 0xBD5B49, opacity: 1.0 };
  if (floorLabel === 'B1')    return { hex: 0x2A3A6E, opacity: 0.85 };  // underground: deep blue-purple
  if (floorLabel === 'ROOF')  return { hex: 0x3C3028, opacity: 1.0 };  // roof: dark slate
  if (floorLabel === 'F1')    return { hex: 0xC07A38, opacity: 1.0 };  // ground floor: warm amber
  if (floorLabel === 'F2')    return { hex: 0x4A7A5A, opacity: 1.0 };  // 2nd: forest green
  // Upper floors — gradient teal→blue
  const match = floorLabel?.match(/F(\d+)/);
  if (match) {
    const n = parseInt(match[1], 10);
    const t = Math.min((n - 2) / 8, 1);
    const r = Math.round(0x4A + t * (0x2A - 0x4A));
    const g = Math.round(0x7A + t * (0x5A - 0x7A));
    const b = Math.round(0x5A + t * (0x9A - 0x5A));
    return { hex: (r << 16) | (g << 8) | b, opacity: 1.0 };
  }
  return { hex: 0x3E5F42, opacity: 1.0 };
}

function edgeColor(floorLabel, isHighlighted) {
  if (isHighlighted)        return 0xE38A78;
  if (floorLabel === 'B1')  return 0x5B78D4;  // underground edge glow
  if (floorLabel === 'ROOF')return 0x7A6A50;
  return 0xC79A56;                             // brass for all standard floors
}

// ── floor label sprites ─────────────────────────────────────────────────────
function makeFloorLabel(text, color = '#8D939A') {
  const canvas = document.createElement('canvas');
  canvas.width  = 200;
  canvas.height = 80;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.font      = 'bold 42px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 100, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  return sprite;
}

// ── ground grid plane ───────────────────────────────────────────────────────
function makeGroundPlane(size) {
  const geo = new THREE.PlaneGeometry(size * 6, size * 6);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0D1117,
    metalness: 0.3,
    roughness: 0.7,
    transparent: true,
    opacity: 0.85,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.02;
  mesh.receiveShadow = true;
  return mesh;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function ThreeViewer({ threeD, highlightFloorLabels = [], visibleFloorIndex = null }) {
  const wrapRef    = useRef(null);
  const controlsRef = useRef(null);
  const resetRef   = useRef(null);

  // For animated build: track which floors are revealed
  const [builtFloors, setBuiltFloors] = useState(0);
  const [animDone, setAnimDone]       = useState(false);

  // Trigger build animation when threeD changes
  useEffect(() => {
    if (!threeD) return;
    setBuiltFloors(0);
    setAnimDone(false);
    const total = threeD.floors.length;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      setBuiltFloors(i);
      if (i >= total) { clearInterval(iv); setAnimDone(true); }
    }, 120);
    return () => clearInterval(iv);
  }, [threeD]);

  useEffect(() => {
    if (!threeD || !wrapRef.current) return;

    const wrap = wrapRef.current;
    wrap.innerHTML = '';
    const w = wrap.clientWidth;
    const h = wrap.clientHeight || window.innerHeight;

    // ── Scene ──────────────────────────────────────────────────────────────
    const scene    = new THREE.Scene();
    scene.fog      = new THREE.FogExp2(0x080C10, 0.012);
    scene.background = new THREE.Color(0x080C10);

    const camera   = new THREE.PerspectiveCamera(42, w / h, 0.1, 8000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    wrap.appendChild(renderer.domElement);

    // ── Lighting ───────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x1A2A3A, 1.2));

    const sun = new THREE.DirectionalLight(0xFFE8C0, 1.8);
    sun.position.set(30, 60, 20);
    sun.castShadow  = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far  = 500;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
    sun.shadow.camera.right = sun.shadow.camera.top   =  80;
    scene.add(sun);

    // Blue-purple fill for underground glow
    const fillLight = new THREE.PointLight(0x3A5FD4, 2.5, 60);
    fillLight.position.set(0, -8, 0);
    scene.add(fillLight);

    // Warm accent
    const rimLight = new THREE.DirectionalLight(0xC79A56, 0.6);
    rimLight.position.set(-20, 10, -15);
    scene.add(rimLight);

    // ── Grid + ground ──────────────────────────────────────────────────────
    const grid = new THREE.GridHelper(160, 80, 0x1C242C, 0x131A21);
    grid.position.y = 0.01;
    scene.add(grid);

    const originLat = threeD.originLatitude;
    const originLon = threeD.originLongitude;

    // ── Build footprint shape ──────────────────────────────────────────────
    const rawPts = threeD.footprint.map(([lon, lat]) => toLocalXY(lon, lat, originLon, originLat));
    const pts    = rawPts.map(([x, y]) => new THREE.Vector2(x, y));
    const validPoly = pts.length >= 3;
    const shape  = validPoly
      ? new THREE.Shape(pts)
      : new THREE.Shape([
          new THREE.Vector2(-5, -5), new THREE.Vector2(5, -5),
          new THREE.Vector2(5, 5),   new THREE.Vector2(-5, 5),
        ]);

    // ── Underground level (B1) ─────────────────────────────────────────────
    const undergroundDepth = Math.max(2.8, (threeD.floors[0]?.topM - threeD.floors[0]?.bottomM) || 3.0);
    const ugGeo = new THREE.ExtrudeGeometry(shape, { depth: undergroundDepth, bevelEnabled: false, curveSegments: 1 });
    ugGeo.rotateX(-Math.PI / 2);
    ugGeo.translate(0, -undergroundDepth, 0);

    const ugMat = new THREE.MeshStandardMaterial({
      color: 0x2A3A6E, transparent: true, opacity: 0.65,
      emissive: 0x1A2A5E, emissiveIntensity: 0.4,
      metalness: 0.2, roughness: 0.8,
    });
    const ugMesh = new THREE.Mesh(ugGeo, ugMat);
    ugMesh.castShadow = ugMesh.receiveShadow = true;
    scene.add(ugMesh);

    // Underground edges with glow color
    const ugEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(ugGeo),
      new THREE.LineBasicMaterial({ color: 0x5B78D4, linewidth: 1 })
    );
    scene.add(ugEdges);

    // B1 label
    const b1Label = makeFloorLabel('B1', '#5B78D4');
    b1Label.position.set(0, -undergroundDepth / 2, 0);
    b1Label.scale.set(8, 3.2, 1);
    scene.add(b1Label);

    // ── Above-ground floors ────────────────────────────────────────────────
    const bbox       = new THREE.Box3();
    const floorMeshes = [];

    threeD.floors.forEach((floor, idx) => {
      const relBottom = floor.bottomM - threeD.groundElevationM;
      const depth     = Math.max(0.05, floor.topM - floor.bottomM);
      const geo       = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, relBottom, 0);
      geo.computeBoundingBox();
      bbox.union(geo.boundingBox);

      const highlighted = highlightFloorLabels.includes(floor.label);
      const { hex, opacity } = floorColor(floor.label, highlighted);

      const mat = new THREE.MeshStandardMaterial({
        color: hex,
        transparent: true,
        opacity,
        metalness: 0.15,
        roughness: 0.6,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.floorIndex = floor.index;
      // Build animation: start invisible
      mesh.visible = false;

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: edgeColor(floor.label, highlighted) })
      );
      edges.visible = false;

      scene.add(mesh);
      scene.add(edges);
      floorMeshes.push({ mesh, edges, floor, relBottom, depth });

      // Floor label sprite
      const lbl = makeFloorLabel(floor.label, floor.label === 'ROOF' ? '#7A6A50' : '#C79A56');
      lbl.position.set(0, relBottom + depth / 2, 0);
      lbl.scale.set(7, 2.8, 1);
      lbl.visible = false;
      scene.add(lbl);
      floorMeshes[floorMeshes.length - 1].labelSprite = lbl;
    });

    // ── ULPIN big floating 3D text ─────────────────────────────────────────
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 4);

    const fontLoader = new FontLoader();
    fontLoader.load('https://unpkg.com/three@0.160.0/examples/fonts/helvetiker_bold.typeface.json', (font) => {
      const textStr = threeD.ulpin || 'ULPIN';
      const textGeo = new TextGeometry(textStr, {
        font: font,
        size: maxDim * 0.22,
        depth: maxDim * 0.04,
        curveSegments: 4,
        bevelEnabled: true,
        bevelThickness: maxDim * 0.008,
        bevelSize: maxDim * 0.004,
        bevelOffset: 0,
        bevelSegments: 3
      });

      textGeo.computeBoundingBox();
      const textWidth = textGeo.boundingBox.max.x - textGeo.boundingBox.min.x;
      textGeo.translate(-textWidth / 2, 0, 0); // Center text horizontally

      const textMatFront = new THREE.MeshStandardMaterial({
        color: 0xF0DEB0,
        metalness: 0.1,
        roughness: 0.2,
        emissive: 0x4a3a10,
        emissiveIntensity: 0.5
      });
      const textMatSide = new THREE.MeshStandardMaterial({
        color: 0xC79A56,
        metalness: 0.5,
        roughness: 0.4,
      });

      const textMesh = new THREE.Mesh(textGeo, [textMatFront, textMatSide]);
      textMesh.position.set(center.x, bbox.max.y + maxDim * 0.35, center.z);
      
      // Make it face slightly upward and forward
      textMesh.rotation.x = -Math.PI * 0.05;
      
      textMesh.castShadow = true;
      scene.add(textMesh);
      
      // Add a small point light to give it a glowing aura
      const textAura = new THREE.PointLight(0xC79A56, 1.5, maxDim * 2);
      textAura.position.set(center.x, bbox.max.y + maxDim * 0.35, center.z + maxDim * 0.2);
      scene.add(textAura);
    });

    // ── Ground plane ───────────────────────────────────────────────────────
    scene.add(makeGroundPlane(maxDim));

    // ── Camera + controls ──────────────────────────────────────────────────
    const dist = maxDim * 2.2;

    function resetView() {
      camera.position.set(center.x + dist * 0.75, center.y + dist * 0.65, center.z + dist * 0.75);
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
    controls.enableDamping  = true;
    controls.dampingFactor  = 0.07;
    controls.minDistance    = maxDim * 0.25;
    controls.maxDistance    = maxDim * 10;
    controls.autoRotate     = true;
    controls.autoRotateSpeed = 0.4;
    controlsRef.current = controls;

    // Stop auto-rotate on user interaction
    renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });

    // ── Build animation state ──────────────────────────────────────────────
    let builtCount = 0;

    // ── Render loop ────────────────────────────────────────────────────────
    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // ── Expose builtFloors update via a custom event ───────────────────────
    // We use a ref-based subscription from the React state above.
    function updateVisibility(builtN) {
      floorMeshes.forEach(({ mesh, edges, floor, labelSprite }, idx) => {
        const revealed = idx < builtN;
        const isVisible = visibleFloorIndex == null
          ? revealed
          : visibleFloorIndex === -1
            ? false
            : visibleFloorIndex === floor.index && revealed;

        mesh.visible   = isVisible;
        edges.visible  = isVisible;
        if (labelSprite) labelSprite.visible = isVisible;
      });
    }

    // Poll builtFloors from React state via a shared ref trick
    const builtRef = { current: 0 };
    const stateInterval = setInterval(() => {
      // Read from DOM attribute set by React
      const v = parseInt(wrap.dataset.builtFloors || '0', 10);
      if (v !== builtRef.current) {
        builtRef.current = v;
        updateVisibility(v);
      }
    }, 50);

    function onResize() {
      const nw = wrap.clientWidth, nh = wrap.clientHeight || window.innerHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    }
    window.addEventListener('resize', onResize);

    return () => {
      clearInterval(stateInterval);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
    };
  }, [threeD, highlightFloorLabels, visibleFloorIndex]);

  // Sync builtFloors count into DOM for the Three.js interval to pick up
  useEffect(() => {
    if (wrapRef.current) {
      wrapRef.current.dataset.builtFloors = builtFloors;
    }
  }, [builtFloors]);

  return (
    <div className="three-wrap-outer">
      {/* Build progress overlay */}
      {!animDone && threeD && (
        <div className="build-progress">
          <div className="build-bar" style={{ width: `${(builtFloors / threeD.floors.length) * 100}%` }} />
          <span className="build-label">
            Building model… floor {builtFloors}/{threeD.floors.length}
          </span>
        </div>
      )}

      <div className="three-wrap" ref={wrapRef} />

      {/* Reset view button */}
      <button
        className="btn ghost small three-reset-btn"
        onClick={() => resetRef.current && resetRef.current()}
      >
        ⊙ Reset view
      </button>

      {/* Underground indicator badge */}
      <div className="underground-badge">
        <span className="ug-dot" />
        B1 — Underground level (visual placeholder · ML will refine)
      </div>
    </div>
  );
}
