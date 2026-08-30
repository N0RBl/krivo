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
  const [players, setPlayers] = useState([]);
  const [isMicOn, setIsMicOn] = useState(true);

  const [isScreenSharing, setIsScreenSharing] = useState(false);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [volumes, setVolumes] = useState({});

  const [isSpeaking, setIsSpeaking] = useState(false);

  const [remoteStreams, setRemoteStreams] = useState({});

  const localAudioStreamRef = useRef(null);

  const screenStreamRef = useRef(null);

  const peersRef = useRef(new Map());

  const remoteStreamsRef = useRef(new Map());

  const audioElementsRef = useRef(new Map());

  const analyserRef = useRef(null);

  const audioContextRef = useRef(null);

  const animationRef = useRef(null);

  const mountedRef = useRef(true);

  const pendingIceRef = useRef(new Map());

  // ------------------------------------------------
  // MICROPHONE
  // ------------------------------------------------

  useEffect(() => {
    mountedRef.current = true;

    let cancelled = false;

    const startMicrophone = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error(
            "getUserMedia недоступен. Нужен HTTPS или localhost.",
          );
        }

        console.log("[MEDIA] requesting microphone...");

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

        console.log("[MEDIA] microphone ready");

        localAudioStreamRef.current = microphone;

        const audioTrack = microphone.getAudioTracks()[0];

        if (audioTrack) {
          audioTrack.enabled = isMicOn;
        }

        // Add microphone to all existing peers.
        peersRef.current.forEach(({ pc }) => {
          if (!audioTrack) {
            return;
          }

          const exists = pc
            .getSenders()
            .some((sender) => sender.track?.kind === "audio");

          if (!exists) {
            pc.addTrack(audioTrack, microphone);
          }
        });

        // Voice analyser.
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
          console.warn("[MEDIA] analyser error:", error);
        }
      } catch (error) {
        console.error("[MEDIA] microphone error:", error);

        setIsMicOn(false);

        alert(
          "Не удалось получить доступ к микрофону. Проверь HTTPS и разрешение браузера.",
        );
      }
    };

    startMicrophone();

    return () => {
      cancelled = true;
    };
  }, []);

  // ------------------------------------------------
  // MICROPHONE STATE
  // ------------------------------------------------

  useEffect(() => {
    const microphone = localAudioStreamRef.current;

    if (!microphone) {
      return;
    }

    microphone.getAudioTracks().forEach((track) => {
      track.enabled = isMicOn;
    });
  }, [isMicOn]);

  // ------------------------------------------------
  // CLOSE PEER
  // ------------------------------------------------

  const closePeer = useCallback((peerId) => {
    console.log("[WEBRTC] closing peer:", peerId);

    const peer = peersRef.current.get(peerId);

    if (peer) {
      try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.oniceconnectionstatechange = null;

        peer.pc.close();
      } catch {
        // ignore
      }
    }

    peersRef.current.delete(peerId);

    pendingIceRef.current.delete(peerId);

    const stream = remoteStreamsRef.current.get(peerId);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    remoteStreamsRef.current.delete(peerId);

    setRemoteStreams((previous) => {
      const next = {
        ...previous,
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

  // ------------------------------------------------
  // CREATE PEER
  // ------------------------------------------------

  const createPeerConnection = useCallback(
    (peerId, peerUsername) => {
      const existing = peersRef.current.get(peerId);

      if (existing) {
        return existing.pc;
      }

      console.log("[WEBRTC] creating peer:", peerId, peerUsername);

      const pc = new RTCPeerConnection(ICE_SERVERS);

      const remoteStream = new MediaStream();

      remoteStreamsRef.current.set(peerId, remoteStream);

      pendingIceRef.current.set(peerId, []);

      setRemoteStreams((previous) => ({
        ...previous,
        [peerId]: {
          stream: remoteStream,
          username: peerUsername || "Пользователь",
        },
      }));

      // ------------------------------
      // REMOTE TRACK
      // ------------------------------

      pc.ontrack = (event) => {
        console.log("[WEBRTC] remote track:", peerId, event.track.kind);

        const stream = remoteStreamsRef.current.get(peerId);

        if (!stream) {
          return;
        }

        if (!stream.getTracks().some((track) => track.id === event.track.id)) {
          stream.addTrack(event.track);
        }

        event.track.onended = () => {
          try {
            stream.removeTrack(event.track);
          } catch {
            // ignore
          }

          setRemoteStreams((previous) => ({
            ...previous,
          }));
        };

        setRemoteStreams((previous) => ({
          ...previous,
        }));
      };

      // ------------------------------
      // ICE CANDIDATE
      // ------------------------------

      pc.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }

        console.log("[WEBRTC] ICE candidate ->", peerId);

        socket.emit("signal", {
          to: peerId,

          signal: {
            type: "ice-candidate",
            candidate: event.candidate,
          },
        });
      };

      // ------------------------------
      // CONNECTION STATE
      // ------------------------------

      pc.onconnectionstatechange = () => {
        console.log("[WEBRTC] connection:", peerId, pc.connectionState);

        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          closePeer(peerId);
        }
      };

      // ------------------------------
      // ICE STATE
      // ------------------------------

      pc.oniceconnectionstatechange = () => {
        console.log("[WEBRTC] ICE:", peerId, pc.iceConnectionState);
      };

      // ------------------------------
      // LOCAL MICROPHONE
      // ------------------------------

      const microphone = localAudioStreamRef.current;

      if (microphone) {
        microphone.getTracks().forEach((track) => {
          pc.addTrack(track, microphone);
        });
      }

      // ------------------------------
      // LOCAL SCREEN
      // ------------------------------

      const screen = screenStreamRef.current;

      if (screen) {
        screen.getTracks().forEach((track) => {
          pc.addTrack(track, screen);
        });
      }

      peersRef.current.set(peerId, {
        pc,
        username: peerUsername || "Пользователь",
        remoteStream,
      });

      return pc;
    },
    [socket, closePeer],
  );

  // ------------------------------------------------
  // CREATE OFFER
  // ------------------------------------------------

  const createOffer = useCallback(
    async (peerId) => {
      const peer = peersRef.current.get(peerId);

      if (!peer) {
        return;
      }

      try {
        if (peer.pc.signalingState !== "stable") {
          console.warn(
            "[WEBRTC] cannot create offer, state:",
            peer.pc.signalingState,
          );

          return;
        }

        console.log("[WEBRTC] creating offer ->", peerId);

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
        console.error("[WEBRTC] create offer error:", error);
      }
    },
    [socket],
  );

  // ------------------------------------------------
  // EXISTING PEERS
  //
  // IMPORTANT:
  // Only the NEW USER creates offers.
  // ------------------------------------------------

  useEffect(() => {
    const handleExistingPeers = async (existingPeers) => {
      console.log("[WEBRTC] existing peers:", existingPeers);

      for (const peer of existingPeers) {
        if (!peer?.id || peer.id === socket.id) {
          continue;
        }

        createPeerConnection(peer.id, peer.username);

        await createOffer(peer.id);
      }
    };

    socket.on("existing-peers", handleExistingPeers);

    return () => {
      socket.off("existing-peers", handleExistingPeers);
    };
  }, [socket, createPeerConnection, createOffer]);

  // ------------------------------------------------
  // NEW PEER
  //
  // IMPORTANT:
  // Existing users DO NOT create offers.
  // They only wait for offer.
  // ------------------------------------------------

  useEffect(() => {
    const handleNewPeer = ({ id, username }) => {
      console.log("[WEBRTC] new peer:", id, username);

      // We don't create an offer here.
      // The new user creates it.
      //
      // We can optionally prepare the peer
      // connection immediately.

      createPeerConnection(id, username);
    };

    socket.on("new-peer", handleNewPeer);

    return () => {
      socket.off("new-peer", handleNewPeer);
    };
  }, [socket, createPeerConnection]);

  // ------------------------------------------------
  // SIGNAL
  // ------------------------------------------------

  useEffect(() => {
    const handleSignal = async ({ from, signal }) => {
      if (!from || !signal) {
        return;
      }

      console.log("[SIGNAL]", signal.type, "from:", from);

      let peer = peersRef.current.get(from);

      if (!peer) {
        const player = players.find((item) => item.id === from);

        createPeerConnection(from, player?.username || "Пользователь");

        peer = peersRef.current.get(from);
      }

      if (!peer) {
        return;
      }

      try {
        // ----------------------------------------
        // OFFER
        // ----------------------------------------

        if (signal.type === "offer") {
          await peer.pc.setRemoteDescription(
            new RTCSessionDescription(signal.sdp),
          );

          // Add queued ICE candidates.
          const queue = pendingIceRef.current.get(from) || [];

          for (const candidate of queue) {
            try {
              await peer.pc.addIceCandidate(candidate);
            } catch (error) {
              console.warn("[WEBRTC] queued ICE error:", error);
            }
          }

          pendingIceRef.current.set(from, []);

          const answer = await peer.pc.createAnswer();

          await peer.pc.setLocalDescription(answer);

          socket.emit("signal", {
            to: from,

            signal: {
              type: "answer",
              sdp: answer,
            },
          });

          return;
        }

        // ----------------------------------------
        // ANSWER
        // ----------------------------------------

        if (signal.type === "answer") {
          if (peer.pc.signalingState !== "have-local-offer") {
            console.warn(
              "[WEBRTC] ignoring answer, state:",
              peer.pc.signalingState,
            );

            return;
          }

          await peer.pc.setRemoteDescription(
            new RTCSessionDescription(signal.sdp),
          );

          // Add queued ICE candidates.
          const queue = pendingIceRef.current.get(from) || [];

          for (const candidate of queue) {
            try {
              await peer.pc.addIceCandidate(candidate);
            } catch (error) {
              console.warn("[WEBRTC] queued ICE error:", error);
            }
          }

          pendingIceRef.current.set(from, []);

          return;
        }

        // ----------------------------------------
        // ICE CANDIDATE
        // ----------------------------------------

        if (signal.type === "ice-candidate") {
          const candidate = new RTCIceCandidate(signal.candidate);

          if (peer.pc.remoteDescription) {
            try {
              await peer.pc.addIceCandidate(candidate);
            } catch (error) {
              console.warn("[WEBRTC] ICE candidate error:", error);
            }
          } else {
            const queue = pendingIceRef.current.get(from) || [];

            queue.push(candidate);

            pendingIceRef.current.set(from, queue);

            console.log("[WEBRTC] queued ICE candidate:", from);
          }
        }
      } catch (error) {
        console.error("[WEBRTC] signal error:", error);
      }
    };

    socket.on("signal", handleSignal);

    return () => {
      socket.off("signal", handleSignal);
    };
  }, [socket, players, createPeerConnection]);

  // ------------------------------------------------
  // PLAYER LEFT
  // ------------------------------------------------

  useEffect(() => {
    const handlePlayerLeft = (playerId) => {
      console.log("[WEBRTC] player left:", playerId);

      closePeer(playerId);
    };

    socket.on("player-left", handlePlayerLeft);

    return () => {
      socket.off("player-left", handlePlayerLeft);
    };
  }, [socket, closePeer]);

  // ------------------------------------------------
  // PLAYERS
  // ------------------------------------------------

  useEffect(() => {
    const handlePlayersUpdate = (updatedPlayers) => {
      console.log("[ROOM] players:", updatedPlayers);

      setPlayers(updatedPlayers);
    };

    socket.on("players-update", handlePlayersUpdate);

    return () => {
      socket.off("players-update", handlePlayersUpdate);
    };
  }, [socket]);

  // ------------------------------------------------
  // MIC TOGGLE
  // ------------------------------------------------

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

  // ------------------------------------------------
  // RENEGOTIATE
  // ------------------------------------------------

  const renegotiatePeer = useCallback(
    async (peerId, peer) => {
      try {
        if (peer.pc.signalingState !== "stable") {
          console.warn(
            "[WEBRTC] renegotiation skipped:",
            peerId,
            peer.pc.signalingState,
          );

          return;
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
        console.error("[WEBRTC] renegotiation error:", peerId, error);
      }
    },
    [socket],
  );

  const renegotiateAllPeers = useCallback(async () => {
    for (const [peerId, peer] of peersRef.current) {
      await renegotiatePeer(peerId, peer);
    }
  }, [renegotiatePeer]);

  // ------------------------------------------------
  // START SCREEN SHARE
  // ------------------------------------------------

  const toggleScreen = async () => {
    if (isScreenSharing) {
      await stopScreenSharing();
      return;
    }

    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        alert(
          "Демонстрация экрана недоступна. Нужен HTTPS и поддерживаемый браузер.",
        );

        return;
      }

      console.log("[SCREEN] requesting screen...");

      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: {
            ideal: 30,
            max: 60,
          },
        },
        audio: true,
      });

      screenStreamRef.current = screen;

      setIsScreenSharing(true);

      // Add screen tracks to peers.
      peersRef.current.forEach(({ pc }) => {
        screen.getTracks().forEach((track) => {
          pc.addTrack(track, screen);
        });
      });

      const videoTrack = screen.getVideoTracks()[0];

      if (videoTrack) {
        videoTrack.onended = async () => {
          await stopScreenSharing();
        };
      }

      console.log("[SCREEN] screen sharing started");

      await renegotiateAllPeers();
    } catch (error) {
      console.error("[SCREEN] error:", error);

      if (error?.name !== "NotAllowedError") {
        alert("Не удалось получить доступ к демонстрации экрана.");
      }
    }
  };

  // ------------------------------------------------
  // STOP SCREEN
  // ------------------------------------------------

  const stopScreenSharing = useCallback(async () => {
    const screen = screenStreamRef.current;

    if (!screen) {
      setIsScreenSharing(false);
      return;
    }

    console.log("[SCREEN] stopping...");

    peersRef.current.forEach(({ pc }) => {
      pc.getSenders().forEach((sender) => {
        if (!sender.track) {
          return;
        }

        const belongsToScreen = screen
          .getTracks()
          .some((track) => track.id === sender.track.id);

        if (belongsToScreen) {
          try {
            pc.removeTrack(sender);
          } catch {
            // ignore
          }
        }
      });
    });

    screen.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });

    screenStreamRef.current = null;

    setIsScreenSharing(false);

    await renegotiateAllPeers();

    console.log("[SCREEN] stopped");
  }, [renegotiateAllPeers]);

  // ------------------------------------------------
  // REMOTE AUDIO
  // ------------------------------------------------

  useEffect(() => {
    Object.entries(remoteStreams).forEach(([peerId, data]) => {
      const stream = data.stream;

      let audio = audioElementsRef.current.get(peerId);

      if (!audio) {
        audio = document.createElement("audio");

        audio.autoplay = true;
        audio.playsInline = true;

        audioElementsRef.current.set(peerId, audio);

        document.body.appendChild(audio);
      }

      if (audio.srcObject !== stream) {
        audio.srcObject = stream;
      }

      const volume = volumes[peerId] ?? 100;

      audio.volume = Math.max(0, Math.min(2, volume / 100));

      audio.play().catch(() => {
        console.warn("[AUDIO] autoplay blocked for:", peerId);
      });
    });
  }, [remoteStreams, volumes]);

  // ------------------------------------------------
  // VOLUME
  // ------------------------------------------------

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

  // ------------------------------------------------
  // EXIT
  // ------------------------------------------------

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

    pendingIceRef.current.clear();

    remoteStreamsRef.current.clear();

    audioElementsRef.current.forEach((audio) => {
      audio.pause();
      audio.srcObject = null;

      if (audio.parentNode) {
        audio.parentNode.removeChild(audio);
      }
    });

    audioElementsRef.current.clear();

    socket.emit("leave-room");

    onExit();
  }, [socket, onExit]);

  // ------------------------------------------------
  // CLEANUP
  // ------------------------------------------------

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

      audioElementsRef.current.forEach((audio) => {
        audio.pause();
        audio.srcObject = null;

        if (audio.parentNode) {
          audio.parentNode.removeChild(audio);
        }
      });

      audioElementsRef.current.clear();
    };
  }, []);

  // ------------------------------------------------
  // RENDER
  // ------------------------------------------------

  const currentSocketId = socket.id;

  const remoteScreen = Object.entries(remoteStreams).find(
    ([, data]) => data.stream.getVideoTracks().length > 0,
  );

  if (!userData) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-[#F5EFD7] font-['Alumni']">
      <div className="w-full h-full flex flex-col">
        {/* HEADER */}

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

        {/* MAIN */}

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

          {/* PARTICIPANTS */}

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

        {/* SETTINGS */}

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
