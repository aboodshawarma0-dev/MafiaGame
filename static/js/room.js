"use strict";

const TOKEN = window.ROOM_TOKEN || "";
const ROOM_NAME = window.ROOM_NAME || "";
const USERNAME = localStorage.getItem("omerta_user") || "ضيف";
const CHAR_ID = localStorage.getItem("omerta_char") || "char1";
const CUSTOM_IMG = localStorage.getItem("omerta_custom") || "";
const AVATAR_TYPE = localStorage.getItem("omerta_avatarType") || (CUSTOM_IMG ? "custom" : "builtin");

const CHARS = {
  char1: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#1a1a2e"/><rect x="30" y="60" width="40" height="35" rx="6" fill="#2d2d44"/><rect x="35" y="62" width="30" height="30" rx="4" fill="#1e1e3a"/><polygon points="50,64 47,72 50,80 53,72" fill="#e63946"/><ellipse cx="50" cy="40" rx="16" ry="18" fill="#f5c8a0"/><ellipse cx="50" cy="25" rx="16" ry="8" fill="#1a0a00"/><ellipse cx="44" cy="38" rx="3" ry="3.5" fill="#fff"/><ellipse cx="56" cy="38" rx="3" ry="3.5" fill="#fff"/><circle cx="44.5" cy="38.5" r="2" fill="#1a1a2e"/><circle cx="56.5" cy="38.5" r="2" fill="#1a1a2e"/><rect x="33" y="22" width="34" height="5" rx="2" fill="#0d0d1a"/><rect x="37" y="12" width="26" height="12" rx="4" fill="#0d0d1a"/></svg>',
  char2: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#1a0a0a"/><path d="M25 65 Q30 58 50 58 Q70 58 75 65 L78 95 L22 95 Z" fill="#2a0a0a"/><ellipse cx="50" cy="40" rx="17" ry="19" fill="#d4a070"/><ellipse cx="43" cy="37" rx="3.5" ry="4" fill="#fff"/><ellipse cx="57" cy="37" rx="3.5" ry="4" fill="#fff"/><circle cx="43.5" cy="37.5" r="2.2" fill="#3a1000"/><circle cx="57.5" cy="37.5" r="2.2" fill="#3a1000"/><ellipse cx="50" cy="24" rx="20" ry="5" fill="#1a0a00"/><rect x="35" y="13" width="30" height="13" rx="5" fill="#1a0a00"/></svg>',
  char3: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#0a1a1a"/><rect x="28" y="60" width="44" height="36" rx="6" fill="#e8e8f0"/><rect x="46" y="65" width="8" height="20" rx="1" fill="#e63946"/><rect x="40" y="71" width="20" height="8" rx="1" fill="#e63946"/><ellipse cx="50" cy="40" rx="16" ry="18" fill="#f8d0b0"/><ellipse cx="43" cy="38" rx="3" ry="3.5" fill="#fff"/><ellipse cx="57" cy="38" rx="3" ry="3.5" fill="#fff"/><circle cx="43" cy="38" r="2" fill="#2d5a8e"/><circle cx="57" cy="38" r="2" fill="#2d5a8e"/></svg>',
  char4: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#0a0a1a"/><path d="M22 62 L30 58 L50 60 L70 58 L78 62 L80 95 L20 95Z" fill="#3a3050"/><ellipse cx="50" cy="40" rx="16" ry="18" fill="#e8c090"/><rect x="36" y="13" width="28" height="13" rx="5" fill="#2a2040"/><ellipse cx="42" cy="38" rx="6" ry="5" fill="none" stroke="#c9a84c" stroke-width="1.5"/><ellipse cx="58" cy="38" rx="6" ry="5" fill="none" stroke="#c9a84c" stroke-width="1.5"/><circle cx="42" cy="38" r="3" fill="#1a3a5f"/><circle cx="58" cy="38" r="3" fill="#1a3a5f"/></svg>',
  char5: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#06060e"/><ellipse cx="50" cy="40" rx="15" ry="17" fill="#0a0a1a"/><ellipse cx="43" cy="38" rx="4" ry="5" fill="#60aaff" opacity=".9"/><ellipse cx="57" cy="38" rx="4" ry="5" fill="#60aaff" opacity=".9"/><ellipse cx="43" cy="38" rx="2.5" ry="3" fill="#fff" opacity=".6"/><ellipse cx="57" cy="38" rx="2.5" ry="3" fill="#fff" opacity=".6"/></svg>',
  char6: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="48" fill="#1a0a2a"/><path d="M28 60 Q50 56 72 60 L78 95 L22 95Z" fill="#4a1a6a"/><ellipse cx="50" cy="40" rx="15" ry="17" fill="#f0c8a0"/><rect x="35" y="18" width="30" height="6" rx="1" fill="#c9a84c"/><ellipse cx="43" cy="38" rx="3.5" ry="4" fill="#fff"/><ellipse cx="57" cy="38" rx="3.5" ry="4" fill="#fff"/><circle cx="43" cy="38" r="2.2" fill="#6a0080"/><circle cx="57" cy="38" r="2.2" fill="#6a0080"/></svg>'
};

