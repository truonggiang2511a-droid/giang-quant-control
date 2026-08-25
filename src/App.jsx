import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { supabase } from "./supabase";
import { signIn, signOut } from "./auth";

const COMMANDS = {
  ENABLE: "ENABLE",
  PAUSE: "PAUSE",
  CLOSE_ALL: "CLOSE_ALL",
  KILL: "KILL",
};

function getBotStatus(bot, now = Date.now()) {
  if (!bot?.last_seen) {
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
    Math.floor((now - lastSeen) / 1000)
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
  return Number(value || 0).toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );
}

function formatDate(value) {
  if (!value) return "--";

  try {
    return new Date(value).toLocaleString(
      "vi-VN",
      {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }
    );
  } catch {
    return "--";
  }
}

function formatAgo(seconds) {
  if (seconds == null) return "--";

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  return `${Math.floor(seconds / 60)}m ago`;
}

export default function App() {
  const [session, setSession] = useState(null);
  const [checkingAuth, setCheckingAuth] =
    useState(true);

  const [page, setPage] =
    useState("dashboard");

  const [bots, setBots] = useState([]);
  const [commands, setCommands] =
    useState([]);

  const [pendingCommands, setPendingCommands] =
    useState({});

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [commandLoading, setCommandLoading] =
    useState(null);

  const [message, setMessage] =
    useState("");

  const [error, setError] =
    useState("");

  const [now, setNow] =
    useState(Date.now());

  // =========================================================
  // AUTH
  // =========================================================

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
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
        console.error(
          "AUTH ERROR",
          err
        );
      } finally {
        if (mounted) {
          setCheckingAuth(false);
        }
      }
    }

    initAuth();

    if (!supabase) {
      return () => {
        mounted = false;
      };
    }

    const {
      data: { subscription },
    } =
      supabase.auth.onAuthStateChange(
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

  // =========================================================
  // CLOCK
  // =========================================================

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // =========================================================
  // LOAD DATA
  // =========================================================

  async function loadData(showLoading = false) {
    if (!supabase) {
      setError(
        "Supabase chưa được cấu hình."
      );
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    try {
      setError("");

      const {
        data: botData,
        error: botError,
      } =
        await supabase
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
          .order(
            "created_at",
            { ascending: false }
          );

      if (botError) {
        throw botError;
      }

      const {
        data: commandData,
        error: commandError,
      } =
        await supabase
          .from("bot_commands")
          .select(`
            id,
            bot_instance_id,
            command,
            status,
            created_at,
            executed_at
          `)
          .order(
            "created_at",
            { ascending: false }
          )
          .limit(500);

      if (commandError) {
        throw commandError;
      }

      const safeBots =
        Array.isArray(botData)
          ? botData
          : [];

      const safeCommands =
        Array.isArray(commandData)
          ? commandData
          : [];

      setBots(safeBots);
      setCommands(safeCommands);

      const pending = {};

      for (const item of safeCommands) {
        if (
          item.status === "pending" &&
          !pending[item.bot_instance_id]
        ) {
          pending[item.bot_instance_id] =
            item;
        }
      }

      setPendingCommands(pending);
    } catch (err) {
      console.error(
        "LOAD ERROR",
        err
      );

      setError(
        err?.message ||
          "Không thể tải dữ liệu."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!session) return;

    loadData(true);

    const timer = setInterval(() => {
      loadData(false);
    }, 5000);

    return () => clearInterval(timer);
  }, [session]);

  // =========================================================
  // COMMAND
  // =========================================================

  async function sendCommand(
    bot,
    command
  ) {
    if (
      commandLoading ||
      pendingCommands[bot.id]
    ) {
      return;
    }

    setError("");
    setMessage("");

    if (
      command === COMMANDS.CLOSE_ALL ||
      command === COMMANDS.KILL
    ) {
      const confirmAction =
        window.confirm(
          `Xác nhận ${command} cho ${
            bot.ea_name ||
            "GIANG QUANT X"
          }?`
        );

      if (!confirmAction) {
        return;
      }
    }

    setCommandLoading(
      `${bot.id}-${command}`
    );

    try {
      const {
        data: pending,
        error: pendingError,
      } =
        await supabase
          .from("bot_commands")
          .select(
            "id, command, status"
          )
          .eq(
            "bot_instance_id",
            bot.id
          )
          .eq(
            "status",
            "pending"
          )
          .limit(1);

      if (pendingError) {
        throw pendingError;
      }

      if (
        pending &&
        pending.length
      ) {
        setError(
          `Bot đang có lệnh ${pending[0].command} chờ xử lý.`
        );
        return;
      }

      const {
        error: insertError,
      } =
        await supabase
          .from("bot_commands")
          .insert({
            bot_instance_id:
              bot.id,
            command,
            status: "pending",
            message:
              `Dashboard: ${command}`,
          });

      if (insertError) {
        throw insertError;
      }

      setMessage(
        `🟡 ${command} đã được gửi.`
      );

      await loadData(false);
    } catch (err) {
      console.error(
        "COMMAND ERROR",
        err
      );

      setError(
        err?.message ||
          "Không thể gửi lệnh."
      );
    } finally {
      setCommandLoading(null);
    }
  }

  // =========================================================
  // FILTER
  // =========================================================

  const preparedBots = useMemo(() => {
    return bots.map((bot) => ({
      ...bot,
      liveStatus:
        getBotStatus(bot, now),
    }));
  }, [bots, now]);

  const filteredBots = useMemo(() => {
    const keyword =
      search
        .trim()
        .toLowerCase();

    return preparedBots.filter(
      (bot) => {
        const account =
          bot.mt5_accounts;

        const searchable = [
          bot.ea_name,
          bot.symbol,
          bot.timeframe,
          account?.mt5_login,
          account?.broker,
          account?.server,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const matchesSearch =
          !keyword ||
          searchable.includes(
            keyword
          );

        const matchesFilter =
          filter === "ALL" ||
          bot.liveStatus.key ===
            filter.toLowerCase();

        return (
          matchesSearch &&
          matchesFilter
        );
      }
    );
  }, [
    preparedBots,
    search,
    filter,
  ]);

  // =========================================================
  // STATS
  // =========================================================

  const stats = useMemo(() => {
    return {
      total: preparedBots.length,

      online:
        preparedBots.filter(
          (b) =>
            b.liveStatus.key ===
            "online"
        ).length,

      warning:
        preparedBots.filter(
          (b) =>
            b.liveStatus.key ===
            "warning"
        ).length,

      paused:
        preparedBots.filter(
          (b) =>
            b.liveStatus.key ===
            "paused"
        ).length,

      offline:
        preparedBots.filter(
          (b) =>
            b.liveStatus.key ===
            "offline"
        ).length,
    };
  }, [preparedBots]);

  // =========================================================
  // LOADING
  // =========================================================

  if (checkingAuth) {
    return (
      <div className="loading-screen">
        <div>
          <div className="brand-mark">
            GQ
          </div>
          <p>
            Đang kiểm tra đăng nhập...
          </p>
        </div>
      </div>
    );
  }

  // =========================================================
  // LOGIN
  // =========================================================

  if (!session) {
    return <LoginScreen />;
  }

  // =========================================================
  // RENDER
  // =========================================================

  return (
    <div className="app-shell">
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
          <NavButton
            active={
              page === "dashboard"
            }
            onClick={() =>
              setPage("dashboard")
            }
          >
            Dashboard
          </NavButton>

          <NavButton
            active={
              page === "bots"
            }
            onClick={() =>
              setPage("bots")
            }
          >
            EA Bots
          </NavButton>

          <NavButton
            active={
              page === "mt5"
            }
            onClick={() =>
              setPage("mt5")
            }
          >
            MT5 Accounts
          </NavButton>

          <NavButton
            active={
              page === "licenses"
            }
            onClick={() =>
              setPage("licenses")
            }
          >
            Licenses
          </NavButton>

          <NavButton
            active={
              page === "commands"
            }
            onClick={() =>
              setPage("commands")
            }
          >
            Commands
          </NavButton>

          <NavButton
            active={
              page === "logs"
            }
            onClick={() =>
              setPage("logs")
            }
          >
            Activity Logs
          </NavButton>
        </nav>

        <div className="sidebar-footer">
          <div className="system-status">
            <span className="system-dot" />
            SYSTEM ONLINE
          </div>

          <div className="sidebar-location">
            Production · Singapore
          </div>

          <button
            className="logout-button"
            onClick={() =>
              signOut()
            }
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
            {error}
          </div>
        )}

        {page === "dashboard" && (
          <DashboardPage
            stats={stats}
            bots={preparedBots}
            loading={loading}
            refreshing={refreshing}
            setPage={setPage}
            onRefresh={async () => {
              setRefreshing(true);
              await loadData(false);
              setRefreshing(false);
            }}
          />
        )}

        {page === "bots" && (
          <BotsPage
            bots={filteredBots}
            search={search}
            setSearch={setSearch}
            filter={filter}
            setFilter={setFilter}
            pendingCommands={
              pendingCommands
            }
            commandLoading={
              commandLoading
            }
            sendCommand={
              sendCommand
            }
            refreshing={
              refreshing
            }
            onRefresh={async () => {
              setRefreshing(true);
              await loadData(false);
              setRefreshing(false);
            }}
          />
        )}

        {page === "mt5" && (
          <ModulePage
            eyebrow="ACCOUNTS"
            title="MT5 Accounts"
            description="Quản lý tài khoản MT5 được liên kết với EA."
            icon="◎"
          >
            <EmptyModule
              title="MT5 Accounts"
              description="Module quản lý tài khoản MT5 sẽ được kết nối trực tiếp với mt5_accounts."
            />
          </ModulePage>
        )}

        {page === "licenses" && (
          <ModulePage
            eyebrow="LICENSING"
            title="Licenses"
            description="Quản lý license và thời hạn sử dụng EA."
            icon="◇"
          >
            <EmptyModule
              title="Licenses"
              description="Module License sẽ kết nối với bảng licenses ở bước tiếp theo."
            />
          </ModulePage>
        )}

        {page === "commands" && (
          <CommandsPage
            commands={
              commands
            }
          />
        )}

        {page === "logs" && (
          <ModulePage
            eyebrow="SYSTEM"
            title="Activity Logs"
            description="Theo dõi hoạt động của hệ thống."
            icon="◌"
          >
            <EmptyModule
              title="Activity Logs"
              description="Phần nhật ký hệ thống sẽ dùng heartbeat_logs ở bước tiếp theo."
            />
          </ModulePage>
        )}
      </main>
    </div>
  );
}

