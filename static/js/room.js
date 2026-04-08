"use strict";

const TOKEN = window.ROOM_TOKEN || "";
const ROOM_NAME = window.ROOM_NAME || "";
const USERNAME = localStorage.getItem("omerta_user") || "لاعب";
const CHAR_ID = localStorage.getItem("omerta_char") || "unknown";
const AVATAR_TYPE = localStorage.getItem("omerta_avatarType") || "builtin";
const CUSTOM = localStorage.getItem("omerta_custom") || "";
const MIN_PLAYERS = 4;

const ROLE_META = {
  mafia: { label: "المافيا", color: "#d8b15b", icon: "/static/svg/roles/mafia.svg" },
  citizen: { label: "المواطن", color: "#fff3c6", icon: "/static/svg/roles/citizen.svg" },
  doctor: { label: "الطبيب", color: "#d8b15b", icon: "/static/svg/roles/doctor.svg" },
  detective: { label: "الكاشف", color: "#d8b15b", icon: "/static/svg/roles/detective.svg" },
};

const STATE = {
  mySid: null,
  isHost: false,
  myRole: null,
  phase: "waiting",
  round: 0,
  micOn: false,
  players: [],
  chatOpen: false,
  infoOpen: false,
  selectedNightTarget: null,
  selectedVoteTarget: null,
  stream: null,
  audioCtx: null,
  analyser: null,
};

const peers = {};
const remoteAudios = {};
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

const socket = io({ transports: ["websocket", "polling"], reconnection: true, reconnectionDelay: 1000, reconnectionAttempts: Infinity, timeout: 20000 });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

function avatarUrl(avatarId, customImg) {
  if (customImg && customImg.startsWith("data:")) return customImg;
  return `/static/svg/avatars/${avatarId || "unknown"}.svg`;
}

function playerName(player) {
  return player?.username || "لاعب";
}

function currentVoiceMode() {
  if (STATE.phase === "night") return "القدرات الليلية فقط تسمع وتتحرك الآن";
  if (STATE.phase === "voting") return "مرحلة التصويت فعالة";
  if (STATE.phase === "results") return "تم كشف النتائج";
  return "جميع اللاعبين يسمعون بعضهم";
}

function phaseLabel(phase) {
  return {
    waiting: "اللوبي",
    night: "الليل",
    day: "النهار",
    voting: "التصويت",
    results: "النتائج",
  }[phase] || phase;
}

function openDrawer(which) {
  $("drawerBackdrop").classList.add("show");
  if (which === "chat") {
    STATE.chatOpen = true;
    $("chatDrawer").classList.add("open");
  }
  if (which === "info") {
    STATE.infoOpen = true;
    $("infoDrawer").classList.add("open");
  }
}

function closeDrawers() {
  STATE.chatOpen = false;
  STATE.infoOpen = false;
  $("chatDrawer").classList.remove("open");
  $("infoDrawer").classList.remove("open");
  $("drawerBackdrop").classList.remove("show");
}

function showModal(title, text) {
  $("modalTitle").textContent = title;
  $("modalText").textContent = text;
  $("modalCard").classList.add("show");
  $("modalBackdrop").classList.add("show");
}

function closeModal() {
  $("modalCard").classList.remove("show");
  $("modalBackdrop").classList.remove("show");
}

function toast(text, ms = 3200) {
  const wrap = $("toastStack");
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = text;
  wrap.appendChild(item);
  setTimeout(() => {
    item.style.opacity = "0";
    item.style.transform = "translateY(8px)";
    item.style.transition = "all .22s ease";
    setTimeout(() => item.remove(), 220);
  }, ms);
}

