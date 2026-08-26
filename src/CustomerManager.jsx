import React, { useEffect, useState } from "react";
import { supabase } from "./supabase";

const EMPTY_FORM = {
  full_name: "",
  phone: "",
  email: "",
  note: "",
  status: "active",
};

function CustomerManager({ open, onClose }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState("");

  async function loadCustomers() {
    if (!supabase) {
      setError("Supabase chưa được cấu hình.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data, error: loadError } = await supabase
        .from("customers")
        .select("id, full_name, phone, email, note, status, created_at, updated_at")
        .order("created_at", { ascending: false });

      if (loadError) throw loadError;
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("CUSTOMERS LOAD ERROR:", err);
      setError(err?.message || "Không thể tải khách hàng.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) loadCustomers();
  }, [open]);

  async function saveCustomer(event) {
    event.preventDefault();

    if (!form.full_name.trim()) {
      setError("Vui lòng nhập họ tên khách hàng.");
      return;
    }

    if (!supabase) {
      setError("Supabase chưa được cấu hình.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const payload = {
        full_name: form.full_name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        note: form.note.trim() || null,
        status: form.status || "active",
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const { error: updateError } = await supabase
          .from("customers")
          .update(payload)
          .eq("id", editingId);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("customers")
          .insert(payload);

        if (insertError) throw insertError;
      }

      setForm(EMPTY_FORM);
      setEditingId(null);
      await loadCustomers();
    } catch (err) {
      console.error("CUSTOMER SAVE ERROR:", err);
      setError(err?.message || "Không thể lưu khách hàng.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(customer) {
    setEditingId(customer.id);
    setForm({
      full_name: customer.full_name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      note: customer.note || "",
      status: customer.status || "active",
    });
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError("");
  }

  const filteredCustomers = customers.filter((customer) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;

    return [
      customer.full_name,
      customer.phone,
      customer.email,
      customer.note,
      customer.status,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  if (!open) return null;

  return (
    <div style={styles.backdrop}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>CUSTOMER MANAGEMENT</div>
            <h2 style={styles.title}>Khách hàng</h2>
            <p style={styles.subtitle}>
              Dữ liệu lưu trực tiếp vào Supabase.
            </p>
          </div>

          <button style={styles.closeButton} onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <div style={styles.body}>
          <form onSubmit={saveCustomer} style={styles.formCard}>
            <div style={styles.formTitle}>
              {editingId ? "SỬA KHÁCH HÀNG" : "THÊM KHÁCH HÀNG"}
            </div>

            <input
              style={styles.input}
              placeholder="Họ và tên *"
              value={form.full_name}
              onChange={(e) =>
                setForm((v) => ({ ...v, full_name: e.target.value }))
              }
            />

            <input
              style={styles.input}
              placeholder="Số điện thoại"
              value={form.phone}
              onChange={(e) =>
                setForm((v) => ({ ...v, phone: e.target.value }))
              }
            />

            <input
              style={styles.input}
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) =>
                setForm((v) => ({ ...v, email: e.target.value }))
              }
            />

            <textarea
              style={{ ...styles.input, minHeight: 90, resize: "vertical" }}
              placeholder="Ghi chú"
              value={form.note}
              onChange={(e) =>
                setForm((v) => ({ ...v, note: e.target.value }))
              }
            />

            <select
              style={styles.input}
              value={form.status}
              onChange={(e) =>
                setForm((v) => ({ ...v, status: e.target.value }))
              }
            >
              <option value="active">ACTIVE</option>
              <option value="inactive">INACTIVE</option>
              <option value="pending">PENDING</option>
            </select>

            <div style={styles.actions}>
              <button disabled={saving} style={styles.primaryButton}>
                {saving ? "ĐANG LƯU..." : editingId ? "LƯU THAY ĐỔI" : "THÊM KHÁCH"}
              </button>

              {editingId && (
                <button type="button" onClick={resetForm} style={styles.secondaryButton}>
                  HỦY SỬA
                </button>
              )}
            </div>
          </form>

          <div style={styles.listCard}>
            <div style={styles.listHeader}>
              <div style={styles.formTitle}>
                DANH SÁCH ({filteredCustomers.length})
              </div>

              <input
                style={{ ...styles.input, maxWidth: 260 }}
                placeholder="Tìm khách..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {loading ? (
              <div style={styles.empty}>Đang tải khách hàng...</div>
            ) : filteredCustomers.length === 0 ? (
              <div style={styles.empty}>Chưa có khách hàng.</div>
            ) : (
              <div style={styles.customerList}>
                {filteredCustomers.map((customer) => (
                  <div key={customer.id} style={styles.customerCard}>
                    <div style={styles.customerMain}>
                      <strong>{customer.full_name}</strong>
                      <span>{customer.phone || "Chưa có SĐT"}</span>
                      <span>{customer.email || "Chưa có email"}</span>
                      <small>{customer.note || "Không có ghi chú"}</small>
                    </div>

                    <div style={styles.customerRight}>
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

                      <button
                        style={styles.editButton}
                        onClick={() => startEdit(customer)}
                      >
                        SỬA
                      </button>
                    </div>
                  </div>
                ))}
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
    width: "min(1200px, 100%)",
    height: "min(820px, 100%)",
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
  formCard: {
    padding: 18,
    borderRadius: 18,
    background: "rgba(255,255,255,.035)",
    border: "1px solid rgba(148,163,184,.1)",
  },
  listCard: {
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
    flex: 1,
    border: 0,
    borderRadius: 12,
    padding: "12px 14px",
    background: "#2563eb",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
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
  },
  customerMain: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  customerRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
  },
  status: {
    padding: "5px 9px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
  },
  statusActive: { background: "rgba(34,197,94,.12)", color: "#4ade80" },
  statusMuted: { background: "rgba(148,163,184,.1)", color: "#cbd5e1" },
  editButton: {
    border: "1px solid rgba(148,163,184,.18)",
    borderRadius: 9,
    background: "transparent",
    color: "#e5e7eb",
    padding: "7px 10px",
    cursor: "pointer",
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
