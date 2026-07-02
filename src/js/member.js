import { supabase, getCurrentUser, ensureProfile, confirmSignOut } from './supabase.js';
import { sortPositions, sortPositionEntries, candidatePhotoHtml, fetchCandidatePhotos } from './positionOrder.js';
import { escapeHtml, showToast, trapFocus } from './ui.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let activeRunoff = null;
let positions = [];
let candidates = [];
let userVotes = [];
let ballotSelections = {};
let hasSubmitted = false;

let confirmFocusCleanup = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const { data: currentUserData, error: sessionError } = await getCurrentUser();
        if (sessionError || !currentUserData?.user) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = currentUserData.user;

        const { profile, error: profileError } = await ensureProfile(currentUser);
        if (!profile) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentProfile = profile;

        if (profile.role === 'admin') {
            window.location.href = '/pages/admin/dashboard.html';
            return;
        }

        setupUserMenu(profile);

        document.getElementById('logout-btn')?.addEventListener('click', async () => {
            if (!(await confirmSignOut())) return;
            window.location.href = '/';
        });

        setupConfirmModal();

        await loadPage();
    } catch (err) {
        console.error('Member page error:', err);
        renderStatusPage({
            icon: '⚠',
            title: 'Something went wrong',
            message: 'Please refresh the page or sign in again. If this keeps happening, contact the election committee.',
            tone: 'info',
        });
    }
});

function isEligible() {
    return currentProfile.account_status === 'approved' && currentProfile.voting_rights;
}

function getFirstName() {
    return (currentProfile?.full_name || '').trim().split(' ')[0] || 'there';
}

function setupUserMenu(profile) {
    const initials = (profile.full_name || '')
        .split(' ')
        .filter(Boolean)
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase() || '?';

    const avatarEl = document.getElementById('user-avatar-initials');
    const nameEl = document.getElementById('user-menu-name');
    const emailEl = document.getElementById('user-menu-email');
    const btn = document.getElementById('user-menu-btn');
    const popover = document.getElementById('user-menu-popover');

    if (avatarEl) avatarEl.textContent = initials;
    if (nameEl) nameEl.textContent = profile.full_name || 'Member';
    if (emailEl) emailEl.textContent = profile.email || currentUser?.email || '';

    if (!btn || !popover) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = popover.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
        if (!popover.classList.contains('open')) return;
        if (e.target.closest('.user-menu')) return;
        popover.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && popover.classList.contains('open')) {
            popover.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
        }
    });
}

function renderStatusPage({ icon, title, message, tone = 'info' }) {
    renderMain(`
        <div class="status-card ${tone}">
            <div class="status-icon">${icon}</div>
            <h2>${title}</h2>
            <p>${message}</p>
        </div>
    `);
}

function countSelections() {
    return positions.filter(p => ballotSelections[p.id]).length;
}

async function loadPage() {
    hasSubmitted = false;
    ballotSelections = {};
    userVotes = [];
    activeElection = null;
    activeRunoff = null;
    positions = [];
    candidates = [];

    const { data: openElections, error: openErr } = await supabase
        .from('elections')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

    if (openErr) {
        renderStatusPage({
            icon: '⚠',
            title: 'Could not load election',
            message: 'Please check your connection and refresh. If this keeps happening, contact the election committee.',
            tone: 'info',
        });
        return;
    }

    if (openElections?.length) {
        activeElection = openElections[0];
        await loadElectionBallot();
        return;
    }

    const { data: openRunoffs, error: runoffErr } = await supabase
        .from('runoffs')
        .select('*, elections(*)')
        .eq('status', 'open')
        .limit(1);

    if (runoffErr) {
        renderStatusPage({
            icon: '⚠',
            title: 'Could not load runoff',
            message: 'Please check your connection and refresh.',
            tone: 'info',
        });
        return;
    }

    if (openRunoffs?.length) {
        activeRunoff = openRunoffs[0];
        activeElection = openRunoffs[0].elections;
        await loadRunoffBallot();
        return;
    }

    const { data: upcomingElections } = await supabase
        .from('elections')
        .select('*')
        .eq('status', 'upcoming')
        .order('created_at', { ascending: false })
        .limit(1);

    if (upcomingElections?.length) {
        activeElection = upcomingElections[0];
        renderEligibility();
        renderStatusPage({
            icon: '⏳',
            title: 'Voting has not started',
            message: `<strong>${activeElection.title}</strong> will open soon. Come back when the admin opens voting.`,
            tone: 'waiting',
        });
        return;
    }

    const { data: closedElections } = await supabase
        .from('elections')
        .select('*')
        .eq('status', 'closed')
        .order('created_at', { ascending: false })
        .limit(1);

    if (!closedElections?.length) {
        renderEligibility();
        renderStatusPage({
            icon: '📋',
            title: 'No election right now',
            message: 'There is nothing to vote on at the moment. Please check again later.',
            tone: 'info',
        });
        return;
    }

    activeElection = closedElections[0];
    await loadElectionBallot();
}