const ROLE_INFO = {
  mafia: { icon: "🗡️", label: "المافيا", desc: "نسّق مع المافيا وحددوا الضحية قبل الصباح." },
  citizen: { icon: "🛡️", label: "المواطن", desc: "حلّل الكلام وصوّت بحكمة لإنقاذ المدينة." },
  doctor: { icon: "🩺", label: "الطبيب", desc: "اختر لاعباً واحداً لتنقذه خلال الليل." },
  detective: { icon: "🕵️", label: "الكاشف", desc: "اكشف حقيقة لاعب واحد كل ليلة." }
};

const PHASE_COPY = {
  waiting: { title: "اللوبي", subtitle: "تجهيز اللاعبين والصوت قبل بدء اللعبة." },
  role_reveal: { title: "توزيع الأدوار", subtitle: "تم كتم الجميع الآن حتى يطّلع كل لاعب على دوره بسرية." },
  mafia: { title: "استيقاظ المافيا", subtitle: "المافيا فقط يسمعون بعضهم الآن." },
  doctor: { title: "استيقاظ الطبيب", subtitle: "دور الطبيب: اختر من تريد إنقاذه." },
  detective: { title: "استيقاظ الكاشف", subtitle: "دور الكاشف: اختر من تريد معرفة هويته." },
  day: { title: "النهار", subtitle: "الآن الجميع الأحياء يسمعون بعضهم ويتناقشون." },
  voting: { title: "التصويت", subtitle: "صوّت على اللاعب الذي تشك أنه من المافيا." },
  results: { title: "النتائج", subtitle: "تم كشف الشخصيات وإعلان الفائز." }
};

const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

const S = {
  mySid: null,
  isHost: false,
  myRole: null,
  players: [],
  maxPlayers: 12,
  phase: "waiting",
  round: 0,
  deadline: null,
  mayTalk: true,
  allowedListen: [],
  micOn: false,
  chatOpen: window.innerWidth > 1320,
  sidebarOpen: false,
  stream: null,
  audioCtx: null,
  analyser: null,
  selectedTarget: null,
  selectedVote: null,
  privatePrompt: null,
  roleMeta: null,
  voteCounts: {}
};

const peers = {};
const remoteAudios = {};
let speakingFrame = null;
let countdownTimer = null;

const socket = io({ transports: ["websocket", "polling"], reconnection: true, reconnectionAttempts: Infinity, timeout: 20000 });
const $ = id => document.getElementById(id);

