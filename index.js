const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// 1. Setup Express (The Website)
const app = express();
app.use(express.json());
app.use(express.static('client')); // This looks for your HTML in a 'public' folder

// 2. Setup Socket.io (The Live Feed Engine)
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ['websocket', 'polling']
});

// 3. Setup Discord Bot
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 4. The Live Bridge: Pushes Discord chats to Dashboard
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

// 5. The Remote Control: Sends messages from Dashboard to Discord
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

// 6. Launch the System
client.login(process.env.DISCORD_TOKEN);

server.listen(process.env.PORT || 3000, () => {
  console.log("🫧 Bubbl System: Live Feed & Socket Engine Online");
});