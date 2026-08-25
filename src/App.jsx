import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

function App() {
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadBots() {
    setError("");

    const { data, error } = await supabase
      .from("bot_instances")
      .select(`
        id,
        mt5_account_id,
        ea_name,
        ea_version,
        symbol,
        timeframe,
        status,
        enabled,
        last_seen,
        balance,
        equity,
        daily_profit,
        drawdown
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setError(error.message);
      setBots([]);
    } else {
      setBots(data || []);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadBots();

    const timer = setInterval(loadBots, 10000);

    return () => clearInterval(timer);
  }, []);

  const online = useMemo(
    () => bots.filter((b) => b.status === "online").length,
    [bots]
  );

  const running = useMemo(
    () => bots.filter((b) => b.enabled === true).length,
    [bots]
  );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">GQ</div>
          <div>
            <div className="brand-title">GIANG QUANT</div>
            <div className="brand-sub">CONTROL CENTER</div>
          </div>
        </div>

        <nav>
          <div className="nav-item active">Dashboard</div>
          <div className="nav-item">EA Bots</div>
          <div className="nav-item">MT5 Accounts</div>
          <div className="nav-item">Licenses</div>
          <div className="nav-item">Commands</div>
          <div className="nav-item">Activity Logs</div>
        </nav>

        <div className="sidebar-footer">
          Production · Singapore
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <div className="eyebrow">BOT MANAGEMENT</div>
            <h1>EA Control Dashboard</h1>
            <p>Giám sát và quản lý EA MT5 theo thời gian thực.</p>
          </div>

          <button className="refresh" onClick={loadBots}>
            ↻ Làm mới
          </button>
        </header>

        <section className="stats">
          <div className="stat-card">
            <span>TỔNG BOT</span>
            <strong>{bots.length}</strong>
            <small>Bot đã đăng ký</small>
          </div>

          <div className="stat-card">
            <span>ONLINE</span>
            <strong className="green">{online}</strong>
            <small>Đang heartbeat</small>
          </div>

          <div className="stat-card">
            <span>ĐANG CHẠY</span>
            <strong className="blue">{running}</strong>
            <small>Remote enabled</small>
          </div>

          <div className="stat-card">
            <span>OFFLINE</span>
            <strong className="red">
              {bots.length - online}
            </strong>
            <small>Không heartbeat</small>
          </div>
        </section>

        {error && (
          <div className="alert error">
            <strong>Supabase Error:</strong> {error}
          </div>
        )}

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>EA Bots</h2>
              <p>Danh sách bot thực tế từ Supabase.</p>
            </div>

            <span className="live-badge">
              ● LIVE
            </span>
          </div>

          {loading ? (
            <div className="empty">Đang tải bot...</div>
          ) : bots.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">◎</div>
              <h3>Chưa có bot nào</h3>
              <p>
                Hãy chạy EA trên MT5 để tạo bot instance.
              </p>
            </div>
          ) : (
            <div className="bot-list">
              {bots.map((bot) => {
                const isOnline = bot.status === "online";
                const isEnabled = bot.enabled === true;

                return (
                  <div className="bot-card" key={bot.id}>
                    <div className="bot-top">
                      <div>
                        <div className="bot-title-row">
                          <h3>
                            {bot.ea_name || "GIANG QUANT X"}
                          </h3>

                          <span
                            className={
                              isOnline
                                ? "status online"
                                : "status offline"
                            }
                          >
                            ● {isOnline ? "ONLINE" : "OFFLINE"}
                          </span>
                        </div>

                        <div className="bot-meta">
                          V{bot.ea_version || "--"} ·{" "}
                          {bot.symbol || "--"} ·{" "}
                          {bot.timeframe || "--"}
                        </div>
                      </div>

                      <div
                        className={
                          isEnabled
                            ? "state-pill running"
                            : "state-pill paused"
                        }
                      >
                        {isEnabled ? "RUNNING" : "PAUSED"}
                      </div>
                    </div>

                    <div className="metrics">
                      <Metric
                        label="MT5 ACCOUNT"
                        value={bot.mt5_account_id}
                      />

                      <Metric
                        label="BALANCE"
                        value={formatMoney(bot.balance)}
                      />

                      <Metric
                        label="EQUITY"
                        value={formatMoney(bot.equity)}
                      />

                      <Metric
                        label="DAILY PNL"
                        value={formatMoney(
                          bot.daily_profit
                        )}
                      />

                      <Metric
                        label="DRAWDOWN"
                        value={`${Number(
                          bot.drawdown || 0
                        ).toFixed(2)}%`}
                      />

                      <Metric
                        label="LAST SEEN"
                        value={
                          bot.last_seen
                            ? new Date(
                                bot.last_seen
                              ).toLocaleString("vi-VN")
                            : "--"
                        }
                      />
                    </div>

                    <div className="bot-footer">
                      <div>
                        Remote:
                        <strong
                          className={
                            isEnabled
                              ? "green-text"
                              : "red-text"
                          }
                        >
                          {isEnabled
                            ? " BẬT"
                            : " TẮT"}
                        </strong>
                      </div>

                      <div className="bot-id">
                        BOT ID: {bot.id}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value ?? "--"}</strong>
    </div>
  );
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );
}

export default App;