function esc(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function avatarHtml(avatar, customImg) {
  if (customImg && customImg.startsWith("data:")) {
    return `<img src="${customImg}" alt="avatar"/>`;
  }
  return CHARS[avatar] || CHARS.char1;
}

function seatLabel(index) {
  return String(index + 1).padStart(2, "0");
}

function getPlayerBySid(sid) {
  return S.players.find(player => player.sid === sid) || null;
}

function createBoardSeats() {
  const board = $("seatBoard");
  if (!board) return;
  board.innerHTML = "";
  for (let i = 0; i < 12; i += 1) {
    const seat = document.createElement("div");
    seat.className = `seat empty s${i}`;
    seat.dataset.seat = String(i);
    seat.dataset.label = seatLabel(i);
    board.appendChild(seat);
  }
}

function renderBoard() {
  const board = $("seatBoard");
  if (!board) return;
  board.querySelectorAll(".seat").forEach(seat => {
    seat.classList.add("empty");
    seat.innerHTML = "";
  });

  S.players.forEach(player => {
    const seat = board.querySelector(`.seat[data-seat="${player.seat}"]`);
    if (!seat) return;
    seat.classList.remove("empty");
    seat.innerHTML = `
      <div class="player-tile ${player.speaking ? "speaking" : ""} ${!player.alive ? "dead" : ""}">
        <div class="player-avatar">${avatarHtml(player.avatar, player.customImg)}</div>
        <div class="player-name">${esc(player.username)}</div>
        <div class="player-state">${player.alive ? (player.speaking ? "يتكلم الآن" : "جاهز") : "خارج الجولة"}</div>
        <div class="player-badges">
          ${player.is_host ? '<span class="badge host">هوست</span>' : ""}
          ${!player.mic ? '<span class="badge muted">صامت</span>' : ""}
        </div>
      </div>`;
  });

  $("userCount").textContent = String(S.players.length);
  $("sidebarCount").textContent = String(S.players.length);
  $("maxCount").textContent = String(S.maxPlayers);
}

function renderSidebarPlayers() {
  const wrap = $("sidebarPlayers");
  if (!wrap) return;
  wrap.innerHTML = "";
  S.players.forEach(player => {
    const el = document.createElement("div");
    el.className = `side-player ${!player.alive ? "dead" : ""}`;
    el.innerHTML = `
      <div class="side-player-avatar">${avatarHtml(player.avatar, player.customImg)}</div>
      <div class="side-player-name">${esc(player.username)}</div>
      <div class="side-player-meta">${player.is_host ? "👑" : player.mic ? "🎙️" : "🔇"}</div>`;
    wrap.appendChild(el);
  });
}

function renderSelfCard() {
  $("upAvatar").innerHTML = avatarHtml(CHAR_ID, CUSTOM_IMG);
  $("upName").textContent = USERNAME;
}

function updateCenterCard(text) {
  $("centerRound").textContent = S.phase === "waiting" ? "بانتظار بدء اللعبة" : `الجولة ${S.round || 1}`;
  $("centerAnnouncement").textContent = text || "";
}

function updateHostButtons() {
  const tooFew = S.players.length < 4;
  const show = S.isHost && S.phase === "waiting";
  [$("tbStartBtn"), $("startGameBtn")].forEach(btn => {
    if (!btn) return;
    btn.classList.toggle("hidden", !show);
    btn.disabled = tooFew;
    btn.style.opacity = tooFew ? "0.55" : "1";
  });
}

function updateSidebarPhase() {
  const copy = PHASE_COPY[S.phase] || PHASE_COPY.waiting;
  $("sidebarPhaseVal").textContent = copy.title;
  $("topBarPhase").textContent = `${copy.title} — ${copy.subtitle}`;
  $("upStatus").textContent = S.mayTalk ? "يمكنك الكلام" : "صامت حسب المرحلة";
}

function updatePolicyCard() {
  const labels = {
    waiting: "🔊 الجميع يسمعون الجميع",
    role_reveal: "🤫 تم كتم الجميع أثناء توزيع الأدوار",
    mafia: S.myRole === "mafia" ? "🗡️ أنت في قناة المافيا" : "🔕 لا أحد يسمعك الآن",
    doctor: S.myRole === "doctor" ? "🩺 وقت الطبيب" : "🔕 لا أحد يسمعك الآن",
    detective: S.myRole === "detective" ? "🕵️ وقت الكاشف" : "🔕 لا أحد يسمعك الآن",
    day: "🌤️ جميع الأحياء في قناة عامة",
    voting: "🗳️ تصويت مع قناة عامة",
    results: "🏁 نهاية الجولة"
  };
  $("policyCard").textContent = labels[S.phase] || labels.waiting;
}

function startCountdown(deadline) {
  clearInterval(countdownTimer);
  if (!deadline) {
    $("phaseTimer").textContent = "--:--";
    return;
  }
  const tick = () => {
    const diff = Math.max(0, Math.ceil(deadline - Date.now() / 1000));
    const mins = String(Math.floor(diff / 60)).padStart(2, "0");
    const secs = String(diff % 60).padStart(2, "0");
    $("phaseTimer").textContent = `${mins}:${secs}`;
  };
  tick();
  countdownTimer = setInterval(tick, 300);
}

function roleName(roleKey) {
  const data = S.roleMeta || {};
  if (data.role === roleKey) return data.label;
  return roleKey || "—";
}

function renderOverlay() {
  const overlay = $("phaseOverlay");
  const resultDrawer = $("resultDrawer");
  resultDrawer.classList.add("hidden");
  if (S.phase === "waiting" || S.phase === "results") {
    overlay.classList.add("hidden");
    return;
  }

  const copy = PHASE_COPY[S.phase] || PHASE_COPY.waiting;
  $("overlayBadge").textContent = copy.title;
  $("overlayTitle").textContent = copy.title;
  $("overlaySubtitle").textContent = S.privatePrompt?.subtitle || copy.subtitle;
  overlay.classList.remove("hidden");

  const roleCard = $("roleRevealCard");
  const actionPanel = $("actionPanel");
  const votePanel = $("votePanel");
  roleCard.classList.add("hidden");
  votePanel.classList.add("hidden");
  actionPanel.classList.remove("hidden");
  $("actionSubmitBtn").classList.add("hidden");
  $("actionList").innerHTML = "";

  if (S.phase === "role_reveal") {
    roleCard.classList.remove("hidden");
    actionPanel.classList.add("hidden");
    const info = S.roleMeta || { icon: "🎭", label: "مجهول", role: "citizen" };
    $("roleCardIcon").textContent = info.icon || "🎭";
    $("roleCardName").textContent = info.label || "—";
    $("roleCardDesc").textContent = ROLE_INFO[info.role]?.desc || "";
    return;
  }

  if (S.phase === "voting") {
    actionPanel.classList.add("hidden");
    votePanel.classList.remove("hidden");
    renderVoteList();
    return;
  }

  if (["mafia", "doctor", "detective"].includes(S.phase)) {
    const canAct = S.privatePrompt && S.privatePrompt.phase === S.phase;
    if (!canAct) {
      $("actionList").innerHTML = `<div class="modal-body">${copy.subtitle}</div>`;
      return;
    }
    renderActionTargets(S.privatePrompt.targets || []);
    $("actionSubmitBtn").classList.remove("hidden");
    return;
  }

  if (S.phase === "day") {
    $("actionList").innerHTML = `<div class="modal-body">${esc($("centerAnnouncement").textContent)}</div>`;
  }
}

function renderActionTargets(targets) {
  const wrap = $("actionList");
  wrap.innerHTML = "";
  targets.forEach(target => {
    const player = getPlayerBySid(target.sid);
    const card = document.createElement("div");
    card.className = `target-card ${S.selectedTarget === target.sid ? "selected" : ""}`;
    card.innerHTML = `
      <div class="target-avatar">${avatarHtml(player?.avatar || "char1", player?.customImg || "")}</div>
      <div class="target-name">${esc(target.username)}</div>`;
    card.addEventListener("click", () => {
      S.selectedTarget = target.sid;
      renderActionTargets(targets);
    });
    wrap.appendChild(card);
  });
}

function renderVoteList() {
  const wrap = $("voteList");
  wrap.innerHTML = "";
  const alive = S.players.filter(player => player.alive);
  alive.forEach(player => {
    const card = document.createElement("div");
    const count = S.voteCounts[player.sid] || 0;
    card.className = `vote-card ${S.selectedVote === player.sid ? "selected" : ""}`;
    card.innerHTML = `
      <div class="vote-avatar">${avatarHtml(player.avatar, player.customImg)}</div>
      <div class="vote-name">${esc(player.username)}</div>
      <div class="vote-count">${count} صوت</div>`;
    if (player.sid !== S.mySid) {
      card.addEventListener("click", () => {
        S.selectedVote = player.sid;
        socket.emit("cast_vote", { room: TOKEN, target_sid: player.sid });
        renderVoteList();
      });
    }
    wrap.appendChild(card);
  });
}

function renderResults(data) {
  $("resultsWinner").textContent = data.winner === "mafia" ? "فازت المافيا" : "فاز المواطنون";
  $("resultsLabel").textContent = data.label || "";
  const grid = $("resultsGrid");
  grid.innerHTML = "";
  (data.players || []).forEach(player => {
    const el = document.createElement("div");
    el.className = `result-player ${!player.alive ? "dead" : ""}`;
    el.innerHTML = `
      <div class="player-avatar">${avatarHtml(player.avatar, player.customImg)}</div>
      <div class="player-name">${esc(player.username)}</div>
      <div class="player-state">${esc(ROLE_INFO[player.role]?.label || player.role || "")}</div>`;
    grid.appendChild(el);
  });
  $("resultDrawer").classList.remove("hidden");
}

function toast(message, duration = 2800) {
  const container = $("toastContainer");
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  container.appendChild(item);
  setTimeout(() => {
    item.style.opacity = "0";
    setTimeout(() => item.remove(), 250);
  }, duration);
}

function updateMicUI() {
  const label = S.micOn ? (S.mayTalk ? "🎙️" : "🔕") : "🔇";
  $("micStateIcon").textContent = label;
  $("btnMicSide").textContent = label;
}

function applyAudioPolicy() {
  if (S.stream) {
    S.stream.getAudioTracks().forEach(track => {
      track.enabled = S.micOn && S.mayTalk;
    });
  }
  Object.entries(remoteAudios).forEach(([sid, audio]) => {
    audio.muted = !S.allowedListen.includes(sid);
    if (!audio.muted) {
      audio.play().catch(() => {});
    }
  });
  updateMicUI();
  updatePolicyCard();
}

async function ensureMic() {
  if (S.stream) return true;
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    S.audioCtx = new AudioContextClass();
    const source = S.audioCtx.createMediaStreamSource(S.stream);
    S.analyser = S.audioCtx.createAnalyser();
    S.analyser.fftSize = 256;
    source.connect(S.analyser);
    startSpeakingDetection();
    Object.values(peers).forEach(pc => attachLocalTracks(pc));
    S.players.forEach(player => {
      if (player.sid !== S.mySid && String(S.mySid) < String(player.sid)) {
        createOffer(player.sid);
      }
    });
    return true;
  } catch (error) {
    console.error(error);
    toast("تعذر الوصول إلى الميكروفون");
    return false;
  }
}