function renderTop() {
  $("topRoomCode").textContent = TOKEN;
  $("infoRoomCode").textContent = TOKEN;
  $("infoRoomName").textContent = ROOM_NAME;
  $("topSubtitle").textContent = `${phaseLabel(STATE.phase)} — ${STATE.phase === "waiting" ? "تجهيز اللاعبين" : "الجولة " + (STATE.round || 1)}`;
  $("phaseBadge").textContent = phaseLabel(STATE.phase);
  $("infoPhase").textContent = phaseLabel(STATE.phase);
  const voice = currentVoiceMode();
  $("voiceModeInline").textContent = voice;
  $("infoVoiceMode").textContent = voice;
  $("userCount").textContent = String(STATE.players.length);
  const canStart = STATE.isHost && STATE.phase === "waiting";
  const enoughPlayers = STATE.players.length >= MIN_PLAYERS;
  const startBtn = $("startGameBtn");
  startBtn.style.display = canStart ? "inline-flex" : "none";
  startBtn.disabled = !enoughPlayers;
  startBtn.style.opacity = enoughPlayers ? "1" : ".55";
  startBtn.title = enoughPlayers ? "ابدأ اللعبة" : "العدد غير كاف لبدء اللعبة";

  const startVoteBtn = $("startVoteBtn");
  const forceNightBtn = $("forceNightBtn");
  const resetGameBtn = $("resetGameBtn");
  [startVoteBtn, forceNightBtn, resetGameBtn].forEach((btn) => btn.classList.add("hidden-by-js"));
  if (STATE.isHost && STATE.phase === "day") startVoteBtn.classList.remove("hidden-by-js");
  if (STATE.isHost && STATE.phase === "night") forceNightBtn.classList.remove("hidden-by-js");
  if (STATE.isHost && STATE.phase === "results") resetGameBtn.classList.remove("hidden-by-js");
}

function renderWaitingPanel(extra = "") {
  const title = {
    waiting: "بانتظار بدء الجولة",
    night: "الليل يعمل الآن",
    day: "بدأ النهار",
    voting: "بدأ التصويت",
    results: "انتهت الجولة",
  }[STATE.phase];
  const defaultText = {
    waiting: "الغرفة جاهزة، اللاعبون الظاهرون بالأسفل هم المنتظرون قبل بداية اللعبة.",
    night: "تتحرك القدرات الخاصة في هذه المرحلة. راقب لوحة الحالة والتعليمات التي تظهر لك.",
    day: "افتح المحادثة أو ناقش داخل القناة الصوتية ثم ابدأ التصويت عند جاهزية الجميع.",
    voting: "اختر اللاعب الذي تشك فيه من قائمة التصويت الظاهرة تحتك.",
    results: "تم كشف الأدوار النهائية ويمكن للهوست إعادة الجولة إلى اللوبي.",
  }[STATE.phase];
  $("waitingTitle").textContent = title;
  $("waitingText").textContent = extra || defaultText;
}

function renderRoleBadge() {
  const wrap = $("roleBadgeWrap");
  if (!STATE.myRole || !ROLE_META[STATE.myRole]) {
    wrap.classList.add("hidden");
    return;
  }
  const meta = ROLE_META[STATE.myRole];
  wrap.classList.remove("hidden");
  $("roleBadgeIcon").src = meta.icon;
  $("roleBadgeLabel").textContent = meta.label;
  $("roleBadgeLabel").style.color = meta.color;
}

function buildPlayerCard(player) {
  const card = document.createElement("article");
  card.className = `player-card${player.speaking ? " speaking" : ""}${!player.alive ? " dead" : ""}`;
  card.innerHTML = `
    <div class="player-head">
      <div class="player-avatar">
        <img src="${avatarUrl(player.avatar, player.customImg)}" alt="avatar">
        <div>
          <strong>${esc(playerName(player))}</strong>
          <span>${player.is_host ? "هوست الغرفة" : player.alive ? "داخل الجولة" : "خرج من الجولة"}</span>
        </div>
      </div>
      <span class="mini-chip">${player.is_host ? "هوست" : player.mic ? "الصوت مفعل" : "الصوت مغلق"}</span>
    </div>
    <div class="player-status">
      <small>${player.role ? ROLE_META[player.role]?.label || player.role : (player.alive ? "جاهز" : "خارج الجولة")}</small>
      ${player.speaking ? '<small>يتحدث الآن</small>' : '<small>هادئ</small>'}
    </div>
  `;
  return card;
}

