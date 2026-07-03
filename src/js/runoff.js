export async function fetchValidOpenRunoff(supabase) {
    const { data, error } = await supabase
        .from('runoffs')
        .select('*, elections(*)')
        .eq('status', 'open')
        .limit(1);

    if (error) throw error;
    if (!data?.length) return null;

    const runoff = data[0];
    const election = runoff.elections;
    if (!election || election.status !== 'closed') return null;

    const { data: candidates, error: rcErr } = await supabase
        .from('runoff_candidates')
        .select('position_id')
        .eq('runoff_id', runoff.id);

    if (rcErr) throw rcErr;
    if (!candidates?.length) return null;

    return { runoff, election };
}
