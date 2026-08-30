import React, { useCallback, useEffect, useRef, useState } from "react";

import svg1 from "../assets/1.svg";
import svg2 from "../assets/2.svg";
import svg3 from "../assets/3.svg";

const ICE_SERVERS = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
    {
      urls: "stun:stun1.l.google.com:19302",
    },
  ],
};

const RoomComponent = ({ socket, userData, onExit }) => {
  /*
   * =========================
   * STATE
   * =========================
   */

  const [players, setPlayers] = useState([]);

  const [isMicOn, setIsMicOn] = useState(true);

  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [volumes, setVolumes] = useState({});

  const [remoteStreams, setRemoteStreams] = useState({});

  const [isSpeaking, setIsSpeaking] = useState(false);

  /*
   * =========================
   * REFS
   * =========================
   */

  const localAudioStreamRef = useRef(null);

  const screenStreamRef = useRef(null);

  const peersRef = useRef(new Map());

  const remoteStreamsRef = useRef(new Map());

  const audioElementsRef = useRef(new Map());

  const analyserRef = useRef(null);

  const audioContextRef = useRef(null);

  const animationRef = useRef(null);

  const mountedRef = useRef(true);

  /*
   * =========================
   * LOCAL MICROPHONE
   * =========================
   */

  useEffect(() => {
    mountedRef.current = true;

    let cancelled = false;

    const startMicrophone = async () => {
      try {
        const microphone = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        if (cancelled) {
          microphone.getTracks().forEach((track) => track.stop());

          return;
        }

        localAudioStreamRef.current = microphone;

        /*
         * Анализатор голоса.
         */
        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;

          if (AudioContext) {
            const audioContext = new AudioContext();

            const source = audioContext.createMediaStreamSource(microphone);

            const analyser = audioContext.createAnalyser();

            analyser.fftSize = 256;

            source.connect(analyser);

            analyserRef.current = analyser;
            audioContextRef.current = audioContext;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const checkVolume = () => {
              if (!analyserRef.current) {
                return;
              }

              analyserRef.current.getByteFrequencyData(dataArray);

              let sum = 0;

              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }

              const average = sum / dataArray.length;

              setIsSpeaking(average > 8 && isMicOn);

              animationRef.current = requestAnimationFrame(checkVolume);
            };

            checkVolume();
          }
        } catch (error) {
          console.warn("Audio analyser error:", error);
        }

        /*
         * Добавляем микрофон в уже существующие
         * WebRTC-соединения.
         */
        peersRef.current.forEach(({ pc }) => {
          const audioTrack = microphone.getAudioTracks()[0];

          if (!audioTrack) {
            return;
          }

          const alreadyExists = pc
            .getSenders()
            .some((sender) => sender.track?.kind === "audio");

          if (!alreadyExists) {
            pc.addTrack(audioTrack, microphone);
          }
        });
      } catch (error) {
        console.error("Microphone error:", error);

        alert("Не удалось получить доступ к микрофону");

        setIsMicOn(false);
      }
    };

    startMicrophone();

    return () => {
      cancelled = true;

      if (localAudioStreamRef.current) {
        localAudioStreamRef.current
          .getTracks()
          .forEach((track) => track.stop());

        localAudioStreamRef.current = null;
      }

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();

        audioContextRef.current = null;
      }

      analyserRef.current = null;
    };
  }, [isMicOn]);

  /*
   * =========================
   * WEBRTC PEER
   * =========================
   */

  const closePeer = useCallback((peerId) => {
    const peer = peersRef.current.get(peerId);

    if (peer) {
      try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.close();
      } catch {
        // ignore
      }
    }

    peersRef.current.delete(peerId);

    const stream = remoteStreamsRef.current.get(peerId);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    remoteStreamsRef.current.delete(peerId);

    setRemoteStreams((prev) => {
      const next = {
        ...prev,
      };

      delete next[peerId];

      return next;
    });

    const audio = audioElementsRef.current.get(peerId);

    if (audio) {
      audio.pause();
      audio.srcObject = null;
    }

    audioElementsRef.current.delete(peerId);
  }, []);

  const createPeerConnection = useCallback(
    (peerId, peerUsername) => {
      // Если peer уже существует, возвращаем его
      if (peersRef.current.has(peerId)) {
        return peersRef.current.get(peerId).pc;
      }

      const pc = new RTCPeerConnection(ICE_SERVERS);

      /*
       * Создаём объект remote stream.
       */
      const remoteStream = new MediaStream();

      remoteStreamsRef.current.set(peerId, remoteStream);

      setRemoteStreams((prev) => ({
        ...prev,
        [peerId]: {
          stream: remoteStream,
          username: peerUsername,
        },
      }));

      /*
       * Получение удалённых track.
       */
      pc.ontrack = (event) => {
        const stream = remoteStreamsRef.current.get(peerId);

        if (!stream) {
          return;
        }

        event.streams.forEach((incomingStream) => {
          incomingStream.getTracks().forEach((track) => {
            const exists = stream
              .getTracks()
              .some((item) => item.id === track.id);

            if (!exists) {
              stream.addTrack(track);
            }

            track.onended = () => {
              stream.removeTrack(track);

              setRemoteStreams((prev) => ({
                ...prev,
              }));
            };
          });
        });

        setRemoteStreams((prev) => ({
          ...prev,
        }));
      };

      /*
       * ICE candidates.
       */
      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        socket.emit("signal", {
          to: peerId,
          signal: {
            type: "ice-candidate",
            candidate: event.candidate,
          },
        });
      };

      /*
       * Закрытие соединения.
       */
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;

        console.log(`Peer ${peerId}: ${state}`);

        if (
          state === "failed" ||
          state === "closed" ||
          state === "disconnected"
        ) {
          closePeer(peerId);
        }
      };

      /*
       * Добавляем микрофон.
       */
      const microphone = localAudioStreamRef.current;

      if (microphone) {
        microphone.getTracks().forEach((track) => {
          pc.addTrack(track, microphone);
        });
      }

      /*
       * Добавляем демонстрацию экрана,
       * если она уже включена.
       */
      const screenStream = screenStreamRef.current;

      if (screenStream) {
        screenStream.getTracks().forEach((track) => {
          pc.addTrack(track, screenStream);
        });
      }

      const peerData = {
        pc,
        username: peerUsername,
        remoteStream,
      };

      peersRef.current.set(peerId, peerData);

      return pc;
    },
    [socket, closePeer],
  );

  /*
   * =========================
   * CREATE OFFER
   * =========================
   */

  const createOffer = useCallback(
    async (peerId) => {
      const peer = peersRef.current.get(peerId);

      if (!peer) {
        return;
      }

      try {
        const offer = await peer.pc.createOffer();

        await peer.pc.setLocalDescription(offer);

        socket.emit("signal", {
          to: peerId,
          signal: {
            type: "offer",
            sdp: offer,
          },
        });
      } catch (error) {
        console.error("Create offer error:", error);
      }
    },
    [socket],
  );

  /*
   * =========================
   * EXISTING PEERS
   * =========================
   */

  useEffect(() => {
    const handleExistingPeers = async (existingPeers) => {
      console.log("[EXISTING PEERS]", existingPeers);

      for (const peer of existingPeers) {
        // Создаём peer соединение
        const pc = createPeerConnection(peer.id, peer.username);

        // Создаём offer для каждого существующего peer'а
        if (pc.signalingState === "stable") {
          await createOffer(peer.id);
        }
      }
    };

    socket.on("existing-peers", handleExistingPeers);

    return () => {
      socket.off("existing-peers", handleExistingPeers);
    };
  }, [socket, createPeerConnection, createOffer]);

  /*
   * =========================
   * NEW PEER
   * =========================
   */

  useEffect(() => {
    const handleNewPeer = async ({ id, username }) => {
      console.log("[NEW PEER]", id, username);

      // Создаём peer соединение
      const pc = createPeerConnection(id, username);

      // Создаём offer для нового peer'а
      if (pc.signalingState === "stable") {
        await createOffer(id);
      }
    };

    socket.on("new-peer", handleNewPeer);

    return () => {
      socket.off("new-peer", handleNewPeer);
    };
  }, [socket, createPeerConnection, createOffer]);

  /*
   * =========================
   * SIGNAL
   * =========================
   */

  useEffect(() => {
    const handleSignal = async ({ from, signal }) => {
      console.log("[SIGNAL] from:", from, "type:", signal.type);

      let peer = peersRef.current.get(from);

      /*
       * Если peer ещё не создан,
       * создаём его.
       */
      if (!peer) {
        const player = players.find((item) => item.id === from);

        createPeerConnection(from, player?.username || "Пользователь");

        peer = peersRef.current.get(from);
      }

      if (!peer) {
        return;
      }

      try {
        /*
         * OFFER
         */
        if (signal.type === "offer") {
          await peer.pc.setRemoteDescription(
            new RTCSessionDescription(signal.sdp),
          );

          const answer = await peer.pc.createAnswer();

          await peer.pc.setLocalDescription(answer);

          socket.emit("signal", {
            to: from,
            signal: {
              type: "answer",
              sdp: answer,
            },
          });
        }

        /*
         * ANSWER
         */
        if (signal.type === "answer") {
          await peer.pc.setRemoteDescription(
            new RTCSessionDescription(signal.sdp),
          );
        }

        /*
         * ICE
         */
        if (signal.type === "ice-candidate") {
          try {
            await peer.pc.addIceCandidate(
              new RTCIceCandidate(signal.candidate),
            );
          } catch (error) {
            console.warn("ICE candidate error:", error);
          }
        }
      } catch (error) {
        console.error("WebRTC signal error:", error);
      }
    };

    socket.on("signal", handleSignal);

    return () => {
      socket.off("signal", handleSignal);
    };
  }, [socket, players, createPeerConnection]);

  /*
   * =========================
   * PLAYER LEFT
   * =========================
   */

  useEffect(() => {
    const handlePlayerLeft = (playerId) => {
      console.log("[PLAYER LEFT]", playerId);
      closePeer(playerId);
    };

    socket.on("player-left", handlePlayerLeft);

    return () => {
      socket.off("player-left", handlePlayerLeft);
    };
  }, [socket, closePeer]);

  /*
   * =========================
   * PLAYERS UPDATE
   * =========================
   */

  useEffect(() => {
    const handlePlayersUpdate = (updatedPlayers) => {
      console.log("[PLAYERS UPDATE]", updatedPlayers);
      setPlayers(updatedPlayers);
    };

    socket.on("players-update", handlePlayersUpdate);

    return () => {
      socket.off("players-update", handlePlayersUpdate);
    };
  }, [socket]);

  /*
   * =========================
   * MICROPHONE TOGGLE
   * =========================
   */

  const toggleMic = () => {
    const newValue = !isMicOn;

    setIsMicOn(newValue);

    const microphone = localAudioStreamRef.current;

    if (microphone) {
      microphone.getAudioTracks().forEach((track) => {
        track.enabled = newValue;
      });
    }

    socket.emit("toggle-mic", !newValue);
  };

  /*
   * =========================
   * SCREEN SHARING
   * =========================
   */

  const renegotiateAllPeers = useCallback(async () => {
    for (const [peerId, peer] of peersRef.current) {
      try {
        if (peer.pc.signalingState !== "stable") {
          continue;
        }

        const offer = await peer.pc.createOffer();

        await peer.pc.setLocalDescription(offer);

        socket.emit("signal", {
          to: peerId,
          signal: {
            type: "offer",
            sdp: offer,
          },
        });
      } catch (error) {
        console.error("Renegotiation error:", error);
      }
    }
  }, [socket]);

  const toggleScreen = async () => {
    if (isScreenSharing) {
      stopScreenSharing();
      return;
    }

    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: 60,
            max: 60,
          },
        },
        audio: true,
      });

      screenStreamRef.current = screen;

      setIsScreenSharing(true);

      /*
       * Добавляем экран в peer connections.
       */
      peersRef.current.forEach(({ pc }) => {
        screen.getTracks().forEach((track) => {
          pc.addTrack(track, screen);
        });
      });

      /*
       * Если пользователь сам нажал
       * "остановить демонстрацию"
       * в системном меню браузера.
       */
      const videoTrack = screen.getVideoTracks()[0];

      if (videoTrack) {
        videoTrack.onended = () => {
          stopScreenSharing();
        };
      }

      await renegotiateAllPeers();
    } catch (error) {
      console.error("Screen sharing error:", error);

      if (error?.name !== "NotAllowedError") {
        alert("Не удалось получить доступ к демонстрации экрана");
      }
    }
  };

  /*
   * =========================
   * STOP SCREEN
   * =========================
   */

  const stopScreenSharing = useCallback(async () => {
    const screen = screenStreamRef.current;

    if (!screen) {
      setIsScreenSharing(false);
      return;
    }

    /*
     * Удаляем video/audio senders.
     */
    peersRef.current.forEach(({ pc }) => {
      pc.getSenders().forEach((sender) => {
        if (
          sender.track &&
          screen.getTracks().some((track) => track.id === sender.track.id)
        ) {
          try {
            pc.removeTrack(sender);
          } catch {
            // ignore
          }
        }
      });
    });

    screen.getTracks().forEach((track) => {
      track.stop();
    });

    screenStreamRef.current = null;

    setIsScreenSharing(false);

    await renegotiateAllPeers();
  }, [renegotiateAllPeers]);

  /*
   * =========================
   * REMOTE AUDIO
   * =========================
   */

  useEffect(() => {
    Object.entries(remoteStreams).forEach(([peerId, data]) => {
      const stream = data.stream;

      let audio = audioElementsRef.current.get(peerId);

      if (!audio) {
        audio = document.createElement("audio");

        audio.autoplay = true;
        audio.playsInline = true;

        audioElementsRef.current.set(peerId, audio);
      }

      audio.srcObject = stream;

      const volume = volumes[peerId] ?? 100;

      audio.volume = Math.max(0, Math.min(2, volume / 100));

      audio.play().catch(() => {
        /*
         * Браузер может запретить autoplay.
         * После первого клика пользователя
         * воспроизведение обычно разрешается.
         */
      });
    });
  }, [remoteStreams, volumes]);

  /*
   * =========================
   * VOLUME
   * =========================
   */

  const handleVolumeChange = (playerId, value) => {
    const volume = Number(value);

    setVolumes((previous) => ({
      ...previous,
      [playerId]: volume,
    }));

    const audio = audioElementsRef.current.get(playerId);

    if (audio) {
      audio.volume = Math.max(0, Math.min(2, volume / 100));
    }
  };

  /*
   * =========================
   * EXIT
   * =========================
   */

  const exitRoom = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());

      screenStreamRef.current = null;
    }

    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getTracks().forEach((track) => track.stop());

      localAudioStreamRef.current = null;
    }

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();

      audioContextRef.current = null;
    }

    peersRef.current.forEach(({ pc }) => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    });

    peersRef.current.clear();

    remoteStreamsRef.current.clear();

    audioElementsRef.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;
    });

    audioElementsRef.current.clear();

    socket.emit("leave-room");

    onExit();
  }, [socket, onExit]);

  /*
   * =========================
   * CLEANUP
   * =========================
   */

  useEffect(() => {
    return () => {
      mountedRef.current = false;

      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      if (localAudioStreamRef.current) {
        localAudioStreamRef.current
          .getTracks()
          .forEach((track) => track.stop());
      }

      peersRef.current.forEach(({ pc }) => {
        try {
          pc.close();
        } catch {
          // ignore
        }
      });

      peersRef.current.clear();

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  /*
   * =========================
   * RENDER
   * =========================
   */

  const currentSocketId = socket.id;

  /*
   * Находим первый удалённый screen stream.
   */
  const remoteScreen = Object.entries(remoteStreams).find(
    ([, data]) => data.stream.getVideoTracks().length > 0,
  );

  if (!userData) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-[#F5EFD7] font-['Alumni']">
      <div className="w-full h-full flex flex-col">
        {/* ================= HEADER ================= */}

        <header className="h-[62px] flex items-center border-b-3 border-[#5E454B] pl-[27px] pr-[27px]">
          <div className="flex gap-[7px] text-[27px] text-[#5E454B]">
            <span>КОМНАТА:</span>
            <span>{userData.room}</span>
          </div>

          <div className="w-[4px] h-[46px] bg-[#5E454B] mx-[35px]" />

          <div className="text-[27px] text-[#5E454B]">
            УЧАСТНИКОВ: <span>{players.length}</span>
          </div>

          <div className="ml-auto flex items-center gap-[30px] text-[27px] text-[#5E454B]">
            <span>{userData.username}</span>
          </div>
        </header>

        {/* ================= MAIN ================= */}

        <div className="flex-1 grid grid-cols-[minmax(0,1fr)_360px] gap-[45px] p-[14px_27px_20px_90px]">
          {/* LEFT */}

          <div className="flex flex-col">
            {/* SCREEN */}

            <div className="w-full aspect-video border-3 border-[#5E454B] flex items-center justify-center bg-[#F5EFD7] relative overflow-hidden">
              {isScreenSharing ? (
                <video
                  ref={(element) => {
                    if (!element) {
                      return;
                    }

                    element.srcObject = screenStreamRef.current;

                    element.play().catch(() => {});
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain"
                />
              ) : remoteScreen ? (
                <video
                  key={remoteScreen[0]}
                  ref={(element) => {
                    if (!element) {
                      return;
                    }

                    element.srcObject = remoteScreen[1].stream;

                    element.play().catch(() => {});
                  }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-[30px] flex items-center gap-[10px] text-[#5E454B]">
                  <span>NO SIGNAL</span>

                  <span className="text-[35px] leading-none">•</span>
                </div>
              )}
            </div>

            {/* CONTROLS */}

            <div className="h-[92px] flex items-center gap-[45px]">
              {/* MICROPHONE */}

              <button
                onClick={toggleMic}
                className="flex items-center gap-[14px] text-[24px] text-[#5E454B] cursor-pointer hover:opacity-70 transition-opacity"
              >
                <span
                  className={`w-[66px] h-[66px] border-3 flex items-center justify-center ${
                    !isMicOn ? "border-red-500" : "border-[#5E454B]"
                  }`}
                >
                  <img
                    src={svg3}
                    alt="mic"
                    className={`w-8 h-8 ${!isMicOn ? "opacity-50" : ""}`}
                  />
                </span>

                <span>{isMicOn ? "МИКРОФОН" : "ВЫКЛ"}</span>
              </button>

              {/* SCREEN */}

              <button
                onClick={toggleScreen}
                className="flex items-center gap-[14px] text-[24px] text-[#5E454B] cursor-pointer hover:opacity-70 transition-opacity"
              >
                <span
                  className={`w-[66px] h-[66px] border-3 flex items-center justify-center ${
                    isScreenSharing ? "bg-[#5E454B]" : "border-[#5E454B]"
                  }`}
                >
                  <img
                    src={svg1}
                    alt="screen"
                    className={`w-8 h-8 ${isScreenSharing ? "invert" : ""}`}
                  />
                </span>

                <span>{isScreenSharing ? "ОСТАНОВИТЬ" : "ДЕМОНСТРАЦИЯ"}</span>
              </button>

              {/* SETTINGS */}

              <button
                onClick={() => setIsSettingsOpen((value) => !value)}
                className="flex items-center gap-[14px] text-[24px] text-[#5E454B] cursor-pointer hover:opacity-70 transition-opacity"
              >
                <span className="w-[66px] h-[66px] border-3 border-[#5E454B] flex items-center justify-center">
                  <img src={svg2} alt="settings" className="w-8 h-8" />
                </span>

                <span>НАСТРОЙКИ</span>
              </button>

              <div className="flex-1" />

              {/* EXIT */}

              <button
                onClick={exitRoom}
                className="h-[66px] border-3 border-[#5E454B] px-[45px] text-[23px] text-[#5E454B] cursor-pointer hover:bg-[#5E454B] hover:text-[#F5EFD7] transition-colors"
              >
                ПОКИНУТЬ КОМНАТУ
              </button>
            </div>
          </div>

          {/* ================= PARTICIPANTS ================= */}

          <div className="border-3 border-[#5E454B] p-[32px_42px] overflow-y-auto">
            <h2 className="text-[29px] font-normal text-[#5E454B]">
              УЧАСТНИКИ
            </h2>

            <div className="w-[41px] h-[3px] bg-[#5E454B] mt-[17px] mb-[35px]" />

            {players.map((player) => {
              const isCurrentUser = player.id === currentSocketId;

              const muted = isCurrentUser ? !isMicOn : player.isMuted;

              const speaking = isCurrentUser && isSpeaking;

              return (
                <div
                  key={player.id}
                  className="grid grid-cols-[47px_1fr_30px] items-center gap-[15px] mb-[20px]"
                >
                  <div
                    className={`w-[47px] h-[47px] transition-all duration-100 ${
                      muted
                        ? "bg-red-500"
                        : speaking
                          ? "bg-[#5E454B] opacity-100"
                          : "bg-[#5E454B] opacity-70"
                    }`}
                  />

                  <span className="text-[20px] text-[#5E454B]">
                    {player.username}

                    {isCurrentUser && " (Вы)"}
                  </span>

                  <span className="text-[16px] text-[#5E454B]">
                    <span className={muted ? "text-red-500" : "text-green-500"}>
                      ●
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ================= SETTINGS ================= */}

        {isSettingsOpen && (
          <div className="fixed right-[30px] bottom-[100px] w-[460px] max-h-[600px] overflow-y-auto bg-[#F5EFD7] border-3 border-[#5E454B] p-[25px] z-50">
            <div className="flex items-center justify-between border-b-3 border-[#5E454B] pb-[15px] mb-[20px]">
              <h2 className="text-[29px] font-normal text-[#5E454B]">
                ГРОМКОСТЬ
              </h2>

              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-[35px] text-[#5E454B] cursor-pointer"
              >
                ×
              </button>
            </div>

            {players.map((player) => {
              const volume = volumes[player.id] ?? 100;

              const isCurrentUser = player.id === currentSocketId;

              return (
                <div
                  key={player.id}
                  className="grid grid-cols-[47px_100px_1fr] items-center gap-[15px] mb-[25px]"
                >
                  <div
                    className={`w-[47px] h-[47px] ${
                      isCurrentUser && !isMicOn ? "bg-red-500" : "bg-[#5E454B]"
                    }`}
                  />

                  <span className="text-[19px] text-[#5E454B]">
                    {player.username}

                    {isCurrentUser && " (Вы)"}
                  </span>

                  <div className="flex flex-col gap-[3px]">
                    <div className="text-[17px] text-center text-[#5E454B]">
                      {volume}%
                    </div>

                    <div className="relative w-full h-[6px] bg-[#F5EFD7] border-2 border-[#5E454B] flex items-center">
                      <div
                        className="absolute h-full bg-[#5E454B]"
                        style={{
                          width: `${Math.min(100, volume / 2)}%`,
                        }}
                      />

                      <input
                        type="range"
                        min="0"
                        max="200"
                        value={volume}
                        onChange={(event) =>
                          handleVolumeChange(player.id, event.target.value)
                        }
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />

                      <div
                        className="absolute w-[20px] h-[20px] bg-[#F5EFD7] border-2 border-[#5E454B] pointer-events-none"
                        style={{
                          left: `${Math.min(100, volume / 2)}%`,
                          transform: "translate(-50%, 0)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default RoomComponent;
