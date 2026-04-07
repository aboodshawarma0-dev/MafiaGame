import logging
import os
import random
import string
import time
from copy import deepcopy

from flask import Flask, jsonify, render_template, request
from flask_socketio import SocketIO, emit, join_room

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("omerta")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "omerta_v4_secret")
app.config["MAX_CONTENT_LENGTH"] = 4 * 1024 * 1024

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    async_mode="gevent",
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=4 * 1024 * 1024,
    allow_upgrades=True,
)

MAX_PLAYERS = 12
MIN_PLAYERS = 4
ROOM_HISTORY_SECONDS = 24 * 60 * 60
SEAT_COUNT = 12
WAIT_SECONDS = 30
ROLE_REVEAL_SECONDS = 30
MAFIA_SECONDS = 20
DOCTOR_SECONDS = 15
DETECTIVE_SECONDS = 15
VOTING_SECONDS = 20

ROLES = {
    "mafia": {"label": "المافيا", "color": "#ff5a6c", "icon": "🗡️"},
    "citizen": {"label": "المواطن", "color": "#4de2c5", "icon": "🛡️"},
    "doctor": {"label": "الطبيب", "color": "#6fb8ff", "icon": "🩺"},
    "detective": {"label": "الكاشف", "color": "#ffd166", "icon": "🕵️"},
}

PHASE_META = {
    "waiting": {"label": "اللوبي", "kind": "public"},
    "role_reveal": {"label": "توزيع الأدوار", "kind": "silent"},
    "mafia": {"label": "استيقاظ المافيا", "kind": "mafia"},
    "doctor": {"label": "استيقاظ الطبيب", "kind": "doctor"},
    "detective": {"label": "استيقاظ الكاشف", "kind": "detective"},
    "day": {"label": "النهار", "kind": "public"},
    "voting": {"label": "التصويت", "kind": "public"},
    "results": {"label": "النتائج", "kind": "public"},
}

rooms = {}


def now_ts() -> float:
    return time.time()


def make_token() -> str:
    chars = string.ascii_uppercase + string.digits
    while True:
        token = "".join(random.choices(chars, k=8))
        if token not in rooms:
            return token



def new_room(name: str = "") -> dict:
    token = name or ""
    return {
        "room_name": name or token,
        "created_at": now_ts(),
        "players": {},
        "host": None,
        "started": False,
        "game_phase": "waiting",
        "game_round": 0,
        "phase_deadline": None,
        "game_id": 0,
        "last_announcement": "",
        "night_actions": {
            "mafia_votes": {},
            "doctor_target": None,
            "detective_target": None,
        },
        "votes": {},
    }



def cleanup_rooms() -> None:
    cutoff = now_ts() - ROOM_HISTORY_SECONDS
    for token, room in list(rooms.items()):
        if room["players"]:
            continue
        if room["created_at"] < cutoff:
            rooms.pop(token, None)



def used_names(token: str) -> set[str]:
    room = rooms.get(token)
    if not room:
        return set()
    return {p["username"].lower() for p in room["players"].values()}



def next_available_name(token: str, base: str) -> str:
    existing = used_names(token)
    if base.lower() not in existing:
        return base
    index = 1
    while True:
        candidate = f"{base} {index}"
        if candidate.lower() not in existing:
            return candidate
        index += 1



def available_seats(room: dict) -> list[int]:
    taken = {p.get("seat") for p in room["players"].values()}
    return [i for i in range(SEAT_COUNT) if i not in taken]



def assign_seat(room: dict) -> int:
    seats = available_seats(room)
    if not seats:
        return -1
    return random.choice(seats)



def role_payload(role_key: str) -> dict:
    meta = ROLES.get(role_key, ROLES["citizen"])
    return {"role": role_key, **meta}



def public_room_payload(token: str, room: dict) -> dict:
    return {
        "token": token,
        "room_name": room["room_name"],
        "players": len(room["players"]),
        "started": room["started"],
        "phase": room["game_phase"],
        "capacity": MAX_PLAYERS,
        "created_at": int(room["created_at"]),
    }



def list_recent_rooms() -> list[dict]:
    cutoff = now_ts() - ROOM_HISTORY_SECONDS
    items = []
    for token, room in rooms.items():
        if room["created_at"] >= cutoff:
            items.append(public_room_payload(token, room))
    items.sort(key=lambda r: (r["players"] == 0, -r["created_at"], r["room_name"]))
    return items



