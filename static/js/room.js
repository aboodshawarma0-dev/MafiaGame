"use strict";

const TOKEN = window.ROOM_TOKEN || "";
const ROOM_NAME = window.ROOM_NAME || "";
const USERNAME = localStorage.getItem("omerta_user") || "ضيف";
const AVATAR_KEY = localStorage.getItem("omerta_char") || "unknown";
const CUSTOM_IMG = localStorage.getItem("omerta_custom") || "";
const AVATAR_TYPE = localStorage.getItem("omerta_avatarType") || (CUSTOM_IMG ? "custom" : "builtin");

const AVATARS = {
  unknown: "/static/svg/avatar-unknown.svg",
  raven: "/static/svg/avatar-raven.svg",
  medic: "/static/svg/avatar-medic.svg",
  warden: "/static/svg/avatar-warden.svg",
  oracle: "/static/svg/avatar-oracle.svg",
  smith: "/static/svg/avatar-smith.svg",
  velvet: "/static/svg/avatar-velvet.svg"
};

const ROLE_INFO = {
  mafia: { label: "المافيا", color: "#ff6b6b", desc: "اختاروا الضحية سراً قبل الصباح.", icon: "/static/svg/role-mafia.svg" },
  citizen: { label: "المواطن", color: "#53e1c0", desc: "حلّل وتناقش وصوّت بذكاء.", icon: "/static/svg/role-citizen.svg" },
  doctor: { label: "الطبيب", color: "#6fc8ff", desc: "احمِ لاعباً واحداً في هذه الجولة.", icon: "/static/svg/role-doctor.svg" },
  detective: { label: "الكاشف", color: "#f3d37c", desc: "اكشف حقيقة لاعب واحد دون أن يراك أحد.", icon: "/static/svg/role-detective.svg" }
};

const PHASE_COPY = {
  waiting: { title: "اللوبي", subtitle: "الجميع يستطيع الكلام قبل بداية اللعبة.", icon: "/static/svg/room.svg" },
  role_reveal: { title: "توزيع الأدوار", subtitle: "تم كتم الجميع مؤقتاً حتى يرى كل لاعب كرت دوره.", icon: "/static/svg/cards.svg" },
  mafia: { title: "دور المافيا", subtitle: "المافيا فقط تتواصل الآن وتحدد الهدف.", icon: "/static/svg/role-mafia.svg" },
  doctor: { title: "دور الطبيب", subtitle: "الطبيب يختار من يحميه الآن.", icon: "/static/svg/role-doctor.svg" },
  detective: { title: "دور الكاشف", subtitle: "الكاشف يختار اللاعب الذي يريد كشفه.", icon: "/static/svg/role-detective.svg" },
  day: { title: "النهار", subtitle: "قناة عامة للأحياء من أجل النقاش.", icon: "/static/svg/chat.svg" },
  voting: { title: "التصويت", subtitle: "اختر اللاعب الذي تشك به.", icon: "/static/svg/players.svg" },
  results: { title: "النتائج", subtitle: "تم كشف الشخصيات وإعلان الفائز.", icon: "/static/svg/cards.svg" }
};

const socket = io({ transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: Infinity, timeout: 20000 });
const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] };
const $ = id => document.getElementById(id);

const state = {
  mySid: null,
  isHost: false,
  myRole: null,
  roleMeta: null,
  players: [],
  phase: "waiting",
  round: 0,
  deadline: null,
  selectedTarget: null,
  selectedVote: null,
  privatePrompt: null,
  voteCounts: {},
  maxPlayers: 12,
  mayTalk: true,
  allowedListen: [],
  micOn: false,
  sidebarOpen: false,
  chatOpen: window.innerWidth > 1080,
  stream: null,
  audioCtx: null,
  analyser: null
};

const peers = {};
const remoteAudios = {};
let countdownTimer = null;
let speakingLoop = null;

