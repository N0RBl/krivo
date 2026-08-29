const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  ],
  methods: ['GET', 'POST']
}));

app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ],
    methods: ['GET', 'POST']
  }
});

// roomName -> {
//   id,
//   name,
//   creatorId,
//   players: [
//      { id, username, isMuted }
//   ]
// }
const rooms = new Map();

function getRoom(roomName) {
  return rooms.get(roomName);
}

function sendPlayersUpdate(roomName) {
  const room = getRoom(roomName);

  if (!room) {
    return;
  }

  io.to(roomName).emit('players-update', room.players);
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

  room.players = room.players.filter(
    (player) => player.id !== socket.id
  );

  socket.leave(roomName);

  io.to(roomName).emit('player-left', socket.id);

  if (room.players.length === 0) {
    rooms.delete(roomName);

    console.log(`Room deleted: ${roomName}`);
  } else {
    sendPlayersUpdate(roomName);
  }

  socket.data = {};
}

io.on('connection', (socket) => {
  console.log(`Connected: ${socket.id}`);

  /*
   * CREATE ROOM
   */
  socket.on('create-room', ({ roomName, username }) => {
    const cleanRoomName = String(roomName || '').trim();
    const cleanUsername = String(username || '').trim();

    if (!cleanRoomName) {
      socket.emit('server-error', 'Введите название комнаты');
      return;
    }

    if (!cleanUsername) {
      socket.emit('server-error', 'Введите ваше имя');
      return;
    }

    if (rooms.has(cleanRoomName)) {
      socket.emit(
        'server-error',
        'Комната с таким названием уже существует'
      );
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
          isMuted: false
        }
      ]
    };

    rooms.set(cleanRoomName, room);

    socket.join(cleanRoomName);

    socket.data = {
      roomName: cleanRoomName,
      username: cleanUsername
    };

    socket.emit('room-joined', {
      roomName: cleanRoomName,
      username: cleanUsername,
      isCreator: true
    });

    sendPlayersUpdate(cleanRoomName);

    console.log(
      `Room created: ${cleanRoomName} by ${cleanUsername}`
    );
  });

  /*
   * JOIN ROOM
   */
  socket.on('join-room', ({ roomName, username }) => {
    const cleanRoomName = String(roomName || '').trim();
    const cleanUsername = String(username || '').trim();

    if (!cleanRoomName) {
      socket.emit('server-error', 'Введите название комнаты');
      return;
    }

    if (!cleanUsername) {
      socket.emit('server-error', 'Введите ваше имя');
      return;
    }

    const room = getRoom(cleanRoomName);

    if (!room) {
      socket.emit(
        'server-error',
        'Комнаты с таким названием не существует'
      );
      return;
    }

    // Один username не может одновременно находиться
    // в одной комнате дважды.
    const usernameTaken = room.players.some(
      (player) => player.username.toLowerCase() === cleanUsername.toLowerCase()
    );

    if (usernameTaken) {
      socket.emit(
        'server-error',
        'Это имя уже используется в комнате'
      );
      return;
    }

    // Сохраняем список тех, кто уже был в комнате.
    // Именно с ними новый пользователь создаст WebRTC-соединения.
    const existingPlayers = room.players.map((player) => ({
      id: player.id,
      username: player.username
    }));

    room.players.push({
      id: socket.id,
      username: cleanUsername,
      isMuted: false
    });

    socket.join(cleanRoomName);

    socket.data = {
      roomName: cleanRoomName,
      username: cleanUsername
    };

    socket.emit('room-joined', {
      roomName: cleanRoomName,
      username: cleanUsername,
      isCreator: false
    });

    socket.emit('existing-peers', existingPlayers);

    socket.to(cleanRoomName).emit('new-peer', {
      id: socket.id,
      username: cleanUsername
    });

    sendPlayersUpdate(cleanRoomName);

    console.log(
      `${cleanUsername} joined ${cleanRoomName}`
    );
  });

  /*
   * WEBRTC SIGNALING
   */
  socket.on('signal', ({ to, signal }) => {
    if (!to || !signal) {
      return;
    }

    io.to(to).emit('signal', {
      from: socket.id,
      signal
    });
  });

  /*
   * MICROPHONE
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

    const player = room.players.find(
      (item) => item.id === socket.id
    );

    if (!player) {
      return;
    }

    player.isMuted = Boolean(isMuted);

    sendPlayersUpdate(roomName);
  });

  /*
   * LEAVE
   */
  socket.on('leave-room', () => {
    removePlayerFromRoom(socket);
  });

  /*
   * DISCONNECT
   */
  socket.on('disconnect', () => {
    console.log(`Disconnected: ${socket.id}`);

    removePlayerFromRoom(socket);
  });
});

const PORT = 3000;

server.listen(PORT, () => {
  console.log(`KRIVO backend running on http://localhost:${PORT}`);
});
