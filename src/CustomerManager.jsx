import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const EMPTY_CUSTOMER = {
  full_name: "",
  phone: "",
  email: "",
  note: "",
  status: "active",
};

const EMPTY_LICENSE = {
  license_key: "",
  status: "active",
  expire_date: "",
  max_accounts: 1,
  product: "GIANG QUANT X",
};

function generateLicenseKey() {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `GQX-${year}-${random}`;
}

async function createUniqueLicenseKey() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const key = generateLicenseKey();
    const { data, error } = await supabase
      .from("licenses")
      .select("id")
      .eq("license_key", key)
      .maybeSingle();

    if (error) throw error;
    if (!data) return key;
  }

  throw new Error("Không thể tạo License Key duy nhất. Vui lòng thử lại.");
}

export default function CustomerManager({ open, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [mt5Accounts, setMt5Accounts] = useState([]);
  const [bots, setBots] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [savingLicense, setSavingLicense] = useState(false);
  const [deletingCustomerId, setDeletingCustomerId] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [customerForm, setCustomerForm] = useState(EMPTY_CUSTOMER);
  const [licenseForm, setLicenseForm] = useState(EMPTY_LICENSE);
  const [editingCustomerId, setEditingCustomerId] = useState(null);

  async function loadAll() {
    if (!supabase) {
      setError("Supabase chưa được cấu hình.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const [customerResult, licenseResult, mt5Result, botResult] = await Promise.all([
        supabase
          .from("customers")
          .select("id, full_name, phone, email, note, status, created_at, updated_at")
          .order("created_at", { ascending: false }),
        supabase
          .from("licenses")
          .select("id, customer_id, bot_id, license_key, status, expiry_date, max_accounts, created_at, updated_at, mt5_account_id, expire_date, product")
          .order("created_at", { ascending: false }),
        supabase
          .from("mt5_accounts")
          .select("id, customer_id, mt5_login, login, broker, server, status, is_connected, last_seen_at, balance, equity, drawdown_percent")
          .order("mt5_login", { ascending: true }),
        supabase
          .from("bot_instances")
          .select("id, mt5_account_id, ea_name, ea_version, symbol, timeframe, status, enabled, last_seen, balance, equity, daily_profit, drawdown")
          .order("created_at", { ascending: false }),
      ]);

      if (customerResult.error) throw customerResult.error;
      if (licenseResult.error) throw licenseResult.error;
      if (mt5Result.error) throw mt5Result.error;
      if (botResult.error) throw botResult.error;

      setCustomers(customerResult.data || []);
      setLicenses(licenseResult.data || []);
      setMt5Accounts(mt5Result.data || []);
      setBots(botResult.data || []);
    } catch (err) {
      console.error("CUSTOMER CENTER LOAD ERROR:", err);
      setError(err?.message || "Không thể tải dữ liệu khách hàng.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open || !supabase) return undefined;

    loadAll();

    const channel = supabase
      .channel("gqx-customer-center-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "customers" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "licenses" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "mt5_accounts" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "bot_instances" }, loadAll)
      .subscribe((status, channelError) => {
        console.log("[GQX] CUSTOMER REALTIME:", status);
        if (channelError) console.error("[GQX] CUSTOMER REALTIME ERROR:", channelError);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open]);

  const mt5Map = useMemo(
    () => new Map(mt5Accounts.map((account) => [account.id, account])),
    [mt5Accounts]
  );

  const botMap = useMemo(
    () => new Map(bots.map((bot) => [bot.mt5_account_id, bot])),
    [bots]
  );

  const customerRows = useMemo(() => {
    return customers.map((customer) => {
      const customerLicenses = licenses.filter((license) => license.customer_id === customer.id);
      const customerMt5 = mt5Accounts.filter((account) => account.customer_id === customer.id);

      const links = customerLicenses.map((license) => ({
        license,
        mt5: license.mt5_account_id ? mt5Map.get(license.mt5_account_id) || null : null,
        bot: license.mt5_account_id ? botMap.get(license.mt5_account_id) || null : null,
      }));

      return { customer, links, customerLicenses, customerMt5 };
    });
  }, [customers, licenses, mt5Accounts, mt5Map, botMap]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customerRows;

    return customerRows.filter(({ customer, links, customerMt5 }) => {
      const licenseText = links.map(({ license }) => `${license.license_key} ${license.product}`).join(" ");
      const mt5Text = customerMt5.map((mt5) => `${mt5.mt5_login || mt5.login || ""} ${mt5.broker || ""} ${mt5.server || ""}`).join(" ");
      return [customer.full_name, customer.phone, customer.email, customer.note, licenseText, mt5Text]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [customerRows, search]);

  async function saveCustomer(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!customerForm.full_name.trim()) {
      setError("Vui lòng nhập họ tên khách hàng.");
      return;
    }

    setSavingCustomer(true);

    try {
      const payload = {
        full_name: customerForm.full_name.trim(),
        phone: customerForm.phone.trim() || null,
        email: customerForm.email.trim() || null,
        note: customerForm.note.trim() || null,
        status: customerForm.status || "active",
        updated_at: new Date().toISOString(),
      };

      if (editingCustomerId) {
        const { error: updateError } = await supabase.from("customers").update(payload).eq("id", editingCustomerId);
        if (updateError) throw updateError;
        setMessage("✅ Đã cập nhật khách hàng.");
      } else {
        const { data, error: insertError } = await supabase.from("customers").insert(payload).select("id").single();
        if (insertError) throw insertError;
        setSelectedCustomerId(data?.id || null);
        setMessage("✅ Đã thêm khách hàng.");
      }

      setCustomerForm(EMPTY_CUSTOMER);
      setEditingCustomerId(null);
      await loadAll();
    } catch (err) {
      console.error("CUSTOMER SAVE ERROR:", err);
      setError(err?.message || "Không thể lưu khách hàng.");
    } finally {
      setSavingCustomer(false);
    }
  }

  async function saveLicense(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!selectedCustomerId) {
      setError("Hãy chọn khách hàng trước khi tạo License.");
      return;
    }

    if (!licenseForm.expire_date) {
      setError("Vui lòng chọn ngày hết hạn License.");
      return;
    }

    setSavingLicense(true);

    try {
      const key = licenseForm.license_key.trim() || await createUniqueLicenseKey();

      const payload = {
        customer_id: selectedCustomerId,
        license_key: key,
        status: licenseForm.status || "active",
        expiry_date: licenseForm.expire_date,
        expire_date: licenseForm.expire_date,
        max_accounts: Number(licenseForm.max_accounts || 1),
        product: licenseForm.product.trim() || "GIANG QUANT X",
        updated_at: new Date().toISOString(),
      };

      const { error: insertError } = await supabase.from("licenses").insert(payload);

      if (insertError) {
        if (String(insertError.message || "").includes("licenses_license_key_key")) {
          const retryKey = await createUniqueLicenseKey();
          const retryPayload = { ...payload, license_key: retryKey };
          const { error: retryError } = await supabase.from("licenses").insert(retryPayload);
          if (retryError) throw retryError;
          setMessage(`✅ Đã tạo License: ${retryKey}`);
        } else {
          throw insertError;
        }
      } else {
        setMessage(`✅ Đã tạo License: ${key}`);
      }

      setLicenseForm(EMPTY_LICENSE);
      await loadAll();
    } catch (err) {
      console.error("LICENSE SAVE ERROR:", err);
      setError(err?.message || "Không thể tạo License.");
    } finally {
      setSavingLicense(false);
    }
  }

  async function deleteCustomer(row) {
    const { customer, customerLicenses, customerMt5 } = row;

    setError("");
    setMessage("");

    if (!customer?.id) return;

    if (customerLicenses.length > 0 || customerMt5.length > 0) {
      setError("Không thể xóa khách đang có License hoặc MT5. Hãy bỏ liên kết/xóa dữ liệu liên quan trước.");
      return;
    }

    const confirmed = window.confirm(
      `Xóa khách hàng "${customer.full_name}"? Hành động này không thể hoàn tác.`
    );

    if (!confirmed) return;

    setDeletingCustomerId(customer.id);

    try {
      const { error: deleteError } = await supabase.from("customers").delete().eq("id", customer.id);
      if (deleteError) throw deleteError;

      if (selectedCustomerId === customer.id) {
        setSelectedCustomerId(null);
        setCustomerForm(EMPTY_CUSTOMER);
        setEditingCustomerId(null);
      }

      setMessage("✅ Đã xóa khách hàng.");
      await loadAll();
    } catch (err) {
      console.error("CUSTOMER DELETE ERROR:", err);
      setError(err?.message || "Không thể xóa khách hàng. Kiểm tra quyền DELETE/RLS trong Supabase.");
    } finally {
      setDeletingCustomerId(null);
    }
  }

  function editCustomer(customer) {
    setSelectedCustomerId(customer.id);
    setEditingCustomerId(customer.id);
    setCustomerForm({
      full_name: customer.full_name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      note: customer.note || "",
      status: customer.status || "active",
    });
    setError("");
    setMessage("");
  }

  function selectCustomer(customer) {
    setSelectedCustomerId(customer.id);
    setEditingCustomerId(null);
    setCustomerForm(EMPTY_CUSTOMER);
    setError("");
    setMessage("");
  }

  if (!open) return null;

  const selectedRow = customerRows.find(({ customer }) => customer.id === selectedCustomerId);

  return (
    <div style={styles.backdrop}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>CUSTOMER MANAGEMENT</div>
            <h2 style={styles.title}>Khách hàng & EA</h2>
            <p style={styles.subtitle}>Customer → License → MT5 → EA · Realtime</p>
          </div>
          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {message && <div style={styles.success}>{message}</div>}

        <div style={styles.body}>
          <div style={styles.leftColumn}>
            <form onSubmit={saveCustomer} style={styles.card}>
              <div style={styles.formTitle}>{editingCustomerId ? "SỬA KHÁCH HÀNG" : "THÊM KHÁCH HÀNG"}</div>
              <input style={styles.input} placeholder="Họ và tên *" value={customerForm.full_name} onChange={(e) => setCustomerForm((v) => ({ ...v, full_name: e.target.value }))} />
              <input style={styles.input} placeholder="Số điện thoại" value={customerForm.phone} onChange={(e) => setCustomerForm((v) => ({ ...v, phone: e.target.value }))} />
              <input style={styles.input} type="email" placeholder="Email" value={customerForm.email} onChange={(e) => setCustomerForm((v) => ({ ...v, email: e.target.value }))} />
              <textarea style={{ ...styles.input, minHeight: 80, resize: "vertical" }} placeholder="Ghi chú" value={customerForm.note} onChange={(e) => setCustomerForm((v) => ({ ...v, note: e.target.value }))} />
              <select style={styles.input} value={customerForm.status} onChange={(e) => setCustomerForm((v) => ({ ...v, status: e.target.value }))}>
                <option value="active">ACTIVE</option>
                <option value="inactive">INACTIVE</option>
                <option value="pending">PENDING</option>
              </select>
              <div style={styles.actions}>
                <button disabled={savingCustomer} style={styles.primaryButton}>{savingCustomer ? "ĐANG LƯU..." : editingCustomerId ? "LƯU THAY ĐỔI" : "THÊM KHÁCH"}</button>
                {editingCustomerId && <button type="button" style={styles.secondaryButton} onClick={() => { setEditingCustomerId(null); setCustomerForm(EMPTY_CUSTOMER); }}>HỦY</button>}
              </div>
            </form>

            <form onSubmit={saveLicense} style={styles.card}>
              <div style={styles.formTitle}>TẠO LICENSE</div>
              <div style={styles.helperText}>{selectedRow ? `Cho: ${selectedRow.customer.full_name}` : "Chọn khách hàng trước"}</div>
              <input style={styles.input} placeholder="License key (để trống = tự tạo)" value={licenseForm.license_key} onChange={(e) => setLicenseForm((v) => ({ ...v, license_key: e.target.value }))} />
              <input style={styles.input} type="date" value={licenseForm.expire_date} onChange={(e) => setLicenseForm((v) => ({ ...v, expire_date: e.target.value }))} />
              <input style={styles.input} type="number" min="1" value={licenseForm.max_accounts} onChange={(e) => setLicenseForm((v) => ({ ...v, max_accounts: e.target.value }))} placeholder="Max accounts" />
              <input style={styles.input} value={licenseForm.product} onChange={(e) => setLicenseForm((v) => ({ ...v, product: e.target.value }))} placeholder="Product" />
              <button disabled={savingLicense || !selectedCustomerId} style={styles.primaryButton}>{savingLicense ? "ĐANG TẠO..." : "TẠO LICENSE"}</button>
            </form>
          </div>

          <div style={styles.cardList}>
            <div style={styles.listHeader}>
              <div>
                <div style={styles.formTitle}>KHÁCH HÀNG ({filteredRows.length})</div>
                <div style={styles.helperText}>● REALTIME</div>
              </div>
              <input style={{ ...styles.input, maxWidth: 300, marginTop: 0 }} placeholder="Tìm tên, SĐT, license, MT5..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>

            {loading ? (
              <div style={styles.empty}>Đang tải dữ liệu...</div>
            ) : filteredRows.length === 0 ? (
              <div style={styles.empty}>Chưa có khách hàng.</div>
            ) : (
              <div style={styles.customerList}>
                {filteredRows.map((row) => {
                  const { customer, links, customerLicenses, customerMt5 } = row;
                  const mt5OnlyText = customerMt5.filter((a) => !links.some(({ license }) => license.mt5_account_id === a.id)).map((a) => `MT5 ${a.mt5_login || a.login}`).join(", ");

                  return (
                    <div key={customer.id} style={{ ...styles.customerCard, ...(selectedCustomerId === customer.id ? styles.selectedCard : {}) }} onClick={() => selectCustomer(customer)}>
                      <div style={styles.customerMain}>
                        <div style={styles.nameRow}>
                          <strong>{customer.full_name}</strong>
                          <span style={styles.badge}>{String(customer.status || "active").toUpperCase()}</span>
                        </div>
                        <div style={styles.contact}>{customer.phone || "--"} · {customer.email || "--"}</div>

                        {links.length === 0 && customerMt5.length === 0 ? (
                          <div style={styles.subtle}>Chưa có License / MT5</div>
                        ) : (
                          <div style={styles.linkList}>
                            {links.map(({ license, mt5, bot }) => (
                              <div key={license.id} style={styles.linkRow}>
                                <div><b>🔑 {license.license_key}</b><span style={styles.subtle}> {String(license.status || "").toUpperCase()} · {license.expire_date || license.expiry_date || "--"}</span></div>
                                <div style={styles.subtle}>MT5 {mt5?.mt5_login || mt5?.login || "--"} · {mt5?.broker || "--"} · {mt5?.server || "--"}</div>
                                <div style={styles.subtle}>EA {bot?.ea_name || "--"} · {bot ? (bot.enabled ? "🟢 ENABLED" : "🔴 PAUSED") : "--"}</div>
                              </div>
                            ))}
                            {mt5OnlyText && <div style={styles.subtle}>{mt5OnlyText}</div>}
                          </div>
                        )}
                      </div>

                      <div style={styles.cardActions}>
                        <button type="button" style={styles.editButton} onClick={(e) => { e.stopPropagation(); editCustomer(customer); }}>SỬA</button>
                        <button type="button" style={styles.deleteButton} disabled={deletingCustomerId === customer.id} onClick={(e) => { e.stopPropagation(); deleteCustomer(row); }}>
                          {deletingCustomerId === customer.id ? "ĐANG XÓA..." : "XÓA"}
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
  backdrop: { position: "fixed", inset: 0, zIndex: 11000, background: "rgba(3,7,18,.78)", backdropFilter: "blur(8px)", padding: 24, boxSizing: "border-box" },
  panel: { width: "min(1200px,100%)", height: "min(820px,100%)", margin: "0 auto", background: "#0b1220", border: "1px solid rgba(148,163,184,.18)", borderRadius: 22, color: "#e5e7eb", boxShadow: "0 30px 90px rgba(0,0,0,.45)", overflow: "hidden", display: "flex", flexDirection: "column" },
  header: { padding: "22px 24px", borderBottom: "1px solid rgba(148,163,184,.12)", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, opacity: .6 },
  title: { margin: "5px 0 2px", fontSize: 28 },
  subtitle: { margin: 0, opacity: .6 },
  closeButton: { width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,.04)", color: "white", border: "1px solid rgba(148,163,184,.18)", fontSize: 25, cursor: "pointer" },
  body: { flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, padding: 16, overflow: "hidden" },
  leftColumn: { minWidth: 0, overflow: "auto" },
  card: { padding: 18, background: "rgba(255,255,255,.035)", border: "1px solid rgba(148,163,184,.1)", borderRadius: 18, marginBottom: 14 },
  cardList: { minWidth: 0, minHeight: 0, padding: 18, background: "rgba(255,255,255,.035)", border: "1px solid rgba(148,163,184,.1)", borderRadius: 18, overflow: "auto" },
  listHeader: { display: "flex", gap: 14, justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  formTitle: { fontSize: 12, fontWeight: 800, letterSpacing: 1.1 },
  helperText: { fontSize: 11, opacity: .55, marginTop: 4 },
  input: { width: "100%", boxSizing: "border-box", marginTop: 9, padding: "11px 13px", borderRadius: 12, border: "1px solid rgba(148,163,184,.16)", background: "#0f172a", color: "#f8fafc", outline: "none" },
  actions: { display: "flex", gap: 8, marginTop: 13 },
  primaryButton: { flex: 1, padding: "11px 13px", border: 0, borderRadius: 11, background: "#2563eb", color: "white", fontWeight: 800, cursor: "pointer" },
  secondaryButton: { padding: "11px 13px", borderRadius: 11, background: "rgba(255,255,255,.05)", color: "#e5e7eb", border: "1px solid rgba(148,163,184,.15)", cursor: "pointer" },
  error: { margin: "12px 16px 0", padding: 11, borderRadius: 10, background: "rgba(239,68,68,.12)", color: "#fca5a5" },
  success: { margin: "12px 16px 0", padding: 11, borderRadius: 10, background: "rgba(34,197,94,.12)", color: "#86efac" },
  empty: { padding: 40, textAlign: "center", opacity: .55 },
  customerList: { display: "flex", flexDirection: "column", gap: 9 },
  customerCard: { display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "space-between", padding: 15, borderRadius: 14, background: "rgba(15,23,42,.65)", border: "1px solid rgba(148,163,184,.1)", cursor: "pointer" },
  selectedCard: { border: "1px solid rgba(59,130,246,.55)", boxShadow: "0 0 0 1px rgba(59,130,246,.12) inset" },
  customerMain: { minWidth: 0, flex: 1 },
  nameRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  badge: { fontSize: 9, padding: "4px 7px", borderRadius: 999, background: "rgba(59,130,246,.12)", color: "#93c5fd", fontWeight: 800 },
  contact: { marginTop: 4, fontSize: 12, opacity: .65 },
  subtle: { fontSize: 11, opacity: .58, marginTop: 4 },
  linkList: { marginTop: 8, display: "grid", gap: 7 },
  linkRow: { padding: 9, borderRadius: 10, background: "rgba(2,6,23,.38)", border: "1px solid rgba(148,163,184,.08)" },
  cardActions: { display: "flex", gap: 7, flexShrink: 0 },
  editButton: { border: "1px solid rgba(59,130,246,.25)", background: "rgba(59,130,246,.09)", color: "#93c5fd", padding: "8px 10px", borderRadius: 9, cursor: "pointer" },
  deleteButton: { border: "1px solid rgba(239,68,68,.25)", background: "rgba(239,68,68,.08)", color: "#fca5a5", padding: "8px 10px", borderRadius: 9, cursor: "pointer" },
};
