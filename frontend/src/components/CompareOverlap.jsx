import { useState, useEffect, lazy, Suspense } from 'react';
import { api } from '../api';
import OverlapMap from './OverlapMap';

// Three.js is only pulled into the bundle when this component actually renders one.
const ThreeViewer = lazy(() => import('./ThreeViewer'));
const IntersectionViewer = lazy(() => import('./IntersectionViewer'));

/**
 * Stage 6: maps the real 2D Shapely intersection result (POST /api/overlap/2d)
 * to a status line. Entirely separate from the existing 3D volumetric
 * `overlap` badge/headline above — it never changes that logic, only adds a
 * new one for the new endpoint's result.
 */
function twoDStatusLine(ov2d) {
  if (!ov2d) return null;
  switch (ov2d.status) {
    case 'UNVERIFIED':
      return { text: '⚠ 2D OVERLAP: UNVERIFIED', cls: 'unverified' };
    case 'NO_OVERLAP':
      return { text: '○ 2D OVERLAP: NO OVERLAP', cls: 'none' };
    case 'BOUNDARY_TOUCH':
      return { text: '◐ 2D OVERLAP: BOUNDARY TOUCH', cls: 'horizontal_only' };
    case 'CONTAINMENT':
      return { text: '⬤ 2D OVERLAP: CONTAINMENT', cls: 'detected' };
    case 'HIGH_OVERLAP':
      return { text: '✓ 2D OVERLAP: HIGH OVERLAP', cls: 'detected' };
    case 'PARTIAL_OVERLAP':
    default:
      return { text: '✓ 2D OVERLAP: PARTIAL OVERLAP', cls: 'detected' };
  }
}

function relationshipLabel(status) {
  if (!status) return '—';
  return status.replace(/_/g, ' ');
}

/**
 * Maps a parcel's geometry state to the exact badge text/class Stage 5 requires.
 *   status: 'idle' | 'searching' | 'error' | <backend status: MATCHED/UNVERIFIED/NO_CANDIDATES/UNAVAILABLE>
 * Backend UNVERIFIED / NO_CANDIDATES ("providers answered, nothing acceptable") and backend
 * UNAVAILABLE ("every provider failed at the network level") are deliberately worded differently —
 * one is "no building found", the other is "couldn't even ask" — never collapse them into one label.
 */
function geometryBadge(status, geo) {
  switch (status) {
    case 'searching':
      return { text: 'SEARCHING', icon: '⟳', cls: 'testing', spinner: true };
    case 'MATCHED':
      return { text: `MATCHED · ${(geo.confidence * 100).toFixed(1)}%`, icon: '✓', cls: 'matched' };
    case 'UNVERIFIED':
        return { text: `UNVERIFIED · ${confidenceLabel(geo)}`, icon: '⚠', cls: 'unavailable' };
    case 'NO_CANDIDATES':
        return { text: 'NO CANDIDATE', icon: '⚠', cls: 'unavailable' };
    case 'UNAVAILABLE':
      return { text: 'EXTERNAL SERVICE UNAVAILABLE', icon: '⚠', cls: 'unavailable' };
    case 'error':
      return { text: 'GEOMETRY UNAVAILABLE', icon: '⚠', cls: 'unavailable' };
    default:
      return { text: 'PENDING', icon: '○', cls: 'testing' };
  }
}

function cacheLabel(geo) {
  if (!geo) return '—';
  return geo.cached ? 'CACHE HIT' : `CACHE MISS → ${geo.status}`;
}

function wayLabel(geo) {
  return geo && geo.candidate ? `way/${geo.candidate.wayId}` : '—';
}

function confidenceLabel(geo) {
  return geo && geo.confidence != null ? `${(geo.confidence * 100).toFixed(1)}%` : '—';
}

/**
 * Stage 5: neighbour geometry matching.
 * A's geometry is resolved (cache hit or live search — same pipeline either way) as soon as
 * this panel is open for a given ULPIN. Selecting a neighbour immediately and automatically
 * kicks off the SAME pipeline for B — the user never has to separately ask for B's geometry.
 * "ANALYZE OVERLAP" stays disabled until BOTH sides report status === MATCHED; clicking it only
 * hands the two already-verified geometries to the existing overlap endpoint (Stage 6 territory —
 * the actual intersection math lives in the backend and is untouched here).
 */