function startSpeakingDetection() {
  cancelAnimationFrame(speakingFrame);
  if (!S.analyser) return;
  const data = new Uint8Array(S.analyser.frequencyBinCount);
  let lastActive = false;
  const loop = () => {
    if (!S.analyser) return;
    S.analyser.getByteFrequencyData(data);
    const avg = data.reduce((sum, value) => sum + value, 0) / data.length;
    const active = avg > 18 && S.micOn && S.mayTalk;
    if (active !== lastActive) {
      lastActive = active;
      socket.emit("speaking", { room: TOKEN, active });
    }
    speakingFrame = requestAnimationFrame(loop);
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
  if (!S.stream) return;
  const senders = pc.getSenders();
  S.stream.getTracks().forEach(track => {
    const exists = senders.some(sender => sender.track && sender.track.id === track.id);
    if (!exists) pc.addTrack(track, S.stream);
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
    if (event.candidate) {
      socket.emit("webrtc_ice", { room: TOKEN, target: sid, candidate: event.candidate });
    }
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
    if (["failed", "closed"].includes(pc.connectionState)) {
      closePeer(sid);
    }
  };

  return pc;
}

async function createOffer(sid) {
  if (!S.stream || sid === S.mySid) return;
  const pc = getOrCreatePeer(sid);
  if (pc.signalingState !== "stable") return;
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc_offer", { room: TOKEN, target: sid, sdp: pc.localDescription });
  } catch (error) {
    console.warn("offer failed", error);
  }
}

async function toggleMic() {
  if (!S.micOn) {
    const ok = await ensureMic();
    if (!ok) return;
    S.micOn = true;
  } else {
    S.micOn = false;
    socket.emit("speaking", { room: TOKEN, active: false });
  }
  applyAudioPolicy();
  socket.emit("toggle_mic", { room: TOKEN, state: S.micOn });
}

function sendMsg() {
  const input = $("chatInput");
  const msg = (input.value || "").trim();
  if (!msg) return;
  socket.emit("chat_msg", { room: TOKEN, msg });
  input.value = "";
}

function appendMessage(data) {
  const wrap = $("chatMessages");
  const item = document.createElement("div");
  item.className = data.type === "system" ? "sys-msg" : "msg";
  if (data.type === "system") {
    item.textContent = data.msg;
  } else {
    item.innerHTML = `<div class="msg-name">${esc(data.user)}</div><div class="msg-text">${esc(data.msg)}</div>`;
  }
  wrap.appendChild(item);
  wrap.scrollTop = wrap.scrollHeight;
}

function startGame() {
  if (S.players.length < 4) {
    $("minPlayersModal").classList.remove("hidden");
    return;
  }
  socket.emit("start_game", { room: TOKEN });
}

function closeMinPlayersModal() {
  $("minPlayersModal").classList.add("hidden");
}

function sendNightAction() {
  if (!S.selectedTarget) {
    toast("اختر لاعباً أولاً");
    return;
  }
  socket.emit("night_action", { room: TOKEN, target_sid: S.selectedTarget });
  toast("تم إرسال اختيارك");
}

function resetGame() {
  socket.emit("reset_game", { room: TOKEN });
}

function copyCode() {
  navigator.clipboard.writeText(TOKEN).then(() => toast(`تم نسخ الكود ${TOKEN}`)).catch(() => toast(TOKEN));
}

function toggleChat() {
  S.chatOpen = !S.chatOpen;
  $("chatPanel").classList.toggle("open", S.chatOpen);
}

function toggleSidebar() {
  S.sidebarOpen = !S.sidebarOpen;
  $("sidebar").classList.toggle("open", S.sidebarOpen);
}

function confirmLeave() {
  if (window.confirm("هل تريد مغادرة الغرفة؟")) {
    window.location.href = "/";
  }
}

socket.on("connect", () => {
  socket.emit("join", {
    room: TOKEN,
    username: USERNAME,
    avatar: CHAR_ID,
    avatarType: AVATAR_TYPE,
    customImg: CUSTOM_IMG
  });
});

socket.on("joined_ok", data => {
  S.mySid = data.my_sid;
  S.isHost = data.is_host;
  S.maxPlayers = data.max_players || 12;
  $("sidebarRoomName").textContent = data.room_name || ROOM_NAME;
  $("sidebarRoomCode").textContent = TOKEN;
  $("topBarRoomName").textContent = data.room_name || ROOM_NAME;
  updateHostButtons();
});

socket.on("phase_change", data => {
  S.phase = data.phase || "waiting";
  S.round = data.round || S.round || 0;
  S.deadline = data.deadline || null;
  S.privatePrompt = S.privatePrompt && S.privatePrompt.phase === S.phase ? S.privatePrompt : null;
  S.selectedTarget = null;
  S.selectedVote = null;
  S.voteCounts = {};
  updateSidebarPhase();
  updateCenterCard(data.announcement || (PHASE_COPY[S.phase] || {}).subtitle || "");
  startCountdown(S.deadline);
  renderOverlay();
});

socket.on("your_role", data => {
  S.myRole = data.role;
  S.roleMeta = data;
  renderOverlay();
  toast(`دورك: ${data.label}`);
});

socket.on("private_prompt", data => {
  S.privatePrompt = data;
  if (S.phase === data.phase) {
    renderOverlay();
  }
});

socket.on("update_players", data => {
  S.players = data.players || [];
  S.maxPlayers = data.max_players || 12;
  renderBoard();
  renderSidebarPlayers();
  updateHostButtons();
  if (S.stream) {
    S.players.forEach(player => {
      if (player.sid !== S.mySid && !peers[player.sid] && String(S.mySid) < String(player.sid)) {
        createOffer(player.sid);
      }
    });
  }
  Object.keys(peers).forEach(sid => {
    if (!S.players.find(player => player.sid === sid)) {
      closePeer(sid);
    }
  });
});

socket.on("audio_policy", data => {
  S.allowedListen = data.allowed_listen || [];
  S.mayTalk = !!data.may_talk;
  applyAudioPolicy();
});

socket.on("new_message", appendMessage);
socket.on("name_taken", data => toast(`الاسم مستخدم، جرب ${data.suggested}`));
socket.on("error", data => toast(data?.msg || "حدث خطأ"));
socket.on("action_received", data => toast(data.msg || "تم"));
socket.on("vote_ack", data => toast(data.msg || "تم التصويت"));

socket.on("vote_update", data => {
  S.voteCounts = data.counts || {};
  if (S.phase === "voting") renderVoteList();
});

socket.on("detective_result", data => {
  const message = data.is_mafia ? `${data.username} من المافيا` : `${data.username} ليس من المافيا`;
  toast(message, 4500);
  $("overlaySubtitle").textContent = message;
});

socket.on("game_started", data => {
  S.round = data.round || 1;
  $("resultDrawer").classList.add("hidden");
  toast("بدأت اللعبة");
});

socket.on("game_over", data => {
  S.phase = "results";
  clearInterval(countdownTimer);
  $("phaseOverlay").classList.add("hidden");
  updateCenterCard(data.label || "انتهت اللعبة");
  renderResults(data);
  updateSidebarPhase();
});

socket.on("game_reset", () => {
  S.phase = "waiting";
  S.round = 0;
  S.myRole = null;
  S.privatePrompt = null;
  S.roleMeta = null;
  S.selectedTarget = null;
  S.selectedVote = null;
  S.voteCounts = {};
  $("resultDrawer").classList.add("hidden");
  updateSidebarPhase();
  updateCenterCard("اجمع 4 لاعبين على الأقل لبدء الجولة.");
  renderOverlay();
  toast("تمت إعادة تعيين اللعبة");
});

socket.on("disconnect", () => toast("انقطع الاتصال..."));
socket.on("reconnect", () => {
  toast("تمت إعادة الاتصال");
  socket.emit("join", {
    room: TOKEN,
    username: USERNAME,
    avatar: CHAR_ID,
    avatarType: AVATAR_TYPE,
    customImg: CUSTOM_IMG
  });
});

socket.on("webrtc_offer", async data => {
  const pc = getOrCreatePeer(data.from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("webrtc_answer", { room: TOKEN, target: data.from, sdp: pc.localDescription });
  } catch (error) {
    console.warn(error);
  }
});

socket.on("webrtc_answer", async data => {
  const pc = peers[data.from];
  if (!pc) return;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  } catch (error) {
    console.warn(error);
  }
});

