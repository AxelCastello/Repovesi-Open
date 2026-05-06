import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import useAuthSession from "../lib/useAuthSession";

type Submission = {
  id: string;
  points: number;
  notes: string | null;
  created_at: string;
};

export default function SubmitResultPage() {
  const { session } = useAuthSession();
  const [competition, setCompetition] = useState<{ id: string; name: string } | null>(null);
  const [points, setPoints] = useState<number>(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

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
          if (!cancelled) setCompetition(null);
          if (!cancelled) setSubmissions([]);
          return;
        }

        if (!cancelled) setCompetition({ id: comp.id, name: comp.name });

        const { data: mySubs, error: subsErr } = await supabase
          .from("results")
          .select("id,points,notes,created_at")
          .eq("user_id", session.user.id)
          .order("created_at", { ascending: false })
          .limit(5);
        if (subsErr) throw subsErr;

        if (!cancelled) {
          setSubmissions(
            (mySubs ?? []).map((r: any) => ({
              id: String(r.id),
              points: Number(r.points ?? 0),
              notes: r.notes ? String(r.notes) : null,
              created_at: String(r.created_at),
            })),
          );
        }
      } catch (e) {
        if (cancelled) return;
        setStatus(e instanceof Error ? e.message : "Failed to load submission data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function onSubmit() {
    if (!session || !competition) return;
    setBusy(true);
    setStatus(null);
    try {
      const pointsNum = Number(points);
      if (!Number.isFinite(pointsNum) || pointsNum < 0) {
        throw new Error("Points must be a non-negative number.");
      }

      const { error: insertErr } = await supabase.from("results").insert({
        competition_id: competition.id,
        user_id: session.user.id,
        points: pointsNum,
        notes: notes.trim() ? notes.trim() : null,
      });
      if (insertErr) throw insertErr;

      setStatus("Submitted! Your standings will update shortly.");
      setNotes("");
      setPoints(0);

      // Refresh recent submissions.
      const { data: mySubs, error: subsErr } = await supabase
        .from("results")
        .select("id,points,notes,created_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (subsErr) throw subsErr;
      setSubmissions(
        (mySubs ?? []).map((r: any) => ({
          id: String(r.id),
          points: Number(r.points ?? 0),
          notes: r.notes ? String(r.notes) : null,
          created_at: String(r.created_at),
        })),
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to submit result");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Submit results</h1>

      {loading ? <div className="muted">Loading...</div> : null}
      {status ? <div className="card muted">{status}</div> : null}

      {!loading && !competition ? (
        <div className="card muted">No active competition found yet.</div>
      ) : null}

      {!loading && competition ? (
        <div className="row">
          <div className="card" style={{ flex: "1 1 380px" }}>
            <div className="muted">Competition: {competition.name}</div>
            <div className="field">
              <label>
                Points (numeric)
                <input
                  type="number"
                  value={points}
                  min={0}
                  step={1}
                  onChange={(e) => setPoints(Number(e.target.value))}
                />
              </label>
              <label>
                Notes (optional)
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any details you want to record..."
                  rows={4}
                />
              </label>
              <button disabled={busy} onClick={onSubmit}>
                {busy ? "Submitting..." : "Submit"}
              </button>
              <div className="muted">
                Your entry is stored in Supabase for the active competition. You can submit multiple times.
              </div>
            </div>
          </div>

          <div className="card" style={{ flex: "1 1 320px" }}>
            <div className="muted">Your latest submissions</div>
            {submissions.length === 0 ? (
              <div className="muted" style={{ marginTop: 10 }}>
                No submissions yet.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Points</th>
                    <th>Notes</th>
                    <th style={{ width: 180 }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.points}</td>
                      <td>{s.notes ?? <span className="muted">—</span>}</td>
                      <td>{new Date(s.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

