import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LanguageSwitcher from "@/components/LanguageSwitcher";
import { useLanguage } from "@/contexts/LanguageContext";
import { Trophy, ArrowLeft, Medal, TrendingUp, Clock } from "lucide-react";
import { useLocation } from "wouter";
import { useState, useEffect } from "react";
import axios from "axios";
import { BACKEND_URL } from "../constants";
import { formatMistToSui, shortAddress } from "@/lib/utils";

interface LeaderboardEntry {
  rank: number;
  player: string;
  wins: number;
  total_earned_mist: string;
  total_payout_mist: string;
}

interface HistoryEntry {
  game_id: string;
  winner: string;
  loser: string;
  stake_amount_mist: string;
  settled_at: number;
}

export default function Leaderboard() {
  const [, setLocation] = useLocation();
  const { t } = useLanguage();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    const fetchData = async () => {
        try {
            const [lbRes, histRes] = await Promise.all([
                axios.get(`${BACKEND_URL}/leaderboard?limit=20`),
                axios.get(`${BACKEND_URL}/history?limit=20`)
            ]);
            setLeaderboard(lbRes.data.ranking);
            setHistory(histRes.data.records);
        } catch (e) {
            console.error(e);
        }
    };
    fetchData();
  }, []);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="w-6 h-6 text-[#FFD700] neon-glow" />;
      case 2:
        return <Medal className="w-6 h-6 text-[#C0C0C0] neon-glow" />;
      case 3:
        return <Medal className="w-6 h-6 text-[#CD7F32] neon-glow" />;
      default:
        return <span className="text-muted-foreground font-data w-6 text-center">{rank}</span>;
    }
  };

  return (
    <div className="min-h-screen relative overflow-hidden bg-background text-foreground">
      {/* Background with digital rain effect */}
      <div 
        className="absolute inset-0 z-0 opacity-20"
        style={{
          backgroundImage: `url('https://private-us-east-1.manuscdn.com/sessionFile/EYzNoSn2m7MGdDHYhjZd3r/sandbox/qeB3rP1uqQQ1ncorkYQTzd-img-4_1770816305000_na1fn_d2FpdGluZy1yb29tLWJn.png?x-oss-process=image/resize,w_1920,h_1920/format,webp/quality,q_80&Expires=1798761600&Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvRVl6Tm9TbjJtN01HZERIWWhqWmQzci9zYW5kYm94L3FlQjNyUDF1cVFRMW5jb3JrWVFUemQtaW1nLTRfMTc3MDgxNjMwNTAwMF9uYTFmbl9kMkZwZEdsdVp5MXliMjl0TFdKbi5wbmc~eC1vc3MtcHJvY2Vzcz1pbWFnZS9yZXNpemUsd18xOTIwLGhfMTkyMC9mb3JtYXQsd2VicC9xdWFsaXR5LHFfODAiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE3OTg3NjE2MDB9fX1dfQ__&Key-Pair-Id=K2HSFNDJXOU9YS&Signature=WT5M1Lhd9oSIvd5TaEXjIFS1AfUiETMrYE3OG5nFdYNZXQpGsA-pICOmUf7WEN6U4kY6qz8t7ggAwt0~nP8CTebOSNrzxtc61-eTtQkPLY6Gp3FwSDKVAbanOYwD3sUWt~r-l96D7nKlzdF8LN8Wk06bURvWlPVZwIZzYN4DqQE5E~V5BZzRc2GM682WGL6a7a11NfklU~5hpq8w-lrYMYoVnZG9ZxRhxf6wjNWsKN46vm7uvLKM0dRMA2STlshhIYY4EufYMLE1nMT5GfTihmF3uRAQuLhk-eamZcU-H83nmZMqr15xpk~x745vX2LRY12PndSKv57z15iPFI7vtQ__')`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      ></div>

      {/* Scanning line overlay */}
      <div className="scan-line absolute inset-0 z-10 pointer-events-none"></div>

      {/* Main Content */}
      <div className="relative z-20">
        {/* Header */}
        <header className="border-b border-primary/30 backdrop-blur-sm">
          <div className="container mx-auto px-6 py-4 flex items-center justify-between">
            <Button
              variant="ghost"
              onClick={() => setLocation('/')}
              className="text-foreground hover:text-primary glitch"
            >
              <ArrowLeft className="w-5 h-5 mr-2" />
              {t("backToLobby")}
            </Button>
            <div className="flex items-center gap-3">
              <Trophy className="w-8 h-8 neon-glow text-primary" />
              <h1 className="text-3xl font-bold neon-glow text-primary">{t("leaderboard")}</h1>
            </div>
            <LanguageSwitcher />
          </div>
        </header>

        {/* Content */}
        <section className="container mx-auto px-6 py-12">
          <Tabs defaultValue="rankings" className="w-full">
            <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-8 bg-card/50 border border-primary/30">
              <TabsTrigger value="rankings" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-data">
                <TrendingUp className="w-4 h-4 mr-2" />
                {t("rankings")}
              </TabsTrigger>
              <TabsTrigger value="history" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-data">
                <Clock className="w-4 h-4 mr-2" />
                {t("history")}
              </TabsTrigger>
            </TabsList>

            {/* Rankings Tab */}
            <TabsContent value="rankings">
              <Card className="bg-card/80 backdrop-blur-md border-primary/30 neon-border scan-line">
                <CardHeader>
                  <CardTitle className="text-2xl text-primary neon-glow">{t("topPlayers")}</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {t("rankedByNetEarnings")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {leaderboard.map((entry) => (
                      <div
                        key={entry.rank}
                        className="flex items-center gap-4 p-4 bg-background/50 border border-primary/30 rounded hover:border-primary/60 transition-colors"
                      >
                        <div className="flex items-center justify-center w-12">
                          {getRankIcon(entry.rank)}
                        </div>
                        <div className="flex-1">
                          <div className="mono text-foreground mb-1">{shortAddress(entry.player)}</div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground font-data">
                            <span>{entry.wins} {t("wins")}</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold font-data text-primary">
                            +{formatMistToSui(entry.total_earned_mist)} SUI
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history">
              <Card className="bg-card/80 backdrop-blur-md border-primary/30 neon-border scan-line">
                <CardHeader>
                  <CardTitle className="text-2xl text-primary neon-glow">{t("battleHistory")}</CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {t("recentSettledGames")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {history.map((entry) => (
                      <div
                        key={entry.game_id}
                        className="p-4 bg-background/50 border border-primary/30 rounded space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-muted-foreground font-data">
                            {new Date(entry.settled_at * 1000).toLocaleString()}
                          </div>
                          <div className="text-sm font-bold text-accent font-data">
                            {t("stake")} {formatMistToSui(entry.stake_amount_mist)} SUI
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className={`p-3 rounded border ${entry.winner ? 'border-primary bg-primary/10' : 'border-muted'}`}>
                            <div className="mono text-sm mb-2">{shortAddress(entry.winner)}</div>
                            <div className="text-xs text-primary font-bold mt-1 font-data">{t("winner")}</div>
                          </div>
                          <div className={`p-3 rounded border border-muted opacity-60`}>
                            <div className="mono text-sm mb-2">{shortAddress(entry.loser)}</div>
                            <div className="text-xs text-muted-foreground font-data">{t("loser")}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>
      </div>
    </div>
  );
}