function esc(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function avatarSrc(avatar, customImg) {
  if (customImg && customImg.startsWith("data:")) return customImg;
  return AVATARS[avatar] || AVATARS.unknown;
}

function avatarHtml(avatar, customImg, alt = "avatar") {
  return `<img src="${avatarSrc(avatar, customImg)}" alt="${alt}" />`;
}

function roleData(role) {
  return ROLE_INFO[role] || ROLE_INFO.citizen;
}

function seatLabel(index) {
  return String(index + 1).padStart(2, "0");
}

function getPlayerBySid(sid) {
  return state.players.find(player => player.sid === sid) || null;
}

function showToast(message, timeout = 2600) {
  const wrap = $("toastContainer");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  wrap.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-4px)";
    setTimeout(() => toast.remove(), 200);
  }, timeout);
}

function syncDrawerBackdrop() {
  const shouldOpen = state.sidebarOpen || state.chatOpen;
  $("drawerBackdrop").classList.toggle("hidden", !shouldOpen || window.innerWidth > 1280 && !state.chatOpen);
}

function openSidebar() {
  state.sidebarOpen = true;
  $("sidebar").classList.add("open");
  syncDrawerBackdrop();
}

function closeSidebar() {
  state.sidebarOpen = false;
  $("sidebar").classList.remove("open");
  syncDrawerBackdrop();
}

function openChat() {
  state.chatOpen = true;
  $("chatPanel").classList.add("open");
  syncDrawerBackdrop();
}

function closeChat() {
  state.chatOpen = false;
  $("chatPanel").classList.remove("open");
  syncDrawerBackdrop();
}

function toggleSidebar() {
  state.sidebarOpen ? closeSidebar() : openSidebar();
}

function toggleChat() {
  state.chatOpen ? closeChat() : openChat();
}

function renderSelfCard() {
  $("upAvatar").innerHTML = avatarHtml(AVATAR_KEY, CUSTOM_IMG, USERNAME);
  $("upName").textContent = USERNAME;
}

function createBoardSeats() {
  const board = $("seatBoard");
  board.innerHTML = "";
  for (let index = 0; index < 12; index += 1) {
    const seat = document.createElement("div");
    seat.className = `seat empty pos-${index}`;
    seat.dataset.seat = String(index);
    seat.dataset.label = seatLabel(index);
    board.appendChild(seat);
  }
}

function renderBoard() {
  document.querySelectorAll(".seat").forEach(seat => {
    seat.classList.add("empty");
    seat.innerHTML = "";
  });

  state.players.forEach(player => {
    const seat = document.querySelector(`.seat[data-seat="${player.seat}"]`);
    if (!seat) return;
    seat.classList.remove("empty");
    const mutedBadge = player.mic ? "" : `<span class="badge muted">صامت</span>`;
    const hostBadge = player.is_host ? `<span class="badge host">هوست</span>` : "";
    seat.innerHTML = `
      <div class="player-tile ${player.speaking ? "speaking" : ""} ${!player.alive ? "dead" : ""}">
        <div class="player-avatar">${avatarHtml(player.avatar, player.customImg, player.username)}</div>
        <div class="player-name">${esc(player.username)}</div>
        <div class="player-state">${player.alive ? (player.speaking ? "يتكلم الآن" : "جاهز") : "خارج الجولة"}</div>
        <div class="player-badges">${hostBadge}${mutedBadge}</div>
      </div>`;
  });

  $("userCount").textContent = String(state.players.length);
  $("sidebarCount").textContent = String(state.players.length);
}

function renderSidebarPlayers() {
  const wrap = $("sidebarPlayers");
  wrap.innerHTML = "";
  state.players.forEach(player => {
    const micIcon = player.mic ? "/static/svg/mic-on.svg" : "/static/svg/mic-off.svg";
    const crown = player.is_host ? `<img src="/static/svg/crown.svg" alt="host" class="badge-icon" />` : "";
    const item = document.createElement("div");
    item.className = `side-player ${!player.alive ? "dead" : ""}`;
    item.innerHTML = `
      <div class="side-player-avatar">${avatarHtml(player.avatar, player.customImg, player.username)}</div>
      <div class="side-player-name">${esc(player.username)}</div>
      <div class="side-player-meta">${crown}<img src="${micIcon}" alt="mic" /></div>`;
    wrap.appendChild(item);
  });
}

