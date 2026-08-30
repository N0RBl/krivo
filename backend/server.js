const express = require('express');
const http = require('http');
const cors = require('cors');
const crypto = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT || 3000);

const CLIENT_ORIGINS = (
  process.env.CLIENT_ORIGINS ||
  'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Разрешаем запросы без Origin
      // (например, некоторые серверные/локальные запросы).
      if (!origin) {
        callback(null, true);
        return;
      }

      if (CLIENT_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ['GET', 'POST'],
  }),
);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'krivo-backend',
  });
});

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (!origin || CLIENT_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Socket.IO CORS blocked origin: ${origin}`));
    },
    methods: ['GET', 'POST'],
  },

  transports: ['websocket', 'polling'],
});

/*
|--------------------------------------------------------------------------
| ROOMS
|--------------------------------------------------------------------------
|
| roomName -> {
|   id,
|   name,
|   creatorId,
|   players: [
|     {
|       id,
|       username,
|       isMuted
|     }
|   ]
| }
|
| Никакой постоянной БД пока нет.
| Комната существует только пока в ней есть пользователи.
|--------------------------------------------------------------------------
*/

const rooms = new Map();

function cleanText(value, maxLength = 32) {
  return String(value ?? '')
    .trim()
    .slice(0, maxLength);
}

function normalizeUsername(username) {
  return username.toLocaleLowerCase();
}

function getRoom(roomName) {
  return rooms.get(roomName);
}

function getPlayer(room, socketId) {
  if (!room) {
    return null;
  }

  return room.players.find(
    (player) => player.id === socketId,
  );
}

function emitPlayers(roomName) {
  const room = getRoom(roomName);

  if (!room) {
    return;
  }

  io.to(roomName).emit('players-update', room.players);
}

function leaveRoom(socket) {
  const roomName = socket.data?.roomName;

  if (!roomName) {
    return;
  }

  const room = getRoom(roomName);

  if (!room) {
    socket.data.roomName = null;
    socket.data.username = null;
    return;
  }

  const playerIndex = room.players.findIndex(
    (player) => player.id === socket.id,
  );

  if (playerIndex === -1) {
    socket.data.roomName = null;
    socket.data.username = null;
    return;
  }

  room.players.splice(playerIndex, 1);

  socket.leave(roomName);

  socket.to(roomName).emit('player-left', socket.id);

  if (room.players.length === 0) {
    rooms.delete(roomName);

    console.log(`[ROOM] deleted: ${roomName}`);
  } else {
    emitPlayers(roomName);
  }

  socket.data.roomName = null;
  socket.data.username = null;
}

function isSocketInRoom(socket, roomName) {
  return Boolean(
    socket.data?.roomName &&
      socket.data.roomName === roomName &&
      socket.rooms.has(roomName),
  );
}

function isPeerInSameRoom(socket, peerId) {
  const roomName = socket.data?.roomName;

  if (!roomName) {
    return false;
  }

  const room = getRoom(roomName);

  if (!room) {
    return false;
  }

  return room.players.some(
    (player) => player.id === peerId,
  );
}

/*
|--------------------------------------------------------------------------
| SOCKET CONNECTION
|--------------------------------------------------------------------------
*/

io.on('connection', (socket) => {
  console.log(`[SOCKET] connected: ${socket.id}`);

  /*
  |--------------------------------------------------------------------------
  | CREATE ROOM
  |--------------------------------------------------------------------------
  */

  socket.on('create-room', (payload = {}) => {
    if (socket.data?.roomName) {
      socket.emit(
        'server-error',
        'Вы уже находитесь в комнате',
      );
      return;
    }

    const username = cleanText(payload.username);
    const roomName = cleanText(payload.roomName);

    if (!username) {
      socket.emit(
        'server-error',
        'Введите ваше имя',
      );
      return;
    }

    if (!roomName) {
      socket.emit(
        'server-error',
        'Введите название комнаты',
      );
      return;
    }

    if (username.length < 1) {
      socket.emit(
        'server-error',
        'Имя слишком короткое',
      );
      return;
    }

    if (roomName.length < 1) {
      socket.emit(
        'server-error',
        'Название комнаты слишком короткое',
      );
      return;
    }

    if (rooms.has(roomName)) {
      socket.emit(
        'server-error',
        'Комната с таким названием уже существует',
      );
      return;
    }

    const room = {
      id: crypto.randomUUID(),
      name: roomName,
      creatorId: socket.id,
      players: [
        {
          id: socket.id,
          username,
          isMuted: false,
        },
      ],
    };

    rooms.set(roomName, room);

    socket.join(roomName);

    socket.data.roomName = roomName;
    socket.data.username = username;

    socket.emit('room-joined', {
      roomName,
      username,
      isCreator: true,
      roomId: room.id,
    });

    emitPlayers(roomName);

    console.log(
      `[ROOM] created "${roomName}" by ${username}`,
    );
  });

  /*
  |--------------------------------------------------------------------------
  | JOIN ROOM
  |--------------------------------------------------------------------------
  */

  socket.on('join-room', (payload = {}) => {
    if (socket.data?.roomName) {
      socket.emit(
        'server-error',
        'Вы уже находитесь в комнате',
      );
      return;
    }

    const username = cleanText(payload.username);
    const roomName = cleanText(payload.roomName);

    if (!username) {
      socket.emit(
        'server-error',
        'Введите ваше имя',
      );
      return;
    }

    if (!roomName) {
      socket.emit(
        'server-error',
        'Введите название комнаты',
      );
      return;
    }

    const room = getRoom(roomName);

    if (!room) {
      socket.emit(
        'server-error',
        'Комнаты с таким названием не существует',
      );
      return;
    }

    const normalizedUsername =
      normalizeUsername(username);

    const usernameTaken = room.players.some(
      (player) =>
        normalizeUsername(player.username) ===
        normalizedUsername,
    );

    if (usernameTaken) {
      socket.emit(
        'server-error',
        'Это имя уже используется в комнате',
      );
      return;
    }

    /*
     * Запоминаем пользователей,
     * которые уже находятся в комнате.
     *
     * Новый пользователь создаст WebRTC
     * соединение именно с ними.
     */
    const existingPlayers = room.players.map(
      (player) => ({
        id: player.id,
        username: player.username,
      }),
    );

    room.players.push({
      id: socket.id,
      username,
      isMuted: false,
    });

    socket.join(roomName);

    socket.data.roomName = roomName;
    socket.data.username = username;

    socket.emit('room-joined', {
      roomName,
      username,
      isCreator: false,
      roomId: room.id,
    });

    socket.emit(
      'existing-peers',
      existingPlayers,
    );

    /*
     * Старым пользователям сообщаем
     * о новом пользователе.
     */
    socket.to(roomName).emit('new-peer', {
      id: socket.id,
      username,
    });

    emitPlayers(roomName);

    console.log(
      `[ROOM] ${username} joined "${roomName}"`,
    );
  });

  /*
  |--------------------------------------------------------------------------
  | WEBRTC SIGNALING
  |--------------------------------------------------------------------------
  */

  socket.on('signal', (payload = {}) => {
    const { to, signal } = payload;

    if (!to || !signal) {
      return;
    }

    /*
     * Нельзя отправлять signaling,
     * если пользователь не находится в комнате.
     */
    if (!socket.data?.roomName) {
      return;
    }

    /*
     * Получатель должен находиться
     * в той же комнате.
     */
    if (!isPeerInSameRoom(socket, to)) {
      return;
    }

    io.to(to).emit('signal', {
      from: socket.id,
      signal,
    });
  });

  /*
  |--------------------------------------------------------------------------
  | MICROPHONE
  |--------------------------------------------------------------------------
  */

  socket.on('toggle-mic', (isMuted) => {
    const roomName = socket.data?.roomName;

    if (!roomName) {
      return;
    }

    const room = getRoom(roomName);

    if (!room) {
      return;
    }

    const player = getPlayer(
      room,
      socket.id,
    );

    if (!player) {
      return;
    }

    player.isMuted = Boolean(isMuted);

    emitPlayers(roomName);
  });

  /*
  |--------------------------------------------------------------------------
  | LEAVE ROOM
  |--------------------------------------------------------------------------
  */

  socket.on('leave-room', () => {
    leaveRoom(socket);
  });

  /*
  |--------------------------------------------------------------------------
  | DISCONNECT
  |--------------------------------------------------------------------------
  */

  socket.on('disconnect', (reason) => {
    console.log(
      `[SOCKET] disconnected ${socket.id}: ${reason}`,
    );

    leaveRoom(socket);
  });
});

/*
|--------------------------------------------------------------------------
| START SERVER
|--------------------------------------------------------------------------
*/

server.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');
    console.log('================================');
    console.log(' KRIVO BACKEND');
    console.log('================================');
    console.log(
      ` Local:   http://localhost:${PORT}`,
    );
    console.log(
      ` Network: http://0.0.0.0:${PORT}`,
    );
    console.log('================================');
    console.log('');
  },
);

process.on('SIGINT', () => {
  console.log('\nStopping KRIVO backend...');

  io.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  io.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
});
