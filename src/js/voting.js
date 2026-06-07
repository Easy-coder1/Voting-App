import { insforge } from './insforge.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let positions = [];
let candidates = [];
let userVotes = [];
let pendingSubmission = null;

// Tracks user's free selections per position { [positionId]: candidateId }
let ballotSelections = {};

// Once submitted, this flag locks the booth permanently for the session
let hasSubmitted = false;

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
        if (sessionError || !currentUserData) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = currentUserData;

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
        const initials = profile.full_name.split(' ').map(n => n[0]).join('').substring(0, 2);
        document.getElementById('user-avatar-badge').textContent = initials;

        // 3. Load Booth Data
        await loadBoothData();

        // Modal Listeners
        document.getElementById('modal-cancel').addEventListener('click', () => {
            hideModal();
        });

        document.getElementById('modal-confirm').addEventListener('click', async () => {
            if (!pendingSubmission || pendingSubmission.length === 0) return;

            const btn = document.getElementById('modal-confirm');
            btn.disabled = true;
            btn.textContent = 'Submitting...';

            try {
                const votesToInsert = pendingSubmission.map(v => ({
                    voter_id: currentUser.id,
                    candidate_id: v.candidateId,
                    position_id: v.positionId,
                    election_id: activeElection.id
                }));

                const { error } = await insforge.database.from('votes').insert(votesToInsert);

                if (error) throw error;

                // Mark as submitted and lock the booth
                hasSubmitted = true;
                await loadUserVotes();
                renderBallot();
                updateBoothProgress();
                showSuccessBanner('Your votes have been submitted. No more changes can be made.');
            } catch (error) {
                alert('Failed to submit votes: ' + error.message);
            } finally {
                hideModal();
                btn.disabled = false;
                btn.textContent = 'Confirm & Submit';
                pendingSubmission = null;
            }
        });

    } catch (err) {
        console.error('Booth loading error:', err);
        const panel = document.getElementById('panel-content');
        if (panel) {
            panel.innerHTML = `<div class="text-center py-12 text-red-650 font-semibold">Failed to load voting booth: ${err.message}</div>`;
        }
    }
});