function updateHostButtons() {
  const shouldShow = state.isHost && state.phase === "waiting";
  const tooFew = state.players.length < 4;
  [$("tbStartBtn"), $("startGameBtn")].forEach(button => {
    button.classList.toggle("hidden", !shouldShow);
    button.disabled = tooFew;
  });
  $("resetGameBtn").style.display = state.isHost ? "inline-flex" : "none";
}

function updateMicUI() {
  const icon = state.micOn ? "/static/svg/mic-on.svg" : "/static/svg/mic-off.svg";
  $("micStateIcon").src = icon;
  $("sideMicIcon").src = icon;
}

function policyCopy() {
  if (state.phase === "waiting") return "قناة عامة مفتوحة للجميع";
  if (state.phase === "role_reveal") return "تم كتم الجميع حتى تظهر الأدوار";
  if (state.phase === "mafia") return state.myRole === "mafia" ? "أنت داخل قناة المافيا فقط" : "القناة مغلقة عليك الآن";
  if (state.phase === "doctor") return state.myRole === "doctor" ? "وقت الطبيب فقط" : "القناة مغلقة عليك الآن";
  if (state.phase === "detective") return state.myRole === "detective" ? "وقت الكاشف فقط" : "القناة مغلقة عليك الآن";
  if (state.phase === "day") return "قناة عامة للأحياء";
  if (state.phase === "voting") return "مرحلة التصويت العامة";
  return "انتهت الجولة";
}

function updatePhaseUI(copyText = "") {
  const phaseMeta = PHASE_COPY[state.phase] || PHASE_COPY.waiting;
  $("sidebarPhaseVal").textContent = phaseMeta.title;
  $("topBarPhase").textContent = `${phaseMeta.title} — ${phaseMeta.subtitle}`;
  $("policyCard").textContent = policyCopy();
  $("upStatus").textContent = state.mayTalk ? "يمكنك الكلام" : "صامت حسب المرحلة";
  $("centerRound").textContent = state.phase === "waiting" ? "بانتظار بدء اللعبة" : `الجولة ${state.round || 1}`;
  $("centerAnnouncement").textContent = copyText || phaseMeta.subtitle;
}

function startCountdown(deadline) {
  clearInterval(countdownTimer);
  if (!deadline) {
    $("phaseTimer").textContent = "--:--";
    return;
  }
  const tick = () => {
    const ms = Math.max(0, Math.floor(deadline * 1000 - Date.now()));
    const total = Math.ceil(ms / 1000);
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const seconds = String(total % 60).padStart(2, "0");
    $("phaseTimer").textContent = `${minutes}:${seconds}`;
    if (total <= 0) clearInterval(countdownTimer);
  };
  tick();
  countdownTimer = setInterval(tick, 400);
}

function renderSelection(list, mode) {
  const wrapId = mode === "vote" ? "voteList" : "actionList";
  const wrap = $(wrapId);
  wrap.innerHTML = "";
  list.forEach(item => {
    const player = getPlayerBySid(item.sid);
    const card = document.createElement("button");
    card.type = "button";
    const active = mode === "vote" ? state.selectedVote === item.sid : state.selectedTarget === item.sid;
    card.className = `selection-card${active ? " active" : ""}`;
    card.innerHTML = `
      <div class="selection-avatar">${avatarHtml(player?.avatar, player?.customImg, item.username)}</div>
      <div>
        <div class="selection-name">${esc(item.username)}</div>
        <div class="selection-meta">${mode === "vote" ? "تصويت علني" : "اختيار خاص"}</div>
      </div>
      <div class="selection-meta">${mode === "vote" ? (state.voteCounts[item.sid] || 0) : "اختيار"}</div>`;
    card.addEventListener("click", () => {
      if (mode === "vote") {
        if (state.selectedVote) return;
        state.selectedVote = item.sid;
        socket.emit("cast_vote", { room: TOKEN, target_sid: item.sid });
      } else {
        state.selectedTarget = item.sid;
        renderOverlay();
      }
    });
    wrap.appendChild(card);
  });
}

