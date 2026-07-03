import { supabase, getCurrentUser, ensureProfile, confirmSignOut } from './supabase.js';
import { sortPositions, sortPositionEntries, candidatePhotoHtml, fetchCandidatePhotos } from './positionOrder.js';
import { escapeHtml, showToast, trapFocus } from './ui.js';
import { fetchValidOpenRunoff } from './runoff.js';

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

async function pickMemberElection({ status, resultsPublished = null }) {
    if (resultsPublished === true) {
        const { data: elections, error } = await supabase
            .from('elections')
            .select('*')
            .eq('status', status)
            .eq('results_published', true)
            .order('end_date', { ascending: false })
            .limit(1);
        if (error) throw error;
        return elections?.[0] || null;
    }

    let query = supabase
        .from('elections')
        .select('*')
        .eq('status', status)
        .order('end_date', { ascending: false });

    if (resultsPublished === false) {
        query = query.eq('results_published', false).limit(10);
    }

    const { data: elections, error } = await query;
    if (error) throw error;
    if (!elections?.length) return null;

    const electionIds = elections.map(e => e.id);
    const { data: voteRows, error: voteErr } = await supabase
        .from('votes')
        .select('election_id, voter_id')
        .in('election_id', electionIds);

    if (voteErr) throw voteErr;

    const votesByElection = new Map();
    for (const row of voteRows || []) {
        if (!votesByElection.has(row.election_id)) votesByElection.set(row.election_id, new Set());
        votesByElection.get(row.election_id).add(row.voter_id);
    }

    if (currentUser?.id) {
        const match = elections.find(e => votesByElection.get(e.id)?.has(currentUser.id));
        if (match) return match;
    }

    const withActivity = elections.filter(e => votesByElection.has(e.id));
    if (withActivity.length) return withActivity[0];

    return elections[0];
}

async function pickUpcomingElection() {
    const { data: elections, error } = await supabase
        .from('elections')
        .select('*')
        .eq('status', 'upcoming')
        .order('start_date', { ascending: true });

    if (error) throw error;
    return elections?.[0] || null;
}

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
        renderEligibility();
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
        .order('end_date', { ascending: false })
        .limit(1);

    if (openErr) {
        renderEligibility();
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

    let validRunoff = null;
    let publishedElection = null;
    let closedWaitingElection = null;
    let upcomingElection = null;
    let secondaryErr = null;

    try {
        [validRunoff, publishedElection, closedWaitingElection, upcomingElection] = await Promise.all([
            fetchValidOpenRunoff(supabase),
            pickMemberElection({ status: 'closed', resultsPublished: true }),
            pickMemberElection({ status: 'closed', resultsPublished: false }),
            pickUpcomingElection(),
        ]);
    } catch (err) {
        secondaryErr = err;
    }

    if (secondaryErr) {
        renderEligibility();
        renderStatusPage({
            icon: '⚠',
            title: 'Could not load election',
            message: 'Please refresh the page and try again.',
            tone: 'info',
        });
        return;
    }

    if (validRunoff) {
        activeRunoff = validRunoff.runoff;
        activeElection = validRunoff.election;
        await loadRunoffBallot();
        return;
    }

    // Show published results before other non-voting states so a newer
    // upcoming/closed election does not hide the election members should see.
    if (publishedElection) {
        activeElection = publishedElection;
        await loadElectionBallot();
        return;
    }

    if (closedWaitingElection) {
        activeElection = closedWaitingElection;
        await loadElectionBallot();
        return;
    }

    if (upcomingElection) {
        activeElection = upcomingElection;
        renderEligibility();
        renderStatusPage({
            icon: '⏳',
            title: 'Voting has not started',
            message: `<strong>${escapeHtml(activeElection.title)}</strong> will open soon. Come back when the admin opens voting.`,
            tone: 'waiting',
        });
        return;
    }

    renderEligibility();
    renderStatusPage({
        icon: '📋',
        title: 'No election right now',
        message: 'There is nothing to vote on at the moment. Please check again later.',
        tone: 'info',
    });
}

