import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

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

export default function App() {
  const [bots, setBots] = useState([]);
  const [pendingCommands, setPendingCommands] = useState({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [commandLoading, setCommandLoading] = useState(null);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  // Lưu command vừa gửi để xác định khi nào đã được EA xác nhận
  const [lastCommandByBot, setLastCommandByBot] =
    useState({});

  // ============================================================
  // LOAD BOT + COMMAND
  // ============================================================

  async function loadBots(showLoading = false) {
    if (!supabase) {
      setError(
        "Supabase chưa được cấu hình. Kiểm tra VITE_SUPABASE_URL và VITE_SUPABASE_PUBLISHABLE_KEY."
      );
      setLoading(false);
      return;
    }

    if (showLoading) {
      setLoading(true);
    }

    try {
      setError("");

      // ========================================================
      // LOAD BOT
      // ========================================================

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

      const safeBots = botData || [];

      setBots(safeBots);

      // ========================================================
      // LOAD PENDING COMMANDS
      // ========================================================

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
          created_at,
          executed_at
        `)
        .order("created_at", {
          ascending: false,
        });

      if (commandError) {
        throw commandError;
      }

      // --------------------------------------------------------
      // Chỉ lấy pending command mới nhất cho mỗi bot
      // --------------------------------------------------------

      const pendingMap = {};

      for (const command of commandData || []) {
        if (
          command.status === "pending" &&
          !pendingMap[command.bot_instance_id]
        ) {
          pendingMap[command.bot_instance_id] =
            command;
        }
      }

      setPendingCommands(pendingMap);

      // ========================================================
      // COMMAND FEEDBACK
      // ========================================================

      const nextLastCommands = {
        ...lastCommandByBot,
      };

      for (const bot of safeBots) {
        const botPending =
          pendingMap[bot.id];

        const tracked =
          nextLastCommands[bot.id];

        // ------------------------------------------------------
        // 1. Vẫn đang chờ
        // ------------------------------------------------------

        if (botPending) {
          if (
            tracked &&
            tracked.command ===
              botPending.command
          ) {
            nextLastCommands[bot.id] = {
              ...tracked,
              commandId:
                botPending.id,
              status: "pending",
            };
          }

          continue;
        }

        // ------------------------------------------------------
        // 2. Không còn pending
        //    Kiểm tra command gần nhất để xác nhận
        // ------------------------------------------------------

        if (tracked?.commandId) {
          const matchingCommand =
            (commandData || []).find(
              (item) =>
                item.id ===
                tracked.commandId
            );

          if (
            matchingCommand &&
            matchingCommand.status ===
              "executed"
          ) {
            const command =
              String(
                matchingCommand.command
              ).toUpperCase();

            let success = false;

            // ENABLE thành công
            if (
              command ===
                COMMANDS.ENABLE ||
              command === "RESUME"
            ) {
              success =
                bot.enabled === true;
            }

            // PAUSE thành công
            if (
              command ===
                COMMANDS.PAUSE ||
              command ===
                "DISABLE"
            ) {
              success =
                bot.enabled === false;
            }

            // CLOSE_ALL / KILL
            // chỉ xác nhận command đã executed
            if (
              command ===
                COMMANDS.CLOSE_ALL ||
              command === COMMANDS.KILL
            ) {
              success = true;
            }

            if (
              success &&
              tracked.status !==
                "executed"
            ) {
              const successLabel =
                command ===
                COMMANDS.ENABLE
                  ? "✅ EA đã BẬT thành công."
                  : command ===
                      COMMANDS.PAUSE
                    ? "✅ EA đã TẮT và chuyển sang PAUSED."
                    : command ===
                        COMMANDS.CLOSE_ALL
                      ? "✅ Đã đóng tất cả lệnh."
                      : "✅ EA đã nhận lệnh KILL.";

              setMessage(
                successLabel
              );

              nextLastCommands[
                bot.id
              ] = {
                ...tracked,
                status: "executed",
              };

              // Tự xóa message sau 4 giây
              setTimeout(() => {
                setMessage((current) =>
                  current ===
                  successLabel
                    ? ""
                    : current
                );
              }, 4000);
            }
          }
        }
      }

      setLastCommandByBot(
        nextLastCommands
      );

      // ========================================================
      // Nếu không còn pending và không còn trạng thái
      // chờ nào -> xóa message "đang chờ"
      // ========================================================

      const hasPending =
        Object.keys(pendingMap).length >
        0;

      if (!hasPending) {
        setMessage((current) => {
          if (
            current.includes(
              "Đang chờ EA xác nhận"
            )
          ) {
            return "";
          }

          return current;
        });
      }
    } catch (err) {
      console.error(
        "DASHBOARD LOAD ERROR:",
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

  // ============================================================
  // REFRESH
  // ============================================================

  async function handleRefresh() {
    if (refreshing) return;

    setRefreshing(true);

    try {
      await loadBots(false);
    } finally {
      setRefreshing(false);
    }
  }

  // ============================================================
  // SEND COMMAND
  // ============================================================

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

    // ----------------------------------------------------------
    // Confirm lệnh nguy hiểm
    // ----------------------------------------------------------

    if (
      command ===
        COMMANDS.CLOSE_ALL ||
      command === COMMANDS.KILL
    ) {
      const confirmed =
        window.confirm(
          `Bạn có chắc muốn ${COMMAND_LABELS[command]} cho ${
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
      // ========================================================
      // KIỂM TRA COMMAND PENDING
      // ========================================================

      const {
        data: pending,
        error: pendingError,
      } = await supabase
        .from("bot_commands")
        .select(
          "id, command, status, created_at"
        )
        .eq(
          "bot_instance_id",
          bot.id
        )
        .eq(
          "status",
          "pending"
        )
        .order("created_at", {
          ascending: false,
        })
        .limit(1);

      if (pendingError) {
        throw pendingError;
      }

      if (
        pending &&
        pending.length > 0
      ) {
        setError(
          `Bot đang có lệnh ${pending[0].command} chờ EA xử lý.`
        );

        return;
      }

      // ========================================================
      // INSERT COMMAND
      // ========================================================

      const {
        data: insertedCommand,
        error: insertError,
      } = await supabase
        .from("bot_commands")
        .insert({
          bot_instance_id:
            bot.id,
          command,
          status:
            "pending",
          message:
            `Dashboard command: ${command}`,
        })
        .select()
        .single();

      if (insertError) {
        throw insertError;
      }

      // ========================================================
      // LƯU COMMAND ĐANG THEO DÕI
      // ========================================================

      setLastCommandByBot(
        (current) => ({
          ...current,
          [bot.id]: {
            command,
            commandId:
              insertedCommand?.id,
            status: "pending",
          },
        })
      );

      // ========================================================
      // Hiện trạng thái chờ
      // ========================================================

      setMessage(
        `🟡 ${COMMAND_LABELS[command]} đã được gửi. Đang chờ EA xác nhận...`
      );

      // ========================================================
      // LOAD LẠI NGAY
      // ========================================================

      await loadBots(false);
    } catch (err) {
      console.error(
        "COMMAND ERROR:",
        err
      );

      setError(
        err?.message ||
          "Không thể gửi lệnh tới bot."
      );
    } finally {
      setCommandLoading(null);
    }
  }

  // ============================================================
  // INITIAL LOAD + AUTO REFRESH
  // ============================================================

  useEffect(() => {
    loadBots(true);

    const timer =
      setInterval(() => {
        loadBots(false);
      }, 5000);

    return () => {
      clearInterval(timer);
    };
  }, []);

  // ============================================================
  // STATISTICS
  // ============================================================

  const totalBots =
    bots.length;

  const onlineBots =
    useMemo(
      () =>
        bots.filter(
          (bot) =>
            String(
              bot.status
            ).toLowerCase() ===
            "online"
        ).length,
      [bots]
    );

  const runningBots =
    useMemo(
      () =>
        bots.filter(
          (bot) =>
            bot.enabled ===
            true
        ).length,
      [bots]
    );

  const pausedBots =
    useMemo(
      () =>
        bots.filter(
          (bot) =>
            bot.enabled ===
            false &&
            String(
              bot.status
            ).toLowerCase() ===
              "online"
        ).length,
      [bots]
    );

  const offlineBots =
    bots.filter(
      (bot) =>
        String(
          bot.status
        ).toLowerCase() !==
        "online"
    ).length;

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
        <header className="topbar">
          <div>
            <div className="eyebrow">
              BOT MANAGEMENT
            </div>

            <h1>
              EA Control Dashboard
            </h1>

            <p>
              Quản lý EA MT5 theo
              thời gian thực.
            </p>
          </div>

          <button
            className="refresh"
            onClick={
              handleRefresh
            }
            disabled={
              refreshing
            }
          >
            {refreshing
              ? "Đang cập nhật..."
              : "↻ Làm mới"}
          </button>
        </header>

        {/* ====================================================
            MESSAGE
        ==================================================== */}

        {message && (
          <div className="alert success">
            {message}
          </div>
        )}

        {error && (
          <div className="alert error">
            <strong>
              Lỗi:
            </strong>{" "}
            {error}
          </div>
        )}

        {/* ====================================================
            STATS
        ==================================================== */}

        <section className="stats">
          <div className="stat-card">
            <span>
              TỔNG BOT
            </span>

            <strong>
              {totalBots}
            </strong>

            <small>
              Bot đã đăng ký
            </small>
          </div>

          <div className="stat-card">
            <span>
              ONLINE
            </span>

            <strong className="green">
              {onlineBots}
            </strong>

            <small>
              Đang heartbeat
            </small>
          </div>

          <div className="stat-card">
            <span>
              ĐANG CHẠY
            </span>

            <strong className="blue">
              {runningBots}
            </strong>

            <small>
              Remote enabled
            </small>
          </div>

          <div className="stat-card">
            <span>
              PAUSED
            </span>

            <strong
              style={{
                color:
                  "#f59e0b",
              }}
            >
              {pausedBots}
            </strong>

            <small>
              EA online nhưng
              đang tắt bot
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
                Trạng thái thực tế
                từ Supabase.
              </p>
            </div>

            <span className="live-badge">
              ● LIVE
            </span>
          </div>

          {loading && (
            <div className="empty">
              Đang tải dữ liệu...
            </div>
          )}

          {!loading &&
            !error &&
            bots.length ===
              0 && (
              <div className="empty">
                <div className="empty-icon">
                  ◎
                </div>

                <h3>
                  Chưa có bot
                </h3>

                <p>
                  Chạy EA trên MT5
                  để tạo bot.
                </p>
              </div>
            )}

          <div className="bot-list">
            {bots.map(
              (bot) => {
                const account =
                  bot.mt5_accounts;

                const pending =
                  pendingCommands[
                    bot.id
                  ];

                const tracked =
                  lastCommandByBot[
                    bot.id
                  ];

                const isOnline =
                  String(
                    bot.status
                  ).toLowerCase() ===
                  "online";

                const isEnabled =
                  bot.enabled ===
                  true;

                const command =
                  pending?.command?.toUpperCase();

                let stateText =
                  isEnabled
                    ? "RUNNING"
                    : "PAUSED";

                let stateClass =
                  isEnabled
                    ? "running"
                    : "paused";

                // ------------------------------------------------
                // Pending state
                // ------------------------------------------------

                if (
                  pending
                ) {
                  if (
                    command ===
                    COMMANDS.ENABLE
                  ) {
                    stateText =
                      "ENABLE REQUESTED";
                  } else if (
                    command ===
                    COMMANDS.PAUSE
                  ) {
                    stateText =
                      "PAUSE REQUESTED";
                  } else {
                    stateText =
                      `${command} REQUESTED`;
                  }

                  stateClass =
                    "requested";
                }

                // ------------------------------------------------
                // Executed recent state
                // ------------------------------------------------

                if (
                  !pending &&
                  tracked?.status ===
                    "executed"
                ) {
                  if (
                    tracked.command ===
                    COMMANDS.ENABLE
                  ) {
                    stateText =
                      "RUNNING";
                    stateClass =
                      "running";
                  }

                  if (
                    tracked.command ===
                    COMMANDS.PAUSE
                  ) {
                    stateText =
                      "PAUSED";
                    stateClass =
                      "paused";
                  }
                }

                return (
                  <article
                    className="bot-card"
                    key={
                      bot.id
                    }
                  >
                    {/* ==========================================
                        HEADER
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
                        className={`state-pill ${stateClass}`}
                      >
                        {stateText}
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
                          bot.drawdown ||
                            0
                        ).toFixed(
                          2
                        )}%`}
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
                        BOT ID:{" "}
                        {bot.id}
                      </div>
                    </div>

                    {/* ==========================================
                        ACTIONS
                    ========================================== */}

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
                          {commandLoading ===
                          `${bot.id}-ENABLE`
                            ? "ĐANG GỬI..."
                            : "BẬT BOT"}
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
                          {commandLoading ===
                          `${bot.id}-PAUSE`
                            ? "ĐANG GỬI..."
                            : "TẮT BOT"}
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
                        {commandLoading ===
                        `${bot.id}-CLOSE_ALL`
                          ? "ĐANG GỬI..."
                          : "ĐÓNG TẤT CẢ"}
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
                        {commandLoading ===
                        `${bot.id}-KILL`
                          ? "ĐANG GỬI..."
                          : "KILL"}
                      </button>
                    </div>
                  </article>
                );
              }
            )}
          </div>
        </section>
      </main>
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
// MONEY
// ============================================================

function formatMoney(value) {
  return Number(
    value || 0
  ).toLocaleString(
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
    return new Date(
      value
    ).toLocaleString(
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
