import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const EARTH_RADIUS = 6371000;

// ── Coordinate conversion ───────────────────────────────────────────────────
// Converts lon/lat degrees relative to origin to local meters [x, z].
// X = East/West (+X is East)
// Z = North/South (+Z is North)
function toLocalXZ(lon, lat, originLon, originLat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(originLon) || !Number.isFinite(originLat)) {
    return null;
  }
  const x = THREE.MathUtils.degToRad(lon - originLon) * EARTH_RADIUS * Math.cos(THREE.MathUtils.degToRad(originLat));
  const z = THREE.MathUtils.degToRad(lat - originLat) * EARTH_RADIUS;
  if (!Number.isFinite(x) || !Number.isFinite(z)) {
    return null;
  }
  return [x, z];
}

// ── Floor color palette ─────────────────────────────────────────────────────
function getFloorStyle(floorLabel, isHighlighted, isUnderground) {
  if (isHighlighted) {
    return { fillHex: 0xEF4444, edgeHex: 0xFCA5A5, opacity: 1.0 };
  }
  if (isUnderground || floorLabel?.startsWith('B') || floorLabel === 'BASEMENT') {
    return { fillHex: 0x1E293B, edgeHex: 0x64748B, opacity: 0.85 }; // Translucent dark slate basement
  }
  if (floorLabel === 'ROOF') {
    return { fillHex: 0x334155, edgeHex: 0x94A3B8, opacity: 1.0 }; // Dark slate roof cap
  }
  if (floorLabel === 'GROUND' || floorLabel === 'FLOOR 0' || floorLabel === 'F1') {
    return { fillHex: 0xD97706, edgeHex: 0xFCD34D, opacity: 1.0 }; // Warm amber ground floor
  }
  if (floorLabel === 'FLOOR 1' || floorLabel === 'F2') {
    return { fillHex: 0x059669, edgeHex: 0x6EE7B7, opacity: 1.0 }; // Emerald green 2nd floor
  }

  // Upper floors — architecturally pleasant teal/blue gradient
  const match = floorLabel?.match(/(?:FLOOR|F)\s*(\d+)/i);
  if (match) {
    const n = parseInt(match[1], 10);
    const t = Math.min((n - 1) / 8, 1);
    const r = Math.round(0x02 + t * (0x25 - 0x02));
    const g = Math.round(0x84 + t * (0x63 - 0x84));
    const b = Math.round(0xD7 + t * (0xEB - 0xD7));
    return { fillHex: (r << 16) | (g << 8) | b, edgeHex: 0x93C5FD, opacity: 1.0 };
  }
  return { fillHex: 0x475569, edgeHex: 0xCBD5E1, opacity: 1.0 };
}

// ── Floor label sprite ──────────────────────────────────────────────────────
function makeFloorLabelSprite(text, color = '#94A3B8') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  if (ctx.roundRect) ctx.roundRect(8, 8, 240, 80, 10);
  else ctx.fillRect(8, 8, 240, 80);
  ctx.fill();
  ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 36px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 48);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  return new THREE.Sprite(material);
}

// ── Green Translucent Parcel & Ground Plane ─────────────────────────────────
function createGreenGroundPlane(size, centerY = 0) {
  const group = new THREE.Group();

  // Green translucent ground plane
  const planeGeo = new THREE.PlaneGeometry(size, size);
  const planeMat = new THREE.MeshStandardMaterial({
    color: 0x059669,       // Emerald green
    metalness: 0.1,
    roughness: 0.6,
    transparent: true,
    opacity: 0.35,          // Translucent so basement is visible below
    side: THREE.DoubleSide,
  });
  const planeMesh = new THREE.Mesh(planeGeo, planeMat);
  planeMesh.rotation.x = -Math.PI / 2;
  planeMesh.position.y = centerY;
  planeMesh.receiveShadow = true;
  group.add(planeMesh);

  // Parcel boundary outline
  const edgesGeo = new THREE.EdgesGeometry(planeGeo);
  const edgesMat = new THREE.LineBasicMaterial({ color: 0x34D399, linewidth: 2 });
  const edgesLine = new THREE.LineSegments(edgesGeo, edgesMat);
  edgesLine.rotation.x = -Math.PI / 2;
  edgesLine.position.y = centerY + 0.01;
  group.add(edgesLine);

  // Subtle grid overlay
  const grid = new THREE.GridHelper(size, 20, 0x10B981, 0x064E3B);
  grid.position.y = centerY + 0.02;
  group.add(grid);

  return group;
}