async function loadRunoffBallot() {
    const [{ data: rcData, error: rcErr }, { data: canData, error: canErr }] = await Promise.all([
        supabase.from('runoff_candidates').select('position_id, candidate_id').eq('runoff_id', activeRunoff.id),
        supabase.from('candidates').select('*').eq('election_id', activeElection.id),
    ]);

    if (rcErr || canErr || !rcData?.length) {
        renderEligibility();
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
        renderEligibility();
        renderStatusPage({
            icon: '👋',
            title: 'Almost ready',
            message: 'Once an admin approves your account, your runoff ballot will show up here.',
            tone: 'waiting',
        });
        return;
    }
    if (hasSubmitted) {
        renderEligibility();
        renderStatusPage({
            icon: '✓',
            title: 'Runoff vote recorded',
            message: `Thank you for voting in the runoff for <strong>${escapeHtml(activeElection.title)}</strong>.`,
            tone: 'success',
        });
        return;
    }
    renderEligibility();
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
    if (activeElection.status === 'closed' && activeElection.results_published) {
        await loadUserVotesForPublished();
        renderEligibility();
        await renderResults();
        return;
    }

    const { data: canData, error: canErr } = await supabase
        .from('candidates')
        .select('*')
        .eq('election_id', activeElection.id);

    if (canErr) {
        renderEligibility();
        renderStatusPage({
            icon: '⚠',
            title: 'Could not load ballot',
            message: 'Please refresh the page. If this keeps happening, contact the election committee.',
            tone: 'info',
        });
        return;
    }

    candidates = canData || [];
    const positionIds = [...new Set(candidates.map(c => c.position_id).filter(Boolean))];

    let posData = [];
    if (positionIds.length) {
        const { data, error: posErr } = await supabase
            .from('positions')
            .select('*')
            .in('id', positionIds);

        if (posErr) {
            renderEligibility();
            renderStatusPage({
                icon: '⚠',
                title: 'Could not load ballot',
                message: 'Please refresh the page. If this keeps happening, contact the election committee.',
                tone: 'info',
            });
            return;
        }
        posData = data || [];
    }

    positions = sortPositions(posData);

    await loadUserVotes();
    renderEligibility();

    if (activeElection.status === 'open') {
        if (!isEligible()) {
            renderEligibility();
            renderStatusPage({
                icon: '👋',
                title: 'Almost ready',
                message: 'Once an admin approves your account, your ballot will show up here automatically.',
                tone: 'waiting',
            });
            return;
        }
        if (hasSubmitted) {
            renderEligibility();
            renderStatusPage({
                icon: '✓',
                title: 'You\'re all done!',
                message: `Thank you for voting in <strong>${escapeHtml(activeElection.title)}</strong>. You can safely sign out now.`,
                tone: 'success',
            });
            return;
        }
        if (positions.length === 0) {
            renderEligibility();
            renderStatusPage({
                icon: '📋',
                title: 'Ballot not ready',
                message: 'Candidates have not been added to this election yet. Please contact the election committee.',
                tone: 'info',
            });
            return;
        }
        renderEligibility();
        renderBallot();
        return;
    }

    renderEligibility();
    renderStatusPage({
        icon: '⏳',
        title: 'Election ended',
        message: `<strong>${escapeHtml(activeElection.title)}</strong> is closed. Results will appear here when they are published.`,
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

async function loadUserVotesForPublished() {
    if (!activeElection) return;

    const [{ data: voteRows }, { data: candidateRows }] = await Promise.all([
        supabase
            .from('votes')
            .select('position_id, candidate_id')
            .eq('voter_id', currentUser.id)
            .eq('election_id', activeElection.id),
        supabase
            .from('candidates')
            .select('position_id')
            .eq('election_id', activeElection.id),
    ]);

    userVotes = (voteRows || []).map(v => v.position_id);
    ballotSelections = {};
    (voteRows || []).forEach(v => {
        ballotSelections[v.position_id] = v.candidate_id;
    });

    const ballotPositions = new Set((candidateRows || []).map(c => c.position_id).filter(Boolean)).size;
    hasSubmitted = ballotPositions > 0 && userVotes.length >= ballotPositions;
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

    if (activeElection?.status === 'upcoming') {
        card.className = 'eligibility-card visible wait';
        card.innerHTML = `
            <div class="eligibility-icon">⏳</div>
            <div class="eligibility-text">
                <strong>Voting has not started yet</strong>
                <strong>${escapeHtml(activeElection.title)}</strong> will open soon. This page will update automatically when voting begins.
            </div>
        `;
        return;
    }

    if (activeElection?.status === 'closed' && activeElection.results_published) {
        card.className = 'eligibility-card visible done';
        card.innerHTML = `
            <div class="eligibility-icon">📊</div>
            <div class="eligibility-text">
                <strong>Results are published</strong>
                Final outcomes for <strong>${escapeHtml(activeElection.title)}</strong> are shown below.
            </div>
        `;
        return;
    }

    if (activeElection?.status === 'closed') {
        card.className = 'eligibility-card visible wait';
        card.innerHTML = `
            <div class="eligibility-icon">⏳</div>
            <div class="eligibility-text">
                <strong>Election ended</strong>
                <strong>${escapeHtml(activeElection.title)}</strong> is closed. Results will appear here once they are published.
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

function outcomePendingMessage(outcome) {
    if (outcome === 'runoff_pending') return 'Tied — runoff election pending';
    if (outcome === 'runoff_open') return 'Tied — runoff voting is in progress';
    if (outcome === 'tie_unresolved') return 'Still tied after runoff — committee decision required';
    if (outcome === 'no_votes') return 'No votes recorded';
    return null;
}

function renderPublishedPositionCard(posName, candidates, outcomeRow, photoById) {
    const outcome = outcomeRow?.outcome || 'winner';
    const pendingMsg = outcomePendingMessage(outcome);
    const winnerId = (outcome === 'winner' || outcome === 'runoff_winner') ? outcomeRow?.candidate_id : null;
    const totalInPos = candidates[0]?.total_votes_in_position || 0;
    const sorted = [...candidates].sort((a, b) => b.vote_count - a.vote_count);
    const voteLabel = totalInPos === 1 ? '1 vote' : `${totalInPos} votes`;

    let bodyHtml = '';
    if (pendingMsg) {
        bodyHtml = `<p class="results-pos-pending">${escapeHtml(pendingMsg)}</p>`;
    }

    bodyHtml += sorted.map((c, index) => {
        const isWinner = winnerId && c.candidate_id === winnerId;
        const pct = totalInPos > 0 ? Math.round((c.vote_count / totalInPos) * 100) : 0;
        const rankBadge = isWinner
            ? '<span class="results-rank results-rank--winner" aria-hidden="true">👑</span>'
            : `<span class="results-rank">${index + 1}</span>`;

        const avatar = candidatePhotoHtml(photoById[c.candidate_id], c.candidate_name, {
            imgClass: 'results-cand-photo',
            fallbackClass: 'results-cand-initials',
        });

        const winnerBadge = isWinner
            ? `<span class="results-leading-badge">${outcome === 'runoff_winner' ? 'Runoff winner' : 'Winner'}</span>`
            : '';

        return `
            <div class="results-cand-row${isWinner ? ' is-winner' : ''}">
                <div class="results-cand-main">
                    ${rankBadge}
                    ${avatar}
                    <div class="results-cand-body">
                        <div class="results-cand-top">
                            <div class="results-cand-name-wrap">
                                <span class="results-cand-name">${escapeHtml(c.candidate_name)}</span>
                                ${winnerBadge}
                            </div>
                            <div class="results-cand-stats">
                                <span class="results-cand-votes${isWinner ? ' is-winner' : ''}">${c.vote_count}</span>
                                <span class="results-cand-pct">${pct}%</span>
                            </div>
                        </div>
                        <div class="results-bar-track">
                            <div class="results-bar-fill${isWinner ? ' is-winner' : ''}" style="width: ${pct}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <section class="results-pos-card">
            <header class="results-pos-header">
                <div class="results-pos-title">
                    <svg class="results-pos-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path>
                    </svg>
                    <h3 class="results-pos-name">${escapeHtml(posName)}</h3>
                </div>
                <span class="results-pos-total">${voteLabel.toUpperCase()}</span>
            </header>
            <div class="results-pos-body">
                ${bodyHtml}
            </div>
        </section>
    `;
}

async function renderResults() {
    renderMain(`
        <div class="loading-block">
            <div class="spinner"></div>
            <span>Loading results…</span>
        </div>
    `);

    const [{ data: summary, error: summaryError }, { data: outcomes, error: outcomesError }, photoById] = await Promise.all([
        supabase.rpc('get_published_election_summary', { p_election_id: activeElection.id }),
        supabase.rpc('get_election_results', { election_id: activeElection.id }),
        fetchCandidatePhotos(supabase, activeElection.id),
    ]);

    if (summaryError || outcomesError) {
        renderEligibility();
        renderStatusPage({
            icon: '⚠',
            title: 'Results unavailable',
            message: 'We could not load the results right now. Please try again in a few minutes.',
            tone: 'info',
        });
        return;
    }

    const outcomeByPosition = Object.fromEntries((outcomes || []).map(r => [r.position_name, r]));
    const grouped = {};
    for (const row of summary || []) {
        if (!grouped[row.position_name]) grouped[row.position_name] = [];
        grouped[row.position_name].push(row);
    }

    const positionCards = sortPositionEntries(grouped)
        .map(([posName, candidates]) => renderPublishedPositionCard(posName, candidates, outcomeByPosition[posName], photoById))
        .join('');

    renderMain(`
        <div class="result-shell">
            <header class="result-hero">
                <div class="result-hero-glow" aria-hidden="true"></div>
                <div class="result-hero-content">
                    <span class="result-published-badge">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                        </svg>
                        Official results
                    </span>
                    <h1 class="result-election-title">${escapeHtml(activeElection.title)}</h1>
                    <p class="result-results-heading">Election results</p>
                    <p class="result-shell-sub">Final outcomes for each position are shown below.</p>
                </div>
            </header>
            <div class="results-pos-list">
                ${positionCards || '<p class="result-empty">No results to show yet.</p>'}
            </div>
        </div>
    `);
}
