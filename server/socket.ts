import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";

let _io: SocketIOServer | null = null;

export function initSocket(httpServer: HttpServer): SocketIOServer {
  _io = new SocketIOServer(httpServer, {
    transports: ["websocket", "polling"],
    cors: { origin: "*", methods: ["GET", "POST"] },
  });
  return _io;
}

export function getIO(): SocketIOServer | null {
  return _io;
}
