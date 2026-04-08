const AVATARS = [
  { id: "unknown", label: "الغامض", src: "/static/svg/avatar-unknown.svg" },
  { id: "raven", label: "ريفن", src: "/static/svg/avatar-raven.svg" },
  { id: "medic", label: "ميديك", src: "/static/svg/avatar-medic.svg" },
  { id: "warden", label: "واردن", src: "/static/svg/avatar-warden.svg" },
  { id: "oracle", label: "أوراكل", src: "/static/svg/avatar-oracle.svg" },
  { id: "smith", label: "سميث", src: "/static/svg/avatar-smith.svg" },
  { id: "velvet", label: "فيلفت", src: "/static/svg/avatar-velvet.svg" }
];

const $ = id => document.getElementById(id);
const state = {
  selected: localStorage.getItem("omerta_char") || "unknown",
  customImg: localStorage.getItem("omerta_custom") || "",
  pendingJoin: null,
  currentTab: "create"
};

function setFeedback(message = "") {
  $("feedback").textContent = message;
}

function currentAvatarSrc() {
  if (state.customImg) return state.customImg;
  return (AVATARS.find(item => item.id === state.selected) || AVATARS[0]).src;
}

function renderPreview() {
  $("avatarPreview").innerHTML = `<img src="${currentAvatarSrc()}" alt="avatar" />`;
}

function renderGrid() {
  const grid = $("avatarGrid");
  grid.innerHTML = "";
  AVATARS.forEach(item => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `avatar-btn${!state.customImg && state.selected === item.id ? " active" : ""}`;
    btn.innerHTML = `<img src="${item.src}" alt="${item.label}" />`;
    btn.addEventListener("click", () => {
      state.selected = item.id;
      state.customImg = "";
      localStorage.removeItem("omerta_custom");
      renderGrid();
      renderPreview();
    });
    grid.appendChild(btn);
  });
}

function saveIdentity(name) {
  localStorage.setItem("omerta_user", name);
  localStorage.setItem("omerta_char", state.selected);
  if (state.customImg) {
    localStorage.setItem("omerta_avatarType", "custom");
    localStorage.setItem("omerta_custom", state.customImg);
  } else {
    localStorage.setItem("omerta_avatarType", "builtin");
    localStorage.removeItem("omerta_custom");
  }
}

function switchTab(tab) {
  state.currentTab = tab;
  $("tabCreate").classList.toggle("active", tab === "create");
  $("tabJoin").classList.toggle("active", tab === "join");
  $("paneCreate").classList.toggle("active", tab === "create");
  $("paneJoin").classList.toggle("active", tab === "join");
}

async function createRoom() {
  const name = ($("username").value || "").trim();
  if (!name) {
    setFeedback("اكتب اسمك أولاً");
    return;
  }
  setFeedback("جارٍ إنشاء الغرفة...");
  try {
    const roomName = ($("roomNameInput").value || "").trim();
    const response = await fetch("/create_room", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room_name: roomName })
    });
    const data = await response.json();
    if (!data.success) throw new Error();
    saveIdentity(name);
    location.href = `/room/${data.room_id}`;
  } catch {
    setFeedback("تعذر إنشاء الغرفة الآن");
  }
}

async function joinRoom(tokenFromCard = "") {
  const name = ($("username").value || "").trim();
  const token = (tokenFromCard || $("roomCode").value || "").trim().toUpperCase();
  if (!name) {
    setFeedback("اكتب اسمك أولاً");
    return;
  }
  if (token.length < 4) {
    setFeedback("أدخل كود غرفة صحيح");
    return;
  }
  setFeedback("جارٍ التحقق من الغرفة...");
  try {
    const roomRes = await fetch(`/room_exists/${token}`);
    const roomData = await roomRes.json();
    if (!roomData.exists) {
      setFeedback("الغرفة غير موجودة");
      return;
    }
    if (roomData.is_full) {
      setFeedback("الغرفة ممتلئة حالياً");
      return;
    }
    const nameRes = await fetch("/check_name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, username: name })
    });
    const nameData = await nameRes.json();
    if (nameData.taken) {
      state.pendingJoin = { token, suggested: nameData.suggested };
      $("suggestedName").textContent = nameData.suggested;
      $("nameModal").classList.remove("hidden");
      setFeedback("");
      return;
    }
    saveIdentity(name);
    location.href = `/room/${token}`;
  } catch {
    setFeedback("تعذر الاتصال بالسيرفر");
  }
}

