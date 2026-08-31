export default function NearbyList({ nearby, onSelect }) {
  if (!nearby || !nearby.results?.length) return <div className="geo-msg">No other parcels in the loaded dataset.</div>;
  return (
    <table>
      <thead><tr><th>ULPIN</th><th>Distance</th><th>Property type</th></tr></thead>
      <tbody>
        {nearby.results.map(n => (
          <tr key={n.ulpin} className="clickable" onClick={() => onSelect(n.ulpin)}>
            <td>{n.ulpin}</td>
            <td>{n.distanceM.toFixed(1)} m</td>
            <td>{n.type}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