def players_payload(token: str) -> list[dict]:
    room = rooms.get(token)
    if not room:
        return []
    phase = room["game_phase"]
    players = []
    for sid, player in room["players"].items():
        players.append(
            {
                "sid": sid,
                "username": player["username"],
                "avatar": player["avatar"],
                "avatarType": player.get("avatarType", "builtin"),
                "customImg": player.get("customImg", ""),
                "mic": player.get("mic", False),
                "speaking": player.get("speaking", False),
                "alive": player.get("alive", True),
                "seat": player.get("seat", -1),
                "is_host": sid == room["host"],
                "role": player.get("role") if phase == "results" else None,
            }
        )
    return players



def alive_sids(room: dict) -> list[str]:
    return [sid for sid, player in room["players"].items() if player.get("alive", True)]



def living_players(room: dict) -> list[tuple[str, dict]]:
    return [(sid, p) for sid, p in room["players"].items() if p.get("alive", True)]



def broadcast(token: str, event: str, data: dict) -> None:
    socketio.emit(event, data, room=token)



def sync_players(token: str) -> None:
    room = rooms.get(token)
    if not room:
        return
    broadcast(
        token,
        "update_players",
        {
            "players": players_payload(token),
            "count": len(room["players"]),
            "max_players": MAX_PLAYERS,
        },
    )
    emit_audio_policy(token)



def system_message(token: str, text: str) -> None:
    broadcast(token, "new_message", {"type": "system", "msg": text})



def assign_roles(token: str) -> None:
    room = rooms.get(token)
    if not room:
        return
    living = list(room["players"].keys())
    random.shuffle(living)
    n = len(living)
    mafia_count = 1 if n < 6 else 2 if n < 10 else 3
    doctor_count = 1 if n >= 5 else 0
    detective_count = 1 if n >= 6 else 0
    citizen_count = max(0, n - mafia_count - doctor_count - detective_count)
    deck = (
        ["mafia"] * mafia_count
        + ["doctor"] * doctor_count
        + ["detective"] * detective_count
        + ["citizen"] * citizen_count
    )
    random.shuffle(deck)
    for sid, role in zip(living, deck):
        room["players"][sid]["role"] = role
        room["players"][sid]["alive"] = True
        room["players"][sid]["speaking"] = False



def check_win(room: dict) -> str | None:
    mafia_alive = sum(1 for _, p in living_players(room) if p.get("role") == "mafia")
    others_alive = sum(1 for _, p in living_players(room) if p.get("role") != "mafia")
    if room["started"] and mafia_alive == 0:
        return "citizens"
    if room["started"] and mafia_alive >= others_alive and mafia_alive > 0:
        return "mafia"
    return None



def end_game(token: str, winner: str) -> None:
    room = rooms.get(token)
    if not room:
        return
    room["started"] = False
    room["game_phase"] = "results"
    room["phase_deadline"] = None
    room["last_announcement"] = "انتهت اللعبة"
    reveal = []
    for sid, player in room["players"].items():
        reveal.append(
            {
                "sid": sid,
                "username": player["username"],
                "avatar": player["avatar"],
                "avatarType": player.get("avatarType", "builtin"),
                "customImg": player.get("customImg", ""),
                "role": player.get("role", "citizen"),
                "alive": player.get("alive", True),
                "seat": player.get("seat", -1),
            }
        )
    broadcast(
        token,
        "game_over",
        {
            "winner": winner,
            "label": "فاز فريق المواطنين" if winner == "citizens" else "فاز فريق المافيا",
            "players": reveal,
        },
    )
    emit_audio_policy(token)
    sync_players(token)



def reset_room_state(room: dict) -> None:
    room["started"] = False
    room["game_phase"] = "waiting"
    room["game_round"] = 0
    room["phase_deadline"] = None
    room["last_announcement"] = ""
    room["night_actions"] = {
        "mafia_votes": {},
        "doctor_target": None,
        "detective_target": None,
    }
    room["votes"] = {}
    for player in room["players"].values():
        player["role"] = None
        player["alive"] = True
        player["speaking"] = False



