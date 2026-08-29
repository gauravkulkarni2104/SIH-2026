const OUTCOME_LABEL = {
  NETWORK_ERROR: 'NETWORK ERROR',
  HTTP_5XX: 'SERVER ERROR',
  TIMEOUT: 'TIMEOUT',
  VALID_EMPTY_RESULT: 'NO CANDIDATES',
  VALID_CANDIDATE_RESULT: 'CANDIDATE FOUND',
};
const OUTCOME_CLASS = {
  NETWORK_ERROR: 'unavailable',
  HTTP_5XX: 'unavailable',
  TIMEOUT: 'unavailable',
  VALID_EMPTY_RESULT: 'unverified',
  VALID_CANDIDATE_RESULT: 'matched',
};

/**
 * attempts: the ordered per-provider/per-radius attempt log from the last geometry search
 * (null before any search has run). searching: true while a request is in flight.
 */
export default function ProviderStatusPanel({ attempts, searching, providerNames }) {
  // Collapse the attempt log down to "last known state per provider" for the chip row,
  // but keep the full ordered log underneath for transparency.
  const lastByProvider = {};
  (attempts || []).forEach(a => { lastByProvider[a.provider] = a; });

  const names = providerNames && providerNames.length ? providerNames : Object.keys(lastByProvider);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {names.map(name => {
          const last = lastByProvider[name];
          let label = 'AVAILABLE', cls = 'testing';
          if (searching) { label = 'SEARCHING'; cls = 'testing'; }
          else if (last) { label = OUTCOME_LABEL[last.outcome] || last.outcome; cls = OUTCOME_CLASS[last.outcome] || 'testing'; }
          return (
            <span key={name} className={`status-badge ${cls}`}>
              {name}: {label}
            </span>
          );
        })}
      </div>

      {attempts && attempts.length > 0 && (
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>Provider</th><th>Radius</th><th>Outcome</th><th>HTTP</th><th>Elapsed</th><th>Candidates</th></tr></thead>
          <tbody>
            {attempts.map((a, i) => (
              <tr key={i}>
                <td>{a.provider}</td>
                <td>{a.radiusM} m</td>
                <td>{OUTCOME_LABEL[a.outcome] || a.outcome}</td>
                <td>{a.httpStatus ?? '—'}</td>
                <td>{a.elapsedMs} ms</td>
                <td>{a.candidateCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
