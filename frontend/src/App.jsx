import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { api, getSatelliteImageUrl } from './api';
import MapView from './components/MapView';
import FloorControls from './components/FloorControls';
import PropertyPanel from './components/PropertyPanel';
import NearbyList from './components/NearbyList';
import DataSourcePanel from './components/DataSourcePanel';
import CompareOverlap from './components/CompareOverlap';
import ProviderStatusPanel from './components/ProviderStatusPanel';
import ProvenanceBadge from './components/ProvenanceBadge';
import SatelliteMap from "./components/SatelliteMap";

// Three.js is pulled into its own chunk and only fetched when the 3D viewer is actually opened.
const ThreeViewer = lazy(() => import('./components/ThreeViewer'));

const DEMO_STEPS = ['CSV', 'Map', 'Property', 'Geometry', '3D', 'Floors', 'Nearby', 'Overlap'];

export default function App() {
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [providerNames, setProviderNames] = useState([]);
  const [ulpinList, setUlpinList] = useState([]);
  const [query, setQuery] = useState('');

  const [selected, setSelected] = useState(null);
  const [record, setRecord] = useState(null);
  const [nearby, setNearby] = useState(null);
  const [geometry, setGeometry] = useState(null);
  const [geometryLoading, setGeometryLoading] = useState(false);
  const [threeD, setThreeD] = useState(null);
  const [showSatellite, setShowSatellite] = useState(false);
  const [visibleFloorIndex, setVisibleFloorIndex] = useState(null);
  const [tab, setTab] = useState('detail');

  const [demoRunning, setDemoRunning] = useState(false);
  const [demoStep, setDemoStep] = useState(-1);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api.health().then(setHealth).catch(e => setLoadError(e.message));
    api.stats().then(setStats).catch(() => {});
    api.providersStatus().then(res => setProviderNames(res.providers.map(p => p.name))).catch(() => {});
    api.ulpins().then(res => {
      setUlpinList(res.results);
      if (res.results.length) selectUlpin(res.results[0].ulpin);
    }).catch(e => setLoadError(e.message));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.ulpins(query).then(res => setUlpinList(res.results)).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const selectUlpin = useCallback(async (ulpin) => {
    setSelected(ulpin);
    setGeometry(null);
    setThreeD(null);
    setVisibleFloorIndex(null);
    try {
      const [rec, nb] = await Promise.all([api.ulpin(ulpin), api.nearby(ulpin)]);
      setRecord(rec);
      setNearby(nb);
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  async function lookupGeometry(refresh = false) {
    setGeometryLoading(true);
    try {
      const geo = await api.geometry(selected, refresh);
      setGeometry(geo);
      api.providersStatus().then(res => setProviderNames(res.providers.map(p => p.name))).catch(() => {});
      return geo;
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setGeometryLoading(false);
    }
  }

  async function load3D() {
    try {
      const t = await api.threeD(selected);
      setThreeD(t);
      return t;
    } catch (e) {
      setLoadError(e.message);
    }
  }

  async function runDemo() {
    if (!ulpinList.length) return;
    setDemoRunning(true);
    const step = (i) => new Promise(r => { setDemoStep(i); setTimeout(r, 700); });

    await step(0); // CSV
    const first = ulpinList[0].ulpin;
    await selectUlpin(first);

    await step(1); // Map (map re-renders on selection)
    await step(2); // Property
    await step(3); // Geometry
    await lookupGeometry();
    await step(4); // 3D
    await load3D();
    await step(5); // Floors
    setVisibleFloorIndex(null);
    await step(6); // Nearby
    setTab('nearby');
    await step(7); // Overlap
    setTab('compare');

    setDemoStep(-1);
    setDemoRunning(false);
  }

  if (loadError && !health) {
    return (
      <div className="app-shell">
        <div className="grid-bg" />
        <header className="top"><h1>ULPIN Digital Twin</h1></header>
        <div className="section">
          <div className="error-box">
            Could not reach the API at the configured VITE_API_BASE. Make sure the FastAPI backend is running
            (see README) — error: {loadError}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="grid-bg" />

      <header className="top">
        <div>
          <div className="stamp">ULPIN · Digital Twin · GIS Command Center</div>
          <h1>Parcel Register &amp; 3D Overlap Engine</h1>
          <div className="sub">FastAPI + Shapely backend · Leaflet + Three.js frontend</div>
        </div>
        <button className="btn" onClick={runDemo} disabled={demoRunning}>
          {demoRunning ? <span className="spinner" /> : 'Try demo'}
        </button>
      </header>

      {demoRunning && (
        <div className="demo-banner">
          <span>Running guided walkthrough…</span>
          <div className="demo-steps">
            {DEMO_STEPS.map((s, i) => <span key={s} className={i === demoStep ? 'active' : ''}>{s}</span>)}
          </div>
        </div>
      )}

      {stats && (
        <div className="metrics-bar">
          <div className="metric"><div className="k">Parcels</div><div className="v">{stats.totalParcels}</div></div>
          <div className="metric"><div className="k">Total area</div><div className="v">{stats.totalArea_m2.toFixed(0)} m²</div></div>
          <div className="metric"><div className="k">Avg floors</div><div className="v">{stats.avgFloors}</div></div>
          <div className="metric"><div className="k">Height mismatches</div><div className="v">{stats.heightMismatches}</div></div>
          <div className="metric"><div className="k">Property types</div><div className="v">{stats.propertyTypes.length}</div></div>
        </div>
      )}

      <div className="layout">
        <div className="panel">
          <div className="label">Parcels</div>
          <input className="search-input" placeholder="Search ULPIN or type…" value={query} onChange={e => setQuery(e.target.value)} />
          {ulpinList.map(p => (
            <div key={p.ulpin} className={`parcel-item ${selected === p.ulpin ? 'active' : ''}`} onClick={() => selectUlpin(p.ulpin)}>
              <div className="parcel-id">{p.ulpin}</div>
              <div className="parcel-type">{p.type}</div>
              <div className="parcel-mini">{p.floors} fl · {p.area_m2.toFixed(0)} m²</div>
            </div>
          ))}
        </div>

        <div className="content">
          {!record ? (
            <div className="section">Loading…</div>
          ) : (
            <>
              <div className="section">
                <PropertyPanel record={record} geometry={geometry} />
              </div>

              <div className="section">
                <div className="section-title-row">
                  <div className="label" style={{ marginBottom: 0 }}>Geometry Match — OpenStreetMap / Overpass</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button className="btn" onClick={() => lookupGeometry(false)} disabled={geometryLoading}>
                      {geometryLoading ? <span className="spinner" /> : 'Search nearby footprints'}
                    </button>
                    {geometry && (
                      <button className="btn ghost" onClick={() => lookupGeometry(true)} disabled={geometryLoading} title="Retries the full provider chain — never repeats a failed endpoint blindly">
                        Retry
                      </button>
                    )}
                    {geometry && (
                      <span className={`status-badge ${geometry.status.toLowerCase()}`}>
                        {geometry.status === 'MATCHED' && `✓ MATCHED · ${(geometry.confidence * 100).toFixed(0)}%`}
                        {geometry.status === 'UNVERIFIED' && `○ UNVERIFIED · ${(geometry.confidence * 100).toFixed(0)}%`}
                        {geometry.status === 'NO_CANDIDATES' && '○ NO CANDIDATES FOUND'}
                        {geometry.status === 'UNAVAILABLE' && '✕ PROVIDERS UNAVAILABLE'}
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ margin: '10px 0' }}>
                  <ProviderStatusPanel attempts={geometry?.attempts} searching={geometryLoading} providerNames={providerNames} />
                </div>

                <MapView
                  record={record}
                  nearby={nearby?.results}
                  candidates={geometry?.allCandidates}
                  onSelectNearby={selectUlpin}
                />

                {geometry?.status === 'UNAVAILABLE' && (
                  <div className="geo-msg">
                    <strong>GEOMETRY PROVIDERS UNAVAILABLE</strong><br />
                    Every configured provider failed at the network/server/timeout level (see the attempt log above) —
                    this does <em>not</em> mean no building exists here, only that we couldn't reach a source to check.
                    Use Retry once connectivity is restored. The 3D view below still works from local area/height/floor data.
                  </div>
                )}
                {geometry?.status === 'NO_CANDIDATES' && (
                  <div className="geo-msg">
                    <strong>EXACT GEOMETRY UNAVAILABLE</strong><br />
                    Providers were reachable and answered successfully at every search radius, but found no building
                    polygon near this ULPIN. The 3D view below is a volumetric visualization based on the available
                    location, area, height and floor data.
                  </div>
                )}
                {geometry?.status === 'UNVERIFIED' && (
                  <div className="geo-msg">
                    <strong>EXACT GEOMETRY UNAVAILABLE</strong><br />
                    {geometry.message} The best candidate is shown as unverified context only, not this parcel's boundary.
                  </div>
                )}
                {geometry?.status === 'MATCHED' && (
                  <div className="geo-msg">
                    Matched OSM way #{geometry.candidate.wayId} at a {geometry.radiusUsedM} m search radius ·
                    {' '}{geometry.candidate.distanceM} m from the ULPIN point · area similarity{' '}
                    {(geometry.candidate.areaSimilarity * 100).toFixed(0)}%. Shown as a supplementary open-data
                    footprint, not an official cadastral boundary.
                  </div>
                )}
              </div>

              <div className="section">
                <div className="section-title-row">
                  <div className="label" style={{ marginBottom: 0 }}>3D Digital Twin</div>
                  <button className="btn ghost" onClick={load3D}>{threeD ? 'Refresh' : 'Build 3D view'}</button>
                  <button
                         className="btn ghost"
                         onClick={() => setShowSatellite(!showSatellite)}
                         disabled={!selected}
                      >
                       {showSatellite ? 'Hide Satellite' : 'Satellite View'}
                    </button>
                    {showSatellite && selected && (
                        <div className="satellite-panel">
                        <div className="section-title">
                          Sentinel-2 Satellite Imagery
                          </div>

                           <div className="satellite-meta">
                             <span>ULPIN: {selected}</span>
                             <span>Source: ArcGIS World Imagery</span>
                          </div>

                          <SatelliteMap
    latitude={record?.latitude}
    longitude={record?.longitude}
/>
                       <div className="geo-msg">
                           Satellite imagery is supplementary visual context and
                           does not represent an official cadastral boundary.
                         </div>
                       </div>
                   )}
                </div>
                {threeD ? (
                  <>
                    <Suspense fallback={<div className="geo-msg">Loading 3D engine…</div>}>
                      <ThreeViewer threeD={threeD} visibleFloorIndex={visibleFloorIndex} />
                    </Suspense>
                    <ProvenanceBadge threeD={threeD} />
                    <div className="detail-grid" style={{ marginTop: 12 }}>
                      <div className="stat"><div className="k">Ground elevation</div><div className="v">{threeD.groundElevationM.toFixed(2)} m</div></div>
                      <div className="stat"><div className="k">Top elevation</div><div className="v">{threeD.topElevationM.toFixed(2)} m</div></div>
                      <div className="stat"><div className="k">Building height</div><div className="v">{threeD.buildingHeightM.toFixed(2)} m</div></div>
                      <div className="stat"><div className="k">Height source</div><div className="v" style={{ fontSize: 12 }}>{threeD.heightSource}</div></div>
                    </div>
                    <FloorControls floors={threeD.floors} visibleFloorIndex={visibleFloorIndex} onChange={setVisibleFloorIndex} />
                  </>
                ) : (
                  <div className="geo-msg">Click "Build 3D view" to extrude this parcel from its DEM/DSM/floor data{geometry?.status === 'MATCHED' ? ' and matched OSM footprint.' : '.'}</div>
                )}
              </div>

              <div className="section">
                <div className="section-title-row" style={{ marginBottom: 10 }}>
                  <button className={`btn small ${tab === 'nearby' ? 'active' : 'ghost'}`} onClick={() => setTab('nearby')}>Nearby ULPINs</button>
                  <button className={`btn small ${tab === 'compare' ? 'active' : 'ghost'}`} onClick={() => setTab('compare')}>Compare with neighbour</button>
                </div>
                {tab === 'nearby'
                  ? <NearbyList nearby={nearby} onSelect={selectUlpin} />
                  : <CompareOverlap ulpin={selected} allUlpins={ulpinList.map(p => p.ulpin)} recordA={record} />}
              </div>

              <div className="section">
                <div className="label">Data Sources</div>
                <DataSourcePanel health={health} geometryStatus={geometry?.status} />
              </div>
            </>
          )}
        </div>
      </div>

      <footer className="foot">
        Geometry provenance: official dataset → ULPIN-linked geometry → OSM building polygon → Open Buildings footprint →
        other open geospatial source → estimated visualization → unavailable. No polygon is presented as an exact cadastral
        boundary unless matched against a real open-data source above the configured confidence threshold.
      </footer>
    </div>
  );
}
