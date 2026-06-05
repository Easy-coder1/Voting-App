-- Add election_id to votes table to scope votes per election
ALTER TABLE votes ADD COLUMN election_id UUID REFERENCES elections(id) ON DELETE CASCADE;

-- Backfill election_id for existing votes based on the election that was active when they were cast
-- Since there's typically only one active election at a time, we associate votes with the election
-- that was open at the time of voting. If multiple elections overlap, this picks the closest one.
UPDATE votes v
SET election_id = sub.election_id
FROM (
    SELECT 
        v2.id AS vote_id,
        e.id AS election_id
    FROM votes v2
    JOIN elections e ON e.status = 'closed' OR e.status = 'open'
    WHERE v2.created_at >= e.start_date AND v2.created_at <= e.end_date
) sub
WHERE v.id = sub.vote_id;

-- If any votes still have NULL election_id (e.g., vote created outside any election window),
-- assign them to the most recent election as a fallback
UPDATE votes v
SET election_id = sub.election_id
FROM (
    SELECT id AS election_id FROM elections ORDER BY created_at DESC LIMIT 1
) sub
WHERE v.election_id IS NULL;

-- Now make election_id NOT NULL once backfilled
ALTER TABLE votes ALTER COLUMN election_id SET NOT NULL;

-- Drop the old global UNIQUE constraint
ALTER TABLE votes DROP CONSTRAINT votes_voter_id_position_id_key;

-- Add new per-election UNIQUE constraint
ALTER TABLE votes ADD CONSTRAINT votes_voter_id_position_id_election_id_key UNIQUE(voter_id, position_id, election_id);

-- Update votes RLS: members can only insert votes for the active election
DROP POLICY IF EXISTS "Members can insert vote if eligible." ON votes;
CREATE POLICY "Members can insert vote if eligible." ON votes FOR INSERT WITH CHECK (
  auth.uid() = voter_id AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
      AND account_status = 'approved' 
      AND voting_rights = true
  ) AND
  EXISTS (
    SELECT 1 FROM elections e
    WHERE e.id = election_id
      AND e.status = 'open'
  )
);
</｜｜DSML｜｜parameter>
<task_progress>
- [x] Analyze existing codebase (voting.js, voting.html, member.js, migrations)
- [x] Design solution architecture
- [x] Rewrite src/js/voting.js with free selection + submit-all + locked state
- [x] Update pages/member/voting.html
- [ ] Create DB migration to add election_id to votes table
- [ ] Update get_election_results RPC to filter by election
- [ ] Update admin RPCs to filter by election
- [ ] Update voting.js to use election_id
- [ ] Update member.js to filter votes by election
- [ ] Verify the complete flow
</｜｜DSML｜｜parameter>
</write_to_file>