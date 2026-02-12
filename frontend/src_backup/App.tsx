import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit';
import { useState, useEffect } from 'react';
import { Transaction } from '@mysten/sui/transactions';
import axios from 'axios';
import { PACKAGE_ID, GAME_CONFIG_ID, BACKEND_URL, MODULE_NAME, CLOCK_OBJECT_ID } from './constants';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import L from 'leaflet';

// Fix Leaflet marker icon
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const MIST_PER_SUI = 1_000_000_000n;

type Room = {
  game_id: string;
  player_a: string;
  stake_amount_mist?: string;
};

type LeaderboardEntry = {
  rank: number;
  player: string;
  wins: number;
  total_earned_mist: string;
  total_payout_mist: string;
};

function App() {
  const account = useCurrentAccount();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();

  const [gameState, setGameState] = useState<'lobby' | 'playing' | 'settled'>('lobby');
  const [gameId, setGameId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [myGuess, setMyGuess] = useState<{ lat: number; lon: number } | null>(null);
  const [result, setResult] = useState<any>(null);
  const [polling, setPolling] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<'create' | 'join' | 'claim' | 'sync' | 'cancel' | 'refund' | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [oracleKeyMismatch, setOracleKeyMismatch] = useState(false);
  const [stakeInputSui, setStakeInputSui] = useState('1');
  const [currentStakeMist, setCurrentStakeMist] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardMeta, setLeaderboardMeta] = useState<{ totalPlayers: number; totalRecords: number }>({
    totalPlayers: 0,
    totalRecords: 0,
  });
  
  // UI Polish States
  const [tempGuess, setTempGuess] = useState<{ lat: number; lon: number } | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(300); // 5 minutes default

  const isTxSuccess = (
    txBlock:
      | {
          effects?: {
            status?:
              | {
                  status?: string;
                }
              | string
              | null;
            created?: Array<{
              reference?: {
                objectId?: string;
              };
              owner?: unknown;
            }> | null;
          } | null;
        }
      | null
      | undefined,
  ) => {
    const rawStatus =
      typeof txBlock?.effects?.status === 'string'
        ? txBlock.effects.status
        : txBlock?.effects?.status?.status;
    return typeof rawStatus === 'string' && rawStatus.toLowerCase() === 'success';
  };

  const shortId = (id: string) => `${id.slice(0, 8)}...${id.slice(-4)}`;
  const shortAddress = (address: string) => `${address.slice(0, 6)}...${address.slice(-4)}`;

  const formatMistToSui = (mist: string | number | bigint) => {
    const mistValue = typeof mist === 'bigint' ? mist : BigInt(mist);
    const whole = mistValue / MIST_PER_SUI;
    const fractional = (mistValue % MIST_PER_SUI).toString().padStart(9, '0').replace(/0+$/, '');
    return fractional.length > 0 ? `${whole.toString()}.${fractional}` : whole.toString();
  };

  const parseStakeInputToMist = (raw: string): bigint | null => {
    const normalized = raw.trim();
    if (!/^\d+(\.\d{1,9})?$/.test(normalized)) {
      return null;
    }

    const [wholePart, fractionPart = ''] = normalized.split('.');
    const paddedFraction = (fractionPart + '000000000').slice(0, 9);
    const mist = BigInt(wholePart) * MIST_PER_SUI + BigInt(paddedFraction);
    if (mist <= 0n) {
      return null;
    }
    return mist;
  };

  const extractGameIdFromCreateTx = (
    txBlock:
      | {
          effects?: {
            created?: Array<{
              reference?: {
                objectId?: string;
              };
              owner?: unknown;
            }> | null;
          } | null;
          events?: Array<{
            type?: string;
            parsedJson?: unknown;
          }> | null;
          objectChanges?: Array<{
            type?: string;
            objectType?: string;
            objectId?: string;
          }> | null;
        }
      | null
      | undefined,
  ): string | null => {
    const createdEvent = txBlock?.events?.find((event) => event.type === `${PACKAGE_ID}::${MODULE_NAME}::GameCreated`);
    if (createdEvent?.parsedJson && typeof createdEvent.parsedJson === 'object' && 'game_id' in createdEvent.parsedJson) {
      const gameId = (createdEvent.parsedJson as { game_id?: unknown }).game_id;
      if (typeof gameId === 'string') {
        return gameId;
      }
    }

    const createdGame = txBlock?.objectChanges?.find(
      (change) => change.type === 'created' && change.objectType === `${PACKAGE_ID}::${MODULE_NAME}::Game`,
    );
    if (typeof createdGame?.objectId === 'string') {
      return createdGame.objectId;
    }

    const createdShared = txBlock?.effects?.created?.find(
      (obj) => obj.owner && typeof obj.owner === 'object' && 'Shared' in obj.owner,
    );
    if (typeof createdShared?.reference?.objectId === 'string') {
      return createdShared.reference.objectId;
    }

    return null;
  };

  const getErrorText = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        return detail;
      }
      if (typeof err.message === 'string' && err.message.length > 0) {
        return err.message;
      }
    }

    if (err instanceof Error && err.message.length > 0) {
      return err.message;
    }

    return fallback;
  };

  const getTxFailureReason = (
    txBlock:
      | {
          effects?: {
            status?:
              | {
                  status?: string;
                  error?: string;
                }
              | string
              | null;
          } | null;
        }
      | null
      | undefined,
  ) => {
    const rawStatus = txBlock?.effects?.status;
    if (typeof rawStatus === 'string') {
      return rawStatus;
    }
    if (rawStatus && typeof rawStatus === 'object') {
      if (typeof rawStatus.error === 'string' && rawStatus.error.length > 0) {
        return rawStatus.error;
      }
      if (typeof rawStatus.status === 'string') {
        return rawStatus.status;
      }
    }
    return 'unknown failure';
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const copyShareText = () => {
    if (!result || !account) return;
    const isWinner = result.winner === account.address;
    const amountSui = formatMistToSui(result.net_win_mist || result.stake_amount_mist || '0');
    const distance = Math.round(result.distances[account.address] || 0);
    
    const text = isWinner
      ? `🏆 I just won ${amountSui} SUI in #SuiDrift 1v1! Found Paris within ${distance}m. Can you beat me?`
      : `🎯 Played #SuiDrift 1v1 and got within ${distance}m of the target! Good game.`;
      
    navigator.clipboard.writeText(text).then(() => setFeedback('Share text copied to clipboard!'));
  };

  const resetToLobby = () => {
    setGameState('lobby');
    setGameId(null);
    setMyGuess(null);
    setTempGuess(null);
    setTimeLeft(300);
    setResult(null);
    setPolling(false);
    setCurrentStakeMist(null);
  };

  const isByteArray = (value: unknown): value is number[] =>
    Array.isArray(value) && value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255);

  const areEqualBytes = (a: number[], b: number[]) => a.length === b.length && a.every((entry, index) => entry === b[index]);

  const getBackendOracleKey = async (): Promise<number[] | null> => {
    const res = await axios.get<{ oracle_pub_key_bytes?: unknown }>(`${BACKEND_URL}/`);
    return isByteArray(res.data.oracle_pub_key_bytes) ? res.data.oracle_pub_key_bytes : null;
  };

  const getChainOracleKey = async (): Promise<number[] | null> => {
    const configObject = await client.getObject({
      id: GAME_CONFIG_ID,
      options: { showContent: true },
    });

    const content = configObject.data?.content as
      | {
          dataType?: string;
          fields?: {
            public_key?: unknown;
          };
        }
      | undefined;

    if (!content || content.dataType !== 'moveObject') {
      return null;
    }

    return isByteArray(content.fields?.public_key) ? content.fields.public_key : null;
  };

  const ensureOracleKeySynced = async (): Promise<boolean> => {
    try {
      const [backendKey, chainKey] = await Promise.all([getBackendOracleKey(), getChainOracleKey()]);
      if (!backendKey || !chainKey) {
        setFeedback('Unable to validate oracle key status. Please check backend and chain config.');
        return false;
      }

      const matched = areEqualBytes(backendKey, chainKey);
      setOracleKeyMismatch(!matched);

      if (!matched) {
        setFeedback('Oracle key mismatch: backend signing key is not synced with on-chain GameConfig. Sync key first, then claim reward.');
        return false;
      }

      return true;
    } catch (err) {
      console.error(err);
      setFeedback('Oracle key check failed. Please retry after backend is reachable.');
      return false;
    }
  };

  const syncOracleConfig = async () => {
    if (!account) return;

    setFeedback(null);
    setActionBusy('sync');

    try {
      const backendKey = await getBackendOracleKey();
      if (!backendKey) {
        throw new Error('Backend did not return valid oracle public key bytes.');
      }

      const ownedCaps = await client.getOwnedObjects({
        owner: account.address,
        filter: { StructType: `${PACKAGE_ID}::${MODULE_NAME}::AdminCap` },
      });

      const adminCapId = ownedCaps.data[0]?.data?.objectId;
      if (!adminCapId) {
        setFeedback('Current wallet has no AdminCap. Switch to the deployer/admin wallet to sync oracle key.');
        return;
      }

      const tx = new Transaction();
      tx.moveCall({
        target: `${PACKAGE_ID}::${MODULE_NAME}::update_config`,
        arguments: [
          tx.object(adminCapId),
          tx.object(GAME_CONFIG_ID),
          tx.pure.vector('u8', new Uint8Array(backendKey)),
        ],
      });

      signAndExecute(
        { transaction: tx },
        {
          onSuccess: async (txResult) => {
            try {
              const txBlock = await client.waitForTransaction({ digest: txResult.digest, options: { showEffects: true } });
              if (!isTxSuccess(txBlock)) {
                throw new Error('On-chain update_config transaction was not successful.');
              }

              setOracleKeyMismatch(false);
              setFeedback('Oracle public key synced on-chain. You can claim reward now.');
            } catch (err) {
              console.error(err);
              setFeedback('Oracle key sync submitted but not confirmed successfully.');
            } finally {
              setActionBusy(null);
            }
          },
          onError: (err) => {
            console.error(err);
            setFeedback('Oracle key sync transaction was rejected.');
            setActionBusy(null);
          },
        },
      );
    } catch (err) {
      console.error(err);
      setFeedback('Failed to prepare oracle key sync.');
      setActionBusy(null);
    }
  };

  useEffect(() => {
    fetchRooms();
    fetchLeaderboard();

    const interval = setInterval(() => {
      fetchRooms();
      fetchLeaderboard();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let timer: any;
    if (gameState === 'playing' && timeLeft > 0 && !myGuess) {
      timer = setInterval(() => {
        setTimeLeft((prev) => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [gameState, timeLeft, myGuess]);

  useEffect(() => {
    let interval: any;
    if (polling && gameId) {
      interval = setInterval(async () => {
        try {
          // Check backend status
          const res = await axios.get(`${BACKEND_URL}/game/${gameId}`);
          if (res.data.status === 'settled') {
            setResult(res.data);
            setGameState('settled');
            setPolling(false);
          } else if (res.data.status === 'active' && gameState === 'lobby') {
             if (typeof res.data.stake_amount_mist === 'string') {
               setCurrentStakeMist(res.data.stake_amount_mist);
             }
             setGameState('playing');
             setTimeLeft(300); // Reset timer on game start
             setTempGuess(null);
          } else if (res.data.status === 'cancelled' || res.data.status === 'refunded') {
             setFeedback('Game closed and funds were returned.');
             resetToLobby();
          }
        } catch (e) {
          if (axios.isAxiosError(e) && e.response?.status === 404) {
            setFeedback('Game no longer tracked by backend. Returning to lobby.');
            resetToLobby();
            return;
          }
          console.error(e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [polling, gameId, gameState]);

  const fetchRooms = async () => {
    try {
      const res = await axios.get<Room[]>(`${BACKEND_URL}/rooms`);
      setRooms(res.data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await axios.get<{
        total_players: number;
        total_records: number;
        ranking: LeaderboardEntry[];
      }>(`${BACKEND_URL}/leaderboard?limit=20`);

      setLeaderboard(res.data.ranking || []);
      setLeaderboardMeta({
        totalPlayers: res.data.total_players || 0,
        totalRecords: res.data.total_records || 0,
      });
    } catch (e) {
      console.error(e);
    }
  };

  const createGame = async () => {
    if (!account) return;
    setFeedback(null);

    const stakeMist = parseStakeInputToMist(stakeInputSui);
    if (!stakeMist) {
      setFeedback('Invalid stake amount. Use a positive SUI amount up to 9 decimals.');
      return;
    }

    setActionBusy('create');

    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [stakeMist]);
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_NAME}::create_game`,
      arguments: [coin],
    });

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async (txResult) => {
          try {
            const txBlock = await client.waitForTransaction({
              digest: txResult.digest,
              options: { showEffects: true, showEvents: true, showObjectChanges: true },
            });
            if (!isTxSuccess(txBlock)) {
              throw new Error('On-chain create_game transaction was not successful.');
            }

            const newGameId = extractGameIdFromCreateTx(txBlock);
            if (!newGameId) {
              throw new Error('Unable to locate created game id from transaction result.');
            }

            await axios.post(`${BACKEND_URL}/create_room`, {
              game_id: newGameId,
              player_a: account.address,
              stake_amount_mist: stakeMist.toString(),
            });

            setGameId(newGameId);
            setCurrentStakeMist(stakeMist.toString());
            setPolling(true);
            setFeedback(`Game created: ${shortId(newGameId)} (${formatMistToSui(stakeMist)} SUI)`);
          } catch (err) {
            console.error(err);
            setFeedback(`Create game failed: ${getErrorText(err, 'Please retry.')}`);
          } finally {
            setActionBusy(null);
          }
        },
        onError: (err) => {
          console.error(err);
          setFeedback('Transaction rejected or failed before confirmation.');
          setActionBusy(null);
        },
      },
    );
  };

  const joinGame = async (id: string, stakeAmountMist: string) => {
    if (!account) return;
    setFeedback(null);

    let stakeMist: bigint;
    try {
      stakeMist = BigInt(stakeAmountMist);
    } catch {
      setFeedback('Room stake format is invalid. Refresh room list and retry.');
      return;
    }
    if (stakeMist <= 0n) {
      setFeedback('Room stake amount is invalid.');
      return;
    }

    setActionBusy('join');
    setJoiningRoomId(id);

    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [stakeMist]);
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_NAME}::join_game`,
      arguments: [tx.object(id), coin, tx.object(CLOCK_OBJECT_ID)],
    });

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async (txResult) => {
          try {
            const txBlock = await client.waitForTransaction({ digest: txResult.digest, options: { showEffects: true } });
            if (!isTxSuccess(txBlock)) {
              throw new Error(`On-chain join_game failed: ${getTxFailureReason(txBlock)}.`);
            }

            await axios.post(`${BACKEND_URL}/join_room`, {
              game_id: id,
              player_b: account.address,
            });

            setGameId(id);
            setCurrentStakeMist(stakeAmountMist);
            setGameState('playing');
            setPolling(true);
            setFeedback(`Joined room: ${shortId(id)} (${formatMistToSui(stakeMist)} SUI)`);
          } catch (err) {
            console.error(err);
            setFeedback(`Join failed: ${getErrorText(err, 'chain confirmation or backend sync did not complete.')}`);
          } finally {
            setActionBusy(null);
            setJoiningRoomId(null);
          }
        },
        onError: (err) => {
          console.error(err);
          setFeedback('Transaction rejected or failed before confirmation.');
          setActionBusy(null);
          setJoiningRoomId(null);
        },
      },
    );
  };
  
  const submitGuess = async (lat: number, lon: number) => {
    if (!gameId || !account) return;
    setMyGuess({ lat, lon });
    
    await axios.post(`${BACKEND_URL}/submit`, {
        game_id: gameId,
        player_address: account.address,
        lat,
        lon
    });
  };
  
  const claimReward = async () => {
     if (!gameId || !result || !result.signature) return;
     setFeedback(null);
     setActionBusy('claim');

     const keySynced = await ensureOracleKeySynced();
     if (!keySynced) {
       setActionBusy(null);
       return;
     }
     
     const tx = new Transaction();
     const signature = result.signature;
      
      tx.moveCall({
          target: `${PACKAGE_ID}::${MODULE_NAME}::settle_game`,
         arguments: [
             tx.object(gameId),
             tx.object(GAME_CONFIG_ID),
             tx.pure.vector('u8', new Uint8Array(signature)),
              tx.pure.address(result.winner)
          ]
      });
      
      signAndExecute(
         { transaction: tx },
         {
            onSuccess: async (txResult) => {
                try {
                  const txBlock = await client.waitForTransaction({ digest: txResult.digest, options: { showEffects: true } });
                  if (!isTxSuccess(txBlock)) {
                    throw new Error('On-chain settle_game transaction was not successful.');
                  }
                  setFeedback('Reward claimed successfully.');
                  resetToLobby();
                } catch (err) {
                  console.error(err);
                  setFeedback('Reward claim did not finalize successfully.');
                } finally {
                  setActionBusy(null);
                }
            },
            onError: (err) => {
              console.error(err);
              setFeedback('Reward claim transaction was rejected.');
              setActionBusy(null);
            }
         }
      );
  };

  const cancelWaitingGame = async () => {
    if (!account || !gameId) return;

    setFeedback(null);
    setActionBusy('cancel');

    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_NAME}::cancel_waiting_game`,
      arguments: [tx.object(gameId)],
    });

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async (txResult) => {
          try {
            const txBlock = await client.waitForTransaction({ digest: txResult.digest, options: { showEffects: true } });
            if (!isTxSuccess(txBlock)) {
              throw new Error('On-chain cancel_waiting_game transaction was not successful.');
            }

            await axios.post(`${BACKEND_URL}/cancel_room`, {
              game_id: gameId,
              player_address: account.address,
            });

            resetToLobby();
            setFeedback('Waiting game canceled. Stake refunded to creator.');
            fetchRooms();
          } catch (err) {
            console.error(err);
            setFeedback(`Cancel waiting failed: ${getErrorText(err, 'Please retry.')}`);
          } finally {
            setActionBusy(null);
          }
        },
        onError: (err) => {
          console.error(err);
          setFeedback('Cancel waiting transaction was rejected.');
          setActionBusy(null);
        },
      },
    );
  };

  const refundActiveTimeout = async () => {
    if (!account || !gameId) return;

    setFeedback(null);
    setActionBusy('refund');

    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_NAME}::refund_active_game_timeout`,
      arguments: [tx.object(gameId), tx.object(CLOCK_OBJECT_ID)],
    });

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async (txResult) => {
          try {
            const txBlock = await client.waitForTransaction({ digest: txResult.digest, options: { showEffects: true } });
            if (!isTxSuccess(txBlock)) {
              throw new Error('On-chain refund_active_game_timeout transaction was not successful.');
            }

            await axios.post(`${BACKEND_URL}/refund_room`, {
              game_id: gameId,
            });

            resetToLobby();
            setFeedback('Timeout refund executed. Both players received their stake back.');
            fetchRooms();
          } catch (err) {
            console.error(err);
            setFeedback(`Timeout refund failed: ${getErrorText(err, 'Please retry.')}`);
          } finally {
            setActionBusy(null);
          }
        },
        onError: (err) => {
          console.error(err);
          setFeedback('Timeout refund transaction was rejected.');
          setActionBusy(null);
        },
      },
    );
  };

  const MapEvents = () => {
    useMapEvents({
      click(e) {
        if (gameState === 'playing' && !myGuess) {
            setTempGuess({ lat: e.latlng.lat, lon: e.latlng.lng });
        }
      },
    });
    return null;
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="eyebrow">Sui Testnet</p>
        <h1>SuiDrift: Geo-Duel</h1>
        <p className="hero-copy">Stake, guess, settle - fully on-chain rewards with map-based duels.</p>
        <div className="wallet-row">
          <ConnectButton />
        </div>
      </header>

      {!account && <p className="status-text">Please connect wallet to play.</p>}
      {feedback && <p className="status-feedback">{feedback}</p>}

      {account && gameState === 'lobby' && (
        <section className="panel">
          <div className="panel-header">
            <h2>Lobby</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                className="stake-input"
                value={stakeInputSui}
                onChange={(e) => setStakeInputSui(e.target.value)}
                placeholder="Stake in SUI"
                inputMode="decimal"
                disabled={actionBusy !== null}
              />
              <button className="btn btn-primary" onClick={createGame} disabled={actionBusy !== null}>
                {actionBusy === 'create' ? 'Creating...' : 'Create Game'}
              </button>
            </div>
          </div>

          {gameId && (
            <div className="panel-header" style={{ marginTop: '0.8rem' }}>
              <p className="muted">
                Your waiting room: {shortId(gameId)}
                {currentStakeMist ? ` (${formatMistToSui(currentStakeMist)} SUI)` : ''}
              </p>
              <button className="btn btn-secondary" onClick={cancelWaitingGame} disabled={actionBusy !== null}>
                {actionBusy === 'cancel' ? 'Cancelling...' : 'Cancel Waiting (Refund)'}
              </button>
            </div>
          )}

          <h3>Open Rooms</h3>
          <div className="room-list">
            {rooms.length === 0 && <p className="muted">No open rooms yet. Create one and wait for a challenger.</p>}
            {rooms.map((room) => (
              <div key={room.game_id} className="room-card">
                <div>
                  <p className="muted">Room</p>
                  <p className="room-id">{shortId(room.game_id)}</p>
                  <p className="muted">Stake: {formatMistToSui(room.stake_amount_mist || '0')} SUI</p>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => joinGame(room.game_id, room.stake_amount_mist || '0')}
                  disabled={actionBusy !== null}
                >
                  {actionBusy === 'join' && joiningRoomId === room.game_id ? 'Joining...' : 'Join Room'}
                </button>
              </div>
            ))}
          </div>

          <h3>History Leaderboard</h3>
          <p className="muted">Rank by cumulative net earnings across all settled games.</p>
          <div className="leaderboard-list">
            {leaderboard.length === 0 && <p className="muted">No settled games yet.</p>}
            {leaderboard.map((entry) => (
              <div key={entry.player} className="leaderboard-row">
                <div>
                  <p className="rank-pill">#{entry.rank}</p>
                  <p className="room-id">{shortAddress(entry.player)}</p>
                </div>
                <div className="leaderboard-metrics">
                  <p>Earned: <strong>{formatMistToSui(entry.total_earned_mist)} SUI</strong></p>
                  <p className="muted">Wins: {entry.wins} | Gross Won: {formatMistToSui(entry.total_payout_mist)} SUI</p>
                </div>
              </div>
            ))}
          </div>
          <p className="muted">Players: {leaderboardMeta.totalPlayers} | Settled Games: {leaderboardMeta.totalRecords}</p>
        </section>
      )}

      {account && gameState === 'playing' && (
         <div className="game-controls-drawer">
             <div className="panel-header">
               <h2>Find: Paris</h2>
               <div className={`countdown-timer ${timeLeft < 30 ? 'urgent' : ''}`}>
                 ⏱ {formatTime(timeLeft)}
               </div>
             </div>
             
             {currentStakeMist && <p className="muted">Stake: {formatMistToSui(currentStakeMist)} SUI</p>}
             
             {!myGuess && !tempGuess && <p className="muted">Tap map to place marker.</p>}
             {!myGuess && tempGuess && (
               <div style={{ marginTop: '0.5rem' }}>
                 <p className="muted">Marker placed. Adjust or confirm.</p>
                 <button 
                   className="btn btn-primary" 
                   onClick={() => submitGuess(tempGuess.lat, tempGuess.lon)}
                   style={{ width: '100%', marginTop: '0.5rem' }}
                 >
                   Confirm & Submit Guess
                 </button>
               </div>
             )}
             
             {myGuess && <p className="status-feedback">Guess locked! Waiting for opponent...</p>}
             
             <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
               <button className="btn btn-secondary" onClick={refundActiveTimeout} disabled={actionBusy !== null} style={{ flex: 1 }}>
                 {actionBusy === 'refund' ? 'Refunding...' : 'Refund (Timeout)'}
               </button>
             </div>
         </div>
      )}

      {account && gameState === 'playing' && (
         <div className="map-shell">
             <MapContainer center={[48.8566, 2.3522]} zoom={13} className="map-canvas">
                 <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                 {tempGuess && !myGuess && (
                   <Marker 
                     position={[tempGuess.lat, tempGuess.lon]} 
                     draggable={true}
                     eventHandlers={{
                       dragend: (e) => {
                         const marker = e.target;
                         const position = marker.getLatLng();
                         setTempGuess({ lat: position.lat, lon: position.lng });
                       },
                     }}
                   />
                 )}
                 {myGuess && <Marker position={[myGuess.lat, myGuess.lon]} />}
                 <MapEvents />
             </MapContainer>
         </div>
      )}


      {gameState === 'settled' && result && (
          <section className="panel">
              <div className="victory-card">
                <div className="victory-avatar">
                  {result.winner === account?.address ? '🏆' : '💀'}
                </div>
                <div className="victory-label">
                  {result.winner === account?.address ? 'VICTORY' : 'DEFEAT'}
                </div>
                <div className="victory-amount">
                  {result.winner === account?.address ? `+${formatMistToSui(result.net_win_mist || result.stake_amount_mist || '0')} SUI` : '-'}
                </div>
                <p className="muted" style={{ fontSize: '0.9rem' }}>
                  Distance: {Math.round(result.distances[account?.address || ''] || 0)}m
                </p>
                
                <div className="share-row">
                  <button className="btn btn-secondary" onClick={copyShareText} style={{ flex: 1 }}>
                    📋 Copy Share Text
                  </button>
                </div>
              </div>

              {result.winner === account?.address && (
                <button className="btn btn-reward" onClick={claimReward} disabled={actionBusy !== null} style={{ width: '100%' }}>
                  {actionBusy === 'claim' ? 'Claiming...' : 'Claim Reward Now'}
                </button>
              )}

              {oracleKeyMismatch && (
                <button className="btn btn-secondary" onClick={syncOracleConfig} disabled={actionBusy !== null} style={{ width: '100%', marginTop: '0.5rem' }}>
                  {actionBusy === 'sync' ? 'Syncing...' : 'Sync Oracle Key (Admin)'}
                </button>
              )}

              <button
                className="btn btn-secondary"
                onClick={resetToLobby}
                style={{ width: '100%', marginTop: '0.5rem' }}
              >
                Back to Lobby
              </button>
          </section>
      )}
    </div>
  );
}

export default App;
