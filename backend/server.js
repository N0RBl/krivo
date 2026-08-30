const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();

const PORT = 3000;

const allowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

// --------------------------------------------------
// EXPRESS
// --------------------------------------------------

app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  }),
);

app.use(express.json());

// Проверка, что backend жив
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "krivo-backend",
  });
});

// --------------------------------------------------
// HTTP SERVER
// --------------------------------------------------

const server = http.createServer(app);

// --------------------------------------------------
// SOCKET.IO
// --------------------------------------------------

const io = new Server(server, {
  path: "/socket.io",

  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
  },

  transports: ["polling", "websocket"],

  pingTimeout: 20000,
  pingInterval: 25000,
});

// --------------------------------------------------
// ROOMS
// --------------------------------------------------

// roomName -> {
//   id,
//   name,
//   creatorId,
//   players: [
//     {
//       id,
//       username,
//       isMuted
//     }
//   ]
// }

const rooms = new Map();

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getRoom(roomName) {
  return rooms.get(roomName);
}

function sendPlayersUpdate(roomName) {
  const room = getRoom(roomName);

  if (!room) {
    return;
  }

  io.to(roomName).emit("players-update", room.players);
}

function removePlayerFromRoom(socket) {
  const roomName = socket.data?.roomName;

  if (!roomName) {
    return;
  }

  const room = getRoom(roomName);

  if (!room) {
    socket.data = {};
    return;
  }

  room.players = room.players.filter((player) => player.id !== socket.id);

  socket.leave(roomName);

  io.to(roomName).emit("player-left", socket.id);

  if (room.players.length === 0) {
    rooms.delete(roomName);

    console.log(`Room deleted: ${roomName}`);
  } else {
    sendPlayersUpdate(roomName);
  }

  socket.data = {};
}

// --------------------------------------------------
// SOCKET CONNECTION
// --------------------------------------------------

io.on("connection", (socket) => {
  console.log(`[SOCKET] Connected: ${socket.id}`);

  // ------------------------------------------------
  // CREATE ROOM
  // ------------------------------------------------

  socket.on("create-room", ({ roomName, username } = {}) => {
    const cleanRoomName = String(roomName || "").trim();

    const cleanUsername = String(username || "").trim();

    if (!cleanRoomName) {
      socket.emit("server-error", "Введите название комнаты");

      return;
    }

    if (!cleanUsername) {
      socket.emit("server-error", "Введите ваше имя");

      return;
    }

    if (rooms.has(cleanRoomName)) {
      socket.emit("server-error", "Комната с таким названием уже существует");

      return;
    }

    const room = {
      id: crypto.randomUUID(),

      name: cleanRoomName,

      creatorId: socket.id,

      players: [
        {
          id: socket.id,
          username: cleanUsername,
          isMuted: false,
        },
      ],
    };

    rooms.set(cleanRoomName, room);

    socket.join(cleanRoomName);

    socket.data = {
      roomName: cleanRoomName,
      username: cleanUsername,
    };

    socket.emit("room-joined", {
      roomName: cleanRoomName,
      username: cleanUsername,
      isCreator: true,
    });

    sendPlayersUpdate(cleanRoomName);

    console.log(`[ROOM] Created: ${cleanRoomName} by ${cleanUsername}`);
  });

  // ------------------------------------------------
  // JOIN ROOM
  // ------------------------------------------------

  socket.on("join-room", ({ roomName, username } = {}) => {
    const cleanRoomName = String(roomName || "").trim();

    const cleanUsername = String(username || "").trim();

    if (!cleanRoomName) {
      socket.emit("server-error", "Введите название комнаты");

      return;
    }

    if (!cleanUsername) {
      socket.emit("server-error", "Введите ваше имя");

      return;
    }

    const room = getRoom(cleanRoomName);

    if (!room) {
      socket.emit("server-error", "Комнаты с таким названием не существует");

      return;
    }

    const usernameTaken = room.players.some(
      (player) => player.username.toLowerCase() === cleanUsername.toLowerCase(),
    );

    if (usernameTaken) {
      socket.emit("server-error", "Это имя уже используется в комнате");

      return;
    }

    const existingPlayers = room.players.map((player) => ({
      id: player.id,
      username: player.username,
    }));

    room.players.push({
      id: socket.id,
      username: cleanUsername,
      isMuted: false,
    });

    socket.join(cleanRoomName);

    socket.data = {
      roomName: cleanRoomName,
      username: cleanUsername,
    };

    socket.emit("room-joined", {
      roomName: cleanRoomName,
      username: cleanUsername,
      isCreator: false,
    });

    socket.emit("existing-peers", existingPlayers);

    socket.to(cleanRoomName).emit("new-peer", {
      id: socket.id,
      username: cleanUsername,
    });

    sendPlayersUpdate(cleanRoomName);

    console.log(`[ROOM] ${cleanUsername} joined ${cleanRoomName}`);
  });

  // ------------------------------------------------
  // WEBRTC SIGNALING
  // ------------------------------------------------

  socket.on("signal", ({ to, signal } = {}) => {
    if (!to || !signal) {
      return;
    }

    io.to(to).emit("signal", {
      from: socket.id,
      signal,
    });
  });

  // ------------------------------------------------
  // MICROPHONE
  // ------------------------------------------------

  socket.on("toggle-mic", (isMuted) => {
    const roomName = socket.data?.roomName;

    if (!roomName) {
      return;
    }

    const room = getRoom(roomName);

    if (!room) {
      return;
    }

    const player = room.players.find((item) => item.id === socket.id);

    if (!player) {
      return;
    }

    player.isMuted = Boolean(isMuted);

    sendPlayersUpdate(roomName);
  });

  // ------------------------------------------------
  // LEAVE ROOM
  // ------------------------------------------------

  socket.on("leave-room", () => {
    removePlayerFromRoom(socket);
  });

  // ------------------------------------------------
  // DISCONNECT
  // ------------------------------------------------

  socket.on("disconnect", (reason) => {
    console.log(`[SOCKET] Disconnected: ${socket.id}`, reason);

    removePlayerFromRoom(socket);
  });
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

server.listen(PORT, "0.0.0.0", () => {
  console.log(`KRIVO backend running on http://localhost:${PORT}`);

  console.log(`Socket.IO endpoint: http://localhost:${PORT}/socket.io/`);

  console.log(`Health check: http://localhost:${PORT}/health`);
});
