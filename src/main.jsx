import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import CustomerManager from "./CustomerManager.jsx";
import Mt5Manager from "./Mt5Manager.jsx";
import "./style.css";
import { supabase } from "./supabase";

function RealtimeApp() {
  const [realtimeTick, setRealtimeTick] = useState(0);
  const [session, setSession] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [mt5Open, setMt5Open] = useState(false);

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
            title="Quản lý khách hàng, License và EA"
          >
            👤 KHÁCH HÀNG
          </button>

          <button
            type="button"
            onClick={() => setMt5Open(true)}
            style={styles.mt5Button}
            title="Quản lý tài khoản MT5 và bật/tắt EA"
          >
            💻 MT5 / EA
          </button>

          <CustomerManager
            open={customerOpen}
            onClose={() => setCustomerOpen(false)}
          />

          <Mt5Manager
            open={mt5Open}
            onClose={() => setMt5Open(false)}
          />
        </>
      )}
    </>
  );
}

const baseFloatingButton = {
  position: "fixed",
  right: 24,
  zIndex: 9000,
  borderRadius: 14,
  padding: "12px 16px",
  color: "#fff",
  fontWeight: 800,
  fontSize: 12,
  letterSpacing: 0.4,
  cursor: "pointer",
};

const styles = {
  customerButton: {
    ...baseFloatingButton,
    bottom: 80,
    border: "1px solid rgba(59,130,246,.35)",
    background: "#2563eb",
    boxShadow: "0 12px 35px rgba(37,99,235,.28)",
  },
  mt5Button: {
    ...baseFloatingButton,
    bottom: 24,
    border: "1px solid rgba(16,185,129,.35)",
    background: "#059669",
    boxShadow: "0 12px 35px rgba(5,150,105,.22)",
  },
};

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RealtimeApp />
  </React.StrictMode>
);
