import { supabase, getCurrentUser, ensureProfile, confirmSignOut } from './supabase.js';
import { sortPositions, sortPositionEntries, candidatePhotoHtml, fetchCandidatePhotos } from './positionOrder.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let positions = [];
let candidates = [];
let userVotes = [];
let ballotSelections = {};
let hasSubmitted = false;

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

        document.getElementById('user-name').textContent = profile.full_name;

        document.getElementById('logout-btn')?.addEventListener('click', async () => {
            if (!(await confirmSignOut())) return;
            window.location.href = '/';
        });

        setupConfirmModal();

        await loadPage();
    } catch (err) {
        console.error('Member page error:', err);
        renderMain(`
            <div class="simple-message">
                <p>Something went wrong. Please refresh the page or sign in again.</p>
            </div>
        `);
    }
});

function isEligible() {
    return currentProfile.account_status === 'approved' && currentProfile.voting_rights;
}

async function loadPage() {
    const { data: openElections } = await supabase
        .from('elections')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

    let elections = openElections;

    if (!elections?.length) {
        const { data: closedElections } = await supabase
            .from('elections')
            .select('*')
            .eq('status', 'closed')
            .order('created_at', { ascending: false })
            .limit(1);
        elections = closedElections;
    }

    if (!elections?.length) {
        activeElection = null;
        renderEligibility();
        renderMain(`
            <div class="simple-message">
                <div class="big">📋</div>
                <p>There is no election open for voting right now.<br>Please check back later.</p>
            </div>
        `);
        return;
    }

    activeElection = elections[0];

    const [{ data: posData }, { data: canData }] = await Promise.all([
        supabase.from('positions').select('*'),
        supabase.from('candidates').select('*').eq('election_id', activeElection.id),
    ]);

    candidates = canData || [];
    const activePositionIds = new Set(candidates.map(c => c.position_id));
    positions = sortPositions((posData || []).filter(p => activePositionIds.has(p.id)));

    await loadUserVotes();
    renderEligibility();

    if (activeElection.status === 'open') {
        if (!isEligible()) {
            renderMain(`
                <div class="simple-message">
                    <p>When your account is approved, your ballot will appear here.</p>
                </div>
            `);
            return;
        }
        if (hasSubmitted) {
            renderMain(`
                <div class="simple-message">
                    <div class="big">✓</div>
                    <p><strong>Thank you!</strong><br>Your votes have been submitted.<br>You can sign out now.</p>
                </div>
            `);
            return;
        }
        if (positions.length === 0) {
            renderMain(`
                <div class="simple-message">
                    <div class="big">📋</div>
                    <p>No candidates have been set up for this election yet.<br>Please contact the election committee.</p>
                </div>
            `);
            return;
        }
        renderBallot();
        return;
    }

    if (activeElection.results_published) {
        await renderResults();
        return;
    }

    renderMain(`
        <div class="simple-message">
            <div class="big">⏳</div>
            <p>Voting has ended.<br>Results will appear here when they are published.</p>
        </div>
    `);
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
        card.className = `eligibility-card visible ${pending ? 'wait' : 'no'}`;
        card.innerHTML = `
            <div class="eligibility-icon">${pending ? '⏳' : '✕'}</div>
            <div class="eligibility-text">
                <strong>${pending ? 'Not approved yet' : 'You cannot vote'}</strong>
                ${pending
                    ? 'Your account is waiting for approval. You will be able to vote once an admin approves you.'
                    : 'Your account does not have voting access. Please contact the election committee.'}
            </div>
        `;
        return;
    }

    if (hasSubmitted) {
        card.className = 'eligibility-card visible done';
        card.innerHTML = `
            <div class="eligibility-icon">✓</div>
            <div class="eligibility-text">
                <strong>You have voted</strong>
                Thank you for taking part in this election.
            </div>
        `;
        return;
    }

    if (activeElection?.status === 'open') {
        card.className = 'eligibility-card visible ok';
        card.innerHTML = `
            <div class="eligibility-icon">✓</div>
            <div class="eligibility-text">
                <strong>You can vote</strong>
                Pick one person for each position below, then tap Submit.
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

function renderBallot() {
    const positionBlocks = positions.map(pos => {
        const posCandidates = candidates.filter(c => c.position_id === pos.id);
        const selectedId = ballotSelections[pos.id] || null;

        const picks = posCandidates.map(c => {
            const isSelected = selectedId === c.id;
            const hasPhoto = c.photo_url && c.photo_url.trim() !== '' && !c.photo_url.includes('placeholder');
            const initials = c.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const photo = hasPhoto
                ? `<img src="${c.photo_url}" alt="" class="pick-photo">`
                : `<span class="pick-initials">${initials}</span>`;

            return `
                <button type="button" class="pick-item${isSelected ? ' selected' : ''}"
                    data-candidate="${c.id}" data-position="${pos.id}">
                    ${photo}
                    <span>${c.full_name}</span>
                    <span class="pick-check">${isSelected ? '✓' : ''}</span>
                </button>
            `;
        }).join('');

        return `
            <div class="position-block">
                <h3>${pos.position_name}</h3>
                <div class="pick-list">${picks}</div>
            </div>
        `;
    }).join('');

    renderMain(`
        <div class="vote-block">
            <p class="election-title">${activeElection.title}</p>
            <h2>Cast your vote</h2>
            <p class="hint">Tap a name under each position. When you are done, press Submit.</p>
            ${positionBlocks}
            <button type="button" id="submit-votes-btn" class="btn-submit-votes" disabled>
                Submit my votes
            </button>
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

    const allSelected = positions.every(p => ballotSelections[p.id]);
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
        if (e.key === 'Escape') hideConfirmModal();
    });
}

