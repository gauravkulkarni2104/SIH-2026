import { useState, useEffect, lazy, Suspense } from 'react';
import SatelliteMap from './components/SatelliteMap';

const ThreeViewer = lazy(() => import('./components/ThreeViewer'));

export default function App() {
  const [page, setPage] = useState('input');
  const [inputUlpin, setInputUlpin] = useState('');
  const [floors, setFloors] = useState(3);
  const [basements, setBasements] = useState(1);
  const [progressMsg, setProgressMsg] = useState('');
  const [progress, setProgress] = useState(0);
  const [mock3D, setMock3D] = useState(null);

  // Default coordinate (New Delhi)
  const defaultLat = 28.6139;
  const defaultLon = 77.2090;

  const handleNext = () => {
    if (!inputUlpin.trim()) return;
    setPage('config');
  };

  const startGeneration = () => {
    setPage('generating');
    setProgress(0);
    const steps = [
      "Integrating Drone & Satellite Imagery...",
      "Extracting Building Footprints via AI...",
      "Running Vertical Floor Segmentation...",
      "Parsing LiDAR & DEM data for basements...",
      "Validating 3D Topology & Volume Cadastre...",
      "Minting New 3D ULPIN..."
    ];
    
    let step = 0;
    const interval = setInterval(() => {
      setProgressMsg(steps[step]);
      setProgress(Math.floor((step / steps.length) * 100));
      step++;
      
      if (step > steps.length) {
        clearInterval(interval);
        setProgress(100);
        generateMockData();
        setTimeout(() => setPage('result'), 800);
      }
    }, 1200);
  };

  const generateMockData = () => {
    // Generate a simple square footprint
    const size = 0.0002;
    const footprint = [
      [defaultLon - size, defaultLat - size],
      [defaultLon + size, defaultLat - size],
      [defaultLon + size, defaultLat + size],
      [defaultLon - size, defaultLat + size],
      [defaultLon - size, defaultLat - size]
    ];

    const generatedFloors = [];
    if (basements > 0) {
      for (let i = basements; i >= 1; i--) {
        generatedFloors.push({
          id: `B${i}`,
          label: `B${i}`,
          bottomM: -3 * i,
          topM: -3 * (i - 1),
          isUnderground: true
        });
      }
    }
    for (let i = 1; i <= floors; i++) {
      generatedFloors.push({
        id: `F${i}`,
        label: `F${i}`,
        bottomM: (i - 1) * 3,
        topM: i * 3,
        isUnderground: false
      });
    }
    // Add roof
    generatedFloors.push({
      id: 'ROOF',
      label: 'ROOF',
      bottomM: floors * 3,
      topM: floors * 3 + 0.5,
      isUnderground: false
    });

    setMock3D({
      originLatitude: defaultLat,
      originLongitude: defaultLon,
      groundElevationM: 0,
      footprint,
      floors: generatedFloors,
      ulpin: `${inputUlpin}-3D`
    });
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-group">
          <div className="logo-icon">💠</div>
          <div className="logo-text">
            <h2>3D ULPIN</h2>
            <span>Vertical Property Mapping System</span>
          </div>
        </div>
        {page === 'result' && (
          <button className="reset-btn" onClick={() => { setPage('input'); setInputUlpin(''); }}>
            + New Generation
          </button>
        )}
      </header>

      {/* Main Content Area */}
      <main className="app-main">
        {page === 'input' && (
          <div className="card input-card">
            <h1>Upgrade to 3D Cadastre</h1>
            <p>Enter a traditional 2D ULPIN to generate a standardized 3D volumetric representation including surface, multi-storey, and underground rights.</p>
            
            <div className="input-group">
              <label>2D ULPIN Number</label>
              <input 
                type="text" 
                placeholder="e.g. 12345678901234" 
                value={inputUlpin}
                onChange={(e) => setInputUlpin(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleNext()}
                autoFocus
              />
            </div>
            <button className="primary-btn mt-4" onClick={handleNext} disabled={!inputUlpin}>
              Proceed to Configuration ➔
            </button>
          </div>
        )}

        {page === 'config' && (
          <div className="card config-card">
            <h1>Property Specifications</h1>
            <p>Configure the vertical dimensions for ULPIN: <span className="highlight">{inputUlpin}</span></p>
            
            <div className="config-grid">
              <div className="input-group">
                <label>Above-Ground Floors</label>
                <div className="stepper">
                  <button onClick={() => setFloors(Math.max(1, floors - 1))}>-</button>
                  <span>{floors}</span>
                  <button onClick={() => setFloors(floors + 1)}>+</button>
                </div>
              </div>
              <div className="input-group">
                <label>Basement Levels (Underground)</label>
                <div className="stepper">
                  <button onClick={() => setBasements(Math.max(0, basements - 1))}>-</button>
                  <span>{basements}</span>
                  <button onClick={() => setBasements(basements + 1)}>+</button>
                </div>
              </div>
            </div>

            <div className="action-row">
              <button className="secondary-btn" onClick={() => setPage('input')}>Back</button>
              <button className="primary-btn" onClick={startGeneration}>
                Generate 3D ULPIN
              </button>
            </div>
          </div>
        )}

        {page === 'generating' && (
          <div className="card generating-card">
            <div className="loader-ring"></div>
            <h2>Processing 3D Digital Twin...</h2>
            <div className="progress-bar-container">
              <div className="progress-bar" style={{ width: `${progress}%` }}></div>
            </div>
            <p className="progress-msg">{progressMsg}</p>
          </div>
        )}

        {page === 'result' && mock3D && (
          <div className="result-layout">
            <div className="sidebar">
              <div className="info-panel card">
                <div className="flex-between mb-2">
                  <div className="badge success">Generation Successful</div>
                  <button className="reset-btn" style={{padding: '0.25rem 0.5rem', fontSize: '0.75rem'}} onClick={() => alert("Exporting 3D GeoJSON/CityGML...")}>
                    ↓ Export GeoJSON
                  </button>
                </div>
                <h3>Original 2D ULPIN</h3>
                <div className="code-box">{inputUlpin}</div>
                
                <h3 className="mt-4">New 3D ULPIN (Volumetric)</h3>
                <div className="code-box primary">{mock3D.ulpin}</div>

                <div className="stats-grid">
                  <div className="stat">
                    <span>Total Floors</span>
                    <strong>{floors}</strong>
                  </div>
                  <div className="stat">
                    <span>Basements</span>
                    <strong>{basements}</strong>
                  </div>
                  <div className="stat">
                    <span>Total Height</span>
                    <strong>{floors * 3}m</strong>
                  </div>
                  <div className="stat">
                    <span>Underground Depth</span>
                    <strong>{basements * 3}m</strong>
                  </div>
                </div>

                <div className="ai-validation mt-4">
                  <h4>AI Validation Results</h4>
                  <ul>
                    <li>✓ Floor segmentation aligned</li>
                    <li>✓ LiDAR point cloud matched</li>
                    <li>✓ Volumetric rights established</li>
                    <li>✓ Zero topology conflicts</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="satellite-panel card p-0" style={{width: '350px', flexShrink: 0, display: 'flex', flexDirection: 'column'}}>
              <div className="card-header flex-between">
                <span>Satellite Context</span>
                <span className="badge">LIVE</span>
              </div>
              <div className="map-wrapper" style={{flex: 1, position: 'relative'}}>
                <SatelliteMap latitude={mock3D.originLatitude} longitude={mock3D.originLongitude} />
              </div>
            </div>

            <div className="main-viewer card p-0">
              <div className="card-header flex-between">
                <span>3D Volumetric Cadastre View</span>
                <div className="flex-between" style={{gap: '0.5rem'}}>
                  <span className="badge">Interactive</span>
                  <span className="badge" style={{background: 'rgba(59, 130, 246, 0.1)', color: 'var(--primary)', borderColor: 'var(--primary)'}}>LiDAR Mode</span>
                </div>
              </div>
              <div className="three-wrapper">
                <Suspense fallback={<div className="loading-3d">Loading 3D Engine...</div>}>
                  <ThreeViewer threeD={mock3D} visibleFloorIndex={null} />
                </Suspense>
                
                {/* Overlay telemetry UI */}
                <div className="telemetry-overlay">
                  <div className="telemetry-item">LAT: {mock3D.originLatitude.toFixed(6)}</div>
                  <div className="telemetry-item">LON: {mock3D.originLongitude.toFixed(6)}</div>
                  <div className="telemetry-item">VOL: {(44 * 44 * (floors + basements) * 3).toLocaleString()} m³</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
