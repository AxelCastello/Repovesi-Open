import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import useAuthSession from "../lib/useAuthSession";

type Candidate = {
  player_id: string;
  player_name: string;
  current_odds: number;
  balance: number;
};

type BetRow = {
  id: string;
  amount: number;
  odds_snapshot: number;
  created_at: string;
  pick_name: string;
};

type RoundResultRow = {
  round_id: string;
  round_number: number;
  status: string;
  user_id: string;
  player_name: string;
  points: number;
};

type RoundBetRow = {
  id: string;
  round_id: string;
  user_id: string; // bettor
  pick_user_id: string;
  amount: number;
  odds_snapshot: number;
  settled: boolean;
  won: boolean | null;
  payout: number;
};

export default function BetPage() {
  const { session } = useAuthSession();
  const [competition, setCompetition] = useState<{ id: string; name: string } | null>(null);
  const [round, setRound] = useState<{ id: string; number: number } | null>(null);
  const [balance, setBalance] = useState<number>(0);
  const [players, setPlayers] = useState<Candidate[]>([]);
  const [bets, setBets] = useState<BetRow[]>([]);
  const [pickUserId, setPickUserId] = useState("");
  const [amount, setAmount] = useState<number>(5);
  const [status, setStatus] = useState<string | null>(null);
  const [roundResults, setRoundResults] = useState<RoundResultRow[]>([]);
  const [roundBets, setRoundBets] = useState<RoundBetRow[]>([]);
  const [tableRounds, setTableRounds] = useState<{ id: string; round_number: number; status: string }[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const selectedOdds = useMemo(
    () => players.find((p) => p.player_id === pickUserId)?.current_odds ?? 0,
    [players, pickUserId],
  );

  async function load() {
    if (!session) return;
    setLoading(true);
    setStatus(null);
    try {
      const { data: comps, error: compErr } = await supabase
        .from("competitions")
        .select("id,name")
        .eq("is_active", true)
        .order("start_date", { ascending: false })
        .limit(1);
      if (compErr) throw compErr;
      const comp = comps?.[0];
      if (!comp) {
        setCompetition(null);
        setRound(null);
        setPlayers([]);
        setBets([]);
        return;
      }
      setCompetition({ id: comp.id, name: comp.name });

      const { data: adminFlag, error: adminErr } = await supabase.rpc("is_competition_admin", {
        p_competition_id: comp.id,
      });
      if (adminErr) throw adminErr;
      setIsAdmin(Boolean(adminFlag));

      const { data: openRounds, error: roundErr } = await supabase
        .from("rounds")
        .select("id,round_number")
        .eq("competition_id", comp.id)
        .eq("status", "open")
        .order("round_number", { ascending: false })
        .limit(1);
      if (roundErr) throw roundErr;
      const openRound = openRounds?.[0] ?? null;
      setRound(openRound ? { id: openRound.id, number: openRound.round_number } : null);

      const { data: standings, error: standErr } = await supabase
        .from("standings")
        .select("player_id,player_name,current_odds,balance")
        .order("player_name", { ascending: true });
      if (standErr) throw standErr;
      const candidates = (standings ?? []).map((r: any) => ({
        player_id: String(r.player_id),
        player_name: String(r.player_name),
        current_odds: Number(r.current_odds ?? 0),
        balance: Number(r.balance ?? 0),
      }));
      setPlayers(candidates);
      if (!pickUserId && candidates[0]) setPickUserId(candidates[0].player_id);

      const me = (standings ?? []).find((r: any) => String(r.player_id) === session.user.id);
      setBalance(Number(me?.balance ?? 0));

      if (openRound) {
        const { data: myBets, error: betsErr } = await supabase
          .from("bets")
          .select("id,amount,odds_snapshot,created_at,pick_user_id")
          .eq("round_id", openRound.id)
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false });
        if (betsErr) throw betsErr;
        const pickNameMap = new Map(candidates.map((p) => [p.player_id, p.player_name]));
        setBets(
          (myBets ?? []).map((b: any) => ({
            id: String(b.id),
            amount: Number(b.amount),
            odds_snapshot: Number(b.odds_snapshot),
            created_at: String(b.created_at),
            pick_name: pickNameMap.get(String(b.pick_user_id)) ?? "Unknown",
          })),
        );
      } else {
        setBets([]);
      }

      const { data: roundsData, error: roundsListErr } = await supabase
        .from("rounds")
        .select("id,round_number,status")
        .eq("competition_id", comp.id)
        .order("round_number", { ascending: false })
        .limit(12);
      if (roundsListErr) throw roundsListErr;
      const roundList = roundsData ?? [];
      setTableRounds(roundList as any);
      const roundMap = new Map(
        roundList.map((r: any) => [String(r.id), { n: Number(r.round_number), s: String(r.status) }]),
      );

      const ids = roundList.map((r: any) => String(r.id));
      if (ids.length > 0) {
        const nameMap = new Map(candidates.map((p) => [p.player_id, p.player_name]));

        const { data: resultRows, error: rrErr } = await supabase
          .from("round_results")
          .select("round_id,user_id,points")
          .in("round_id", ids);
        if (rrErr) throw rrErr;

        const flat = (resultRows ?? []).map((rr: any) => ({
          round_id: String(rr.round_id),
          round_number: roundMap.get(String(rr.round_id))?.n ?? 0,
          status: roundMap.get(String(rr.round_id))?.s ?? "unknown",
          user_id: String(rr.user_id),
          player_name: nameMap.get(String(rr.user_id)) ?? "Unknown",
          points: Number(rr.points ?? 0),
        }));
        flat.sort((a, b) => b.round_number - a.round_number || b.points - a.points);
        setRoundResults(flat);

        const { data: betsRows, error: betsAllErr } = await supabase
          .from("bets")
          .select("id,round_id,user_id,pick_user_id,amount,odds_snapshot,settled,won,payout")
          .in("round_id", ids);
        if (betsAllErr) throw betsAllErr;

        setRoundBets(
          (betsRows ?? []).map((b: any) => ({
            id: String(b.id),
            round_id: String(b.round_id),
            user_id: String(b.user_id),
            pick_user_id: String(b.pick_user_id),
            amount: Number(b.amount ?? 0),
            odds_snapshot: Number(b.odds_snapshot ?? 0),
            settled: Boolean(b.settled),
            won: b.won === null || b.won === undefined ? null : Boolean(b.won),
            payout: Number(b.payout ?? 0),
          })),
        );
      } else {
        setRoundResults([]);
        setRoundBets([]);
        setTableRounds([]);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to load betting data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function onPlaceBet() {
    if (!round || !pickUserId) return;
    setBusy(true);
    setStatus(null);
    try {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Enter a valid bet amount.");
      const { error } = await supabase.rpc("place_bet", {
        p_round_id: round.id,
        p_pick_user_id: pickUserId,
        p_amount: amt,
      });
      if (error) throw error;
      setStatus("Wager placed.");
      await load();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to place wager");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteRound(roundId: string, roundNumber?: number) {
    if (!isAdmin) return;
    const ok = window.confirm(
      `Delete round${roundNumber ? ` #${roundNumber}` : ""}?\nThis removes results and wagers for that round (and refunds stakes).`,
    );
    if (!ok) return;
    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.rpc("delete_round", { p_round_id: roundId });
      if (error) throw error;
      setStatus("Round deleted.");
      await load();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to delete round");
    } finally {
      setBusy(false);
    }
  }

  const roundsAsc = useMemo(() => {
    return [...tableRounds].sort((a, b) => a.round_number - b.round_number);
  }, [tableRounds]);

  const betsUsedThisRound = useMemo(() => bets.length, [bets]);

  const pointsByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of roundResults) {
      m.set(`${r.round_id}::${r.user_id}`, r.points);
    }
    return m;
  }, [roundResults]);

  const betsAggByKey = useMemo(() => {
    // key: `${bettorId}::${roundId}`
    const m = new Map<
      string,
      {
        stake: number;
        payout: number;
        winCount: number;
        loseCount: number;
        hasAny: boolean;
      }
    >();
    for (const b of roundBets) {
      const key = `${b.user_id}::${b.round_id}`;
      const cur = m.get(key) ?? { stake: 0, payout: 0, winCount: 0, loseCount: 0, hasAny: false };
      cur.hasAny = true;
      cur.stake += b.amount;
      if (b.settled && b.won) cur.winCount += 1;
      if (b.settled && b.won === false) cur.loseCount += 1;
      cur.payout += b.settled && b.won ? b.payout : 0;
      m.set(key, cur);
    }
    return m;
  }, [roundBets]);

  const wagerMax = Math.max(0, Number(balance.toFixed(2)));

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Wager Board</h1>
      {loading ? <div className="muted">Loading...</div> : null}
      {status ? <div className="card muted">{status}</div> : null}

      {!loading && competition ? (
        <>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
            <div className="card" style={{ flex: "1 1 420px" }}>
            <div className="muted">Competition: {competition.name}</div>
            <div className="muted">Current round: {round ? `#${round.number} (open)` : "No open round"}</div>
            <div style={{ marginTop: 10 }} className="badge">
              Purse: {balance.toFixed(2)} dubloons
            </div>

            {round ? (
              <div className="field">
                <label>
                  Pick winner
                  <select value={pickUserId} onChange={(e) => setPickUserId(e.target.value)} style={{ marginTop: 6 }}>
                    {players.map((p) => (
                      <option key={p.player_id} value={p.player_id}>
                        {p.player_name} (odds {p.current_odds.toFixed(2)}, bal {p.balance.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Wager amount
                </label>
                <div className="row" style={{ gap: 12 }}>
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    style={{ flex: "0 0 160px" }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={wagerMax > 0 ? wagerMax : 0.01}
                    step={1}
                    value={Math.min(amount, wagerMax)}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    style={{ flex: "1 1 auto" }}
                    disabled={!round}
                  />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Potential payout: {(amount * selectedOdds).toFixed(2)} dubloons
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  Bets used this round: {betsUsedThisRound}/3
                </div>
                <button disabled={busy} onClick={onPlaceBet}>
                  {busy ? "Placing..." : "Place wager"}
                </button>
                <div className="muted" style={{ fontSize: 12 }}>
                  Multiple smaller bets per round are allowed.
                </div>
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 10 }}>
                No open round yet. Wait for admin to open one.
              </div>
            )}
          </div>

          <div className="card" style={{ flex: "1 1 360px" }}>
            <div className="muted">Your bets this round</div>
            {bets.length === 0 ? (
              <div className="muted" style={{ marginTop: 10 }}>
                No wagers yet.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Pick</th>
                    <th>Amount</th>
                    <th>Odds</th>
                    <th>Payout</th>
                  </tr>
                </thead>
                <tbody>
                  {bets.map((b) => (
                    <tr key={b.id}>
                      <td>{b.pick_name}</td>
                      <td>{b.amount.toFixed(2)}</td>
                      <td>{b.odds_snapshot.toFixed(2)}</td>
                      <td>{(b.amount * b.odds_snapshot).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="muted">Round results + wagers</div>
            {roundsAsc.length === 0 ? (
              <div className="muted" style={{ marginTop: 10 }}>
                No rounds recorded yet.
              </div>
            ) : (
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table className="matrix-table">
                  <thead>
                    <tr>
                      <th className="matrix-sticky-col">Player</th>
                      {roundsAsc.map((r) => (
                        <th key={r.id} className="matrix-round-col">
                          <div style={{ fontWeight: 700 }}>Round #{r.round_number}</div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {r.status}
                          </div>
                          {isAdmin ? (
                            <button
                              disabled={busy}
                              style={{ marginTop: 8, padding: "6px 10px", borderRadius: 10 }}
                              onClick={() => onDeleteRound(r.id, r.round_number)}
                            >
                              Delete
                            </button>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {players.map((p) => (
                      <tr key={p.player_id}>
                        <td className="matrix-sticky-col">
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <div style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--line)", background: "rgba(255,255,255,0.25)" }}>
                              <div style={{ padding: 7, fontSize: 12, fontWeight: 700, textAlign: "center" }}>
                                {p.player_name
                                  .trim()
                                  .split(/\s+/)
                                  .slice(0, 2)
                                  .map((s) => s[0]?.toUpperCase() ?? "")
                                  .join("")}
                              </div>
                            </div>
                            <div>
                              <div>{p.player_name}</div>
                              <div className="muted" style={{ fontSize: 12 }}>
                                {p.balance.toFixed(2)} db
                              </div>
                            </div>
                          </div>
                        </td>
                        {roundsAsc.map((r) => {
                          const points = pointsByKey.get(`${r.id}::${p.player_id}`);
                          const betsKey = `${p.player_id}::${r.id}`;
                          const agg = betsAggByKey.get(betsKey);
                          const stake = agg?.stake ?? 0;
                          const payout = agg?.payout ?? 0;
                          const winCount = agg?.winCount ?? 0;
                          const loseCount = agg?.loseCount ?? 0;

                          let outcome = "—";
                          let outcomeStyle: any;

                          if (!agg?.hasAny) {
                            outcome = "—";
                          } else if (r.status !== "settled") {
                            outcome = stake > 0 ? "Pending" : "—";
                            outcomeStyle = { borderColor: "rgba(140,59,54,0.35)" };
                          } else if (winCount > 0 && loseCount > 0) {
                            outcome = `Mixed (+${payout.toFixed(2)})`;
                            outcomeStyle = { borderColor: "rgba(196,164,90,0.35)" };
                          } else if (winCount > 0) {
                            outcome = `Win (+${payout.toFixed(2)})`;
                            outcomeStyle = { borderColor: "rgba(76,175,80,0.5)" };
                          } else if (loseCount > 0) {
                            outcome = "Lose";
                            outcomeStyle = { borderColor: "rgba(200,60,60,0.5)" };
                          }

                          return (
                            <td key={`${p.player_id}-${r.id}`} className="matrix-cell">
                              <div style={{ fontWeight: 800 }}>
                                {points !== undefined ? points : "—"}
                              </div>
                              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                                wager: {stake > 0 ? `${stake.toFixed(2)} db` : "—"}
                              </div>
                              <div className="badge" style={{ marginTop: 6, ...outcomeStyle }}>
                                {outcome}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

