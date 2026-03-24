import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { DASHBOARD_AUTH_TOKEN_STORAGE_KEY } from "@/lib/queryClient";

export interface LiveAttachment {
  name: string;
  url: string;
  contentType: string | null;
  size: number;
}

export interface LiveMessage {
  id: string;
  messageId: string;
  channelId: string;
  channelName: string;
  guildName: string;
  authorId: string;
  authorName: string;
  authorAvatar: string | null;
  content: string;
  attachments: LiveAttachment[];
  timestamp: number;
}

const MAX_MESSAGES = 50;

export function useLiveFeed() {
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem(DASHBOARD_AUTH_TOKEN_STORAGE_KEY);
    if (!token) return;

    const socket = io(window.location.origin, {
      transports: ["websocket"],
      reconnectionDelay: 5000,
      reconnectionDelayMax: 30000,
      auth: { token },
    });

    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));

    socket.on("liveFeed:message", (msg: LiveMessage) => {
      setMessages((prev) => {
        const next = [msg, ...prev];
        return next.length > MAX_MESSAGES ? next.slice(0, MAX_MESSAGES) : next;
      });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  return { messages, connected };
}
