import React, {
  Component,
  useEffect,
  useMemo,
  useState,
} from "react";

import { supabase } from "./supabase";
import { signIn, signOut } from "./auth";

/* =========================================================
   CONSTANTS
========================================================= */

const COMMANDS = {
  ENABLE: "ENABLE",
  PAUSE: "PAUSE",
  CLOSE_ALL: "CLOSE_ALL",
  KILL: "KILL",
};

const NAV_ITEMS = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "▦",
  },
  {
    id: "bots",
    label: "EA Bots",
    icon: "◉",
  },
  {
    id: "mt5",
    label: "MT5 Accounts",
    icon: "◎",
  },
  {
    id: "licenses",
    label: "Licenses",
    icon: "◇",
  },
  {
    id: "commands",
    label: "Commands",
    icon: "↯",
  },
  {
    id: "logs",
    label: "Activity Logs",
    icon: "◌",
  },
];

/* =========================================================
   ERROR BOUNDARY
   Không để Dashboard trắng khi component lỗi.
========================================================= */

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, info) {
    console.error(
      "GIANG QUANT UI ERROR:",
      error,
      info
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fatal-screen">
          <div className="fatal-card">
            <div className="fatal-icon">!</div>

            <h1>Dashboard gặp lỗi</h1>

            <p>
              Một thành phần giao diện đang gặp
              vấn đề. Dữ liệu EA và Supabase
              không bị xóa.
            </p>

            <button
              className="primary-button"
              onClick={() =>
                window.location.reload()
              }
            >
              TẢI LẠI DASHBOARD
            </button>

            <button
              className="secondary-button"
              onClick={() =>
                this.setState({
                  hasError: false,
                  error: null,
                })
              }
            >
              THỬ LẠI
            </button>

            <details className="error-details">
              <summary>Chi tiết kỹ thuật</summary>

              <pre>
                {String(
                  this.state.error?.message ||
                    this.state.error
                )}
              </pre>
            </details>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/* =========================================================
   HELPERS
========================================================= */

function getBotStatus(bot, now = Date.now()) {
  if (!bot?.last_seen) {
    return {
      key: "offline",
      label: "OFFLINE",
      seconds: null,
    };
  }

  const lastSeen =
    new Date(bot.last_seen).getTime();

  if (Number.isNaN(lastSeen)) {
    return {
      key: "offline",
      label: "OFFLINE",
      seconds: null,
    };
  }

  const seconds = Math.max(
    0,
    Math.floor(
      (now - lastSeen) / 1000
    )
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

function getAccount(bot) {
  if (!bot?.mt5_accounts) {
    return null;
  }

  if (Array.isArray(bot.mt5_accounts)) {
    return bot.mt5_accounts[0] || null;
  }

  return bot.mt5_accounts;
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
  if (!value) {
    return "--";
  }

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
  if (
    seconds === null ||
    seconds === undefined
  ) {
    return "--";
  }

  if (seconds < 60) {
    return `${seconds}s`;
  }

  return `${Math.floor(seconds / 60)}m`;
}

/* =========================================================
   ROOT
========================================================= */

export default function App() {
  return (
    <AppErrorBoundary>
      <ControlCenter />
    </AppErrorBoundary>
  );
}

/* =========================================================
   CONTROL CENTER
========================================================= */

function ControlCenter() {
  const [session, setSession] =
    useState(null);

  const [checkingAuth, setCheckingAuth] =
    useState(true);

  const [page, setPage] =
    useState("dashboard");

  const [bots, setBots] =
    useState([]);

  const [commands, setCommands] =
    useState([]);

  const [mt5Accounts, setMt5Accounts] =
    useState([]);

  const [licenses, setLicenses] =
    useState([]);

  const [logs, setLogs] =
    useState([]);

  const [pendingCommands, setPendingCommands] =
    useState({});

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

  const [search, setSearch] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("ALL");

  const [commandFilter, setCommandFilter] =
    useState("ALL");

  /* =======================================================
     AUTH
  ======================================================= */

  useEffect(() => {
    let mounted = true;

    async function initAuth() {
      try {
        if (!supabase) {
          setCheckingAuth(false);
          return;
        }

        const {
          data,
          error: authError,
        } =
          await supabase.auth.getSession();

        if (authError) {
          throw authError;
        }

        if (mounted) {
          setSession(data.session);
        }
      } catch (err) {
        console.error(
          "AUTH ERROR:",
          err
        );

        if (mounted) {
          setSession(null);
        }
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
      data: authListener,
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

      authListener.subscription.unsubscribe();
    };
  }, []);

  /* =======================================================
     LIVE CLOCK
  ======================================================= */

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  /* =======================================================
     LOAD DATA
  ======================================================= */

  async function loadData(
    showLoading = false
  ) {
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

      /* ================================================
         BOTS
      ================================================= */

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
          created_at
        `)
        .order("created_at", {
          ascending: false,
        });

      if (botError) {
        throw botError;
      }

      /* ================================================
         MT5
      ================================================= */

      const {
        data: mt5Data,
        error: mt5Error,
      } = await supabase
        .from("mt5_accounts")
        .select(`
          id,
          mt5_login,
          broker,
          server,
          status
        `)
        .order("mt5_login", {
          ascending: true,
        });

      if (mt5Error) {
        console.warn(
          "MT5 LOAD:",
          mt5Error.message
        );
      }

      /* ================================================
         LICENSES
      ================================================= */

      const {
        data: licenseData,
        error: licenseError,
      } = await supabase
        .from("licenses")
        .select(`
          id,
          license_key,
          mt5_account_id,
          status,
          expire_date,
          product
        `)
        .order("expire_date", {
          ascending: true,
        });

      if (licenseError) {
        console.warn(
          "LICENSE LOAD:",
          licenseError.message
        );
      }

      /* ================================================
         COMMANDS
      ================================================= */

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

      /* ================================================
         HEARTBEAT LOGS
      ================================================= */

      const {
        data: logData,
        error: logError,
      } = await supabase
        .from("heartbeat_logs")
        .select(`
          id,
          bot_instance_id,
          balance,
          equity,
          daily_profit,
          drawdown,
          symbol,
          ea_version,
          status,
          created_at
        `)
        .order("created_at", {
          ascending: false,
        })
        .limit(200);

      if (logError) {
        console.warn(
          "LOG LOAD:",
          logError.message
        );
      }

      const safeBots =
        Array.isArray(botData)
          ? botData
          : [];

      const safeCommands =
        Array.isArray(commandData)
          ? commandData
          : [];

      setMt5Accounts(
        Array.isArray(mt5Data)
          ? mt5Data
          : []
      );

      setLicenses(
        Array.isArray(licenseData)
          ? licenseData
          : []
      );

      setLogs(
        Array.isArray(logData)
          ? logData
          : []
      );

      /* ================================================
         MERGE MT5 INTO BOT
      ================================================= */

      const accountMap = new Map(
        (
          Array.isArray(mt5Data)
            ? mt5Data
            : []
        ).map((account) => [
          account.id,
          account,
        ])
      );

      const mergedBots =
        safeBots.map((bot) => ({
          ...bot,
          mt5_accounts:
            accountMap.get(
              bot.mt5_account_id
            ) || null,
        }));

      setBots(mergedBots);

      setCommands(safeCommands);

      /* ================================================
         PENDING COMMANDS
      ================================================= */

      const pendingMap = {};

      for (const command of safeCommands) {
        if (
          command.status ===
            "pending" &&
          !pendingMap[
            command.bot_instance_id
          ]
        ) {
          pendingMap[
            command.bot_instance_id
          ] = command;
        }
      }

      setPendingCommands(
        pendingMap
      );
    } catch (err) {
      console.error(
        "DATABASE LOAD ERROR:",
        err
      );

      setError(
        err?.message ||
          "Không thể tải dữ liệu từ Supabase."
      );
    } finally {
      setLoading(false);
    }
  }

  /* =======================================================
     AUTO REFRESH
  ======================================================= */

  useEffect(() => {
    if (!session) {
      return;
    }

    loadData(true);

    const timer = setInterval(() => {
      loadData(false);
    }, 5000);

    return () => {
      clearInterval(timer);
    };
  }, [session]);

  /* =======================================================
     REFRESH
  ======================================================= */

  async function refresh() {
    if (refreshing) {
      return;
    }

    setRefreshing(true);

    try {
      await loadData(false);
    } finally {
      setRefreshing(false);
    }
  }

  /* =======================================================
     SEND COMMAND
  ======================================================= */

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
      command ===
        COMMANDS.CLOSE_ALL ||
      command ===
        COMMANDS.KILL
    ) {
      const confirmed =
        window.confirm(
          `Xác nhận ${
            command ===
              COMMANDS.CLOSE_ALL
              ? "ĐÓNG TẤT CẢ"
              : "KILL"
          } cho ${
            bot.ea_name ||
            "GIANG QUANT X"
          }?`
        );

      if (!confirmed) {
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
      } = await supabase
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
          `Bot đang có lệnh ${pending[0].command} chờ EA xử lý.`
        );

        return;
      }

      const {
        error: insertError,
      } = await supabase
        .from("bot_commands")
        .insert({
          bot_instance_id:
            bot.id,

          command,

          status: "pending",

          message:
            `Dashboard command: ${command}`,
        });

      if (insertError) {
        throw insertError;
      }

      setMessage(
        `🟡 ${command} đã được gửi. Đang chờ EA xác nhận...`
      );

      await loadData(false);
    } catch (err) {
      console.error(
        "COMMAND ERROR:",
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

  /* =======================================================
     PREPARED BOTS
  ======================================================= */

  const preparedBots = useMemo(
    () =>
      bots.map((bot) => ({
        ...bot,
        liveStatus:
          getBotStatus(bot, now),
      })),
    [bots, now]
  );

  /* =======================================================
     STATS
  ======================================================= */

  const stats = useMemo(() => {
    return {
      total: preparedBots.length,

      online:
        preparedBots.filter(
          (bot) =>
            bot.liveStatus.key ===
            "online"
        ).length,

      warning:
        preparedBots.filter(
          (bot) =>
            bot.liveStatus.key ===
            "warning"
        ).length,

      paused:
        preparedBots.filter(
          (bot) =>
            bot.liveStatus.key ===
            "paused"
        ).length,

      offline:
        preparedBots.filter(
          (bot) =>
            bot.liveStatus.key ===
            "offline"
        ).length,
    };
  }, [preparedBots]);

  /* =======================================================
     FILTERED BOTS
  ======================================================= */

  const filteredBots = useMemo(() => {
    const q =
      search
        .trim()
        .toLowerCase();

    return preparedBots.filter(
      (bot) => {
        const account =
          getAccount(bot);

        const searchable = [
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
          !q ||
          searchable.includes(q);

        const matchStatus =
          statusFilter === "ALL" ||
          bot.liveStatus.key ===
            statusFilter;

        return (
          matchSearch &&
          matchStatus
        );
      }
    );
  }, [
    preparedBots,
    search,
    statusFilter,
  ]);

  /* =======================================================
     FILTERED COMMANDS
  ======================================================= */

  const filteredCommands =
    useMemo(() => {
      if (
        commandFilter ===
        "ALL"
      ) {
        return commands;
      }

      return commands.filter(
        (command) =>
          String(
            command.status
          ).toUpperCase() ===
          commandFilter
      );
    }, [
      commands,
      commandFilter,
    ]);

  /* =======================================================
     AUTH LOADING
  ======================================================= */

  if (checkingAuth) {
    return (
      <LoadingScreen
        text="Đang kiểm tra quản trị viên..."
      />
    );
  }

  /* =======================================================
     LOGIN
  ======================================================= */

  if (!session) {
    return (
      <LoginScreen />
    );
  }

  /* =======================================================
     UI
  ======================================================= */

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
        onLogout={() => signOut()}
      />

      <main className="main">
        <Topbar
          page={page}
          refresh={refresh}
          refreshing={
            refreshing
          }
          session={session}
        />

        {message && (
          <div className="alert success">
            <span>
              {message}
            </span>
          </div>
        )}

        {error && (
          <div className="alert error">
            <span>
              {error}
            </span>

            <button
              onClick={() =>
                setError("")
              }
            >
              ×
            </button>
          </div>
        )}

        {page === "dashboard" && (
          <DashboardPage
            stats={stats}
            bots={preparedBots}
            loading={loading}
            setPage={setPage}
          />
        )}

        {page === "bots" && (
          <BotsPage
            bots={filteredBots}
            search={search}
            setSearch={setSearch}
            statusFilter={
              statusFilter
            }
            setStatusFilter={
              setStatusFilter
            }
            pendingCommands={
              pendingCommands
            }
            commandLoading={
              commandLoading
            }
            sendCommand={
              sendCommand
            }
            loading={loading}
          />
        )}

        {page === "mt5" && (
          <MT5Page
            accounts={
              mt5Accounts
            }
          />
        )}

        {page === "licenses" && (
          <LicensesPage
            licenses={
              licenses
            }
          />
        )}

        {page === "commands" && (
          <CommandsPage
            commands={
              filteredCommands
            }
            commandFilter={
              commandFilter
            }
            setCommandFilter={
              setCommandFilter
            }
          />
        )}

        {page === "logs" && (
          <LogsPage
            logs={logs}
          />
        )}
      </main>
    </div>
  );
}

/* =========================================================
   SIDEBAR
========================================================= */

function Sidebar({
  page,
  setPage,
  onLogout,
}) {
  return (
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

      <nav className="main-nav">
        {NAV_ITEMS.map(
          (item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${
                page === item.id
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setPage(item.id)
              }
            >
              <span className="nav-icon">
                {item.icon}
              </span>

              <span>
                {item.label}
              </span>
            </button>
          )
        )}
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
          onClick={onLogout}
        >
          ĐĂNG XUẤT
        </button>
      </div>
    </aside>
  );
}

/* =========================================================
   TOPBAR
========================================================= */

function Topbar({
  page,
  refresh,
  refreshing,
  session,
}) {
  const titles = {
    dashboard: [
      "COMMAND CENTER",
      "EA Control Dashboard",
      "Giám sát toàn bộ hệ thống EA MT5.",
    ],

    bots: [
      "EA MANAGEMENT",
      "EA Bots",
      "Quản lý và điều khiển từng EA.",
    ],

    mt5: [
      "ACCOUNTS",
      "MT5 Accounts",
      "Tài khoản MT5 được liên kết với hệ thống.",
    ],

    licenses: [
      "LICENSING",
      "Licenses",
      "Quản lý license và thời hạn EA.",
    ],

    commands: [
      "REMOTE CONTROL",
      "Commands",
      "Lịch sử điều khiển từ Dashboard.",
    ],

    logs: [
      "SYSTEM MONITOR",
      "Activity Logs",
      "Heartbeat và hoạt động hệ thống.",
    ],
  };

  const current =
    titles[page] ||
    titles.dashboard;

  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">
          {current[0]}
        </div>

        <h1>
          {current[1]}
        </h1>

        <p>
          {current[2]}
        </p>
      </div>

      <div className="topbar-actions">
        <div className="admin-badge">
          <span className="admin-dot" />

          {session?.user?.email ||
            "ADMIN"}
        </div>

        <button
          className="refresh"
          onClick={refresh}
          disabled={refreshing}
        >
          {refreshing
            ? "Đang cập nhật..."
            : "↻ Làm mới"}
        </button>
      </div>
    </header>
  );
}

/* =========================================================
   DASHBOARD
========================================================= */

function DashboardPage({
  stats,
  bots,
  loading,
  setPage,
}) {
  return (
    <>
      <section className="stats">
        <StatCard
          label="TOTAL BOTS"
          value={
            stats.total
          }
          note="Bot đã đăng ký"
        />

        <StatCard
          label="ONLINE"
          value={
            stats.online
          }
          note="EA đang hoạt động"
          color="green"
        />

        <StatCard
          label="PAUSED"
          value={
            stats.paused
          }
          note="EA đang tạm dừng"
          color="orange"
        />

        <StatCard
          label="OFFLINE"
          value={
            stats.offline
          }
          note="Mất heartbeat"
          color="red"
        />
      </section>

      <section className="hero-panel">
        <div className="hero-glow" />

        <div className="hero-content">
          <div>
            <span className="hero-kicker">
              GIANG QUANT X
            </span>

            <h2>
              EA COMMAND CENTER
            </h2>

            <p>
              Một trung tâm duy nhất để theo
              dõi, điều khiển và quản lý EA MT5.
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
              Trạng thái trực tiếp.
            </p>
          </div>

          <span className="live-badge">
            ● LIVE
          </span>
        </div>

        {loading ? (
          <LoadingBlock />
        ) : bots.length === 0 ? (
          <EmptyBlock
            icon="◉"
            title="Chưa có bot"
            description="Chạy EA trên MT5 để đăng ký bot."
          />
        ) : (
          <div className="mini-bot-grid">
            {bots
              .slice(0, 6)
              .map((bot) => (
                <MiniBotCard
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

/* =========================================================
   EA BOTS
========================================================= */

function BotsPage({
  bots,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  pendingCommands,
  commandLoading,
  sendCommand,
  loading,
}) {
  return (
    <>
      <section className="panel">
        <div className="toolbar">
          <div className="search-wrap">
            <span>⌕</span>

            <input
              className="search-input"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Tìm EA, MT5, broker, server..."
            />
          </div>

          <select
            className="filter-select"
            value={
              statusFilter
            }
            onChange={(event) =>
              setStatusFilter(
                event.target.value
              )
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

        {loading ? (
          <LoadingBlock />
        ) : bots.length === 0 ? (
          <EmptyBlock
            icon="⌕"
            title="Không tìm thấy bot"
            description="Thử thay đổi từ khóa hoặc bộ lọc."
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

/* =========================================================
   BOT CARD
========================================================= */

function BotCard({
  bot,
  pending,
  commandLoading,
  sendCommand,
}) {
  const account =
    getAccount(bot);

  const status =
    bot.liveStatus;

  const isEnabled =
    bot.enabled === true;

  const busy =
    commandLoading !== null ||
    pending !== undefined;

  let stateText = isEnabled
    ? "RUNNING"
    : "PAUSED";

  let stateClass = isEnabled
    ? "running"
    : "paused";

  if (pending) {
    stateText =
      `${String(
        pending.command
      ).toUpperCase()} REQUESTED`;

    stateClass =
      "requested";
  }

  return (
    <article className="bot-card">
      <div className="bot-card-header">
        <div>
          <div className="bot-name-row">
            <div className="bot-symbol">
              GQ
            </div>

            <div>
              <h3>
                {bot.ea_name ||
                  "GIANG QUANT X"}
              </h3>

              <div className="bot-subtitle">
                V
                {bot.ea_version ||
                  "--"}
                {" · "}
                {bot.symbol ||
                  "--"}
                {" · "}
                {bot.timeframe ||
                  "--"}
              </div>
            </div>
          </div>
        </div>

        <div className="bot-status-group">
          <span
            className={`status ${status.key}`}
          >
            ●{" "}
            {status.label}
          </span>

          <span
            className={`state-pill ${stateClass}`}
          >
            {stateText}
          </span>
        </div>
      </div>

      <div className="bot-details">
        <DataBox
          label="MT5 LOGIN"
          value={
            account?.mt5_login ||
            "--"
          }
        />

        <DataBox
          label="BROKER"
          value={
            account?.broker ||
            "--"
          }
        />

        <DataBox
          label="SERVER"
          value={
            account?.server ||
            "--"
          }
        />

        <DataBox
          label="BALANCE"
          value={formatMoney(
            bot.balance
          )}
        />

        <DataBox
          label="EQUITY"
          value={formatMoney(
            bot.equity
          )}
        />

        <DataBox
          label="DAILY PNL"
          value={formatMoney(
            bot.daily_profit
          )}
        />

        <DataBox
          label="DRAWDOWN"
          value={`${Number(
            bot.drawdown ||
              0
          ).toFixed(2)}%`}
        />

        <DataBox
          label="HEARTBEAT"
          value={
            status.seconds ===
            null
              ? "--"
              : `${formatAgo(
                  status.seconds
                )} ago`
          }
        />
      </div>

      <div className="bot-bottom">
        <div>
          <span className="remote-label">
            REMOTE
          </span>

          <strong
            className={
              isEnabled
                ? "remote-on"
                : "remote-off"
            }
          >
            {isEnabled
              ? "BẬT"
              : "TẮT"}
          </strong>
        </div>

        <div className="last-seen">
          Last seen:
          {" "}
          {formatDate(
            bot.last_seen
          )}
        </div>
      </div>

      <div className="bot-actions">
        {isEnabled ? (
          <button
            className="btn-pause"
            disabled={busy}
            onClick={() =>
              sendCommand(
                bot,
                COMMANDS.PAUSE
              )
            }
          >
            {commandLoading ===
            `${bot.id}-${COMMANDS.PAUSE}`
              ? "ĐANG GỬI..."
              : "TẮT BOT"}
          </button>
        ) : (
          <button
            className="btn-enable"
            disabled={busy}
            onClick={() =>
              sendCommand(
                bot,
                COMMANDS.ENABLE
              )
            }
          >
            {commandLoading ===
            `${bot.id}-${COMMANDS.ENABLE}`
              ? "ĐANG GỬI..."
              : "BẬT BOT"}
          </button>
        )}

        <button
          className="btn-close"
          disabled={busy}
          onClick={() =>
            sendCommand(
              bot,
              COMMANDS.CLOSE_ALL
            )
          }
        >
          {commandLoading ===
          `${bot.id}-${COMMANDS.CLOSE_ALL}`
            ? "ĐANG GỬI..."
            : "ĐÓNG TẤT CẢ"}
        </button>

        <button
          className="btn-kill"
          disabled={busy}
          onClick={() =>
            sendCommand(
              bot,
              COMMANDS.KILL
            )
          }
        >
          {commandLoading ===
          `${bot.id}-${COMMANDS.KILL}`
            ? "ĐANG GỬI..."
            : "KILL"}
        </button>
      </div>
    </article>
  );
}

/* =========================================================
   MT5
========================================================= */

function MT5Page({
  accounts,
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>
            MT5 Accounts
          </h2>

          <p>
            Tài khoản MT5 đang có trong Supabase.
          </p>
        </div>

        <span className="count-badge">
          {accounts.length}
          {" "}ACCOUNTS
        </span>
      </div>

      {accounts.length === 0 ? (
        <EmptyBlock
          icon="◎"
          title="Chưa có MT5 Account"
          description="Chưa có tài khoản MT5 được đăng ký."
        />
      ) : (
        <div className="account-grid">
          {accounts.map(
            (account) => (
              <div
                className="account-card"
                key={account.id}
              >
                <div className="account-icon">
                  MT5
                </div>

                <div className="account-main">
                  <h3>
                    {account.mt5_login}
                  </h3>

                  <p>
                    {account.broker ||
                      "--"}
                  </p>

                  <span>
                    {account.server ||
                      "--"}
                  </span>
                </div>

                <span
                  className={`status ${
                    String(
                      account.status
                    ).toLowerCase() ===
                    "active"
                      ? "online"
                      : "offline"
                  }`}
                >
                  ●{" "}
                  {account.status ||
                    "--"}
                </span>
              </div>
            )
          )}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   LICENSES
========================================================= */

function LicensesPage({
  licenses,
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>
            Licenses
          </h2>

          <p>
            License được quản lý từ Supabase.
          </p>
        </div>

        <span className="count-badge">
          {licenses.length}
          {" "}LICENSES
        </span>
      </div>

      {licenses.length === 0 ? (
        <EmptyBlock
          icon="◇"
          title="Chưa có License"
          description="Chưa có license nào trong database."
        />
      ) : (
        <div className="license-list">
          {licenses.map(
            (license) => {
              const expired =
                license.expire_date &&
                new Date(
                  `${license.expire_date}T23:59:59`
                ).getTime() <
                  Date.now();

              const active =
                String(
                  license.status
                ).toLowerCase() ===
                  "active" &&
                !expired;

              return (
                <div
                  className="license-card"
                  key={license.id}
                >
                  <div className="license-key">
                    <span>
                      LICENSE KEY
                    </span>

                    <strong>
                      {license.license_key ||
                        "--"}
                    </strong>
                  </div>

                  <div className="license-meta">
                    <span>
                      Product
                      <b>
                        {license.product ||
                          "GIANG QUANT X"}
                      </b>
                    </span>

                    <span>
                      Expire
                      <b>
                        {license.expire_date ||
                          "--"}
                      </b>
                    </span>
                  </div>

                  <span
                    className={`license-status ${
                      active
                        ? "active"
                        : "disabled"
                    }`}
                  >
                    {active
                      ? "ACTIVE"
                      : expired
                        ? "EXPIRED"
                        : "DISABLED"}
                  </span>
                </div>
              );
            }
          )}
        </div>
      )}
    </section>
  );
}

/* =========================================================
   COMMANDS
========================================================= */

function CommandsPage({
  commands,
  commandFilter,
  setCommandFilter,
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>
            Command History
          </h2>

          <p>
            Lịch sử điều khiển EA từ Dashboard.
          </p>
        </div>

        <select
          className="filter-select"
          value={
            commandFilter
          }
          onChange={(event) =>
            setCommandFilter(
              event.target.value
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

      {commands.length === 0 ? (
        <EmptyBlock
          icon="↯"
          title="Chưa có command"
          description="Các lệnh điều khiển EA sẽ xuất hiện ở đây."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>BOT</th>
                <th>COMMAND</th>
                <th>STATUS</th>
                <th>EXECUTED</th>
              </tr>
            </thead>

            <tbody>
              {commands.map(
                (command) => (
                  <tr
                    key={
                      command.id
                    }
                  >
                    <td>
                      {formatDate(
                        command.created_at
                      )}
                    </td>

                    <td className="mono">
                      {String(
                        command.bot_instance_id
                      ).slice(
                        0,
                        12
                      )}
                      ...
                    </td>

                    <td>
                      <span
                        className={`command-chip ${String(
                          command.command
                        ).toLowerCase()}`}
                      >
                        {command.command}
                      </span>
                    </td>

                    <td>
                      <span
                        className={`command-status ${
                          command.status ===
                          "executed"
                            ? "executed"
                            : "pending"
                        }`}
                      >
                        {String(
                          command.status
                        ).toUpperCase()}
                      </span>
                    </td>

                    <td>
                      {formatDate(
                        command.executed_at
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* =========================================================
   ACTIVITY LOGS
========================================================= */

function LogsPage({
  logs,
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>
            Activity Logs
          </h2>

          <p>
            Heartbeat và dữ liệu hoạt động gần nhất.
          </p>
        </div>

        <span className="count-badge">
          {logs.length}
          {" "}LOGS
        </span>
      </div>

      {logs.length === 0 ? (
        <EmptyBlock
          icon="◌"
          title="Chưa có Activity Logs"
          description="Heartbeat_logs sẽ xuất hiện khi EA gửi heartbeat."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>BOT</th>
                <th>BALANCE</th>
                <th>EQUITY</th>
                <th>PNL</th>
                <th>DD</th>
                <th>STATUS</th>
              </tr>
            </thead>

            <tbody>
              {logs.map(
                (log) => (
                  <tr
                    key={log.id}
                  >
                    <td>
                      {formatDate(
                        log.created_at
                      )}
                    </td>

                    <td className="mono">
                      {String(
                        log.bot_instance_id
                      ).slice(
                        0,
                        12
                      )}
                      ...
                    </td>

                    <td>
                      {formatMoney(
                        log.balance
                      )}
                    </td>

                    <td>
                      {formatMoney(
                        log.equity
                      )}
                    </td>

                    <td>
                      {formatMoney(
                        log.daily_profit
                      )}
                    </td>

                    <td>
                      {Number(
                        log.drawdown ||
                          0
                      ).toFixed(
                        2
                      )}
                      %
                    </td>

                    <td>
                      <span className="status online">
                        ●{" "}
                        {log.status ||
                          "online"}
                      </span>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* =========================================================
   MINI BOT
========================================================= */

function MiniBotCard({
  bot,
}) {
  const account =
    getAccount(bot);

  const status =
    bot.liveStatus;

  return (
    <div className="mini-bot-card">
      <div className="mini-top">
        <div className="mini-avatar">
          GQ
        </div>

        <div className="mini-info">
          <strong>
            {bot.ea_name ||
              "GIANG QUANT X"}
          </strong>

          <span>
            MT5{" "}
            {account?.mt5_login ||
              "--"}
          </span>
        </div>

        <span
          className={`status ${status.key}`}
        >
          ●{" "}
          {status.label}
        </span>
      </div>

      <div className="mini-values">
        <div>
          <span>BALANCE</span>
          <strong>
            {formatMoney(
              bot.balance
            )}
          </strong>
        </div>

        <div>
          <span>EQUITY</span>
          <strong>
            {formatMoney(
              bot.equity
            )}
          </strong>
        </div>

        <div>
          <span>DD</span>
          <strong>
            {Number(
              bot.drawdown ||
                0
            ).toFixed(2)}
            %
          </strong>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   DATA BOX
========================================================= */

function DataBox({
  label,
  value,
}) {
  return (
    <div className="data-box">
      <span>{label}</span>

      <strong>
        {value || "--"}
      </strong>
    </div>
  );
}

/* =========================================================
   STAT CARD
========================================================= */

function StatCard({
  label,
  value,
  note,
  color,
}) {
  return (
    <div className="stat-card">
      <span>
        {label}
      </span>

      <strong
        style={{
          color:
            color === "green"
              ? "#22c55e"
              : color === "orange"
                ? "#f59e0b"
                : color === "red"
                  ? "#ef4444"
                  : "#f8fafc",
        }}
      >
        {value}
      </strong>

      <small>
        {note}
      </small>
    </div>
  );
}

/* =========================================================
   EMPTY
========================================================= */

function EmptyBlock({
  icon,
  title,
  description,
}) {
  return (
    <div className="empty-block">
      <div className="empty-icon-large">
        {icon}
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

/* =========================================================
   LOADING
========================================================= */

function LoadingBlock() {
  return (
    <div className="loading-block">
      <div className="spinner" />
      <span>
        Đang tải dữ liệu...
      </span>
    </div>
  );
}

function LoadingScreen({
  text,
}) {
  return (
    <div className="loading-screen">
      <div className="loading-logo">
        GQ
      </div>

      <div className="spinner" />

      <p>{text}</p>
    </div>
  );
}

/* =========================================================
   LOGIN
========================================================= */

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
          "SUPABASE_NOT_CONFIGURED"
        );
      }

      const {
        error: loginError,
      } =
        await signIn(
          email.trim(),
          password
        );

      if (loginError) {
        throw loginError;
      }
    } catch (err) {
      console.error(
        "LOGIN ERROR:",
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
      <div className="login-glow login-glow-one" />
      <div className="login-glow login-glow-two" />

      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">
            GQ
          </div>

          <span>
            GIANG QUANT
          </span>
        </div>

        <div className="login-subtitle">
          EA CONTROL CENTER
        </div>

        <div className="login-divider" />

        <h1>
          Welcome Back
        </h1>

        <p>
          Đăng nhập tài khoản quản trị để
          điều khiển hệ thống EA MT5.
        </p>

        <form
          onSubmit={handleLogin}
        >
          <label>
            EMAIL
          </label>

          <input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(
                event.target.value
              )
            }
            placeholder="admin@example.com"
            autoComplete="username"
            required
          />

          <label>
            PASSWORD
          </label>

          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(
                event.target.value
              )
            }
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />

          {error && (
            <div className="login-error">
              ⚠ {error}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >
            {loading
              ? "ĐANG XÁC THỰC..."
              : "ĐĂNG NHẬP"}
          </button>
        </form>

        <div className="login-footer">
          <span className="security-dot" />

          SECURE ADMIN ACCESS
        </div>
      </div>
    </div>
  );
}
