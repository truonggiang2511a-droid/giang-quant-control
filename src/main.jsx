import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./style.css";
import { supabase } from "./supabase";

function RealtimeApp() {
  const [realtimeTick, setRealtimeTick] = useState(0);

  useEffect(() => {
    if (!supabase) {
      console.error("[GQX] SUPABASE NOT CONFIGURED");
      return undefined;
    }

    let active = true;

    const triggerRefresh = (source, payload) => {
      if (!active) return;
      console.log(`[GQX] REALTIME ${source}:`, payload);
      setRealtimeTick((value) => value + 1);
    };

    const channel = supabase
      .channel("gqx-dashboard-realtime-v2")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bot_instances",
        },
        (payload) => triggerRefresh("bot_instances", payload)
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "heartbeat_logs",
        },
        (payload) => triggerRefresh("heartbeat_logs", payload)
      )
      .subscribe((status, error) => {
        console.log("[GQX] REALTIME STATUS:", status);

        if (error) {
          console.error("[GQX] REALTIME ERROR:", error);
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.warn("[GQX] Realtime unavailable; App 5s polling remains active.");
        }
      });

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return <App key={realtimeTick} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RealtimeApp />
  </React.StrictMode>
);