def phase_payload(room: dict, phase: str, duration: int | None, extra: dict | None = None) -> dict:
    payload = {
        "phase": phase,
        "round": room["game_round"],
        "label": PHASE_META[phase]["label"],
        "duration": duration,
        "deadline": room["phase_deadline"],
        "announcement": room.get("last_announcement", ""),
    }
    if extra:
        payload.update(extra)
    return payload



def set_phase(token: str, phase: str, duration: int | None, extra: dict | None = None) -> None:
    room = rooms.get(token)
    if not room:
        return
    room["game_phase"] = phase
    room["phase_deadline"] = now_ts() + duration if duration else None
    broadcast(token, "phase_change", phase_payload(room, phase, duration, extra))
    emit_audio_policy(token)
    sync_players(token)
    emit_phase_private_prompts(token)



def emit_role_cards(token: str) -> None:
    room = rooms.get(token)
    if not room:
        return
    for sid, player in room["players"].items():
        role = player.get("role")
        if role:
            socketio.emit("your_role", role_payload(role), room=sid)



def current_targets(room: dict, for_role: str, viewer_sid: str | None = None) -> list[dict]:
    items = []
    for sid, player in room["players"].items():
        if not player.get("alive", True):
            continue
        if for_role == "mafia" and player.get("role") == "mafia":
            continue
        if for_role == "detective" and sid == viewer_sid:
            continue
        items.append({"sid": sid, "username": player["username"]})
    return items



def emit_phase_private_prompts(token: str) -> None:
    room = rooms.get(token)
    if not room or not room["started"]:
        return
    phase = room["game_phase"]
    if phase == "mafia":
        mafia_team = [
            {"sid": sid, "username": p["username"]}
            for sid, p in room["players"].items()
            if p.get("alive", True) and p.get("role") == "mafia"
        ]
        targets = current_targets(room, "mafia")
        for sid, player in room["players"].items():
            if player.get("alive", True) and player.get("role") == "mafia":
                socketio.emit(
                    "private_prompt",
                    {
                        "phase": "mafia",
                        "title": "استيقظت المافيا",
                        "subtitle": "اختاروا من سيموت هذه الليلة",
                        "targets": targets,
                        "team": mafia_team,
                    },
                    room=sid,
                )
    elif phase == "doctor":
        targets = current_targets(room, "doctor")
        for sid, player in room["players"].items():
            if player.get("alive", True) and player.get("role") == "doctor":
                socketio.emit(
                    "private_prompt",
                    {
                        "phase": "doctor",
                        "title": "استيقظ الطبيب",
                        "subtitle": "اختر اللاعب الذي تريد إنقاذه",
                        "targets": targets,
                    },
                    room=sid,
                )
    elif phase == "detective":
        for sid, player in room["players"].items():
            if player.get("alive", True) and player.get("role") == "detective":
                socketio.emit(
                    "private_prompt",
                    {
                        "phase": "detective",
                        "title": "استيقظ الكاشف",
                        "subtitle": "اختر لاعباً لتكشف حقيقته",
                        "targets": current_targets(room, "detective", sid),
                    },
                    room=sid,
                )



def audio_policy_for_sid(room: dict, sid: str) -> dict:
    player = room["players"].get(sid)
    if not player:
        return {"allowed_listen": [], "may_talk": False, "phase": room["game_phase"]}

    if room["game_phase"] == "waiting":
        everyone = [other_sid for other_sid in room["players"] if other_sid != sid]
        return {"allowed_listen": everyone, "may_talk": True, "phase": room["game_phase"]}

    if not player.get("alive", True):
        return {"allowed_listen": [], "may_talk": False, "phase": room["game_phase"]}

    phase = room["game_phase"]
    if phase in {"role_reveal", "doctor", "detective"}:
        return {"allowed_listen": [], "may_talk": False, "phase": phase}

    if phase == "mafia":
        mafia_alive = [
            other_sid
            for other_sid, other in room["players"].items()
            if other.get("alive", True) and other.get("role") == "mafia"
        ]
        if player.get("role") == "mafia":
            return {
                "allowed_listen": [other_sid for other_sid in mafia_alive if other_sid != sid],
                "may_talk": True,
                "phase": phase,
            }
        return {"allowed_listen": [], "may_talk": False, "phase": phase}

    if phase in {"day", "voting", "results"}:
        public = [
            other_sid
            for other_sid, other in room["players"].items()
            if other_sid != sid and (other.get("alive", True) or phase == "results")
        ]
        return {"allowed_listen": public, "may_talk": True, "phase": phase}

    return {"allowed_listen": [], "may_talk": False, "phase": phase}



