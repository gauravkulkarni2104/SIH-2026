import { useEffect, useRef, useState } from "react";
import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import esriConfig from "@arcgis/core/config";
import "@arcgis/core/assets/esri/themes/light/main.css";
import Graphic from "@arcgis/core/Graphic";

const API_KEY = import.meta.env.VITE_ARCGIS_API_KEY || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

export default function SatelliteMap({ latitude, longitude, footprint = null }) {
  const mapDiv = useRef(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!mapDiv.current || latitude == null || longitude == null) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    if (API_KEY) {
      esriConfig.apiKey = API_KEY;
    } else {
      console.warn("Satellite API Key (VITE_ARCGIS_API_KEY) is missing.");
    }

    let view = null;

    try {
      const map = new Map({
        basemap: "satellite",
      });

      view = new MapView({
        container: mapDiv.current,
        map,
        center: [Number(longitude), Number(latitude)],
        zoom: 19,
      });

      // ULPIN center marker graphic
      const point = {
        type: "point",
        longitude: Number(longitude),
        latitude: Number(latitude),
      };

      const marker = new Graphic({
        geometry: point,
        symbol: {
          type: "simple-marker",
          style: "circle",
          color: [239, 68, 68, 0.9], // Red dot
          size: 14,
          outline: {
            color: [255, 255, 255, 1],
            width: 2.5,
          },
        },
      });

      view.graphics.add(marker);

      // Draw real footprint overlay if footprint geometry is available
      if (Array.isArray(footprint) && footprint.length >= 3) {
        const rings = footprint.map(([lon, lat]) => [Number(lon), Number(lat)]);
        const polygonGeometry = {
          type: "polygon",
          rings: [rings],
        };

        const polygonGraphic = new Graphic({
          geometry: polygonGeometry,
          symbol: {
            type: "simple-fill",
            color: [59, 130, 246, 0.25], // Semi-transparent blue fill
            outline: {
              color: [59, 130, 246, 1], // Solid blue outline
              width: 2.5,
            },
          },
        });

        view.graphics.add(polygonGraphic);
      }

      view.when(
        () => {
          setLoading(false);
        },
        (error) => {
          console.error("ArcGIS MapView failed:", error);
          setErrorMsg(error?.message || "Failed to load satellite imagery");
          setLoading(false);
        }
      );
    } catch (err) {
      console.error("ArcGIS Map initialization error:", err);
      setErrorMsg(err.message || "Failed to initialize satellite map");
      setLoading(false);
    }

    return () => {
      if (view) {
        view.destroy();
      }
    };
  }, [latitude, longitude, footprint]);

  if (latitude == null || longitude == null) {
    return (
      <div className="unavail-banner" style={{ margin: 16 }}>
        ⚠ LOCATION UNAVAILABLE — No valid coordinates found for this ULPIN.
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 380, borderRadius: "12px", overflow: "hidden" }}>
      {loading && (
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(15, 23, 42, 0.85)",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--accent)",
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            gap: "12px",
          }}
        >
          <span className="spinner" style={{ width: 24, height: 24 }} />
          Loading satellite image...
        </div>
      )}

      {errorMsg && (
        <div className="error-box" style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 10 }}>
          ⚠ Satellite Imagery Error: {errorMsg}
        </div>
      )}

      <div
        ref={mapDiv}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      />
    </div>
  );
}