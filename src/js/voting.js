import { insforge } from './insforge.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let positions = [];
let candidates = [];
let userVotes = [];
let pendingSubmission = null;
let ballotSelections = {};
let hasSubmitted = false;

// ── TOAST SYSTEM (WIMP: Notification) ────────────────────────────────
function showToast(type, message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast-${type}`;
    toast.innerHTML = `
        <svg class="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            ${type === 'success'
                ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>'
                : '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>'
            }
        </svg>
        <span>${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-8px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

async function ensureProfile(user) {
    const { data: profile, error: fetchError } = await insforge.database
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (fetchError) console.error('Profile fetch error:', fetchError);
    if (profile) return profile;

    const fullName = user.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Member';
    const phone = user.user_metadata?.phone || null;

    await insforge.database.from('profiles').insert([{
        id: user.id,
        full_name: fullName,
        email: user.email || '',
        phone: phone,
    }]);

    const { data: newProfile } = await insforge.database
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    return newProfile || null;
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Auth Check
        const { data: currentUserData, error: sessionError } = await insforge.auth.getCurrentUser();
        if (sessionError || !currentUserData?.user) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = currentUserData.user;

        // 2. Profile Check
        const profile = await ensureProfile(currentUser);
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
        const initials = profile.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const avatarEl = document.getElementById('user-avatar-badge');
        if (avatarEl) avatarEl.textContent = initials;

        // 3. Load Booth Data
        await loadBoothData();

        // Modal Listeners
        document.getElementById('modal-cancel').addEventListener('click', () => hideModal());
        document.getElementById('modal-confirm').addEventListener('click', async () => {
            if (!pendingSubmission || pendingSubmission.length === 0) return;

            const btn = document.getElementById('modal-confirm');
            btn.disabled = true;
            btn.textContent = 'Submitting…';

            try {
                const votesToInsert = pendingSubmission.map(v => ({
                    voter_id: currentUser.id,
                    candidate_id: v.candidateId,
                    position_id: v.positionId,
                    election_id: activeElection.id
                }));

                const { error } = await insforge.database.from('votes').insert(votesToInsert);
                if (error) throw error;

                hasSubmitted = true;
                await loadUserVotes();
                renderBallot();
                updateBoothProgress();
                updateActionBar();
                showToast('success', 'Your votes have been submitted successfully. No more changes can be made.');
                showSuccessBanner('Your votes have been submitted. No more changes can be made.');
            } catch (err) {
                showToast('error', 'Failed to submit votes: ' + err.message);
            } finally {
                hideModal();
                btn.disabled = false;
                btn.textContent = 'Confirm & Submit';
                pendingSubmission = null;
            }
        });

        // Mobile action bar submit
        document.getElementById('action-bar-submit')?.addEventListener('click', () => {
            showConfirmModal();
        });

        // Keyboard shortcut: Escape closes modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideModal();
        });

    } catch (err) {
        console.error('Booth loading error:', err);
        const panel = document.getElementById('panel-content');
        if (panel) {
            panel.innerHTML = `<div class="app-empty"><div class="app-empty-icon" style="background:var(--red-dim);border:1px solid rgba(244,63,94,0.15)"><svg width="24" height="24" fill="none" stroke="var(--red)" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div><span class="app-empty-title" style="color:var(--red)">Failed to load voting booth</span><span class="app-empty-sub">${err.message}</span></div>`;
        }
    }
});

async function loadBoothData() {
    updateStatusBanner();

    if (currentProfile.account_status !== 'approved' || !currentProfile.voting_rights) {
        renderMessage('Your account is not approved to cast votes.');
        return;
    }

    const { data: elections } = await insforge.database.from('elections')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

    if (elections && elections.length > 0) {
        activeElection = elections[0];
        document.getElementById('election-title-sub').textContent = activeElection.title;

        const [{ data: posData }, { data: canData }] = await Promise.all([
            insforge.database.from('positions').select('*'),
            insforge.database.from('candidates').select('*')
        ]);

        positions = posData || [];
        candidates = canData || [];

        await loadUserVotes();
        updateBoothProgress();

        if (userVotes.length >= positions.length && positions.length > 0) {
            hasSubmitted = true;
        }

        renderBallot();
        updateActionBar();
    } else {
        document.getElementById('election-title-sub').textContent = 'No active election';
        document.getElementById('booth-progress-text').textContent = '0 / 0';
        renderMessage('There are currently no active elections open for voting.');
    }
}

