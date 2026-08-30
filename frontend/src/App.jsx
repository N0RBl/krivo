import React, { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";

import AuthComponent from "./components/AuthComponent";
import RoomComponent from "./components/RoomComponent";

import "./App.css";

// IP твоего компьютера в Wi-Fi сети.
const SOCKET_URL = window.location.origin;

function App() {
  const [socket, setSocket] = useState(null);
  const [userData, setUserData] = useState(null);
  const [connectionState, setConnectionState] = useState("connecting");

  const handleEnter = useCallback((data) => {
    setUserData(data);
  }, []);

  const handleExit = useCallback(() => {
    setUserData(null);
  }, []);

  useEffect(() => {
    console.log("[SOCKET] connecting to:", SOCKET_URL);

    const newSocket = io(SOCKET_URL, {
      path: "/socket.io",

      transports: ["polling", "websocket"],

      autoConnect: true,

      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,

      timeout: 10000,
    });

    const handleConnect = () => {
      console.log("[SOCKET] connected:", newSocket.id);

      console.log("[SOCKET] transport:", newSocket.io.engine.transport.name);

      setConnectionState("connected");
    };

    const handleDisconnect = (reason) => {
      console.log("[SOCKET] disconnected:", reason);

      setConnectionState("disconnected");
    };

    const handleConnectError = (error) => {
      console.error("[SOCKET] connection error:", error.message);

      console.error("[SOCKET] target:", SOCKET_URL);

      setConnectionState("error");
    };

    newSocket.on("connect", handleConnect);

    newSocket.on("disconnect", handleDisconnect);

    newSocket.on("connect_error", handleConnectError);

    setSocket(newSocket);

    return () => {
      newSocket.off("connect", handleConnect);

      newSocket.off("disconnect", handleDisconnect);

      newSocket.off("connect_error", handleConnectError);

      newSocket.disconnect();
    };
  }, []);

  if (!socket || connectionState === "connecting") {
    return (
      <div className="fixed inset-0 bg-[#F5EFD7] flex items-center justify-center">
        <div className="text-[#5E454B] text-[30px] font-['Alumni']">
          ПОДКЛЮЧЕНИЕ...
        </div>
      </div>
    );
  }

  if (connectionState === "error" || connectionState === "disconnected") {
    return (
      <div className="fixed inset-0 bg-[#F5EFD7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-5 text-[#5E454B] font-['Alumni'] text-center px-6">
          <div className="text-[30px]">НЕ УДАЛОСЬ ПОДКЛЮЧИТЬСЯ К СЕРВЕРУ</div>

          <div className="text-[18px] opacity-70">Сервер: {SOCKET_URL}</div>

          <button
            type="button"
            onClick={() => {
              setConnectionState("connecting");

              if (!socket.connected) {
                socket.connect();
              }
            }}
            className="border-3 border-[#5E454B] px-8 py-3 text-[24px] hover:bg-[#5E454B] hover:text-[#F5EFD7]"
          >
            ПОВТОРИТЬ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="App">
      {userData ? (
        <RoomComponent
          socket={socket}
          userData={userData}
          onExit={handleExit}
        />
      ) : (
        <AuthComponent socket={socket} onEnter={handleEnter} />
      )}
    </div>
  );
}

export default App;
