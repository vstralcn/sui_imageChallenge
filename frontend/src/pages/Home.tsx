import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";
import { Trophy, Zap, Target, Clock, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { ConnectButton, useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import axios from "axios";
import { toast } from "sonner";
import { PACKAGE_ID, BACKEND_URL, MODULE_NAME, CLOCK_OBJECT_ID } from "../constants";
import { formatMistToSui, parseStakeInputToMist, shortAddress } from "@/lib/utils";

type Room = {
  game_id: string;
  player_a: string;
  stake_amount_mist?: string;
};

export default function Home() {
  const [, setLocation] = useLocation();
  const { t } = useLanguage();
  const currentAccount = useCurrentAccount();
  const { mutate: signAndExecute } = useSignAndExecuteTransaction();
  const client = useSuiClient();
  
  const [stakeAmount, setStakeAmount] = useState("1");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRooms = async () => {
    try {
      const res = await axios.get<Room[]>(`${BACKEND_URL}/rooms`);
      setRooms(res.data);
    } catch (e) {
      console.error(e);
      toast.error(t("failedToFetchRooms"));
    }
  };

  useEffect(() => {
    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => clearInterval(interval);
  }, []);

  const getErrorText = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err)) {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') return detail;
      if (typeof err.message === 'string' && err.message.length > 0) return err.message;
    }
    if (err instanceof Error && err.message.length > 0) return err.message;
    return fallback;
  };

  const isTxSuccess = (txBlock: any) => {
    const rawStatus = typeof txBlock?.effects?.status === 'string'
      ? txBlock.effects.status
      : txBlock?.effects?.status?.status;
    return typeof rawStatus === 'string' && rawStatus.toLowerCase() === 'success';
  };

  const extractGameIdFromCreateTx = (txBlock: any): string | null => {
    const createdEvent = txBlock?.events?.find((event: any) => event.type === `${PACKAGE_ID}::${MODULE_NAME}::GameCreated`);
    if (createdEvent?.parsedJson?.game_id) return createdEvent.parsedJson.game_id;

    const createdGame = txBlock?.objectChanges?.find(
      (change: any) => change.type === 'created' && change.objectType === `${PACKAGE_ID}::${MODULE_NAME}::Game`,
    );
    if (createdGame?.objectId) return createdGame.objectId;

    const createdShared = txBlock?.effects?.created?.find(
      (obj: any) => obj.owner?.Shared,
    );
    if (createdShared?.reference?.objectId) return createdShared.reference.objectId;

    return null;
  };

  const getTxFailureReason = (txBlock: any) => {
    const rawStatus = txBlock?.effects?.status;
    if (typeof rawStatus === 'string') return rawStatus;
    if (rawStatus && typeof rawStatus === 'object') {
      if (rawStatus.error) return rawStatus.error;
      if (rawStatus.status) return rawStatus.status;
    }
    return 'unknown failure';
  };

  const handleCreateRoom = async () => {
    if (!currentAccount) return;
    const stakeMist = parseStakeInputToMist(stakeAmount);
    if (!stakeMist) {
      toast.error(t("invalidStakeAmount"));
      return;
    }

    setLoading(true);
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
            
            if (!isTxSuccess(txBlock)) throw new Error('On-chain create_game failed');

            const newGameId = extractGameIdFromCreateTx(txBlock);
            if (!newGameId) throw new Error('Could not get game ID');

            await axios.post(`${BACKEND_URL}/create_room`, {
              game_id: newGameId,
              player_a: currentAccount.address,
              stake_amount_mist: stakeMist.toString(),
            });

            toast.success(t("gameCreatedStake", { stake: formatMistToSui(stakeMist) }));
            setLocation(`/game/${newGameId}`);
          } catch (err) {
            console.error(err);
            toast.error(t("createFailed", { reason: getErrorText(err, "Please retry") }));
          } finally {
            setLoading(false);
          }
        },
        onError: (err) => {
          console.error(err);
          toast.error(t("transactionRejected"));
          setLoading(false);
        },
      }
    );
  };

  const handleJoinRoom = async (roomId: string, stakeAmountMist: string) => {
    if (!currentAccount) return;
    
    let stakeMist: bigint;
    try {
      stakeMist = BigInt(stakeAmountMist);
    } catch {
      toast.error(t("invalidRoomStake"));
      return;
    }

    setLoading(true);
    const tx = new Transaction();
    const [coin] = tx.splitCoins(tx.gas, [stakeMist]);
    tx.moveCall({
      target: `${PACKAGE_ID}::${MODULE_NAME}::join_game`,
      arguments: [tx.object(roomId), coin, tx.object(CLOCK_OBJECT_ID)],
    });

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async (txResult) => {
          try {
            const txBlock = await client.waitForTransaction({ digest: txResult.digest, options: { showEffects: true } });
            if (!isTxSuccess(txBlock)) {
              throw new Error(`On-chain join failed: ${getTxFailureReason(txBlock)}`);
            }

            await axios.post(`${BACKEND_URL}/join_room`, {
              game_id: roomId,
              player_b: currentAccount.address,
            });

            toast.success(t("joinedRoom"));
            setLocation(`/game/${roomId}`);
          } catch (err) {
            console.error(err);
            toast.error(t("joinFailed", { reason: getErrorText(err, "Please retry") }));
          } finally {
            setLoading(false);
          }
        },
        onError: (err) => {
          console.error(err);
          toast.error(t("transactionRejected"));
          setLoading(false);
        },
      }
    );
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-background text-foreground">
      {/* Hero Background */}
      <div 
        className="absolute inset-0 z-0"
        style={{
          backgroundImage: `url('https://private-us-east-1.manuscdn.com/sessionFile/EYzNoSn2m7MGdDHYhjZd3r/sandbox/qeB3rP1uqQQ1ncorkYQTzd-img-1_1770816310000_na1fn_aGVyby1iZw.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvRVl6Tm9TbjJtN01HZERIWWhqWmQzci9zYW5kYm94L3FlQjNyUDF1cVFRMW5jb3JrWVFUemQtaW1nLTFfMTc3MDgxNjMxMDAwMF9uYTFmbl9hR1Z5YnkxaVp3LnBuZz94LW9zcy1wcm9jZXNzPWltYWdlL3Jlc2l6ZSx3XzE5MjAsaF8xOTIwL2Zvcm1hdCx3ZWJwL3F1YWxpdHkscV84MCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc5ODc2MTYwMH19fV19&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=UVAKEocP1v5Qv8o3-81FYaBW2koZjmMu9PJd4Iyk3uV9VieRp3PGD1amKr4KtpgAHt9Z3QoqPyYsB2TW8vA3-2UNFH3Ij3ZaqUnkRRYlDHawnkJwF1-knvUET6lc~g-ugFUwMFf~Q1tttUfFOFeX6T6kXZfQgUXyClEaF7t9Dn7gMoRff5JzT6muzqNHTzmqSHQiQHnq3YjyJ3Tz6Zv5WTWi-FRwnhJiTUhFD9Lw4NO56ngwiapikk85Akpngxjx7yWy~xs8oz5qs-MoBipSY2Cjrf8ZPZpe5SNTpUJR02PTKWnnFxi3uiX~dyYGOECrmf7SyxZxdC-jGULi0isNFA__')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/60 to-background"></div>
      </div>

      {/* Scanning line overlay */}
      <div className="scan-line absolute inset-0 z-10 pointer-events-none"></div>

      {/* Main Content */}
      <div className="relative z-20">
        {/* Header */}
        <header className="border-b border-primary/30 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Zap className="w-8 h-8 text-primary neon-glow" />
              <h1 className="text-3xl font-bold neon-glow text-primary">SuiDrift</h1>
            </div>
            <nav className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                className="text-foreground hover:text-primary transition-colors glitch"
                onClick={() => setLocation('/leaderboard')}
              >
                <Trophy className="w-5 h-5 mr-2" />
                {t("leaderboard")}
              </Button>
              <LanguageSwitcher />
              <ConnectButton className="bg-primary text-primary-foreground hover:bg-primary/90 neon-border font-semibold" />
            </nav>
          </div>
        </header>

        {/* Hero Section */}
        <section className="container mx-auto px-6 py-16 text-center">
          <h2 className="text-5xl md:text-7xl font-bold mb-6 neon-glow text-primary">
            {t("homeHeroTitle")}
          </h2>
          <p className="text-xl md:text-2xl text-muted-foreground mb-8 max-w-3xl mx-auto font-data">
            {t("homeHeroSubtitle")}
          </p>
          <div className="flex flex-wrap justify-center gap-8 mb-12">
            <div className="flex items-center gap-3">
              <Target className="w-6 h-6 text-accent" />
              <span className="text-lg font-data">{t("precisionGuessing")}</span>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="w-6 h-6 text-accent" />
              <span className="text-lg font-data">{t("fiveMinDuel")}</span>
            </div>
            <div className="flex items-center gap-3">
              <Zap className="w-6 h-6 text-accent" />
              <span className="text-lg font-data">{t("fairEscrow")}</span>
            </div>
          </div>
        </section>

        {/* Main Content Grid */}
        <section className="container mx-auto px-6 pb-16">
          <div className="grid md:grid-cols-[2fr_3fr] gap-8">
            {/* Create Room Card */}
            <Card className="bg-card/80 backdrop-blur-md border-primary/30 neon-border scan-line">
              <CardHeader>
                <CardTitle className="text-2xl text-primary neon-glow">{t("createRoom")}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t("createRoomDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm text-muted-foreground mb-2 block font-data">
                    {t("stakeAmountSui")}
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    placeholder={t("stakePlaceholder")}
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    className="bg-input border-primary/50 text-foreground font-data text-lg"
                    disabled={!currentAccount || loading}
                  />
                </div>
                <Button
                  onClick={handleCreateRoom}
                  disabled={!currentAccount || !stakeAmount || loading}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90 neon-border font-semibold text-lg py-6 glitch"
                >
                  {loading ? <RefreshCw className="w-5 h-5 animate-spin mr-2" /> : <Zap className="w-5 h-5 mr-2" />}
                  {loading ? t("processing") : t("createGame")}
                </Button>
                {!currentAccount && (
                  <p className="text-sm text-muted-foreground text-center">
                    {t("connectWalletToPlay")}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Active Rooms List */}
            <Card className="bg-card/80 backdrop-blur-md border-primary/30 neon-border scan-line">
              <CardHeader>
                <CardTitle className="text-2xl text-primary neon-glow">{t("activeRooms")}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t("activeRoomsDescription")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {rooms.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">
                      {t("noActiveRooms")}
                    </p>
                  ) : (
                    rooms.map((room) => (
                      <div
                        key={room.game_id}
                        className="flex items-center justify-between p-4 bg-background/50 border border-primary/30 rounded hover:border-primary/60 transition-colors"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm text-muted-foreground font-data">{t("creator")}</span>
                            <span className="mono text-sm text-foreground">{shortAddress(room.player_a)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground font-data">{t("stake")}</span>
                            <span className="text-lg font-bold text-accent font-data">{formatMistToSui(room.stake_amount_mist || '0')} SUI</span>
                          </div>
                        </div>
                        <Button
                          onClick={() => handleJoinRoom(room.game_id, room.stake_amount_mist || '0')}
                          disabled={!currentAccount || loading}
                          className="bg-primary text-primary-foreground hover:bg-primary/90 neon-border font-semibold glitch"
                        >
                          {t("join")}
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </div>
  );
}
