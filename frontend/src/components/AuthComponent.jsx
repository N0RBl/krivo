import React, { useEffect, useState } from "react";

import userIcon from "../assets/user.svg";
import roomIcon from "../assets/rechetka.svg";

const MAX_LENGTH = 32;

const AuthComponent = ({ socket, onEnter }) => {
  const [username, setUsername] = useState("");

  const [roomName, setRoomName] = useState("");

  const [error, setError] = useState("");

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleServerError = (message) => {
      setError(String(message || "Произошла ошибка"));

      setIsLoading(false);
    };

    socket.on("server-error", handleServerError);

    return () => {
      socket.off("server-error", handleServerError);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const handleRoomJoined = (data) => {
      setIsLoading(false);
      setError("");

      onEnter({
        username: data.username,
        room: data.roomName,
        roomId: data.roomId,
        isCreator: Boolean(data.isCreator),
      });
    };

    socket.on("room-joined", handleRoomJoined);

    return () => {
      socket.off("room-joined", handleRoomJoined);
    };
  }, [socket, onEnter]);

  const validate = () => {
    const cleanUsername = username.trim();

    const cleanRoomName = roomName.trim();

    if (!cleanUsername) {
      setError("Пожалуйста, введите ваше имя");

      return null;
    }

    if (!cleanRoomName) {
      setError("Пожалуйста, введите название комнаты");

      return null;
    }

    if (cleanUsername.length > MAX_LENGTH) {
      setError("Имя слишком длинное");

      return null;
    }

    if (cleanRoomName.length > MAX_LENGTH) {
      setError("Название комнаты слишком длинное");

      return null;
    }

    return {
      username: cleanUsername,
      roomName: cleanRoomName,
    };
  };

  const createRoom = () => {
    if (isLoading) {
      return;
    }

    const data = validate();

    if (!data || !socket.connected) {
      if (!socket.connected) {
        setError("Нет соединения с сервером");
      }

      return;
    }

    setError("");
    setIsLoading(true);

    socket.emit("create-room", data);
  };

  const joinRoom = () => {
    if (isLoading) {
      return;
    }

    const data = validate();

    if (!data || !socket.connected) {
      if (!socket.connected) {
        setError("Нет соединения с сервером");
      }

      return;
    }

    setError("");
    setIsLoading(true);

    socket.emit("join-room", data);
  };

  const handleKeyDown = (event, nextInputId) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    if (nextInputId) {
      document.getElementById(nextInputId)?.focus();

      return;
    }

    joinRoom();
  };

  const handleUsernameChange = (event) => {
    setUsername(event.target.value);

    if (error) {
      setError("");
    }
  };

  const handleRoomChange = (event) => {
    setRoomName(event.target.value);

    if (error) {
      setError("");
    }
  };

  return (
    <div className="fixed inset-0 bg-[#F5EFD7] flex items-center justify-center">
      <div
        className="flex flex-col items-center"
        style={{
          width: "778px",
        }}
      >
        <h1 className="text-[77px] text-[#5E454B] mb-10 text-center font-['Alumni'] leading-none">
          АВТОРИЗАЦИЯ
        </h1>

        <div className="flex flex-col gap-6 w-full mb-5">
          <div className="relative w-full h-[58px]">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 pointer-events-none">
              <img src={userIcon} alt="user" className="w-[19px] h-[19px]" />
            </div>

            <input
              id="username"
              type="text"
              placeholder="ВАШЕ ИМЯ"
              maxLength={MAX_LENGTH}
              autoComplete="off"
              spellCheck="false"
              value={username}
              disabled={isLoading}
              onChange={handleUsernameChange}
              onKeyDown={(event) => handleKeyDown(event, "roomName")}
              className="w-full h-[58px] pl-12 pr-4 text-[26px] font-['Alumni'] text-[#5E454B] bg-transparent border-4 border-[#5E454B] outline-none placeholder:text-[#5E454B] placeholder:opacity-70 disabled:opacity-50"
            />
          </div>

          <div className="relative w-full h-[58px]">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 pointer-events-none">
              <img src={roomIcon} alt="room" className="w-[19px] h-[19px]" />
            </div>

            <input
              id="roomName"
              type="text"
              placeholder="НАЗВАНИЕ КОМНАТЫ"
              maxLength={MAX_LENGTH}
              autoComplete="off"
              spellCheck="false"
              value={roomName}
              disabled={isLoading}
              onChange={handleRoomChange}
              onKeyDown={(event) => handleKeyDown(event, null)}
              className="w-full h-[58px] pl-12 pr-4 text-[26px] font-['Alumni'] text-[#5E454B] bg-transparent border-4 border-[#5E454B] outline-none placeholder:text-[#5E454B] placeholder:opacity-70 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex gap-[57px] justify-center w-full">
          <button
            type="button"
            onClick={createRoom}
            disabled={isLoading}
            className="w-[361px] h-[58px] text-[29px] font-bold font-['Alumni'] bg-[#D9B384] text-[#5E454B] border-none cursor-pointer transition-opacity disabled:cursor-wait disabled:opacity-60 hover:opacity-90"
          >
            СОЗДАТЬ
          </button>

          <button
            type="button"
            onClick={joinRoom}
            disabled={isLoading}
            className="w-[361px] h-[58px] text-[29px] font-bold font-['Alumni'] bg-[#CEE6D0] text-[#5E454B] border-none cursor-pointer transition-opacity disabled:cursor-wait disabled:opacity-60 hover:opacity-90"
          >
            ПРИСОЕДИНИТЬСЯ
          </button>
        </div>

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