socket.on("webrtc_ice", async data => {
  const pc = peers[data.from];
  if (!pc || !data.candidate) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  } catch (error) {
    console.warn(error);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  createBoardSeats();
  renderSelfCard();
  $("chatPanel").classList.toggle("open", S.chatOpen);
  $("chatInput").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMsg();
    }
  });
  $("upAvatar").innerHTML = avatarHtml(CHAR_ID, CUSTOM_IMG);
  $("upName").textContent = USERNAME;
  $("centerAnnouncement").textContent = "اجمع 4 لاعبين على الأقل لبدء الجولة.";
  updateMicUI();
  updateSidebarPhase();

  const resumeAudio = async () => {
    if (S.audioCtx && S.audioCtx.state === "suspended") {
      try { await S.audioCtx.resume(); } catch (_) {}
    }
    Object.values(remoteAudios).forEach(audio => audio.play().catch(() => {}));
  };
  document.addEventListener("click", resumeAudio);
  document.addEventListener("touchstart", resumeAudio, { passive: true });
});

window.toggleMic = toggleMic;
window.toggleChat = toggleChat;
window.toggleSidebar = toggleSidebar;
window.sendMsg = sendMsg;
window.copyCode = copyCode;
window.startGame = startGame;
window.sendNightAction = sendNightAction;
window.resetGame = resetGame;
window.confirmLeave = confirmLeave;
window.closeMinPlayersModal = closeMinPlayersModal;
