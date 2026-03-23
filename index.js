const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { randomBytes, createHash, timingSafeEqual } = require('crypto');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static('client'));

const DASHBOARD_AUTH_HEADER = 'x-dashboard-auth-token';
const AUTH_TOKEN_TTL_MS = 1000 * 60 * 60 * 12;
const AUTH_TOKEN_MAX_ACTIVE = 2000;
const AUTH_TOKEN_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const authTokenExpirations = new Map();
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

const pruneExpiredAuthTokens = () => {
  const now = Date.now();
  for (const [token, expiresAt] of authTokenExpirations.entries()) {
    if (expiresAt <= now) {
      authTokenExpirations.delete(token);
    }
  }
};

const createAuthToken = () => {
  pruneExpiredAuthTokens();
  if (authTokenExpirations.size >= AUTH_TOKEN_MAX_ACTIVE) {
    const oldestToken = authTokenExpirations.keys().next().value;
    if (oldestToken) {
      authTokenExpirations.delete(oldestToken);
    }
  }
  return randomBytes(32).toString('hex');
};

const tokenCleanupInterval = setInterval(pruneExpiredAuthTokens, AUTH_TOKEN_CLEANUP_INTERVAL_MS);
if (typeof tokenCleanupInterval.unref === 'function') {
  tokenCleanupInterval.unref();
}

const getOriginAllowlist = () =>
  (process.env.DASHBOARD_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

const safePasswordEquals = (input, expected) => {
  const inputDigest = createHash('sha256').update(input).digest();
  const expectedDigest = createHash('sha256').update(expected).digest();
  return timingSafeEqual(inputDigest, expectedDigest);
};

const isAuthTokenValid = (token) => {
  const expiresAt = authTokenExpirations.get(token);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    authTokenExpirations.delete(token);
    return false;
  }
  return true;
};

app.use('/api', apiRateLimiter);

app.post('/api/auth', authRateLimiter, (req, res) => {
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: 'Password required.' });
  }

  const dashboardPassword = process.env.DASHBOARD_PASSWORD;
  if (!dashboardPassword) {
    return res.status(503).json({ error: 'DASHBOARD_PASSWORD is not configured on the server.' });
  }

  if (!safePasswordEquals(password, dashboardPassword)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }

  const token = createAuthToken();
  authTokenExpirations.set(token, Date.now() + AUTH_TOKEN_TTL_MS);
  return res.json({ ok: true, token });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/auth') {
    return next();
  }

  const providedToken = req.get(DASHBOARD_AUTH_HEADER);
  if (!providedToken || !isAuthTokenValid(providedToken)) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  return next();
});

const server = http.createServer(app);
const allowedOrigins = getOriginAllowlist();
const isProduction = process.env.NODE_ENV === 'production';
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin) return callback(null, !isProduction);
      if (allowedOrigins.length === 0) {
        return callback(null, !isProduction);
      }
      return callback(null, allowedOrigins.includes(origin));
    },
  },
  transports: ['websocket', 'polling']
});

io.use((socket, next) => {
  const tokenFromAuth = typeof socket.handshake.auth?.token === 'string'
    ? socket.handshake.auth.token
    : null;

  const headerToken = socket.request.headers[DASHBOARD_AUTH_HEADER];
  const tokenFromHeader = Array.isArray(headerToken)
    ? (headerToken[0] || null)
    : (headerToken || null);

  const token = tokenFromAuth || tokenFromHeader;
  if (!token || !isAuthTokenValid(token)) {
    return next(new Error('Unauthorized'));
  }

  return next();
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('messageCreate', (message) => {
  if (message.author.bot) return;

  io.emit('discord-message', {
    author: message.author.username,
    content: message.content,
    channelName: message.channel.name,
    channelId: message.channel.id,
    messageId: message.id
  });
});

app.post('/api/dispatch', async (req, res) => {
  const { channelId, content, replyToId, userId } = req.body;
  try {
    const channel = await client.channels.fetch(channelId);
    let payload = userId ? `<@${userId}> ${content}` : content;

    if (replyToId) {
      const target = await channel.messages.fetch(replyToId);
      await target.reply(payload);
    } else {
      await channel.send(payload);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);

server.listen(process.env.PORT || 3000, () => {
  console.log("🫧 Bubbl System: Live Feed & Socket Engine Online");
});