import { supabase } from './supabase.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let positions = [];
let candidates = [];
let userVotes = [];
let countdownInterval = null;

let pendingVote = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Auth Check
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = session.user;

        // 2. Load Profile
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (profileError || !profile) {
            console.error('Profile load error:', profileError);
            // Try a one-time profile creation from auth user metadata as fallback
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Member';
                const { error: insertError } = await supabase
                    .from('profiles')
                    .insert([{
                        id: user.id,
                        full_name: fullName,
                        email: user.email || '',
                        phone: user.user_metadata?.phone || null,
                    }]);

                if (!insertError) {
                    // Retry fetch
                    const { data: retryProfile } = await supabase
                        .from('profiles')
                        .select('*')
                        .eq('id', user.id)
                        .single();
                    if (retryProfile) {
                        profile = retryProfile;
                    } else {
                        window.location.href = '/pages/login.html';
                        return;
                    }
                } else {
                    window.location.href = '/pages/login.html';
                    return;
                }
            } else {
                window.location.href = '/pages/login.html';
                return;
            }
        }
        currentProfile = profile;
        if (profile.role === 'admin') {
            window.location.href = '/pages/admin/dashboard.html';
            return;
        }

        document.getElementById('user-name').textContent = profile.full_name;

        // Logout logic
        document.getElementById('logout-btn').addEventListener('click', async () => {
            await supabase.auth.signOut();
            window.location.href = '/';
        });

        // 3. Load Election Data
        await loadDashboardData();

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

                // Reload votes and update UI
                await loadUserVotes();
                renderBallot();
                renderProgress();
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
        console.error('Dashboard init error:', err);
        // Show a visible error so the user is not stuck on a spinner
        const panel = document.getElementById('panel-content');
        if (panel) {
            panel.innerHTML = `<div class="text-center py-12 text-red-600 font-semibold">Failed to load dashboard: ${err.message}.<br>Please try refreshing the page or <a class="underline" href="/pages/login.html">log in again</a>.</div>`;
        }
    }
});

async function loadDashboardData() {
    // Check eligibility
    updateStatusBanner();

    // Fetch active or closed election
    const { data: elections } = await supabase.from('elections')
        .select('*')
        .in('status', ['open', 'closed'])
        .order('created_at', { ascending: false })
        .limit(1);

    if (elections && elections.length > 0) {
        activeElection = elections[0];
        renderElectionInfo();
        
        // Load positions and candidates
        const [{ data: posData }, { data: canData }] = await Promise.all([
            supabase.from('positions').select('*'),
            supabase.from('candidates').select('*')
        ]);
        
        positions = posData || [];
        candidates = canData || [];
        
        await loadUserVotes();
        renderProgress();

        if (activeElection.status === 'open') {
            renderBallot();
        } else if (activeElection.status === 'closed' && activeElection.results_published) {
            await renderResults();
        } else {
            renderMessage('Election is closed, results are pending publication.');
        }

    } else {
        document.getElementById('election-info').innerHTML = '<p>No active elections at this time.</p>';
        document.getElementById('progress-list').innerHTML = '';
        renderMessage('There are currently no active elections.');
    }
}

async function loadUserVotes() {
    const { data } = await supabase.from('votes').select('position_id').eq('voter_id', currentUser.id);
    userVotes = (data || []).map(v => v.position_id);
}

function updateStatusBanner() {
    const banner = document.getElementById('status-banner');
    if (currentProfile.account_status !== 'approved' || !currentProfile.voting_rights) {
        banner.classList.remove('hidden', 'bg-green-100', 'text-green-800');
        banner.classList.add('bg-red-100', 'text-red-800');
        banner.textContent = "Your account is not currently approved for voting. Please contact the Election Committee.";
    } else {
        banner.classList.add('hidden');
    }
}

function renderElectionInfo() {
    const infoContainer = document.getElementById('election-info');
    infoContainer.innerHTML = `
        <p><span class="font-bold">Title:</span> ${activeElection.title}</p>
        <p><span class="font-bold">Status:</span> <span class="capitalize text-church-600">${activeElection.status}</span></p>
        <p><span class="font-bold">Closes:</span> ${new Date(activeElection.end_date).toLocaleString()}</p>
        <div id="countdown" class="mt-4 font-mono text-xl text-church-700 bg-church-50 p-2 rounded text-center"></div>
    `;

    if (activeElection.status === 'open') {
        startCountdown(new Date(activeElection.end_date).getTime());
    }
}

function startCountdown(endTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    
    countdownInterval = setInterval(() => {
        const now = new Date().getTime();
        const distance = endTime - now;
        
        if (distance < 0) {
            clearInterval(countdownInterval);
            document.getElementById('countdown').textContent = "ELECTION CLOSED";
            return;
        }
        
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        document.getElementById('countdown').textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }, 1000);
}

function renderProgress() {
    const list = document.getElementById('progress-list');
    list.innerHTML = '';
    
    positions.forEach(pos => {
        const hasVoted = userVotes.includes(pos.id);
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center';
        li.innerHTML = `
            <span>${pos.position_name}</span>
            ${hasVoted 
                ? '<span class="text-green-600 font-bold">✓</span>' 
                : '<span class="text-gray-400">-</span>'}
        `;
        list.appendChild(li);
    });
}

