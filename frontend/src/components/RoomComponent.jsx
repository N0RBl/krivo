import React, { useCallback, useEffect, useRef, useState } from "react";
import svg1 from "../assets/1.svg";
import svg2 from "../assets/2.svg";
import svg3 from "../assets/3.svg";

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const AUDIO_CONSTRAINTS = {
  channelCount: 1,
  sampleRate: 48000,
  sampleSize: 16,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

const RoomComponent = ({ socket, userData, onExit }) => {
  const [players, setPlayers] = useState([]);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [volumes, setVolumes] = useState({});
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});

  const localAudioStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const remoteStreamsRef = useRef(new Map());
  const audioElementsRef = useRef(new Map());
  const pendingIceRef = useRef(new Map());
  const mountedRef = useRef(true);
  const makingOfferRef = useRef(new Map());
  const ignoreOfferRef = useRef(new Map());
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);
  const currentSocketId = socket?.id;

  const unlockAudio = useCallback(async () => {
    console.log("[AUDIO] unlocking audio...");
    let playedSomething = false;

    for (const [peerId, audio] of audioElementsRef.current) {
      try {
        audio.muted = false;
        audio.volume = Math.max(0, Math.min(1, (volumes[peerId] ?? 100) / 100));
        await audio.play();
        console.log("[AUDIO] playback OK:", peerId);
        playedSomething = true;
      } catch (error) {
        console.warn("[AUDIO] playback still blocked:", peerId, error);
      }
    }

    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state === "suspended") {
          await audioContextRef.current.resume();
        }
      } catch (error) {
        console.warn("[AUDIO] AudioContext resume error:", error);
      }
    }

    setAudioUnlocked(true);
    return playedSomething;
  }, [volumes]);

  const createAudioElement = useCallback(
    (peerId, stream) => {
      let audio = audioElementsRef.current.get(peerId);

      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.controls = false;
        audio.muted = false;
        audio.setAttribute("playsinline", "");
        audio.setAttribute("webkit-playsinline", "");
        audioElementsRef.current.set(peerId, audio);

        audio.style.position = "fixed";
        audio.style.width = "1px";
        audio.style.height = "1px";
        audio.style.opacity = "0";
        audio.style.pointerEvents = "none";
        audio.style.left = "-10000px";
        audio.style.top = "-10000px";
        document.body.appendChild(audio);

        audio.addEventListener("play", () => {
          console.log("[AUDIO] element playing:", peerId);
        });

        audio.addEventListener("error", (event) => {
          console.warn("[AUDIO] element error:", peerId, event);
        });

        audio.addEventListener("volumechange", () => {
          console.log("[AUDIO] volume:", peerId, audio.volume);
        });
      }

      if (audio.srcObject !== stream) {
        audio.srcObject = stream;
      }

      audio.muted = false;
      audio.volume = Math.max(0, Math.min(1, (volumes[peerId] ?? 100) / 100));

      if (audio.paused) {
        audio.play().catch((error) => {
          console.warn("[AUDIO] autoplay blocked:", peerId, error);
        });
      }

      return audio;
    },
    [volumes],
  );

  const flushPendingIce = useCallback(async (peerId, pc) => {
    const queue = pendingIceRef.current.get(peerId);
    if (!queue || queue.length === 0) return;
    if (!pc.remoteDescription) return;

    console.log("[WEBRTC] flushing queued ICE:", peerId, queue.length);
    pendingIceRef.current.set(peerId, []);

    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.warn("[WEBRTC] queued ICE error:", peerId, error);
      }
    }
  }, []);

  const closePeer = useCallback((peerId) => {
    console.log("[WEBRTC] closing peer:", peerId);
    const peer = peersRef.current.get(peerId);

    if (peer) {
      try {
        peer.pc.ontrack = null;
        peer.pc.onicecandidate = null;
        peer.pc.oniceconnectionstatechange = null;
        peer.pc.onconnectionstatechange = null;
        peer.pc.onnegotiationneeded = null;
        peer.pc.close();
      } catch {}
    }

    peersRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    makingOfferRef.current.delete(peerId);
    ignoreOfferRef.current.delete(peerId);

    const stream = remoteStreamsRef.current.get(peerId);
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
    }

    remoteStreamsRef.current.delete(peerId);
    setRemoteStreams((previous) => {
      const next = { ...previous };
      delete next[peerId];
      return next;
    });

    const audio = audioElementsRef.current.get(peerId);
    if (audio) {
      try {
        audio.pause();
      } catch {}
      audio.srcObject = null;
      try {
        audio.remove();
      } catch {}
    }
    audioElementsRef.current.delete(peerId);
  }, []);

  const configureAudioCodec = useCallback((pc) => {
    try {
      if (!window.RTCRtpReceiver || !RTCRtpReceiver.getCapabilities) return;
      if (!pc.getTransceivers) return;

      const capabilities = RTCRtpReceiver.getCapabilities("audio");
      if (!capabilities?.codecs) return;

      const opusCodecs = capabilities.codecs.filter(
        (codec) => codec.mimeType?.toLowerCase() === "audio/opus",
      );

      if (opusCodecs.length === 0) {
        console.warn("[WEBRTC] Opus codec not found");
        return;
      }

      const transceiver = pc
        .getTransceivers()
        .find(
          (item) =>
            item.receiver?.track?.kind === "audio" ||
            item.sender?.track?.kind === "audio",
        );

      if (!transceiver) return;

      const otherCodecs = capabilities.codecs.filter(
        (codec) => codec.mimeType?.toLowerCase() !== "audio/opus",
      );

      transceiver.setCodecPreferences([...opusCodecs, ...otherCodecs]);
      console.log("[WEBRTC] Opus preferred");
    } catch (error) {
      console.warn("[WEBRTC] codec configuration error:", error);
    }
  }, []);

  const configureAudioSender = useCallback(async (pc) => {
    try {
      const sender = pc
        .getSenders()
        .find((item) => item.track?.kind === "audio");
      if (!sender) return;
      if (!sender.getParameters) return;

      const parameters = sender.getParameters();
      if (!parameters.encodings) {
        parameters.encodings = [{}];
      }

      parameters.encodings = parameters.encodings.map((encoding) => ({
        ...encoding,
        maxBitrate: 64000,
        minBitrate: 24000,
      }));

      await sender.setParameters(parameters);
      console.log("[WEBRTC] audio bitrate configured:", 64000);
    } catch (error) {
      console.warn("[WEBRTC] audio bitrate configuration error:", error);
    }
  }, []);

  const addMicrophoneToPeer = useCallback(
    async (peerId, pc) => {
      const microphone = localAudioStreamRef.current;
      if (!microphone) {
        console.warn("[AUDIO] microphone is not ready:", peerId);
        return;
      }

      const audioTrack = microphone.getAudioTracks()[0];
      if (!audioTrack) {
        console.warn("[AUDIO] no microphone track:", peerId);
        return;
      }

      audioTrack.enabled = isMicOn;
      let sender = pc.getSenders().find((item) => item.track?.kind === "audio");

      if (!sender) {
        try {
          sender = pc.addTrack(audioTrack, microphone);
          console.log("[AUDIO] microphone added:", peerId);
        } catch (error) {
          console.error("[AUDIO] addTrack error:", peerId, error);
          return;
        }
      } else if (sender.track !== audioTrack) {
        try {
          await sender.replaceTrack(audioTrack);
          console.log("[AUDIO] microphone replaced:", peerId);
        } catch (error) {
          console.warn("[AUDIO] replaceTrack error:", peerId, error);
        }
      }

      await configureAudioSender(pc);
    },
    [isMicOn, configureAudioSender],
  );

  const addScreenToPeer = useCallback(async (peerId, pc) => {
    const screen = screenStreamRef.current;
    if (!screen) return;

    for (const track of screen.getTracks()) {
      const exists = pc
        .getSenders()
        .some((sender) => sender.track?.id === track.id);

      if (exists) continue;

      try {
        pc.addTrack(track, screen);
        console.log("[SCREEN] track added:", peerId, track.kind);
      } catch (error) {
        console.error("[SCREEN] addTrack error:", peerId, error);
      }
    }
  }, []);

  const createPeerConnection = useCallback(
    (peerId, peerUsername) => {
      const existing = peersRef.current.get(peerId);
      if (existing) return existing.pc;

      console.log("[WEBRTC] creating peer:", peerId, peerUsername);
      const pc = new RTCPeerConnection(ICE_SERVERS);

      try {
        pc.addTransceiver("audio", { direction: "sendrecv" });
      } catch (error) {
        console.warn("[WEBRTC] audio transceiver error:", error);
      }

      configureAudioCodec(pc);

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

      pc.ontrack = (event) => {
        console.log(
          "[WEBRTC] REMOTE TRACK:",
          peerId,
          "kind:",
          event.track.kind,
          "state:",
          event.track.readyState,
        );

        const stream = remoteStreamsRef.current.get(peerId);
        if (!stream) {
          console.warn("[WEBRTC] remote stream missing:", peerId);
          return;
        }

        const alreadyExists = stream
          .getTracks()
          .some((track) => track.id === event.track.id);

        if (!alreadyExists) {
          stream.addTrack(event.track);
        }

        if (event.track.kind === "audio") {
          event.track.enabled = true;
          console.log("[WEBRTC] AUDIO RECEIVED:", peerId, event.track.id);

          const audio = createAudioElement(peerId, stream);

          event.track.onended = () => {
            console.log("[WEBRTC] remote audio ended:", peerId);
          };

          if (audio.paused) {
            audio.play().catch((error) => {
              console.warn("[AUDIO] play blocked:", peerId, error);
            });
          }
        }

        setRemoteStreams((previous) => ({ ...previous }));
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        console.log("[WEBRTC] ICE candidate ->", peerId);
        socket.emit("signal", {
          to: peerId,
          signal: {
            type: "ice-candidate",
            candidate: event.candidate,
          },
        });
      };

      pc.onconnectionstatechange = () => {
        console.log("[WEBRTC] connection:", peerId, pc.connectionState);
        if (pc.connectionState === "connected") {
          console.log("[WEBRTC] CONNECTED:", peerId);
        }
        if (pc.connectionState === "failed") {
          console.warn("[WEBRTC] connection failed:", peerId);
        }
        if (pc.connectionState === "closed") {
          closePeer(peerId);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log("[WEBRTC] ICE:", peerId, pc.iceConnectionState);
        if (pc.iceConnectionState === "failed") {
          console.warn("[WEBRTC] ICE failed:", peerId);
          try {
            if (typeof pc.restartIce === "function") {
              pc.restartIce();
            }
          } catch (error) {
            console.warn("[WEBRTC] restartIce error:", error);
          }
        }
      };

      pc.onnegotiationneeded = async () => {
        console.log("[WEBRTC] negotiationneeded:", peerId);
      };

      peersRef.current.set(peerId, {
        pc,
        username: peerUsername || "Пользователь",
        remoteStream,
      });

      const microphone = localAudioStreamRef.current;
      if (microphone) {
        const audioTrack = microphone.getAudioTracks()[0];
        if (audioTrack) {
          audioTrack.enabled = isMicOn;
          const sender = pc
            .getSenders()
            .find((item) => item.track?.kind === "audio");

          if (sender) {
            sender.replaceTrack(audioTrack).catch((error) => {
              console.warn("[AUDIO] initial replaceTrack error:", error);
            });
          } else {
            try {
              pc.addTrack(audioTrack, microphone);
            } catch (error) {
              console.warn("[AUDIO] initial addTrack error:", error);
            }
          }
        }
      }

      const screen = screenStreamRef.current;
      if (screen) {
        for (const track of screen.getTracks()) {
          const exists = pc
            .getSenders()
            .some((sender) => sender.track?.id === track.id);

          if (!exists) {
            try {
              pc.addTrack(track, screen);
            } catch (error) {
              console.warn("[SCREEN] initial addTrack error:", error);
            }
          }
        }
      }

      return pc;
    },
    [socket, isMicOn, closePeer, configureAudioCodec, createAudioElement],
  );

  const negotiatePeer = useCallback(
    async (peerId) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;

      const pc = peer.pc;
      if (pc.connectionState === "closed") return;
      if (makingOfferRef.current.get(peerId)) {
        console.log("[WEBRTC] negotiation already running:", peerId);
        return;
      }
      if (pc.signalingState !== "stable") {
        console.log("[WEBRTC] negotiation skipped:", peerId, pc.signalingState);
        return;
      }

      makingOfferRef.current.set(peerId, true);

      try {
        console.log("[WEBRTC] creating offer:", peerId);
        const offer = await pc.createOffer();

        if (pc.signalingState !== "stable") return;

        await pc.setLocalDescription(offer);
        socket.emit("signal", {
          to: peerId,
          signal: {
            type: "offer",
            sdp: pc.localDescription,
          },
        });

        console.log("[WEBRTC] offer sent:", peerId);
      } catch (error) {
        console.error("[WEBRTC] negotiation error:", peerId, error);
      } finally {
        makingOfferRef.current.delete(peerId);
      }
    },
    [socket],
  );

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    const startMicrophone = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error(
            "getUserMedia недоступен. Нужен HTTPS или localhost.",
          );
        }

        console.log("[MEDIA] requesting microphone...");
        const microphone = await navigator.mediaDevices.getUserMedia({
          audio: AUDIO_CONSTRAINTS,
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
          console.log(
            "[MEDIA] audio track:",
            audioTrack.id,
            audioTrack.readyState,
            audioTrack.getSettings ? audioTrack.getSettings() : null,
          );
        }

        for (const [peerId, peer] of peersRef.current) {
          try {
            await addMicrophoneToPeer(peerId, peer.pc);
            if (peer.pc.signalingState === "stable") {
              await negotiatePeer(peerId);
            }
          } catch (error) {
            console.error("[AUDIO] peer setup error:", peerId, error);
          }
        }

        try {
          const AudioContext = window.AudioContext || window.webkitAudioContext;

          if (AudioContext) {
            const audioContext = new AudioContext();
            const source = audioContext.createMediaStreamSource(microphone);
            const analyser = audioContext.createAnalyser();

            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.75;

            source.connect(analyser);
            analyserRef.current = analyser;
            audioContextRef.current = audioContext;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);

            const checkVolume = () => {
              if (!analyserRef.current || cancelled) return;

              analyserRef.current.getByteFrequencyData(dataArray);
              let sum = 0;

              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }

              const average = sum / dataArray.length;
              setIsSpeaking(average > 12 && isMicOn);
              animationRef.current = requestAnimationFrame(checkVolume);
            };

            checkVolume();
          }
        } catch (error) {
          console.warn("[MEDIA] analyser error:", error);
        }
      } catch (error) {
        console.error("[MEDIA] microphone error:", error);
        if (!cancelled) {
          setIsMicOn(false);
          alert(
            "Не удалось получить доступ к микрофону. Проверь разрешение браузера и HTTPS.",
          );
        }
      }
    };

    startMicrophone();

    return () => {
      cancelled = true;
    };
  }, [addMicrophoneToPeer, negotiatePeer]);

  useEffect(() => {
    const microphone = localAudioStreamRef.current;
    if (!microphone) return;

    microphone.getAudioTracks().forEach((track) => {
      track.enabled = isMicOn;
    });
  }, [isMicOn]);

  useEffect(() => {
    const handleExistingPeers = async (existingPeers) => {
      console.log("[WEBRTC] existing peers:", existingPeers);
      if (!Array.isArray(existingPeers)) return;

      for (const peer of existingPeers) {
        if (!peer?.id || peer.id === socket.id) continue;

        const pc = createPeerConnection(peer.id, peer.username);
        await addMicrophoneToPeer(peer.id, pc);
        await addScreenToPeer(peer.id, pc);
        await negotiatePeer(peer.id);
      }
    };

    socket.on("existing-peers", handleExistingPeers);

    return () => {
      socket.off("existing-peers", handleExistingPeers);
    };
  }, [
    socket,
    createPeerConnection,
    addMicrophoneToPeer,
    addScreenToPeer,
    negotiatePeer,
  ]);

  useEffect(() => {
    const handleNewPeer = ({ id, username }) => {
      if (!id || id === socket.id) return;
      console.log("[WEBRTC] new peer:", id, username);
      createPeerConnection(id, username);
    };

    socket.on("new-peer", handleNewPeer);

    return () => {
      socket.off("new-peer", handleNewPeer);
    };
  }, [socket, createPeerConnection]);

  useEffect(() => {
    const handleSignal = async ({ from, signal }) => {
      if (!from || !signal) return;
      console.log("[SIGNAL]", signal.type, "from:", from);

      let peer = peersRef.current.get(from);

      if (!peer) {
        const player = players.find((item) => item.id === from);
        createPeerConnection(from, player?.username || "Пользователь");
        peer = peersRef.current.get(from);
      }

      if (!peer) return;

      const pc = peer.pc;

      try {
        if (signal.type === "offer") {
          console.log("[WEBRTC] received offer:", from);

          if (pc.signalingState !== "stable") {
            console.log("[WEBRTC] rolling back before remote offer:", from);
            try {
              await pc.setLocalDescription({ type: "rollback" });
            } catch (rollbackError) {
              console.warn("[WEBRTC] rollback error:", rollbackError);
            }
          }

          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await flushPendingIce(from, pc);
          await addMicrophoneToPeer(from, pc);
          await addScreenToPeer(from, pc);

          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit("signal", {
            to: from,
            signal: {
              type: "answer",
              sdp: pc.localDescription,
            },
          });

          console.log("[WEBRTC] answer sent:", from);
          return;
        }

        if (signal.type === "answer") {
          console.log("[WEBRTC] received answer:", from);

          if (pc.signalingState !== "have-local-offer") {
            console.warn(
              "[WEBRTC] ignoring answer. State:",
              from,
              pc.signalingState,
            );
            return;
          }

          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await flushPendingIce(from, pc);
          console.log("[WEBRTC] answer applied:", from);
          return;
        }

        if (signal.type === "ice-candidate") {
          const candidate = new RTCIceCandidate(signal.candidate);

          if (pc.remoteDescription) {
            try {
              await pc.addIceCandidate(candidate);
              console.log("[WEBRTC] ICE added:", from);
            } catch (error) {
              console.warn("[WEBRTC] ICE add error:", from, error);
            }
          } else {
            const queue = pendingIceRef.current.get(from) || [];
            queue.push(candidate);
            pendingIceRef.current.set(from, queue);
            console.log("[WEBRTC] ICE queued:", from);
          }
        }
      } catch (error) {
        console.error("[WEBRTC] signal error:", from, signal.type, error);
      }
    };

    socket.on("signal", handleSignal);

    return () => {
      socket.off("signal", handleSignal);
    };
  }, [
    socket,
    players,
    createPeerConnection,
    addMicrophoneToPeer,
    addScreenToPeer,
    flushPendingIce,
  ]);

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

  useEffect(() => {
    const handlePlayersUpdate = (updatedPlayers) => {
      console.log("[ROOM] players:", updatedPlayers);
      setPlayers(Array.isArray(updatedPlayers) ? updatedPlayers : []);
    };

    socket.on("players-update", handlePlayersUpdate);

    return () => {
      socket.off("players-update", handlePlayersUpdate);
    };
  }, [socket]);

  const toggleMic = useCallback(() => {
    const newValue = !isMicOn;
    setIsMicOn(newValue);

    const microphone = localAudioStreamRef.current;
    if (microphone) {
      microphone.getAudioTracks().forEach((track) => {
        track.enabled = newValue;
      });
    }

    socket.emit("toggle-mic", !newValue);
  }, [isMicOn, socket]);

  const renegotiateAllPeers = useCallback(async () => {
    for (const [peerId, peer] of peersRef.current) {
      if (peer.pc.signalingState !== "stable") {
        console.log(
          "[WEBRTC] renegotiation skipped:",
          peerId,
          peer.pc.signalingState,
        );
        continue;
      }
      await negotiatePeer(peerId);
    }
  }, [negotiatePeer]);

  const stopScreenSharing = useCallback(async () => {
    const screen = screenStreamRef.current;
    if (!screen) {
      setIsScreenSharing(false);
      return;
    }

    console.log("[SCREEN] stopping...");

    for (const [peerId, peer] of peersRef.current) {
      const senders = peer.pc.getSenders();

      for (const sender of senders) {
        if (!sender.track) continue;

        const belongsToScreen = screen
          .getTracks()
          .some((track) => track.id === sender.track.id);

        if (belongsToScreen) {
          try {
            peer.pc.removeTrack(sender);
          } catch {}
        }
      }

      console.log("[SCREEN] removed from:", peerId);
    }

    screen.getTracks().forEach((track) => {
      track.onended = null;
      try {
        track.stop();
      } catch {}
    });

    screenStreamRef.current = null;
    setIsScreenSharing(false);
    await renegotiateAllPeers();
    console.log("[SCREEN] stopped");
  }, [renegotiateAllPeers]);

  const toggleScreen = useCallback(async () => {
    if (isScreenSharing) {
      await stopScreenSharing();
      return;
    }

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        alert(
          "Демонстрация экрана недоступна. Нужен HTTPS и поддерживаемый браузер.",
        );
        return;
      }

      console.log("[SCREEN] requesting screen...");
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      screenStreamRef.current = screen;
      setIsScreenSharing(true);

      for (const [peerId, peer] of peersRef.current) {
        await addScreenToPeer(peerId, peer.pc);
      }

      const videoTrack = screen.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = async () => {
          await stopScreenSharing();
        };
      }

      await renegotiateAllPeers();
      console.log("[SCREEN] sharing started");
    } catch (error) {
      console.error("[SCREEN] error:", error);
      if (error?.name !== "NotAllowedError") {
        alert("Не удалось получить доступ к демонстрации экрана.");
      }
    }
  }, [
    isScreenSharing,
    stopScreenSharing,
    addScreenToPeer,
    renegotiateAllPeers,
  ]);

  useEffect(() => {
    for (const [peerId, data] of Object.entries(remoteStreams)) {
      const audio = audioElementsRef.current.get(peerId);
      if (!audio) continue;

      if (audio.srcObject !== data.stream) {
        audio.srcObject = data.stream;
      }

      audio.muted = false;
      audio.volume = Math.max(0, Math.min(1, (volumes[peerId] ?? 100) / 100));

      if (audio.paused) {
        audio.play().catch((error) => {
          console.warn("[AUDIO] play blocked:", peerId, error);
        });
      }
    }
  }, [remoteStreams, volumes, audioUnlocked]);

  const handleVolumeChange = useCallback((playerId, value) => {
    const volume = Number(value);
    setVolumes((previous) => ({
      ...previous,
      [playerId]: volume,
    }));

    const audio = audioElementsRef.current.get(playerId);
    if (audio) {
      audio.volume = Math.max(0, Math.min(1, volume / 100));
    }
  }, []);

  const exitRoom = useCallback(() => {
    console.log("[ROOM] exiting...");

    try {
      socket.emit("leave-room");
    } catch {}

    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      screenStreamRef.current = null;
    }

    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      localAudioStreamRef.current = null;
    }

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    peersRef.current.forEach(({ pc }) => {
      try {
        pc.close();
      } catch {}
    });

    peersRef.current.clear();
    pendingIceRef.current.clear();
    makingOfferRef.current.clear();
    ignoreOfferRef.current.clear();
    remoteStreamsRef.current.clear();

    audioElementsRef.current.forEach((audio) => {
      try {
        audio.pause();
      } catch {}
      audio.srcObject = null;
      try {
        audio.remove();
      } catch {}
    });

    audioElementsRef.current.clear();
    onExit();
  }, [socket, onExit]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;

      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {}
        });
      }

      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {}
        });
      }

      peersRef.current.forEach(({ pc }) => {
        try {
          pc.close();
        } catch {}
      });

      peersRef.current.clear();
      pendingIceRef.current.clear();
      makingOfferRef.current.clear();
      ignoreOfferRef.current.clear();
      remoteStreamsRef.current.clear();

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }

      audioElementsRef.current.forEach((audio) => {
        try {
          audio.pause();
        } catch {}
        audio.srcObject = null;
        try {
          audio.remove();
        } catch {}
      });

      audioElementsRef.current.clear();
    };
  }, []);

  const remoteScreen = Object.entries(remoteStreams).find(
    ([, data]) => data.stream.getVideoTracks().length > 0,
  );

  if (!userData) return null;

  return (
    <div className="fixed inset-0 bg-[#F5EFD7] font-['Alumni'] w-full h-full overflow-hidden">
      {!audioUnlocked && (
        <button
          type="button"
          onClick={unlockAudio}
          className="fixed inset-0 z-[999] bg-[#F5EFD7] text-[#5E454B] text-[clamp(20px,5vw,30px)] font-['Alumni'] flex items-center justify-center cursor-pointer text-center px-5"
        >
          НАЖМИТЕ, ЧТОБЫ ВКЛЮЧИТЬ ЗВУК
        </button>
      )}

      <div className="w-full h-full flex flex-col">
        <header className="h-[62px] flex items-center border-b-3 border-[#5E454B] px-[clamp(12px,3vw,27px)] flex-wrap gap-2">
          <div className="flex gap-[7px] text-[clamp(18px,2.5vw,27px)] text-[#5E454B] whitespace-nowrap">
            <span>КОМНАТА:</span>
            <span>{userData.room}</span>
          </div>

          <div className="hidden sm:block w-[4px] h-[46px] bg-[#5E454B] mx-[clamp(15px,3vw,35px)]" />

          <div className="text-[clamp(18px,2.5vw,27px)] text-[#5E454B] whitespace-nowrap">
            УЧАСТНИКОВ: <span>{players.length}</span>
          </div>

          <div className="ml-auto flex items-center gap-[clamp(15px,3vw,30px)] text-[clamp(18px,2.5vw,27px)] text-[#5E454B]">
            <span className="truncate max-w-[120px] sm:max-w-none">
              {userData.username}
            </span>
          </div>
        </header>

        <div className="flex-1 flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_360px] gap-[clamp(15px,3vw,45px)] p-[clamp(8px,1.5vw,14px)_clamp(12px,2vw,27px)_clamp(12px,2vw,20px)_clamp(12px,4vw,90px)] min-h-0">
          <div className="flex flex-col min-h-0">
            <div className="w-full aspect-video border-3 border-[#5E454B] flex items-center justify-center bg-[#F5EFD7] relative overflow-hidden">
              {isScreenSharing ? (
                <video
                  ref={(element) => {
                    if (!element) return;
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
                    if (!element) return;
                    element.srcObject = remoteScreen[1].stream;
                    element.play().catch(() => {});
                  }}
                  autoPlay
                  playsInline
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-[clamp(20px,3vw,30px)] flex items-center gap-[10px] text-[#5E454B]">
                  <span>NO SIGNAL</span>
                  <span className="text-[clamp(25px,3.5vw,35px)] leading-none">
                    •
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-[clamp(12px,2vw,45px)] py-[clamp(12px,2vw,20px)] min-h-[92px]">
              <button
                type="button"
                onClick={toggleMic}
                className="flex items-center gap-[clamp(8px,1.5vw,14px)] text-[clamp(16px,2vw,24px)] text-[#5E454B] cursor-pointer hover:opacity-70 transition-opacity"
              >
                <span
                  className={`w-[clamp(44px,6vw,66px)] h-[clamp(44px,6vw,66px)] border-3 flex items-center justify-center ${
                    !isMicOn ? "border-red-500" : "border-[#5E454B]"
                  }`}
                >
                  <img
                    src={svg3}
                    alt="mic"
                    className={`w-[clamp(20px,3vw,32px)] h-[clamp(20px,3vw,32px)] ${!isMicOn ? "opacity-50" : ""}`}
                  />
                </span>
                <span className="hidden xs:inline">
                  {isMicOn ? "МИКРОФОН" : "ВЫКЛ"}
                </span>
              </button>

              <button
                type="button"
                onClick={toggleScreen}
                className="flex items-center gap-[clamp(8px,1.5vw,14px)] text-[clamp(16px,2vw,24px)] text-[#5E454B] cursor-pointer hover:opacity-70 transition-opacity"
              >
                <span
                  className={`w-[clamp(44px,6vw,66px)] h-[clamp(44px,6vw,66px)] border-3 flex items-center justify-center ${
                    isScreenSharing ? "bg-[#5E454B]" : "border-[#5E454B]"
                  }`}
                >
                  <img
                    src={svg1}
                    alt="screen"
                    className={`w-[clamp(20px,3vw,32px)] h-[clamp(20px,3vw,32px)] ${isScreenSharing ? "invert" : ""}`}
                  />
                </span>
                <span className="hidden xs:inline">
                  {isScreenSharing ? "ОСТАНОВИТЬ" : "ДЕМОНСТРАЦИЯ"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setIsSettingsOpen((value) => !value)}
                className="flex items-center gap-[clamp(8px,1.5vw,14px)] text-[clamp(16px,2vw,24px)] text-[#5E454B] cursor-pointer hover:opacity-70 transition-opacity"
              >
                <span className="w-[clamp(44px,6vw,66px)] h-[clamp(44px,6vw,66px)] border-3 border-[#5E454B] flex items-center justify-center">
                  <img
                    src={svg2}
                    alt="settings"
                    className="w-[clamp(20px,3vw,32px)] h-[clamp(20px,3vw,32px)]"
                  />
                </span>
              </button>

              <div className="flex-1 hidden md:block" />

              <button
                type="button"
                onClick={exitRoom}
                className="h-[clamp(44px,6vw,66px)] border-3 border-[#5E454B] px-[clamp(20px,3vw,45px)] text-[clamp(16px,2vw,23px)] text-[#5E454B] cursor-pointer hover:bg-[#5E454B] hover:text-[#F5EFD7] transition-colors whitespace-nowrap ml-auto"
              >
                ПОКИНУТЬ КОМНАТУ
              </button>
            </div>
          </div>

          <div className="border-3 border-[#5E454B] p-[clamp(16px,3vw,32px)_clamp(20px,4vw,42px)] overflow-y-auto flex-shrink-0 lg:flex-shrink">
            <h2 className="text-[clamp(22px,2.8vw,29px)] font-normal text-[#5E454B]">
              УЧАСТНИКИ
            </h2>

            <div className="w-[41px] h-[3px] bg-[#5E454B] mt-[17px] mb-[clamp(20px,3vw,35px)]" />

            {players.map((player) => {
              const isCurrentUser = player.id === currentSocketId;
              const muted = isCurrentUser ? !isMicOn : player.isMuted;
              const speaking = isCurrentUser && isSpeaking;

              return (
                <div
                  key={player.id}
                  className="grid grid-cols-[clamp(30px,4vw,47px)_1fr_clamp(20px,2.5vw,30px)] items-center gap-[clamp(8px,1.5vw,15px)] mb-[clamp(12px,2vw,20px)]"
                >
                  <div
                    className={`w-[clamp(30px,4vw,47px)] h-[clamp(30px,4vw,47px)] transition-all duration-100 ${
                      muted
                        ? "bg-red-500"
                        : speaking
                          ? "bg-[#5E454B] opacity-100"
                          : "bg-[#5E454B] opacity-70"
                    }`}
                  />

                  <span className="text-[clamp(16px,1.8vw,20px)] text-[#5E454B] truncate">
                    {player.username}
                    {isCurrentUser && " (Вы)"}
                  </span>

                  <span className="text-[clamp(14px,1.5vw,16px)] text-[#5E454B]">
                    <span className={muted ? "text-red-500" : "text-green-500"}>
                      ●
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {isSettingsOpen && (
          <div className="fixed right-[clamp(12px,3vw,30px)] bottom-[clamp(80px,10vh,100px)] w-[min(460px,92vw)] max-h-[70vh] overflow-y-auto bg-[#F5EFD7] border-3 border-[#5E454B] p-[clamp(16px,3vw,25px)] z-50">
            <div className="flex items-center justify-between border-b-3 border-[#5E454B] pb-[15px] mb-[20px]">
              <h2 className="text-[clamp(22px,2.8vw,29px)] font-normal text-[#5E454B]">
                ГРОМКОСТЬ
              </h2>

              <button
                type="button"
                onClick={() => setIsSettingsOpen(false)}
                className="text-[clamp(28px,3.5vw,35px)] text-[#5E454B] cursor-pointer"
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
                  className="grid grid-cols-[clamp(30px,4vw,47px)_minmax(60px,100px)_1fr] items-center gap-[clamp(8px,1.5vw,15px)] mb-[clamp(16px,2.5vw,25px)]"
                >
                  <div
                    className={`w-[clamp(30px,4vw,47px)] h-[clamp(30px,4vw,47px)] ${
                      isCurrentUser && !isMicOn ? "bg-red-500" : "bg-[#5E454B]"
                    }`}
                  />

                  <span className="text-[clamp(16px,1.8vw,19px)] text-[#5E454B] truncate">
                    {player.username}
                    {isCurrentUser && " (Вы)"}
                  </span>

                  <div className="flex flex-col gap-[3px]">
                    <div className="text-[clamp(14px,1.5vw,17px)] text-center text-[#5E454B]">
                      {volume}%
                    </div>

                    <div className="relative w-full h-[6px] bg-[#F5EFD7] border-2 border-[#5E454B] flex items-center">
                      <div
                        className="absolute h-full bg-[#5E454B]"
                        style={{ width: `${Math.min(100, volume / 2)}%` }}
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
