import { useEffect, useRef, useState, useCallback } from "react";
import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import esriConfig from "@arcgis/core/config";
import "@arcgis/core/assets/esri/themes/light/main.css";
import Graphic from "@arcgis/core/Graphic";

const API_KEY = import.meta.env.VITE_ARCGIS_API_KEY || import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

export default function SatelliteMap({ latitude, longitude, footprint = null }) {
  const mapDiv = useRef(null);
  const viewRef = useRef(null);
  const isInitializingRef = useRef(false);
  const isMountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);

  // Helper to update markers and building footprint graphics on existing MapView
  const updateGraphicsAndCenter = useCallback((view, lat, lon, foot) => {
    if (!view || lat == null || lon == null) return;

    try {
      // Clear previous graphics
      view.graphics.removeAll();

      // 1. ULPIN center marker graphic
      const point = {
        type: "point",
        longitude: Number(lon),
        latitude: Number(lat),
      };

      const marker = new Graphic({
        geometry: point,
        symbol: {
          type: "simple-marker",
          style: "circle",
          color: [239, 68, 68, 0.9], // Red location marker
          size: 14,
          outline: {
            color: [255, 255, 255, 1],
            width: 2.5,
          },
        },
      });
      view.graphics.add(marker);

      // 2. Footprint polygon overlay graphic
      if (Array.isArray(foot) && foot.length >= 3) {
        const rings = foot.map(([pLon, pLat]) => [Number(pLon), Number(pLat)]);
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
              color: [59, 130, 246, 1], // Solid blue border
              width: 2.5,
            },
          },
        });
        view.graphics.add(polygonGraphic);
      }

      // Smoothly re-center camera view to new location
      view.goTo(
        {
          center: [Number(lon), Number(lat)],
          zoom: 19,
        },
        { animate: true, duration: 600 }
      ).catch((err) => {
        // Ignore navigation aborts during rapid switching
        if (err?.name !== "AbortError") {
          console.warn("Map view.goTo navigation interrupted:", err);
        }
      });
    } catch (err) {
      console.warn("Failed to update graphics on MapView:", err);
    }
  }, []);

  // 1. Single Mount Effect: Create ArcGIS MapView only ONCE when container is ready
  useEffect(() => {
    isMountedRef.current = true;

    if (!mapDiv.current || latitude == null || longitude == null) {
      setLoading(false);
      return;
    }

    if (viewRef.current || isInitializingRef.current) {
      return;
    }

    isInitializingRef.current = true;
    setLoading(true);
    setErrorMsg(null);

    if (API_KEY) {
      esriConfig.apiKey = API_KEY;
    } else {
      console.warn("Satellite API Key (VITE_ARCGIS_API_KEY) is missing.");
    }

    let map = null;
    let view = null;

    try {
      map = new Map({
        basemap: "satellite",
      });

      view = new MapView({
        container: mapDiv.current,
        map,
        center: [Number(longitude), Number(latitude)],
        zoom: 19,
      });

      viewRef.current = view;

      // Handle async view loading & errors safely
      view.when(
        () => {
          if (!isMountedRef.current) return;
          setLoading(false);
          isInitializingRef.current = false;
          // Initial graphics update
          updateGraphicsAndCenter(view, latitude, longitude, footprint);
        },
        (error) => {
          isInitializingRef.current = false;
          // Silently ignore intentional cleanup aborts (e.g. React.StrictMode unmount)
          if (!isMountedRef.current || error?.name === "AbortError" || error?.message?.includes("Aborted")) {
            return;
          }
          console.error("ArcGIS MapView failed to load:", error);
          setErrorMsg(error?.message || "Failed to load satellite imagery");
          setLoading(false);
        }
      );
    } catch (err) {
      isInitializingRef.current = false;
      if (isMountedRef.current) {
        console.error("ArcGIS Map initialization error:", err);
        setErrorMsg(err.message || "Failed to initialize satellite map");
        setLoading(false);
      }
    }

    // Cleanup: Destroy MapView safely on component unmount
    return () => {
      isMountedRef.current = false;
      isInitializingRef.current = false;
      if (viewRef.current) {
        try {
          viewRef.current.destroy();
        } catch (e) {
          // ignore cleanup errors
        }
        viewRef.current = null;
      }
    };
  }, []); // Run ONCE on mount

  // 2. Update Effect: Re-center & update graphics without destroying MapView when ULPIN changes
  useEffect(() => {
    if (viewRef.current && latitude != null && longitude != null) {
      updateGraphicsAndCenter(viewRef.current, latitude, longitude, footprint);
    }
  }, [latitude, longitude, footprint, updateGraphicsAndCenter]);

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