function renderDrawerPlayers(players) {
  const wrap = $("drawerPlayers");
  wrap.innerHTML = "";
  players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "drawer-player";
    row.innerHTML = `
      <img src="${avatarUrl(player.avatar, player.customImg)}" alt="avatar">
      <div style="min-width:0">
        <strong style="display:block;color:var(--gold-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(playerName(player))}</strong>
        <span style="display:block;color:var(--muted);margin-top:6px;font-size:.88rem">${player.is_host ? "هوست" : player.alive ? "متصل" : "خارج الجولة"}</span>
      </div>
    `;
    wrap.appendChild(row);
  });
}

function renderPlayers(players) {
  const grid = $("playersGrid");
  grid.innerHTML = "";
  if (!players.length) {
    $("emptyState").classList.remove("hidden");
  } else {
    $("emptyState").classList.add("hidden");
  }
  const shuffled = [...players].sort((a, b) => (a.sid < b.sid ? -1 : 1));
  shuffled.forEach((player) => grid.appendChild(buildPlayerCard(player)));
  renderDrawerPlayers(players);
  renderTop();
}

function appendMessage(data) {
  const box = $("chatMessages");
  const item = document.createElement("div");
  if (data.type === "system") {
    item.className = "system-msg";
    item.innerHTML = `<small>نظام الغرفة</small>${esc(data.msg)}`;
  } else {
    const when = new Date().toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit" });
    item.className = "chat-msg";
    item.innerHTML = `<strong>${esc(data.user || "لاعب")}</strong><small>${when}</small><div>${esc(data.msg)}</div>`;
  }
  box.appendChild(item);
  box.scrollTop = box.scrollHeight;
}

function toggleMicUI() {
  $("micIcon").src = STATE.micOn ? "/static/svg/icons/mic-on.svg" : "/static/svg/icons/mic-off.svg";
}

async function initMic() {
  try {
    STATE.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    STATE.audioCtx = new AudioCtx();
    const source = STATE.audioCtx.createMediaStreamSource(STATE.stream);
    STATE.analyser = STATE.audioCtx.createAnalyser();
    STATE.analyser.fftSize = 256;
    source.connect(STATE.analyser);
    if (STATE.audioCtx.state === "suspended") await STATE.audioCtx.resume();
    detectSpeaking();
    STATE.players.forEach((p) => { if (p.sid !== STATE.mySid) createOffer(p.sid); });
    toast("تم تفعيل الميكروفون");
  } catch (err) {
    console.error(err);
    STATE.micOn = false;
    toggleMicUI();
    showModal("تعذر فتح الميكروفون", "اسمح للمتصفح بالوصول إلى الميكروفون ثم حاول مرة أخرى.");
  }
}

