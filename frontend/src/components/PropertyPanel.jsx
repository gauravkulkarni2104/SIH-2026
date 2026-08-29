function QualityRow({ ok, label }) {
  return (
    <div className="item">
      <span className={ok ? 'yes' : 'no'}>{ok ? '✓' : '⚠'}</span>
      <span>{label}</span>
    </div>
  );
}

export default function PropertyPanel({ record, geometry }) {
  const q = record.dataQuality;
  return (
    <>
      <div className="section-title-row">
        <div className="label" style={{ marginBottom: 0 }}>Parcel Detail</div>
        <span className={`status-badge ${record.height_consistent === false ? 'warn' : 'ok'}`}>
          {record.height_consistent === false ? '⚠ HEIGHT DATA MISMATCH' : '✓ HEIGHT CONSISTENT'}
        </span>
      </div>
      <div className="parcel-id" style={{ fontSize: 16, marginTop: 6 }}>{record.ulpin}</div>
      <div className="parcel-type">{record.type}</div>

      <div className="detail-grid">
        <div className="stat"><div className="k">Area</div><div className="v">{record.area_m2.toFixed(2)} m²</div></div>
        <div className="stat"><div className="k">Perimeter</div><div className="v">{record.perimeter_m.toFixed(2)} m</div></div>
        <div className="stat"><div className="k">Floors</div><div className="v">{record.floors}</div></div>
        <div className="stat"><div className="k">Floor height</div><div className="v">{record.floor_height_m.toFixed(1)} m</div></div>
        <div className="stat"><div className="k">Building height (reg.)</div><div className="v">{(record.registered_height_m ?? record.building_height_m).toFixed(1)} m</div></div>
        <div className="stat"><div className="k">Calculated (DSM–DEM)</div><div className="v">{record.calculated_height_m != null ? record.calculated_height_m.toFixed(1) + ' m' : '—'}</div></div>
        <div className="stat"><div className="k">DEM (ground)</div><div className="v">{record.dem_m_asl.toFixed(2)} m ASL</div></div>
        <div className="stat"><div className="k">DSM (surface)</div><div className="v">{record.dsm_m_asl != null ? record.dsm_m_asl.toFixed(2) + ' m ASL' : '—'}</div></div>
        <div className="stat"><div className="k">Latitude</div><div className="v">{record.latitude.toFixed(6)}</div></div>
        <div className="stat"><div className="k">Longitude</div><div className="v">{record.longitude.toFixed(6)}</div></div>
      </div>

      <div className="label" style={{ marginTop: 16 }}>Data Quality</div>
      <div className="quality-list">
        <QualityRow ok={q.ulpinMatched} label="ULPIN matched" />
        <QualityRow ok={q.coordinatesValid} label="Coordinates valid" />
        <QualityRow ok={q.propertyTypeAvailable} label="Property type available" />
        <QualityRow ok={q.floorDataAvailable} label="Floor data available" />
        <QualityRow ok={q.demAvailable} label="DEM available" />
        <QualityRow ok={q.dsmAvailable} label="DSM available" />
        <QualityRow ok={q.heightValidated} label="Height validated" />
        <QualityRow
          ok={geometry?.status === 'MATCHED'}
          label={geometry?.status === 'MATCHED' ? 'Open geometry matched' : 'Exact geometry unavailable'}
        />
      </div>

      <div className="label" style={{ marginTop: 16 }}>Data Sources</div>
      <div className="source-tags">
        <div className="source-tag">PROPERTY DATA — <b>CSV</b></div>
        <div className="source-tag">HEIGHT — <b>DSM / DEM CSV</b></div>
        <div className="source-tag">CLASSIFICATION — <b>CSV</b></div>
        <div className="source-tag">
          GEOMETRY — <b>{geometry ? (geometry.source || 'unavailable') : 'not searched yet'}</b>
        </div>
      </div>
    </>
  );
}