export default function CompareOverlap({ ulpin, allUlpins, recordA }) {
  const [otherId, setOtherId] = useState('');

  const [geoA, setGeoA] = useState(null);
  const [statusA, setStatusA] = useState('idle');
  const [errorA, setErrorA] = useState(null);

  const [geoB, setGeoB] = useState(null);
  const [statusB, setStatusB] = useState('idle');
  const [errorB, setErrorB] = useState(null);

  const [recordB, setRecordB] = useState(null);
  const [threeA, setThreeA] = useState(null);
  const [threeB, setThreeB] = useState(null);
  const [overlap, setOverlap] = useState(null);
  const [overlap2D, setOverlap2D] = useState(null); // Stage 6: real 2D Shapely polygon intersection
  const [overlapPhase, setOverlapPhase] = useState('idle'); // idle | computing | done
  const [overlapError, setOverlapError] = useState(null);

  // STEP 1 — Parcel A: resolve geometry (cache hit if already searched elsewhere in the app).
  // Re-runs whenever the user changes which ULPIN is selected as "A" in the main panel.
  useEffect(() => {
    setOtherId('');
    setGeoB(null);
    setStatusB('idle');
    setErrorB(null);
    resetOverlapResult();
    fetchA();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ulpin]);

  async function fetchA() {
    setStatusA('searching');
    setErrorA(null);
    try {
      const geo = await api.geometry(ulpin);
      setGeoA(geo);
      setStatusA(geo.status);
    } catch (e) {
      setGeoA(null);
      setStatusA('error');
      setErrorA(e.message || 'External geometry service unavailable.');
    }
  }

  // STEP 2 — Parcel B: same pipeline, triggered automatically the moment a neighbour is picked.
  async function fetchB(id) {
    setStatusB('searching');
    setErrorB(null);
    setGeoB(null);
    try {
      const geo = await api.geometry(id);
      setGeoB(geo);
      setStatusB(geo.status);
    } catch (e) {
      setGeoB(null);
      setStatusB('error');
      setErrorB(e.message || 'External geometry service unavailable.');
    }
  }

  function resetOverlapResult() {
    setRecordB(null);
    setThreeA(null);
    setThreeB(null);
    setOverlap(null);
    setOverlap2D(null);
    setOverlapError(null);
    setOverlapPhase('idle');
  }

  function handleSelectNeighbour(id) {
    setOtherId(id);
    resetOverlapResult();
    if (id) {
      fetchB(id);
    } else {
      setGeoB(null);
      setStatusB('idle');
      setErrorB(null);
    }
  }

  const bothMatched = statusA === 'MATCHED' && statusB === 'MATCHED';
  const geoBusy = statusA === 'searching' || statusB === 'searching';

  // Only passes the two real, already-matched geometries to the existing overlap endpoint.
  // No intersection math happens client-side — that stays entirely in overlap.py.
  async function analyzeOverlap() {
    if (!bothMatched) return;
    setOverlapPhase('computing');
    setOverlapError(null);
    try {
      const [recB, tA, tB, ov, ov2d] = await Promise.all([
        api.ulpin(otherId),
        api.threeD(ulpin),
        api.threeD(otherId),
        api.overlap(ulpin, otherId),
        api.overlap2D(ulpin, otherId),
      ]);
      setRecordB(recB);
      setThreeA(tA);
      setThreeB(tB);
      setOverlap(ov);
      setOverlap2D(ov2d);
      setOverlapPhase('done');
    } catch (e) {
      setOverlapError(e.message);
      setOverlapPhase('idle');
    }
  }

  const badgeA = geometryBadge(statusA, geoA);
  const badgeB = geometryBadge(statusB, geoB);
  const statusClass = overlap ? overlap.status.toLowerCase() : '';
  console.log("CompareOverlap allUlpins:", allUlpins);
  console.log("CompareOverlap ulpin:", ulpin);
  return (
       
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="search-input"
          style={{ width: 240, marginBottom: 0 }}
          value={otherId}
          onChange={e => handleSelectNeighbour(e.target.value)}
          disabled={statusB === 'searching'}
        >
          <option value="">Select neighbouring ULPIN…</option>
          {allUlpins
              .filter(u => u !== ulpin)
              .map(u => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                 ))}
        </select>
        <button className="btn" disabled={!bothMatched || overlapPhase === 'computing'} onClick={analyzeOverlap}>
          {overlapPhase === 'computing' ? <span className="spinner" /> : 'Analyze overlap'}
        </button>
      </div>

      <div className="compare-grid">
        <div className="compare-card">
          <h4>PARCEL A</h4>
          <div className="parcel-mini" style={{ fontSize: 13 }}>{ulpin}</div>
          <span className={`status-badge ${badgeA.cls}`} style={{ marginTop: 8 }}>
            {badgeA.spinner && <span className="spinner" style={{ marginRight: 6 }} />}
            {badgeA.icon} {badgeA.text}
          </span>
          {statusA === 'error' && <div className="geo-msg">Reason: {errorA}</div>}
          {statusA === 'UNAVAILABLE' && (
            <div className="geo-msg">
              Every configured geometry provider failed — this says nothing about whether a building
              exists, only that it couldn't be checked.
              <div style={{ marginTop: 6 }}>
                <button className="btn ghost small" onClick={fetchA}>Retry</button>
              </div>
            </div>
          )}
        </div>

        <div className="compare-card">
          <h4>PARCEL B</h4>
          <div className="parcel-mini" style={{ fontSize: 13 }}>{otherId || '— not selected —'}</div>
          {otherId && (
            <>
              <span className={`status-badge ${badgeB.cls}`} style={{ marginTop: 8 }}>
                {badgeB.spinner && <span className="spinner" style={{ marginRight: 6 }} />}
                {badgeB.icon} {badgeB.text}
              </span>
              {statusB === 'error' && <div className="geo-msg">Reason: {errorB}</div>}
              {statusB === 'UNAVAILABLE' && (
                <div className="geo-msg">
                  Every configured geometry provider failed for this parcel — this says nothing about
                  whether a building exists, only that it couldn't be checked.
                  <div style={{ marginTop: 6 }}>
                    <button className="btn ghost small" onClick={() => fetchB(otherId)}>Retry</button>
                  </div>
                </div>
              )}
              {statusB === 'UNVERIFIED' && geoB && (
                         <div className="geo-msg">
                            Candidate building found, but it is not verified.
                            <br />
                            Distance: {geoB.candidate?.distanceM} m · Area similarity: {(geoB.candidate?.areaSimilarity * 100).toFixed(1)}%
                            <br />
                            OSM Way: {geoB.candidate?.wayId}
                        </div>
               )}

               {statusB === 'NO_CANDIDATES' && (
                    <div className="geo-msg">
                       No candidate footprint met the match threshold for this parcel.
                    </div>
                )}
            
            </>
          )}
        </div>
      </div>

      {!bothMatched && !geoBusy && otherId && (
        <div className="geo-msg">
          Analyze Overlap stays disabled until both Parcel A and Parcel B report a MATCHED footprint.
        </div>
      )}

      {overlapError && <div className="error-box" style={{ marginTop: 10 }}>{overlapError}</div>}

      {overlapPhase === 'computing' && (
        <div className="geo-msg">Both geometries resolved — computing overlap…</div>
      )}

      {(geoA || otherId) && (
        <div style={{ marginTop: 16 }}>
          <div className="label" style={{ marginBottom: 6 }}>Geometry Debug — Comparison</div>
          <table>
            <thead>
              <tr><th>Parcel</th><th>ULPIN</th><th>OSM ID</th><th>Confidence</th><th>Cache</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>A</td>
                <td>{ulpin}</td>
                <td>{wayLabel(geoA)}</td>
                <td>{confidenceLabel(geoA)}</td>
                <td>{cacheLabel(geoA)}</td>
              </tr>
              <tr>
                <td>B</td>
                <td>{otherId || '—'}</td>
                <td>{wayLabel(geoB)}</td>
                <td>{confidenceLabel(geoB)}</td>
                <td>{cacheLabel(geoB)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {recordB && overlap && overlapPhase === 'done' && (
        <>
          <div className="compare-grid" style={{ marginTop: 14 }}>
            <div className="compare-card">
              <h4>{recordA.ulpin}</h4>
              <div className="parcel-mini">{recordA.type}</div>
              <div className="parcel-mini">{recordA.floors} floors · {recordA.building_height_m.toFixed(1)} m</div>
              {threeA && <Suspense fallback={<div className="geo-msg">Loading 3D…</div>}><ThreeViewer threeD={threeA} highlightFloorLabels={overlap.vertical.affectedFloorsA} /></Suspense>}
            </div>
            <div className="compare-card">
              <h4>{recordB.ulpin}</h4>
              <div className="parcel-mini">{recordB.type}</div>
              <div className="parcel-mini">{recordB.floors} floors · {recordB.building_height_m.toFixed(1)} m</div>
              {threeB && <Suspense fallback={<div className="geo-msg">Loading 3D…</div>}><ThreeViewer threeD={threeB} highlightFloorLabels={overlap.vertical.affectedFloorsB} /></Suspense>}
            </div>
          </div>

          <div className={`overlap-headline ${statusClass}`}>{overlap.headline}</div>

          <div className="detail-grid" style={{ marginTop: 12 }}>
            <div className="stat"><div className="k">{overlap.horizontal.label}</div>
              <div className="v" style={{ fontSize: 13 }}>
                {overlap.horizontal.verified
                  ? `${overlap.horizontal.intersectionAreaM2} m² (${overlap.horizontal.pctOfA}% / ${overlap.horizontal.pctOfB}%)`
                  : 'both parcels need a MATCHED footprint to verify'}
              </div>
            </div>
            <div className="stat"><div className="k">Vertical ranges</div>
              <div className="v" style={{ fontSize: 13 }}>
                A: {overlap.vertical.buildingARange[0]}–{overlap.vertical.buildingARange[1]} m<br />
                B: {overlap.vertical.buildingBRange[0]}–{overlap.vertical.buildingBRange[1]} m
              </div>
            </div>
            <div className="stat"><div className="k">Affected floors — A</div><div className="v" style={{ fontSize: 13 }}>{overlap.vertical.affectedFloorsA.join(', ') || '—'}</div></div>
            <div className="stat"><div className="k">Affected floors — B</div><div className="v" style={{ fontSize: 13 }}>{overlap.vertical.affectedFloorsB.join(', ') || '—'}</div></div>
            {overlap.volumeM3 != null && (
              <div className="stat"><div className="k">3D overlap volume</div><div className="v" style={{ fontSize: 13, color: 'var(--alert)' }}>{overlap.volumeM3} m³</div></div>
            )}
          </div>

          {overlap.status === 'DETECTED' && overlap.horizontal.intersectionRingLocalXY && (
            <div style={{ marginTop: 14 }}>
              <div className="label">Overlap Region (real intersection geometry, extruded through shared vertical range)</div>
              <Suspense fallback={<div className="geo-msg">Loading 3D…</div>}>
                <IntersectionViewer
                  ringLocalXY={overlap.horizontal.intersectionRingLocalXY}
                  verticalRangeM={overlap.vertical.overlapRangeM}
                />
              </Suspense>
              <div className="geo-msg">
                Horizontal intersection: {overlap.horizontal.intersectionAreaM2} m² · Vertical intersection:{' '}
                {overlap.vertical.overlapRangeM[0]}–{overlap.vertical.overlapRangeM[1]} m · 3D overlap: {overlap.volumeM3} m³
              </div>
            </div>
          )}
        </>
      )}

      {overlap2D && overlapPhase === 'done' && (
        <div style={{ marginTop: 20 }}>
          <div className="label">2D Overlap Analysis</div>

          <div className="compare-grid">
            <div className="compare-card">
              <h4>Parcel A</h4>
              <div className="parcel-mini" style={{ fontSize: 13 }}>{overlap2D.parcel_a?.ulpin}</div>
              <div className="parcel-mini">Geometry: {statusA === 'MATCHED' ? 'MATCHED' : statusA}</div>
            </div>
            <div className="compare-card">
              <h4>Parcel B</h4>
              <div className="parcel-mini" style={{ fontSize: 13 }}>{overlap2D.parcel_b?.ulpin}</div>
              <div className="parcel-mini">Geometry: {statusB === 'MATCHED' ? 'MATCHED' : statusB}</div>
            </div>
          </div>

          {!overlap2D.verified ? (
            <div className="geo-msg">
              <strong>{twoDStatusLine(overlap2D).text}</strong><br />
              {overlap2D.reason}
            </div>
          ) : (
            <>
              <div className={`overlap-headline ${twoDStatusLine(overlap2D).cls}`}>{twoDStatusLine(overlap2D).text}</div>

              <div className="detail-grid" style={{ marginTop: 12 }}>
                <div className="stat"><div className="k">Parcel A area</div><div className="v">{overlap2D.parcel_a.area_m2} m²</div></div>
                <div className="stat"><div className="k">Parcel B area</div><div className="v">{overlap2D.parcel_b.area_m2} m²</div></div>
                <div className="stat"><div className="k">Intersection area</div><div className="v">{overlap2D.intersection_area_m2} m²</div></div>
                <div className="stat"><div className="k">Union area</div><div className="v">{overlap2D.union_area_m2} m²</div></div>
                <div className="stat"><div className="k">Overlap — Parcel A</div><div className="v">{overlap2D.overlap_percent_a}%</div></div>
                <div className="stat"><div className="k">Overlap — Parcel B</div><div className="v">{overlap2D.overlap_percent_b}%</div></div>
                <div className="stat"><div className="k">IoU</div><div className="v">{overlap2D.iou_percent}%</div></div>
                <div className="stat"><div className="k">Minimum distance</div><div className="v">{overlap2D.minimum_distance_m} m</div></div>
                <div className="stat"><div className="k">Centroid distance</div><div className="v">{overlap2D.centroid_distance_m} m</div></div>
                <div className="stat"><div className="k">Status</div><div className="v" style={{ fontSize: 13 }}>{relationshipLabel(overlap2D.status)}</div></div>
              </div>

              <OverlapMap
                ringA={geoA?.candidate?.ring}
                ringB={geoB?.candidate?.ring}
                intersectionGeometry={overlap2D.intersection_geometry}
                centroidA={overlap2D.centroid_a}
                centroidB={overlap2D.centroid_b}
                refPointA={recordA ? [recordA.latitude, recordA.longitude] : null}
                refPointB={recordB ? [recordB.latitude, recordB.longitude] : null}
              />
            </>
          )}

          <div className="geo-msg">
            Geometry source: OpenStreetMap building footprint.<br />
            {overlap2D.verified ? overlap2D.message : null} {overlap2D.disclaimer}
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="label" style={{ marginBottom: 6 }}>Overlap Debug</div>
            <table>
              <tbody>
                <tr><td>Parcel A OSM ID</td><td>{overlap2D.parcel_a?.osm_id ?? '—'}</td></tr>
                <tr><td>Parcel B OSM ID</td><td>{overlap2D.parcel_b?.osm_id ?? '—'}</td></tr>
                <tr><td>Projection used</td><td style={{ fontSize: 11 }}>{overlap2D.projection_used || '—'}</td></tr>
                <tr><td>Geometry A area</td><td>{overlap2D.parcel_a?.area_m2 != null ? `${overlap2D.parcel_a.area_m2} m²` : '—'}</td></tr>
                <tr><td>Geometry B area</td><td>{overlap2D.parcel_b?.area_m2 != null ? `${overlap2D.parcel_b.area_m2} m²` : '—'}</td></tr>
                <tr><td>Intersection area</td><td>{overlap2D.intersection_area_m2 != null ? `${overlap2D.intersection_area_m2} m²` : '—'}</td></tr>
                <tr><td>IoU</td><td>{overlap2D.iou_percent != null ? `${overlap2D.iou_percent}%` : '—'}</td></tr>
                <tr><td>Minimum distance</td><td>{overlap2D.minimum_distance_m != null ? `${overlap2D.minimum_distance_m} m` : '—'}</td></tr>
                <tr><td>Centroid distance</td><td>{overlap2D.centroid_distance_m != null ? `${overlap2D.centroid_distance_m} m` : '—'}</td></tr>
                <tr><td>Geometry validity</td><td>{overlap2D.geometry_valid_a != null ? `A: ${overlap2D.geometry_valid_a ? 'VALID' : 'INVALID'} · B: ${overlap2D.geometry_valid_b ? 'VALID' : 'INVALID'}` : '—'}</td></tr>
                <tr><td>Repair applied</td><td>{overlap2D.repair_applied_a != null ? `A: ${overlap2D.repair_applied_a ? 'YES' : 'NO'} · B: ${overlap2D.repair_applied_b ? 'YES' : 'NO'}` : '—'}</td></tr>
                <tr><td>Calculation status</td><td>{overlap2D.status}{!overlap2D.verified ? ` — ${overlap2D.reason}` : ''}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