function detectSpeaking() {
  if (!STATE.analyser || !STATE.stream || !STATE.micOn) return;
  const data = new Uint8Array(STATE.analyser.frequencyBinCount);
  const loop = () => {
    if (!STATE.analyser || !STATE.micOn) return;
    STATE.analyser.getByteFrequencyData(data);
    const average = data.reduce((acc, n) => acc + n, 0) / data.length;
    socket.emit("speaking", { room: TOKEN, active: average > 12 });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

async function toggleMic() {
  STATE.micOn = !STATE.micOn;
  if (STATE.micOn && !STATE.stream) {
    await initMic();
  }
  if (STATE.stream) {
    STATE.stream.getAudioTracks().forEach((track) => { track.enabled = STATE.micOn; });
  }
  socket.emit("toggle_mic", { room: TOKEN, state: STATE.micOn });
  toggleMicUI();
}

function closePeer(remoteSid) {
  if (peers[remoteSid]) {
    try { peers[remoteSid].close(); } catch (e) {}
    delete peers[remoteSid];
  }
  if (remoteAudios[remoteSid]) {
    try { remoteAudios[remoteSid].srcObject = null; remoteAudios[remoteSid].remove(); } catch (e) {}
    delete remoteAudios[remoteSid];
  }
}

function getOrCreatePeer(remoteSid) {
  if (peers[remoteSid]) return peers[remoteSid];
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peers[remoteSid] = pc;
  if (STATE.stream) STATE.stream.getTracks().forEach((track) => pc.addTrack(track, STATE.stream));
  pc.onicecandidate = (event) => {
    if (event.candidate) socket.emit("webrtc_ice", { room: TOKEN, target: remoteSid, candidate: event.candidate });
  };
  pc.ontrack = (event) => {
    let audio = remoteAudios[remoteSid];
    if (!audio) {
      audio = document.createElement("audio");
      audio.autoplay = true;
      audio.playsInline = true;
      remoteAudios[remoteSid] = audio;
      document.body.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
    audio.play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (["failed", "closed"].includes(state)) closePeer(remoteSid);
    if (state === "disconnected") {
      setTimeout(() => {
        if (peers[remoteSid] && peers[remoteSid].connectionState === "disconnected") {
          closePeer(remoteSid);
          if (STATE.micOn && STATE.stream && STATE.players.find((p) => p.sid === remoteSid)) createOffer(remoteSid);
        }
      }, 3500);
    }
  };
  return pc;
}

async function createOffer(remoteSid) {
  const pc = getOrCreatePeer(remoteSid);
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("webrtc_offer", { room: TOKEN, target: remoteSid, sdp: pc.localDescription });
  } catch (err) {
    console.warn("offer", err);
  }
}

function sendMessage() {
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text) return;
  socket.emit("chat_msg", { room: TOKEN, msg: text });
  input.value = "";
}

function copyCode() {
  navigator.clipboard.writeText(TOKEN).then(() => toast(`تم نسخ الكود ${TOKEN}`)).catch(() => toast(TOKEN));
}

function openChat() { closeModal(); openDrawer("chat"); }
function openInfo() { closeModal(); openDrawer("info"); }

function beginStartGame() {
  if (!STATE.isHost) return;
  if (STATE.players.length < MIN_PLAYERS) {
    showModal("عدد اللاعبين غير كاف", `لا يمكن بدء اللعبة الآن. تحتاج إلى ${MIN_PLAYERS} لاعبين على الأقل، والحالي ${STATE.players.length}.`);
    return;
  }
  socket.emit("start_game", { room: TOKEN });
}

function beginStartVote(){ socket.emit("start_vote", { room: TOKEN }); }
function beginForceNight(){ socket.emit("force_night_end", { room: TOKEN }); }
function beginResetGame(){ socket.emit("reset_game", { room: TOKEN }); }

function renderNightTargets(role, targets) {
  const card = $("nightActionCard");
  const wrap = $("nightTargets");
  const title = $("nightActionTitle");
  const sub = $("nightActionSub");
  const confirmBtn = $("confirmNightBtn");
  const titles = {
    mafia: ["اختيار هدف المافيا", "اختر اللاعب الذي تريد إخراجه من الجولة."],
    doctor: ["قدرة الطبيب", "اختر اللاعب الذي تريد حمايته."],
    detective: ["قدرة الكاشف", "اختر اللاعب الذي تريد معرفة هويته."],
  };
  if (!titles[role]) {
    card.classList.add("hidden");
    return;
  }
  title.textContent = titles[role][0];
  sub.textContent = titles[role][1];
  wrap.innerHTML = "";
  STATE.selectedNightTarget = null;
  confirmBtn.disabled = true;
  targets.forEach((target) => {
    const player = STATE.players.find((item) => item.sid === target.sid) || { avatar: "unknown", customImg: "", username: target.username };
    const item = document.createElement("button");
    item.className = "target-card";
    item.type = "button";
    item.innerHTML = `<img src="${avatarUrl(player.avatar, player.customImg)}" alt="avatar"><div><strong style="display:block;color:var(--gold-soft)">${esc(target.username)}</strong><small style="display:block;color:var(--muted);margin-top:6px">اختيار مباشر</small></div>`;
    item.addEventListener("click", () => {
      wrap.querySelectorAll(".target-card").forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      STATE.selectedNightTarget = target.sid;
      confirmBtn.disabled = false;
    });
    wrap.appendChild(item);
  });
  card.classList.remove("hidden");
}

function submitNightTarget() {
  if (!STATE.selectedNightTarget) return;
  socket.emit("night_action", { room: TOKEN, target_sid: STATE.selectedNightTarget });
  $("confirmNightBtn").disabled = true;
  toast("تم إرسال اختيارك الليلي");
}

function renderVoteTargets(candidates) {
  const card = $("voteCard");
  const wrap = $("voteTargets");
  wrap.innerHTML = "";
  STATE.selectedVoteTarget = null;
  candidates.forEach((target) => {
    const player = STATE.players.find((item) => item.sid === target.sid) || { avatar: "unknown", customImg: "", username: target.username };
    const item = document.createElement("button");
    item.type = "button";
    item.className = "target-card";
    item.innerHTML = `<img src="${avatarUrl(player.avatar, player.customImg)}" alt="avatar"><div><strong style="display:block;color:var(--gold-soft)">${esc(target.username)}</strong><small style="display:block;color:var(--muted);margin-top:6px">تصويت</small></div>`;
    if (target.sid === STATE.mySid) item.disabled = true;
    item.addEventListener("click", () => {
      if (STATE.selectedVoteTarget) return;
      STATE.selectedVoteTarget = target.sid;
      socket.emit("cast_vote", { room: TOKEN, target_sid: target.sid });
      item.classList.add("active");
    });
    wrap.appendChild(item);
  });
  card.classList.remove("hidden");
}

function updateVoteCounts(counts) {
  const text = Object.values(counts || {}).reduce((a, b) => a + b, 0);
  $("voteStatusText").textContent = `تم تسجيل ${text} صوت حتى الآن.`;
}

function setPhase(phase, data = {}) {
  STATE.phase = phase;
  if (typeof data.round === "number") STATE.round = data.round;
  renderTop();
  renderWaitingPanel(data.killed ? `بدأ النهار بعد خروج ${data.killed}.` : data.eliminated ? `خرج ${data.eliminated} بعد التصويت.` : "");
  $("nightActionCard").classList.add("hidden");
  $("voteCard").classList.add("hidden");
  if (phase === "night" && STATE.myRole === "citizen") {
    renderWaitingPanel("أنت مواطن، انتظر انتهاء الحركة الليلية لباقي الأدوار.");
  }
  if (phase === "results") {
    renderWaitingPanel(data.label || "تم كشف جميع الأدوار ونهاية الجولة.");
  }
}

socket.on("connect", () => {
  socket.emit("join", { room: TOKEN, username: USERNAME, avatar: CHAR_ID, avatarType: AVATAR_TYPE, customImg: CUSTOM });
});

socket.on("joined_ok", (data) => {
  STATE.mySid = data.my_sid;
  STATE.isHost = data.is_host;
  if (data.phase) STATE.phase = data.phase;
  renderTop();
});

socket.on("update_players", (data) => {
  STATE.players = data.players || [];
  renderPlayers(STATE.players);
  if (STATE.micOn && STATE.stream) {
    STATE.players.forEach((player) => {
      if (player.sid !== STATE.mySid && !peers[player.sid]) createOffer(player.sid);
    });
  }
  Object.keys(peers).forEach((sid) => {
    if (!STATE.players.find((player) => player.sid === sid)) closePeer(sid);
  });
});

socket.on("new_message", (data) => appendMessage(data));
socket.on("name_taken", (data) => showModal("الاسم مستخدم", `الاسم مستخدم بالفعل. جرّب الاسم المقترح: ${data.suggested}`));
socket.on("error", (data) => {
  const msg = data?.msg || "حدث خطأ";
  if (msg.includes("العدد غير كاف") || msg.includes("تحتاج")) showModal("عدد اللاعبين غير كاف", msg);
  else toast(msg);
});

socket.on("game_started", (data) => {
  STATE.round = data.round || 1;
  setPhase("night", data);
  renderWaitingPanel("بدأت الجولة. تظهر لك تعليمات خاصة إذا كان لدورك قدرة ليلية.");
  toast("بدأت اللعبة");
});

socket.on("your_role", (data) => {
  STATE.myRole = data.role;
  renderRoleBadge();
  toast(`دورك: ${data.label}`);
});

socket.on("night_info", (data) => {
  if (data?.role && data.role !== "citizen") renderNightTargets(data.role, data.targets || []);
});

socket.on("detective_result", (data) => {
  const text = data.is_mafia ? `${data.username} من فريق المافيا.` : `${data.username} ليس من فريق المافيا.`;
  showModal("نتيجة التحقق", text);
});

socket.on("action_received", (data) => toast(data.msg || "تم حفظ الاختيار"));

socket.on("phase_change", (data) => {
  setPhase(data.phase, data);
  if (data.phase === "voting") renderVoteTargets(data.candidates || []);
});

socket.on("vote_update", (data) => updateVoteCounts(data.counts || {}));
socket.on("vote_ack", (data) => toast(data.msg || "تم تسجيل التصويت"));
socket.on("game_over", (data) => {
  setPhase("results", data);
  showModal("انتهت الجولة", data.label || "تم حسم الجولة الحالية.");
});

socket.on("game_reset", () => {
  STATE.myRole = null;
  STATE.round = 0;
  setPhase("waiting", {});
  renderRoleBadge();
  toast("تمت إعادة الجولة إلى اللوبي");
});

socket.on("disconnect", () => toast("انقطع الاتصال، سيتم إعادة المحاولة"));
socket.on("reconnect", () => {
  toast("تمت إعادة الاتصال");
  socket.emit("join", { room: TOKEN, username: USERNAME, avatar: CHAR_ID, avatarType: AVATAR_TYPE, customImg: CUSTOM });
});

socket.on("webrtc_offer", async (data) => {
  const pc = getOrCreatePeer(data.from);
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("webrtc_answer", { room: TOKEN, target: data.from, sdp: pc.localDescription });
  } catch (err) { console.warn(err); }
});

