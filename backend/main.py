from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional, Dict, List, Any
import uvicorn
import time
import os
import json
import hashlib
from haversine import haversine, Unit
from nacl.signing import SigningKey
from nacl.encoding import HexEncoder
import requests
import random

app = FastAPI()

PACKAGE_ID = "0xeecad5c95376a7c48a4c527901e78696008ff15b388797601468da7938dd47a3"
GAME_CONFIG_ID = "0x069b6b5d7aec5dbb7e6dce9f0358876eca0ccb5568194ba623ad3f55fc704ad5"
PROBLEM_BANK_DIR = "probelmBank"
PROBLEM_BANK_INDEX_FILE = "questions.json"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

games: Dict[str, dict] = {}
problem_bank: List[dict] = []

base_dir = os.path.dirname(os.path.abspath(__file__))
problem_bank_dir = os.path.join(base_dir, PROBLEM_BANK_DIR)
problem_bank_file_path = os.path.join(problem_bank_dir, PROBLEM_BANK_INDEX_FILE)
signing_key_path = os.path.join(base_dir, "oracle.key")
key_file_path = os.path.join(base_dir, "key.txt")
history_file_path = os.path.join(base_dir, "leaderboard_history.json")


def _to_problem_bank_asset_url(image_url: str) -> str:
    normalized = image_url.strip()
    if normalized.startswith("http://") or normalized.startswith("https://"):
        return normalized
    if normalized.startswith("/problemBank/"):
        return normalized
    if normalized.startswith("/"):
        return f"/problemBank{normalized}"
    return f"/problemBank/{normalized}"


def _normalize_problem(raw_problem: Any) -> Optional[dict]:
    if not isinstance(raw_problem, dict):
        return None

    image_url = raw_problem.get("image_url")
    if not isinstance(image_url, str) or image_url.strip() == "":
        return None

    lat = raw_problem.get("lat")
    lon_value = raw_problem.get("lon", raw_problem.get("lng"))
    if lat is None or lon_value is None:
        return None
    try:
        normalized_lat = float(lat)
        normalized_lon = float(lon_value)
    except Exception:
        return None

    hint = raw_problem.get("hint")
    difficulty = raw_problem.get("difficulty")
    return {
        "id": raw_problem.get("id"),
        "image_url": _to_problem_bank_asset_url(image_url),
        "lat": normalized_lat,
        "lon": normalized_lon,
        "hint": hint if isinstance(hint, str) and hint.strip() else None,
        "difficulty": difficulty if isinstance(difficulty, str) and difficulty.strip() else None,
    }


