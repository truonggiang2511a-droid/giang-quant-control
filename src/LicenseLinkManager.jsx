import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";

const ROOT_LICENSE_KEY = "GQX-TEST-001";

export default function LicenseLinkManager({ open, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [license, setLicense] = useState(null);
  const [customerId, setCustomerId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [status, setStatus] = useState("active");
  const [expireDate, setExpireDate] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData() {
    if (!supabase) return;
    try {
      const [c, a, l] = await Promise.all([
        supabase.from("customers").select("id,full_name").order("full_name"),
        supabase.from("mt5_accounts").select("id,customer_id,login,mt5_login,broker,server,status,is_connected,last_seen_at").order("created_at", { ascending: false }),
        supabase.from("licenses").select("id,customer_id,license_key,status,expire_date,expiry_date,product").eq("license_key", ROOT_LICENSE_KEY).maybeSingle(),
      ]);
      if (c.error) throw c.error;
      if (a.error) throw a.error;
      if (l.error) throw l.error;
      setCustomers(c.data || []);
      setAccounts(a.data || []);
      setLicense(l.data || null);
      setStatus(l.data?.status || "active");
      setExpireDate(l.data?.expire_date || l.data?.expiry_date || "");
    } catch (e) {
      setError(e?.message || "Không thể tải dữ liệu.");
    }
  }

  useEffect(() => {
    if (!open || !supabase) return undefined;
    loadData();
    const channel = supabase
      .channel("gqx-root-license-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "licenses" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "mt5_accounts" }, loadData)
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, loadData)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [open]);

  const customerAccounts = accounts.filter((a) => !customerId || a.customer_id === customerId);

  async function saveRootLicense() {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      if (!license) {
        const { data, error: insertError } = await supabase
          .from("licenses")
          .insert({
            license_key: ROOT_LICENSE_KEY,
            customer_id: null,
            mt5_account_id: null,
            status,
            expire_date: expireDate || null,
            product: "GIANG QUANT X",
          })
          .select()
          .single();
        if (insertError) throw insertError;
        setLicense(data);
        setMessage("✅ Đã tạo License gốc GQX-TEST-001.");
      } else {
        const { data, error: updateError } = await supabase
          .from("licenses")
          .update({
            status,
            expire_date: expireDate || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", license.id)
          .select()
          .single();
        if (updateError) throw updateError;
        setLicense(data);
        setMessage("✅ Đã cập nhật License gốc.");
      }
      await loadData();
    } catch (e) {
      setError(e?.message || "Không thể lưu License gốc.");
    } finally {
      setSaving(false);
    }
  }

  async function assignAccount() {
    setError("");
    setMessage("");
    if (!license) return setError("Hãy lưu License gốc trước.");
    if (!customerId) return setError("Chọn khách hàng.");
    if (!accountId) return setError("Chọn MT5 Account.");

    const account = accounts.find((a) => a.id === accountId);
    if (!account) return setError("MT5 Account không tồn tại.");
    if (account.customer_id !== customerId) return setError("MT5 không thuộc khách hàng đã chọn.");

    setSaving(true);
    try {
      // Root-license mode: do not bind the single license row to a customer/account.
      // Authorization is based on the MT5 account being registered and customer ownership.
      const { error: accountError } = await supabase
        .from("mt5_accounts")
        .update({ status: "active", updated_at: new Date().toISOString() })
        .eq("id", account.id);
      if (accountError) throw accountError;

      setMessage(`✅ MT5 ${account.mt5_login || account.login} của khách đã sẵn sàng dùng ${ROOT_LICENSE_KEY}.`);
      setCustomerId("");
      setAccountId("");
      await loadData();
    } catch (e) {
      setError(e?.message || "Không thể cấp quyền MT5.");
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
            <div style={styles.eyebrow}>ROOT LICENSE</div>
            <h2 style={styles.title}>GQX-TEST-001</h2>
            <p style={styles.subtitle}>Dùng một License gốc; quyền chạy được quản lý theo Customer + MT5.</p>
          </div>
          <button style={styles.close} onClick={onClose}>×</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {message && <div style={styles.success}>{message}</div>}

        <div style={styles.body}>
          <div style={styles.card}>
            <div style={styles.badge}>🔑 {ROOT_LICENSE_KEY}</div>

            <label style={styles.label}>TRẠNG THÁI LICENSE</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={styles.input}>
              <option value="active">ACTIVE</option>
              <option value="disabled">DISABLED</option>
            </select>

            <label style={styles.label}>NGÀY HẾT HẠN</label>
            <input type="date" value={expireDate} onChange={(e) => setExpireDate(e.target.value)} style={styles.input} />

            <button disabled={saving} onClick={saveRootLicense} style={styles.primary}>
              {saving ? "ĐANG LƯU..." : license ? "CẬP NHẬT LICENSE GỐC" : "TẠO LICENSE GỐC"}
            </button>

            <div style={styles.note}>
              Không có Auto License trong phiên bản này. Tất cả EA dùng key gốc {ROOT_LICENSE_KEY}.
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.sectionTitle}>CẤP QUYỀN MT5</div>
            <p style={styles.note}>Chọn Customer và MT5 đã đăng ký. EA sẽ xác thực bằng MT5 Login + Customer ID.</p>

            <label style={styles.label}>KHÁCH HÀNG</label>
            <select value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAccountId(""); }} style={styles.input}>
              <option value="">-- Chọn khách hàng --</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>

            <label style={styles.label}>MT5 ACCOUNT</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} disabled={!customerId} style={styles.input}>
              <option value="">-- Chọn MT5 --</option>
              {customerAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.mt5_login || a.login} · {a.broker || "NULL"} · {a.server || "NULL"}
                </option>
              ))}
            </select>

            <button disabled={saving || !customerId || !accountId} onClick={assignAccount} style={styles.primary}>
              {saving ? "ĐANG CẤP..." : "CẤP QUYỀN MT5"}
            </button>

            <div style={styles.tableWrap}>
              <div style={styles.sectionTitle}>MT5 ĐÃ CẤP QUYỀN</div>
              {accounts.filter((a) => a.status === "active").map((a) => {
                const c = customers.find((x) => x.id === a.customer_id);
                return (
                  <div key={a.id} style={styles.row}>
                    <div><strong>{c?.full_name || "--"}</strong><div style={styles.sub}>Customer {a.customer_id || "--"}</div></div>
                    <div><strong>MT5 {a.mt5_login || a.login || "--"}</strong><div style={styles.sub}>{a.broker || "NULL"} · {a.server || "NULL"}</div></div>
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

const styles = {
  backdrop: { position: "fixed", inset: 0, zIndex: 11000, background: "rgba(3,7,18,.78)", backdropFilter: "blur(8px)", padding: 24 },
  panel: { width: "min(1100px,100%)", height: "min(760px,100%)", margin: "0 auto", background: "#0b1220", border: "1px solid rgba(148,163,184,.18)", borderRadius: 22, color: "#e5e7eb", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "22px 24px", borderBottom: "1px solid rgba(148,163,184,.12)", display: "flex", justifyContent: "space-between" },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, opacity: .6 },
  title: { margin: "5px 0 2px", fontSize: 28 },
  subtitle: { margin: 0, opacity: .6 },
  close: { width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,.04)", color: "white", border: "1px solid rgba(148,163,184,.18)", fontSize: 25 },
  body: { flex: 1, display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, padding: 16, minHeight: 0, overflow: "auto" },
  card: { padding: 18, background: "rgba(255,255,255,.035)", border: "1px solid rgba(148,163,184,.1)", borderRadius: 18 },
  badge: { display: "inline-block", padding: "9px 12px", borderRadius: 10, background: "rgba(99,102,241,.12)", color: "#c7d2fe", fontWeight: 900 },
  sectionTitle: { fontSize: 12, fontWeight: 800, letterSpacing: 1.1, opacity: .8, marginBottom: 10 },
  label: { display: "block", marginTop: 13, fontSize: 10, fontWeight: 800, letterSpacing: 1, opacity: .65 },
  input: { width: "100%", boxSizing: "border-box", marginTop: 8, padding: "12px 13px", borderRadius: 12, border: "1px solid rgba(148,163,184,.16)", background: "#0f172a", color: "#f8fafc" },
  primary: { width: "100%", marginTop: 16, padding: "12px 14px", border: 0, borderRadius: 12, background: "#2563eb", color: "white", fontWeight: 800 },
  note: { marginTop: 12, fontSize: 12, lineHeight: 1.55, opacity: .65 },
  tableWrap: { marginTop: 22, maxHeight: 390, overflow: "auto" },
  row: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "center", padding: 12, marginBottom: 8, borderRadius: 12, background: "rgba(15,23,42,.65)", border: "1px solid rgba(148,163,184,.1)" },
  sub: { fontSize: 11, opacity: .55, marginTop: 3 },
  error: { margin: "12px 16px 0", padding: 10, borderRadius: 10, background: "rgba(239,68,68,.12)", color: "#fca5a5" },
  success: { margin: "12px 16px 0", padding: 10, borderRadius: 10, background: "rgba(34,197,94,.12)", color: "#86efac" },
};