async function loadRunoffBallot() {
    const [{ data: rcData, error: rcErr }, { data: canData, error: canErr }] = await Promise.all([
        supabase.from('runoff_candidates').select('position_id, candidate_id').eq('runoff_id', activeRunoff.id),
        supabase.from('candidates').select('*'),
    ]);

    if (rcErr || canErr || !rcData?.length) {
        renderStatusPage({
            icon: '⚠',
            title: 'Runoff ballot not ready',
            message: 'Please contact the election committee.',
            tone: 'info',
        });
        return;
    }

    const allCandidates = canData || [];
    const candidateMap = new Map(allCandidates.map(c => [c.id, c]));
    const positionIds = [...new Set(rcData.map(r => r.position_id))];

    const { data: posData } = await supabase.from('positions').select('*').in('id', positionIds);
    positions = sortPositions(posData || []);
    candidates = rcData
        .map(r => candidateMap.get(r.candidate_id))
        .filter(Boolean);

    await loadUserRunoffVotes();
    renderEligibility();

    if (!isEligible()) {
        renderStatusPage({
            icon: '👋',
            title: 'Almost ready',
            message: 'Once an admin approves your account, your runoff ballot will show up here.',
            tone: 'waiting',
        });
        return;
    }
    if (hasSubmitted) {
        renderStatusPage({
            icon: '✓',
            title: 'Runoff vote recorded',
            message: `Thank you for voting in the runoff for <strong>${escapeHtml(activeElection.title)}</strong>.`,
            tone: 'success',
        });
        return;
    }
    renderBallot({ isRunoff: true });
}

async function loadUserRunoffVotes() {
    if (!activeRunoff) return;
    const { data } = await supabase
        .from('runoff_votes')
        .select('position_id, candidate_id')
        .eq('voter_id', currentUser.id)
        .eq('runoff_id', activeRunoff.id);

    userVotes = (data || []).map(v => v.position_id);
    ballotSelections = {};
    (data || []).forEach(v => {
        ballotSelections[v.position_id] = v.candidate_id;
    });
    hasSubmitted = positions.length > 0 && userVotes.length >= positions.length;
}

async function loadElectionBallot() {
    const [{ data: posData, error: posErr }, { data: canData, error: canErr }] = await Promise.all([
        supabase.from('positions').select('*'),
        supabase.from('candidates').select('*'),
    ]);

    if (posErr || canErr) {
        renderStatusPage({
            icon: '⚠',
            title: 'Could not load ballot',
            message: 'Please refresh the page. If this keeps happening, contact the election committee.',
            tone: 'info',
        });
        return;
    }

    candidates = canData || [];
    const activePositionIds = new Set(candidates.map(c => c.position_id));
    positions = sortPositions((posData || []).filter(p => activePositionIds.has(p.id)));

    await loadUserVotes();
    renderEligibility();

    if (activeElection.status === 'open') {
        if (!isEligible()) {
            renderStatusPage({
                icon: '👋',
                title: 'Almost ready',
                message: 'Once an admin approves your account, your ballot will show up here automatically.',
                tone: 'waiting',
            });
            return;
        }
        if (hasSubmitted) {
            renderStatusPage({
                icon: '✓',
                title: 'You\'re all done!',
                message: `Thank you for voting in <strong>${activeElection.title}</strong>. You can safely sign out now.`,
                tone: 'success',
            });
            return;
        }
        if (positions.length === 0) {
            renderStatusPage({
                icon: '📋',
                title: 'Ballot not ready',
                message: 'Candidates have not been added to this election yet. Please contact the election committee.',
                tone: 'info',
            });
            return;
        }
        renderBallot();
        return;
    }

    if (activeElection.results_published) {
        await renderResults();
        return;
    }

    renderStatusPage({
        icon: '⏳',
        title: 'Election ended',
        message: `<strong>${activeElection.title}</strong> is closed. Results will appear here when they are published.`,
        tone: 'waiting',
    });
}

