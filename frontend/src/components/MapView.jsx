import { useEffect, useRef } from 'react';
import L from 'leaflet';

const TILE_URL = import.meta.env.VITE_MAP_TILE_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const SEARCH_RADIUS_M = 60;

export default function MapView({ record, nearby, candidates, onSelectNearby }) {
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const layersRef = useRef({ marker: null, radius: null, nearby: L.layerGroup(), candidates: L.layerGroup() });

  useEffect(() => {
    if (!leafletRef.current) {
      const map = L.map(mapRef.current).setView([record.latitude, record.longitude], 19);
      L.tileLayer(TILE_URL, {
        maxZoom: 20,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      layersRef.current.nearby.addTo(map);
      layersRef.current.candidates.addTo(map);
      leafletRef.current = map;
    }
    return () => {
      // keep map instance alive across re-renders; only torn down on unmount
    };
  }, []);

  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    map.setView([record.latitude, record.longitude], 19);

    if (layersRef.current.marker) layersRef.current.marker.remove();
    if (layersRef.current.radius) layersRef.current.radius.remove();

    layersRef.current.marker = L.circleMarker([record.latitude, record.longitude], {
      radius: 7, color: '#C79A56', fillColor: '#C79A56', fillOpacity: 1,
    }).addTo(map).bindPopup(`<b>${record.ulpin}</b><br>${record.type}`);

    layersRef.current.radius = L.circle([record.latitude, record.longitude], {
      radius: SEARCH_RADIUS_M, color: '#5C8A63', weight: 1, fill: false, dashArray: '4 4',
    }).addTo(map);

    layersRef.current.nearby.clearLayers();
    (nearby || []).forEach((n) => {
      if (!n.latitude || !n.longitude) return;
      const m = L.circleMarker([n.latitude, n.longitude], {
        radius: 5, color: '#8D939A', fillColor: '#8D939A', fillOpacity: .8,
      }).bindPopup(`<b>${n.ulpin}</b><br>${n.type}<br>${n.distanceM} m away`);
      m.on('click', () => onSelectNearby && onSelectNearby(n.ulpin));
      layersRef.current.nearby.addLayer(m);
    });
  }, [record, nearby]);

  useEffect(() => {
    const map = leafletRef.current;
    if (!map) return;
    layersRef.current.candidates.clearLayers();
    (candidates || []).forEach((c) => {
      const matched = c.confidence >= 0.8;
      L.polygon(c.ring.map(([lon, lat]) => [lat, lon]), {
        color: matched ? '#5C8A63' : '#8D939A', weight: 1.5, fillOpacity: .12,
      }).bindPopup(`Way #${c.wayId}<br>Confidence: ${(c.confidence * 100).toFixed(1)}%`).addTo(layersRef.current.candidates);
    });
  }, [candidates]);

  return (
    <div id="map" ref={mapRef}>
      <div className="corner tl" /><div className="corner tr" /><div className="corner bl" /><div className="corner br" />
    </div>
  );
}
