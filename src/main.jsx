import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import CustomerManager from "./CustomerManager.jsx";
import MT5Manager from "./MT5Manager.jsx";
import LicenseLinkManager from "./LicenseLinkManager.jsx";
import CustomerAwareDashboard from "./CustomerAwareDashboard.jsx";
import "./style.css";
import { supabase } from "./supabase";

function RealtimeApp() {
  const [realtimeTick, setRealtimeTick] = useState(0);
  const [session, setSession] = useState(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [mt5Open, setMt5Open] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

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
      .channel("gqx-dashboard-realtime-v3")
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_instances" }, (payload) => triggerRefresh("bot_instances", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "heartbeat_logs" }, (payload) => triggerRefresh("heartbeat_logs", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, (payload) => triggerRefresh("customers", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "licenses" }, (payload) => triggerRefresh("licenses", payload))
      .on("postgres_changes", { event: "*", schema: "public", table: "mt5_accounts" }, (payload) => triggerRefresh("mt5_accounts", payload))
      .subscribe((status, error) => {
        console.log("[GQX] REALTIME STATUS:", status);
        if (error) console.error("[GQX] REALTIME ERROR:", error);
      });

    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data?.session || null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (active) setSession(newSession);
    });

    return () => {
      active = false;
      supabase.removeChannel(channel);
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  return (
    <>
      <App key={realtimeTick} />

      <CustomerAwareDashboard refreshToken={realtimeTick} />

      {session && (
        <>
          <button type="button" onClick={() => setCustomerOpen(true)} style={{ ...styles.actionButton, right: 24 }}>
            👤 KHÁCH HÀNG
          </button>

          <button type="button" onClick={() => setMt5Open(true)} style={{ ...styles.actionButton, right: 190 }}>
            💻 MT5 / EA
          </button>

          <button type="button" onClick={() => setLinkOpen(true)} style={{ ...styles.actionButton, right: 330 }}>
            🔗 GẮN LICENSE
          </button>

          <CustomerManager open={customerOpen} onClose={() => setCustomerOpen(false)} />
          <MT5Manager open={mt5Open} onClose={() => setMt5Open(false)} />
          <LicenseLinkManager open={linkOpen} onClose={() => setLinkOpen(false)} />
        </>
      )}
    </>
  );
}

const styles = {
  actionButton: {
    position: "fixed",
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