def _load_problem_bank() -> None:
    global problem_bank
    if not os.path.exists(problem_bank_file_path):
        print(f"Problem bank file not found: {problem_bank_file_path}")
        problem_bank = []
        return

    try:
        with open(problem_bank_file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception as err:
        print(f"Failed to read problem bank file: {err}")
        problem_bank = []
        return

    if not isinstance(payload, list):
        print("Problem bank payload must be a list")
        problem_bank = []
        return

    normalized_bank = []
    for raw_problem in payload:
        normalized_problem = _normalize_problem(raw_problem)
        if normalized_problem is not None:
            normalized_bank.append(normalized_problem)

    problem_bank = normalized_bank
    print(f"Loaded {len(problem_bank)} problems from {PROBLEM_BANK_DIR}/{PROBLEM_BANK_INDEX_FILE}")


def _hex_to_fixed_32_bytes(hex_value: str) -> bytes:
    normalized = hex_value.lower().replace("0x", "")
    if len(normalized) > 64:
        raise ValueError("hex value longer than 32 bytes")
    return bytes.fromhex(normalized.rjust(64, "0"))

walrus_publisher_url = os.getenv("WALRUS_PUBLISHER_URL", "").rstrip("/")
walrus_epochs = max(1, int(os.getenv("WALRUS_EPOCHS", "5")))
walrus_upload_timeout = float(os.getenv("WALRUS_UPLOAD_TIMEOUT", "20"))
walrus_require_success = os.getenv("WALRUS_REQUIRE_SUCCESS", "false").strip().lower() in {"1", "true", "yes", "on"}

if os.path.isdir(problem_bank_dir):
    app.mount("/problemBank", StaticFiles(directory=problem_bank_dir), name="problemBank")

_load_problem_bank()


def _load_settlement_history() -> List[dict]:
    if not os.path.exists(history_file_path):
        return []

    try:
        with open(history_file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        if isinstance(payload, list):
            return [entry for entry in payload if isinstance(entry, dict)]
        return []
    except Exception as err:
        print(f"Failed to load history file: {err}")
        return []


def _save_settlement_history(history: List[dict]) -> None:
    try:
        with open(history_file_path, "w", encoding="utf-8") as f:
            json.dump(history, f, ensure_ascii=True, indent=2)
    except Exception as err:
        print(f"Failed to save history file: {err}")


settlement_history: List[dict] = _load_settlement_history()

if os.path.exists(signing_key_path):
    with open(signing_key_path, "rb") as f:
        key_bytes = f.read()
        signing_key = SigningKey(key_bytes)
    print("Loaded existing signing key.")
else:
    signing_key = SigningKey.generate()
    with open(signing_key_path, "wb") as f:
        f.write(signing_key.encode())
    print("Generated and saved new signing key.")

verify_key = signing_key.verify_key
public_key_hex = verify_key.encode(encoder=HexEncoder).decode('utf-8')
public_key_bytes = list(verify_key.encode())

print(f"ORACLE PUBLIC KEY (Hex): {public_key_hex}")
print(f"ORACLE PUBLIC KEY (Bytes): {public_key_bytes}")

with open(key_file_path, "w") as f:
    f.write(f"{public_key_hex}\n")
    f.write(f"{','.join(map(str, public_key_bytes))}")

class CreateRoomRequest(BaseModel):
    game_id: str
    player_a: str
    stake_amount_mist: str

class JoinRoomRequest(BaseModel):
    game_id: str
    player_b: str

class GuessRequest(BaseModel):
    game_id: str
    player_address: str
    lat: float
    lon: float

class CancelRoomRequest(BaseModel):
    game_id: str
    player_address: str

class RefundRoomRequest(BaseModel):
    game_id: str

class GameStatus(BaseModel):
    game_id: str
    status: str
    player_a: Optional[str] = None
    player_b: Optional[str] = None
    winner: Optional[str] = None
    signature: Optional[List[int]] = None
    walrus_blob_id: Optional[str] = None
    walrus_blob_id_bytes: Optional[List[int]] = None
    amount: int = 0
    start_time: float
    target_image: Optional[str] = None
    target_hint: Optional[str] = None
    guesses: Dict[str, tuple] = {}


def _to_mist_int(value: Any) -> int:
    try:
        mist_value = int(value)
        return mist_value if mist_value > 0 else 0
    except Exception:
        return 0


def _extract_blob_id(payload: Any) -> Optional[str]:
    if isinstance(payload, str):
        normalized = payload.strip()
        return normalized if normalized else None

    if isinstance(payload, dict):
        for key in ("blob_id", "blobId", "id"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        for key in (
            "newlyCreated",
            "alreadyCertified",
            "blobObject",
            "blob",
            "result",
            "data",
            "storage",
        ):
            nested = payload.get(key)
            found = _extract_blob_id(nested)
            if found:
                return found

    if isinstance(payload, list):
        for item in payload:
            found = _extract_blob_id(item)
            if found:
                return found

    return None


def _upload_snapshot_to_walrus(snapshot: dict) -> dict:
    snapshot_bytes = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    local_blob_id = f"sha256:{hashlib.sha256(snapshot_bytes).hexdigest()}"

    if not walrus_publisher_url:
        return {
            "blob_id": local_blob_id,
            "stored_on_walrus": False,
            "source": "local-fallback",
        }

    upload_urls = [
        f"{walrus_publisher_url}/v1/blobs?epochs={walrus_epochs}",
        f"{walrus_publisher_url}/v1/store?epochs={walrus_epochs}",
        f"{walrus_publisher_url}/v1/blobs",
    ]

    errors: List[str] = []
    for upload_url in upload_urls:
        try:
            response = requests.put(
                upload_url,
                data=snapshot_bytes,
                headers={"Content-Type": "application/octet-stream"},
                timeout=walrus_upload_timeout,
            )
            if response.status_code < 200 or response.status_code >= 300:
                errors.append(f"{upload_url} -> HTTP {response.status_code}")
                continue

            try:
                payload = response.json()
            except Exception:
                payload = response.text

            blob_id = _extract_blob_id(payload)
            if blob_id:
                return {
                    "blob_id": blob_id,
                    "stored_on_walrus": True,
                    "source": upload_url,
                }

            errors.append(f"{upload_url} -> missing blob id in response")
        except Exception as err:
            errors.append(f"{upload_url} -> {err}")

    if walrus_require_success:
        raise RuntimeError("Walrus upload failed: " + " | ".join(errors))

    print("Walrus upload failed, falling back to local content ID:", " | ".join(errors))
    return {
        "blob_id": local_blob_id,
        "stored_on_walrus": False,
        "source": "local-fallback-after-error",
    }


def _record_settlement(game: dict, winner: str, loser: str) -> None:
    stake_amount_mist = _to_mist_int(game.get("stake_amount_mist", "0"))
    if stake_amount_mist <= 0:
        return

    entry = {
        "game_id": game["id"],
        "winner": winner,
        "loser": loser,
        "stake_amount_mist": str(stake_amount_mist),
        "payout_mist": str(stake_amount_mist * 2),
        "net_win_mist": str(stake_amount_mist),
        "settled_at": time.time(),
        "walrus_blob_id": game.get("walrus_blob_id"),
        "stored_on_walrus": bool(game.get("stored_on_walrus", False)),
    }
    settlement_history.append(entry)
    _save_settlement_history(settlement_history)

@app.get("/")
def read_root():
    return {
        "status": "ok",
        "oracle_pub_key": public_key_hex,
        "oracle_pub_key_bytes": public_key_bytes,
        "package_id": PACKAGE_ID,
        "game_config_id": GAME_CONFIG_ID,
        "walrus": {
            "publisher_url": walrus_publisher_url,
            "epochs": walrus_epochs,
            "require_success": walrus_require_success,
        },
    }

@app.post("/create_room")
def create_room(req: CreateRoomRequest):
    if req.game_id in games:
        raise HTTPException(status_code=400, detail="Game ID already exists")

    try:
        stake_amount_mist = int(req.stake_amount_mist)
    except ValueError as err:
        raise HTTPException(status_code=400, detail="Invalid stake amount") from err

    if stake_amount_mist <= 0:
        raise HTTPException(status_code=400, detail="Stake amount must be greater than zero")

    selected_problem = {
        "id": "default",
        "lat": 48.8566,
        "lon": 2.3522,
        "image_url": None,
        "hint": "Find Paris",
        "difficulty": "Easy",
    }
    if problem_bank:
        selected_problem = random.choice(problem_bank)
    
    games[req.game_id] = {
        "id": req.game_id,
        "package_id": PACKAGE_ID,
        "player_a": req.player_a,
        "stake_amount_mist": str(stake_amount_mist),
        "player_b": None,
        "status": "waiting",
        "guesses": {},
        "target": {"lat": selected_problem["lat"], "lon": selected_problem["lon"]},
        "target_problem_id": selected_problem.get("id"),
        "target_image": selected_problem.get("image_url"),
        "target_hint": selected_problem.get("hint"),
        "target_difficulty": selected_problem.get("difficulty"),
        "start_time": time.time(),
        "winner": None,
        "signature": None,
        "walrus_blob_id": None,
        "walrus_blob_id_bytes": [],
        "stored_on_walrus": False,
        "walrus_source": None,
    }
    return {"status": "created", "game_id": req.game_id}

@app.get("/rooms")
def list_rooms():
    waiting_rooms = [
        {
            "game_id": g["id"],
            "player_a": g["player_a"],
            "stake_amount_mist": g.get("stake_amount_mist", "0")
        }
        for g in games.values() 
        if g["status"] == "waiting" and g.get("package_id") == PACKAGE_ID
    ]
    return waiting_rooms


@app.get("/history")
def get_history(limit: int = 50):
    bounded_limit = max(1, min(limit, 200))
    sorted_history = sorted(
        settlement_history,
        key=lambda entry: float(entry.get("settled_at", 0.0)),
        reverse=True,
    )
    return {
        "total_records": len(sorted_history),
        "records": sorted_history[:bounded_limit],
    }


@app.get("/leaderboard")
def get_leaderboard(limit: int = 50):
    bounded_limit = max(1, min(limit, 200))
    aggregates: Dict[str, dict] = {}

    for record in settlement_history:
        winner = record.get("winner")
        if not isinstance(winner, str) or winner == "":
            continue

        wins = aggregates.setdefault(
            winner,
            {
                "player": winner,
                "wins": 0,
                "total_earned_mist": 0,
                "total_payout_mist": 0,
            },
        )
        wins["wins"] += 1
        wins["total_earned_mist"] += _to_mist_int(record.get("net_win_mist", "0"))
        wins["total_payout_mist"] += _to_mist_int(record.get("payout_mist", "0"))

    ranking = sorted(
        aggregates.values(),
        key=lambda row: (row["total_earned_mist"], row["wins"], row["total_payout_mist"]),
        reverse=True,
    )[:bounded_limit]

    response_rows = [
        {
            "rank": index + 1,
            "player": row["player"],
            "wins": row["wins"],
            "total_earned_mist": str(row["total_earned_mist"]),
            "total_payout_mist": str(row["total_payout_mist"]),
        }
        for index, row in enumerate(ranking)
    ]

    return {
        "total_players": len(aggregates),
        "total_records": len(settlement_history),
        "ranking": response_rows,
    }

@app.post("/join_room")
def join_room(req: JoinRoomRequest):
    if req.game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")
    
    game = games[req.game_id]
    if game["status"] != "waiting":
        raise HTTPException(status_code=400, detail="Game not available")

    if game.get("package_id") != PACKAGE_ID:
        raise HTTPException(status_code=400, detail="Room belongs to an older deployment. Refresh rooms and try another one.")
        
    game["player_b"] = req.player_b
    game["status"] = "active"
    game["start_time"] = time.time()
    
    return {"status": "joined", "game_id": req.game_id}

@app.post("/cancel_room")
def cancel_room(req: CancelRoomRequest):
    if req.game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = games[req.game_id]
    if game["status"] != "waiting":
        raise HTTPException(status_code=400, detail="Only waiting game can be cancelled")

    if game["player_a"] != req.player_address:
        raise HTTPException(status_code=403, detail="Only creator can cancel waiting game")

    del games[req.game_id]
    return {"status": "cancelled", "game_id": req.game_id}

@app.post("/refund_room")
def refund_room(req: RefundRoomRequest):
    if req.game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = games[req.game_id]
    if game["status"] != "active":
        raise HTTPException(status_code=400, detail="Only active game can be refunded")

    del games[req.game_id]
    return {"status": "refunded", "game_id": req.game_id}

@app.get("/game/{game_id}")
def get_game(game_id: str):
    if game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")

    game = games[game_id]
    return {
        "id": game["id"],
        "package_id": game.get("package_id"),
        "player_a": game.get("player_a"),
        "stake_amount_mist": game.get("stake_amount_mist", "0"),
        "player_b": game.get("player_b"),
        "status": game.get("status"),
        "guesses": game.get("guesses", {}),
        "start_time": game.get("start_time"),
        "winner": game.get("winner"),
        "signature": game.get("signature"),
        "walrus_blob_id": game.get("walrus_blob_id"),
        "walrus_blob_id_bytes": game.get("walrus_blob_id_bytes", []),
        "stored_on_walrus": game.get("stored_on_walrus", False),
        "walrus_source": game.get("walrus_source"),
        "distances": game.get("distances", {}),
        "target_image": game.get("target_image"),
        "target_hint": game.get("target_hint"),
        "target_difficulty": game.get("target_difficulty"),
        "target_problem_id": game.get("target_problem_id"),
    }

@app.post("/submit")
def submit_guess(req: GuessRequest):
    game_id = req.game_id
    if game_id not in games:
        raise HTTPException(status_code=404, detail="Game not found")
    
    game = games[game_id]
    if game["status"] != "active":
        raise HTTPException(status_code=400, detail="Game not active")
        
    game["guesses"][req.player_address] = (req.lat, req.lon)
    
    if len(game["guesses"]) == 2:
        _settle_game(game)
        
    return {"status": "submitted"}

def _settle_game(game):
    target = (game["target"]["lat"], game["target"]["lon"])
    
    pa = game["player_a"]
    pb = game["player_b"]
    
    if pa not in game["guesses"] or pb not in game["guesses"]:
        return

    pa_guess = game["guesses"][pa]
    pb_guess = game["guesses"][pb]
    
    dist_a = haversine(pa_guess, target, unit=Unit.METERS)
    dist_b = haversine(pb_guess, target, unit=Unit.METERS)
    
    winner = pa if dist_a < dist_b else pb
    loser = pb if winner == pa else pa

    settled_at = time.time()
    snapshot = {
        "game_id": game["id"],
        "package_id": game.get("package_id"),
        "target": game["target"],
        "player_a": pa,
        "player_b": pb,
        "winner": winner,
        "loser": loser,
        "stake_amount_mist": game.get("stake_amount_mist", "0"),
        "guesses": {
            pa: {"lat": pa_guess[0], "lon": pa_guess[1]},
            pb: {"lat": pb_guess[0], "lon": pb_guess[1]},
        },
        "distances_meters": {
            pa: dist_a,
            pb: dist_b,
        },
        "settled_at": settled_at,
    }

    walrus_result = _upload_snapshot_to_walrus(snapshot)
    walrus_blob_id = walrus_result["blob_id"]
    walrus_blob_id_bytes = walrus_blob_id.encode("utf-8")
    
    game["winner"] = winner
    game["status"] = "settled"
    game["distances"] = {pa: dist_a, pb: dist_b}
    game["walrus_blob_id"] = walrus_blob_id
    game["walrus_blob_id_bytes"] = list(walrus_blob_id_bytes)
    game["stored_on_walrus"] = bool(walrus_result.get("stored_on_walrus", False))
    game["walrus_source"] = walrus_result.get("source")
    _record_settlement(game, winner, loser)
    
    try:
        gid_bytes = _hex_to_fixed_32_bytes(game["id"])
        win_bytes = _hex_to_fixed_32_bytes(winner)
        
        message = gid_bytes + win_bytes + walrus_blob_id_bytes
        signed = signing_key.sign(message)
        game["signature"] = list(signed.signature)
        
    except Exception as e:
        print(f"Signing failed: {e}")
        game["signature"] = None

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