def emit_audio_policy(token: str) -> None:
    room = rooms.get(token)
    if not room:
        return
    for sid in list(room["players"].keys()):
        socketio.emit("audio_policy", audio_policy_for_sid(room, sid), room=sid)



def mafia_done(room: dict) -> bool:
    mafia_alive = [sid for sid, p in room["players"].items() if p.get("alive", True) and p.get("role") == "mafia"]
    if not mafia_alive:
        return True
    if len(mafia_alive) == 1:
        return mafia_alive[0] in room["night_actions"]["mafia_votes"]
    return all(sid in room["night_actions"]["mafia_votes"] for sid in mafia_alive)



def doctor_done(room: dict) -> bool:
    doctor_alive = any(p.get("alive", True) and p.get("role") == "doctor" for p in room["players"].values())
    return (not doctor_alive) or room["night_actions"]["doctor_target"] is not None



def detective_done(room: dict) -> bool:
    detective_alive = any(p.get("alive", True) and p.get("role") == "detective" for p in room["players"].values())
    return (not detective_alive) or room["night_actions"]["detective_target"] is not None



def voting_done(room: dict) -> bool:
    alive = [sid for sid, p in room["players"].items() if p.get("alive", True)]
    return bool(alive) and all(sid in room["votes"] for sid in alive)



def wait_phase(token: str, game_id: int, seconds: int, early_check=None) -> bool:
    deadline = now_ts() + seconds
    while now_ts() < deadline:
        room = rooms.get(token)
        if not room or not room["started"] or room["game_id"] != game_id:
            return False
        if early_check and early_check(room):
            return True
        socketio.sleep(0.4)
    return True



def resolve_night(token: str) -> None:
    room = rooms.get(token)
    if not room:
        return
    votes = room["night_actions"]["mafia_votes"]
    counts = {}
    for target in votes.values():
        counts[target] = counts.get(target, 0) + 1
    victim_sid = None
    if counts:
        top = max(counts.values())
        top_targets = [sid for sid, value in counts.items() if value == top]
        victim_sid = random.choice(top_targets)

    protected_sid = room["night_actions"]["doctor_target"]
    killed_name = ""
    if victim_sid and victim_sid != protected_sid and victim_sid in room["players"]:
        room["players"][victim_sid]["alive"] = False
        room["players"][victim_sid]["speaking"] = False
        killed_name = room["players"][victim_sid]["username"]
        room["last_announcement"] = f"☠️ تم العثور على {killed_name} مقتولاً"
    else:
        room["last_announcement"] = "🌅 لم يمت أحد هذه الليلة"

    room["night_actions"] = {
        "mafia_votes": {},
        "doctor_target": None,
        "detective_target": None,
    }

    winner = check_win(room)
    if winner:
        end_game(token, winner)



def resolve_vote(token: str) -> None:
    room = rooms.get(token)
    if not room:
        return
    counts = {}
    for target in room["votes"].values():
        counts[target] = counts.get(target, 0) + 1
    eliminated_name = ""
    if counts:
        top = max(counts.values())
        top_targets = [sid for sid, value in counts.items() if value == top]
        eliminated_sid = random.choice(top_targets)
        if eliminated_sid in room["players"]:
            room["players"][eliminated_sid]["alive"] = False
            room["players"][eliminated_sid]["speaking"] = False
            role = room["players"][eliminated_sid].get("role") or "citizen"
            eliminated_name = room["players"][eliminated_sid]["username"]
            room["last_announcement"] = f"🗳️ أُقصي {eliminated_name} — {ROLES[role]['label']}"
    else:
        room["last_announcement"] = "🤝 انتهى التصويت بدون إقصاء"
    room["votes"] = {}
    winner = check_win(room)
    if winner:
        end_game(token, winner)
        return
    room["game_round"] += 1



