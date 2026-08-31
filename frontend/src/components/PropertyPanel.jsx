export default function PropertyPanel({ record, geometry, onEnter3D }) {
  if (!record) return null;

  const q = record.dataQuality || {};

  const qualityItems = [
    { key: 'ulpinMatched',          label: 'ULPIN matched'         },
    { key: 'coordinatesValid',      label: 'Coordinates valid'     },
    { key: 'propertyTypeAvailable', label: 'Property type present' },
    { key: 'floorDataAvailable',    label: 'Floor data present'    },
    { key: 'demAvailable',          label: 'DEM elevation'         },
    { key: 'dsmAvailable',          label: 'DSM elevation'         },
    { key: 'heightValidated',       label: 'Height validated'      },
  ];

  return (
    <div className="property-hero">
      {/* ULPIN badge + type tag row */}
      <div className="prop-header">
        <div>
          <div className="prop-ulpin-label">ULPIN</div>
          <div className="prop-ulpin-id">{record.ulpin}</div>
        </div>
        <div className="prop-type-tag">{record.type || '—'}</div>
      </div>

      {/* Stats grid */}
      <div className="prop-stats">
        <div className="prop-stat">
          <div className="ps-k">Area</div>
          <div className="ps-v">{record.area_m2.toFixed(1)} <span className="ps-unit">m²</span></div>
        </div>
        <div className="prop-stat">
          <div className="ps-k">Floors</div>
          <div className="ps-v">{record.floors}</div>
        </div>
        <div className="prop-stat">
          <div className="ps-k">Height</div>
          <div className="ps-v">{record.building_height_m.toFixed(1)} <span className="ps-unit">m</span></div>
        </div>
        <div className="prop-stat">
          <div className="ps-k">Floor H.</div>
          <div className="ps-v">
            {record.floor_height_m.toFixed(1)} <span className="ps-unit">m</span>
            {record.floor_height_estimated && <span className="ps-est"> est.</span>}
          </div>
        </div>
        <div className="prop-stat">
          <div className="ps-k">DEM</div>
          <div className="ps-v">{record.dem_m_asl.toFixed(2)} <span className="ps-unit">m asl</span></div>
        </div>
        <div className="prop-stat">
          <div className="ps-k">DSM</div>
          <div className="ps-v">{record.dsm_m_asl != null ? record.dsm_m_asl.toFixed(2) : '—'} <span className="ps-unit">m asl</span></div>
        </div>
        <div className="prop-stat">
          <div className="ps-k">Lat</div>
          <div className="ps-v" style={{ fontSize: 13 }}>{record.latitude.toFixed(6)}</div>
        </div>
        <div className="prop-stat">
          <div className="ps-k">Lon</div>
          <div className="ps-v" style={{ fontSize: 13 }}>{record.longitude.toFixed(6)}</div>
        </div>
      </div>

      {/* Height consistency indicator */}
      {record.height_consistent != null && (
        <div className={`height-badge ${record.height_consistent ? 'ok' : 'warn'}`}>
          {record.height_consistent
            ? `✓ Height consistent — ${record.height_source}`
            : `⚠ Height mismatch — registered ${record.registered_height_m?.toFixed(1) ?? '?'} m vs calculated ${record.calculated_height_m?.toFixed(1) ?? '?'} m`}
        </div>
      )}

      {/* Data quality checklist */}
      <div className="prop-quality">
        <div className="pq-title">Data Quality</div>
        <div className="quality-list">
          {qualityItems.map(({ key, label }) => (
            <div key={key} className="item">
              <span className={q[key] ? 'yes' : 'no'}>{q[key] ? '✓' : '✕'}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3D CTA */}
      {onEnter3D && (
        <button className="prop-3d-cta" onClick={onEnter3D}>
          <span className="cta-icon">⬡</span>
          Enter 3D Geometry
          <span className="cta-arrow">→</span>
        </button>
      )}
    </div>
  );
}