// ============================================================
// NAV
// ============================================================

function NavButton({
  active,
  onClick,
  children,
}) {
  return (
    <button
      type="button"
      className={`nav-item ${
        active ? "active" : ""
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ============================================================
// DASHBOARD
// ============================================================

function DashboardPage({
  stats,
  bots,
  loading,
  refreshing,
  setPage,
  onRefresh,
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">
            COMMAND CENTER
          </div>

          <h1>
            EA Control Dashboard
          </h1>

          <p>
            Giám sát toàn bộ hệ thống EA MT5.
          </p>
        </div>

        <button
          className="refresh"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing
            ? "Đang cập nhật..."
            : "↻ Làm mới"}
        </button>
      </header>

      <section className="stats">
        <Stat
          label="TOTAL BOTS"
          value={stats.total}
          note="Tài khoản đã đăng ký"
        />

        <Stat
          label="ONLINE"
          value={stats.online}
          note="EA đang hoạt động"
          className="green"
        />

        <Stat
          label="WARNING / PAUSED"
          value={
            stats.warning +
            stats.paused
          }
          note="Cần chú ý"
          color="#f59e0b"
        />

        <Stat
          label="OFFLINE"
          value={stats.offline}
          note="Mất heartbeat"
          className="red"
        />
      </section>

      <section className="panel hero-panel">
        <div className="hero-content">
          <div>
            <span className="hero-kicker">
              GIANG QUANT X
            </span>

            <h2>
              AI EA COMMAND CENTER
            </h2>

            <p>
              Quản lý trạng thái, lệnh remote
              và hiệu suất EA từ một nơi.
            </p>
          </div>

          <button
            className="hero-button"
            onClick={() =>
              setPage("bots")
            }
          >
            QUẢN LÝ EA BOTS →
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>
              Active Bots
            </h2>

            <p>
              Trạng thái bot hiện tại.
            </p>
          </div>

          <button
            className="panel-link"
            onClick={() =>
              setPage("bots")
            }
          >
            Xem tất cả →
          </button>
        </div>

        {loading ? (
          <div className="empty">
            Đang tải bot...
          </div>
        ) : (
          <div className="mini-bot-grid">
            {bots
              .slice(0, 6)
              .map((bot) => (
                <MiniBot
                  key={bot.id}
                  bot={bot}
                />
              ))}
          </div>
        )}
      </section>
    </>
  );
}

// ============================================================
// BOTS PAGE
// ============================================================

function BotsPage({
  bots,
  search,
  setSearch,
  filter,
  setFilter,
  pendingCommands,
  commandLoading,
  sendCommand,
  refreshing,
  onRefresh,
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">
            EA MANAGEMENT
          </div>

          <h1>EA Bots</h1>

          <p>
            Điều khiển và theo dõi từng EA.
          </p>
        </div>

        <button
          className="refresh"
          onClick={onRefresh}
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
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="🔎 Tìm EA, MT5, broker, server..."
          />

          <select
            className="filter-select"
            value={filter}
            onChange={(e) =>
              setFilter(e.target.value)
            }
          >
            <option value="ALL">
              Tất cả
            </option>

            <option value="ONLINE">
              Online
            </option>

            <option value="WARNING">
              Warning
            </option>

            <option value="PAUSED">
              Paused
            </option>

            <option value="OFFLINE">
              Offline
            </option>
          </select>
        </div>

        {!bots.length ? (
          <EmptyModule
            title="Không tìm thấy bot"
            description="Không có bot nào phù hợp với bộ lọc."
          />
        ) : (
          <div className="bot-list">
            {bots.map((bot) => (
              <BotCard
                key={bot.id}
                bot={bot}
                pending={
                  pendingCommands[
                    bot.id
                  ]
                }
                commandLoading={
                  commandLoading
                }
                sendCommand={
                  sendCommand
                }
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

// ============================================================
// BOT CARD
// ============================================================

function BotCard({
  bot,
  pending,
  commandLoading,
  sendCommand,
}) {
  const account =
    bot.mt5_accounts;

  const liveStatus =
    bot.liveStatus;

  const isEnabled =
    bot.enabled === true;

  let stateText = isEnabled
    ? "RUNNING"
    : "PAUSED";

  let stateClass = isEnabled
    ? "running"
    : "paused";

  if (pending) {
    stateClass =
      "requested";

    stateText =
      `${pending.command} REQUESTED`;
  }

  return (
    <article className="bot-card">
      <div className="bot-top">
        <div>
          <div className="bot-title-row">
            <h3>
              {bot.ea_name ||
                "GIANG QUANT X"}
            </h3>

            <span
              className={`status ${liveStatus.key}`}
            >
              ● {liveStatus.label}
            </span>
          </div>

          <div className="bot-meta">
            V{bot.ea_version || "--"}
            {" · "}
            {bot.symbol || "--"}
            {" · "}
            {bot.timeframe || "--"}
          </div>
        </div>

        <div
          className={`state-pill ${stateClass}`}
        >
          {stateText}
        </div>
      </div>

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
          label="HEARTBEAT"
          value={formatAgo(
            liveStatus.seconds
          )}
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
          LAST SEEN:{" "}
          {formatDate(
            bot.last_seen
          )}
        </div>
      </div>

      <div className="bot-actions">
        {!isEnabled ? (
          <button
            className="btn-enable"
            disabled={
              commandLoading !==
                null ||
              pending !==
                undefined
            }
            onClick={() =>
              sendCommand(
                bot,
                COMMANDS.ENABLE
              )
            }
          >
            BẬT BOT
          </button>
        ) : (
          <button
            className="btn-pause"
            disabled={
              commandLoading !==
                null ||
              pending !==
                undefined
            }
            onClick={() =>
              sendCommand(
                bot,
                COMMANDS.PAUSE
              )
            }
          >
            TẮT BOT
          </button>
        )}

        <button
          className="btn-close"
          disabled={
            commandLoading !==
              null ||
            pending !==
              undefined
          }
          onClick={() =>
            sendCommand(
              bot,
              COMMANDS.CLOSE_ALL
            )
          }
        >
          ĐÓNG TẤT CẢ
        </button>

        <button
          className="btn-kill"
          disabled={
            commandLoading !==
              null ||
            pending !==
              undefined
          }
          onClick={() =>
            sendCommand(
              bot,
              COMMANDS.KILL
            )
          }
        >
          KILL
        </button>
      </div>
    </article>
  );
}

// ============================================================
// COMMANDS
// ============================================================

function CommandsPage({
  commands,
}) {
  const [filter, setFilter] =
    useState("ALL");

  const visibleCommands =
    useMemo(() => {
      if (filter === "ALL") {
        return commands;
      }

      return commands.filter(
        (item) =>
          String(
            item.status
          ).toUpperCase() ===
          filter
      );
    }, [
      commands,
      filter,
    ]);

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">
            REMOTE CONTROL
          </div>

          <h1>
            Commands
          </h1>

          <p>
            Lịch sử điều khiển EA.
          </p>
        </div>
      </header>

      <section className="panel">
        <div className="toolbar">
          <select
            className="filter-select"
            value={filter}
            onChange={(e) =>
              setFilter(
                e.target.value
              )
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
                <th>
                  CREATED
                </th>

                <th>
                  BOT
                </th>

                <th>
                  COMMAND
                </th>

                <th>
                  STATUS
                </th>

                <th>
                  EXECUTED
                </th>
              </tr>
            </thead>

            <tbody>
              {visibleCommands.map(
                (item) => (
                  <tr
                    key={item.id}
                  >
                    <td>
                      {formatDate(
                        item.created_at
                      )}
                    </td>

                    <td className="mono">
                      {String(
                        item.bot_instance_id
                      ).slice(
                        0,
                        12
                      )}
                      ...
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
                          item.status ===
                          "executed"
                            ? "executed"
                            : "pending"
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>

                    <td>
                      {item.executed_at
                        ? formatDate(
                            item.executed_at
                          )
                        : "--"}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ============================================================
// MODULE PAGE
// ============================================================

function ModulePage({
  eyebrow,
  title,
  description,
  icon,
  children,
}) {
  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">
            {eyebrow}
          </div>

          <h1>{title}</h1>

          <p>
            {description}
          </p>
        </div>
      </header>

      {children}
    </>
  );
}

// ============================================================
// MINI BOT
// ============================================================

function MiniBot({ bot }) {
  const account =
    bot.mt5_accounts;

  return (
    <div className="mini-bot-card">
      <div className="mini-bot-header">
        <strong>
          {bot.ea_name ||
            "GIANG QUANT X"}
        </strong>

        <span
          className={`status ${bot.liveStatus.key}`}
        >
          ●{" "}
          {bot.liveStatus.label}
        </span>
      </div>

      <div className="mini-bot-meta">
        MT5{" "}
        {account?.mt5_login ||
          "--"}
      </div>

      <div className="mini-bot-numbers">
        <span>
          Balance
          <b>
            {formatMoney(
              bot.balance
            )}
          </b>
        </span>

        <span>
          Equity
          <b>
            {formatMoney(
              bot.equity
            )}
          </b>
        </span>

        <span>
          DD
          <b>
            {Number(
              bot.drawdown ||
                0
            ).toFixed(2)}
            %
          </b>
        </span>
      </div>
    </div>
  );
}

// ============================================================
// STAT
// ============================================================

function Stat({
  label,
  value,
  note,
  className,
  color,
}) {
  return (
    <div className="stat-card">
      <span>{label}</span>

      <strong
        className={
          className || ""
        }
        style={
          color
            ? { color }
            : undefined
        }
      >
        {value}
      </strong>

      <small>
        {note}
      </small>
    </div>
  );
}

// ============================================================
// METRIC
// ============================================================

function Metric({
  label,
  value,
}) {
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
// EMPTY
// ============================================================

function EmptyModule({
  title,
  description,
}) {
  return (
    <div className="module-card">
      <div className="module-icon">
        ◈
      </div>

      <h3>
        {title}
      </h3>

      <p>
        {description}
      </p>
    </div>
  );
}

// ============================================================
// LOGIN
// ============================================================

function LoginScreen() {
  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  async function handleLogin(
    event
  ) {
    event.preventDefault();

    setLoading(true);
    setError("");

    try {
      if (!supabase) {
        throw new Error(
          "Supabase chưa được cấu hình."
        );
      }

      const {
        error: loginError,
      } = await signIn(
        email.trim(),
        password
      );

      if (loginError) {
        throw loginError;
      }
    } catch (err) {
      console.error(
        "LOGIN ERROR",
        err
      );

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
        <div className="login-logo">
          GQ
        </div>

        <div className="login-title">
          GIANG QUANT
        </div>

        <div className="login-subtitle">
          CONTROL CENTER
        </div>

        <h2>
          Đăng nhập quản trị
        </h2>

        <p>
          Khu vực quản lý EA MT5.
        </p>

        <form
          onSubmit={handleLogin}
        >
          <label>
            Email
          </label>

          <input
            type="email"
            value={email}
            onChange={(e) =>
              setEmail(
                e.target.value
              )
            }
            placeholder="Email quản trị"
            required
          />

          <label>
            Mật khẩu
          </label>

          <input
            type="password"
            value={password}
            onChange={(e) =>
              setPassword(
                e.target.value
              )
            }
            placeholder="••••••••"
            required
          />

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            className="login-button"
            type="submit"
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