async function loadUserVotes() {
    if (!activeElection) return;
    const { data } = await supabase
        .from('votes')
        .select('position_id, candidate_id')
        .eq('voter_id', currentUser.id)
        .eq('election_id', activeElection.id);

    userVotes = (data || []).map(v => v.position_id);
    ballotSelections = {};
    (data || []).forEach(v => {
        ballotSelections[v.position_id] = v.candidate_id;
    });
    hasSubmitted = positions.length > 0 && userVotes.length >= positions.length;
}

function renderEligibility() {
    const card = document.getElementById('eligibility-card');
    if (!card) return;

    if (!isEligible()) {
        const pending = currentProfile.account_status === 'pending';
        const rejected = currentProfile.account_status === 'rejected';
        card.className = `eligibility-card visible ${pending ? 'wait' : 'no'}`;
        card.innerHTML = `
            <div class="eligibility-icon">${pending ? '⏳' : '✕'}</div>
            <div class="eligibility-text">
                <strong>${pending ? 'Waiting for approval' : rejected ? 'Registration not approved' : 'Voting not available'}</strong>
                ${pending
                    ? 'An admin still needs to approve your account. You will be able to vote once that is done.'
                    : rejected
                        ? 'Your registration was not approved. Please contact the election committee if you have questions.'
                        : 'Please speak to the election committee if you think this is a mistake.'}
            </div>
        `;
        return;
    }

    if (hasSubmitted && (activeElection || activeRunoff)) {
        card.className = 'eligibility-card visible done';
        const label = activeRunoff
            ? `You finished voting in the runoff for ${activeElection?.title || 'this election'}.`
            : `You finished voting in ${activeElection.title}.`;
        card.innerHTML = `
            <div class="eligibility-icon">✓</div>
            <div class="eligibility-text">
                <strong>Vote recorded</strong>
                ${label} Thank you for taking part!
            </div>
        `;
        return;
    }

    if (activeRunoff?.status === 'open') {
        card.className = 'eligibility-card visible ok';
        card.innerHTML = `
            <div class="eligibility-icon">🗳️</div>
            <div class="eligibility-text">
                <strong>Runoff voting is open</strong>
                These positions were tied. Choose one candidate for each tied role below.
            </div>
        `;
        return;
    }

    if (activeElection?.status === 'open') {
        card.className = 'eligibility-card visible ok';
        card.innerHTML = `
            <div class="eligibility-icon">🗳️</div>
            <div class="eligibility-text">
                <strong>You're ready to vote!</strong>
                Choose one person for each position below, then press the big blue button at the bottom.
            </div>
        `;
        return;
    }

    card.className = 'eligibility-card visible ok';
    card.innerHTML = `
        <div class="eligibility-icon">✓</div>
        <div class="eligibility-text">
            <strong>Your account is approved</strong>
            You are ready to vote when an election opens.
        </div>
    `;
}

function renderMain(html) {
    document.getElementById('main-content').innerHTML = html;
}

