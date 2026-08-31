import { useEffect, useRef } from "react";
import Map from "@arcgis/core/Map";
import MapView from "@arcgis/core/views/MapView";
import esriConfig from "@arcgis/core/config";
import Basemap from "@arcgis/core/Basemap";
import "@arcgis/core/assets/esri/themes/light/main.css";
import Graphic from "@arcgis/core/Graphic";

const API_KEY = import.meta.env.VITE_ARCGIS_API_KEY;

export default function SatelliteMap({ latitude, longitude }) {
  const mapDiv = useRef(null);

  useEffect(() => {
    if (!mapDiv.current || latitude == null || longitude == null) {
      return;
    }

    if (API_KEY) {
      esriConfig.apiKey = API_KEY;
    } else {
      console.warn("VITE_ARCGIS_API_KEY is missing, map may not load correctly or show a watermark.");
    }

    const map = new Map({
      basemap: "satellite",
    });

    const view = new MapView({
      container: mapDiv.current,
      map,
      center: [Number(longitude), Number(latitude)],
      zoom: 20,
    });
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
        size: 12,
        outline: {
          width: 2,
        },
      },
    });
    
    view.graphics.add(marker);

    view.when(
      () => {
        console.log("ArcGIS imagery loaded successfully");
      },
      (error) => {
        console.error("ArcGIS MapView failed:", error);
      }
    );

    return () => {
      view.destroy();
    };
  }, [latitude, longitude]);

  return (
    <div
      ref={mapDiv}
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    />
  );
}