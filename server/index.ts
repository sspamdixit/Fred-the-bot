import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { startBot, getBotStatus } from "./bot";
import { initSocket } from "./socket";
import { ensureUserMemoryTable } from "./storage";

const app = express();
const httpServer = createServer(app);

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("X-Frame-Options", "DENY");
  }
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  const forwardedProto = req.get("x-forwarded-proto");
  const isSecure = req.secure || forwardedProto === "https";
  if (process.env.NODE_ENV === "production" && isSecure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
});

initSocket(httpServer);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "16kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false, limit: "16kb" }));

app.get("/health", (_req, res) => {
  const bot = getBotStatus();
  res.status(200).json({
    status: "ok",
    bot: {
      online: bot.online,
      status: bot.status,
      tag: bot.tag,
      uptime: bot.uptimeStart ? Math.floor((Date.now() - bot.uptimeStart) / 1000) : null,
    },
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

function startKeepAlive() {
  const serviceUrl = process.env.RENDER_EXTERNAL_URL;
  if (!serviceUrl) {
    log("RENDER_EXTERNAL_URL not set — keep-alive disabled.", "keep-alive");
    return;
  }

  const pingUrl = `${serviceUrl.replace(/\/$/, "")}/health`;
  const INTERVAL_MS = 10 * 60 * 1000;

  log(`Keep-alive active → pinging ${pingUrl} every 10 min`, "keep-alive");

  setInterval(async () => {
    try {
      const res = await fetch(pingUrl, { signal: AbortSignal.timeout(15_000) });
      log(`Keep-alive ping → ${res.status}`, "keep-alive");
    } catch (err: any) {
      log(`Keep-alive ping failed: ${err.message}`, "keep-alive");
    }
  }, INTERVAL_MS);
}

(async () => {
  await ensureUserMemoryTable();
  log("user_memory table ready.", "memory");

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
      startBot();
      if (process.env.NODE_ENV === "production") {
        startKeepAlive();
      }
    },
  );

  const shutdown = () => {
    log("SIGTERM received — shutting down gracefully.", "express");
    httpServer.close(() => {
      log("HTTP server closed.", "express");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
})();
