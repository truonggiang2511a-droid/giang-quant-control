import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { supabase } from "./supabase";

import {
  signIn,
  signOut,
} from "./auth";

const COMMANDS = {
  ENABLE: "ENABLE",
  PAUSE: "PAUSE",
  CLOSE_ALL: "CLOSE_ALL",
  KILL: "KILL",
};

const COMMAND_LABELS = {
  ENABLE: "BẬT BOT",
  PAUSE: "TẮT BOT",
  CLOSE_ALL: "ĐÓNG TẤT CẢ",
  KILL: "KILL",
};

// ============================================================
// BOT STATUS
// ============================================================

function getBotStatus(bot, currentTime = Date.now()) {
  if (!bot.last_seen) {
    return {
      key: "offline",
      label: "OFFLINE",
      seconds: null,
    };
  }

  const lastSeen = new Date(bot.last_seen).getTime();

  if (Number.isNaN(lastSeen)) {
    return {
      key: "offline",
      label: "OFFLINE",
      seconds: null,
    };
  }

  const seconds = Math.max(
    0,
    Math.floor((currentTime - lastSeen) / 1000)
  );

  if (seconds > 60) {
    return {
      key: "offline",
      label: "OFFLINE",
      seconds,
    };
  }

  if (seconds > 15) {
    return {
      key: "warning",
      label: "WARNING",
      seconds,
    };
  }

  if (bot.enabled === false) {
    return {
      key: "paused",
      label: "PAUSED",
      seconds,
    };
  }

  return {
    key: "online",
    label: "ONLINE",
    seconds,
  };
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return "--";

  try {
    return new Date(value).toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "--";
  }
}

