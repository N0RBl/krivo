import React, { useEffect, useState } from 'react';

import userIcon from '../assets/user.svg';
import roomIcon from '../assets/rechetka.svg';

const AuthComponent = ({ socket, onEnter }) => {
  const [username, setUsername] = useState('');
  const [roomName, setRoomName] = useState('');

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  /*
   * Серверные ошибки.
   */
  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleError = (message) => {
      setError(message);
      setIsLoading(false);
    };

    socket.on('server-error', handleError);

    return () => {
      socket.off('server-error', handleError);
    };
  }, [socket]);

  /*
   * Успешный вход / создание комнаты.
   */
  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleRoomJoined = (data) => {
      setIsLoading(false);
      setError('');

      onEnter({
        username: data.username,
        room: data.roomName,
        isCreator: data.isCreator
      });
    };

    socket.on('room-joined', handleRoomJoined);

    return () => {
      socket.off('room-joined', handleRoomJoined);
    };
  }, [socket, onEnter]);

  const validate = () => {
    const cleanUsername = username.trim();
    const cleanRoomName = roomName.trim();

    if (!cleanUsername) {
      setError('Пожалуйста, введите ваше имя');
      return null;
    }

    if (!cleanRoomName) {
      setError('Пожалуйста, введите название комнаты');
      return null;
    }

    if (cleanUsername.length > 32) {
      setError('Имя слишком длинное');
      return null;
    }

    if (cleanRoomName.length > 32) {
      setError('Название комнаты слишком длинное');
      return null;
    }

    return {
      username: cleanUsername,
      roomName: cleanRoomName
    };
  };

  const handleCreate = () => {
    const data = validate();

    if (!data || !socket) {
      return;
    }

    setError('');
    setIsLoading(true);

    socket.emit('create-room', data);
  };

  const handleJoin = () => {
    const data = validate();

    if (!data || !socket) {
      return;
    }

    setError('');
    setIsLoading(true);

    socket.emit('join-room', data);
  };

  const handleKeyDown = (event, nextField) => {
    if (event.key !== 'Enter') {
      return;
    }

    event.preventDefault();

    if (nextField) {
      document
        .getElementById(nextField)
        ?.focus();

      return;
    }

    handleJoin();
  };

  return (
    <div className="fixed inset-0 bg-[#F5EFD7] flex items-center justify-center">
      <div
        className="flex flex-col items-center"
        style={{ width: '778px' }}
      >
        <h1 className="text-[77px] text-[#5E454B] mb-10 text-center font-['Alumni'] leading-none">
          АВТОРИЗАЦИЯ
        </h1>

        <div className="flex flex-col gap-6 w-full mb-5">

          {/* USERNAME */}

          <div className="relative w-full h-[58px]">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 pointer-events-none">
              <img
                src={userIcon}
                alt="user"
                className="w-[19px] h-[19px]"
              />
            </div>

            <input
              id="username"
              type="text"
              placeholder="ВАШЕ ИМЯ"
              maxLength={32}
              autoComplete="off"
              value={username}
              disabled={isLoading}
              onChange={(event) => {
                setUsername(event.target.value);
                setError('');
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, 'roomName');
              }}
              className="w-full h-[58px] pl-12 pr-4 text-[26px] font-['Alumni'] text-[#5E454B] bg-transparent border-4 border-[#5E454B] outline-none placeholder:text-[#5E454B] placeholder:opacity-70 disabled:opacity-50"
            />
          </div>

          {/* ROOM */}

          <div className="relative w-full h-[58px]">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 pointer-events-none">
              <img
                src={roomIcon}
                alt="room"
                className="w-[19px] h-[19px]"
              />
            </div>

            <input
              id="roomName"
              type="text"
              placeholder="НАЗВАНИЕ КОМНАТЫ"
              maxLength={32}
              autoComplete="off"
              value={roomName}
              disabled={isLoading}
              onChange={(event) => {
                setRoomName(event.target.value);
                setError('');
              }}
              onKeyDown={(event) => {
                handleKeyDown(event, null);
              }}
              className="w-full h-[58px] pl-12 pr-4 text-[26px] font-['Alumni'] text-[#5E454B] bg-transparent border-4 border-[#5E454B] outline-none placeholder:text-[#5E454B] placeholder:opacity-70 disabled:opacity-50"
            />
          </div>
        </div>

        {/* BUTTONS */}

        <div className="flex gap-[57px] justify-center w-full">

          <button
            onClick={handleCreate}
            disabled={isLoading}
            className="w-[361px] h-[58px] text-[29px] font-bold font-['Alumni'] bg-[#D9B384] text-[#5E454B] border-none cursor-pointer transition-opacity disabled:cursor-wait disabled:opacity-60 hover:opacity-90"
          >
            {isLoading ? 'ПОДКЛЮЧЕНИЕ...' : 'СОЗДАТЬ'}
          </button>

          <button
            onClick={handleJoin}
            disabled={isLoading}
            className="w-[361px] h-[58px] text-[29px] font-bold font-['Alumni'] bg-[#CEE6D0] text-[#5E454B] border-none cursor-pointer transition-opacity disabled:cursor-wait disabled:opacity-60 hover:opacity-90"
          >
            {isLoading ? 'ПОДКЛЮЧЕНИЕ...' : 'ПРИСОЕДИНИТЬСЯ'}
          </button>

        </div>

        {/* ERROR */}

        {error && (
          <div className="min-h-[25px] mt-[18px] font-['Alumni'] text-[21px] text-[#5E454B] text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthComponent;
