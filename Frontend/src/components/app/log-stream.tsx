"use client";

import * as React from "react";
import { io, type Socket } from "socket.io-client";
import { ArrowDown, Terminal } from "lucide-react";
import { LOGS_URL } from "@/lib/api";
import { cn } from "@/lib/cn";

type LogEvent = {
  id: string;
  log: string;
  sequence?: number;
  timestamp?: string;
  stage?: string;
  level?: string;
  deploymentId?: string;
};

type Connection =
  | "connecting"
  | "subscribing"
  | "connected"
  | "reconnecting"
  | "disconnected";

const connectionLabel: Record<Connection, string> = {
  connecting: "connecting",
  subscribing: "subscribing",
  connected: "live",
  reconnecting: "reconnecting",
  disconnected: "offline",
};

export function LogStream({
  slug,
  deploymentId,
}: {
  slug: string;
  deploymentId: string;
}) {
  const [logs, setLogs] = React.useState<LogEvent[]>([]);
  const [connection, setConnection] = React.useState<Connection>("connecting");
  const [warning, setWarning] = React.useState("");
  const [pinned, setPinned] = React.useState(true);
  const viewportRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setLogs([]);
    setWarning("");
    setConnection("connecting");
    setPinned(true);

    let pending: LogEvent[] = [];
    let legacySequence = 0;

    const socket: Socket = io(LOGS_URL, {
      auth: { token: localStorage.getItem("token") || "" },
    });

    const subscribe = () =>
      socket.emit("subscribe", `logs:${slug}:${deploymentId}`);

    const receive = (raw: string) => {
      try {
        const event = JSON.parse(raw) as LogEvent;
        if (event.deploymentId && event.deploymentId !== deploymentId) return;
        if (typeof event.log !== "string") return;
        pending.push({
          ...event,
          id: event.id || `legacy:${++legacySequence}`,
        });
        pending = pending.slice(-4000);
      } catch {
        /* ignore protocol noise */
      }
    };

    socket.on("connect", () => {
      setConnection("subscribing");
      subscribe();
    });
    socket.on("subscribed", () => {
      setConnection("connected");
      setWarning("");
    });
    socket.on("disconnect", () => setConnection("reconnecting"));
    socket.on("connect_error", (error: Error) => {
      setConnection("disconnected");
      setWarning(error.message);
    });
    socket.on("error", (message: unknown) => {
      setConnection("disconnected");
      setWarning(String(message));
    });
    socket.on("log_warning", (message: unknown) => setWarning(String(message)));
    socket.on("logs:resync", subscribe);
    socket.on("message", receive);
    socket.on("history", (entries: string[]) => {
      if (Array.isArray(entries)) entries.forEach(receive);
    });

    // Coalesce bursts: a verbose build should not re-render per line.
    const flush = window.setInterval(() => {
      if (!pending.length) return;
      const batch = pending;
      pending = [];
      setLogs((previous) => {
        const merged = new Map(previous.map((event) => [event.id, event]));
        batch.forEach((event) => merged.set(event.id, event));
        return Array.from(merged.values())
          .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
          .slice(-2000);
      });
    }, 120);

    return () => {
      window.clearInterval(flush);
      socket.disconnect();
    };
  }, [slug, deploymentId]);

  React.useEffect(() => {
    if (!pinned) return;
    const node = viewportRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [logs, pinned]);

  return (
    <div className="flex min-h-[320px] flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-3.5 py-2">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          <Terminal className="h-3 w-3" />
          live output
        </span>
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em]">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connection === "connected"
                ? "bg-mint"
                : connection === "disconnected"
                  ? "bg-danger"
                  : "bg-warn",
            )}
          />
          <span
            className={cn(
              connection === "connected"
                ? "text-mint"
                : connection === "disconnected"
                  ? "text-danger"
                  : "text-warn",
            )}
          >
            {connectionLabel[connection]}
          </span>
        </span>
      </div>

      {warning ? (
        <p
          role="status"
          className="border-b border-warn/15 bg-warn/[0.05] px-3.5 py-2 font-mono text-[11px] text-warn"
        >
          {warning}
        </p>
      ) : null}

      <div
        ref={viewportRef}
        role="log"
        aria-label="Build output"
        aria-live="off"
        onScroll={(event) => {
          const node = event.currentTarget;
          const atBottom =
            node.scrollHeight - node.scrollTop - node.clientHeight < 24;
          setPinned(atBottom);
        }}
        className="relative flex-1 overflow-y-auto bg-black/45 p-3.5 font-mono text-[11.5px] leading-[1.75]"
      >
        {logs.length === 0 ? (
          <p className="text-faint">
            Waiting for the worker
            <span className="ml-1 inline-block h-3 w-[5px] animate-caret bg-accent/70 align-middle" />
          </p>
        ) : (
          logs.map((event) => (
            <div key={event.id} className="flex gap-2.5">
              <span className="hidden w-[62px] shrink-0 text-white/20 sm:block">
                {event.timestamp
                  ? new Date(event.timestamp).toLocaleTimeString([], {
                      hour12: false,
                    })
                  : ""}
              </span>
              {event.stage ? (
                <span className="hidden w-[52px] shrink-0 text-white/20 md:block">
                  {event.stage}
                </span>
              ) : null}
              <span
                className={cn(
                  "min-w-0 flex-1 whitespace-pre-wrap break-words",
                  event.level === "error"
                    ? "text-danger"
                    : event.level === "warn"
                      ? "text-warn"
                      : "text-dim",
                )}
              >
                {event.log}
              </span>
            </div>
          ))
        )}
      </div>

      {!pinned ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setPinned(true);
              const node = viewportRef.current;
              if (node) node.scrollTop = node.scrollHeight;
            }}
            className="absolute -top-11 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/[0.12] bg-raised px-2.5 py-1 font-mono text-[10px] text-dim shadow-lift hover:text-fg"
          >
            <ArrowDown className="h-3 w-3" />
            jump to latest
          </button>
        </div>
      ) : null}
    </div>
  );
}
