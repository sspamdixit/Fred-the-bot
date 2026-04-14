import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { type IncomingMessage } from "http";
import { DASHBOARD_AUTH_HEADER, isAuthTokenValid } from "./auth";

let _io: SocketIOServer | null = null;

function getOriginAllowlist(): string[] {
  const configured = (process.env.DASHBOARD_ORIGIN ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const renderUrl = process.env.RENDER_EXTERNAL_URL?.replace(/\/$/, "");
  if (renderUrl && !configured.includes(renderUrl)) {
    configured.push(renderUrl);
  }

  return configured;
}

function getTokenFromHeaders(req: IncomingMessage): string | null {
  const headerValue = req.headers[DASHBOARD_AUTH_HEADER];
  if (!headerValue) {
    return null;
  }

  if (Array.isArray(headerValue)) {
    return headerValue[0] ?? null;
  }

  return headerValue;
}

export function initSocket(httpServer: HttpServer): SocketIOServer {
  const allowedOrigins = getOriginAllowlist();

  _io = new SocketIOServer(httpServer, {
    transports: ["websocket", "polling"],
    cors: {
      origin: (origin, callback) => {
        if (allowedOrigins.length === 0) {
          return callback(null, true);
        }

        if (!origin) {
          return callback(null, true);
        }

        return callback(null, allowedOrigins.includes(origin));
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  _io.use((socket, next) => {
    const tokenFromAuth =
      typeof socket.handshake.auth?.token === "string"
        ? socket.handshake.auth.token
        : null;

    const token = tokenFromAuth ?? getTokenFromHeaders(socket.request);
    if (!token || !isAuthTokenValid(token)) {
      return next(new Error("Unauthorized"));
    }

    return next();
  });

  return _io;
}

export function getIO(): SocketIOServer | null {
  return _io;
}
