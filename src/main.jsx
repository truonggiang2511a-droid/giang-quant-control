import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import CustomerManager from "./CustomerManager.jsx";
import "./style.css";
import { supabase } from "./supabase";

function RealtimeApp() {
  const [realtimeTick, setRealtimeTick] = useState(0);
  const [session, setSession] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);

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
          console.warn(
            "[GQX] Realtime unavailable; App 5s polling remains active."
          );
        }
      });

    let authSubscription;

    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data?.session || null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (active) setSession(newSession);
      }
    );

    authSubscription = authListener?.subscription;

    return () => {
      active = false;
      supabase.removeChannel(channel);
      authSubscription?.unsubscribe();
    };
  }, []);

  return (
    <>
      <App key={realtimeTick} />

      {session && (
        <>
          <button
            type="button"
            onClick={() => setCustomerOpen(true)}
            style={styles.customerButton}
            title="Quản lý khách hàng"
          >
            👤 KHÁCH HÀNG
          </button>

          <CustomerManager
            open={customerOpen}
            onClose={() => setCustomerOpen(false)}
          />
        </>
      )}
    </>
  );
}

const styles = {
  customerButton: {
    position: "fixed",
    right: 24,
    bottom: 24,
    zIndex: 9000,
    border: "1px solid rgba(59,130,246,.35)",
    borderRadius: 14,
    padding: "12px 16px",
    background: "#2563eb",
    color: "#fff",
    fontWeight: 800,
    fontSize: 12,
    letterSpacing: 0.4,
    boxShadow: "0 12px 35px rgba(37,99,235,.28)",
    cursor: "pointer",
  },
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RealtimeApp />
  </React.StrictMode>
);
