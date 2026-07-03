import { sortPositions, candidatePhotoHtml } from './positionOrder.js';
import { escapeHtml, showToast, trapFocus } from './ui.js';
import { fetchValidOpenRunoff } from './runoff.js';
import '../css/vote-ballot.css';

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
let confirmFocusCleanup = null;

export function initAdminVote({ supabaseClient, getCurrentUser, getCurrentProfile }) {
    supabase = supabaseClient;
    getUser = getCurrentUser;
    getProfile = getCurrentProfile;
}

export async function loadAdminVoteTab() {
    const scope = document.getElementById('admin-vote-scope');
    const root = document.getElementById('admin-vote-root');
    const eligibility = document.getElementById('admin-vote-eligibility');
    if (!scope || !root) return;

    if (eligibility) {
        eligibility.className = 'eligibility-card';
        eligibility.innerHTML = '';
    }

    root.innerHTML = `
        <div class="loading-block">
            <div class="spinner"></div>
            <span>Getting your ballot ready…</span>
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
            await loadElectionBallot(root, eligibility);
            return;
        }

        const validRunoff = await fetchValidOpenRunoff(supabase);
        if (validRunoff) {
            activeRunoff = validRunoff.runoff;
            activeElection = validRunoff.election;
            isRunoff = true;
            await loadRunoffBallot(root, eligibility);
            return;
        }

        renderStatusPage(root, {
            icon: '🗳️',
            title: 'No open ballot',
            message: 'When an election or runoff is open, your ballot will appear here. You can vote once per election.',
            tone: 'info',
        });
    } catch (err) {
        renderStatusPage(root, {
            icon: '⚠',
            title: 'Could not load ballot',
            message: escapeHtml(err.message || 'Please refresh and try again.'),
            tone: 'info',
        });
    }
}

async function loadElectionBallot(root, eligibility) {
    const [{ data: posData }, { data: canData }] = await Promise.all([
        supabase.from('positions').select('*'),
        supabase.from('candidates').select('*').eq('election_id', activeElection.id),
    ]);

    candidates = canData || [];
    const activePositionIds = new Set(candidates.map(c => c.position_id));
    positions = sortPositions((posData || []).filter(p => activePositionIds.has(p.id)));

    await syncSubmittedState();

    if (hasSubmitted) {
        renderEligibility(eligibility, 'done');
        renderStatusPage(root, {
            icon: '✓',
            title: 'You\'re all done!',
            message: `Thank you for voting in <strong>${escapeHtml(activeElection.title)}</strong>. You can only vote once per election.`,
            tone: 'success',
        });
        return;
    }

    if (positions.length === 0) {
        renderStatusPage(root, {
            icon: '📋',
            title: 'Ballot not ready',
            message: 'This election has no candidates yet. Add candidates on the Candidates tab, then create a new election to include them.',
            tone: 'info',
        });
        return;
    }

    renderEligibility(eligibility, 'ok');
    renderBallot(root);
}

async function loadRunoffBallot(root, eligibility) {
    const [{ data: rcData, error: rcErr }, { data: canData, error: canErr }] = await Promise.all([
        supabase.from('runoff_candidates').select('position_id, candidate_id').eq('runoff_id', activeRunoff.id),
        supabase.from('candidates').select('*').eq('election_id', activeElection.id),
    ]);

    if (rcErr || canErr || !rcData?.length) {
        renderStatusPage(root, {
            icon: '⚠',
            title: 'Runoff ballot not ready',
            message: 'Tied positions are being prepared. Try again shortly.',
            tone: 'info',
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
        renderEligibility(eligibility, 'done');
        renderStatusPage(root, {
            icon: '✓',
            title: 'Runoff vote recorded',
            message: `Thank you for voting in the runoff for <strong>${escapeHtml(activeElection.title)}</strong>.`,
            tone: 'success',
        });
        return;
    }

    renderEligibility(eligibility, 'ok', true);
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

function getFirstName() {
    return (getProfile()?.full_name || 'Admin').trim().split(' ')[0] || 'Admin';
}

function renderEligibility(el, mode, runoffMode = false) {
    if (!el) return;

    if (mode === 'done') {
        el.className = 'eligibility-card visible done';
        el.innerHTML = `
            <div class="eligibility-icon">✓</div>
            <div class="eligibility-text">
                <strong>Vote recorded</strong>
                ${runoffMode || isRunoff
                    ? `You finished voting in the runoff for ${escapeHtml(activeElection?.title || 'this election')}.`
                    : `You finished voting in ${escapeHtml(activeElection?.title || 'this election')}.`}
            </div>
        `;
        return;
    }

    if (mode === 'ok') {
        el.className = 'eligibility-card visible ok';
        el.innerHTML = runoffMode || isRunoff
            ? `
                <div class="eligibility-icon">🗳️</div>
                <div class="eligibility-text">
                    <strong>Runoff voting is open</strong>
                    These positions were tied. Choose one candidate for each tied role below.
                </div>
            `
            : `
                <div class="eligibility-icon">🗳️</div>
                <div class="eligibility-text">
                    <strong>You're ready to vote!</strong>
                    Choose one person for each position below, then press the big blue button at the bottom.
                </div>
            `;
    }
}

function renderStatusPage(root, { icon, title, message, tone = 'info' }) {
    root.innerHTML = `
        <div class="status-card ${tone}">
            <div class="status-icon">${icon}</div>
            <h2>${title}</h2>
            <p>${message}</p>
        </div>
    `;
}

function countSelections() {
    return positions.filter(p => ballotSelections[p.id]).length;
}

function renderBallot(root, { isRunoff: runoffMode = false } = {}) {
    const chosen = countSelections();
    const total = positions.length;
    const pct = total > 0 ? Math.round((chosen / total) * 100) : 0;
    const allSelected = total > 0 && chosen >= total;
    const remaining = total - chosen;
    const firstName = escapeHtml(getFirstName());
    const electionTitle = escapeHtml(activeElection?.title || 'Election');

    const positionBlocks = positions.map((pos, index) => {
        const posCandidates = candidates.filter(c => c.position_id === pos.id);
        const selectedId = ballotSelections[pos.id] || null;
        const selectedCand = selectedId ? candidates.find(c => c.id === selectedId) : null;
        const isDone = !!selectedId;

        const picks = posCandidates.map(c => {
            const isSelected = selectedId === c.id;
            const avatar = candidatePhotoHtml(c.photo_url, c.full_name, {
                imgClass: 'pick-photo',
                fallbackClass: 'pick-initials',
            });

            return `
                <button type="button" class="pick-item${isSelected ? ' selected' : ''}"
                    data-candidate="${c.id}" data-position="${pos.id}"
                    aria-pressed="${isSelected ? 'true' : 'false'}">
                    ${avatar}
                    <span class="pick-name">
                        ${escapeHtml(c.full_name)}
                        <span class="pick-tag">${isSelected ? 'Your choice ✓' : 'Tap to select'}</span>
                    </span>
                    <span class="pick-check">${isSelected ? '✓' : ''}</span>
                </button>
            `;
        }).join('');

        return `
            <section class="position-card${isDone ? ' is-done' : ''}">
                <div class="position-card-head">
                    <span class="position-num">${index + 1}</span>
                    <div class="position-head-text">
                        <h3>${escapeHtml(pos.position_name)}</h3>
                        <p>${isDone ? `You chose: ${escapeHtml(selectedCand?.full_name)}` : 'Pick one candidate below'}</p>
                    </div>
                    ${isDone ? '<span class="position-done-badge">Done</span>' : ''}
                </div>
                <div class="pick-list">${picks}</div>
            </section>
        `;
    }).join('');

    const submitHint = allSelected
        ? 'All positions chosen — tap the button below to finish!'
        : remaining === 1
            ? 'Just 1 more position to go, then you can submit.'
            : `${remaining} positions left to choose before you can submit.`;

    root.innerHTML = `
        <div class="vote-shell">
            <div class="vote-hero">
                <span class="live-badge">${runoffMode ? 'Runoff voting is open' : 'Voting is open'}</span>
                <h1 class="vote-hero-title">${electionTitle}${runoffMode ? ' — Runoff' : ''}</h1>
                <p class="vote-hero-greet">${runoffMode
                    ? `Hello ${firstName}! These roles were tied — pick one candidate for each position below.`
                    : `Hello ${firstName}! Take your time and choose one person for each role.`}</p>
            </div>

            <div class="steps-row" aria-hidden="true">
                <div class="step-pill active">① Choose</div>
                <div class="step-pill">② Review</div>
                <div class="step-pill">③ Submit</div>
            </div>

            <div class="progress-card">
                <div class="progress-top">
                    <span class="progress-label">Your progress</span>
                    <span class="progress-count">${chosen} of ${total}</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${pct}%"></div>
                </div>
            </div>

            ${positionBlocks}

            <div class="submit-panel">
                <p class="submit-panel-hint${allSelected ? ' ready' : ''}">${submitHint}</p>
                <button type="button" id="admin-vote-submit-btn" class="btn-submit-votes" ${allSelected ? '' : 'disabled'}>
                    ${allSelected
                        ? (runoffMode ? 'Review & submit runoff vote' : 'Review & submit my votes')
                        : `Choose ${remaining} more to continue`}
                </button>
            </div>
        </div>
    `;

    root.querySelectorAll('.pick-item').forEach(btn => {
        btn.addEventListener('click', () => {
            ballotSelections[btn.dataset.position] = btn.dataset.candidate;
            renderBallot(root, { isRunoff: runoffMode });
        });
    });

    const submitBtn = root.querySelector('#admin-vote-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = !allSelected;
        submitBtn.addEventListener('click', () => openConfirmModal(runoffMode));
    }
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

    const modal = document.getElementById('admin-vote-confirm-modal');
    document.getElementById('admin-vote-confirm-cancel')?.addEventListener('click', hideConfirmModal);
    document.getElementById('admin-vote-confirm-submit')?.addEventListener('click', performVoteSubmit);
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) hideConfirmModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal?.classList.contains('open')) hideConfirmModal();
    });
}

function openConfirmModal(runoffMode) {
    setupVoteConfirmModal();

    const selections = getSelections();
    if (selections.length < positions.length) {
        showToast('warning', 'Please pick one person for every position before submitting.');
        return;
    }

    const listEl = document.getElementById('admin-vote-confirm-list');
    listEl.innerHTML = selections.map(s => {
        const cand = candidates.find(c => c.id === s.candidateId);
        const avatar = candidatePhotoHtml(cand?.photo_url, cand?.full_name, {
            imgClass: 'pick-photo',
            fallbackClass: 'pick-initials',
        });

        return `
            <div class="vote-confirm-row">
                ${avatar}
                <div class="vote-confirm-row-text">
                    <span class="vote-confirm-row-pos">${escapeHtml(s.positionName)}</span>
                    <span class="vote-confirm-row-name">${escapeHtml(cand?.full_name || 'Unknown')}</span>
                </div>
            </div>
        `;
    }).join('');

    const submitBtn = document.getElementById('admin-vote-confirm-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = runoffMode ? 'Yes, submit runoff vote' : 'Yes, submit my votes';

    const modal = document.getElementById('admin-vote-confirm-modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    if (confirmFocusCleanup) confirmFocusCleanup();
    confirmFocusCleanup = trapFocus(modal.querySelector('.vote-confirm-dialog'));
    document.getElementById('admin-vote-confirm-cancel')?.focus();
}

function hideConfirmModal() {
    const modal = document.getElementById('admin-vote-confirm-modal');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
    if (confirmFocusCleanup) {
        confirmFocusCleanup();
        confirmFocusCleanup = null;
    }
    document.getElementById('admin-vote-submit-btn')?.focus();
}

async function performVoteSubmit() {
    const user = getUser();
    if (!user) return;

    const selections = getSelections();
    if (selections.length < positions.length) return;

    const submitBtn = document.getElementById('admin-vote-confirm-submit');
    const pageSubmitBtn = document.getElementById('admin-vote-submit-btn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    if (pageSubmitBtn) {
        pageSubmitBtn.disabled = true;
        pageSubmitBtn.textContent = 'Submitting…';
    }

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

        hideConfirmModal();
        hasSubmitted = true;
        showToast('success', isRunoff ? 'Your runoff vote has been recorded.' : 'Your votes have been submitted.');
        await loadAdminVoteTab();
    } catch (err) {
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
            hideConfirmModal();
            hasSubmitted = true;
            showToast('warning', isRunoff
                ? 'You have already submitted your runoff vote.'
                : 'You have already submitted your votes for this election.');
            await loadAdminVoteTab();
            return;
        }
        showToast('error', 'Could not submit votes. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = isRunoff ? 'Yes, submit runoff vote' : 'Yes, submit my votes';
        if (pageSubmitBtn) {
            pageSubmitBtn.disabled = false;
            pageSubmitBtn.textContent = isRunoff ? 'Review & submit runoff vote' : 'Review & submit my votes';
        }
    }
}
