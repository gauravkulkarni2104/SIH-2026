import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { api, getSatelliteImageUrl } from './api';
import PropertyPanel from './components/PropertyPanel';
import MapView from './components/MapView';
import SatelliteMap from './components/SatelliteMap';
import NearbyList from './components/NearbyList';
import DataSourcePanel from './components/DataSourcePanel';
import ProviderStatusPanel from './components/ProviderStatusPanel';
import ProvenanceBadge from './components/ProvenanceBadge';
import FloorControls from './components/FloorControls';

const ThreeViewer = lazy(() => import('./components/ThreeViewer'));
const CompareOverlap = lazy(() => import('./components/CompareOverlap'));

// ─── Tab enum ────────────────────────────────────────────────────────────────
const TABS = ['property', 'satellite', '3d', 'nearby', 'compare', 'sources'];
const TAB_LABELS = {
  property: '📋 Property',
  satellite: '🛰 Satellite Image',
  '3d': '⬡ 3D Model',
  nearby: '📍 Nearby',
  compare: '⟂ Compare',
  sources: '⚙ Sources',
};

// ─── Small helpers ────────────────────────────────────────────────────────────
function Spinner({ size = 20 }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size, display: 'inline-block',
        borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--border)',
        borderTopColor: 'var(--primary)', borderRadius: '50%',
        animation: 'spin 0.8s linear infinite', verticalAlign: 'middle' }}
    />
  );
}

