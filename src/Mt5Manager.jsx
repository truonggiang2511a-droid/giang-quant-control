import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const EMPTY_FORM = {
  customer_id: "",
  login: "",
  mt5_login: "",
  broker: "",
  server: "",
  account_type: "",
  symbol: "XAUUSDm",
  status: "active",
};

function Mt5Manager({ open, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [bots, setBots] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadAll() {
    if (!supabase) {
      setError("Supabase chưa được cấu hình.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [customerResult, accountResult, botResult] = await Promise.all([
        supabase
          .from("customers")
          .select("id, full_name, phone")
          .order("full_name", { ascending: true }),
        supabase
          .from("mt5_accounts")
          .select(
            "id, customer_id, login, mt5_login, broker, server, account_type, symbol, balance, equity, drawdown_percent, is_connected, last_seen_at, created_at, updated_at, status"
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("bot_instances")
          .select("id, mt5_account_id, ea_name, ea_version, enabled, status, last_seen, balance, equity, daily_profit, drawdown")
          .order("created_at", { ascending: false }),
      ]);

      if (customerResult.error) throw customerResult.error;
      if (accountResult.error) throw accountResult.error;
      if (botResult.error) throw botResult.error;

      setCustomers(customerResult.data || []);
      setAccounts(accountResult.data || []);
      setBots(botResult.data || []);
    } catch (err) {
      console.error("MT5 MANAGER LOAD ERROR:", err);
      setError(err?.message || "Không thể tải MT5 accounts.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !supabase) return undefined;

    loadAll();

    const channel = supabase
      .channel("gqx-mt5-manager-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "mt5_accounts" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_instances" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, loadAll)
      .subscribe((status, channelError) => {
        console.log("[GQX] MT5 REALTIME:", status);
        if (channelError) console.error("[GQX] MT5 REALTIME ERROR:", channelError);
      });

    return () => supabase.removeChannel(channel);
  }, [open]);

  const customerMap = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers]
  );

  const botMap = useMemo(
    () => new Map(bots.map((bot) => [bot.mt5_account_id, bot])),
    [bots]
  );

  const filteredAccounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accounts;

    return accounts.filter((account) => {
      const customer = customerMap.get(account.customer_id);
      const bot = botMap.get(account.id);
      return [
        account.login,
        account.mt5_login,
        account.broker,
        account.server,
        account.account_type,
        account.symbol,
        account.status,
        customer?.full_name,
        bot?.ea_name,
        bot?.ea_version,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [accounts, search, customerMap, botMap]);

  async function saveAccount(event) {
    event.preventDefault();

    const login = (form.mt5_login || form.login).trim();
    if (!login) {
      setError("Vui lòng nhập MT5 Login.");
      return;
    }

    if (!form.customer_id) {
      setError("Vui lòng chọn khách hàng.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        customer_id: form.customer_id,
        login,
        mt5_login: login,
        broker: form.broker.trim() || null,
        server: form.server.trim() || null,
        account_type: form.account_type.trim() || null,
        symbol: form.symbol.trim() || null,
        status: form.status || "active",
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error: updateError } = await supabase
          .from("mt5_accounts")
          .update(payload)
          .eq("id", editingId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("mt5_accounts")
          .insert(payload);
        if (insertError) throw insertError;
      }

      setForm(EMPTY_FORM);
      setEditingId(null);
      await loadAll();
    } catch (err) {
      console.error("MT5 SAVE ERROR:", err);
      setError(err?.message || "Không thể lưu MT5 account.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(account) {
    setEditingId(account.id);
    setForm({
      customer_id: account.customer_id || "",
      login: account.login || account.mt5_login || "",
      mt5_login: account.mt5_login || account.login || "",
      broker: account.broker || "",
      server: account.server || "",
      account_type: account.account_type || "",
      symbol: account.symbol || "XAUUSDm",
      status: account.status || "active",
    });
  }

  async function toggleBot(account) {
    const bot = botMap.get(account.id);
    if (!bot) {
      setError("Tài khoản này chưa có bot_instance để bật/tắt.");
      return;
    }

    setError("");

    try {
      const nextEnabled = bot.enabled !== true;
      const { error: updateError } = await supabase
        .from("bot_instances")
        .update({
          enabled: nextEnabled,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bot.id);

      if (updateError) throw updateError;
      await loadAll();
    } catch (err) {
      console.error("BOT TOGGLE ERROR:", err);
      setError(err?.message || "Không thể bật/tắt bot.");
    }
  }

  if (!open) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>MT5 MANAGEMENT</div>
            <h2 style={styles.title}>MT5 Accounts</h2>
            <p style={styles.subtitle}>
              Quản lý Login, Broker, Server và bật/tắt EA trực tiếp từ Dashboard.
            </p>
          </div>
          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.body}>
          <form onSubmit={saveAccount} style={styles.formCard}>
            <div style={styles.formTitle}>
              {editingId ? "SỬA MT5 ACCOUNT" : "THÊM MT5 ACCOUNT"}
            </div>

            <select
              style={styles.input}
              value={form.customer_id}
              onChange={(event) =>
                setForm((value) => ({ ...value, customer_id: event.target.value }))
              }
            >
              <option value="">-- Chọn khách hàng --</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.full_name} {customer.phone ? `· ${customer.phone}` : ""}
                </option>
              ))}
            </select>

            <input
              style={styles.input}
              placeholder="MT5 Login *"
              value={form.mt5_login}
              onChange={(event) =>
                setForm((value) => ({ ...value, mt5_login: event.target.value, login: event.target.value }))
              }
            />

            <input
              style={styles.input}
              placeholder="Broker"
              value={form.broker}
              onChange={(event) =>
                setForm((value) => ({ ...value, broker: event.target.value }))
              }
            />

            <input
              style={styles.input}
              placeholder="Server"
              value={form.server}
              onChange={(event) =>
                setForm((value) => ({ ...value, server: event.target.value }))
              }
            />

            <input
              style={styles.input}
              placeholder="Account Type (Cent/Standard/...)"
              value={form.account_type}
              onChange={(event) =>
                setForm((value) => ({ ...value, account_type: event.target.value }))
              }
            />

            <input
              style={styles.input}
              placeholder="Symbol"
              value={form.symbol}
              onChange={(event) =>
                setForm((value) => ({ ...value, symbol: event.target.value }))
              }
            />

            <select
              style={styles.input}
              value={form.status}
              onChange={(event) =>
                setForm((value) => ({ ...value, status: event.target.value }))
              }
            >
              <option value="active">ACTIVE</option>
              <option value="disabled">DISABLED</option>
              <option value="pending">PENDING</option>
            </select>

            <div style={styles.actions}>
              <button disabled={saving} style={styles.primaryButton}>
                {saving ? "ĐANG LƯU..." : editingId ? "LƯU THAY ĐỔI" : "THÊM MT5"}
              </button>
              {editingId && (
                <button
                  type="button"
                  style={styles.secondaryButton}
                  onClick={() => {
                    setEditingId(null);
                    setForm(EMPTY_FORM);
                  }}
                >
                  HỦY
                </button>
              )}
            </div>
          </form>

          <div style={styles.listCard}>
            <div style={styles.listHeader}>
              <div>
                <div style={styles.formTitle}>MT5 ACCOUNTS ({filteredAccounts.length})</div>
                <div style={styles.helperText}>🟢 Realtime · dữ liệu EA tự cập nhật</div>
              </div>
              <input
                style={{ ...styles.input, maxWidth: 290, marginTop: 0 }}
                placeholder="Tìm Login / Broker / Server / khách..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>

            {loading ? (
              <div style={styles.empty}>Đang tải MT5...</div>
            ) : filteredAccounts.length === 0 ? (
              <div style={styles.empty}>Chưa có MT5 account.</div>
            ) : (
              <div style={styles.accountList}>
                {filteredAccounts.map((account) => {
                  const customer = customerMap.get(account.customer_id);
                  const bot = botMap.get(account.id);
                  const botOn = bot?.enabled === true;

                  return (
                    <div key={account.id} style={styles.accountCard}>
                      <div style={styles.accountMain}>
                        <div style={styles.nameRow}>
                          <strong>MT5 {account.mt5_login || account.login || "--"}</strong>
                          <span style={{ ...styles.badge, ...(account.status === "active" ? styles.badgeGreen : styles.badgeGray) }}>
                            {String(account.status || "--").toUpperCase()}
                          </span>
                        </div>

                        <div style={styles.metaGrid}>
                          <span>👤 {customer?.full_name || "Chưa gắn khách"}</span>
                          <span>🏦 {account.broker || "--"}</span>
                          <span>🖥️ {account.server || "--"}</span>
                          <span>📦 {account.account_type || "--"}</span>
                          <span>🪙 {account.symbol || "--"}</span>
                          <span>🔗 Connected: {String(account.is_connected === true)}</span>
                        </div>

                        <div style={styles.telemetry}>
                          <span>Balance: <b>{Number(account.balance || bot?.balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</b></span>
                          <span>Equity: <b>{Number(account.equity || bot?.equity || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</b></span>
                          <span>DD: <b>{Number(account.drawdown_percent ?? bot?.drawdown ?? 0).toFixed(2)}%</b></span>
                          <span>Last seen: <b>{account.last_seen_at ? new Date(account.last_seen_at).toLocaleString("vi-VN") : bot?.last_seen ? new Date(bot.last_seen).toLocaleString("vi-VN") : "--"}</b></span>
                        </div>
                      </div>

                      <div style={styles.controls}>
                        <div style={{ ...styles.switchLabel, color: bot ? (botOn ? "#4ade80" : "#f87171") : "#94a3b8" }}>
                          BOT {bot ? String(botOn) : "N/A"}
                        </div>
                        <button
                          style={{ ...styles.toggleButton, ...(botOn ? styles.toggleOn : styles.toggleOff) }}
                          onClick={() => toggleBot(account)}
                          disabled={!bot}
                        >
                          {botOn ? "TẮT EA" : "BẬT EA"}
                        </button>
                        <button style={styles.editButton} onClick={() => startEdit(account)}>
                          SỬA MT5
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: { position: "fixed", inset: 0, zIndex: 10000, background: "rgba(3,7,18,.78)", backdropFilter: "blur(8px)", padding: 24, boxSizing: "border-box" },
  panel: { width: "min(1320px,100%)", height: "min(860px,100%)", margin: "0 auto", background: "#0b1220", border: "1px solid rgba(148,163,184,.18)", borderRadius: 22, boxShadow: "0 30px 90px rgba(0,0,0,.45)", display: "flex", flexDirection: "column", overflow: "hidden", color: "#e5e7eb" },
  header: { padding: "22px 24px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid rgba(148,163,184,.12)" },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, opacity: .6 },
  title: { margin: "5px 0 2px", fontSize: 28 },
  subtitle: { margin: 0, opacity: .65 },
  closeButton: { width: 40, height: 40, borderRadius: 12, border: "1px solid rgba(148,163,184,.2)", background: "rgba(255,255,255,.04)", color: "white", fontSize: 26, cursor: "pointer" },
  body: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "330px 1fr", gap: 16, padding: 16 },
  formCard: { padding: 18, borderRadius: 18, background: "rgba(255,255,255,.035)", border: "1px solid rgba(148,163,184,.1)", overflow: "auto" },
  listCard: { minWidth: 0, minHeight: 0, padding: 18, borderRadius: 18, background: "rgba(255,255,255,.035)", border: "1px solid rgba(148,163,184,.1)", overflow: "hidden", display: "flex", flexDirection: "column" },
  formTitle: { fontSize: 12, fontWeight: 700, letterSpacing: 1.1, opacity: .75 },
  helperText: { fontSize: 11, opacity: .55, marginTop: 4 },
  input: { width: "100%", boxSizing: "border-box", marginTop: 11, padding: "12px 13px", borderRadius: 12, border: "1px solid rgba(148,163,184,.16)", background: "rgba(15,23,42,.8)", color: "#f8fafc", outline: "none" },
  actions: { display: "flex", gap: 8, marginTop: 14 },
  primaryButton: { flex: 1, border: 0, borderRadius: 12, padding: "12px 14px", background: "#2563eb", color: "white", fontWeight: 700, cursor: "pointer" },
  secondaryButton: { border: "1px solid rgba(148,163,184,.18)", borderRadius: 12, padding: "12px 14px", background: "transparent", color: "#e5e7eb", cursor: "pointer" },
  listHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  accountList: { overflow: "auto", marginTop: 12, paddingRight: 4 },
  accountCard: { display: "flex", justifyContent: "space-between", gap: 16, padding: 15, borderRadius: 14, background: "rgba(15,23,42,.62)", border: "1px solid rgba(148,163,184,.1)", marginBottom: 10 },
  accountMain: { minWidth: 0, display: "flex", flexDirection: "column", gap: 8 },
  nameRow: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" },
  metaGrid: { display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6, fontSize: 11, opacity: .8 },
  telemetry: { display: "flex", flexWrap: "wrap", gap: 12, fontSize: 11, opacity: .8 },
  controls: { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, minWidth: 110 },
  switchLabel: { fontSize: 10, fontWeight: 800, textAlign: "center" },
  toggleButton: { border: 0, borderRadius: 10, padding: "10px 12px", color: "white", fontWeight: 800, cursor: "pointer" },
  toggleOn: { background: "#dc2626" },
  toggleOff: { background: "#16a34a" },
  editButton: { border: "1px solid rgba(148,163,184,.18)", borderRadius: 9, background: "transparent", color: "#e5e7eb", padding: "8px 10px", cursor: "pointer" },
  badge: { padding: "5px 9px", borderRadius: 999, fontSize: 10, fontWeight: 800 },
  badgeGreen: { background: "rgba(34,197,94,.12)", color: "#4ade80" },
  badgeGray: { background: "rgba(148,163,184,.1)", color: "#cbd5e1" },
  empty: { padding: 30, textAlign: "center", opacity: .6 },
  error: { margin: "12px 16px 0", padding: "10px 12px", borderRadius: 10, background: "rgba(239,68,68,.12)", color: "#fca5a5" },
};

export default Mt5Manager;