async function loadUserVotes() {
    if (!activeElection) return;
    const { data } = await insforge.database
        .from('votes')
        .select('position_id, candidate_id')
        .eq('voter_id', currentUser.id)
        .eq('election_id', activeElection.id);
    userVotes = (data || []).map(v => v.position_id);
    (data || []).forEach(v => {
        ballotSelections[v.position_id] = v.candidate_id;
    });
}

function updateStatusBanner() {
    const banner = document.getElementById('status-banner');
    if (!banner) return;
    if (currentProfile.account_status !== 'approved' || !currentProfile.voting_rights) {
        banner.className = 'app-alert app-alert-error visible';
        banner.innerHTML = `
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            <span>Your account is not approved to vote. Exit this booth and contact support.</span>
        `;
    } else {
        banner.className = 'app-alert';
        banner.innerHTML = '';
    }
}

function updateBoothProgress() {
    const total = positions.length;
    const cast = userVotes.length;
    document.getElementById('booth-progress-text').textContent = `${cast} / ${total}`;
}

function updateActionBar() {
    const bar = document.getElementById('mobile-action-bar');
    if (!bar) return;

    const isLocked = hasSubmitted || (positions.length > 0 && userVotes.length >= positions.length);
    if (isLocked) {
        bar.className = 'app-action-bar';
        return;
    }

    const selectionCount = Object.keys(ballotSelections).length;
    if (selectionCount > 0) {
        bar.className = 'app-action-bar is-active';
        document.getElementById('action-bar-text').textContent = `${selectionCount} of ${positions.length} selected`;
        const submitBtn = document.getElementById('action-bar-submit');
        submitBtn.disabled = selectionCount === 0;
    } else {
        bar.className = 'app-action-bar';
    }
}

function showSuccessBanner(message) {
    const banner = document.getElementById('status-banner');
    if (!banner) return;
    banner.className = 'app-alert app-alert-success visible';
    banner.innerHTML = `
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <span>${message}</span>
    `;
}

function renderMessage(msg) {
    document.getElementById('panel-content').innerHTML = `
        <div class="app-empty">
            <div class="app-empty-icon" style="background:var(--surface-3);border:1px solid var(--border)">
                <svg width="24" height="24" fill="none" stroke="var(--text-3)" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            </div>
            <span class="app-empty-sub">${msg}</span>
        </div>
    `;
}