function renderOverlay() {
  const overlay = $("phaseOverlay");
  const phaseMeta = PHASE_COPY[state.phase] || PHASE_COPY.waiting;
  $("overlayIcon").src = phaseMeta.icon;
  $("overlayBadge").textContent = phaseMeta.title;
  $("overlayTitle").textContent = phaseMeta.title;
  $("overlaySubtitle").textContent = phaseMeta.subtitle;
  $("roleRevealCard").classList.add("hidden");
  $("selectionWrap").classList.add("hidden");
  $("votePanel").classList.add("hidden");
  $("actionSubmitBtn").classList.add("hidden");

  if (state.phase === "role_reveal") {
    overlay.classList.remove("hidden");
    if (state.myRole) {
      const role = roleData(state.myRole);
      $("roleRevealCard").classList.remove("hidden");
      $("roleCardIcon").src = role.icon;
      $("roleCardName").textContent = role.label;
      $("roleCardName").style.color = role.color;
      $("roleCardDesc").textContent = role.desc;
    }
    return;
  }

  if (["mafia", "doctor", "detective"].includes(state.phase)) {
    overlay.classList.remove("hidden");
    if (state.privatePrompt) {
      $("overlayTitle").textContent = state.privatePrompt.title || phaseMeta.title;
      $("overlaySubtitle").textContent = state.privatePrompt.subtitle || phaseMeta.subtitle;
      if ((state.privatePrompt.targets || []).length) {
        $("selectionWrap").classList.remove("hidden");
        $("actionSubmitBtn").classList.remove("hidden");
        $("actionSubmitBtn").disabled = !state.selectedTarget;
        renderSelection(state.privatePrompt.targets || [], "action");
      }
    }
    return;
  }

  if (state.phase === "voting") {
    overlay.classList.remove("hidden");
    $("votePanel").classList.remove("hidden");
    renderSelection((state.players || []).filter(p => p.alive).map(p => ({ sid: p.sid, username: p.username })), "vote");
    return;
  }

  overlay.classList.add("hidden");
}

function renderResults(data) {
  $("resultsWinner").textContent = data.winner === "mafia" ? "فاز فريق المافيا" : "فاز فريق المواطنين";
  $("resultsLabel").textContent = data.label || "انتهت الجولة";
  const grid = $("resultsGrid");
  grid.innerHTML = "";
  (data.players || []).forEach(player => {
    const role = roleData(player.role);
    const item = document.createElement("article");
    item.className = `result-card ${!player.alive ? "dead" : ""}`;
    item.innerHTML = `
      <img class="avatar" src="${avatarSrc(player.avatar, player.customImg)}" alt="${esc(player.username)}" />
      <img class="role" src="${role.icon}" alt="${role.label}" />
      <div class="name">${esc(player.username)}</div>
      <div class="role-name">${role.label}</div>`;
    grid.appendChild(item);
  });
  $("resultDrawer").classList.remove("hidden");
}

function appendMessage(data) {
  const wrap = $("chatMessages");
  const item = document.createElement("div");
  if (data.type === "system") {
    item.className = "sys-msg";
    item.textContent = data.msg;
  } else {
    item.className = "msg";
    item.innerHTML = `
      <div class="msg-head">
        <div class="msg-avatar">${avatarHtml(data.avatar, data.customImg, data.user)}</div>
        <div class="msg-name">${esc(data.user)}</div>
      </div>
      <div class="msg-text">${esc(data.msg)}</div>`;
  }
  wrap.appendChild(item);
  wrap.scrollTop = wrap.scrollHeight;
}

