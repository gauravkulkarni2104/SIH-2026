export default function DataSourcePanel({ health, geometryStatus }) {
  if (!health) return null;
  const rows = [
    { key: 'csv', name: 'Local ULPIN / DEM / DSM CSV', state: health.csvLoaded ? 'on' : 'off', note: health.csvLoaded ? 'CONNECTED' : 'FAILED' },
    { key: 'osm', name: 'OpenStreetMap tiles', state: 'opt', note: 'loads with map' },
    {
      key: 'overpass', name: 'Overpass API (building geometry)',
      state: ['MATCHED', 'UNVERIFIED', 'NO_CANDIDATES'].includes(geometryStatus) ? 'on' : geometryStatus === 'UNAVAILABLE' ? 'off' : 'opt',
      note: geometryStatus ? geometryStatus.replace('_', ' ') : 'not searched yet',
    },
    { key: 'open-buildings', name: 'Google Open Buildings', state: 'off', note: 'not integrated — no simple point-lookup REST API' },
    { key: 'bhuvan', name: 'Bhuvan / NRSC', state: health.optionalServices.bhuvan ? 'on' : 'off', note: health.optionalServices.bhuvan ? 'CONNECTED' : 'token not configured' },
    { key: 'opentopo', name: 'OpenTopography', state: health.optionalServices.openTopography ? 'on' : 'off', note: health.optionalServices.openTopography ? 'CONNECTED' : 'using local DEM/DSM CSV instead' },
  ];
  return (
    <div>
      {rows.map(r => (
        <div className="src-row" key={r.key}>
          <span><span className={`dot ${r.state}`} />{r.name}</span>
          <span className="src-status">{r.note}</span>
        </div>
      ))}
    </div>
  );
}