function renderBallot() {
    const content = document.getElementById('panel-content');
    content.innerHTML = '';

    const isEligible = currentProfile.account_status === 'approved' && currentProfile.voting_rights;
    const isLocked = hasSubmitted || (positions.length > 0 && userVotes.length >= positions.length);

    // Locked banner (WIMP: Lock indicator)
    if (isLocked) {
        const lockBanner = document.createElement('div');
        lockBanner.className = 'app-lock-banner';
        lockBanner.innerHTML = `
            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            🔒 Ballot Locked — No further changes allowed
        `;
        content.appendChild(lockBanner);
    }

    positions.forEach(pos => {
        const hasVoted = userVotes.includes(pos.id);
        const posCandidates = candidates.filter(c => c.position_id === pos.id);
        const selectedId = ballotSelections[pos.id] || null;

        const section = document.createElement('div');
        section.className = 'app-pos-section';

        // Position status
        let statusClass = 'app-pos-pending';
        let statusText = 'Pending Vote';
        if (hasVoted) { statusClass = 'app-pos-done'; statusText = '✓ Completed'; }
        else if (isLocked) { statusClass = 'app-pos-locked'; statusText = 'Locked'; }

        let headerHtml = `
            <div class="app-pos-header">
                <span class="app-pos-name">${pos.position_name}</span>
                <span class="app-pos-status ${statusClass}">${statusText}</span>
            </div>
        `;

        let candidatesHtml = '<div class="app-cand-grid">';

        posCandidates.forEach(c => {
            const hasPhoto = c.photo_url && c.photo_url.trim() !== '' && !c.photo_url.includes('placeholder');
            const initials = c.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
            const isSelected = selectedId === c.id;

            let photoHtml = '';
            if (hasPhoto) {
                photoHtml = `<img src="${c.photo_url}" alt="${c.full_name}" class="app-cand-photo">`;
            } else {
                photoHtml = `<div class="app-cand-avatar" style="background:linear-gradient(135deg,var(--brand),#a78bfa)">${initials}</div>`;
            }

            // Card classes
            let cardClass = 'app-cand-card';
            if (isSelected && !isLocked) cardClass += ' selected';
            else if (isSelected && isLocked) cardClass += ' selected';
            else if (isLocked || hasVoted) cardClass += ' locked';
            else if (hasVoted) cardClass += ' voted';

            candidatesHtml += `
                <div class="${cardClass}" onclick="window.toggleSelection('${c.id}', '${pos.id}')" role="radio" aria-checked="${isSelected}" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' ')window.toggleSelection('${c.id}','${pos.id}')">
                    ${photoHtml}
                    <span class="app-cand-name">${c.full_name}</span>
                    <div class="app-cand-radio"></div>
                </div>
            `;
        });
        candidatesHtml += '</div>';

        section.innerHTML = headerHtml + candidatesHtml;
        content.appendChild(section);
    });

    // Submit button (desktop)
    if (!isLocked && isEligible && positions.length > 0) {
        const selectionCount = Object.keys(ballotSelections).length;
        const isComplete = selectionCount >= positions.length;

        const submitContainer = document.createElement('div');
        submitContainer.className = 'app-submit-area';
        submitContainer.innerHTML = `
            <span class="app-submit-count">${isComplete ? 'You have selected candidates for all positions.' : `Selected ${selectionCount} of ${positions.length} positions.`}</span>
            <button id="submit-all-btn" ${selectionCount === 0 ? 'disabled' : ''} class="app-btn-primary relative overflow-hidden">
                Submit All Votes
            </button>
            <span class="app-submit-note">Review your selections carefully. This action is final.</span>
        `;
        content.appendChild(submitContainer);

        document.getElementById('submit-all-btn').addEventListener('click', () => {
            showConfirmModal();
        });
    }
}

// Toggle selection — called from inline onclick
window.toggleSelection = (candidateId, positionId) => {
    if (hasSubmitted) return;

    if (ballotSelections[positionId] === candidateId) {
        delete ballotSelections[positionId];
    } else {
        ballotSelections[positionId] = candidateId;
    }

    renderBallot();
    updateActionBar();
};

function showConfirmModal() {
    const selections = Object.entries(ballotSelections);
    if (selections.length === 0) return;

    pendingSubmission = selections.map(([posId, candId]) => {
        const pos = positions.find(p => p.id === posId);
        const cand = candidates.find(c => c.id === candId);
        return {
            positionId: posId,
            candidateId: candId,
            positionName: pos ? pos.position_name : 'Unknown Position',
            candidateName: cand ? cand.full_name : 'Unknown Candidate'
        };
    });

    let summaryHtml = '';
    pendingSubmission.forEach(v => {
        summaryHtml += `
            <div class="app-modal-row">
                <span class="app-modal-row-name">${v.positionName}</span>
                <span class="app-modal-row-cand">${v.candidateName}</span>
            </div>
        `;
    });

    summaryHtml += `
        <div class="app-modal-warning">
            <p>⚠️ This action is final. No changes will be allowed after submission.</p>
        </div>
    `;

    document.getElementById('modal-text').innerHTML = summaryHtml;
    document.getElementById('vote-modal').classList.add('open');
}

function hideModal() {
    document.getElementById('vote-modal').classList.remove('open');
}