async function ensureMic() {
  if (state.stream) {
    state.stream.getTracks().forEach(track => { track.enabled = true; });
    return true;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const AudioContextRef = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContextRef();
    const source = state.audioCtx.createMediaStreamSource(state.stream);
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 256;
    source.connect(state.analyser);
    startSpeakingLoop();
    state.players.forEach(player => {
      if (player.sid !== state.mySid) createOffer(player.sid);
    });
    return true;
  } catch (error) {
    showToast("تعذر الوصول إلى الميكروفون");
    return false;
  }
}

function startSpeakingLoop() {
  cancelAnimationFrame(speakingLoop);
  if (!state.analyser) return;
  const buffer = new Uint8Array(state.analyser.frequencyBinCount);
  let lastState = false;
  const loop = () => {
    if (!state.analyser) return;
    state.analyser.getByteFrequencyData(buffer);
    const average = buffer.reduce((sum, value) => sum + value, 0) / buffer.length;
    const active = average > 18 && state.micOn && state.mayTalk;
    if (active !== lastState) {
      lastState = active;
      socket.emit("speaking", { room: TOKEN, active });
    }
    speakingLoop = requestAnimationFrame(loop);
  };
  loop();
}

function closePeer(sid) {
  if (peers[sid]) {
    try { peers[sid].close(); } catch (_) {}
    delete peers[sid];
  }
  if (remoteAudios[sid]) {
    remoteAudios[sid].remove();
    delete remoteAudios[sid];
  }
}

function attachLocalTracks(pc) {
  if (!state.stream) return;
  const senders = pc.getSenders();
  state.stream.getTracks().forEach(track => {
    const exists = senders.some(sender => sender.track && sender.track.id === track.id);
    if (!exists) pc.addTrack(track, state.stream);
  });
}

function getOrCreatePeer(sid) {
  if (peers[sid]) {
    attachLocalTracks(peers[sid]);
    return peers[sid];
  }
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers[sid] = pc;
  attachLocalTracks(pc);
  pc.onicecandidate = event => {
    if (event.candidate) socket.emit("webrtc_ice", { room: TOKEN, target: sid, candidate: event.candidate });
  };
  pc.ontrack = event => {
    let audio = remoteAudios[sid];
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      remoteAudios[sid] = audio;
      document.body.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
    applyAudioPolicy();
  };
  pc.onconnectionstatechange = () => {
    if (["failed", "closed", "disconnected"].includes(pc.connectionState)) closePeer(sid);
  };
  return pc;
}

async function createOffer(sid) {
  if (!state.stream || sid === state.mySid) return;
  const pc = getOrCreatePeer(sid);
  if (pc.signalingState !== "stable") return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc_offer", { room: TOKEN, target: sid, sdp: pc.localDescription });
  } catch (_) {}
}

function applyAudioPolicy() {
  if (state.stream) {
    state.stream.getAudioTracks().forEach(track => {
      track.enabled = state.micOn && state.mayTalk;
    });
  }
  Object.entries(remoteAudios).forEach(([sid, audio]) => {
    audio.muted = !state.allowedListen.includes(sid);
    if (!audio.muted) audio.play().catch(() => {});
  });
  updateMicUI();
  updatePhaseUI($("centerAnnouncement").textContent);
}

async function toggleMic() {
  if (!state.micOn) {
    const ok = await ensureMic();
    if (!ok) return;
    state.micOn = true;
  } else {
    state.micOn = false;
    if (state.stream) state.stream.getTracks().forEach(track => { track.enabled = false; });
    socket.emit("speaking", { room: TOKEN, active: false });
  }
  applyAudioPolicy();
  socket.emit("toggle_mic", { room: TOKEN, state: state.micOn });
}

function sendMsg() {
  const input = $("chatInput");
  const message = (input.value || "").trim();
  if (!message) return;
  socket.emit("chat_msg", { room: TOKEN, msg: message });
  input.value = "";
}

