import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import useAuthSession from "../lib/useAuthSession";

type StandingRow = {
  player_id: string;
  player_name: string;
  total_points: number;
  best_round_points: number;
  avg_round_points: number;
  skill_level: number;
  current_odds: number;
  balance: number;
  best_payout: number;
};

function hashStringToInt(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function initials(name: string) {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function ShieldAvatar({ name, size = 54 }: { name: string; size?: number }) {
  const seed = hashStringToInt(name);
  const hue = seed % 360;
  const hue2 = (hue + 40 + (seed % 60)) % 360;
  const bg1 = `hsl(${hue} 35% 34%)`;
  const bg2 = `hsl(${hue2} 45% 22%)`;
  const stroke = "rgba(216, 183, 91, 0.65)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label={`Avatar for ${name}`}
      role="img"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={`g-${seed}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={bg1} />
          <stop offset="1" stopColor={bg2} />
        </linearGradient>
      </defs>
      <path
        d="M32 4c10 0 20 4 20 4v20c0 19-12.8 28.6-20 32-7.2-3.4-20-13-20-32V8s10-4 20-4z"
        fill={`url(#g-${seed})`}
        stroke={stroke}
        strokeWidth="2"
      />
      <path
        d="M32 8c8.6 0 16.8 3.2 16.8 3.2v16.8c0 15.8-10.6 24-16.8 27-6.2-3-16.8-11.2-16.8-27V11.2S23.4 8 32 8z"
        fill="rgba(0,0,0,0.12)"
      />
      <text
        x="32"
        y="36"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily='"Merriweather",Georgia,"Times New Roman",serif'
        fontSize="18"
        fill="rgba(243, 230, 200, 0.95)"
        style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.35)", strokeWidth: 2 }}
      >
        {initials(name)}
      </text>
    </svg>
  );
}

export default function StandingsPage() {
  const { session } = useAuthSession();
  const [competitionName, setCompetitionName] = useState<string | null>(null);
  const [rows, setRows] = useState<StandingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // Active competition (for now: pick the first one marked as active).
        const { data: comps, error: compErr } = await supabase
          .from("competitions")
          .select("id,name")
          .eq("is_active", true)
          .order("start_date", { ascending: false })
          .limit(1);
        if (compErr) throw compErr;

        const comp = comps?.[0];
        if (!comp) {
          if (!cancelled) setCompetitionName(null);
          if (!cancelled) setRows([]);
          return;
        }

        if (!cancelled) setCompetitionName(comp.name);

        // Supabase view `public.standings` is filtered to active competitions.
        const { data, error: standErr } = await supabase
          .from("standings")
          .select(
            "player_id,player_name,total_points,best_round_points,avg_round_points,skill_level,current_odds,balance,best_payout",
          );
        if (standErr) throw standErr;

        if (cancelled) return;

        const castRows = (data ?? []).map((r: any) => ({
          player_id: String(r.player_id ?? ""),
          player_name: String(r.player_name ?? ""),
          total_points: Number(r.total_points ?? 0),
          best_round_points: Number(r.best_round_points ?? 0),
          avg_round_points: Number(r.avg_round_points ?? 0),
          skill_level: Number(r.skill_level ?? 7.0),
          current_odds: Number(r.current_odds ?? 0),
          balance: Number(r.balance ?? 0),
          best_payout: Number(r.best_payout ?? 0),
        }));

        // Tie-breaker: best round points first, then higher totals, then name (deterministic).
        castRows.sort((a, b) => {
          if (b.total_points !== a.total_points) return b.total_points - a.total_points;
          if (b.best_round_points !== a.best_round_points) return b.best_round_points - a.best_round_points;
          return a.player_name.localeCompare(b.player_name);
        });

        setRows(castRows);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load standings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (session) load();
    else {
      setLoading(false);
      setRows([]);
      setCompetitionName(null);
    }

    return () => {
      cancelled = true;
    };
  }, [session]);

  const rankedRows = useMemo(() => {
    let currentRank = 0;
    let lastPoints: number | null = null;

    return rows.map((r, idx) => {
      if (lastPoints === null || r.total_points !== lastPoints) currentRank = idx + 1;
      lastPoints = r.total_points;
      return { ...r, rank: currentRank };
    });
  }, [rows]);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Sijoitukset</h1>
      {competitionName ? <div className="muted">Kilpailu: {competitionName}</div> : null}

      {loading ? <div className="muted">Ladataan...</div> : null}
      {error ? <div className="muted">Virhe: {error}</div> : null}

      {!loading && !competitionName ? (
        <div className="card muted">Aktiivista kilpailua ei löytynyt vielä.</div>
      ) : null}

      {!loading && competitionName ? (
        <div>
          {rankedRows.length === 0 ? (
            <div className="muted">
              No standings yet (or you may not be whitelisted in Supabase for this competition).
            </div>
          ) : (
            <>
              <div className="card leaderboard-surface" style={{ marginTop: 12, position: "relative", overflow: "hidden" }}>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    opacity: 0.06,
                    pointerEvents: "none",
                  }}
                  aria-hidden="true"
                >
                  <img src="/gamlakarleby-crest.png" alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>

                <div style={{ position: "relative", zIndex: 1 }}>
                  <div className="muted" style={{ marginBottom: 16 }}>
                    Paremmuussijoitus
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                      gap: 16,
                      marginTop: 10,
                    }}
                  >
                    {rankedRows.map((r) => {
                      const seed = hashStringToInt(r.player_name);
                      const hue = seed % 360;
                      const glowColor = `hsl(${hue} 100% 50%)`;

                      return (
                        <div
                          key={`${r.player_id}-${r.rank}`}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            padding: 12,
                            borderRadius: 16,
                            background: "rgba(255,255,255,0.08)",
                            border: "1px solid rgba(255,255,255,0.15)",
                            backdropFilter: "blur(10px)",
                            transition: "all 0.3s ease",
                            cursor: "default",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.15)";
                            e.currentTarget.style.border = `1px solid ${glowColor}`;
                            e.currentTarget.style.boxShadow = `0 0 20px ${glowColor}40`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                            e.currentTarget.style.border = "1px solid rgba(255,255,255,0.15)";
                            e.currentTarget.style.boxShadow = "none";
                          }}
                        >
                          <div
                            style={{
                              position: "relative",
                              marginBottom: 8,
                            }}
                          >
                            <div
                              style={{
                                position: "absolute",
                                inset: -8,
                                background: glowColor,
                                borderRadius: "50%",
                                opacity: 0.3,
                                filter: "blur(12px)",
                              }}
                              aria-hidden="true"
                            />
                            <ShieldAvatar name={r.player_name} size={64} />
                          </div>

                          <div
                            style={{
                              position: "absolute",
                              top: 4,
                              right: 8,
                              fontFamily: '"Merriweather",Georgia,"Times New Roman",serif',
                              fontSize: 16,
                              fontWeight: 700,
                              color: glowColor,
                              textShadow: `0 0 8px ${glowColor}80`,
                            }}
                          >
                            #{r.rank}
                          </div>

                          <div
                            style={{
                              textAlign: "center",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              width: "100%",
                            }}
                          >
                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                              {r.player_name}
                            </div>
                          </div>

                          <div
                            style={{
                              fontFamily: '"Merriweather",Georgia,"Times New Roman",serif',
                              fontSize: 20,
                              fontWeight: 700,
                              color: glowColor,
                              textShadow: `0 0 8px ${glowColor}80`,
                            }}
                          >
                            {r.total_points}
                          </div>
                          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                            pts
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="card leaderboard-surface" style={{ marginTop: 12 }}>
                <div className="muted">Kaikki pelaajat - Yksityiskohdat</div>
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {rankedRows.map((r) => (
                    <div
                      key={`${r.player_id}-${r.rank}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "60px 56px 1fr 120px 120px",
                        gap: 10,
                        alignItems: "center",
                        padding: "10px 10px",
                        border: "1px solid var(--line)",
                        borderRadius: 12,
                        background: "rgba(255,255,255,0.30)",
                      }}
                    >
                      <div
                        style={{
                          fontFamily: '"Merriweather",Georgia,"Times New Roman",serif',
                          color: "rgba(74, 69, 64, 0.9)",
                        }}
                      >
                        #{r.rank}
                      </div>
                      <ShieldAvatar name={r.player_name} size={44} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {r.player_name}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>
                          <span className="badge">paras {r.best_round_points}</span>{" "}
                          <span className="badge">ka {r.avg_round_points.toFixed(1)}</span>{" "}
                          <span className="badge">taito {r.skill_level.toFixed(2)}</span>{" "}
                          <span className="badge">kertoimet {r.current_odds.toFixed(2)}</span>{" "}
                          <span className="badge">{r.balance.toFixed(2)} db</span>{" "}
                        </div>
                      </div>
                      <div
                        style={{
                          fontFamily: '"Merriweather",Georgia,"Times New Roman",serif',
                          color: "rgba(74, 69, 64, 0.9)",
                          textAlign: "right",
                        }}
                      >
                        {r.total_points} pts
                      </div>
                      <div className="muted" style={{ textAlign: "right" }}>
                        paras voitto {r.best_payout.toFixed(2)} db
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

