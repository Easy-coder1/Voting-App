import { supabase } from './supabase.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let positions = [];
let candidates = [];
let userVotes = [];
let countdownInterval = null;

let pendingVote = null;

async function ensureProfile(user) {
    const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

    if (fetchError) {
        console.error('Profile fetch error:', fetchError);
    }

    if (profile) return profile;

    // No profile found — create one from user metadata
    console.log('No profile found for user, creating one...');
    const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Member';
    const phone = user.user_metadata?.phone || null;

    const { error: insertError } = await supabase
        .from('profiles')
        .insert([{
            id: user.id,
            full_name: fullName,
            email: user.email || '',
            phone: phone,
        }]);

    if (insertError) {
        console.error('Profile insert error:', insertError.message);
        return null;
    }

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

        // 2. Load or create Profile
        const profile = await ensureProfile(currentUser);

        if (!profile) {
            console.error('Could not load or create profile');
            window.location.href = '/pages/login.html';
            return;
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
    if (!activeElection) return;
    const { data } = await supabase
        .from('votes')
        .select('position_id')
        .eq('voter_id', currentUser.id)
        .eq('election_id', activeElection.id);
    userVotes = (data || []).map(v => v.position_id);
}

function updateStatusBanner() {
    const banner = document.getElementById('status-banner');
    if (currentProfile.account_status !== 'approved' || !currentProfile.voting_rights) {
        banner.className = "flex items-start space-x-3 rounded-2xl p-4 mb-6 text-sm font-semibold bg-red-50 text-red-800 border border-red-200/60 shadow-sm";
        banner.innerHTML = `
            <svg class="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
            <span>Your account is not currently approved for voting. Please contact the Election Committee.</span>
        `;
        banner.classList.remove('hidden');
    } else {
        banner.classList.add('hidden');
    }
}

function renderElectionInfo() {
    const infoContainer = document.getElementById('election-info');
    infoContainer.innerHTML = `
        <div class="space-y-3.5">
            <div class="flex justify-between border-b border-slate-100 pb-2">
                <span class="font-semibold text-slate-400">Title</span>
                <span class="font-bold text-slate-800 text-right">${activeElection.title}</span>
            </div>
            <div class="flex justify-between border-b border-slate-100 pb-2">
                <span class="font-semibold text-slate-400">Status</span>
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${activeElection.status === 'open' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-700 border border-slate-200'}">${activeElection.status}</span>
            </div>
            <div class="flex justify-between border-b border-slate-100 pb-2">
                <span class="font-semibold text-slate-400">Closes</span>
                <span class="font-semibold text-slate-700 text-right">${new Date(activeElection.end_date).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}</span>
            </div>
            <div id="countdown" class="mt-4 font-mono text-base font-bold text-church-700 bg-church-50 border border-church-200/50 p-3.5 rounded-2xl text-center shadow-inner tracking-wider"></div>
        </div>
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
        
        const countdownEl = document.getElementById('countdown');
        if (!countdownEl) {
            clearInterval(countdownInterval);
            return;
        }

        if (distance < 0) {
            clearInterval(countdownInterval);
            countdownEl.className = "mt-4 font-mono text-base font-bold text-slate-500 bg-slate-100 border border-slate-200 p-3.5 rounded-2xl text-center tracking-wider";
            countdownEl.textContent = "ELECTION CLOSED";
            return;
        }
        
        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);
        
        countdownEl.textContent = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }, 1000);
}

function renderProgress() {
    const list = document.getElementById('progress-list');
    list.innerHTML = '';
    
    positions.forEach(pos => {
        const hasVoted = userVotes.includes(pos.id);
        const li = document.createElement('li');
        li.className = 'flex justify-between items-center py-2.5 border-b border-slate-100 last:border-0 text-slate-700';
        li.innerHTML = `
            <span class="font-medium">${pos.position_name}</span>
            ${hasVoted 
                ? '<span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 text-xs font-bold">✓</span>' 
                : '<span class="text-slate-355 font-bold">—</span>'}
        `;
        list.appendChild(li);
    });
}

function renderMessage(msg) {
    document.getElementById('panel-title').textContent = "Information";
    document.getElementById('panel-content').innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-3">
            <svg class="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            <span class="text-sm font-semibold max-w-xs leading-relaxed">${msg}</span>
        </div>
    `;
}

function renderBallot() {
    document.getElementById('panel-title').textContent = "Election Active";
    const content = document.getElementById('panel-content');
    
    const total = positions.length;
    const cast = userVotes.length;
    const isEligible = currentProfile.account_status === 'approved' && currentProfile.voting_rights;

    if (!isEligible) {
        content.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-3">
                <svg class="w-12 h-12 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                <span class="text-sm font-bold text-slate-800">Voting Restricted</span>
                <span class="text-xs text-slate-450 max-w-xs leading-relaxed">Your account must be approved with active voting rights to enter the voting booth.</span>
            </div>
        `;
        return;
    }

    if (cast >= total && total > 0) {
        content.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-4">
                <div class="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 font-extrabold text-2xl shadow-sm">✓</div>
                <div class="space-y-1 bg-white">
                    <span class="text-lg font-black text-slate-900 block">All Votes Submitted!</span>
                    <span class="text-xs text-slate-400 max-w-xs leading-relaxed block">Thank you for participating. You have voted in all ${total} positions. Results will be published once the election closes.</span>
                </div>
            </div>
        `;
    } else {
        content.innerHTML = `
            <div class="flex flex-col items-center justify-center py-10 text-center space-y-6">
                <div class="w-16 h-16 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-church-600 font-extrabold text-2xl shadow-sm">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                </div>
                <div class="space-y-1.5 max-w-sm">
                    <span class="text-xl font-black text-slate-900 block">Voting is Live</span>
                    <p class="text-sm text-slate-500 leading-relaxed">Cast your secure ballot today. You have completed <span class="font-black text-slate-800">${cast} of ${total}</span> positions.</p>
                </div>
                <a href="/pages/member/voting.html" class="inline-flex justify-center items-center px-8 py-4 bg-gradient-to-r from-church-600 to-church-500 hover:from-church-500 hover:to-church-400 text-white rounded-full text-base font-bold shadow-premium hover:shadow-premium-lg transition-all duration-300 active:scale-95">
                    Enter Voting Booth
                    <svg class="ml-2 w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
                </a>
            </div>
        `;
    }
}

async function renderResults() {
    document.getElementById('panel-title').textContent = "Election Results";
    const content = document.getElementById('panel-content');
    content.innerHTML = `
        <div class="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-2">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400"></div>
            <span class="text-xs font-semibold">Tallying vote data</span>
        </div>
    `;

    const { data: results, error } = await supabase.rpc('get_election_results', { election_id: activeElection.id });
    
    if (error) {
        content.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-center text-red-500 border border-red-200/50 bg-red-50/50 rounded-3xl p-6">
                <svg class="w-10 h-10 text-red-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span class="font-bold mb-1">Failed to publish results</span>
                <span class="text-xs opacity-80 leading-relaxed max-w-xs">RPC functions are pending setup. Setup RPC 'get_election_results' in your Supabase DB or contact support.</span>
            </div>
        `;
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
        const totalVotesInPos = cans.reduce((sum, current) => sum + current.vote_count, 0);
        
        const section = document.createElement('div');
        section.className = 'mb-12 last:mb-0 border-b border-slate-100 pb-10 last:border-b-0 last:pb-0';
        
        let html = `
            <div class="flex items-center justify-between mb-6">
                <h4 class="text-xl font-bold text-slate-900 tracking-tight">${posName}</h4>
                <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">${totalVotesInPos} votes cast</span>
            </div>
            <div class="space-y-4">`;
        
        cans.forEach((c, index) => {
            const isWinner = index === 0 && c.vote_count > 0;
            const pct = totalVotesInPos > 0 ? Math.round((c.vote_count / totalVotesInPos) * 100) : 0;
            
            html += `
                <div class="bg-slate-50 border border-slate-100 hover:shadow-soft rounded-2xl p-5 transition duration-300 relative overflow-hidden ${isWinner ? 'ring-2 ring-gold-500/50 bg-gold-50/20' : ''}">
                    <div class="flex justify-between items-center mb-3 relative z-10">
                        <div class="flex items-center space-x-2">
                            <span class="font-extrabold text-base ${isWinner ? 'text-slate-900' : 'text-slate-700'}">${c.candidate_name}</span>
                            ${isWinner ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-gold-100 text-gold-800 uppercase tracking-wider">Winner 👑</span>' : ''}
                        </div>
                        <div class="text-right">
                            <span class="font-black text-slate-900">${c.vote_count} votes</span>
                            <span class="text-xs text-slate-400 font-semibold ml-1.5">(${pct}%)</span>
                        </div>
                    </div>
                    <!-- Progress Bar Back -->
                    <div class="w-full h-2.5 bg-slate-200/60 rounded-full relative overflow-hidden">
                        <!-- Animated Progress Fill -->
                        <div class="h-full rounded-full transition-all duration-1000 ${isWinner ? 'bg-gradient-to-r from-gold-500 to-amber-500' : 'bg-gradient-to-r from-church-600 to-indigo-500'}" style="width: ${pct}%"></div>
                    </div>
                </div>
            `;
        });
        
        html += `</div>`;
        section.innerHTML = html;
        content.appendChild(section);
    }
}