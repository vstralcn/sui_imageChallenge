import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";
import { formatMistToSui } from "@/lib/utils";
import { Clock, MapPin, Trophy, X, AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import axios from "axios";
import {
  BACKEND_URL,
  CLOCK_OBJECT_ID,
  GAME_CONFIG_ID,
  MAP_TILE_SUBDOMAINS,
  MAP_TILE_URL,
  MODULE_NAME,
  PACKAGE_ID,
  QUESTION_IMAGE_FALLBACK_PATH,
} from "../constants";

import icon from "leaflet/dist/images/marker-icon.png";
import iconShadow from "leaflet/dist/images/marker-shadow.png";

const defaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = defaultIcon;

type GameState = {
  status: "waiting" | "active" | "settled" | "cancelled" | "refunded";
  id?: string;
  game_id?: string;
  player_a: string;
  player_b: string | null;
  winner: string | null;
  stake_amount_mist: string;
  distances?: Record<string, number>;
  signature: number[] | null;
  target_image?: string | null;
  target_hint?: string | null;
  target_difficulty?: string | null;
  walrus_blob_id?: string | null;
  walrus_blob_id_bytes?: number[];
  stored_on_walrus?: boolean;
  net_win_mist?: string;
};

type TxBlockLike = {
  effects?: {
    status?: string | { status?: string; error?: string };
  };
  events?: Array<{
    type?: string;
    parsedJson?: { game_id?: string };
  }>;
  objectChanges?: Array<{
    type?: string;
    objectType?: string;
    objectId?: string;
  }>;
};

const isTxSuccess = (txBlock: TxBlockLike) => {
  const rawStatus = txBlock.effects?.status;
  const statusStr = typeof rawStatus === "string" ? rawStatus : rawStatus?.status;
  return typeof statusStr === "string" && statusStr.toLowerCase() === "success";
};

const extractGameIdFromCreateTx = (txBlock: TxBlockLike): string | null => {
  const createdEvent = txBlock.events?.find(
    (event) => event.type === `${PACKAGE_ID}::${MODULE_NAME}::GameCreated`,
  );
  if (typeof createdEvent?.parsedJson?.game_id === "string") {
    return createdEvent.parsedJson.game_id;
  }

  const createdGame = txBlock.objectChanges?.find(
    (change) =>
      change.type === "created" &&
      change.objectType === `${PACKAGE_ID}::${MODULE_NAME}::Game`,
  );
  if (typeof createdGame?.objectId === "string") {
    return createdGame.objectId;
  }

  return null;
};

const resolveChallengeImageUrl = (imageUrl?: string | null) => {
  if (!imageUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    return imageUrl;
  }

  const normalizedPath = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
  return `${BACKEND_URL}${normalizedPath}`;
};

export default function Game() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const { t } = useLanguage();
  const account = useCurrentAccount();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();
  const gameId = params.gameId;

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [timeLeft, setTimeLeft] = useState(300);
  const [myGuess, setMyGuess] = useState<{ lat: number; lon: number } | null>(null);
  const [tempGuess, setTempGuess] = useState<{ lat: number; lon: number } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [challengeImageFailed, setChallengeImageFailed] = useState(false);
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number }>({ lat: 48.8566, lon: 2.3522 });

  useEffect(() => {
    if (!gameId) return;

    const fetchGame = async () => {
      try {
        const res = await axios.get(`${BACKEND_URL}/game/${gameId}`);
        setGameState(res.data);

        if (res.data.status === "cancelled" || res.data.status === "refunded") {
          toast.info(t("gameCancelledOrRefunded"));
          setLocation("/");
        }
      } catch (e) {
        if (axios.isAxiosError(e) && e.response?.status === 404) {
          toast.error(t("gameNotFound"));
          setLocation("/");
        }
      }
    };

    void fetchGame();
    const interval = setInterval(() => {
      void fetchGame();
    }, 2000);
    return () => clearInterval(interval);
  }, [gameId, setLocation, t]);

  useEffect(() => {
    if (gameState?.status === "active" && timeLeft > 0 && !myGuess) {
      const timer = setInterval(() => setTimeLeft((v) => Math.max(0, v - 1)), 1000);
      return () => clearInterval(timer);
    }
  }, [gameState?.status, myGuess, timeLeft]);

  useEffect(() => {
    setChallengeImageFailed(false);
  }, [gameState?.target_image]);

  const handleConfirmGuess = async () => {
    if (!tempGuess || !account || !gameId) return;

    setActionBusy(true);
    try {
      await axios.post(`${BACKEND_URL}/submit`, {
        game_id: gameId,
        player_address: account.address,
        lat: tempGuess.lat,
        lon: tempGuess.lon,
      });
      setMyGuess(tempGuess);
      toast.success(t("guessSubmitted"));
    } catch (e) {
      console.error(e);
      toast.error(t("submitGuessFailed"));
    } finally {
      setActionBusy(false);
    }
  };

  const handleClaimReward = async () => {
    if (!gameId || !gameState?.signature || !account) return;

    setActionBusy(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_NAME}::settle_game`,
      arguments: [
        tx.object(gameId),
        tx.object(GAME_CONFIG_ID),
        tx.pure.vector("u8", new Uint8Array(gameState.signature)),
        tx.pure.vector("u8", new Uint8Array(gameState.walrus_blob_id_bytes ?? [])),
        tx.pure.address(gameState.winner!),
      ],
    });

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async (txResult) => {
          try {
            const txBlock = await client.waitForTransaction({
              digest: txResult.digest,
              options: { showEffects: true },
            });
            const rawStatus = txBlock?.effects?.status;
            const statusStr = typeof rawStatus === "string" ? rawStatus : rawStatus?.status;
            if (statusStr !== "success") {
              throw new Error("Transaction failed");
            }
            toast.success(t("rewardClaimed"));
            setLocation("/");
          } catch (e) {
            console.error(e);
            toast.error(t("claimFailed"));
          } finally {
            setActionBusy(false);
          }
        },
        onError: (e) => {
          console.error(e);
          toast.error(t("transactionRejected"));
          setActionBusy(false);
        },
      },
    );
  };

  const handleClaimAndPlayAgain = async () => {
    if (!gameId || !gameState?.signature || !gameState.winner || !account) return;

    let stakeMist: bigint;
    try {
      stakeMist = BigInt(gameState.stake_amount_mist);
    } catch {
      toast.error(t("invalidStakeAmount"));
      return;
    }

    setActionBusy(true);
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_NAME}::settle_game`,
      arguments: [
        tx.object(gameId),
        tx.object(GAME_CONFIG_ID),
        tx.pure.vector("u8", new Uint8Array(gameState.signature)),
        tx.pure.vector("u8", new Uint8Array(gameState.walrus_blob_id_bytes ?? [])),
        tx.pure.address(gameState.winner),
      ],
    });

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
            const txBlock = (await client.waitForTransaction({
              digest: txResult.digest,
              options: { showEffects: true, showEvents: true, showObjectChanges: true },
            })) as TxBlockLike;

            if (!isTxSuccess(txBlock)) {
              throw new Error("Transaction failed");
            }

            const newGameId = extractGameIdFromCreateTx(txBlock);
            if (!newGameId) {
              throw new Error("Could not get new game ID");
            }

            await axios.post(`${BACKEND_URL}/create_room`, {
              game_id: newGameId,
              player_a: account.address,
              stake_amount_mist: gameState.stake_amount_mist,
            });

            toast.success(t("claimAndPlayAgainSuccess"));
            setLocation(`/game/${newGameId}`);
          } catch (e) {
            console.error(e);
            toast.error(t("claimAndPlayAgainFailed"));
          } finally {
            setActionBusy(false);
          }
        },
        onError: (e) => {
          console.error(e);
          toast.error(t("transactionRejected"));
          setActionBusy(false);
        },
      },
    );
  };

  const handleCancelWaiting = async () => {
    if (!gameId || !account) return;

    setActionBusy(true);
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
            await client.waitForTransaction({ digest: txResult.digest, options: { showEffects: true } });
            await axios.post(`${BACKEND_URL}/cancel_room`, {
              game_id: gameId,
              player_address: account.address,
            });
            toast.success(t("gameCancelled"));
            setLocation("/");
          } catch {
            toast.error(t("cancelFailed"));
          } finally {
            setActionBusy(false);
          }
        },
        onError: () => {
          toast.error(t("transactionRejected"));
          setActionBusy(false);
        },
      },
    );
  };

  const handleRefundTimeout = async () => {
    if (!gameId || !account) return;

    setActionBusy(true);
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
            await client.waitForTransaction({ digest: txResult.digest, options: { showEffects: true } });
            await axios.post(`${BACKEND_URL}/refund_room`, { game_id: gameId });
            toast.success(t("refundSuccessful"));
            setLocation("/");
          } catch {
            toast.error(t("refundFailed"));
          } finally {
            setActionBusy(false);
          }
        },
        onError: () => {
          toast.error(t("transactionRejected"));
          setActionBusy(false);
        },
      },
    );
  };

  const canSelectGuess = gameState?.status === "active" && !myGuess;

  const MapInteractionEvents = () => {
    const map = useMapEvents({
      click(e) {
        if (canSelectGuess) {
          setTempGuess({ lat: e.latlng.lat, lon: e.latlng.lng });
        }
      },
    });

    useEffect(() => {
      const syncCenter = () => {
        const center = map.getCenter();
        setMapCenter({ lat: center.lat, lon: center.lng });
      };

      syncCenter();
      map.on("moveend", syncCenter);

      return () => {
        map.off("moveend", syncCenter);
      };
    }, [map]);

    return null;
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const isUrgent = timeLeft <= 30;

  if (!gameState) {
    return <div className="flex h-screen items-center justify-center text-primary">{t("loading")}</div>;
  }

  const fallbackImageUrl = `${BACKEND_URL}${QUESTION_IMAGE_FALLBACK_PATH}`;
  const targetImageUrl = resolveChallengeImageUrl(gameState.target_image);
  const challengeImageUrl = challengeImageFailed ? fallbackImageUrl : (targetImageUrl ?? fallbackImageUrl);

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <header className="z-30 border-b border-primary/30 bg-background/80 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/")}
              className="text-foreground hover:text-primary"
            >
              <X className="mr-2 h-5 w-5" />
              {t("exit")}
            </Button>
            <div className="hidden text-sm text-muted-foreground font-data md:block">
              {t("roomIdShort")} <span className="mono text-foreground">{gameId?.slice(0, 8)}...</span>
            </div>
          </div>

          {gameState.status === "active" && (
            <div
              className={`flex items-center gap-3 rounded border px-6 py-3 ${
                isUrgent ? "border-accent bg-accent/10 pulse-urgent" : "border-primary/50 bg-card"
              }`}
            >
              <Clock className={`h-6 w-6 ${isUrgent ? "text-accent" : "text-primary"}`} />
              <span className={`mono text-2xl font-bold ${isUrgent ? "text-accent" : "text-primary"}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <div className="text-sm text-muted-foreground font-data">
              {t("stake")} <span className="font-bold text-accent">{formatMistToSui(gameState.stake_amount_mist)} SUI</span>
            </div>
          </div>
        </div>
      </header>

      <div className="relative flex-1" style={{ minHeight: "300px" }}>
        <MapContainer
          center={[48.8566, 2.3522]}
          zoom={13}
          className="z-0 h-full w-full"
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer url={MAP_TILE_URL} subdomains={MAP_TILE_SUBDOMAINS} />
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
          <MapInteractionEvents />
        </MapContainer>

        {gameState.status === "waiting" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-sm">
            <Card className="neon-border w-full max-w-md border-primary/50">
              <CardHeader className="text-center">
                <CardTitle className="neon-glow text-2xl text-primary">{t("waitingForOpponent")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-center">
                <div className="animate-pulse text-muted-foreground">{t("waitingRoomHint")}</div>
                {account?.address === gameState.player_a && (
                  <Button variant="destructive" onClick={handleCancelWaiting} disabled={actionBusy}>
                    {t("cancelRoomRefund")}
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {gameState.status === "active" && (
          <div className="animate-in slide-in-from-bottom absolute bottom-0 left-0 right-0 z-20 border-t border-primary/30 bg-card/95 p-6 backdrop-blur-md">
            <div className="container mx-auto max-w-4xl">
              <div className="flex items-center justify-between gap-6">
                <div className="flex-1">
                  <div className="mb-4 overflow-hidden rounded-lg border border-primary/50 bg-black/50">
                    <img
                      src={challengeImageUrl}
                      alt="Target Location"
                      onError={() => {
                        setChallengeImageFailed(true);
                      }}
                      className="h-48 w-full object-cover transition-transform duration-700 hover:scale-105"
                    />
                  </div>
                  <h3 className="neon-glow mb-2 text-xl font-bold text-primary">
                    {myGuess ? `✓ ${t("guessLocked")}` : (gameState.target_hint || t("findParis"))}
                  </h3>
                  {gameState.target_difficulty && !myGuess && (
                    <p className="mb-2 text-xs uppercase tracking-wide text-primary/80 font-data">
                      Difficulty: {gameState.target_difficulty}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground font-data">
                    {myGuess ? t("waitingOpponentShort") : t("mapHintWithCenter")}
                  </p>
                </div>
                {!myGuess && (
                  <div className="flex flex-col gap-3">
                    {!tempGuess && (
                      <Button
                        variant="secondary"
                        onClick={() => setTempGuess(mapCenter)}
                        disabled={actionBusy}
                        className="border border-primary/40"
                      >
                        {t("useMapCenterPoint")}
                      </Button>
                    )}
                    {tempGuess && (
                      <Button
                        onClick={handleConfirmGuess}
                        disabled={actionBusy}
                        className="neon-border glitch bg-accent px-8 py-6 text-lg font-semibold text-accent-foreground hover:bg-accent/90"
                      >
                        <MapPin className="mr-2 h-5 w-5" />
                        {t("confirmGuess")}
                      </Button>
                    )}
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefundTimeout}
                  disabled={actionBusy}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <AlertTriangle className="mr-1 h-4 w-4" /> {t("refundIfTimeout")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {gameState.status === "settled" && gameState.winner && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
            <Card className="neon-border w-full max-w-md border-2 bg-card/90">
              <CardHeader className="pb-4 text-center">
                <Trophy
                  className={`mx-auto mb-4 h-16 w-16 ${
                    gameState.winner === account?.address ? "neon-glow text-primary" : "text-muted-foreground"
                  }`}
                />
                <CardTitle
                  className={`text-4xl font-bold ${
                    gameState.winner === account?.address ? "neon-glow text-primary" : "text-muted-foreground"
                  }`}
                >
                  {gameState.winner === account?.address ? t("victory") : t("defeat")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded border border-primary/30 bg-background/50 p-3">
                    <span className="text-muted-foreground font-data">{t("yourDistance")}</span>
                    <span className="text-xl font-bold text-primary font-data">
                      {Math.round(gameState.distances?.[account?.address || ""] || 0)} m
                    </span>
                  </div>
                  {gameState.winner === account?.address && (
                    <div className="flex items-center justify-between rounded border border-accent bg-accent/20 p-3">
                      <span className="font-semibold text-foreground font-data">{t("reward")}</span>
                      <span className="text-2xl font-bold text-accent font-data">
                        {formatMistToSui(gameState.stake_amount_mist)} SUI
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  {gameState.winner === account?.address ? (
                    <>
                      <Button
                        onClick={handleClaimReward}
                        disabled={actionBusy}
                        className="neon-border flex-1 bg-accent py-6 text-lg font-semibold text-accent-foreground hover:bg-accent/90"
                      >
                        <Trophy className="mr-2 h-5 w-5" />
                        {t("claimReward")}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={handleClaimAndPlayAgain}
                        disabled={actionBusy}
                        className="flex-1 border border-primary/40 py-6 text-lg font-semibold"
                      >
                        {t("claimAndPlayAgain")}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => setLocation("/")} className="w-full">
                      {t("backToLobby")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
