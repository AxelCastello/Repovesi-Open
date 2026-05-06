import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import useAuthSession from "../lib/useAuthSession";

type Candidate = {
  player_id: string;
  player_name: string;
  current_odds: number;
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
  player_name: string;
  points: number;
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
        .limit(20);
      if (roundsListErr) throw roundsListErr;
      const roundList = roundsData ?? [];
      const roundMap = new Map(
        roundList.map((r: any) => [String(r.id), { n: Number(r.round_number), s: String(r.status) }]),
      );

      if (roundList.length > 0) {
        const ids = roundList.map((r: any) => String(r.id));
        const { data: resultRows, error: rrErr } = await supabase
          .from("round_results")
          .select("round_id,user_id,points")
          .in("round_id", ids);
        if (rrErr) throw rrErr;
        const nameMap = new Map(candidates.map((p) => [p.player_id, p.player_name]));
        const flat = (resultRows ?? []).map((rr: any) => ({
          round_id: String(rr.round_id),
          round_number: roundMap.get(String(rr.round_id))?.n ?? 0,
          status: roundMap.get(String(rr.round_id))?.s ?? "unknown",
          player_name: nameMap.get(String(rr.user_id)) ?? "Unknown",
          points: Number(rr.points ?? 0),
        }));
        flat.sort((a, b) => b.round_number - a.round_number || b.points - a.points);
        setRoundResults(flat);
      } else {
        setRoundResults([]);
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

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Wager Board</h1>
      {loading ? <div className="muted">Loading...</div> : null}
      {status ? <div className="card muted">{status}</div> : null}

      {!loading && competition ? (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="row">
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
                        {p.player_name} (odds {p.current_odds.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Wager amount
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={amount}
                    onChange={(e) => setAmount(Number(e.target.value))}
                  />
                </label>
                <div className="muted" style={{ fontSize: 12 }}>
                  Potential payout: {(amount * selectedOdds).toFixed(2)} dubloons
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

          <div className="card">
            <div className="muted">Round results log</div>
            {roundResults.length === 0 ? (
              <div className="muted" style={{ marginTop: 10 }}>
                No round results recorded yet.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                {Array.from(new Set(roundResults.map((r) => r.round_id))).map((rid) => {
                  const rows = roundResults
                    .filter((r) => r.round_id === rid)
                    .sort((a, b) => b.points - a.points || a.player_name.localeCompare(b.player_name));
                  const head = rows[0];
                  return (
                    <div
                      key={rid}
                      style={{
                        border: "1px solid rgba(85, 74, 66, 0.18)",
                        borderRadius: 10,
                        padding: 10,
                        background: "rgba(255,255,255,0.45)",
                      }}
                    >
                      <div className="row" style={{ justifyContent: "space-between" }}>
                        <div>
                          <strong>Round #{head.round_number}</strong>
                        </div>
                        <div className="badge">{head.status}</div>
                      </div>
                      <table style={{ marginTop: 8 }}>
                        <thead>
                          <tr>
                            <th>Player</th>
                            <th style={{ width: 120 }}>Points</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={`${r.round_id}-${r.player_name}`}>
                              <td>{r.player_name}</td>
                              <td>{r.points}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

