import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

const COMMANDS = {
  ENABLE: "ENABLE",
  PAUSE: "PAUSE",
  CLOSE_ALL: "CLOSE_ALL",
  KILL: "KILL",
};

export default function App() {
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const [commandLoading, setCommandLoading] = useState(null);

  // ============================================================
  // LOAD BOT
  // ============================================================

  async function loadBots(showLoading = false) {
    if (showLoading) {
      setLoading(true);
    }

    setError("");

    if (!supabase) {
      setError(
        "Chưa cấu hình Supabase. Kiểm tra VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY."
      );

      setLoading(false);
      return;
    }

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
        drawdown,
        created_at,
        mt5_accounts (
          id,
          mt5_login,
          broker,
          server,
          status
        )
      `)
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      console.error("LOAD BOT ERROR:", error);

      setError(error.message);
      setBots([]);
      setLoading(false);
      return;
    }

    setBots(data || []);
    setLoading(false);
  }

  // ============================================================
  // REFRESH
  // ============================================================

  async function handleRefresh() {
    if (refreshing) return;

    setRefreshing(true);
    setMessage("");

    await loadBots(false);

    setRefreshing(false);
  }

  // ============================================================
  // SEND COMMAND
  // ============================================================

  async function sendCommand(bot, command) {
    if (commandLoading) {
      return;
    }

    setError("");
    setMessage("");

    const botName =
      bot.ea_name || "GIANG QUANT X";

    // ----------------------------------------------------------
    // CONFIRM DANGEROUS COMMAND
    // ----------------------------------------------------------

    if (
      command === COMMANDS.CLOSE_ALL ||
      command === COMMANDS.KILL
    ) {
      const confirmed = window.confirm(
        `Xác nhận gửi lệnh ${command} cho ${botName}?`
      );

      if (!confirmed) {
        return;
      }
    }

    setCommandLoading(`${bot.id}-${command}`);

    try {
      // --------------------------------------------------------
      // CHECK PENDING COMMAND
      // --------------------------------------------------------

      const { data: pendingCommands, error: pendingError } =
        await supabase
          .from("bot_commands")
          .select("id, command, status, created_at")
          .eq("bot_instance_id", bot.id)
          .eq("status", "pending")
          .order("created_at", {
            ascending: false,
          })
          .limit(1);

      if (pendingError) {
        throw pendingError;
      }

      if (
        pendingCommands &&
        pendingCommands.length > 0
      ) {
        const pendingCommand =
          pendingCommands[0];

        setError(
          `Bot đang có lệnh ${pendingCommand.command} chờ EA xử lý.`
        );

        return;
      }

      // --------------------------------------------------------
      // INSERT COMMAND
      // --------------------------------------------------------

      const { error: insertError } =
        await supabase
          .from("bot_commands")
          .insert({
            bot_instance_id: bot.id,
            command,
            status: "pending",
            message: `Dashboard command: ${command}`,
          });

      if (insertError) {
        throw insertError;
      }

      // --------------------------------------------------------
      // OPTIMISTIC UI
      // --------------------------------------------------------

      setBots((currentBots) =>
        currentBots.map((item) => {
          if (item.id !== bot.id) {
            return item;
          }

          if (
            command === COMMANDS.ENABLE
          ) {
            return {
              ...item,
              enabled: true,
            };
          }

          if (
            command === COMMANDS.PAUSE ||
            command === COMMANDS.CLOSE_ALL ||
            command === COMMANDS.KILL
          ) {
            return {
              ...item,
              enabled: false,
            };
          }

          return item;
        })
      );

      setMessage(
        `${command} đã được gửi cho ${botName}. EA sẽ nhận lệnh ở heartbeat tiếp theo.`
      );

      // --------------------------------------------------------
      // RELOAD AFTER 1.5 SEC
      // --------------------------------------------------------

      setTimeout(() => {
        loadBots(false);
      }, 1500);
    } catch (commandError) {
      console.error(
        "COMMAND ERROR:",
        commandError
      );

      setError(
        commandError?.message ||
          "Không thể gửi command."
      );
    } finally {
      setCommandLoading(null);
    }
  }

  // ============================================================
  // INITIAL LOAD
  // ============================================================

  useEffect(() => {
    loadBots(true);

    const interval = setInterval(() => {
      loadBots(false);
    }, 10000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  // ============================================================
  // STATISTICS
  // ============================================================

  const totalBots = bots.length;

  const onlineBots = useMemo(() => {
    return bots.filter(
      (bot) =>
        String(bot.status).toLowerCase() ===
        "online"
    ).length;
  }, [bots]);

  const runningBots = useMemo(() => {
    return bots.filter(
      (bot) => bot.enabled === true
    ).length;
  }, [bots]);

  const offlineBots =
    totalBots - onlineBots;

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="app-shell">
      {/* ======================================================
          SIDEBAR
      ====================================================== */}

      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            GQ
          </div>

          <div>
            <div className="brand-title">
              GIANG QUANT
            </div>

            <div className="brand-sub">
              CONTROL CENTER
            </div>
          </div>
        </div>

        <nav>
          <div className="nav-item active">
            Dashboard
          </div>

          <div className="nav-item">
            EA Bots
          </div>

          <div className="nav-item">
            MT5 Accounts
          </div>

          <div className="nav-item">
            Licenses
          </div>

          <div className="nav-item">
            Commands
          </div>

          <div className="nav-item">
            Activity Logs
          </div>
        </nav>

        <div className="sidebar-footer">
          Production · Singapore
        </div>
      </aside>

      {/* ======================================================
          MAIN
      ====================================================== */}

      <main className="main">
        {/* ====================================================
            HEADER
        ==================================================== */}

        <header className="topbar">
          <div>
            <div className="eyebrow">
              BOT MANAGEMENT
            </div>

            <h1>
              EA Control Dashboard
            </h1>

            <p>
              Giám sát và quản lý EA MT5
              theo thời gian thực.
            </p>
          </div>

          <button
            className="refresh"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing
              ? "Đang cập nhật..."
              : "↻ Làm mới"}
          </button>
        </header>

        {/* ====================================================
            ALERT
        ==================================================== */}

        {message && (
          <div className="alert success">
            {message}
          </div>
        )}

        {error && (
          <div className="alert error">
            <strong>
              Supabase Error:
            </strong>{" "}
            {error}
          </div>
        )}

        {/* ====================================================
            STATS
        ==================================================== */}

        <section className="stats">
          <div className="stat-card">
            <span>TỔNG BOT</span>

            <strong>
              {totalBots}
            </strong>

            <small>
              Bot đã đăng ký
            </small>
          </div>

          <div className="stat-card">
            <span>ONLINE</span>

            <strong className="green">
              {onlineBots}
            </strong>

            <small>
              Đang heartbeat
            </small>
          </div>

          <div className="stat-card">
            <span>ĐANG CHẠY</span>

            <strong className="blue">
              {runningBots}
            </strong>

            <small>
              Remote enabled
            </small>
          </div>

          <div className="stat-card">
            <span>OFFLINE</span>

            <strong className="red">
              {offlineBots}
            </strong>

            <small>
              Không heartbeat
            </small>
          </div>
        </section>

        {/* ====================================================
            BOT PANEL
        ==================================================== */}

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>
                EA Bots
              </h2>

              <p>
                Danh sách bot thực tế
                từ Supabase Singapore.
              </p>
            </div>

            <span className="live-badge">
              ● LIVE
            </span>
          </div>

          {/* ==================================================
              LOADING
          ================================================== */}

          {loading && (
            <div className="empty">
              Đang tải dữ liệu EA...
            </div>
          )}

          {/* ==================================================
              EMPTY
          ================================================== */}

          {!loading &&
            !error &&
            bots.length === 0 && (
              <div className="empty">
                <div className="empty-icon">
                  ◎
                </div>

                <h3>
                  Chưa có bot nào
                </h3>

                <p>
                  Hãy chạy EA trên MT5
                  để tạo bot instance.
                </p>
              </div>
            )}

          {/* ==================================================
              BOT LIST
          ================================================== */}

          <div className="bot-list">
            {bots.map((bot) => {
              const account =
                bot.mt5_accounts;

              const isOnline =
                String(
                  bot.status
                ).toLowerCase() ===
                "online";

              const isEnabled =
                bot.enabled === true;

              const enableLoading =
                commandLoading ===
                `${bot.id}-ENABLE`;

              const pauseLoading =
                commandLoading ===
                `${bot.id}-PAUSE`;

              const closeLoading =
                commandLoading ===
                `${bot.id}-CLOSE_ALL`;

              const killLoading =
                commandLoading ===
                `${bot.id}-KILL`;

              return (
                <article
                  className="bot-card"
                  key={bot.id}
                >
                  {/* ==========================================
                      BOT HEADER
                  ========================================== */}

                  <div className="bot-top">
                    <div>
                      <div className="bot-title-row">
                        <h3>
                          {bot.ea_name ||
                            "GIANG QUANT X"}
                        </h3>

                        <span
                          className={
                            isOnline
                              ? "status online"
                              : "status offline"
                          }
                        >
                          ●{" "}
                          {isOnline
                            ? "ONLINE"
                            : "OFFLINE"}
                        </span>
                      </div>

                      <div className="bot-meta">
                        V
                        {bot.ea_version ||
                          "--"}{" "}
                        ·{" "}
                        {bot.symbol ||
                          "--"}{" "}
                        ·{" "}
                        {bot.timeframe ||
                          "--"}
                      </div>
                    </div>

                    <div
                      className={
                        isEnabled
                          ? "state-pill running"
                          : "state-pill paused"
                      }
                    >
                      {isEnabled
                        ? "RUNNING"
                        : "PAUSED"}
                    </div>
                  </div>

                  {/* ==========================================
                      METRICS
                  ========================================== */}

                  <div className="metrics">
                    <Metric
                      label="MT5 LOGIN"
                      value={
                        account?.mt5_login ||
                        "--"
                      }
                    />

                    <Metric
                      label="BROKER"
                      value={
                        account?.broker ||
                        "--"
                      }
                    />

                    <Metric
                      label="SERVER"
                      value={
                        account?.server ||
                        "--"
                      }
                    />

                    <Metric
                      label="BALANCE"
                      value={formatMoney(
                        bot.balance
                      )}
                    />

                    <Metric
                      label="EQUITY"
                      value={formatMoney(
                        bot.equity
                      )}
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
                          ? formatDate(
                              bot.last_seen
                            )
                          : "--"
                      }
                    />
                  </div>

                  {/* ==========================================
                      REMOTE STATUS
                  ========================================== */}

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

                  {/* ==========================================
                      CONTROL BUTTONS
                  ========================================== */}

                  <div className="bot-actions">
                    <button
                      className="btn-enable"
                      disabled={
                        commandLoading !==
                          null ||
                        isEnabled
                      }
                      onClick={() =>
                        sendCommand(
                          bot,
                          COMMANDS.ENABLE
                        )
                      }
                    >
                      {enableLoading
                        ? "ĐANG GỬI..."
                        : "BẬT BOT"}
                    </button>

                    <button
                      className="btn-pause"
                      disabled={
                        commandLoading !==
                          null ||
                        !isEnabled
                      }
                      onClick={() =>
                        sendCommand(
                          bot,
                          COMMANDS.PAUSE
                        )
                      }
                    >
                      {pauseLoading
                        ? "ĐANG GỬI..."
                        : "TẠM DỪNG"}
                    </button>

                    <button
                      className="btn-close"
                      disabled={
                        commandLoading !==
                        null
                      }
                      onClick={() =>
                        sendCommand(
                          bot,
                          COMMANDS.CLOSE_ALL
                        )
                      }
                    >
                      {closeLoading
                        ? "ĐANG GỬI..."
                        : "CLOSE ALL"}
                    </button>

                    <button
                      className="btn-kill"
                      disabled={
                        commandLoading !==
                        null
                      }
                      onClick={() =>
                        sendCommand(
                          bot,
                          COMMANDS.KILL
                        )
                      }
                    >
                      {killLoading
                        ? "ĐANG GỬI..."
                        : "KILL"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

// ============================================================
// METRIC
// ============================================================

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>

      <strong>
        {value ?? "--"}
      </strong>
    </div>
  );
}

// ============================================================
// MONEY
// ============================================================

function formatMoney(value) {
  const number = Number(value || 0);

  return number.toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );
}

// ============================================================
// DATE
// ============================================================

function formatDate(value) {
  try {
    return new Date(value).toLocaleString(
      "vi-VN",
      {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }
    );
  } catch {
    return "--";
  }
}
