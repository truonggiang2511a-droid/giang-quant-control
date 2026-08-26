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
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GQX-${year}-${random}`;
}

function CustomerManager({ open, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [licenses, setLicenses] = useState([]);
  const [mt5Accounts, setMt5Accounts] = useState([]);
  const [bots, setBots] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [savingLicense, setSavingLicense] = useState(false);
  const [error, setError] = useState("");
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
      const [customerResult, licenseResult, mt5Result, botResult] =
        await Promise.all([
          supabase
            .from("customers")
            .select("id, full_name, phone, email, note, status, created_at, updated_at")
            .order("created_at", { ascending: false }),
          supabase
            .from("licenses")
            .select(
              "id, customer_id, bot_id, license_key, status, expiry_date, max_accounts, created_at, updated_at, mt5_account_id, expire_date, product"
            )
            .order("created_at", { ascending: false }),
          supabase
            .from("mt5_accounts")
            .select("id, mt5_login, broker, server, status")
            .order("mt5_login", { ascending: true }),
          supabase
            .from("bot_instances")
            .select(
              "id, mt5_account_id, ea_name, ea_version, symbol, timeframe, status, enabled, last_seen, balance, equity, daily_profit, drawdown"
            )
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customers" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "licenses" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "mt5_accounts" },
        () => loadAll()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bot_instances" },
        () => loadAll()
      )
      .subscribe((status, channelError) => {
        console.log("[GQX] CUSTOMER REALTIME:", status);
        if (channelError) {
          console.error("[GQX] CUSTOMER REALTIME ERROR:", channelError);
        }
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
      const customerLicenses = licenses.filter(
        (license) => license.customer_id === customer.id
      );

      const links = customerLicenses.map((license) => {
        const mt5 = license.mt5_account_id
          ? mt5Map.get(license.mt5_account_id) || null
          : null;
        const bot = license.mt5_account_id
          ? botMap.get(license.mt5_account_id) || null
          : null;

        return { license, mt5, bot };
      });

      return { customer, links };
    });
  }, [customers, licenses, mt5Map, botMap]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customerRows;

    return customerRows.filter(({ customer, links }) => {
      const licenseText = links
        .map(({ license }) => `${license.license_key} ${license.product}`)
        .join(" ");

      const mt5Text = links
        .map(({ mt5 }) =>
          mt5
            ? `${mt5.mt5_login} ${mt5.broker} ${mt5.server}`
            : ""
        )
        .join(" ");

      return [
        customer.full_name,
        customer.phone,
        customer.email,
        customer.note,
        licenseText,
        mt5Text,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [customerRows, search]);

  async function saveCustomer(event) {
    event.preventDefault();

    if (!customerForm.full_name.trim()) {
      setError("Vui lòng nhập họ tên khách hàng.");
      return;
    }

    setSavingCustomer(true);
    setError("");

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
        const { error: updateError } = await supabase
          .from("customers")
          .update(payload)
          .eq("id", editingCustomerId);
        if (updateError) throw updateError;
      } else {
        const { data, error: insertError } = await supabase
          .from("customers")
          .insert(payload)
          .select("id")
          .single();
        if (insertError) throw insertError;
        setSelectedCustomerId(data?.id || null);
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

    if (!selectedCustomerId) {
      setError("Hãy chọn khách hàng trước khi tạo License.");
      return;
    }

    const key = licenseForm.license_key.trim() || generateLicenseKey();

    if (!licenseForm.expire_date) {
      setError("Vui lòng chọn ngày hết hạn License.");
      return;
    }

    setSavingLicense(true);
    setError("");

    try {
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

      const { error: insertError } = await supabase
        .from("licenses")
        .insert(payload);

      if (insertError) throw insertError;

      setLicenseForm(EMPTY_LICENSE);
      await loadAll();
    } catch (err) {
      console.error("LICENSE SAVE ERROR:", err);
      setError(err?.message || "Không thể tạo License.");
    } finally {
      setSavingLicense(false);
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
  }

  function selectCustomer(customer) {
    setSelectedCustomerId(customer.id);
    setEditingCustomerId(null);
    setCustomerForm(EMPTY_CUSTOMER);
  }

  if (!open) return null;

  const selectedRow = customerRows.find(
    ({ customer }) => customer.id === selectedCustomerId
  );

  return (
    <div style={styles.backdrop}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>CUSTOMER MANAGEMENT</div>
            <h2 style={styles.title}>Khách hàng & EA</h2>
            <p style={styles.subtitle}>
              Customer → License → MT5 → EA. Dữ liệu cập nhật trực tiếp từ Supabase.
            </p>
          </div>

          <button style={styles.closeButton} onClick={onClose}>×</button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.body}>
          <div style={styles.leftColumn}>
            <form onSubmit={saveCustomer} style={styles.card}>
              <div style={styles.formTitle}>
                {editingCustomerId ? "SỬA KHÁCH HÀNG" : "THÊM KHÁCH HÀNG"}
              </div>

              <input
                style={styles.input}
                placeholder="Họ và tên *"
                value={customerForm.full_name}
                onChange={(e) =>
                  setCustomerForm((v) => ({ ...v, full_name: e.target.value }))
                }
              />

              <input
                style={styles.input}
                placeholder="Số điện thoại"
                value={customerForm.phone}
                onChange={(e) =>
                  setCustomerForm((v) => ({ ...v, phone: e.target.value }))
                }
              />

              <input
                style={styles.input}
                type="email"
                placeholder="Email"
                value={customerForm.email}
                onChange={(e) =>
                  setCustomerForm((v) => ({ ...v, email: e.target.value }))
                }
              />

              <textarea
                style={{ ...styles.input, minHeight: 80, resize: "vertical" }}
                placeholder="Ghi chú"
                value={customerForm.note}
                onChange={(e) =>
                  setCustomerForm((v) => ({ ...v, note: e.target.value }))
                }
              />

              <select
                style={styles.input}
                value={customerForm.status}
                onChange={(e) =>
                  setCustomerForm((v) => ({ ...v, status: e.target.value }))
                }
              >
                <option value="active">ACTIVE</option>
                <option value="inactive">INACTIVE</option>
                <option value="pending">PENDING</option>
              </select>

              <div style={styles.actions}>
                <button disabled={savingCustomer} style={styles.primaryButton}>
                  {savingCustomer
                    ? "ĐANG LƯU..."
                    : editingCustomerId
                      ? "LƯU THAY ĐỔI"
                      : "THÊM KHÁCH"}
                </button>

                {editingCustomerId && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingCustomerId(null);
                      setCustomerForm(EMPTY_CUSTOMER);
                    }}
                    style={styles.secondaryButton}
                  >
                    HỦY
                  </button>
                )}
              </div>
            </form>

            <form onSubmit={saveLicense} style={styles.card}>
              <div style={styles.formTitle}>TẠO LICENSE</div>
              <div style={styles.helperText}>
                {selectedRow
                  ? `Cho: ${selectedRow.customer.full_name}`
                  : "Chọn một khách hàng trước"}
              </div>

              <input
                style={styles.input}
                placeholder="License key (để trống = tự tạo)"
                value={licenseForm.license_key}
                onChange={(e) =>
                  setLicenseForm((v) => ({ ...v, license_key: e.target.value }))
                }
              />

              <input
                style={styles.input}
                type="date"
                value={licenseForm.expire_date}
                onChange={(e) =>
                  setLicenseForm((v) => ({ ...v, expire_date: e.target.value }))
                }
              />

              <input
                style={styles.input}
                type="number"
                min="1"
                value={licenseForm.max_accounts}
                onChange={(e) =>
                  setLicenseForm((v) => ({ ...v, max_accounts: e.target.value }))
                }
                placeholder="Số tài khoản tối đa"
              />

              <input
                style={styles.input}
                value={licenseForm.product}
                onChange={(e) =>
                  setLicenseForm((v) => ({ ...v, product: e.target.value }))
                }
                placeholder="Product"
              />

              <button
                disabled={savingLicense || !selectedCustomerId}
                style={styles.primaryButton}
              >
                {savingLicense ? "ĐANG TẠO..." : "TẠO LICENSE"}
              </button>
            </form>
          </div>

          <div style={styles.cardList}>
            <div style={styles.listHeader}>
              <div>
                <div style={styles.formTitle}>KHÁCH HÀNG ({filteredRows.length})</div>
                <div style={styles.helperText}>🟢 realtime</div>
              </div>

              <input
                style={{ ...styles.input, maxWidth: 280, marginTop: 0 }}
                placeholder="Tìm tên, SĐT, license, MT5..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {loading ? (
              <div style={styles.empty}>Đang tải dữ liệu...</div>
            ) : filteredRows.length === 0 ? (
              <div style={styles.empty}>Chưa có khách hàng.</div>
            ) : (
              <div style={styles.customerList}>
                {filteredRows.map(({ customer, links }) => (
                  <div
                    key={customer.id}
                    style={{
                      ...styles.customerCard,
                      ...(selectedCustomerId === customer.id
                        ? styles.selectedCard
                        : {}),
                    }}
                    onClick={() => selectCustomer(customer)}
                  >
                    <div style={styles.customerMain}>
                      <div style={styles.nameRow}>
                        <strong>{customer.full_name}</strong>
                        <span
                          style={{
                            ...styles.status,
                            ...(customer.status === "active"
                              ? styles.statusActive
                              : styles.statusMuted),
                          }}
                        >
                          {String(customer.status || "--").toUpperCase()}
                        </span>
                      </div>

                      <span>📱 {customer.phone || "Chưa có SĐT"}</span>
                      <span>📧 {customer.email || "Chưa có email"}</span>
                      <small>{customer.note || "Không có ghi chú"}</small>

                      {links.length === 0 ? (
                        <div style={styles.noLink}>Chưa có License</div>
                      ) : (
                        <div style={styles.linkList}>
                          {links.map(({ license, mt5, bot }) => (
                            <div key={license.id} style={styles.linkRow}>
                              <div>
                                <strong>🔑 {license.license_key}</strong>
                                <div style={styles.miniText}>
                                  {license.product || "GIANG QUANT X"} · Hết hạn {license.expire_date || license.expiry_date || "--"}
                                </div>
                              </div>

                              <div style={styles.liveBlock}>
                                <div>
                                  MT5: {mt5?.mt5_login || "Chưa liên kết"}
                                  {mt5?.broker ? ` · ${mt5.broker}` : ""}
                                </div>
                                <div>
                                  EA: {bot?.ea_name || "Chưa có bot"} · {bot ? "🟢/🔴 theo heartbeat" : "--"}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      style={styles.editButton}
                      onClick={(event) => {
                        event.stopPropagation();
                        editCustomer(customer);
                      }}
                    >
                      SỬA
                    </button>
                  </div>
                ))}
              </div>
            )}

            {selectedRow && (
              <div style={styles.selectedSummary}>
                <strong>Đang chọn: {selectedRow.customer.full_name}</strong>
                <div>
                  License: {selectedRow.links.length} · EA/MT5 đang liên kết: {selectedRow.links.filter((x) => x.mt5 || x.bot).length}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 9999,
    background: "rgba(3, 7, 18, 0.78)",
    backdropFilter: "blur(8px)",
    padding: 24,
    boxSizing: "border-box",
  },
  panel: {
    width: "min(1280px, 100%)",
    height: "min(850px, 100%)",
    margin: "0 auto",
    background: "#0b1220",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 22,
    boxShadow: "0 30px 90px rgba(0,0,0,.45)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    color: "#e5e7eb",
  },
  header: {
    padding: "22px 24px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottom: "1px solid rgba(148,163,184,.12)",
  },
  eyebrow: { fontSize: 11, letterSpacing: 1.6, opacity: 0.6 },
  title: { margin: "5px 0 2px", fontSize: 28 },
  subtitle: { margin: 0, opacity: 0.65 },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,.2)",
    background: "rgba(255,255,255,.04)",
    color: "white",
    fontSize: 26,
    cursor: "pointer",
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: "330px 1fr",
    gap: 16,
    padding: 16,
  },
  leftColumn: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    overflow: "auto",
  },
  card: {
    padding: 18,
    borderRadius: 18,
    background: "rgba(255,255,255,.035)",
    border: "1px solid rgba(148,163,184,.1)",
  },
  cardList: {
    minWidth: 0,
    minHeight: 0,
    padding: 18,
    borderRadius: 18,
    background: "rgba(255,255,255,.035)",
    border: "1px solid rgba(148,163,184,.1)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  formTitle: { fontSize: 12, fontWeight: 700, letterSpacing: 1.1, opacity: 0.75 },
  helperText: { fontSize: 11, opacity: 0.55, marginTop: 4 },
  input: {
    width: "100%",
    boxSizing: "border-box",
    marginTop: 11,
    padding: "12px 13px",
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,.16)",
    background: "rgba(15,23,42,.8)",
    color: "#f8fafc",
    outline: "none",
  },
  actions: { display: "flex", gap: 8, marginTop: 14 },
  primaryButton: {
    width: "100%",
    border: 0,
    borderRadius: 12,
    padding: "12px 14px",
    background: "#2563eb",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
    marginTop: 12,
  },
  secondaryButton: {
    border: "1px solid rgba(148,163,184,.18)",
    borderRadius: 12,
    padding: "12px 14px",
    background: "transparent",
    color: "#e5e7eb",
    cursor: "pointer",
  },
  listHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  customerList: { overflow: "auto", marginTop: 12, paddingRight: 4 },
  customerCard: {
    display: "flex",
    justifyContent: "space-between",
    gap: 14,
    padding: 15,
    borderRadius: 14,
    background: "rgba(15,23,42,.62)",
    border: "1px solid rgba(148,163,184,.1)",
    marginBottom: 10,
    cursor: "pointer",
  },
  selectedCard: {
    border: "1px solid rgba(59,130,246,.55)",
    boxShadow: "0 0 0 1px rgba(37,99,235,.12) inset",
  },
  customerMain: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  nameRow: { display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" },
  status: {
    padding: "5px 9px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
  },
  statusActive: { background: "rgba(34,197,94,.12)", color: "#4ade80" },
  statusMuted: { background: "rgba(148,163,184,.1)", color: "#cbd5e1" },
  editButton: {
    alignSelf: "flex-start",
    border: "1px solid rgba(148,163,184,.18)",
    borderRadius: 9,
    background: "transparent",
    color: "#e5e7eb",
    padding: "7px 10px",
    cursor: "pointer",
  },
  linkList: { marginTop: 8, display: "grid", gap: 7 },
  linkRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 10,
    background: "rgba(255,255,255,.035)",
    border: "1px solid rgba(148,163,184,.08)",
  },
  miniText: { fontSize: 10, opacity: 0.55, marginTop: 2 },
  liveBlock: { fontSize: 11, opacity: 0.8 },
  noLink: { fontSize: 11, opacity: 0.55, marginTop: 7 },
  selectedSummary: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    background: "rgba(37,99,235,.08)",
    border: "1px solid rgba(59,130,246,.18)",
    fontSize: 12,
  },
  empty: { padding: 30, textAlign: "center", opacity: 0.6 },
  error: {
    margin: "12px 16px 0",
    padding: "10px 12px",
    borderRadius: 10,
    background: "rgba(239,68,68,.12)",
    color: "#fca5a5",
  },
};

export default CustomerManager;