function openConfirmModal() {
    const selections = getSelections();

    if (selections.length < positions.length) {
        window.alert('Please pick one person for every position before submitting.');
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
                    <span class="confirm-row-pos">${s.positionName}</span>
                    <span class="confirm-row-name">${cand?.full_name || 'Unknown'}</span>
                </div>
            </div>
        `;
    }).join('');

    const submitBtn = document.getElementById('confirm-submit');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit votes';

    const modal = document.getElementById('confirm-modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
}

function hideConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
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
        renderMain(`
            <div class="simple-message">
                <div class="big">✓</div>
                <p><strong>Thank you!</strong><br>Your votes have been submitted.<br>You can sign out now.</p>
            </div>
        `);
    } catch (err) {
        window.alert('Could not submit votes: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit votes';
        if (pageSubmitBtn) {
            pageSubmitBtn.disabled = false;
            pageSubmitBtn.textContent = 'Submit my votes';
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
        fetchCandidatePhotos(supabase, activeElection.id),
    ]);

    if (error) {
        renderMain(`
            <div class="simple-message">
                <p>Results could not be loaded. Please try again later.</p>
            </div>
        `);
        return;
    }

    const grouped = {};
    (results || []).forEach(r => {
        if (!grouped[r.position_name]) grouped[r.position_name] = [];
        grouped[r.position_name].push(r);
    });

    let html = `
        <div class="result-block">
            <p class="election-title">${activeElection.title}</p>
            <h2>Election results</h2>
    `;

    for (const [posName, cans] of sortPositionEntries(grouped)) {
        cans.sort((a, b) => b.vote_count - a.vote_count);
        const winner = cans[0];
        if (!winner) continue;

        const avatar = candidatePhotoHtml(photoById[winner.candidate_id], winner.candidate_name, {
            imgClass: 'pick-photo',
            fallbackClass: 'pick-initials',
        });

        html += `
            <div class="result-pos">${posName}</div>
            <div class="result-row">
                ${avatar}
                <span>${winner.candidate_name}</span>
            </div>
        `;
    }

    html += '</div>';
    renderMain(html);
}
