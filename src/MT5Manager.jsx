import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const EMPTY_MT5 = {
  id: null,
  customer_id: "",
  login: "",
  broker: "",
  server: "",
  account_type: "",
  symbol: "XAUUSDm",
  status: "active",
};

const panelStyle = {
  position: "fixed", inset: 0, zIndex: 10000,
  background: "rgba(2,6,23,.82)", backdropFilter: "blur(8px)",
  padding: 24, boxSizing: "border-box",
};
const cardStyle = {
  background: "#0b1220",
  border: "1px solid rgba(148,163,184,.16)",
  borderRadius: 20,
  boxShadow: "0 30px 90px rgba(0,0,0,.45)",
};
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", marginTop: 9,
  borderRadius: 11, border: "1px solid rgba(148,163,184,.18)",
  background: "#0f172a", color: "#f8fafc", outline: "none",
};

function MT5Manager({ open, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bots, setBots] = useState([]);
  const [form, setForm] = useState(EMPTY_MT5);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  async function loadData() {
    if (!supabase) return;
    try {
      const [c, l, a, b] = await Promise.all([
        supabase.from("customers").select("id,full_name").order("full_name"),
        supabase.from("licenses").select("id,customer_id,license_key,status,mt5_account_id,product").order("created_at", { ascending: false }),
        supabase.from("mt5_accounts").select("id,customer_id,login,mt5_login,broker,server,account_type,symbol,balance,equity,drawdown_percent,is_connected,last_seen_at,status,created_at,updated_at").order("created_at", { ascending: false }),
        supabase.from("bot_instances").select("id,mt5_account_id,ea_name,ea_version,enabled,status,last_seen,balance,equity,daily_profit,drawdown").order("created_at", { ascending: false }),
      ]);
      if (c.error) throw c.error;
      if (l.error) throw l.error;
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      setCustomers(c.data || []); setLicenses(l.data || []); setAccounts(a.data || []); setBots(b.data || []);
    } catch (e) {
      console.error("MT5 MANAGER LOAD:", e); setError(e?.message || "Không thể tải MT5.");
    }
  }

  useEffect(() => {
    if (!open || !supabase) return undefined;
    loadData();
    const channel = supabase.channel("gqx-mt5-manager-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "mt5_accounts" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_instances" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "licenses" }, loadData)
      .subscribe((status, err) => {
        console.log("[GQX] MT5 REALTIME:", status);
        if (err) console.error("[GQX] MT5 REALTIME ERROR:", err);
      });
    return () => supabase.removeChannel(channel);
  }, [open]);

  const customerMap = useMemo(() => new Map(customers.map((x) => [x.id, x.full_name])), [customers]);
  const licenseByAccount = useMemo(() => {
    const map = new Map();
    for (const l of licenses) if (l.mt5_account_id) map.set(l.mt5_account_id, l);
    return map;
  }, [licenses]);
  const botByAccount = useMemo(() => {
    const map = new Map();
    for (const b of bots) if (!map.has(b.mt5_account_id)) map.set(b.mt5_account_id, b);
    return map;
  }, [bots]);

  const filtered = accounts.filter((a) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return [a.login, a.mt5_login, a.broker, a.server, customerMap.get(a.customer_id)]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  function startEdit(account) {
    setError(""); setEditingId(account.id);
    setForm({
      id: account.id, customer_id: account.customer_id || "",
      login: String(account.mt5_login ?? account.login ?? ""),
      broker: account.broker || "", server: account.server || "",
      account_type: account.account_type || "", symbol: account.symbol || "XAUUSDm",
      status: account.status || "active",
    });
  }
  function cancelEdit() { setEditingId(null); setForm(EMPTY_MT5); }

  async function saveMT5(e) {
    e.preventDefault(); setSaving(true); setError("");
    try {
      if (!form.customer_id) throw new Error("Hãy chọn khách hàng.");
      if (!form.login.trim()) throw new Error("Hãy nhập MT5 Login.");

      // Broker / Server là tùy chọn. NULL/rỗng được phép lưu.
      const payload = {
        customer_id: form.customer_id,
        login: form.login.trim(),
        mt5_login: form.login.trim(),
        broker: form.broker.trim() || null,
        server: form.server.trim() || null,
        account_type: form.account_type.trim() || null,
        symbol: form.symbol.trim() || null,
        status: form.status || "active",
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error: updateError } = await supabase.from("mt5_accounts").update(payload).eq("id", editingId);
        if (updateError) throw updateError;
      } else {
        const { data, error: insertError } = await supabase.from("mt5_accounts").insert(payload).select("id").single();
        if (insertError) throw insertError;
        const customerLicenses = licenses.filter((l) => l.customer_id === form.customer_id && String(l.status).toLowerCase() === "active");
        if (data?.id && customerLicenses.length === 1 && !customerLicenses[0].mt5_account_id) {
          const { error: linkError } = await supabase.from("licenses").update({ mt5_account_id: data.id, updated_at: new Date().toISOString() }).eq("id", customerLicenses[0].id);
          if (linkError) console.warn("LICENSE LINK:", linkError.message);
        }
      }
      cancelEdit(); await loadData();
    } catch (e) {
      console.error("MT5 SAVE:", e); setError(e?.message || "Không thể lưu MT5 account.");
    } finally { setSaving(false); }
  }

  async function deleteMT5(account) {
    const login = account.mt5_login || account.login || "--";
    if (!window.confirm(`Xóa MT5 ${login}?\n\nLicense sẽ được gỡ liên kết trước. Bot record của MT5 này cũng sẽ được xóa.`)) return;
    setError("");
    try {
      const { error: unlinkError } = await supabase.from("licenses").update({ mt5_account_id: null, updated_at: new Date().toISOString() }).eq("mt5_account_id", account.id);
      if (unlinkError) throw unlinkError;
      const bot = botByAccount.get(account.id);
      if (bot) {
        const { error: botDeleteError } = await supabase.from("bot_instances").delete().eq("id", bot.id);
        if (botDeleteError) throw botDeleteError;
      }
      const { error: deleteError } = await supabase.from("mt5_accounts").delete().eq("id", account.id);
      if (deleteError) throw deleteError;
      if (editingId === account.id) cancelEdit();
      await loadData();
    } catch (e) {
      console.error("MT5 DELETE:", e); setError(e?.message || "Không thể xóa MT5 account.");
    }
  }

  async function toggleBot(bot) {
    if (!bot) return; setError("");
    try {
      const next = bot.enabled !== true;
      const { error: updateError } = await supabase.from("bot_instances").update({ enabled: next, updated_at: new Date().toISOString() }).eq("id", bot.id);
      if (updateError) throw updateError; await loadData();
    } catch (e) { console.error("BOT TOGGLE:", e); setError(e?.message || "Không thể bật/tắt EA."); }
  }

  async function toggleMT5Status(account) {
    setError("");
    try {
      const next = String(account.status).toLowerCase() === "active" ? "disabled" : "active";
      const { error: updateError } = await supabase.from("mt5_accounts").update({ status: next, updated_at: new Date().toISOString() }).eq("id", account.id);
      if (updateError) throw updateError; await loadData();
    } catch (e) { console.error("MT5 STATUS:", e); setError(e?.message || "Không thể đổi trạng thái MT5."); }
  }

  if (!open) return null;
  return (
    <div style={panelStyle}>
      <div style={{ ...cardStyle, width: "min(1320px,100%)", height: "min(860px,100%)", margin: "0 auto", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "22px 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid rgba(148,163,184,.12)", color: "#fff" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1.5, opacity: 0.6 }}>MT5 & EA MANAGEMENT</div>
            <h2 style={{ margin: "5px 0 2px", fontSize: 27 }}>Tài khoản MT5 & Bot</h2>
            <p style={{ margin: 0, opacity: 0.6 }}>Quản lý Login, License và EA realtime.</p>
          </div>
          <button onClick={onClose} style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,.04)", color: "#fff", border: "1px solid rgba(148,163,184,.18)", fontSize: 25 }}>×</button>
        </div>
        {error && <div style={{ margin: "12px 16px 0", padding: 10, borderRadius: 10, background: "rgba(239,68,68,.12)", color: "#fca5a5" }}>{error}</div>}
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "330px 1fr", gap: 16, padding: 16 }}>
          <form onSubmit={saveMT5} style={{ ...cardStyle, padding: 18, color: "#e5e7eb", overflow: "auto" }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.1, opacity: 0.75 }}>{editingId ? "SỬA MT5 ACCOUNT" : "THÊM MT5 ACCOUNT"}</div>
            <select value={form.customer_id} onChange={(e) => setForm((v) => ({ ...v, customer_id: e.target.value }))} style={inputStyle}>
              <option value="">-- Chọn khách hàng --</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
            <input style={inputStyle} placeholder="MT5 Login *" value={form.login} onChange={(e) => setForm((v) => ({ ...v, login: e.target.value }))} />
            <input style={inputStyle} placeholder="Broker (không bắt buộc)" value={form.broker} onChange={(e) => setForm((v) => ({ ...v, broker: e.target.value }))} />
            <input style={inputStyle} placeholder="Server (không bắt buộc)" value={form.server} onChange={(e) => setForm((v) => ({ ...v, server: e.target.value }))} />
            <input style={inputStyle} placeholder="Account Type" value={form.account_type} onChange={(e) => setForm((v) => ({ ...v, account_type: e.target.value }))} />
            <input style={inputStyle} placeholder="Symbol" value={form.symbol} onChange={(e) => setForm((v) => ({ ...v, symbol: e.target.value }))} />
            <select value={form.status} onChange={(e) => setForm((v) => ({ ...v, status: e.target.value }))} style={inputStyle}>
              <option value="active">ACTIVE</option><option value="disabled">DISABLED</option>
            </select>
            <div style={{ display: "flex", gap: 8, marginTop: 13 }}>
              <button type="submit" disabled={saving} style={{ flex: 1, padding: "12px 14px", border: 0, borderRadius: 12, background: "#2563eb", color: "white", fontWeight: 800 }}>{saving ? "ĐANG LƯU..." : editingId ? "LƯU THAY ĐỔI" : "THÊM MT5"}</button>
              {editingId && <button type="button" onClick={cancelEdit} style={{ padding: "12px 14px", borderRadius: 12, border: "1px solid rgba(148,163,184,.2)", background: "transparent", color: "#e5e7eb", fontWeight: 700 }}>HỦY</button>}
            </div>
            <div style={{ marginTop: 14, fontSize: 11, lineHeight: 1.5, opacity: 0.58 }}>Broker và Server là tùy chọn. Để trống sẽ lưu NULL và API sẽ bỏ qua kiểm tra hai trường này.</div>
          </form>

          <div style={{ ...cardStyle, padding: 18, minWidth: 0, minHeight: 0, color: "#e5e7eb", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div><div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1.1, opacity: 0.75 }}>MT5 ACCOUNTS ({filtered.length})</div><div style={{ fontSize: 11, opacity: 0.55, marginTop: 3 }}>🟢 Realtime</div></div>
              <input style={{ ...inputStyle, marginTop: 0, maxWidth: 300 }} placeholder="Tìm Login / khách / License" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div style={{ overflow: "auto", marginTop: 12 }}>
              {filtered.length === 0 ? <div style={{ padding: 30, textAlign: "center", opacity: 0.6 }}>Chưa có MT5 Account.</div> : filtered.map((a) => {
                const bot = botByAccount.get(a.id);
                const license = licenseByAccount.get(a.id);
                const connected = a.is_connected === true;
                const enabled = bot?.enabled === true;
                return (
                  <div key={a.id} style={{ padding: 15, marginBottom: 10, borderRadius: 14, background: "rgba(15,23,42,.65)", border: "1px solid rgba(148,163,184,.1)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr auto", gap: 12, alignItems: "center" }}>
                      <div><strong>{a.mt5_login || a.login}</strong><div style={{ fontSize: 11, opacity: 0.62 }}>{customerMap.get(a.customer_id) || "Chưa gắn khách"}</div></div>
                      <div style={{ fontSize: 12 }}><div>{a.broker || "--"}</div><div style={{ opacity: 0.55 }}>{a.server || "--"}</div></div>
                      <div style={{ fontSize: 11 }}><div>License: {license?.license_key || "--"}</div><div>EA: {bot?.ea_name || "Chưa có bot"}</div></div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 7 }}><span style={{ padding: "5px 9px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: connected ? "rgba(34,197,94,.12)" : "rgba(239,68,68,.12)", color: connected ? "#4ade80" : "#f87171" }}>{connected ? "CONNECTED" : "DISCONNECTED"}</span><span style={{ fontSize: 10, opacity: 0.55 }}>is_connected: {String(connected)}</span></div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginTop: 12 }}>
                      <Metric label="BALANCE" value={a.balance} />
                      <Metric label="EQUITY" value={a.equity} />
                      <Metric label="DD" value={a.drawdown_percent == null ? "--" : `${Number(a.drawdown_percent).toFixed(2)}%`} />
                      <Metric label="LAST SEEN" value={a.last_seen_at ? new Date(a.last_seen_at).toLocaleString("vi-VN") : "--"} />
                      <Metric label="BOT" value={bot ? (enabled ? "RUNNING" : "PAUSED") : "--"} />
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      {bot && <button onClick={() => toggleBot(bot)} style={{ padding: "8px 12px", borderRadius: 10, border: 0, background: enabled ? "#92400e" : "#166534", color: "white", fontWeight: 800 }}>{enabled ? "TẮT EA" : "BẬT EA"}</button>}
                      <button onClick={() => startEdit(a)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(59,130,246,.35)", background: "rgba(37,99,235,.12)", color: "#93c5fd", fontWeight: 800 }}>SỬA MT5</button>
                      <button onClick={() => toggleMT5Status(a)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(148,163,184,.2)", background: "transparent", color: "#e5e7eb", fontWeight: 700 }}>{String(a.status).toLowerCase() === "active" ? "TẮT MT5" : "BẬT MT5"}</button>
                      <button onClick={() => deleteMT5(a)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid rgba(239,68,68,.3)", background: "rgba(127,29,29,.18)", color: "#fca5a5", fontWeight: 800 }}>XÓA MT5</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return <div style={{ padding: 9, borderRadius: 10, background: "rgba(255,255,255,.03)" }}><div style={{ fontSize: 9, opacity: 0.48 }}>{label}</div><strong style={{ fontSize: 12 }}>{value ?? "--"}</strong></div>;
}

export default MT5Manager;
