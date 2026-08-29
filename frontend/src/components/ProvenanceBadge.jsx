export default function ProvenanceBadge({ threeD }) {
  if (!threeD) return null;
  const p = threeD.provenance;
  const verified = !threeD.isEstimated;

  return (
    <div className={`provenance-badge ${verified ? 'verified' : 'estimated'}`}>
      <div className="provenance-title">{p.label}</div>
      {verified ? (
        <div className="provenance-grid">
          <div><span className="k">Source</span><span className="v">{p.source}</span></div>
          <div><span className="k">Confidence</span><span className="v">{(p.confidence * 100).toFixed(0)}%</span></div>
          <div><span className="k">Distance</span><span className="v">{p.distanceM} m</span></div>
          <div><span className="k">Area similarity</span><span className="v">{(p.areaSimilarity * 100).toFixed(0)}%</span></div>
          <div><span className="k">OSM way</span><span className="v">#{p.osmWayId}</span></div>
        </div>
      ) : (
        <div className="provenance-grid">
          <div><span className="k">Basis</span><span className="v">Location + area + height + floor data</span></div>
          <div><span className="k">Geometry status</span><span className="v">{p.geometryStatus}</span></div>
        </div>
      )}
      <div className="provenance-cadastral">Cadastral boundary: <b>{p.cadastralBoundary}</b></div>
    </div>
  );
}
