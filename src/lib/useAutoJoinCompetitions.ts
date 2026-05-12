import { useEffect } from "react";
import { supabase } from "./supabaseClient";
import useAuthSession from "./useAuthSession";

/**
 * Auto-joins the current user to all active competitions they're invited to.
 * Runs once on mount when user is authenticated.
 */
export default function useAutoJoinCompetitions() {
  const { session } = useAuthSession();

  useEffect(() => {
    if (!session) return;

    let cancelled = false;

    async function autoJoin() {
      try {
        // Get user's profile to get username
        const { data: profile, error: profileErr } = await supabase
          .from("profiles")
          .select("username")
          .eq("user_id", session.user.id)
          .limit(1);
        if (profileErr) throw profileErr;

        const username = (profile?.[0] as any)?.username;
        if (!username) return;

        // Get all active competitions the user is invited to
        const { data: invites, error: invitesErr } = await supabase
          .from("competition_invites")
          .select("competition_id,role")
          .eq("username", username);
        if (invitesErr) throw invitesErr;

        const inviteList = (invites ?? []) as Array<{ competition_id: string; role: string }>;
        if (inviteList.length === 0) return;

        // For each invited competition, auto-add if not already a member
        for (const invite of inviteList) {
          const { data: existing } = await supabase
            .from("competition_players")
            .select("user_id")
            .eq("competition_id", invite.competition_id)
            .eq("user_id", session.user.id)
            .limit(1);

          if ((existing ?? []).length === 0) {
            // Not a member yet, add them
            await supabase.from("competition_players").insert({
              competition_id: invite.competition_id,
              user_id: session.user.id,
              role: invite.role,
            });
          }
        }
      } catch (e) {
        // Silently fail - not critical
        console.error("Auto-join competitions failed:", e);
      }
    }

    autoJoin();

    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);
}
