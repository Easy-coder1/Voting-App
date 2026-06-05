import { supabase } from './supabase.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let positions = [];
let candidates = [];
let userVotes = [];
let pendingVote = null;

async function ensureProfile(user) {
    const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (fetchError) console.error('Profile fetch error:', fetchError);
    if (profile) return profile;

    const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Member';
    const phone = user.user_metadata?.phone || null;

    await supabase.from('profiles').insert([{
        id: user.id,
        full_name: fullName,
        email: user.email || '',
        phone: phone,
    }]);

    const { data: newProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    return newProfile || null;
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Auth Check
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = session.user;

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
            document.getElementById('vote-modal').classList.add('hidden');
            document.getElementById('vote-modal').classList.remove('flex');
            pendingVote = null;
        });

        document.getElementById('modal-confirm').addEventListener('click', async () => {
            if (!pendingVote) return;

            const btn = document.getElementById('modal-confirm');
            btn.disabled = true;
            btn.textContent = 'Submitting...';

            try {
                const { error } = await supabase.from('votes').insert([{
                    voter_id: currentUser.id,
                    candidate_id: pendingVote.candidateId,
                    position_id: pendingVote.positionId
                }]);

                if (error) throw error;

                await loadUserVotes();
                renderBallot();
                updateBoothProgress();
            } catch (error) {
                alert('Failed to cast vote: ' + error.message);
            } finally {
                document.getElementById('vote-modal').classList.add('hidden');
                document.getElementById('vote-modal').classList.remove('flex');
                btn.disabled = false;
                btn.textContent = 'Confirm Vote';
                pendingVote = null;
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
    const { data: elections } = await supabase.from('elections')
        .select('*')
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

    if (elections && elections.length > 0) {
        activeElection = elections[0];
        document.getElementById('election-title-sub').textContent = activeElection.title;
        
        // Load positions & candidates
        const [{ data: posData }, { data: canData }] = await Promise.all([
            supabase.from('positions').select('*'),
            supabase.from('candidates').select('*')
        ]);
        
        positions = posData || [];
        candidates = canData || [];
        
        await loadUserVotes();
        updateBoothProgress();
        renderBallot();
    } else {
        document.getElementById('election-title-sub').textContent = 'No active election';
        document.getElementById('booth-progress-text').textContent = '0 / 0';
        renderMessage('There are currently no active elections open for voting.');
    }
}

async function loadUserVotes() {
    const { data } = await supabase.from('votes').select('position_id').eq('voter_id', currentUser.id);
    userVotes = (data || []).map(v => v.position_id);
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

    positions.forEach(pos => {
        const hasVoted = userVotes.includes(pos.id);
        const posCandidates = candidates.filter(c => c.position_id === pos.id);

        const section = document.createElement('div');
        section.className = 'mb-12 last:mb-0 border-b border-slate-100 pb-10 last:border-b-0 last:pb-0';

        let headerHtml = `
            <div class="flex items-center justify-between mb-6">
                <h4 class="text-xl font-bold text-slate-900 tracking-tight">${pos.position_name}</h4>
                ${hasVoted 
                    ? '<span class="inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 border border-emerald-100 text-emerald-700"><span>✓ Completed</span></span>' 
                    : '<span class="inline-flex items-center space-x-1 px-3 py-1 rounded-full text-xs font-bold bg-indigo-50 border border-indigo-100 text-indigo-700"><span>Pending Vote</span></span>'}
            </div>
        `;

        let candidatesHtml = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">';

        posCandidates.forEach(c => {
            const hasPhoto = c.photo_url && c.photo_url.trim() !== '' && !c.photo_url.includes('placeholder');
            const initials = c.full_name.split(' ').map(n => n[0]).join('').substring(0, 2);

            let photoElement = '';
            if (hasPhoto) {
                photoElement = `<img src="${c.photo_url}" alt="${c.full_name}" class="w-24 h-24 rounded-full object-cover mb-4 border-4 border-white shadow-md">`;
            } else {
                photoElement = `<div class="w-24 h-24 rounded-full bg-gradient-to-tr from-church-600 via-indigo-500 to-violet-500 text-white font-black text-2xl flex items-center justify-center shadow-md uppercase border-4 border-white mb-4">${initials}</div>`;
            }

            candidatesHtml += `
                <div class="rounded-3xl p-6 bg-slate-50 border border-slate-100 flex flex-col items-center transition-all duration-300 ${hasVoted ? 'opacity-55 cursor-not-allowed' : 'hover:bg-white hover:border-slate-200/80 hover:shadow-premium hover:-translate-y-1 transform'}">
                    ${photoElement}
                    <span class="font-extrabold text-lg text-slate-800 text-center mb-6 leading-tight">${c.full_name}</span>
                    ${!hasVoted && isEligible ? `
                        <button onclick="window.confirmVote('${c.id}', '${c.full_name}', '${pos.id}', '${pos.position_name}')" 
                            class="w-full bg-gradient-to-r from-church-600 to-church-500 hover:from-church-500 hover:to-church-400 text-white py-3 rounded-full hover:shadow-premium text-base font-bold transition-all duration-300 active:scale-95">
                            Vote
                        </button>
                    ` : ''}
                </div>
            `;
        });
        candidatesHtml += '</div>';

        section.innerHTML = headerHtml + candidatesHtml;
        content.appendChild(section);
    });
}

window.confirmVote = (candidateId, candidateName, positionId, positionName) => {
    pendingVote = { candidateId, positionId };
    document.getElementById('modal-text').innerHTML = `Are you sure you want to vote for <span class="font-bold text-slate-900">${candidateName}</span> as <span class="font-bold text-slate-900">${positionName}</span>?<br><span class="text-xs text-amber-600 font-semibold mt-2 block">This action cannot be undone.</span>`;
    document.getElementById('vote-modal').classList.remove('hidden');
    document.getElementById('vote-modal').classList.add('flex');
};
