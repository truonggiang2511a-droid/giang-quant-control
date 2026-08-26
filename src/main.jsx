import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./style.css";
import { supabase } from "./supabase";

function RealtimeApp() {
  const [realtimeTick, setRealtimeTick] = useState(0);

  useEffect(() => {
    if (!supabase) return undefined;

    const channel = supabase
      .channel("gqx-bot-instances-realtime")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bot_instances",
        },
        (payload) => {
          console.log("[GQX] BOT REALTIME:", payload.eventType);
          setRealtimeTick((value) => value + 1);
        }
      )
      .subscribe((status) => {
        console.log("[GQX] REALTIME STATUS:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return <App realtimeTick={realtimeTick} />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RealtimeApp />
  </React.StrictMode>
);