function ErrorBox({ msg }) {
  if (!msg) return null;
  return (
    <div className="error-box" style={{ marginTop: 12, padding: '12px 16px',
      background: 'rgba(189,91,73,0.12)', border: '1px solid rgba(189,91,73,0.3)',
      borderRadius: 6, color: '#E38A78', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
      ⚠ {msg}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  // ── search state ──────────────────────────────────────────────────────────
  const [query, setQuery]           = useState('');
  const [ulpinList, setUlpinList]   = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError]   = useState(null);

  // ── selected ULPIN state ──────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState('');
  const [record, setRecord]         = useState(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError]     = useState(null);

  // ── geometry state ────────────────────────────────────────────────────────
  const [geometry, setGeometry]         = useState(null);
  const [geoLoading, setGeoLoading]     = useState(false);
  const [geoError, setGeoError]         = useState(null);

  // ── 3D state ──────────────────────────────────────────────────────────────
  const [threeD, setThreeD]             = useState(null);
  const [threeDLoading, setThreeDLoading] = useState(false);
  const [threeDError, setThreeDError]   = useState(null);
  const [visibleFloorIndex, setVisibleFloorIndex] = useState(null);

  // ── nearby state ──────────────────────────────────────────────────────────
  const [nearby, setNearby]             = useState(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError]   = useState(null);

  // ── health / providers ────────────────────────────────────────────────────
  const [health, setHealth]             = useState(null);
  const [providers, setProviders]       = useState(null);

  // ── tab ───────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]       = useState('property');

  // ── satellite image url ───────────────────────────────────────────────────
  const [satelliteImgUrl, setSatelliteImgUrl] = useState(null);

  // ─────────────────────────────────────────────────────────────────────────
  // Load ULPIN list + health on mount
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setListLoading(true);
    Promise.all([
      api.ulpins().catch(e => { setListError(e.message); return { results: [] }; }),
      api.health().catch(() => null),
      api.providersStatus().catch(() => null),
    ]).then(([ulpins, h, prov]) => {
      setUlpinList(ulpins.results || []);
      setHealth(h);
      setProviders(prov);
      setListLoading(false);
      // auto-select first ULPIN if list is small
      if (ulpins.results?.length > 0 && !selectedId) {
        handleSelectUlpin(ulpins.results[0].ulpin);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Select a ULPIN: fetch record → geometry → 3D → nearby in sequence
  // ─────────────────────────────────────────────────────────────────────────
  const handleSelectUlpin = useCallback(async (id) => {
    if (!id) return;
    setSelectedId(id);
    setRecord(null); setRecordError(null); setRecordLoading(true);
    setGeometry(null); setGeoError(null);
    setThreeD(null); setThreeDError(null);
    setNearby(null); setNearbyError(null);
    setVisibleFloorIndex(null);
    setSatelliteImgUrl(null);

    // 1. Fetch property record
    let rec;
    try {
      rec = await api.ulpin(id);
      setRecord(rec);
      setRecordLoading(false);
    } catch (e) {
      setRecordError(e.message || 'Failed to load property record');
      setRecordLoading(false);
      return;
    }

    // 2. Satellite image URL (backend streams the image — just set URL)
    getSatelliteImageUrl(id).then(url => setSatelliteImgUrl(url));

    // 3. Fetch geometry (can be slow — runs in parallel with nearby)
    setGeoLoading(true);
    api.geometry(id).then(geo => {
      setGeometry(geo);
      setGeoLoading(false);
    }).catch(e => {
      setGeoError(e.message || 'Geometry search failed');
      setGeoLoading(false);
    });

    // 4. Fetch 3D model
    setThreeDLoading(true);
    api.threeD(id).then(td => {
      setThreeD(td);
      setThreeDLoading(false);
    }).catch(e => {
      setThreeDError(e.message || '3D model unavailable');
      setThreeDLoading(false);
    });

    // 5. Fetch nearby
    setNearbyLoading(true);
    api.nearby(id).then(nb => {
      setNearby(nb);
      setNearbyLoading(false);
    }).catch(e => {
      setNearbyError(e.message || 'Nearby search failed');
      setNearbyLoading(false);
    });
  }, []);

  // Retry geometry with refresh=true
  const retryGeometry = useCallback(() => {
    if (!selectedId) return;
    setGeoLoading(true);
    setGeoError(null);
    api.geometry(selectedId, true).then(geo => {
      setGeometry(geo);
      setGeoLoading(false);
    }).catch(e => {
      setGeoError(e.message);
      setGeoLoading(false);
    });
  }, [selectedId]);

  // Filter list by search query
  const filteredList = ulpinList.filter(u =>
    !query || u.ulpin.toLowerCase().includes(query.toLowerCase()) || (u.type || '').toLowerCase().includes(query.toLowerCase())
  );

  const allUlpinIds = ulpinList.map(u => u.ulpin);

  // Geometry candidates for MapView
  const geoCandidates = geometry?.allCandidates || (geometry?.candidate ? [geometry.candidate] : []);

  // Whether coordinates are valid
  const hasValidCoords = record &&
    typeof record.latitude === 'number' && isFinite(record.latitude) &&
    typeof record.longitude === 'number' && isFinite(record.longitude) &&
    !(record.latitude === 0 && record.longitude === 0);

  return (
    <div className="app-container">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="logo-group">
          <div className="logo-icon">💠</div>
          <div className="logo-text">
            <h2>ULPIN Digital Twin</h2>
            <span>Property Mapping System — Real Pipeline</span>
          </div>
        </div>
        {health && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11,
              padding: '3px 8px', borderRadius: 4,
              background: health.csvLoaded ? 'rgba(16,185,129,0.12)' : 'rgba(189,91,73,0.12)',
              color: health.csvLoaded ? '#10b981' : '#E38A78',
              border: `1px solid ${health.csvLoaded ? 'rgba(16,185,129,0.3)' : 'rgba(189,91,73,0.3)'}`,
            }}>
              {health.csvLoaded ? `✓ ${health.rowCounts?.['ulpin_parcel_register.csv'] ?? ''} ULPINs loaded` : '✕ CSV error'}
            </span>
          </div>
        )}
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="app-body">
        {/* ── Left sidebar: ULPIN list ───────────────────────────────────── */}
        <aside className="ulpin-sidebar">
          <div className="sidebar-search">
            <input
              id="ulpin-search"
              type="text"
              placeholder="Search ULPIN or type…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ width: '100%', fontSize: 13, padding: '8px 12px' }}
            />
          </div>
          {listLoading && <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}><Spinner /> Loading…</div>}
          {listError && <ErrorBox msg={listError} />}
          <div className="ulpin-list">
            {filteredList.map(u => (
              <button
                key={u.ulpin}
                id={`ulpin-item-${u.ulpin}`}
                className={`ulpin-list-item ${selectedId === u.ulpin ? 'active' : ''}`}
                onClick={() => handleSelectUlpin(u.ulpin)}
              >
                <div className="uli-id">{u.ulpin}</div>
                <div className="uli-type">{u.type || '—'}</div>
                <div className="uli-meta">{u.area_m2?.toFixed(1)} m² · {u.floors} fl</div>
              </button>
            ))}
          </div>
        </aside>

        {/* ── Right panel ─────────────────────────────────────────────────── */}
        <main className="main-panel">
          {!selectedId && !recordLoading && (
            <div className="empty-state">
              <div style={{ fontSize: 48, marginBottom: 16 }}>💠</div>
              <h2 style={{ fontFamily: 'var(--font-display)', marginBottom: 8 }}>Select a ULPIN</h2>
              <p style={{ color: 'var(--text-muted)' }}>Choose a property from the list to begin the digital twin pipeline.</p>
            </div>
          )}

          {(recordLoading) && (
            <div className="empty-state">
              <Spinner size={32} />
              <p style={{ color: 'var(--text-muted)', marginTop: 16 }}>Loading property record…</p>
            </div>
          )}

          {recordError && !recordLoading && (
            <div className="empty-state"><ErrorBox msg={recordError} /></div>
          )}

          {record && !recordLoading && (
            <>
              {/* ULPIN header strip */}
              <div className="ulpin-header-strip">
                <div>
                  <span className="strip-label">ULPIN</span>
                  <span className="strip-id">{record.ulpin}</span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {hasValidCoords ? (
                    <span className="coord-badge">
                      📍 {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}
                    </span>
                  ) : (
                    <span className="coord-badge unavail">⚠ LOCATION UNAVAILABLE</span>
                  )}
                  <span className="type-tag">{record.type || '—'}</span>
                  <button className={`btn small ${activeTab === 'satellite' ? 'active' : ''}`} onClick={() => setActiveTab('satellite')}>
                    🛰 Satellite Image
                  </button>
                  <button className={`btn small ${activeTab === '3d' ? 'active' : ''}`} style={{ background: 'var(--primary)', color: '#fff', border: 'none' }} onClick={() => setActiveTab('3d')}>
                    ⬡ Generate 3D
                  </button>
                </div>
              </div>

              {/* Tab bar */}
              <div className="tab-bar">
                {TABS.map(t => (
                  <button
                    key={t}
                    id={`tab-${t}`}
                    className={`tab-btn ${activeTab === t ? 'active' : ''}`}
                    onClick={() => setActiveTab(t)}
                  >
                    {TAB_LABELS[t]}
                    {t === 'property' && <span className="tab-dot ok" />}
                    {t === 'satellite' && !hasValidCoords && <span className="tab-dot warn" />}
                    {t === '3d' && geoLoading && <Spinner size={10} />}
                    {t === '3d' && !geoLoading && geometry?.status === 'MATCHED' && <span className="tab-dot ok" />}
                    {t === '3d' && !geoLoading && geometry && geometry.status !== 'MATCHED' && <span className="tab-dot warn" />}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="tab-content">

                {/* ── PROPERTY TAB ──────────────────────────────────────────────── */}
                {activeTab === 'property' && (
                  <PropertyPanel record={record} geometry={geometry} onEnter3D={() => setActiveTab('3d')} />
                )}

                {/* ── SATELLITE TAB ─────────────────────────────────────────────── */}
                {activeTab === 'satellite' && (
                  <div>
                    {!hasValidCoords ? (
                      <div className="unavail-banner">
                        ⚠ LOCATION UNAVAILABLE — No valid coordinates found for this ULPIN in the dataset.
                      </div>
                    ) : (
                      <>
                        <div className="source-disclaimer">
                          🛰 High-Resolution Satellite Imagery — Supplementary visual context only. Not an official cadastral boundary.
                          Coordinates: {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)} (from ULPIN register CSV)
                        </div>

                        {/* High-Res ArcGIS Satellite View with Pin & Footprint Overlay */}
                        <div style={{ height: 420, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 16 }}>
                          <SatelliteMap
                            latitude={record.latitude}
                            longitude={record.longitude}
                            footprint={geometry?.candidate?.ring || threeD?.footprint}
                          />
                        </div>

                        <div className="label" style={{ marginBottom: 8 }}>Interactive Cadastral Context & Nearby Candidates</div>
                        <div style={{ height: 380, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                          <MapView
                            record={record}
                            nearby={nearby?.results}
                            candidates={geoCandidates}
                            onSelectNearby={handleSelectUlpin}
                          />
                        </div>

                        {/* Sentinel-2 imagery section */}
                        <div style={{ marginTop: 16 }}>
                          <div className="label" style={{ marginBottom: 8 }}>Copernicus Sentinel-2 Imagery Feed</div>
                          {satelliteImgUrl ? (
                            <div style={{ position: 'relative' }}>
                              <img
                                src={satelliteImgUrl}
                                alt="Sentinel-2 satellite imagery"
                                style={{ width: '100%', maxWidth: 480, borderRadius: 8, border: '1px solid var(--border)', display: 'block' }}
                                onError={(e) => { e.target.style.display='none'; e.target.nextSibling.style.display='block'; }}
                              />
                              <div className="geo-msg" style={{ display: 'none', marginTop: 4 }}>
                                Sentinel-2 image unavailable — Copernicus credentials not configured or no recent imagery for this location.
                              </div>
                            </div>
                          ) : (
                            <div className="geo-msg">
                              Sentinel-2 imagery feed requires Copernicus credentials in backend .env. Satellite map above renders high-res ArcGIS satellite view.
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── 3D TAB ────────────────────────────────────────────────────── */}
                {activeTab === '3d' && (
                  <div>
                    {/* Geometry search status */}
                    <div style={{ marginBottom: 12 }}>
                      <div className="label" style={{ marginBottom: 6 }}>Building Footprint Search</div>
                      {geoLoading && (
                        <div className="geo-msg"><Spinner /> Searching OpenStreetMap/Overpass for building footprints…</div>
                      )}
                      {geoError && (
                        <div>
                          <ErrorBox msg={geoError} />
                          <button className="btn ghost small" style={{ marginTop: 8 }} onClick={retryGeometry}>Retry</button>
                        </div>
                      )}
                      {geometry && !geoLoading && (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span className={`status-badge ${geometry.status === 'MATCHED' ? 'matched' : geometry.status === 'UNAVAILABLE' ? 'unavailable' : 'unverified'}`}>
                            {geometry.status === 'MATCHED' && `✓ OPEN-DATA MATCHED · ${(geometry.confidence * 100).toFixed(1)}%`}
                            {geometry.status === 'UNVERIFIED' && `⚠ UNVERIFIED · ${(geometry.confidence * 100).toFixed(1)}%`}
                            {geometry.status === 'NO_CANDIDATES' && '○ NO CANDIDATES'}
                            {geometry.status === 'UNAVAILABLE' && '⚠ PROVIDER UNAVAILABLE'}
                          </span>
                          {geometry.status === 'MATCHED' && (
                            <span className="geo-msg" style={{ margin: 0, fontSize: 11 }}>
                              OSM way/{geometry.candidate?.wayId} · {geometry.candidate?.distanceM} m from ULPIN point · area sim {(geometry.candidate?.areaSimilarity * 100).toFixed(0)}%
                            </span>
                          )}
                          {geometry.cached && <span className="geo-msg" style={{ margin: 0, fontSize: 11 }}>CACHE HIT</span>}
                          {(geometry.status === 'UNAVAILABLE' || geometry.status === 'NO_CANDIDATES') && (
                            <button className="btn ghost small" onClick={retryGeometry}>Retry search</button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Provenance */}
                    {threeD && <ProvenanceBadge threeD={threeD} />}

                    {/* Provider attempts debug */}
                    {geometry?.attempts && geometry.attempts.length > 0 && (
                      <details style={{ marginBottom: 12 }}>
                        <summary className="label" style={{ cursor: 'pointer' }}>Provider Search Log ({geometry.attempts.length} attempts)</summary>
                        <ProviderStatusPanel
                          attempts={geometry.attempts}
                          searching={geoLoading}
                          providerNames={providers?.providers?.map(p => p.name)}
                        />
                      </details>
                    )}

                    {/* 3D Viewer */}
                    {threeDLoading && (
                      <div className="geo-msg"><Spinner /> Building 3D model…</div>
                    )}
                    {threeDError && <ErrorBox msg={threeDError} />}

                    {threeD && !threeDLoading && (
                      <>
                        <FloorControls
                          floors={threeD.floors}
                          visibleFloorIndex={visibleFloorIndex}
                          onChange={setVisibleFloorIndex}
                        />
                        <div style={{ marginTop: 12, height: 440, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: '#080C10' }}>
                          <Suspense fallback={<div className="loading-3d">Loading 3D engine…</div>}>
                            <ThreeViewer threeD={threeD} visibleFloorIndex={visibleFloorIndex} />
                          </Suspense>
                          {/* Telemetry overlay */}
                          <div className="telemetry-overlay">
                            <div className="telemetry-item">LAT: {record.latitude.toFixed(6)}</div>
                            <div className="telemetry-item">LON: {record.longitude.toFixed(6)}</div>
                            <div className="telemetry-item">DEM: {record.dem_m_asl.toFixed(1)} m asl</div>
                            <div className="telemetry-item">H: {record.building_height_m.toFixed(1)} m</div>
                          </div>
                        </div>
                        <div className="source-disclaimer" style={{ marginTop: 8 }}>
                          {threeD.isEstimated
                            ? '⚠ ESTIMATED GEOMETRY — No matched OSM footprint. Building footprint is area-matched square at ULPIN point. Not a verified boundary.'
                            : `✓ OPEN-DATA MATCHED FOOTPRINT — Source: ${threeD.footprintSource}. Confidence: ${(threeD.geometryConfidence * 100).toFixed(1)}%. Not an official cadastral boundary.`}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── NEARBY TAB ────────────────────────────────────────────────── */}
                {activeTab === 'nearby' && (
                  <div>
                    <div className="label" style={{ marginBottom: 10 }}>Nearby ULPIN Properties</div>
                    {nearbyLoading && <div className="geo-msg"><Spinner /> Searching nearby…</div>}
                    {nearbyError && <ErrorBox msg={nearbyError} />}
                    {!nearbyLoading && nearby && (
                      <NearbyList nearby={nearby} onSelect={handleSelectUlpin} />
                    )}
                    {!nearbyLoading && !nearby && !nearbyError && (
                      <div className="geo-msg">No nearby properties loaded.</div>
                    )}
                  </div>
                )}

                {/* ── COMPARE TAB ───────────────────────────────────────────────── */}
                {activeTab === 'compare' && (
                  <Suspense fallback={<div className="geo-msg"><Spinner /> Loading compare module…</div>}>
                    <CompareOverlap
                      ulpin={record.ulpin}
                      allUlpins={allUlpinIds}
                      recordA={record}
                    />
                  </Suspense>
                )}

                {/* ── SOURCES TAB ───────────────────────────────────────────────── */}
                {activeTab === 'sources' && (
                  <div>
                    <div className="label" style={{ marginBottom: 10 }}>Data Sources</div>
                    <DataSourcePanel health={health} geometryStatus={geometry?.status} />
                    {providers && (
                      <div style={{ marginTop: 16 }}>
                        <div className="label" style={{ marginBottom: 8 }}>Geometry Providers</div>
                        <ProviderStatusPanel
                          attempts={geometry?.attempts}
                          searching={geoLoading}
                          providerNames={providers.providers?.map(p => p.name)}
                        />
                      </div>
                    )}
                  </div>
                )}

              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