def run_game_loop(token: str, game_id: int) -> None:
    room = rooms.get(token)
    if not room:
        return
    while True:
        room = rooms.get(token)
        if not room or not room["started"] or room["game_id"] != game_id:
            return

        room["night_actions"] = {
            "mafia_votes": {},
            "doctor_target": None,
            "detective_target": None,
        }
        room["votes"] = {}
        room["last_announcement"] = ""

        set_phase(token, "role_reveal", ROLE_REVEAL_SECONDS)
        if not wait_phase(token, game_id, ROLE_REVEAL_SECONDS):
            return

        set_phase(token, "mafia", MAFIA_SECONDS)
        if not wait_phase(token, game_id, MAFIA_SECONDS, mafia_done):
            return

        set_phase(token, "doctor", DOCTOR_SECONDS)
        if not wait_phase(token, game_id, DOCTOR_SECONDS, doctor_done):
            return

        set_phase(token, "detective", DETECTIVE_SECONDS)
        if not wait_phase(token, game_id, DETECTIVE_SECONDS, detective_done):
            return

        resolve_night(token)
        room = rooms.get(token)
        if not room or room["game_id"] != game_id or not room["started"]:
            return
        if room["game_phase"] == "results":
            return

        set_phase(token, "day", WAIT_SECONDS)
        if not wait_phase(token, game_id, WAIT_SECONDS):
            return

        candidates = [
            {"sid": sid, "username": p["username"]}
            for sid, p in room["players"].items()
            if p.get("alive", True)
        ]
        set_phase(token, "voting", VOTING_SECONDS, {"candidates": candidates})
        if not wait_phase(token, game_id, VOTING_SECONDS, voting_done):
            return

        resolve_vote(token)
        room = rooms.get(token)
        if not room or room["game_id"] != game_id:
            return
        if not room["started"] or room["game_phase"] == "results":
            return


@app.route("/")
def index() -> str:
    cleanup_rooms()
    return render_template("index.html")


@app.route("/room/<token>")
def room_page(token: str) -> str:
    cleanup_rooms()
    token = token.upper()
    if token not in rooms:
        rooms[token] = new_room(token)
    return render_template("room.html", token=token, room_name=rooms[token]["room_name"])


