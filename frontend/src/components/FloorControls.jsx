export default function FloorControls({ floors, visibleFloorIndex, onChange }) {
  if (!floors || !floors.length) return null;
  const selected = floors.find(f => f.index === visibleFloorIndex);
  return (
    <div>
      <div className="floor-controls">
        <button className={`btn small ${visibleFloorIndex === null ? 'active' : 'ghost'}`} onClick={() => onChange(null)}>Show all</button>
        <button className={`btn small ${visibleFloorIndex === -1 ? 'active' : 'ghost'}`} onClick={() => onChange(-1)}>Hide all</button>
        {floors.map(f => (
          <button
            key={f.index}
            className={`btn small ${visibleFloorIndex === f.index ? 'active' : 'ghost'}`}
            onClick={() => onChange(f.index)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {selected && (
        <div className="floor-info">
          Selected: {selected.label} · {selected.bottomM.toFixed(1)}–{selected.topM.toFixed(1)} m ASL
          · height {(selected.topM - selected.bottomM).toFixed(1)} m
        </div>
      )}
    </div>
  );
}