function renderBallot({ isRunoff = false } = {}) {
    const chosen = countSelections();
    const total = positions.length;
    const pct = total > 0 ? Math.round((chosen / total) * 100) : 0;
    const allSelected = total > 0 && chosen >= total;
    const remaining = total - chosen;
    const firstName = getFirstName();
    const electionTitle = escapeHtml(activeElection?.title || 'Election');

    const positionBlocks = positions.map((pos, index) => {
        const posCandidates = candidates.filter(c => c.position_id === pos.id);
        const selectedId = ballotSelections[pos.id] || null;
        const selectedCand = selectedId ? candidates.find(c => c.id === selectedId) : null;
        const isDone = !!selectedId;

        const picks = posCandidates.map(c => {
            const isSelected = selectedId === c.id;
            const hasPhoto = c.photo_url && c.photo_url.trim() !== '' && !c.photo_url.includes('placeholder');
            const initials = c.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const photo = hasPhoto
                ? `<img src="${c.photo_url}" alt="" class="pick-photo">`
                : `<span class="pick-initials">${initials}</span>`;

            return `
                <button type="button" class="pick-item${isSelected ? ' selected' : ''}"
                    data-candidate="${c.id}" data-position="${pos.id}"
                    aria-pressed="${isSelected ? 'true' : 'false'}">
                    ${photo}
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

    renderMain(`
        <div class="vote-shell">
            <div class="vote-hero">
                <span class="live-badge">${isRunoff ? 'Runoff voting is open' : 'Voting is open'}</span>
                <h1 class="vote-hero-title">${electionTitle}${isRunoff ? ' — Runoff' : ''}</h1>
                <p class="vote-hero-greet">${isRunoff
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
                <button type="button" id="submit-votes-btn" class="btn-submit-votes" disabled>
                    ${allSelected
                        ? (isRunoff ? 'Review & submit runoff vote' : 'Review & submit my votes')
                        : `Choose ${remaining} more to continue`}
                </button>
            </div>
        </div>
    `);

    document.querySelectorAll('.pick-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const posId = btn.dataset.position;
            const candId = btn.dataset.candidate;
            ballotSelections[posId] = candId;
            renderBallot();
        });
    });

    const submitBtn = document.getElementById('submit-votes-btn');
    submitBtn.disabled = !allSelected;
    submitBtn.addEventListener('click', () => openConfirmModal());
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

function setupConfirmModal() {
    document.getElementById('confirm-cancel')?.addEventListener('click', hideConfirmModal);
    document.getElementById('confirm-submit')?.addEventListener('click', performSubmit);

    document.getElementById('confirm-modal')?.addEventListener('click', (e) => {
        if (e.target.id === 'confirm-modal') hideConfirmModal();
    });

    document.addEventListener('keydown', (e) => {
        const modal = document.getElementById('confirm-modal');
        if (!modal?.classList.contains('open')) return;
        if (e.key === 'Escape') hideConfirmModal();
    });
}

function openConfirmModal() {
    const selections = getSelections();

    if (selections.length < positions.length) {
        showToast('warning', 'Please pick one person for every position before submitting.');
        return;
    }

    const listEl = document.getElementById('confirm-list');
    listEl.innerHTML = selections.map(s => {
        const cand = candidates.find(c => c.id === s.candidateId);
        const avatar = candidatePhotoHtml(cand?.photo_url, cand?.full_name, {
            imgClass: 'pick-photo',
            fallbackClass: 'pick-initials',
        });

        return `
            <div class="confirm-row">
                ${avatar}
                <div class="confirm-row-text">
                    <span class="confirm-row-pos">${escapeHtml(s.positionName)}</span>
                    <span class="confirm-row-name">${escapeHtml(cand?.full_name || 'Unknown')}</span>
                </div>
            </div>
        `;
    }).join('');

    const submitBtn = document.getElementById('confirm-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = activeRunoff ? 'Submit runoff vote' : 'Submit votes';

    const modal = document.getElementById('confirm-modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    if (confirmFocusCleanup) confirmFocusCleanup();
    confirmFocusCleanup = trapFocus(modal.querySelector('.confirm-dialog'));
    document.getElementById('confirm-cancel')?.focus();
}

function hideConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    if (confirmFocusCleanup) {
        confirmFocusCleanup();
        confirmFocusCleanup = null;
    }
    document.getElementById('submit-votes-btn')?.focus();
}

async function performSubmit() {
    const selections = getSelections();
    if (selections.length < positions.length) return;

    const submitBtn = document.getElementById('confirm-submit');
    const pageSubmitBtn = document.getElementById('submit-votes-btn');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    if (pageSubmitBtn) {
        pageSubmitBtn.disabled = true;
        pageSubmitBtn.textContent = 'Submitting…';
    }

    try {
        if (activeRunoff) {
            const votesToInsert = selections.map(s => ({
                runoff_id: activeRunoff.id,
                voter_id: currentUser.id,
                candidate_id: s.candidateId,
                position_id: s.positionId,
            }));
            const { error } = await supabase.from('runoff_votes').insert(votesToInsert);
            if (error) throw error;

            hideConfirmModal();
            hasSubmitted = true;
            await loadUserRunoffVotes();
            renderEligibility();
            renderStatusPage({
                icon: '✓',
                title: 'Thank you!',
                message: `Your runoff vote for <strong>${escapeHtml(activeElection.title)}</strong> is in.`,
                tone: 'success',
            });
            return;
        }

        const votesToInsert = selections.map(s => ({
            voter_id: currentUser.id,
            candidate_id: s.candidateId,
            position_id: s.positionId,
            election_id: activeElection.id,
        }));

        const { error } = await supabase.from('votes').insert(votesToInsert);
        if (error) throw error;

        hideConfirmModal();
        hasSubmitted = true;
        await loadUserVotes();
        renderEligibility();
        renderStatusPage({
            icon: '✓',
            title: 'Thank you!',
            message: `Your votes for <strong>${activeElection.title}</strong> are in. You can safely sign out now.`,
            tone: 'success',
        });
    } catch (err) {
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('duplicate') || msg.includes('unique')) {
            showToast('warning', activeRunoff
                ? 'You have already submitted your runoff vote.'
                : 'You have already submitted your votes for this election.');
            hasSubmitted = true;
            if (activeRunoff) await loadUserRunoffVotes();
            else await loadUserVotes();
            renderEligibility();
            renderStatusPage({
                icon: '✓',
                title: 'Already voted',
                message: activeRunoff
                    ? `You have already voted in the runoff for <strong>${escapeHtml(activeElection.title)}</strong>.`
                    : `You have already voted in <strong>${activeElection.title}</strong>. Thank you for taking part!`,
                tone: 'success',
            });
        } else {
            showToast('error', 'Could not submit votes. Please try again or contact the election committee.');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit votes';
            if (pageSubmitBtn) {
                pageSubmitBtn.disabled = false;
                pageSubmitBtn.textContent = 'Submit my votes';
            }
        }
    }
}

async function renderResults() {
    renderMain(`
        <div class="loading-block">
            <div class="spinner"></div>
            <span>Loading results…</span>
        </div>
    `);

    const [{ data: results, error }, photoById] = await Promise.all([
        supabase.rpc('get_election_results', { election_id: activeElection.id }),
        fetchCandidatePhotos(supabase),
    ]);

    if (error) {
        renderStatusPage({
            icon: '⚠',
            title: 'Results unavailable',
            message: 'We could not load the results right now. Please try again in a few minutes.',
            tone: 'info',
        });
        return;
    }

    const rows = results || [];

    const groups = sortPositionEntries(
        Object.fromEntries(rows.map(r => [r.position_name, [r]]))
    ).map(([posName, [row]]) => {
        const outcome = row.outcome || 'winner';

        if (outcome === 'runoff_pending') {
            return `
                <div class="result-group result-group--pending">
                    <div class="result-pos-label">${escapeHtml(posName)}</div>
                    <p class="result-pending-msg">Tied — runoff election pending</p>
                </div>
            `;
        }
        if (outcome === 'runoff_open') {
            return `
                <div class="result-group result-group--pending">
                    <div class="result-pos-label">${escapeHtml(posName)}</div>
                    <p class="result-pending-msg">Tied — runoff voting is in progress</p>
                </div>
            `;
        }
        if (outcome === 'tie_unresolved') {
            return `
                <div class="result-group result-group--pending">
                    <div class="result-pos-label">${escapeHtml(posName)}</div>
                    <p class="result-pending-msg">Still tied after runoff — committee decision required</p>
                </div>
            `;
        }
        if (outcome === 'no_votes' || !row.candidate_id) {
            return `
                <div class="result-group result-group--pending">
                    <div class="result-pos-label">${escapeHtml(posName)}</div>
                    <p class="result-pending-msg">No votes recorded</p>
                </div>
            `;
        }

        const avatar = candidatePhotoHtml(photoById[row.candidate_id], row.candidate_name, {
            imgClass: 'pick-photo',
            fallbackClass: 'pick-initials',
        });
        const voteLabel = row.vote_count === 1 ? '1 vote' : `${row.vote_count} votes`;
        const runoffNote = outcome === 'runoff_winner'
            ? '<span class="result-runoff-badge">Runoff winner</span>'
            : '';

        return `
            <div class="result-group">
                <div class="result-pos-label">${escapeHtml(posName)}</div>
                <div class="result-row">
                    ${avatar}
                    <div>
                        <div class="result-winner-name">${escapeHtml(row.candidate_name)} ${runoffNote}</div>
                        <span class="result-vote-count">${voteLabel}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    renderMain(`
        <div class="result-shell">
            <div class="result-shell-head">
                <div class="election-label">${escapeHtml(activeElection.title)}</div>
                <h2>Election results</h2>
                <p class="result-shell-sub">Final outcomes for each position are shown below.</p>
            </div>
            ${groups || '<p class="result-empty">No results to show yet.</p>'}
        </div>
    `);
}
