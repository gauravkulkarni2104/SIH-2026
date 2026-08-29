import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * ringLocalXY: intersection polygon vertices in local meters (already computed
 * by the backend via Shapely — this component does no geometry math of its own,
 * it only renders what was calculated).
 * verticalRangeM: [bottom, top] absolute elevation of the overlap band.
 */
export default function IntersectionViewer({ ringLocalXY, verticalRangeM }) {
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!ringLocalXY || ringLocalXY.length < 3 || !wrapRef.current) return;
    const wrap = wrapRef.current;
    wrap.innerHTML = '';
    const w = wrap.clientWidth, h = wrap.clientHeight || 220;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(w, h);
    wrap.appendChild(renderer.domElement);

    scene.add(new THREE.GridHelper(40, 20, 0x2C343C, 0x1F262D));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xBD5B49, 1.2);
    dir.position.set(10, 15, 8);
    scene.add(dir);

    const pts = ringLocalXY.map(([x, y]) => new THREE.Vector2(x, y));
    const shape = new THREE.Shape(pts);
    const depth = Math.max(0.2, verticalRangeM[1] - verticalRangeM[0]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.computeBoundingBox();

    const mat = new THREE.MeshStandardMaterial({ color: 0xBD5B49, transparent: true, opacity: 0.75, flatShading: true });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
    scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xE38A78 })));

    const size = new THREE.Vector3();
    geo.boundingBox.getSize(size);
    const center = new THREE.Vector3();
    geo.boundingBox.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 2);
    const dist = maxDim * 2.2;
    camera.position.set(center.x + dist * 0.7, center.y + dist * 0.6, center.z + dist * 0.7);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    controls.update();

    let raf;
    function animate() {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    }
    animate();

    return () => { cancelAnimationFrame(raf); controls.dispose(); renderer.dispose(); };
  }, [ringLocalXY, verticalRangeM]);

  if (!ringLocalXY || ringLocalXY.length < 3) return null;
  return <div className="three-wrap" style={{ height: 220 }} ref={wrapRef} />;
}
