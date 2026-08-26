import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

export default function LicenseLinkManager({ open, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [customerId, setCustomerId] = useState("");
  const [licenseId, setLicenseId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData() {
    if (!supabase) return;
    try {
      const [c, l, a] = await Promise.all([
        supabase.from("customers").select("id,full_name").order("full_name"),
        supabase.from("licenses").select("id,customer_id,license_key,status,mt5_account_id,product,expire_date,expiry_date").order("created_at", { ascending: false }),
        supabase.from("mt5_accounts").select("id,customer_id,login,mt5_login,broker,server,status").order("created_at", { ascending: false }),
      ]);
      if (c.error) throw c.error;
      if (l.error) throw l.error;
      if (a.error) throw a.error;
      setCustomers(c.data || []);
      setLicenses(l.data || []);
      setAccounts(a.data || []);
    } catch (e) {
      setError(e?.message || "Không thể tải dữ liệu.");
    }
  }

  useEffect(() => {
    if (!open || !supabase) return undefined;
    loadData();
    const channel = supabase
      .channel("gqx-license-link-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "licenses" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "mt5_accounts" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, loadData)
      .subscribe((status, err) => {
        console.log("[GQX] LICENSE LINK REALTIME:", status);
        if (err) console.error("[GQX] LICENSE LINK REALTIME ERROR:", err);
      });
    return () => supabase.removeChannel(channel);
  }, [open]);

  const customerLicenses = useMemo(
    () => licenses.filter((x) => !customerId || x.customer_id === customerId),
    [licenses, customerId]
  );

  const customerAccounts = useMemo(
    () => accounts.filter((x) => !customerId || x.customer_id === customerId),
    [accounts, customerId]
  );

  async function attach() {
    setError("");
    setMessage("");
    if (!licenseId) return setError("Chọn License.");
    if (!accountId) return setError("Chọn MT5 Account.");

    const license = licenses.find((x) => x.id === licenseId);
    const account = accounts.find((x) => x.id === accountId);
    if (!license || !account) return setError("License hoặc MT5 không tồn tại.");

    if (license.customer_id && account.customer_id && license.customer_id !== account.customer_id) {
      return setError("License và MT5 đang thuộc 2 khách hàng khác nhau.");
    }

    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("licenses")
        .update({
          customer_id: account.customer_id || license.customer_id,
          mt5_account_id: account.id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", license.id);
      if (updateError) throw updateError;
      setMessage(`✅ Đã gắn ${license.license_key} → MT5 ${account.mt5_login || account.login}.`);
      await loadData();
    } catch (e) {
      setError(e?.message || "Không thể gắn License với MT5.");
    } finally {
      setSaving(false);
    }
  }

  async function detach(license) {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const { error: updateError } = await supabase
        .from("licenses")
        .update({ mt5_account_id: null, updated_at: new Date().toISOString() })
        .eq("id", license.id);
      if (updateError) throw updateError;
      setMessage(`✅ Đã bỏ liên kết ${license.license_key}.`);
      await loadData();
    } catch (e) {
      setError(e?.message || "Không thể bỏ liên kết.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>LICENSE LINKING</div>
            <h2 style={styles.title}>Gắn License ↔ MT5</h2>
            <p style={styles.subtitle}>Chọn khách → License → MT5, sau đó lưu.</p>
          </div>
          <button style={styles.close} onClick={onClose}>×</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {message && <div style={styles.success}>{message}</div>}

        <div style={styles.body}>
          <div style={styles.card}>
            <label style={styles.label}>KHÁCH HÀNG</label>
            <select style={styles.input} value={customerId} onChange={(e) => { setCustomerId(e.target.value); setLicenseId(""); setAccountId(""); }}>
              <option value="">-- Chọn khách hàng --</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>

            <label style={styles.label}>LICENSE</label>
            <select style={styles.input} value={licenseId} onChange={(e) => setLicenseId(e.target.value)} disabled={!customerId}>
              <option value="">-- Chọn License --</option>
              {customerLicenses.map((l) => <option key={l.id} value={l.id}>{l.license_key} · {String(l.status || "").toUpperCase()} {l.mt5_account_id ? "· ĐÃ GẮN" : ""}</option>)}
            </select>

            <label style={styles.label}>MT5 ACCOUNT</label>
            <select style={styles.input} value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!customerId}>
              <option value="">-- Chọn MT5 --</option>
              {customerAccounts.map((a) => <option key={a.id} value={a.id}>{a.mt5_login || a.login} · {a.broker || "--"} · {a.server || "--"}</option>)}
            </select>

            <button style={styles.primary} disabled={saving || !customerId || !licenseId || !accountId} onClick={attach}>
              {saving ? "ĐANG LƯU..." : "GẮN LICENSE → MT5"}
            </button>
          </div>

          <div style={styles.list}>
            <div style={styles.listTitle}>LIÊN KẾT HIỆN TẠI</div>
            {licenses.filter((l) => l.mt5_account_id).map((l) => {
              const a = accounts.find((x) => x.id === l.mt5_account_id);
              const c = customers.find((x) => x.id === l.customer_id);
              return (
                <div key={l.id} style={styles.row}>
                  <div>
                    <strong>🔑 {l.license_key}</strong>
                    <div style={styles.sub}>{c?.full_name || "--"} · {l.product || "GIANG QUANT X"}</div>
                  </div>
                  <div>
                    <strong>MT5 {a?.mt5_login || a?.login || "--"}</strong>
                    <div style={styles.sub}>{a?.broker || "--"} · {a?.server || "--"}</div>
                  </div>
                  <button style={styles.detach} disabled={saving} onClick={() => detach(l)}>BỎ GẮN</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: { position: "fixed", inset: 0, zIndex: 11000, background: "rgba(3,7,18,.78)", backdropFilter: "blur(8px)", padding: 24 },
  panel: { width: "min(1100px,100%)", height: "min(760px,100%)", margin: "0 auto", background: "#0b1220", border: "1px solid rgba(148,163,184,.18)", borderRadius: 22, color: "#e5e7eb", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "22px 24px", borderBottom: "1px solid rgba(148,163,184,.12)", display: "flex", justifyContent: "space-between" },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, opacity: .6 },
  title: { margin: "5px 0 2px", fontSize: 28 },
  subtitle: { margin: 0, opacity: .6 },
  close: { width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,.04)", color: "white", border: "1px solid rgba(148,163,184,.18)", fontSize: 25 },
  body: { flex: 1, display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, padding: 16, minHeight: 0 },
  card: { padding: 18, background: "rgba(255,255,255,.035)", border: "1px solid rgba(148,163,184,.1)", borderRadius: 18 },
  list: { padding: 18, overflow: "auto", background: "rgba(255,255,255,.035)", border: "1px solid rgba(148,163,184,.1)", borderRadius: 18 },
  label: { display: "block", marginTop: 13, fontSize: 10, fontWeight: 800, letterSpacing: 1, opacity: .65 },
  input: { width: "100%", boxSizing: "border-box", marginTop: 8, padding: "12px 13px", borderRadius: 12, border: "1px solid rgba(148,163,184,.16)", background: "#0f172a", color: "#f8fafc" },
  primary: { width: "100%", marginTop: 16, padding: "12px 14px", border: 0, borderRadius: 12, background: "#2563eb", color: "white", fontWeight: 800 },
  listTitle: { fontSize: 12, fontWeight: 800, letterSpacing: 1.1, opacity: .75, marginBottom: 10 },
  row: { display: "grid", gridTemplateColumns: "1.2fr 1fr auto", gap: 12, alignItems: "center", padding: 14, marginBottom: 9, borderRadius: 13, background: "rgba(15,23,42,.65)", border: "1px solid rgba(148,163,184,.1)" },
  sub: { fontSize: 11, opacity: .55, marginTop: 3 },
  detach: { border: "1px solid rgba(239,68,68,.25)", background: "rgba(239,68,68,.08)", color: "#fca5a5", padding: "8px 10px", borderRadius: 9 },
  error: { margin: "12px 16px 0", padding: 10, borderRadius: 10, background: "rgba(239,68,68,.12)", color: "#fca5a5" },
  success: { margin: "12px 16px 0", padding: 10, borderRadius: 10, background: "rgba(34,197,94,.12)", color: "#86efac" },
};