function copyCode() {
  navigator.clipboard.writeText(TOKEN).then(() => showToast(`تم نسخ الكود ${TOKEN}`)).catch(() => showToast(TOKEN));
}

function startGame() {
  if (state.players.length < 4) {
    $("minPlayersModal").classList.remove("hidden");
    return;
  }
  socket.emit("start_game", { room: TOKEN });
}

function sendNightAction() {
  if (!state.selectedTarget) {
    showToast("اختر لاعباً أولاً");
    return;
  }
  socket.emit("night_action", { room: TOKEN, target_sid: state.selectedTarget });
  $("actionSubmitBtn").disabled = true;
}

function resetGame() {
  socket.emit("reset_game", { room: TOKEN });
}

function confirmLeave() {
  if (window.confirm("هل تريد مغادرة الغرفة؟")) window.location.href = "/";
}

socket.on("connect", () => {
  socket.emit("join", { room: TOKEN, username: USERNAME, avatar: AVATAR_KEY, avatarType: AVATAR_TYPE, customImg: CUSTOM_IMG });
});

socket.on("joined_ok", data => {
  state.mySid = data.my_sid;
  state.isHost = data.is_host;
  state.maxPlayers = data.max_players || 12;
  $("sidebarRoomName").textContent = data.room_name || ROOM_NAME;
  $("sidebarRoomCode").textContent = TOKEN;
  $("topBarRoomName").textContent = data.room_name || ROOM_NAME;
  renderSelfCard();
  updateHostButtons();
});

socket.on("phase_change", data => {
  state.phase = data.phase || "waiting";
  state.round = data.round || state.round || 0;
  state.deadline = data.deadline || null;
  state.selectedTarget = null;
  state.selectedVote = null;
  state.voteCounts = {};
  if (!state.privatePrompt || state.privatePrompt.phase !== state.phase) state.privatePrompt = null;
  updatePhaseUI(data.announcement || "");
  startCountdown(state.deadline);
  renderOverlay();
});

socket.on("your_role", data => {
  state.myRole = data.role;
  state.roleMeta = data;
  renderOverlay();
});

socket.on("private_prompt", data => {
  state.privatePrompt = data;
  if (state.phase === data.phase) renderOverlay();
});

socket.on("update_players", data => {
  state.players = data.players || [];
  state.maxPlayers = data.max_players || 12;
  state.isHost = !!(state.players.find(p => p.sid === state.mySid)?.is_host);
  renderBoard();
  renderSidebarPlayers();
  updateHostButtons();
  if (state.stream) {
    state.players.forEach(player => {
      if (player.sid !== state.mySid && !peers[player.sid] && String(state.mySid) < String(player.sid)) createOffer(player.sid);
    });
  }
  Object.keys(peers).forEach(sid => {
    if (!state.players.find(player => player.sid === sid)) closePeer(sid);
  });
});

socket.on("audio_policy", data => {
  state.allowedListen = data.allowed_listen || [];
  state.mayTalk = !!data.may_talk;
  applyAudioPolicy();
});

socket.on("new_message", appendMessage);
socket.on("name_taken", data => showToast(`الاسم مستخدم. جرّب ${data.suggested}`));
socket.on("error", data => showToast(data?.msg || "حدث خطأ"));
socket.on("action_received", data => showToast(data?.msg || "تم تسجيل الاختيار"));
socket.on("vote_ack", data => showToast(data?.msg || "تم تسجيل التصويت"));

socket.on("vote_update", data => {
  state.voteCounts = data.counts || {};
  if (state.phase === "voting") renderOverlay();
});

socket.on("detective_result", data => {
  const text = data.is_mafia ? `${data.username} من المافيا` : `${data.username} ليس من المافيا`;
  $("overlaySubtitle").textContent = text;
  showToast(text, 3600);
});