function formatAgo(seconds) {
  if (seconds === null || seconds === undefined) {
    return "--";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  return `${Math.floor(seconds / 60)}m ago`;
}

// ============================================================
// APP
// ============================================================

export default function App() {
  // ==========================================================
  // AUTH
  // ==========================================================

  const [session, setSession] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // ==========================================================
  // DATA
  // ==========================================================

  const [bots, setBots] = useState([]);
  const [commands, setCommands] = useState([]);

  const [pendingCommands, setPendingCommands] = useState({});
  const [trackedCommands, setTrackedCommands] = useState({});

  // ==========================================================
  // UI
  // ==========================================================

  const [page, setPage] = useState("dashboard");
  const [botSearch, setBotSearch] = useState("");
  const [botFilter, setBotFilter] = useState("ALL");
  const [commandFilter, setCommandFilter] = useState("ALL");

  const [now, setNow] = useState(Date.now());

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [commandLoading, setCommandLoading] = useState(null);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // ==========================================================
  // AUTH
  // ==========================================================

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        if (!supabase) {
          setCheckingAuth(false);
          return;
        }

        const {
          data: { session: currentSession },
        } = await supabase.auth.getSession();

        if (mounted) {
          setSession(currentSession);
        }
      } catch (err) {
        console.error("AUTH ERROR:", err);
        if (mounted) {
          setSession(null);
        }
      } finally {
        if (mounted) {
          setCheckingAuth(false);
        }
      }
    }

    checkAuth();

    if (!supabase) {
      return () => {
        mounted = false;
      };
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (mounted) {
          setSession(newSession);
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // ==========================================================
  // CLOCK
  // ==========================================================

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // ==========================================================
  // LOAD DATA
  // ==========================================================

  async function loadData(showLoading = false) {
    if (!supabase) {
      setError("Supabase chưa được cấu hình.");
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    try {
      setError("");

      // --------------------------------------------------------
      // BOTS
      // --------------------------------------------------------

      const {
        data: botData,
        error: botError,
      } = await supabase
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

      if (botError) {
        throw botError;
      }

      // --------------------------------------------------------
      // COMMANDS
      // --------------------------------------------------------

      const {
        data: commandData,
        error: commandError,
      } = await supabase
        .from("bot_commands")
        .select(`
          id,
          bot_instance_id,
          command,
          status,
          message,
          created_at,
          executed_at
        `)
        .order("created_at", {
          ascending: false,
        })
        .limit(500);

      if (commandError) {
        throw commandError;
      }

      const safeBots = botData || [];
      const safeCommands = commandData || [];

      setBots(safeBots);
      setCommands(safeCommands);

      // --------------------------------------------------------
      // PENDING
      // --------------------------------------------------------

      const pendingMap = {};

      for (const item of safeCommands) {
        if (
          item.status === "pending" &&
          !pendingMap[item.bot_instance_id]
        ) {
          pendingMap[item.bot_instance_id] = item;
        }
      }

      setPendingCommands(pendingMap);

      // --------------------------------------------------------
      // TRACK EXECUTION
      // --------------------------------------------------------

      setTrackedCommands((current) => {
        const next = { ...current };

        for (const item of safeCommands) {
          if (
            item.status === "executed" &&
            next[item.bot_instance_id]?.commandId === item.id
          ) {
            next[item.bot_instance_id] = {
              ...next[item.bot_instance_id],
              command: item.command,
              status: "executed",
            };
          }
        }

        return next;
      });
    } catch (err) {
      console.error("LOAD ERROR:", err);
      setError(err?.message || "Không thể tải dữ liệu.");
    } finally {
      setLoading(false);
    }
  }

  // ==========================================================
  // AUTO REFRESH
  // ==========================================================

  useEffect(() => {
    if (!session) return;

    loadData(true);

    const timer = setInterval(() => {
      loadData(false);
    }, 5000);

    return () => clearInterval(timer);
  }, [session]);

  // ==========================================================
  // REFRESH
  // ==========================================================

  async function handleRefresh() {
    if (refreshing) return;

    setRefreshing(true);

    try {
      await loadData(false);
    } finally {
      setRefreshing(false);
    }
  }

  // ==========================================================
  // COMMAND
  // ==========================================================

  async function sendCommand(bot, command) {
    if (
      commandLoading ||
      pendingCommands[bot.id]
    ) {
      return;
    }

    setMessage("");
    setError("");

    if (
      command === COMMANDS.CLOSE_ALL ||
      command === COMMANDS.KILL
    ) {
      const ok = window.confirm(
        `Bạn có chắc muốn ${COMMAND_LABELS[command]} cho ${
          bot.ea_name || "GIANG QUANT X"
        }?`
      );

      if (!ok) return;
    }

    setCommandLoading(`${bot.id}-${command}`);

    try {
      const {
        data: pending,
        error: pendingError,
      } = await supabase
        .from("bot_commands")
        .select("id, command, status")
        .eq("bot_instance_id", bot.id)
        .eq("status", "pending")
        .order("created_at", {
          ascending: false,
        })
        .limit(1);

      if (pendingError) {
        throw pendingError;
      }

      if (pending?.length) {
        setError(
          `Bot đang có lệnh ${pending[0].command} chờ EA xử lý.`
        );
        return;
      }

      const {
        data: inserted,
        error: insertError,
      } = await supabase
        .from("bot_commands")
        .insert({
          bot_instance_id: bot.id,
          command,
          status: "pending",
          message: `Dashboard command: ${command}`,
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      setTrackedCommands((current) => ({
        ...current,
        [bot.id]: {
          command,
          commandId: inserted?.id,
          status: "pending",
        },
      }));

      setMessage(
        `🟡 ${COMMAND_LABELS[command]} đã được gửi.`
      );

      await loadData(false);
    } catch (err) {
      console.error("COMMAND ERROR:", err);

      setError(
        err?.message || "Không thể gửi lệnh."
      );
    } finally {
      setCommandLoading(null);
    }
  }

  // ==========================================================
  // STATUS
  // ==========================================================

  const botsWithStatus = useMemo(() => {
    return bots.map((bot) => ({
      ...bot,
      liveStatus: getBotStatus(bot, now),
    }));
  }, [bots, now]);

  // ==========================================================
  // STATS
  // ==========================================================

  const stats = useMemo(() => {
    return {
      total: botsWithStatus.length,
      online: botsWithStatus.filter(
        (bot) => bot.liveStatus.key === "online"
      ).length,
      warning: botsWithStatus.filter(
        (bot) => bot.liveStatus.key === "warning"
      ).length,
      paused: botsWithStatus.filter(
        (bot) => bot.liveStatus.key === "paused"
      ).length,
      offline: botsWithStatus.filter(
        (bot) => bot.liveStatus.key === "offline"
      ).length,
    };
  }, [botsWithStatus]);

  // ==========================================================
  // FILTER BOTS
  // ==========================================================

  const filteredBots = useMemo(() => {
    const keyword = botSearch.trim().toLowerCase();

    return botsWithStatus.filter((bot) => {
      const account = bot.mt5_accounts;

      const text = [
        bot.ea_name,
        bot.ea_version,
        bot.symbol,
        bot.timeframe,
        account?.mt5_login,
        account?.broker,
        account?.server,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchSearch =
        !keyword ||
        text.includes(keyword);

      const matchFilter =
        botFilter === "ALL" ||
        bot.liveStatus.key === botFilter.toLowerCase();

      return matchSearch && matchFilter;
    });
  }, [
    botsWithStatus,
    botSearch,
    botFilter,
  ]);

  // ==========================================================
  // FILTER COMMANDS
  // ==========================================================

  const filteredCommands = useMemo(() => {
    if (commandFilter === "ALL") {
      return commands;
    }

    return commands.filter(
      (item) =>
        String(item.status).toUpperCase() ===
        commandFilter
    );
  }, [commands, commandFilter]);

  // ==========================================================
  // LOGIN
  // ==========================================================

  if (checkingAuth) {
    return (
      <div className="loading-screen">
        <div>
          <div className="brand-mark">GQ</div>
          <p>Đang kiểm tra đăng nhập...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginScreen />;
  }

  // ==========================================================
  // DASHBOARD
  // ==========================================================

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">GQ</div>

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
          <button
            className={`nav-item ${
              page === "dashboard" ? "active" : ""
            }`}
            onClick={() => setPage("dashboard")}
          >
            Dashboard
          </button>

          <button
            className={`nav-item ${
              page === "bots" ? "active" : ""
            }`}
            onClick={() => setPage("bots")}
          >
            EA Bots
          </button>

          <button
            className="nav-item"
            onClick={() => setPage("mt5")}
          >
            MT5 Accounts
          </button>

          <button
            className="nav-item"
            onClick={() => setPage("licenses")}
          >
            Licenses
          </button>

          <button
            className={`nav-item ${
              page === "commands" ? "active" : ""
            }`}
            onClick={() => setPage("commands")}
          >
            Commands
          </button>

          <button
            className="nav-item"
            onClick={() => setPage("logs")}
          >
            Activity Logs
          </button>
        </nav>

        <div className="sidebar-footer">
          <div>Production · Singapore</div>

          <button
            className="logout-button"
            onClick={async () => {
              await signOut();
            }}
          >
            Đăng xuất
          </button>
        </div>
      </aside>

      <main className="main">
        {message && (
          <div className="alert success">
            {message}
          </div>
        )}

        {error && (
          <div className="alert error">
            <strong>Lỗi:</strong> {error}
          </div>
        )}

        {/* ======================================================
            DASHBOARD
        ====================================================== */}

        {page === "dashboard" && (
          <>
            <header className="topbar">
              <div>
                <div className="eyebrow">
                  BOT MANAGEMENT
                </div>

                <h1>EA Control Dashboard</h1>

                <p>
                  Tổng quan hệ thống EA MT5.
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

            <section className="stats">
              <StatCard
                label="TỔNG BOT"
                value={stats.total}
                note="Bot đã đăng ký"
              />

              <StatCard
                label="ONLINE"
                value={stats.online}
                note="Đang hoạt động"
                className="green"
              />

              <StatCard
                label="WARNING / PAUSED"
                value={stats.warning + stats.paused}
                note="Cần chú ý"
                color="#f59e0b"
              />

              <StatCard
                label="OFFLINE"
                value={stats.offline}
                note="Mất heartbeat"
                className="red"
              />
            </section>

            <section className="panel">
              <div className="panel-head">
                <div>
                  <h2>EA Bots</h2>
                  <p>
                    Giám sát bot đang hoạt động.
                  </p>
                </div>

                <span className="live-badge">
                  ● LIVE
                </span>
              </div>

              <div className="quick-actions">
                <button
                  onClick={() => setPage("bots")}
                >
                  Quản lý EA Bots →
                </button>

                <button
                  onClick={() => setPage("commands")}
                >
                  Xem Commands →
                </button>
              </div>

              <div className="mini-bot-grid">
                {botsWithStatus.slice(0, 6).map((bot) => (
                  <BotMiniCard
                    key={bot.id}
                    bot={bot}
                  />
                ))}
              </div>
            </section>
          </>
        )}

        {/* ======================================================
            EA BOTS
        ====================================================== */}

        {page === "bots" && (
          <>
            <header className="topbar">
              <div>
                <div className="eyebrow">
                  EA MANAGEMENT
                </div>

                <h1>EA Bots</h1>

                <p>
                  Quản lý và điều khiển từng EA.
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

            <section className="panel">
              <div className="toolbar">
                <input
                  className="search-input"
                  value={botSearch}
                  onChange={(e) =>
                    setBotSearch(e.target.value)
                  }
                  placeholder="🔎 Tìm EA, MT5, broker, server..."
                />

                <select
                  className="filter-select"
                  value={botFilter}
                  onChange={(e) =>
                    setBotFilter(e.target.value)
                  }
                >
                  <option value="ALL">
                    Tất cả trạng thái
                  </option>

                  <option value="online">
                    Online
                  </option>

                  <option value="warning">
                    Warning
                  </option>

                  <option value="paused">
                    Paused
                  </option>

                  <option value="offline">
                    Offline
                  </option>
                </select>
              </div>

              <div className="bot-list">
                {filteredBots.map((bot) => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    pendingCommands={pendingCommands}
                    trackedCommands={trackedCommands}
                    commandLoading={commandLoading}
                    sendCommand={sendCommand}
                  />
                ))}
              </div>

              {!loading &&
                filteredBots.length === 0 && (
                  <div className="empty">
                    <div className="empty-icon">
                      ◎
                    </div>

                    <h3>
                      Không tìm thấy bot
                    </h3>

                    <p>
                      Thử thay đổi bộ lọc hoặc từ khóa.
                    </p>
                  </div>
                )}
            </section>
          </>
        )}

        {/* ======================================================
            COMMANDS
        ====================================================== */}

        {page === "commands" && (
          <>
            <header className="topbar">
              <div>
                <div className="eyebrow">
                  REMOTE CONTROL
                </div>

                <h1>Commands</h1>

                <p>
                  Lịch sử lệnh điều khiển EA.
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

            <section className="panel">
              <div className="toolbar">
                <select
                  className="filter-select"
                  value={commandFilter}
                  onChange={(e) =>
                    setCommandFilter(e.target.value)
                  }
                >
                  <option value="ALL">
                    Tất cả
                  </option>

                  <option value="PENDING">
                    Pending
                  </option>

                  <option value="EXECUTED">
                    Executed
                  </option>
                </select>
              </div>

              <div className="command-table-wrap">
                <table className="command-table">
                  <thead>
                    <tr>
                      <th>THỜI GIAN</th>
                      <th>BOT ID</th>
                      <th>COMMAND</th>
                      <th>STATUS</th>
                      <th>EXECUTED</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredCommands.map((item) => (
                      <tr key={item.id}>
                        <td>
                          {formatDate(item.created_at)}
                        </td>

                        <td className="mono">
                          {item.bot_instance_id}
                        </td>

                        <td>
                          <span
                            className={`command-chip ${String(
                              item.command
                            ).toLowerCase()}`}
                          >
                            {item.command}
                          </span>
                        </td>

                        <td>
                          <span
                            className={`command-status ${
                              item.status === "executed"
                                ? "executed"
                                : "pending"
                            }`}
                          >
                            {item.status === "executed"
                              ? "EXECUTED"
                              : "PENDING"}
                          </span>
                        </td>

                        <td>
                          {item.executed_at
                            ? formatDate(item.executed_at)
                            : "--"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!filteredCommands.length && (
                <div className="empty">
                  Chưa có command.
                </div>
              )}
            </section>
          </>
        )}

        {/* ======================================================
            PLACEHOLDER MODULES
        ====================================================== */}

        {(page === "mt5" ||
          page === "licenses" ||
          page === "logs") && (
          <section className="panel module-placeholder">
            <div className="empty">
              <div className="empty-icon">◈</div>

              <h3>
                {page === "mt5"
                  ? "MT5 Accounts"
                  : page === "licenses"
                    ? "Licenses"
                    : "Activity Logs"}
              </h3>

              <p>
                Module này sẽ được kết nối vào dữ liệu
                thật ở bước tiếp theo.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

// ============================================================
// BOT CARD
// ============================================================

function BotCard({
  bot,
  pendingCommands,
  trackedCommands,
  commandLoading,
  sendCommand,
}) {
  const account = bot.mt5_accounts;
  const liveStatus = bot.liveStatus;

  const pending = pendingCommands[bot.id];
  const tracked = trackedCommands[bot.id];

  const isEnabled = bot.enabled === true;

  let stateText = isEnabled
    ? "RUNNING"
    : "PAUSED";

  let stateClass = isEnabled
    ? "running"
    : "paused";

  if (pending) {
    stateClass = "requested";

    if (pending.command === COMMANDS.ENABLE) {
      stateText = "ENABLE REQUESTED";
    } else if (pending.command === COMMANDS.PAUSE) {
      stateText = "PAUSE REQUESTED";
    } else {
      stateText = `${pending.command} REQUESTED`;
    }
  }

  if (
    !pending &&
    tracked?.status === "executed"
  ) {
    if (
      tracked.command === COMMANDS.ENABLE &&
      isEnabled
    ) {
      stateText = "RUNNING";
      stateClass = "running";
    }

    if (
      tracked.command === COMMANDS.PAUSE &&
      !isEnabled
    ) {
      stateText = "PAUSED";
      stateClass = "paused";
    }
  }

  return (
    <article className="bot-card">
      <div className="bot-top">
        <div>
          <div className="bot-title-row">
            <h3>
              {bot.ea_name || "GIANG QUANT X"}
            </h3>

            <span
              className={`status ${liveStatus.key}`}
            >
              ● {liveStatus.label}
            </span>
          </div>

          <div className="bot-meta">
            V{bot.ea_version || "--"} ·{" "}
            {bot.symbol || "--"} ·{" "}
            {bot.timeframe || "--"}
          </div>
        </div>

        <div className={`state-pill ${stateClass}`}>
          {stateText}
        </div>
      </div>

      <div className="metrics">
        <Metric
          label="MT5 LOGIN"
          value={account?.mt5_login || "--"}
        />

        <Metric
          label="BROKER"
          value={account?.broker || "--"}
        />

        <Metric
          label="SERVER"
          value={account?.server || "--"}
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
          value={formatMoney(bot.daily_profit)}
        />

        <Metric
          label="DRAWDOWN"
          value={`${Number(
            bot.drawdown || 0
          ).toFixed(2)}%`}
        />

        <Metric
          label="HEARTBEAT"
          value={formatAgo(liveStatus.seconds)}
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
            {isEnabled ? " BẬT" : " TẮT"}
          </strong>
        </div>

        <div className="bot-id">
          LAST SEEN: {formatDate(bot.last_seen)}
        </div>
      </div>

      <div className="bot-actions">
        {!isEnabled ? (
          <button
            className="btn-enable"
            disabled={
              commandLoading !== null ||
              pending !== undefined
            }
            onClick={() =>
              sendCommand(bot, COMMANDS.ENABLE)
            }
          >
            {commandLoading ===
            `${bot.id}-ENABLE`
              ? "ĐANG GỬI..."
              : "BẬT BOT"}
          </button>
        ) : (
          <button
            className="btn-pause"
            disabled={
              commandLoading !== null ||
              pending !== undefined
            }
            onClick={() =>
              sendCommand(bot, COMMANDS.PAUSE)
            }
          >
            {commandLoading ===
            `${bot.id}-PAUSE`
              ? "ĐANG GỬI..."
              : "TẮT BOT"}
          </button>
        )}

        <button
          className="btn-close"
          disabled={
            commandLoading !== null ||
            pending !== undefined
          }
          onClick={() =>
            sendCommand(bot, COMMANDS.CLOSE_ALL)
          }
        >
          {commandLoading ===
          `${bot.id}-CLOSE_ALL`
            ? "ĐANG GỬI..."
            : "ĐÓNG TẤT CẢ"}
        </button>

        <button
          className="btn-kill"
          disabled={
            commandLoading !== null ||
            pending !== undefined
          }
          onClick={() =>
            sendCommand(bot, COMMANDS.KILL)
          }
        >
          {commandLoading ===
          `${bot.id}-KILL`
            ? "ĐANG GỬI..."
            : "KILL"}
        </button>
      </div>
    </article>
  );
}

// ============================================================
// MINI BOT
// ============================================================

function BotMiniCard({ bot }) {
  const account = bot.mt5_accounts;

  return (
    <div className="mini-bot-card">
      <div className="mini-bot-header">
        <strong>
          {bot.ea_name || "GIANG QUANT X"}
        </strong>

        <span className={`status ${bot.liveStatus.key}`}>
          ● {bot.liveStatus.label}
        </span>
      </div>

      <div className="mini-bot-meta">
        MT5 {account?.mt5_login || "--"}
      </div>

      <div className="mini-bot-numbers">
        <span>
          Balance
          <b>{formatMoney(bot.balance)}</b>
        </span>

        <span>
          Equity
          <b>{formatMoney(bot.equity)}</b>
        </span>

        <span>
          DD
          <b>
            {Number(
              bot.drawdown || 0
            ).toFixed(2)}%
          </b>
        </span>
      </div>
    </div>
  );
}

// ============================================================
// STAT CARD
// ============================================================

function StatCard({
  label,
  value,
  note,
  className = "",
  color,
}) {
  return (
    <div className="stat-card">
      <span>{label}</span>

      <strong
        className={className}
        style={color ? { color } : undefined}
      >
        {value}
      </strong>

      <small>{note}</small>
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
      <strong>{value ?? "--"}</strong>
    </div>
  );
}

// ============================================================
// LOGIN
// ============================================================

function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(event) {
    event.preventDefault();

    if (!supabase) {
      setError("Supabase chưa được cấu hình.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { error: loginError } =
        await signIn(
          email.trim(),
          password
        );

      if (loginError) {
        throw loginError;
      }
    } catch (err) {
      console.error("LOGIN ERROR:", err);

      setError(
        "Email hoặc mật khẩu không chính xác."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">GQ</div>

        <div className="login-title">
          GIANG QUANT
        </div>

        <div className="login-subtitle">
          CONTROL CENTER
        </div>

        <h2>Đăng nhập quản trị</h2>

        <p>
          Khu vực quản lý EA MT5.
        </p>

        <form onSubmit={handleLogin}>
          <label>Email</label>

          <input
            type="email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            placeholder="Email quản trị"
            autoComplete="username"
            required
          />

          <label>Mật khẩu</label>

          <input
            type="password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading
              ? "ĐANG ĐĂNG NHẬP..."
              : "ĐĂNG NHẬP"}
          </button>
        </form>
      </div>
    </div>
  );
}