@app.route("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.route("/create_room", methods=["POST"])
def create_room():
    cleanup_rooms()
    data = request.get_json(silent=True) or {}
    token = make_token()
    name = (data.get("room_name") or f"غرفة {token}").strip()[:40]
    rooms[token] = new_room(name)
    return jsonify({"success": True, "room_id": token, "room_name": name})


@app.route("/room_exists/<token>")
def room_exists(token: str):
    cleanup_rooms()
    token = token.upper()
    room = rooms.get(token)
    if not room:
        return jsonify({"exists": False})
    return jsonify(
        {
            "exists": True,
            "started": room["started"],
            "room_name": room["room_name"],
            "players": len(room["players"]),
            "is_full": len(room["players"]) >= MAX_PLAYERS,
        }
    )


@app.route("/check_name", methods=["POST"])
def check_name():
    data = request.get_json(silent=True) or {}
    token = (data.get("token") or "").upper()
    username = (data.get("username") or "").strip()
    room = rooms.get(token)
    if not room:
        return jsonify({"taken": False, "suggested": username})
    taken = username.lower() in used_names(token)
    return jsonify({"taken": taken, "suggested": next_available_name(token, username) if taken else username})


@app.route("/api/stats")
def stats():
    cleanup_rooms()
    return jsonify(
        {
            "rooms": len([r for r in rooms.values() if r["players"]]),
            "players": sum(len(r["players"]) for r in rooms.values()),
        }
    )


@app.route("/api/rooms_recent")
def rooms_recent():
    cleanup_rooms()
    items = list_recent_rooms()
    return jsonify({"rooms": items})


@socketio.on("join")
def handle_join(data):
    try:
        cleanup_rooms()
        token = (data.get("room") or "").strip().upper()
        username = (data.get("username") or "ضيف").strip()[:24]
        avatar = data.get("avatar") or "char1"
        avatar_type = data.get("avatarType") or "builtin"
        custom_img = (data.get("customImg") or "").strip()
        if not token:
            return
        if token not in rooms:
            rooms[token] = new_room(token)
        room = rooms[token]

        existing_sid = next((sid for sid, p in room["players"].items() if p["username"].lower() == username.lower()), None)

        if existing_sid and existing_sid != request.sid:
            player_data = deepcopy(room["players"].pop(existing_sid))
            player_data["avatar"] = avatar
            player_data["avatarType"] = avatar_type
            player_data["customImg"] = custom_img
            room["players"][request.sid] = player_data
            if room["host"] == existing_sid:
                room["host"] = request.sid
            system_message(token, f"🔁 عاد {username} إلى الغرفة")
        elif existing_sid == request.sid:
            room["players"][request.sid]["avatar"] = avatar
            room["players"][request.sid]["avatarType"] = avatar_type
            room["players"][request.sid]["customImg"] = custom_img
        else:
            if len(room["players"]) >= MAX_PLAYERS:
                emit("error", {"msg": f"الحد الأقصى للغرفة هو {MAX_PLAYERS} لاعباً"})
                return
            if username.lower() in used_names(token):
                emit("name_taken", {"username": username, "suggested": next_available_name(token, username)})
                return
            seat = assign_seat(room)
            if seat < 0:
                emit("error", {"msg": "لا توجد أماكن متاحة في هذه الغرفة"})
                return
            room["players"][request.sid] = {
                "username": username,
                "avatar": avatar,
                "avatarType": avatar_type,
                "customImg": custom_img,
                "mic": False,
                "speaking": False,
                "alive": True,
                "role": None,
                "seat": seat,
            }
            if not room["host"]:
                room["host"] = request.sid
            system_message(token, f"👋 انضم {username} إلى الغرفة")

        join_room(token)
        emit(
            "joined_ok",
            {
                "token": token,
                "room_name": room["room_name"],
                "is_host": request.sid == room["host"],
                "my_sid": request.sid,
                "started": room["started"],
                "phase": room["game_phase"],
                "max_players": MAX_PLAYERS,
            },
        )

        if room["started"] and room["players"][request.sid].get("role"):
            emit("your_role", role_payload(room["players"][request.sid]["role"]))
            emit("phase_change", phase_payload(room, room["game_phase"], None))
            emit_phase_private_prompts(token)
        else:
            emit("phase_change", phase_payload(room, room["game_phase"], None))

        sync_players(token)
    except Exception as exc:
        log.exception("join error: %s", exc)
        emit("error", {"msg": "فشل الانضمام إلى الغرفة"})


@socketio.on("disconnect")
def handle_disconnect():
    try:
        for token, room in list(rooms.items()):
            if request.sid not in room["players"]:
                continue
            username = room["players"][request.sid]["username"]
            room["players"].pop(request.sid, None)
            if room["host"] == request.sid:
                room["host"] = next(iter(room["players"]), None)
            if not room["players"]:
                rooms.pop(token, None)
            else:
                system_message(token, f"👋 غادر {username} الغرفة")
                sync_players(token)
                winner = check_win(room)
                if winner:
                    end_game(token, winner)
            break
    except Exception as exc:
        log.exception("disconnect error: %s", exc)


@socketio.on("toggle_mic")
def handle_toggle_mic(data):
    token = (data.get("room") or "").upper()
    room = rooms.get(token)
    if not room or request.sid not in room["players"]:
        return
    room["players"][request.sid]["mic"] = bool(data.get("state", False))
    if not room["players"][request.sid]["mic"]:
        room["players"][request.sid]["speaking"] = False
    sync_players(token)


@socketio.on("speaking")
def handle_speaking(data):
    token = (data.get("room") or "").upper()
    room = rooms.get(token)
    if not room or request.sid not in room["players"]:
        return
    player = room["players"][request.sid]
    policy = audio_policy_for_sid(room, request.sid)
    active = bool(data.get("active", False)) and player.get("mic", False) and policy["may_talk"]
    if player.get("speaking") != active:
        player["speaking"] = active
        sync_players(token)


@socketio.on("chat_msg")
def handle_chat_msg(data):
    token = (data.get("room") or "").upper()
    msg = (data.get("msg") or "").strip()[:500]
    room = rooms.get(token)
    if not room or request.sid not in room["players"] or not msg:
        return
    player = room["players"][request.sid]
    if room["started"]:
        if not player.get("alive", True):
            emit("error", {"msg": "المتوفون لا يمكنهم الكتابة"})
            return
        if room["game_phase"] not in {"day", "voting", "results"}:
            emit("error", {"msg": "الدردشة متاحة فقط في الفترات العامة"})
            return
    broadcast(
        token,
        "new_message",
        {
            "type": "player",
            "user": player["username"],
            "avatar": player["avatar"],
            "avatarType": player.get("avatarType", "builtin"),
            "customImg": player.get("customImg", ""),
            "msg": msg,
        },
    )


@socketio.on("start_game")
def handle_start_game(data):
    token = (data.get("room") or "").upper()
    room = rooms.get(token)
    if not room:
        return
    if request.sid != room["host"]:
        emit("error", {"msg": "فقط الهوست يمكنه بدء اللعبة"})
        return
    if len(room["players"]) < MIN_PLAYERS:
        emit("error", {"msg": f"لا يمكن البدء: أنتم أقل من {MIN_PLAYERS} لاعبين"})
        return
    if room["started"]:
        return
    assign_roles(token)
    room["started"] = True
    room["game_id"] += 1
    room["game_round"] = 1
    room["last_announcement"] = "بدأت اللعبة"
    broadcast(token, "game_started", {"round": room["game_round"]})
    emit_role_cards(token)
    socketio.start_background_task(run_game_loop, token, room["game_id"])


@socketio.on("night_action")
def handle_night_action(data):
    token = (data.get("room") or "").upper()
    target_sid = data.get("target_sid") or ""
    room = rooms.get(token)
    if not room or request.sid not in room["players"] or not room["started"]:
        return
    if target_sid not in room["players"]:
        return
    player = room["players"][request.sid]
    if not player.get("alive", True):
        return

    phase = room["game_phase"]
    role = player.get("role")
    if phase == "mafia" and role == "mafia" and room["players"][target_sid].get("role") != "mafia":
        room["night_actions"]["mafia_votes"][request.sid] = target_sid
        emit("action_received", {"msg": "تم إرسال تصويت القتل"})
    elif phase == "doctor" and role == "doctor":
        room["night_actions"]["doctor_target"] = target_sid
        emit("action_received", {"msg": "تم اختيار اللاعب المحمي"})
    elif phase == "detective" and role == "detective" and target_sid != request.sid:
        room["night_actions"]["detective_target"] = target_sid
        target_role = room["players"][target_sid].get("role") or "citizen"
        socketio.emit(
            "detective_result",
            {
                "username": room["players"][target_sid]["username"],
                "role": target_role,
                "label": ROLES[target_role]["label"],
                "is_mafia": target_role == "mafia",
            },
            room=request.sid,
        )
        emit("action_received", {"msg": "تم كشف هوية اللاعب"})


@socketio.on("cast_vote")
def handle_cast_vote(data):
    token = (data.get("room") or "").upper()
    target_sid = data.get("target_sid") or ""
    room = rooms.get(token)
    if not room or request.sid not in room["players"] or room["game_phase"] != "voting":
        return
    if not room["players"][request.sid].get("alive", True):
        emit("error", {"msg": "المتوفون لا يصوتون"})
        return
    if target_sid not in room["players"] or not room["players"][target_sid].get("alive", True):
        emit("error", {"msg": "اختيار غير صالح"})
        return
    room["votes"][request.sid] = target_sid
    counts = {}
    for sid in room["votes"].values():
        counts[sid] = counts.get(sid, 0) + 1
    broadcast(token, "vote_update", {"counts": counts})
    emit("vote_ack", {"msg": "تم تسجيل صوتك"})


@socketio.on("reset_game")
def handle_reset_game(data):
    token = (data.get("room") or "").upper()
    room = rooms.get(token)
    if not room or request.sid != room["host"]:
        return
    room["game_id"] += 1
    reset_room_state(room)
    broadcast(token, "game_reset", {})
    sync_players(token)


@socketio.on("webrtc_offer")
def handle_webrtc_offer(data):
    target = data.get("target")
    if target:
        socketio.emit("webrtc_offer", {"from": request.sid, "sdp": data.get("sdp")}, room=target)


@socketio.on("webrtc_answer")
def handle_webrtc_answer(data):
    target = data.get("target")
    if target:
        socketio.emit("webrtc_answer", {"from": request.sid, "sdp": data.get("sdp")}, room=target)


@socketio.on("webrtc_ice")
def handle_webrtc_ice(data):
    target = data.get("target")
    if target:
        socketio.emit("webrtc_ice", {"from": request.sid, "candidate": data.get("candidate")}, room=target)


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