socket.on("webrtc_answer", async (data) => {
  const pc = peers[data.from];
  if (!pc) return;
  try { await pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); } catch (err) { console.warn(err); }
});

socket.on("webrtc_ice", async (data) => {
  const pc = peers[data.from];
  if (!pc || !data.candidate) return;
  try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (err) {}
});

function resumeAudio() {
  if (STATE.audioCtx && STATE.audioCtx.state === "suspended") STATE.audioCtx.resume().catch(() => {});
  Object.values(remoteAudios).forEach((audio) => audio.play().catch(() => {}));
}

document.addEventListener("DOMContentLoaded", () => {
  renderTop();
  renderWaitingPanel();
  toggleMicUI();
  $("chatMessages").innerHTML = '<div class="system-msg"><small>نظام الغرفة</small>هذه بداية المحادثة داخل الغرفة.</div>';

  $("copyCodeBtn").addEventListener("click", copyCode);
  $("copyCodeInline").addEventListener("click", copyCode);
  $("openChatBtn").addEventListener("click", openChat);
  $("bottomChatBtn").addEventListener("click", openChat);
  $("openInfoBtn").addEventListener("click", openInfo);
  $("bottomInfoBtn").addEventListener("click", openInfo);
  $("closeChatBtn").addEventListener("click", closeDrawers);
  $("closeInfoBtn").addEventListener("click", closeDrawers);
  $("drawerBackdrop").addEventListener("click", closeDrawers);
  $("modalBackdrop").addEventListener("click", () => { closeModal(); closeDrawers(); });
  $("closeModalBtn").addEventListener("click", closeModal);
  $("modalOkBtn").addEventListener("click", closeModal);
  $("toggleMicBtn").addEventListener("click", toggleMic);
  $("leaveBtn").addEventListener("click", () => { if (confirm("هل تريد مغادرة الغرفة؟")) location.href = "/"; });
  $("startGameBtn").addEventListener("click", beginStartGame);
  $("startVoteBtn").addEventListener("click", beginStartVote);
  $("forceNightBtn").addEventListener("click", beginForceNight);
  $("resetGameBtn").addEventListener("click", beginResetGame);
  $("sendBtn").addEventListener("click", sendMessage);
  $("confirmNightBtn").addEventListener("click", submitNightTarget);
  $("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } });
  document.addEventListener("click", resumeAudio);
  document.addEventListener("touchstart", resumeAudio, { passive: true });
});
