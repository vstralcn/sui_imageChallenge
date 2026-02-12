# SuiDrift: On-Chain Geo-Duel

A 1v1 geographical guessing game built on **Sui** (Move 2024), **FastAPI**, and **React**. Players stake SUI, guess locations on a map, and the winner takes the pot (minus gas).

## Key Features

### 🎮 Gameplay Flow
- **Variable Stakes**: Create rooms with any SUI amount (e.g., 0.5 SUI, 10 SUI). Opponents must match the stake to join.
- **Fair Escrow**: Funds are locked in a shared Move object (`Game`) upon creation/joining. Neither the backend nor the admin can seize funds.
- **Oracle Settlement + Snapshot Binding**: Backend calculates the winner and signs `(game_id || winner || walrus_blob_id_bytes)`. The contract verifies this signature before payout.
- **Timeout Protection**: If an opponent joins but ghosts the game, a "Refund Timeout" (5 min) feature allows players to retrieve their stake.
- **Cancellation**: Creators can cancel waiting rooms instantly to get a full refund.
- **PTB One-Click Replay**: Winners can use "Claim & Play Again" to atomically settle and create the next room in one transaction.

### 🎨 Enhanced UI/UX
- **Interactive Map**: Draggable marker for precise guessing before confirmation.
- **Mobile-First Design**: Responsive "Bottom Drawer" layout for mobile devices, maximizing map visibility.
- **Victory Cards**: Shareable, receipt-style settlement cards showing earnings and distance.
- **One-Click Share**: Copy victory text to clipboard for social sharing.
- **Visual Urgency**: 5-minute countdown timer with red pulse animation in the final 30 seconds.
- **Bilingual UI**: Global language switcher (English/中文) in the top-right header.

### 🏆 Leaderboard & History
- **Cumulative Rankings**: Tracks net SUI earnings across all games per address.
- **Walrus-Backed Snapshots**: On settlement, backend uploads match snapshot metadata to Walrus and stores returned `walrus_blob_id` with the game/signature flow.
- **Settlement History**: Recent matches include Walrus blob linkage for traceability.
- **Live Updates**: Leaderboard refreshes automatically in the lobby.

---

## Deployed Contracts (Testnet)
- **Package ID**: `0xeecad5c95376a7c48a4c527901e78696008ff15b388797601468da7938dd47a3`
- **GameConfig ID**: `0x069b6b5d7aec5dbb7e6dce9f0358876eca0ccb5568194ba623ad3f55fc704ad5`

---

## Setup & Run

### 1. Backend
```bash
cd backend
# Install dependencies (fastapi, uvicorn, pydantic, haversine, pynacl, requests)
pip install -r requirements.txt

# Optional: Walrus storage config
export WALRUS_PUBLISHER_URL="https://<your-walrus-publisher>"
export WALRUS_EPOCHS=5
export WALRUS_UPLOAD_TIMEOUT=20
export WALRUS_REQUIRE_SUCCESS=false

python3 main.py
```
Backend runs on `http://localhost:8000`.
*Note: Ensure `oracle.key` matches the on-chain `GameConfig` public key. If not, use the "Sync Oracle Key" button in the UI (requires AdminCap).*

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend runs on `http://localhost:5173`.

### 3. How to Play
1.  **Connect Wallet**: Use a Sui Wallet on **Testnet**.
2.  **Create Room**: Enter a stake amount (e.g., 1.5) and click "Create Game".
3.  **Join Room**: Find an open room in the lobby and match the required stake.
4.  **Guess Location**:
    - You have 5 minutes.
    - Tap the map to place a marker.
    - Drag to refine your guess.
    - Click **"Confirm & Submit"** to lock it in.
5.  **Settle**:
    - Once both players submit, the winner is revealed.
    - Winner clicks **"Claim Reward"** to execute the on-chain payout.
