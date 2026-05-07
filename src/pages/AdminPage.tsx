import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import useAuthSession from "../lib/useAuthSession";
import { normalizeUsername } from "../lib/usernameAuth";

type CompetitionRow = {
  id: string;
  name: string;
  start_date: string;
  is_active: boolean;
};

type CompetitionPlayerRow = {
  competition_id: string;
  user_id: string;
  player_name: string;
  role: "player" | "admin" | string;
};

type ProfileRow = {
  user_id: string;
  username: string;
  display_name: string;
};

type RoundRow = {
  id: string;
  round_number: number;
  status: "open" | "closed" | "settled" | string;
};

export default function AdminPage() {
  const { session } = useAuthSession();

  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [selectedCompetitionId, setSelectedCompetitionId] = useState<string | null>(null);

  const [players, setPlayers] = useState<CompetitionPlayerRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAnyAdmin, setIsAnyAdmin] = useState(false);

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);

  const [newCompetitionName, setNewCompetitionName] = useState("");
  const [newCompetitionMakeActive, setNewCompetitionMakeActive] = useState(true);

  const [usernameToAdd, setUsernameToAdd] = useState("");
  const [roleToAdd, setRoleToAdd] = useState<"player" | "admin">("player");
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);
  const [roundPoints, setRoundPoints] = useState<Record<string, number>>({});
  const [bulkPoints, setBulkPoints] = useState<number>(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!session) return;

      setLoading(true);
      setStatus(null);

      try {
        // "Global" admin check: admin of any competition.
        const { data: anyAdminRows, error: anyAdminErr } = await supabase
          .from("competition_players")
          .select("competition_id")
          .eq("user_id", session.user.id)
          .eq("role", "admin")
          .limit(1);
        if (anyAdminErr) throw anyAdminErr;
        if (!cancelled) setIsAnyAdmin((anyAdminRows ?? []).length > 0);

        const { data, error } = await supabase
          .from("competitions")
          .select("id,name,start_date,is_active")
          .order("start_date", { ascending: false });
        if (error) throw error;

        if (cancelled) return;
        const list = (data ?? []) as CompetitionRow[];
        setCompetitions(list);

        const active = list.find((c) => c.is_active) ?? list[0];
        setSelectedCompetitionId(active?.id ?? null);
      } catch (e) {
        if (!cancelled) {
          const msg =
            e && typeof e === "object"
              ? JSON.stringify(e, Object.getOwnPropertyNames(e))
              : String(e ?? "Unknown error");
          setStatus(`Failed to load competitions: ${msg}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function loadSelected() {
      if (!session || !selectedCompetitionId) return;
      setStatus(null);

      try {
        // Admin status for the selected competition.
        const { data: adminRows, error: adminErr } = await supabase
          .from("competition_players")
          .select("role")
          .eq("competition_id", selectedCompetitionId)
          .eq("user_id", session.user.id)
          .eq("role", "admin")
          .limit(1);
        if (adminErr) throw adminErr;

        if (cancelled) return;
        setIsAdmin((adminRows ?? []).length > 0);

        // Player list directory.
        const { data: playerRows, error: playersErr } = await supabase
          .from("competition_players_with_names")
          .select("competition_id,user_id,player_name,role")
          .eq("competition_id", selectedCompetitionId)
          .order("player_name", { ascending: true });
        if (playersErr) throw playersErr;

        if (cancelled) return;
        setPlayers((playerRows ?? []) as CompetitionPlayerRow[]);

        const { data: roundRows, error: roundsErr } = await supabase
          .from("rounds")
          .select("id,round_number,status")
          .eq("competition_id", selectedCompetitionId)
          .order("round_number", { ascending: false })
          .limit(12);
        if (roundsErr) throw roundsErr;
        if (cancelled) return;
        const castRounds = (roundRows ?? []) as RoundRow[];
        setRounds(castRounds);
        const open = castRounds.find((r) => r.status === "open") ?? null;
        setOpenRoundId(open?.id ?? null);

        const pointsInit: Record<string, number> = {};
        (playerRows ?? []).forEach((p: any) => {
          pointsInit[String(p.user_id)] = 0;
        });
        setRoundPoints(pointsInit);
      } catch (e) {
        if (!cancelled) {
          const msg =
            e && typeof e === "object"
              ? JSON.stringify(e, Object.getOwnPropertyNames(e))
              : String(e ?? "Unknown error");
          setStatus(`Failed to load competition data: ${msg}`);
        }
      }
    }

    loadSelected();
    return () => {
      cancelled = true;
    };
  }, [session, selectedCompetitionId]);

  const activeCompetitionName = useMemo(() => competitions.find((c) => c.is_active)?.name ?? null, [competitions]);

  async function reloadCompetitions() {
    const { data, error } = await supabase
      .from("competitions")
      .select("id,name,start_date,is_active")
      .order("start_date", { ascending: false });
    if (error) throw error;
    const list = (data ?? []) as CompetitionRow[];
    setCompetitions(list);
    return list;
  }

  async function onSetActive() {
    if (!selectedCompetitionId) return;
    if (!isAdmin) return;

    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.rpc("set_active_competition", {
        p_competition_id: selectedCompetitionId,
      });
      if (error) throw error;
      setStatus("Competition updated. Reloading...");
      await reloadCompetitions();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to set active competition");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateCompetition() {
    if (!session) return;

    const name = newCompetitionName.trim();
    if (!name) {
      setStatus("Enter a competition name.");
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const { data, error } = await supabase.rpc("create_competition", {
        p_name: name,
        p_start_date: new Date().toISOString().slice(0, 10),
        p_end_date: null,
        p_make_active: newCompetitionMakeActive,
      });
      if (error) throw error;

      const newId = typeof data === "string" ? data : null;
      setStatus("Competition created.");
      setNewCompetitionName("");

      const list = await reloadCompetitions();
      if (newId) setSelectedCompetitionId(newId);
      else setSelectedCompetitionId((list.find((c) => c.is_active) ?? list[0])?.id ?? null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : JSON.stringify(e));
    } finally {
      setBusy(false);
    }
  }

  async function onAddPlayer() {
    if (!selectedCompetitionId || !session) return;
    if (!isAdmin) return;

    const normalized = normalizeUsername(usernameToAdd);
    if (!normalized) {
      setStatus("Enter a username.");
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const { error: insertErr } = await supabase.from("competition_invites").upsert(
        {
          competition_id: selectedCompetitionId,
          username: normalized,
          role: roleToAdd,
        },
        { onConflict: "competition_id,username" },
      );
      if (insertErr) throw insertErr;

      setUsernameToAdd("");
      setRoleToAdd("player");
      setStatus(`Invited: ${normalized}. They will appear when they first log in.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to add player");
    } finally {
      setBusy(false);
    }
  }

  async function onRemovePlayer(userId: string) {
    if (!selectedCompetitionId) return;
    if (!isAdmin) return;

    const ok = window.confirm(`Remove this player from the whitelist?\n${userId}`);
    if (!ok) return;

    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase
        .from("competition_players")
        .delete()
        .eq("competition_id", selectedCompetitionId)
        .eq("user_id", userId);
      if (error) throw error;

      setStatus("Player removed.");
      const { data: playerRows, error: playersErr } = await supabase
        .from("competition_players_with_names")
        .select("competition_id,user_id,player_name,role")
        .eq("competition_id", selectedCompetitionId)
        .order("player_name", { ascending: true });
      if (playersErr) throw playersErr;
      setPlayers((playerRows ?? []) as CompetitionPlayerRow[]);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to remove player");
    } finally {
      setBusy(false);
    }
  }

  async function onCreateRound() {
    if (!selectedCompetitionId || !isAdmin) return;
    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.rpc("create_round", { p_competition_id: selectedCompetitionId });
      if (error) throw error;
      setStatus("Round created.");
      // reload selected section
      const { data: roundRows } = await supabase
        .from("rounds")
        .select("id,round_number,status")
        .eq("competition_id", selectedCompetitionId)
        .order("round_number", { ascending: false })
        .limit(12);
      const castRounds = (roundRows ?? []) as RoundRow[];
      setRounds(castRounds);
      setOpenRoundId(castRounds.find((r) => r.status === "open")?.id ?? null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to create round");
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitRoundResults() {
    if (!openRoundId || !isAdmin) return;
    setBusy(true);
    setStatus(null);
    try {
      const payload = players.map((p) => ({
        user_id: p.user_id,
        points: Math.max(0, Number(roundPoints[p.user_id] ?? 0)),
      }));
      const { error } = await supabase.rpc("submit_round_results", {
        p_round_id: openRoundId,
        p_results_json: payload,
      });
      if (error) throw error;
      setStatus("Round results submitted and settled. Odds and wallets updated.");

      const { data: roundRows } = await supabase
        .from("rounds")
        .select("id,round_number,status")
        .eq("competition_id", selectedCompetitionId)
        .order("round_number", { ascending: false })
        .limit(12);
      const castRounds = (roundRows ?? []) as RoundRow[];
      setRounds(castRounds);
      setOpenRoundId(castRounds.find((r) => r.status === "open")?.id ?? null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to submit round results");
    } finally {
      setBusy(false);
    }
  }

  async function onDeleteRound(roundId: string, roundNumber: number) {
    if (!isAdmin) return;
    const ok = window.confirm(
      `Delete round #${roundNumber}?\nThis will remove the round, nullify its results, and refund/nullify wagers for that round.`,
    );
    if (!ok) return;

    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.rpc("delete_round", { p_round_id: roundId });
      if (error) throw error;
      setStatus(`Round #${roundNumber} deleted and wagers/results nullified.`);
      if (!selectedCompetitionId) return;
      const { data: roundRows } = await supabase
        .from("rounds")
        .select("id,round_number,status")
        .eq("competition_id", selectedCompetitionId)
        .order("round_number", { ascending: false })
        .limit(12);
      const castRounds = (roundRows ?? []) as RoundRow[];
      setRounds(castRounds);
      setOpenRoundId(castRounds.find((r) => r.status === "open")?.id ?? null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to delete round");
    } finally {
      setBusy(false);
    }
  }

  function applyBulkPoints(value: number) {
    const v = Math.max(0, Number.isFinite(value) ? Math.floor(value) : 0);
    setRoundPoints((prev) => {
      const next = { ...prev };
      players.forEach((p) => {
        next[p.user_id] = v;
      });
      return next;
    });
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Admin</h1>

      {loading ? <div className="muted">Loading...</div> : null}
      {session ? (
        <div className="card muted" style={{ marginBottom: 12 }}>
          <div>
            Signed in as: <strong>{session.user.user_metadata?.full_name ?? "—"}</strong>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>
            user_id: {session.user.id}
            <br />
            username: {session.user.user_metadata?.username ?? "—"}
            <br />
            internal email: {session.user.email ?? "—"}
          </div>
        </div>
      ) : null}
      {status ? (
        <div className="card muted" style={{ marginBottom: 12, whiteSpace: "pre-wrap" }}>
          {status}
        </div>
      ) : null}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="muted">Current active competition: {activeCompetitionName ?? "—"}</div>

        <div className="field">
          <label>
            Manage competition
            <select
              value={selectedCompetitionId ?? ""}
              onChange={(e) => setSelectedCompetitionId(e.target.value || null)}
              style={{ marginTop: 6 }}
              disabled={competitions.length === 0}
            >
              {competitions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.is_active ? " (active)" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!isAdmin ? (
          <div className="muted" style={{ marginTop: 10 }}>
            You are not an admin for this competition. Your view is read-only.
          </div>
        ) : (
          <div className="row" style={{ marginTop: 10 }}>
            <button disabled={busy} onClick={onSetActive}>
              {busy ? "Updating..." : "Make selected competition active"}
            </button>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="muted">Create new competition</div>
        {!isAnyAdmin ? (
          <div className="muted" style={{ marginTop: 10 }}>
            You must be an admin to create competitions.
          </div>
        ) : (
          <div className="field">
            <label>
              Name
              <input
                value={newCompetitionName}
                onChange={(e) => setNewCompetitionName(e.target.value)}
                placeholder="Repovesi Open 2026"
              />
            </label>
            <label className="row" style={{ gap: 10 }}>
              <input
                type="checkbox"
                checked={newCompetitionMakeActive}
                onChange={(e) => setNewCompetitionMakeActive(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              Make active immediately
            </label>
            <button disabled={busy} onClick={onCreateCompetition}>
              {busy ? "Creating..." : "Create competition"}
            </button>
            <div className="muted" style={{ fontSize: 12 }}>
              If you get “Not authorized”, re-run the updated `supabase/schema.sql` in Supabase.
            </div>
          </div>
        )}
      </div>

      <div className="row">
        <div className="card" style={{ flex: "1 1 520px" }}>
          <div className="muted">Whitelisted players</div>

          {players.length === 0 ? (
            <div className="muted" style={{ marginTop: 10 }}>
              No players in the whitelist for this competition yet.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Player</th>
                  <th style={{ width: 260 }}>User ID</th>
                  <th style={{ width: 90 }}>Role</th>
                  <th style={{ width: 120 }} />
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.user_id}>
                    <td>{p.player_name}</td>
                    <td className="muted">{p.user_id}</td>
                    <td>{p.role}</td>
                    <td>
                      {isAdmin ? (
                        <button disabled={busy} onClick={() => onRemovePlayer(p.user_id)}>
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ flex: "1 1 360px" }}>
          <div className="muted">Add player to whitelist</div>

          <div className="field">
            <label>
              player name
              <input
                value={usernameToAdd}
                onChange={(e) => setUsernameToAdd(e.target.value)}
                placeholder="Anton S"
              />
            </label>

            <label>
              role
              <select
                value={roleToAdd}
                onChange={(e) => setRoleToAdd(e.target.value as "player" | "admin")}
                style={{ marginTop: 6 }}
                disabled={!isAdmin}
              >
                <option value="player">player</option>
                <option value="admin">admin</option>
              </select>
            </label>

            <button disabled={!isAdmin || busy} onClick={onAddPlayer}>
              {busy ? "Working..." : "Add"}
            </button>

            <div className="muted" style={{ fontSize: 12 }}>
              Add by name now. The user is activated automatically when they sign up / log in for
              the first time.
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="muted">Rounds and result settlement</div>
        {!isAdmin ? (
          <div className="muted" style={{ marginTop: 10 }}>
            Admin only.
          </div>
        ) : (
          <div className="field">
            <div className="row">
              <button disabled={busy || !selectedCompetitionId} onClick={onCreateRound}>
                {busy ? "Working..." : "Open next round"}
              </button>
              <div className="muted">
                Open round:{" "}
                {openRoundId
                  ? `#${rounds.find((r) => r.id === openRoundId)?.round_number ?? "?"}`
                  : "none"}
              </div>
            </div>

            <div className="muted" style={{ fontSize: 12 }}>
              Enter points for this round and settle bets.
            </div>

            <div className="row" style={{ gap: 10, marginTop: 8 }}>
              <input
                type="number"
                min={0}
                step={1}
                value={bulkPoints}
                onChange={(e) => setBulkPoints(Number(e.target.value))}
                style={{ flex: "0 0 140px" }}
              />
              <button disabled={busy || !players.length} onClick={() => applyBulkPoints(bulkPoints)}>
                Set all
              </button>
              <button disabled={busy || !players.length} onClick={() => applyBulkPoints(0)}>
                Zero all
              </button>
            </div>

            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {players.map((p) => (
                <div key={p.user_id} style={{ display: "grid", gap: 6 }}>
                  <div className="muted">{p.player_name}</div>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={roundPoints[p.user_id] ?? 0}
                    onChange={(e) =>
                      setRoundPoints((prev) => ({
                        ...prev,
                        [p.user_id]: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              ))}
            </div>

            <button disabled={busy || !openRoundId} onClick={onSubmitRoundResults}>
              {busy ? "Settling..." : "Submit round results and settle"}
            </button>

            <div className="muted" style={{ fontSize: 12 }}>
              Multiple player bets are allowed per round; this action closes and settles the open round.
            </div>

            <div className="muted" style={{ marginTop: 8 }}>
              Recent rounds
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {rounds.length === 0 ? (
                <div className="muted">No rounds yet.</div>
              ) : (
                rounds.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto auto",
                      gap: 10,
                      alignItems: "center",
                      border: "1px solid rgba(85, 74, 66, 0.18)",
                      borderRadius: 10,
                      padding: "8px 10px",
                      background: "rgba(255,255,255,0.45)",
                    }}
                  >
                    <div>
                      Round #{r.round_number}
                    </div>
                    <div className="badge">{r.status}</div>
                    <button disabled={busy} onClick={() => onDeleteRound(r.id, r.round_number)}>
                      Delete round
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

