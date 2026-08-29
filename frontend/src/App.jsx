import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';

import AuthComponent from './components/AuthComponent';
import RoomComponent from './components/RoomComponent';

import './App.css';

const SOCKET_URL = 'http://localhost:3000';

function App() {
  const [socket, setSocket] = useState(null);
  const [userData, setUserData] = useState(null);
  const [isConnecting, setIsConnecting] = useState(true);

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      transports: ['websocket', 'polling']
    });

    newSocket.on('connect', () => {
      console.log('Socket connected:', newSocket.id);
      setIsConnecting(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
      setIsConnecting(false);
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const handleEnter = (data) => {
    setUserData(data);

    localStorage.setItem(
      'currentUser',
      JSON.stringify(data)
    );
  };

  const handleExit = () => {
    localStorage.removeItem('currentUser');
    setUserData(null);
  };

  useEffect(() => {
    if (!socket) {
      return;
    }

    const savedUser = localStorage.getItem('currentUser');

    if (!savedUser) {
      return;
    }

    try {
      const parsed = JSON.parse(savedUser);

      /*
       * Важно:
       * после перезагрузки старый Socket.IO ID уже недействителен.
       *
       * Поэтому НЕ пытаемся автоматически считать пользователя
       * уже находящимся в комнате.
       *
       * Пользователь должен войти заново.
       */
      localStorage.removeItem('currentUser');
      setUserData(null);

      console.log(
        'Previous session cleared. Please join again.'
      );
    } catch {
      localStorage.removeItem('currentUser');
    }
  }, [socket]);

  if (isConnecting || !socket) {
    return (
      <div className="fixed inset-0 bg-[#F5EFD7] flex items-center justify-center">
        <div className="text-[#5E454B] text-[30px] font-['Alumni']">
          ПОДКЛЮЧЕНИЕ...
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
        <AuthComponent
          socket={socket}
          onEnter={handleEnter}
        />
      )}
    </div>
  );
}

export default App;