socket.on("game_started", data => {
  state.round = data.round || 1;
  $("resultDrawer").classList.add("hidden");
  updatePhaseUI("بدأت اللعبة الآن");
  showToast("بدأت اللعبة");
});

socket.on("game_over", data => {
  state.phase = "results";
  updatePhaseUI(data.label || "انتهت الجولة");
  $("phaseOverlay").classList.add("hidden");
  clearInterval(countdownTimer);
  renderResults(data);
});

socket.on("game_reset", () => {
  state.phase = "waiting";
  state.round = 0;
  state.myRole = null;
  state.roleMeta = null;
  state.privatePrompt = null;
  state.voteCounts = {};
  state.selectedVote = null;
  state.selectedTarget = null;
  $("resultDrawer").classList.add("hidden");
  $("phaseOverlay").classList.add("hidden");
  updatePhaseUI("اجمع 4 لاعبين على الأقل ثم ابدأ الجولة الأولى.");
  showToast("تمت إعادة ضبط اللعبة");
});

socket.on("disconnect", () => showToast("انقطع الاتصال مؤقتاً"));
socket.on("reconnect", () => {
  showToast("تمت إعادة الاتصال");
  socket.emit("join", { room: TOKEN, username: USERNAME, avatar: AVATAR_KEY, avatarType: AVATAR_TYPE, customImg: CUSTOM_IMG });
});

socket.on("webrtc_offer", async data => {
  const pc = getOrCreatePeer(data.from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("webrtc_answer", { room: TOKEN, target: data.from, sdp: pc.localDescription });
  } catch (_) {}
});

socket.on("webrtc_answer", async data => {
  const pc = peers[data.from];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  } catch (_) {}
});

socket.on("webrtc_ice", async data => {
  const pc = peers[data.from];
  if (!pc || !data.candidate) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (_) {}
});

document.addEventListener("DOMContentLoaded", () => {
  createBoardSeats();
  renderSelfCard();
  updateMicUI();
  updatePhaseUI("اجمع 4 لاعبين على الأقل ثم ابدأ الجولة الأولى.");
  $("chatPanel").classList.toggle("open", state.chatOpen);

  $("openSidebarBtn").addEventListener("click", openSidebar);
  $("closeSidebarBtn").addEventListener("click", closeSidebar);
  $("openChatBtn").addEventListener("click", openChat);
  $("closeChatBtn").addEventListener("click", closeChat);
  $("btnChat").addEventListener("click", toggleChat);
  $("drawerBackdrop").addEventListener("click", () => { closeSidebar(); closeChat(); });

  $("btnMic").addEventListener("click", toggleMic);
  $("btnMicSide").addEventListener("click", toggleMic);
  $("copyCodeBtn").addEventListener("click", copyCode);
  $("copyCodeBtnWide").addEventListener("click", copyCode);
  $("tbStartBtn").addEventListener("click", startGame);
  $("startGameBtn").addEventListener("click", startGame);
  $("sendMsgBtn").addEventListener("click", sendMsg);
  $("leaveBtn").addEventListener("click", confirmLeave);
  $("actionSubmitBtn").addEventListener("click", sendNightAction);
  $("resetGameBtn").addEventListener("click", resetGame);
  $("closeResultsBtn").addEventListener("click", () => $("resultDrawer").classList.add("hidden"));
  $("closeMinPlayersBtn").addEventListener("click", () => $("minPlayersModal").classList.add("hidden"));

  $("chatInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMsg();
    }
  });

  const resumeAudio = async () => {
    if (state.audioCtx && state.audioCtx.state === "suspended") {
      try { await state.audioCtx.resume(); } catch (_) {}
    }
    Object.values(remoteAudios).forEach(audio => audio.play().catch(() => {}));
  };
  document.addEventListener("click", resumeAudio);
  document.addEventListener("touchstart", resumeAudio, { passive: true });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 1280) closeSidebar();
    if (window.innerWidth > 1080) openChat();
    syncDrawerBackdrop();
  });
});
