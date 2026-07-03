import { sortPositions, candidatePhotoHtml } from './positionOrder.js';
import { escapeHtml, showToast } from './ui.js';

let supabase = null;
let getUser = () => null;
let getProfile = () => null;

let activeElection = null;
let activeRunoff = null;
let positions = [];
let candidates = [];
let ballotSelections = {};
let hasSubmitted = false;
let isRunoff = false;
let voteModalBound = false;

export function initAdminVote({ supabaseClient, getCurrentUser, getCurrentProfile }) {
    supabase = supabaseClient;
    getUser = getCurrentUser;
    getProfile = getCurrentProfile;
}

export async function loadAdminVoteTab() {
    const root = document.getElementById('admin-vote-root');
    if (!root) return;

    root.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16 text-center text-slate-400 space-y-3">
            <div class="animate-spin rounded-full h-9 w-9 border-2 border-slate-200 border-t-church-600"></div>
            <span class="text-xs font-bold uppercase tracking-wider">Loading ballot…</span>
        </div>
    `;

    hasSubmitted = false;
    ballotSelections = {};
    activeElection = null;
    activeRunoff = null;
    positions = [];
    candidates = [];
    isRunoff = false;

    try {
        const { data: openElections, error: openErr } = await supabase
            .from('elections')
            .select('*')
            .eq('status', 'open')
            .order('created_at', { ascending: false })
            .limit(1);

        if (openErr) throw openErr;

        if (openElections?.length) {
            activeElection = openElections[0];
            await loadElectionBallot(root);
            return;
        }

        const { data: openRunoffs, error: runoffErr } = await supabase
            .from('runoffs')
            .select('*, elections(*)')
            .eq('status', 'open')
            .limit(1);

        if (runoffErr) throw runoffErr;

        if (openRunoffs?.length) {
            activeRunoff = openRunoffs[0];
            activeElection = openRunoffs[0].elections;
            isRunoff = true;
            await loadRunoffBallot(root);
            return;
        }

        renderVoteMessage(root, {
            icon: '🗳️',
            title: 'No open ballot',
            message: 'When an election or runoff is open, your ballot will appear here. You can vote once per election.',
            tone: 'muted',
        });
    } catch (err) {
        renderVoteMessage(root, {
            icon: '⚠',
            title: 'Could not load ballot',
            message: escapeHtml(err.message || 'Please refresh and try again.'),
            tone: 'error',
        });
    }
}

async function loadElectionBallot(root) {
    const [{ data: posData }, { data: canData }] = await Promise.all([
        supabase.from('positions').select('*'),
        supabase.from('candidates').select('*').eq('election_id', activeElection.id),
    ]);

    candidates = canData || [];
    const activePositionIds = new Set(candidates.map(c => c.position_id));
    positions = sortPositions((posData || []).filter(p => activePositionIds.has(p.id)));

    await syncSubmittedState();

    if (hasSubmitted) {
        renderVoteMessage(root, {
            icon: '✓',
            title: 'Vote recorded',
            message: `You have already voted in <strong>${escapeHtml(activeElection.title)}</strong>. Each admin may vote only once per election.`,
            tone: 'success',
        });
        return;
    }

    if (positions.length === 0) {
        renderVoteMessage(root, {
            icon: '📋',
            title: 'Ballot not ready',
            message: 'This election has no candidates yet. Add candidates to the roster, then create a new election to snapshot them.',
            tone: 'muted',
        });
        return;
    }

    renderBallot(root);
}

async function loadRunoffBallot(root) {
    const [{ data: rcData, error: rcErr }, { data: canData, error: canErr }] = await Promise.all([
        supabase.from('runoff_candidates').select('position_id, candidate_id').eq('runoff_id', activeRunoff.id),
        supabase.from('candidates').select('*').eq('election_id', activeElection.id),
    ]);

    if (rcErr || canErr || !rcData?.length) {
        renderVoteMessage(root, {
            icon: '⚠',
            title: 'Runoff ballot not ready',
            message: 'Tied positions are being prepared. Try again shortly.',
            tone: 'muted',
        });
        return;
    }

    const candidateMap = new Map((canData || []).map(c => [c.id, c]));
    const positionIds = [...new Set(rcData.map(r => r.position_id))];
    const { data: posData } = await supabase.from('positions').select('*').in('id', positionIds);

    positions = sortPositions(posData || []);
    candidates = rcData.map(r => candidateMap.get(r.candidate_id)).filter(Boolean);
    isRunoff = true;

    await syncSubmittedState();

    if (hasSubmitted) {
        renderVoteMessage(root, {
            icon: '✓',
            title: 'Runoff vote recorded',
            message: `You have already voted in the runoff for <strong>${escapeHtml(activeElection.title)}</strong>. Each person may vote only once per runoff.`,
            tone: 'success',
        });
        return;
    }

    renderBallot(root, { isRunoff: true });
}

async function syncSubmittedState() {
    const user = getUser();
    if (!user) return;

    if (isRunoff && activeRunoff) {
        const { count } = await supabase
            .from('runoff_votes')
            .select('*', { count: 'exact', head: true })
            .eq('voter_id', user.id)
            .eq('runoff_id', activeRunoff.id);
        hasSubmitted = (count || 0) > 0;
        return;
    }

    if (!activeElection) return;

    const { data } = await supabase
        .from('votes')
        .select('position_id, candidate_id')
        .eq('voter_id', user.id)
        .eq('election_id', activeElection.id);

    if (data?.length) {
        hasSubmitted = true;
        data.forEach(v => {
            ballotSelections[v.position_id] = v.candidate_id;
        });
    }
}

function renderVoteMessage(root, { icon, title, message, tone = 'muted' }) {
    const toneClass = {
        success: 'border-emerald-200 bg-emerald-50/80',
        error: 'border-red-200 bg-red-50/80',
        muted: 'border-slate-100 bg-white',
    }[tone] || 'border-slate-100 bg-white';

    root.innerHTML = `
        <div class="card-premium border ${toneClass} p-8 sm:p-10 text-center max-w-lg mx-auto">
            <div class="text-4xl mb-4" aria-hidden="true">${icon}</div>
            <h3 class="text-lg font-extrabold text-church-900 tracking-tight">${title}</h3>
            <p class="text-sm font-medium text-slate-500 mt-2 leading-relaxed">${message}</p>
        </div>
    `;
}

function countSelections() {
    return positions.filter(p => ballotSelections[p.id]).length;
}

function renderBallot(root, { isRunoff: runoffMode = false } = {}) {
    const profile = getProfile();
    const firstName = (profile?.full_name || 'Admin').trim().split(' ')[0] || 'Admin';
    const chosen = countSelections();
    const total = positions.length;
    const allSelected = total > 0 && chosen >= total;
    const remaining = total - chosen;
    const electionTitle = escapeHtml(activeElection?.title || 'Election');

    const positionBlocks = positions.map((pos, index) => {
        const posCandidates = candidates.filter(c => c.position_id === pos.id);
        const selectedId = ballotSelections[pos.id] || null;
        const selectedCand = selectedId ? candidates.find(c => c.id === selectedId) : null;
        const isDone = !!selectedId;

        const picks = posCandidates.map(c => {
            const isSelected = selectedId === c.id;
            const avatar = candidatePhotoHtml(c.photo_url, c.full_name, {
                imgClass: 'admin-ballot-photo',
                fallbackClass: 'admin-ballot-initials',
            });

            return `
                <button type="button"
                    class="admin-ballot-pick${isSelected ? ' is-selected' : ''}"
                    data-candidate="${c.id}"
                    data-position="${pos.id}"
                    aria-pressed="${isSelected ? 'true' : 'false'}">
                    ${avatar}
                    <span class="admin-ballot-pick-name">${escapeHtml(c.full_name)}</span>
                    <span class="admin-ballot-pick-tag">${isSelected ? 'Selected ✓' : 'Tap to select'}</span>
                </button>
            `;
        }).join('');

        return `
            <section class="card-premium border border-slate-100 overflow-hidden">
                <header class="flex items-center gap-3 px-4 sm:px-5 py-4 bg-church-50/80 border-b border-church-100">
                    <span class="admin-ballot-num">${index + 1}</span>
                    <div class="min-w-0">
                        <h4 class="text-base font-extrabold text-church-900 tracking-tight">${escapeHtml(pos.position_name)}</h4>
                        <p class="text-xs font-semibold text-slate-400 mt-0.5">${isDone ? `Your choice: ${escapeHtml(selectedCand?.full_name || '')}` : 'Choose one candidate'}</p>
                    </div>
                    ${isDone ? '<span class="ml-auto text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-full">Done</span>' : ''}
                </header>
                <div class="p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">${picks}</div>
            </section>
        `;
    }).join('');

    root.innerHTML = `
        <div class="space-y-6 max-w-3xl mx-auto">
            <div class="card-premium border border-church-100 p-5 sm:p-6 bg-gradient-to-br from-church-900 to-church-700 text-white">
                <span class="inline-flex items-center px-2.5 py-1 rounded-full bg-white/15 border border-white/20 text-[10px] font-extrabold uppercase tracking-wider mb-3">
                    ${runoffMode ? 'Runoff voting open' : 'Voting open'}
                </span>
                <h3 class="text-xl font-extrabold tracking-tight">${electionTitle}${runoffMode ? ' — Runoff' : ''}</h3>
                <p class="text-sm font-medium text-white/75 mt-2">Hello ${escapeHtml(firstName)} — pick one candidate for each position, then submit. You can only vote once.</p>
            </div>

            <div class="card-premium border border-slate-100 p-4 sm:p-5">
                <div class="flex items-center justify-between text-sm font-bold text-slate-600 mb-2">
                    <span>Your progress</span>
                    <span class="tabular-nums">${chosen} / ${total}</span>
                </div>
                <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div class="h-full rounded-full bg-church-600 transition-all duration-300" style="width:${total ? Math.round((chosen / total) * 100) : 0}%"></div>
                </div>
            </div>

            ${positionBlocks}

            <div class="card-premium border border-slate-100 p-5 sm:p-6 sticky bottom-4 z-20 shadow-card-hover">
                <p class="text-sm font-semibold text-slate-500 mb-4 text-center">
                    ${allSelected
                        ? 'All positions chosen — review and submit your ballot.'
                        : remaining === 1
                            ? 'One more position to go.'
                            : `${remaining} positions left before you can submit.`}
                </p>
                <button type="button" id="admin-vote-submit-btn" class="w-full btn-wine py-3.5" ${allSelected ? '' : 'disabled'}>
                    ${allSelected
                        ? (runoffMode ? 'Review & submit runoff vote' : 'Review & submit my vote')
                        : `Choose ${remaining} more to continue`}
                </button>
            </div>
        </div>
    `;

    root.querySelectorAll('.admin-ballot-pick').forEach(btn => {
        btn.addEventListener('click', () => {
            ballotSelections[btn.dataset.position] = btn.dataset.candidate;
            renderBallot(root, { isRunoff: runoffMode });
        });
    });

    root.querySelector('#admin-vote-submit-btn')?.addEventListener('click', () => {
        openVoteConfirmModal(runoffMode);
    });
}

function getSelections() {
    return positions
        .map(p => ({
            positionId: p.id,
            candidateId: ballotSelections[p.id],
            positionName: p.position_name,
        }))
        .filter(s => s.candidateId);
}

function setupVoteConfirmModal() {
    if (voteModalBound) return;
    voteModalBound = true;

    const modal = document.getElementById('vote-modal');
    const cancelBtn = document.getElementById('vote-modal-cancel');
    const confirmBtn = document.getElementById('vote-modal-confirm');

    cancelBtn?.addEventListener('click', hideVoteConfirmModal);
    confirmBtn?.addEventListener('click', performVoteSubmit);
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) hideVoteConfirmModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.classList.contains('flex')) hideVoteConfirmModal();
    });
}

function openVoteConfirmModal(runoffMode) {
    setupVoteConfirmModal();

    const selections = getSelections();
    if (selections.length < positions.length) {
        showToast('warning', 'Please pick one candidate for every position before submitting.');
        return;
    }

    const listEl = document.getElementById('vote-modal-list');
    listEl.innerHTML = selections.map(s => {
        const cand = candidates.find(c => c.id === s.candidateId);
        const avatar = candidatePhotoHtml(cand?.photo_url, cand?.full_name, {
            imgClass: 'admin-ballot-photo admin-ballot-photo--sm',
            fallbackClass: 'admin-ballot-initials admin-ballot-initials--sm',
        });

        return `
            <div class="flex items-center gap-3 py-2 border-b border-slate-100 last:border-0">
                ${avatar}
                <div class="min-w-0">
                    <p class="text-[11px] font-bold uppercase tracking-wider text-slate-400">${escapeHtml(s.positionName)}</p>
                    <p class="text-sm font-extrabold text-church-900 truncate">${escapeHtml(cand?.full_name || 'Unknown')}</p>
                </div>
            </div>
        `;
    }).join('');

    const confirmBtn = document.getElementById('vote-modal-confirm');
    confirmBtn.disabled = false;
    confirmBtn.textContent = runoffMode ? 'Submit runoff vote' : 'Submit my vote';

    const modal = document.getElementById('vote-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function hideVoteConfirmModal() {
    const modal = document.getElementById('vote-modal');
    modal?.classList.add('hidden');
    modal?.classList.remove('flex');
}

async function performVoteSubmit() {
    const user = getUser();
    if (!user) return;

    const selections = getSelections();
    if (selections.length < positions.length) return;

    const confirmBtn = document.getElementById('vote-modal-confirm');
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Submitting…';

    try {
        if (isRunoff && activeRunoff) {
            const votesToInsert = selections.map(s => ({
                runoff_id: activeRunoff.id,
                voter_id: user.id,
                candidate_id: s.candidateId,
                position_id: s.positionId,
            }));
            const { error } = await supabase.from('runoff_votes').insert(votesToInsert);
            if (error) throw error;
        } else {
            const votesToInsert = selections.map(s => ({
                voter_id: user.id,
                candidate_id: s.candidateId,
                position_id: s.positionId,
                election_id: activeElection.id,
            }));
            const { error } = await supabase.from('votes').insert(votesToInsert);
            if (error) throw error;
        }

        hideVoteConfirmModal();
        hasSubmitted = true;
        showToast('success', isRunoff ? 'Your runoff vote has been recorded.' : 'Your vote has been recorded.');
        await loadAdminVoteTab();
    } catch (err) {
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
            hideVoteConfirmModal();
            hasSubmitted = true;
            showToast('warning', isRunoff
                ? 'You have already submitted your runoff vote.'
                : 'You have already voted in this election.');
            await loadAdminVoteTab();
            return;
        }
        showToast('error', 'Could not submit vote: ' + (err.message || 'Unknown error'));
        confirmBtn.disabled = false;
        confirmBtn.textContent = isRunoff ? 'Submit runoff vote' : 'Submit my vote';
    }
}