function renderMessage(msg) {
    document.getElementById('panel-title').textContent = "Information";
    document.getElementById('panel-content').innerHTML = `
        <div class="text-center py-12 text-gray-500">${msg}</div>
    `;
}

function renderBallot() {
    document.getElementById('panel-title').textContent = "Ballot";
    const content = document.getElementById('panel-content');
    content.innerHTML = '';
    
    const isEligible = currentProfile.account_status === 'approved' && currentProfile.voting_rights;
    
    positions.forEach(pos => {
        const hasVoted = userVotes.includes(pos.id);
        const posCandidates = candidates.filter(c => c.position_id === pos.id);
        
        const section = document.createElement('div');
        section.className = 'mb-10';
        
        let headerHtml = `<h4 class="text-xl font-extrabold text-gray-900 mb-6 tracking-tight">${pos.position_name} ${hasVoted ? '<span class="text-green-500 text-sm font-bold ml-2">(Completed ✓)</span>' : ''}</h4>`;
        
        let candidatesHtml = '<div class="grid grid-cols-1 sm:grid-cols-2 gap-6">';
        
        posCandidates.forEach(c => {
            const photoUrl = c.photo_url || 'https://via.placeholder.com/150';
            candidatesHtml += `
                <div class="rounded-[2rem] p-6 bg-gray-50 flex flex-col items-center ${hasVoted ? 'opacity-60' : 'hover:shadow-soft-lg transition-all transform hover:-translate-y-1 border border-gray-100'}">
                    <img src="${photoUrl}" alt="${c.full_name}" class="w-32 h-32 rounded-full object-cover mb-4 shadow-sm border-4 border-white">
                    <span class="font-extrabold text-lg text-gray-900 text-center mb-6">${c.full_name}</span>
                    ${!hasVoted && isEligible ? `
                        <button onclick="window.confirmVote('${c.id}', '${c.full_name}', '${pos.id}', '${pos.position_name}')" 
                            class="w-full bg-church-600 text-white py-3 rounded-full hover:bg-church-700 text-base font-bold transition-all active:scale-95 shadow-soft">
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

// Attach to window so onclick can reach it
window.confirmVote = (candidateId, candidateName, positionId, positionName) => {
    pendingVote = { candidateId, positionId };
    document.getElementById('modal-text').textContent = `Are you sure you want to vote for ${candidateName} as ${positionName}?`;
    document.getElementById('vote-modal').classList.remove('hidden');
    document.getElementById('vote-modal').classList.add('flex');
};

async function renderResults() {
    document.getElementById('panel-title').textContent = "Election Results";
    const content = document.getElementById('panel-content');
    content.innerHTML = '<div class="text-center text-gray-500 py-10">Loading results...</div>';

    // Fetch all votes for this election indirectly (votes are tied to positions/candidates)
    // Actually we need aggregate. RLS might block normal users from reading all votes, 
    // Wait, the prompt says RLS: members can only read their own votes.
    // If members cannot read all votes, how do they see results?
    // We need an Edge Function or a database VIEW with security definer, or RPC.
    // Let's create an RPC function to get vote counts!
    // Since I haven't created it yet, I will simulate it or fetch it using an RPC call.
    
    // For now, I will use an RPC call: get_election_results
    const { data: results, error } = await supabase.rpc('get_election_results', { election_id: activeElection.id });
    
    if (error) {
        content.innerHTML = `<div class="text-center text-red-500 py-10">Error loading results: ${error.message}. Please ask admin to setup the database RPC.</div>`;
        return;
    }
    
    content.innerHTML = '';
    
    // Group results by position
    const grouped = {};
    results.forEach(r => {
        if (!grouped[r.position_name]) grouped[r.position_name] = [];
        grouped[r.position_name].push(r);
    });
    
    for (const [posName, cans] of Object.entries(grouped)) {
        // Sort by votes
        cans.sort((a,b) => b.vote_count - a.vote_count);
        
        const section = document.createElement('div');
        section.className = 'mb-10';
        
        let html = `<h4 class="text-xl font-extrabold text-gray-900 mb-6 tracking-tight">${posName}</h4>
                    <div class="space-y-4">`;
        
        cans.forEach((c, index) => {
            const isWinner = index === 0 && c.vote_count > 0;
            html += `
                <div class="flex justify-between items-center bg-gray-50 p-5 rounded-[1.5rem] ${isWinner ? 'ring-2 ring-gold-500 bg-yellow-50' : ''}">
                    <span class="font-extrabold text-lg ${isWinner ? 'text-gray-900' : 'text-gray-700'}">${c.candidate_name} ${isWinner ? '👑' : ''}</span>
                    <span class="bg-white px-4 py-2 rounded-full text-base font-bold text-gray-900 shadow-sm">${c.vote_count} votes</span>
                </div>
            `;
        });
        
        html += `</div>`;
        section.innerHTML = html;
        content.appendChild(section);
    }
}
