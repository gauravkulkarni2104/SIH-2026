import { useEffect, useRef } from 'react';
import L from 'leaflet';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

const COLOR_A = '#5C8A63';
const COLOR_B = '#8D939A';
const COLOR_OVERLAP = '#BD5B49';
const COLOR_CENTROID = '#C79A56';

/**
 * Stage 6: renders Parcel A's matched OSM footprint, Parcel B's matched OSM
 * footprint, their real Shapely intersection region (when one exists), both
 * footprint centroids, and each parcel's original reference point — as
 * clearly distinguishable layers on the same map, plus a small legend. This
 * is a separate, additive component — it does not replace or modify the
 * existing single-parcel MapView used elsewhere in the app.
 *
 * ringA / ringB: [[lon, lat], ...] — the matched OSM rings already held in
 * CompareOverlap's geoA/geoB state; no extra fetch needed here.
 * centroidA / centroidB: [lon, lat] — from the backend's overlap response
 * (computed from the same projected polygons used for the intersection).
 * refPointA / refPointB: [lat, lon] — the ULPIN's own registered point.
 * intersectionGeometry: GeoJSON-like { type, coordinates } as returned by
 * POST /api/overlap/2d, already unprojected back to lon/lat. May be a
 * Polygon/MultiPolygon (real area overlap) or a degenerate Point/LineString
 * (a boundary-touch case) — both are rendered, just differently.
 */
export default function OverlapMap({ ringA, ringB, intersectionGeometry, centroidA, centroidB, refPointA, refPointB }) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const layersRef = useRef({ group: null });

  useEffect(() => {
    if (!leafletRef.current && mapRef.current) {
      const map = L.map(mapRef.current);
      L.tileLayer(TILE_URL, {
        maxZoom: 20,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      leafletRef.current = map;
    }
  }, []);

  useEffect(() => {
    const map = leafletRef.current;
    if (!map || !ringA || !ringA.length || !ringB || !ringB.length) return;

    if (layersRef.current.group) map.removeLayer(layersRef.current.group);
    const group = L.layerGroup().addTo(map);
    layersRef.current.group = group;

    const toLatLng = (ring) => ring.map(([lon, lat]) => [lat, lon]);

    const a = L.polygon(toLatLng(ringA), { color: COLOR_A, weight: 2, fillOpacity: 0.15 })
      .bindPopup('Parcel A footprint (OpenStreetMap)');
    const b = L.polygon(toLatLng(ringB), { color: COLOR_B, weight: 2, fillOpacity: 0.15 })
      .bindPopup('Parcel B footprint (OpenStreetMap)');
    group.addLayer(a);
    group.addLayer(b);

    let bounds = a.getBounds().extend(b.getBounds());

    if (intersectionGeometry && intersectionGeometry.coordinates) {
      const ringToLatLng = (coords) => coords.map(([lon, lat]) => [lat, lon]);
      let interLayer = null;

      if (intersectionGeometry.type === 'Polygon') {
        interLayer = L.polygon(intersectionGeometry.coordinates.map(ringToLatLng), {
          color: COLOR_OVERLAP, weight: 2, fillOpacity: 0.5,
        }).bindPopup('Overlap area (real Shapely intersection)');
      } else if (intersectionGeometry.type === 'MultiPolygon') {
        interLayer = L.polygon(
          intersectionGeometry.coordinates.map((poly) => poly.map(ringToLatLng)),
          { color: COLOR_OVERLAP, weight: 2, fillOpacity: 0.5 }
        ).bindPopup('Overlap area (real Shapely intersection)');
      } else if (intersectionGeometry.type === 'Point') {
        const [lon, lat] = intersectionGeometry.coordinates;
        interLayer = L.circleMarker([lat, lon], {
          radius: 6, color: COLOR_OVERLAP, fillColor: COLOR_OVERLAP, fillOpacity: 1,
        }).bindPopup('Boundary touch point');
      } else if (intersectionGeometry.type === 'LineString') {
        interLayer = L.polyline(ringToLatLng(intersectionGeometry.coordinates), {
          color: COLOR_OVERLAP, weight: 3,
        }).bindPopup('Boundary touch line');
      }

      if (interLayer) {
        group.addLayer(interLayer);
        bounds = bounds.extend(interLayer.getBounds ? interLayer.getBounds() : L.latLngBounds([interLayer.getLatLng()]));
      }
    }

    if (centroidA) {
      const [lon, lat] = centroidA;
      const m = L.circleMarker([lat, lon], { radius: 5, color: COLOR_CENTROID, fillColor: COLOR_CENTROID, fillOpacity: 1 })
        .bindPopup('Parcel A centroid');
      group.addLayer(m);
      bounds = bounds.extend([lat, lon]);
    }
    if (centroidB) {
      const [lon, lat] = centroidB;
      const m = L.circleMarker([lat, lon], { radius: 5, color: COLOR_CENTROID, fillColor: COLOR_CENTROID, fillOpacity: 1 })
        .bindPopup('Parcel B centroid');
      group.addLayer(m);
      bounds = bounds.extend([lat, lon]);
    }

    if (refPointA) {
      const m = L.circleMarker(refPointA, { radius: 4, color: COLOR_A, fillColor: '#fff', fillOpacity: 1, weight: 2 })
        .bindPopup('Parcel A registered point');
      group.addLayer(m);
    }
    if (refPointB) {
      const m = L.circleMarker(refPointB, { radius: 4, color: COLOR_B, fillColor: '#fff', fillOpacity: 1, weight: 2 })
        .bindPopup('Parcel B registered point');
      group.addLayer(m);
    }

    map.fitBounds(bounds, { padding: [24, 24] });
  }, [ringA, ringB, intersectionGeometry, centroidA, centroidB, refPointA, refPointB]);

  return (
    <div style={{ position: 'relative', marginTop: 12 }}>
      <div
        id="overlap-map"
        ref={mapRef}
        style={{ height: 300, borderRadius: 3, overflow: 'hidden', border: '1px solid var(--line)' }}
      />
      <div
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 1000,
          background: 'rgba(20,22,24,0.85)', border: '1px solid var(--line)', borderRadius: 3,
          padding: '6px 10px', fontFamily: 'var(--font-mono)', fontSize: 10.5, color: '#EDEBE6',
          lineHeight: 1.7, letterSpacing: '.03em',
        }}
      >
        <div><span style={{ display: 'inline-block', width: 9, height: 9, background: COLOR_A, marginRight: 6 }} />A FOOTPRINT</div>
        <div><span style={{ display: 'inline-block', width: 9, height: 9, background: COLOR_B, marginRight: 6 }} />B FOOTPRINT</div>
        <div><span style={{ display: 'inline-block', width: 9, height: 9, background: COLOR_OVERLAP, marginRight: 6 }} />OVERLAP AREA</div>
        <div><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: COLOR_CENTROID, marginRight: 6 }} />CENTROID</div>
      </div>
    </div>
  );
}