function bindRoomCardButtons() {
  document.querySelectorAll("[data-room-token]").forEach(btn => {
    btn.addEventListener("click", () => joinRoom(btn.dataset.roomToken));
  });
}

async function refreshRooms() {
  try {
    const [statsRes, roomsRes] = await Promise.all([fetch("/api/stats"), fetch("/api/rooms_recent")]);
    const stats = await statsRes.json();
    const rooms = await roomsRes.json();
    $("statPlayers").textContent = stats.players || 0;
    $("statRooms").textContent = stats.rooms || 0;

    const wrap = $("recentRooms");
    wrap.innerHTML = "";
    const list = rooms.rooms || [];
    if (!list.length) {
      wrap.innerHTML = `<div class="room-empty">لا توجد غرف حديثة بعد. أنشئ أول غرفة الآن.</div>`;
      return;
    }

    list.forEach(room => {
      const card = document.createElement("article");
      card.className = "room-card";
      card.innerHTML = `
        <div class="room-head">
          <div>
            <div class="room-name">${room.room_name}</div>
            <div class="room-code">${room.token}</div>
          </div>
          <button class="primary-btn" type="button" data-room-token="${room.token}">دخول</button>
        </div>
        <div class="room-chip-row">
          <span class="room-chip"><img src="/static/svg/players.svg" alt="players" /> ${room.players}/${room.capacity}</span>
          <span class="room-chip"><img src="/static/svg/room.svg" alt="room" /> ${room.started ? "جولة جارية" : "بانتظار اللاعبين"}</span>
          <span class="room-chip"><img src="/static/svg/cards.svg" alt="cards" /> آخر 24 ساعة</span>
        </div>`;
      wrap.appendChild(card);
    });
    bindRoomCardButtons();
  } catch {
    $("recentRooms").innerHTML = `<div class="room-empty">تعذر تحميل الغرف الآن.</div>`;
  }
}

function closeNameModal() {
  $("nameModal").classList.add("hidden");
}

function useSuggestedName() {
  if (!state.pendingJoin) return;
  $("username").value = state.pendingJoin.suggested;
  saveIdentity(state.pendingJoin.suggested);
  location.href = `/room/${state.pendingJoin.token}`;
}

function handleUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    setFeedback("الصورة أكبر من 2MB");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.customImg = reader.result;
    renderPreview();
    renderGrid();
  };
  reader.readAsDataURL(file);
}

document.addEventListener("DOMContentLoaded", () => {
  const storedName = localStorage.getItem("omerta_user");
  if (storedName) $("username").value = storedName;
  renderGrid();
  renderPreview();
  refreshRooms();
  setInterval(refreshRooms, 8000);

  $("tabCreate").addEventListener("click", () => switchTab("create"));
  $("tabJoin").addEventListener("click", () => switchTab("join"));
  $("createRoomBtn").addEventListener("click", createRoom);
  $("joinRoomBtn").addEventListener("click", () => joinRoom());
  $("roomCode").addEventListener("input", event => {
    event.target.value = event.target.value.toUpperCase();
  });
  $("imgUpload").addEventListener("change", handleUpload);
  $("refreshRoomsBtn").addEventListener("click", refreshRooms);
  $("closeNameModal").addEventListener("click", closeNameModal);
  $("cancelSuggestedBtn").addEventListener("click", closeNameModal);
  $("useSuggestedBtn").addEventListener("click", useSuggestedName);
});