// ─────────────────────────────────────────────────────────────────────────────
// ThreeViewer Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ThreeViewer({ threeD, highlightFloorLabels = [], visibleFloorIndex = null }) {
  const wrapRef = useRef(null);
  const controlsRef = useRef(null);
  const resetRef = useRef(null);

  const [builtFloors, setBuiltFloors] = useState(0);
  const [animDone, setAnimDone] = useState(false);

  // Trigger floor build animation on new threeD prop
  useEffect(() => {
    if (!threeD || !Array.isArray(threeD.floors)) return;
    setBuiltFloors(0);
    setAnimDone(false);
    const total = threeD.floors.length;
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setBuiltFloors(count);
      if (count >= total) {
        clearInterval(interval);
        setAnimDone(true);
      }
    }, 90);
    return () => clearInterval(interval);
  }, [threeD]);

  useEffect(() => {
    if (!threeD || !wrapRef.current) return;
    const wrap = wrapRef.current;
    wrap.innerHTML = '';

    // 1. Validate origin coordinates
    const originLat = Number(threeD.originLatitude);
    const originLon = Number(threeD.originLongitude);
    if (!Number.isFinite(originLat) || !Number.isFinite(originLon)) {
      wrap.innerHTML = '<div class="unavail-banner">⚠ Invalid origin coordinates — 3D model cannot be rendered.</div>';
      return;
    }

    // 2. Validate footprint coordinates
    const rawFootprint = Array.isArray(threeD.footprint) ? threeD.footprint : [];
    let validFootprint = rawFootprint
      .filter(pt => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])))
      .map(([lon, lat]) => [Number(lon), Number(lat)]);

    // De-duplicate closed ring endpoint if present
    if (validFootprint.length > 3) {
      const first = validFootprint[0];
      const last = validFootprint[validFootprint.length - 1];
      if (Math.abs(first[0] - last[0]) < 1e-7 && Math.abs(first[1] - last[1]) < 1e-7) {
        validFootprint.pop();
      }
    }

    if (validFootprint.length < 3) {
      wrap.innerHTML = '<div class="unavail-banner">⚠ Insufficient valid polygon vertices for 3D extrusion.</div>';
      return;
    }

    // 3. Convert geographic coordinates to local meters [x, z]
    const localPts = validFootprint
      .map(([lon, lat]) => toLocalXZ(lon, lat, originLon, originLat))
      .filter(Boolean);

    if (localPts.length < 3) {
      wrap.innerHTML = '<div class="unavail-banner">⚠ Coordinate transformation failed.</div>';
      return;
    }

    // Calculate footprint dimensions & center
    const xs = localPts.map(p => p[0]);
    const zs = localPts.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const footprintWidth = maxX - minX;  // East-West span in meters
    const footprintDepth = maxZ - minZ;  // North-South span in meters
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    console.log(`[ThreeViewer] Footprint Width: ${footprintWidth.toFixed(2)}m, Depth: ${footprintDepth.toFixed(2)}m`);

    // Create main 2D building footprint shape (centered at local 0, 0)
    const shapePoints = localPts.map(([x, z]) => new THREE.Vector2(x - centerX, z - centerZ));
    const footprintShape = new THREE.Shape(shapePoints);

    // Create slightly larger shape for Roof overhang & Floor separation slabs (1.03x scaled)
    const overhangPoints = shapePoints.map(p => new THREE.Vector2(p.x * 1.03, p.y * 1.03));
    const overhangShape = new THREE.Shape(overhangPoints);

    // 4. Validate floors
    const validFloors = (Array.isArray(threeD.floors) ? threeD.floors : []).filter(f =>
      f != null && Number.isFinite(Number(f.bottomM)) && Number.isFinite(Number(f.topM)) && Number(f.topM) > Number(f.bottomM)
    );

    if (validFloors.length === 0) {
      wrap.innerHTML = '<div class="unavail-banner">⚠ No valid floor height data available for 3D model.</div>';
      return;
    }

    const groundElevM = Number.isFinite(Number(threeD.groundElevationM)) ? Number(threeD.groundElevationM) : 0;

    // Check if an explicit basement exists in dataset, or add default B1 basement if required
    let hasBasementInDataset = validFloors.some(f => Number(f.bottomM) < groundElevM || f.isUnderground || f.label?.startsWith('B'));

    const allFloorsToRender = [...validFloors];
    if (!hasBasementInDataset) {
      // Add a B1 Basement level below ground level (from -3.0m to 0.0m relative height)
      allFloorsToRender.unshift({
        index: -1,
        label: 'BASEMENT B1',
        bottomM: groundElevM - 3.0,
        topM: groundElevM,
        isUnderground: true,
        isSyntheticBasement: true,
      });
    }

    // 5. Setup Three.js Scene, Camera, Renderer
    const w = wrap.clientWidth || 600;
    const h = wrap.clientHeight || 440;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080C10);
    scene.fog = new THREE.FogExp2(0x080C10, 0.005);

    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 5000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    wrap.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xE2E8F0, 1.2));

    const sun = new THREE.DirectionalLight(0xFFF7ED, 1.8);
    sun.position.set(50, 90, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 500;
    scene.add(sun);

    const blueSublight = new THREE.PointLight(0x3B82F6, 2.0, 120);
    blueSublight.position.set(-30, -15, -30);
    scene.add(blueSublight);

    const warmAccent = new THREE.DirectionalLight(0xF59E0B, 0.6);
    warmAccent.position.set(-40, 30, -30);
    scene.add(warmAccent);

    // 6. Create Building Group
    const buildingGroup = new THREE.Group();
    scene.add(buildingGroup);

    const floorMeshes = [];
    let topMaxRelHeight = 0;

    // Render every floor volume
    allFloorsToRender.forEach((floor) => {
      const bottomM = Number(floor.bottomM);
      const topM = Number(floor.topM);
      const relBottom = bottomM - groundElevM;
      const floorHeight = Math.max(0.1, topM - bottomM);
      const isUnderground = Boolean(floor.isUnderground) || bottomM < groundElevM || floor.label?.startsWith('B');

      if (!isUnderground && relBottom + floorHeight > topMaxRelHeight) {
        topMaxRelHeight = relBottom + floorHeight;
      }

      // Extrude footprint shape
      const isRoofLabel = floor.label === 'ROOF';
      const shapeToUse = isRoofLabel ? overhangShape : footprintShape;

      const geo = new THREE.ExtrudeGeometry(shapeToUse, {
        depth: floorHeight,
        bevelEnabled: false,
        curveSegments: 1,
      });

      // Rotate shape XZ plane so extrusion depth goes vertically along +Y
      geo.rotateX(-Math.PI / 2);

      // Validate bounding box
      geo.computeBoundingBox();
      if (!geo.boundingBox) {
        geo.dispose();
        return;
      }
      const b = geo.boundingBox;
      if (![b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite)) {
        console.error("Non-finite geometry bounding box detected", b);
        geo.dispose();
        return;
      }

      const highlighted = highlightFloorLabels.includes(floor.label);
      const { fillHex, edgeHex, opacity } = getFloorStyle(floor.label, highlighted, isUnderground);

      const mat = new THREE.MeshStandardMaterial({
        color: fillHex,
        transparent: opacity < 1.0,
        opacity: opacity,
        metalness: isRoofLabel ? 0.4 : 0.15,
        roughness: isRoofLabel ? 0.4 : 0.6,
        flatShading: true,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, relBottom, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.visible = false; // Controlled by animation / filter

      // Edges around floor
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: edgeHex, linewidth: 1.5 })
      );
      edges.position.set(0, relBottom, 0);
      edges.visible = false;

      buildingGroup.add(mesh);
      buildingGroup.add(edges);

      // Add a horizontal floor separation slab plate between above-ground floors
      if (!isUnderground && !isRoofLabel && relBottom > 0) {
        const slabGeo = new THREE.ExtrudeGeometry(overhangShape, { depth: 0.12, bevelEnabled: false, curveSegments: 1 });
        slabGeo.rotateX(-Math.PI / 2);
        const slabMat = new THREE.MeshStandardMaterial({ color: 0x94A3B8, metalness: 0.3, roughness: 0.4 });
        const slabMesh = new THREE.Mesh(slabGeo, slabMat);
        slabMesh.position.set(0, relBottom, 0);
        slabMesh.visible = false;
        buildingGroup.add(slabMesh);
        floorMeshes.push({ mesh: slabMesh });
      }

      // Label sprite next to floor
      const labelSprite = makeFloorLabelSprite(floor.label || `F${floor.index}`, highlighted ? '#FCA5A5' : (isUnderground ? '#64748B' : '#94A3B8'));
      labelSprite.position.set(0, relBottom + floorHeight / 2, 0);
      labelSprite.scale.set(6.5, 2.4, 1);
      labelSprite.visible = false;
      buildingGroup.add(labelSprite);

      floorMeshes.push({ mesh, edges, labelSprite, floorIndex: floor.index });
    });

    // Add Roof Overhang Cap on top of top floor
    if (topMaxRelHeight > 0) {
      const roofCapGeo = new THREE.ExtrudeGeometry(overhangShape, { depth: 0.35, bevelEnabled: false, curveSegments: 1 });
      roofCapGeo.rotateX(-Math.PI / 2);
      const roofCapMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4, roughness: 0.3 });
      const roofCapMesh = new THREE.Mesh(roofCapGeo, roofCapMat);
      roofCapMesh.position.set(0, topMaxRelHeight, 0);
      roofCapMesh.castShadow = true;
      buildingGroup.add(roofCapMesh);

      const roofEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(roofCapGeo),
        new THREE.LineBasicMaterial({ color: 0x94A3B8, linewidth: 2 })
      );
      roofEdges.position.set(0, topMaxRelHeight, 0);
      buildingGroup.add(roofEdges);
    }

    // 7. Calculate complete Building Group Bounding Box
    const buildingBox = new THREE.Box3().setFromObject(buildingGroup);
    if (buildingBox.isEmpty()) {
      wrap.innerHTML = '<div class="unavail-banner">⚠ Failed to calculate 3D building bounds.</div>';
      return;
    }

    const center = buildingBox.getCenter(new THREE.Vector3());
    const size = buildingBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 8);

    // 8. Add Green Translucent Ground Plane at Y = 0
    const groundSize = Math.max(footprintWidth, footprintDepth, 20) * 2.8;
    const greenGround = createGreenGroundPlane(groundSize, 0);
    scene.add(greenGround);

    // 9. Automatic Three-Quarter Perspective Camera Framing
    const dist = maxDim * 2.1;
    camera.position.set(center.x + dist * 0.85, center.y + dist * 0.7, center.z + dist * 0.85);
    camera.lookAt(center);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = maxDim * 0.3;
    controls.maxDistance = maxDim * 8;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    controls.update();
    controlsRef.current = controls;

    renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });

    function resetView() {
      camera.position.set(center.x + dist * 0.85, center.y + dist * 0.7, center.z + dist * 0.85);
      if (controlsRef.current) {
        controlsRef.current.target.copy(center);
        controlsRef.current.update();
      }
    }
    resetRef.current = resetView;

    // 10. Floor Visibility Animation & Filter Sync
    function updateFloorVisibility(builtN) {
      floorMeshes.forEach(({ mesh, edges, labelSprite, floorIndex }, idx) => {
        const revealed = idx < builtN * 2; // Reveals floors & slabs in sequence
        const isVisible = visibleFloorIndex == null
          ? revealed
          : visibleFloorIndex === -1
            ? false
            : (floorIndex === visibleFloorIndex || floorIndex === undefined) && revealed;

        if (mesh) mesh.visible = isVisible;
        if (edges) edges.visible = isVisible;
        if (labelSprite) labelSprite.visible = isVisible;
      });
    }

    const builtRef = { current: 0 };
    const stateInterval = setInterval(() => {
      const v = parseInt(wrap.dataset.builtFloors || '0', 10);
      if (v !== builtRef.current) {
        builtRef.current = v;
        updateFloorVisibility(v);
      }
    }, 50);

    // Render loop
    let raf;
    function animate() {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    function onResize() {
      const nw = wrap.clientWidth || 600;
      const nh = wrap.clientHeight || 440;
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

  useEffect(() => {
    if (wrapRef.current) {
      wrapRef.current.dataset.builtFloors = builtFloors;
    }
  }, [builtFloors]);

  return (
    <div className="three-wrap-outer">
      {!animDone && threeD && Array.isArray(threeD.floors) && (
        <div className="build-progress">
          <div className="build-bar" style={{ width: `${(builtFloors / threeD.floors.length) * 100}%` }} />
          <span className="build-label">
            Building model… floor {builtFloors}/{threeD.floors.length}
          </span>
        </div>
      )}

      <div className="three-wrap" ref={wrapRef} />

      <button
        className="btn ghost small three-reset-btn"
        onClick={() => resetRef.current && resetRef.current()}
      >
        ⊙ Reset view
      </button>

      <div className="underground-badge">
        <span className="ug-dot" />
        Subsurface Volumetric Cadastre (Basement B1 + Multi-Storey Rights)
      </div>
    </div>
  );
}