async function loadBoothData() {
    // Check eligibility
    updateStatusBanner();

    // Verify user is eligible
    if (currentProfile.account_status !== 'approved' || !currentProfile.voting_rights) {
        renderMessage('Your account is not approved to cast votes.');
        return;
    }

    // Fetch active election
    const { data: elections } = await insforge.database.from('elections')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

    if (elections && elections.length > 0) {
        activeElection = elections[0];
        document.getElementById('election-title-sub').textContent = activeElection.title;
        
        // Load positions & candidates
        const [{ data: posData }, { data: canData }] = await Promise.all([
            insforge.database.from('positions').select('*'),
            insforge.database.from('candidates').select('*')
        ]);
        
        positions = posData || [];
        candidates = canData || [];
        
        await loadUserVotes();
        updateBoothProgress();

        // If the user already voted for ALL positions (previous session), lock immediately
        if (userVotes.length >= positions.length && positions.length > 0) {
            hasSubmitted = true;
        }

        renderBallot();
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
    // For progress tracking, map position_ids
    userVotes = (data || []).map(v => v.position_id);
    // Also seed selections from already-submitted votes (so locked view shows correct picks)
    (data || []).forEach(v => {
        ballotSelections[v.position_id] = v.candidate_id;
    });
}

function updateStatusBanner() {
    const banner = document.getElementById('status-banner');
    if (currentProfile.account_status !== 'approved' || !currentProfile.voting_rights) {
        banner.className = "flex items-start space-x-3 rounded-2xl p-4 mb-6 text-sm font-semibold bg-red-50 text-red-800 border border-red-200/60 shadow-sm";
        banner.innerHTML = `
            <svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            <span>Your account is not approved to vote. Exit this booth and contact support.</span>
        `;
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

function updateBoothProgress() {
    const total = positions.length;
    const cast = userVotes.length;
    document.getElementById('booth-progress-text').textContent = `${cast} / ${total}`;
}

function showSuccessBanner(message) {
    const banner = document.getElementById('status-banner');
    banner.className = "flex items-start space-x-3 rounded-2xl p-4 mb-6 text-sm font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/60 shadow-sm";
    banner.innerHTML = `
        <svg class="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
        <span>${message}</span>
    `;
    banner.classList.remove('hidden');
}

function renderMessage(msg) {
    document.getElementById('panel-content').innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 text-center text-slate-450 space-y-3">
            <svg class="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            <span class="text-sm font-semibold max-w-xs leading-relaxed text-slate-500">${msg}</span>
        </div>
    `;
}

function renderBallot() {
    const content = document.getElementById('panel-content');
    content.innerHTML = '';

    const isEligible = currentProfile.account_status === 'approved' && currentProfile.voting_rights;
    const isLocked = hasSubmitted || (positions.length > 0 && userVotes.length >= positions.length);

    // If locked, show a banner at the top of the ballot
    if (isLocked) {
        const lockBanner = document.createElement('div');
        lockBanner.className = "flex items-center justify-center space-x-2 rounded-2xl p-4 mb-8 text-sm font-bold bg-slate-50 border border-slate-200 text-slate-600";
        lockBanner.innerHTML = `
            <svg class="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
            <span>🔒 Ballot Locked — No further changes allowed</span>
        `;
        content.appendChild(lockBanner);
    }

    positions.forEach(pos => {
        const hasVoted = userVotes.includes(pos.id);
        const posCandidates = candidates.filter(c => c.position_id === pos.id);
        const selectedId = ballotSelections[pos.id] || null;

        const section = document.createElement('div');
        section.className = 'mb-12 last:mb-0 border-b border-slate-100 pb-10 last:border-b-0 last:pb-0';

        let headerHtml = `
            <div class="flex items-center justify-between mb-6">
                <h4 class="text-xl font-bold text-slate-900 tracking-tight">${pos.position_name}</h4>
                ${hasVoted 
                    ? '<span class="inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 border border-emerald-100 text-emerald-700"><span>✓ Completed</span></span>' 
                    : isLocked
                        ? '<span class="inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 border border-slate-200 text-slate-500"><span>Locked</span></span>'
                        : '<span class="inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 border border-indigo-100 text-indigo-700"><span>Pending Vote</span></span>'}
            </div>
        `;

        let candidatesHtml = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">';

        posCandidates.forEach(c => {
            const hasPhoto = c.photo_url && c.photo_url.trim() !== '' && !c.photo_url.includes('placeholder');
            const initials = c.full_name.split(' ').map(n => n[0]).join('').substring(0, 2);
            const isSelected = selectedId === c.id;

            let photoElement = '';
            if (hasPhoto) {
                photoElement = `<img src="${c.photo_url}" alt="${c.full_name}" class="w-24 h-24 rounded-full object-cover mb-4 border-4 border-white shadow-md">`;
            } else {
                photoElement = `<div class="w-24 h-24 rounded-full bg-gradient-to-tr from-church-600 via-indigo-500 to-violet-500 text-white font-black text-2xl flex items-center justify-center shadow-md uppercase border-4 border-white mb-4">${initials}</div>`;
            }

            // Card style — highlight if selected
            let cardClass = "rounded-3xl p-6 bg-slate-50 border flex flex-col items-center transition-all duration-300";
            if (isSelected && !isLocked) {
                cardClass += " border-church-400 bg-church-50/40 shadow-premium ring-2 ring-church-400/30";
            } else if (isSelected && isLocked) {
                cardClass += " border-church-300 bg-church-50/30";
            } else if (isLocked || hasVoted) {
                cardClass += " border-slate-100 opacity-60 cursor-not-allowed";
            } else {
                cardClass += " border-slate-100 hover:bg-white hover:border-slate-200/80 hover:shadow-premium hover:-translate-y-1 transform";
            }

            let buttonHtml = '';
            if (hasVoted) {
                // Already voted — show "Voted" badge
                buttonHtml = `
                    <span class="w-full block text-center py-3 rounded-full text-base font-bold bg-emerald-50 text-emerald-600 border border-emerald-100">
                        ✓ Voted
                    </span>
                `;
            } else if (isLocked) {
                // Locked — no button
                buttonHtml = `
                    <span class="w-full block text-center py-3 rounded-full text-base font-bold bg-slate-100 text-slate-400">
                        Locked
                    </span>
                `;
            } else if (isSelected) {
                // Selected — show "Deselect" 
                buttonHtml = `
                    <button onclick="window.toggleSelection('${c.id}', '${pos.id}')" 
                        class="w-full bg-white border-2 border-church-400 text-church-700 hover:bg-church-50 py-3 rounded-full text-base font-bold transition-all duration-300 active:scale-95">
                        Deselect
                    </button>
                `;
            } else {
                // Free to select
                buttonHtml = `
                    <button onclick="window.toggleSelection('${c.id}', '${pos.id}')" 
                        class="w-full bg-gradient-to-r from-church-600 to-church-500 hover:from-church-500 hover:to-church-400 text-white py-3 rounded-full hover:shadow-premium text-base font-bold transition-all duration-300 active:scale-95">
                        Select
                    </button>
                `;
            }

            candidatesHtml += `
                <div class="${cardClass}">
                    ${photoElement}
                    <span class="font-extrabold text-lg text-slate-800 text-center mb-6 leading-tight">${c.full_name}</span>
                    ${buttonHtml}
                </div>
            `;
        });
        candidatesHtml += '</div>';

        section.innerHTML = headerHtml + candidatesHtml;
        content.appendChild(section);
    });

    // If not locked and eligible, show the "Submit All Votes" button
    if (!isLocked && isEligible && positions.length > 0) {
        const submitContainer = document.createElement('div');
        submitContainer.className = 'flex flex-col items-center pt-8 border-t border-slate-100 mt-8';

        const selectionCount = Object.keys(ballotSelections).length;
        const isComplete = selectionCount >= positions.length;

        submitContainer.innerHTML = `
            <div class="text-sm text-slate-500 mb-4 font-semibold text-center">
                ${isComplete 
                    ? 'You have made selections for all positions.' 
                    : `Selected ${selectionCount} of ${positions.length} positions.`}
            </div>
            <button id="submit-all-btn" ${selectionCount === 0 ? 'disabled' : ''}
                class="px-10 py-4 rounded-full text-base font-bold shadow-premium transition-all duration-300 active:scale-95
                ${selectionCount > 0 
                    ? 'bg-gradient-to-r from-church-600 to-church-500 hover:from-church-500 hover:to-church-400 text-white hover:shadow-premium-lg cursor-pointer' 
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'}">
                Submit All Votes
            </button>
            <p class="text-xs text-slate-400 mt-3 font-medium">Review your selections carefully. This action is final.</p>
        `;

        content.appendChild(submitContainer);

        // Attach event listener to submit button
        document.getElementById('submit-all-btn').addEventListener('click', () => {
            showConfirmModal();
        });
    }
}

// Toggle selection — called from inline onclick
window.toggleSelection = (candidateId, positionId) => {
    if (hasSubmitted) return;

    if (ballotSelections[positionId] === candidateId) {
        // Deselect
        delete ballotSelections[positionId];
    } else {
        // Select (replaces any prior selection for this position)
        ballotSelections[positionId] = candidateId;
    }

    renderBallot();
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

    // Build modal summary
    let summaryHtml = '<div class="space-y-3 mb-6">';
    pendingSubmission.forEach(v => {
        summaryHtml += `
            <div class="flex justify-between items-center bg-slate-50 rounded-2xl px-4 py-3 border border-slate-100">
                <span class="font-semibold text-slate-600 text-sm">${v.positionName}</span>
                <span class="font-bold text-slate-900 text-sm">${v.candidateName}</span>
            </div>
        `;
    });
    summaryHtml += '</div>';

    summaryHtml += `
        <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center">
            <p class="text-sm font-bold text-amber-800">⚠️ This action is final. No more changes will be allowed.</p>
        </div>
    `;

    document.getElementById('modal-text').innerHTML = summaryHtml;
    document.getElementById('vote-modal').classList.remove('hidden');
    document.getElementById('vote-modal').classList.add('flex');
    document.getElementById('modal-confirm').textContent = 'Confirm & Submit';
}

function hideModal() {
    document.getElementById('vote-modal').classList.add('hidden');
    document.getElementById('vote-modal').classList.remove('flex');
}