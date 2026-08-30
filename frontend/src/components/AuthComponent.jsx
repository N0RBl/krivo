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
    if (!socket) return;

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
    if (!socket) return;

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

    return { username: cleanUsername, roomName: cleanRoomName };
  };

  const createRoom = () => {
    if (isLoading) return;
    if (!socket.connected) {
      setError("Нет соединения с сервером");
      return;
    }

    const data = validate();
    if (!data) return;

    setError("");
    setIsLoading(true);
    socket.emit("create-room", data);
  };

  const joinRoom = () => {
    if (isLoading) return;
    if (!socket.connected) {
      setError("Нет соединения с сервером");
      return;
    }

    const data = validate();
    if (!data) return;

    setError("");
    setIsLoading(true);
    socket.emit("join-room", data);
  };

  const handleKeyDown = (event, nextInputId) => {
    if (event.key !== "Enter") return;
    event.preventDefault();

    if (nextInputId) {
      document.getElementById(nextInputId)?.focus();
      return;
    }

    joinRoom();
  };

  const handleUsernameChange = (event) => {
    setUsername(event.target.value);
    if (error) setError("");
  };

  const handleRoomChange = (event) => {
    setRoomName(event.target.value);
    if (error) setError("");
  };

  return (
    <div className="fixed inset-0 bg-[#F5EFD7] flex items-center justify-center px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center w-full max-w-[778px]">
        <h1 className="text-[56px] sm:text-[65px] lg:text-[77px] text-[#5E454B] mb-6 sm:mb-8 lg:mb-10 text-center font-['Alumni'] leading-none">
          АВТОРИЗАЦИЯ
        </h1>

        <div className="flex flex-col gap-4 sm:gap-5 lg:gap-6 w-full mb-4 sm:mb-5">
          <div className="relative w-full h-[50px] sm:h-[54px] lg:h-[58px]">
            <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 pointer-events-none">
              <img
                src={userIcon}
                alt="user"
                className="w-[16px] h-[16px] sm:w-[18px] sm:h-[18px] lg:w-[19px] lg:h-[19px]"
              />
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
              className="w-full h-full pl-9 sm:pl-10 lg:pl-12 pr-3 sm:pr-4 text-[20px] sm:text-[23px] lg:text-[26px] font-['Alumni'] text-[#5E454B] bg-transparent border-3 sm:border-4 border-[#5E454B] outline-none placeholder:text-[#5E454B] placeholder:opacity-70 disabled:opacity-50"
            />
          </div>

          <div className="relative w-full h-[50px] sm:h-[54px] lg:h-[58px]">
            <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 flex items-center justify-center z-10 pointer-events-none">
              <img
                src={roomIcon}
                alt="room"
                className="w-[16px] h-[16px] sm:w-[18px] sm:h-[18px] lg:w-[19px] lg:h-[19px]"
              />
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
              className="w-full h-full pl-9 sm:pl-10 lg:pl-12 pr-3 sm:pr-4 text-[20px] sm:text-[23px] lg:text-[26px] font-['Alumni'] text-[#5E454B] bg-transparent border-3 sm:border-4 border-[#5E454B] outline-none placeholder:text-[#5E454B] placeholder:opacity-70 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 lg:gap-[57px] justify-center w-full">
          <button
            type="button"
            onClick={createRoom}
            disabled={isLoading}
            className="w-full sm:w-[300px] lg:w-[361px] h-[50px] sm:h-[54px] lg:h-[58px] text-[24px] sm:text-[26px] lg:text-[29px] font-bold font-['Alumni'] bg-[#D9B384] text-[#5E454B] border-none cursor-pointer transition-opacity disabled:cursor-wait disabled:opacity-60 hover:opacity-90"
          >
            СОЗДАТЬ
          </button>

          <button
            type="button"
            onClick={joinRoom}
            disabled={isLoading}
            className="w-full sm:w-[300px] lg:w-[361px] h-[50px] sm:h-[54px] lg:h-[58px] text-[24px] sm:text-[26px] lg:text-[29px] font-bold font-['Alumni'] bg-[#CEE6D0] text-[#5E454B] border-none cursor-pointer transition-opacity disabled:cursor-wait disabled:opacity-60 hover:opacity-90"
          >
            ПРИСОЕДИНИТЬСЯ
          </button>
        </div>

        {error && (
          <div className="min-h-[25px] mt-4 sm:mt-[18px] font-['Alumni'] text-[18px] sm:text-[20px] lg:text-[21px] text-[#5E454B] text-center">
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthComponent;
