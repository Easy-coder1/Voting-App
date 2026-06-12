import { insforge, clearLocalSession } from './insforge.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let positions = [];
let candidates = [];
let userVotes = [];
let countdownInterval = null;

// ── TOAST SYSTEM (WIMP: Notification) ────────────────────────────────
function showToast(type, message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `app-toast app-toast-${type}`;
    toast.innerHTML = `
        ${type === 'success'
            ? '<i data-lucide="check-circle" class="w-5 h-5 flex-shrink-0 mt-0.5"></i>'
            : '<i data-lucide="alert-circle" class="w-5 h-5 flex-shrink-0 mt-0.5"></i>'
        }
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

    if (fetchError) {
        console.error('Profile fetch error:', fetchError);
    }

    if (profile) return profile;

    const fullName = user.name || user.user_metadata?.full_name || user.email?.split('@')[0] || 'Member';
    const phone = user.user_metadata?.phone || null;

    const { error: insertError } = await insforge.database
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

        // Set user name + avatar initials
        document.getElementById('user-name').textContent = profile.full_name;
        const initials = profile.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const avatarEl = document.getElementById('user-avatar-badge');
        if (avatarEl) avatarEl.textContent = initials;

        // Logout buttons
        async function doLogout() {
            await insforge.auth.signOut();
            clearLocalSession();
            window.location.href = '/';
        }
        document.getElementById('logout-btn')?.addEventListener('click', doLogout);
        document.getElementById('logout-btn-mobile')?.addEventListener('click', doLogout);

        // 3. Load Election Data
        await loadDashboardData();

    } catch (err) {
        console.error('Dashboard init error:', err);
        const panel = document.getElementById('panel-content');
        if (panel) {
            panel.innerHTML = `<div class="app-empty"><div class="app-empty-icon" style="background:var(--red-dim);border-color:rgba(244,63,94,0.15)"><i data-lucide="alert-circle" class="w-6 h-6 text-red-500"></i></div><span class="app-empty-title" style="color:var(--red)">Failed to load dashboard</span><span class="app-empty-sub">${err.message}. Please try refreshing or <a style="color:#6366f1;text-decoration:underline" href="/pages/login.html">log in again</a>.</span></div>`;
        }
    }
});

async function loadDashboardData() {
    updateStatusBanner();

    // Fetch active or closed election
    const { data: elections } = await insforge.database.from('elections')
        .select('*')
        .in('status', ['open', 'closed'])
        .order('created_at', { ascending: false })
        .limit(1);

    if (elections && elections.length > 0) {
        activeElection = elections[0];
        renderElectionInfo();

        // Load positions and candidates
        const [{ data: posData }, { data: canData }] = await Promise.all([
            insforge.database.from('positions').select('*'),
            insforge.database.from('candidates').select('*')
        ]);

        positions = posData || [];
        candidates = canData || [];

        await loadUserVotes();
        renderProgress();
        renderStats();

        if (activeElection.status === 'open') {
            renderBallot();
        } else if (activeElection.status === 'closed' && activeElection.results_published) {
            await renderResults();
        } else {
            renderMessage('Election is closed, results are pending publication.');
        }

    } else {
        document.getElementById('election-info').innerHTML = '<p style="font-size:13px;color:var(--text-2)">No active elections at this time.</p>';
        document.getElementById('progress-list').innerHTML = '';
        renderStats();
        renderMessage('There are currently no active elections.');
    }
}

async function loadUserVotes() {
    if (!activeElection) return;
    const { data } = await insforge.database
        .from('votes')
        .select('position_id')
        .eq('voter_id', currentUser.id)
        .eq('election_id', activeElection.id);
    userVotes = (data || []).map(v => v.position_id);
}

function updateStatusBanner() {
    const banner = document.getElementById('status-banner');
    if (!banner) return;
    if (currentProfile.account_status !== 'approved' || !currentProfile.voting_rights) {
        banner.className = 'app-alert app-alert-error visible';
        banner.innerHTML = `
            <i data-lucide="alert-triangle" class="w-[18px] h-[18px]"></i>
            <span>Your account is not currently approved for voting. Please contact the Election Committee.</span>
        `;
    } else {
        banner.className = 'app-alert';
        banner.innerHTML = '';
    }
}

function renderStats() {
    let statRow = document.getElementById('stat-row');
    if (!statRow) {
        const sidebar = document.querySelector('.app-sidebar');
        if (sidebar) {
            statRow = document.createElement('div');
            statRow.id = 'stat-row';
            statRow.className = 'app-stat-row';
            sidebar.insertBefore(statRow, sidebar.firstChild);
        }
    }
    if (!statRow) return;

    const isOpen = activeElection && activeElection.status === 'open';
    const totalPos = positions.length;
    const castVotes = userVotes.length;
    const isRestricted = currentProfile.account_status !== 'approved' || !currentProfile.voting_rights;

    const statusColor = isOpen ? 'var(--green-dim)' : 'var(--surface-3)';
    const statusBg = isOpen ? 'var(--green)' : 'var(--text-3)';

    const countColor = isRestricted ? 'var(--red)' : (castVotes >= totalPos && totalPos > 0) ? 'var(--green)' : 'var(--brand)';

    statRow.innerHTML = `
        <div class="app-stat-card">
            <div class="app-stat-icon" style="background:${statusColor}"><div style="width:10px;height:10px;border-radius:50%;background:${statusBg}"></div></div>
            <div class="app-stat-label">Status</div>
            <div class="app-stat-value">${isOpen ? 'Open' : activeElection ? 'Closed' : '—'}</div>
            <div class="app-stat-sub">${activeElection ? activeElection.title : 'No election'}</div>
        </div>
        <div class="app-stat-card" id="stat-countdown-card">
            <div class="app-stat-icon" style="background:var(--brand-dim)"><i data-lucide="calendar" class="w-4 h-4" style="color:var(--brand)"></i></div>
            <div class="app-stat-label">Time Left</div>
            <div class="app-stat-value" id="stat-countdown">—</div>
            <div class="app-stat-sub" id="stat-countdown-sub">${isOpen ? 'until election closes' : 'Election ended'}</div>
        </div>
        <div class="app-stat-card">
            <div class="app-stat-icon" style="background:var(--gold-dim)"><i data-lucide="bar-chart-2" class="w-4 h-4" style="color:var(--gold)"></i></div>
            <div class="app-stat-label">Progress</div>
            <div class="app-stat-value" style="color:${countColor}">${castVotes} / ${totalPos}</div>
            <div class="app-stat-sub">${totalPos === 0 ? 'No positions yet' : isRestricted ? 'Restricted' : (castVotes >= totalPos ? 'All done!' : 'positions voted')}</div>
        </div>
        <div class="app-stat-card">
            <div class="app-stat-icon" style="background:${isRestricted ? 'var(--red-dim)' : 'var(--green-dim)'}">
                ${isRestricted
                    ? '<i data-lucide="x-circle" class="w-4 h-4" style="color:var(--red)"></i>'
                    : '<i data-lucide="check-circle" class="w-4 h-4" style="color:var(--green)"></i>'
                }
            </div>
            <div class="app-stat-label">Account</div>
            <div class="app-stat-value">${isRestricted ? 'Restricted' : 'Approved'}</div>
            <div class="app-stat-sub">${isRestricted ? 'Contact committee' : 'Ready to vote'}</div>
        </div>
    `;

    if (isOpen) {
        startStatCountdown(new Date(activeElection.end_date).getTime());
    }
}

function startStatCountdown(endTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        const now = new Date().getTime();
        const distance = endTime - now;
        const el = document.getElementById('stat-countdown');
        if (!el) { clearInterval(countdownInterval); return; }

        if (distance < 0) {
            clearInterval(countdownInterval);
            el.textContent = 'Ended';
            const sub = document.getElementById('stat-countdown-sub');
            if (sub) sub.textContent = 'Election closed';
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        if (days > 0) {
            el.textContent = `${days}d ${hours}h`;
        } else {
            el.textContent = `${hours}h ${minutes}m ${seconds}s`;
        }
    }, 1000);
}

function renderElectionInfo() {
    const infoContainer = document.getElementById('election-info');
    const endDate = new Date(activeElection.end_date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const isOpen = activeElection.status === 'open';

    infoContainer.innerHTML = `
        <div>
            <div class="app-info-row">
                <span class="app-info-label">Title</span>
                <span class="app-info-value" style="max-width:160px">${activeElection.title}</span>
            </div>
            <div class="app-info-row">
                <span class="app-info-label">Status</span>
                <span class="app-badge ${isOpen ? 'app-badge-open' : 'app-badge-closed'}">${activeElection.status}</span>
            </div>
            <div class="app-info-row">
                <span class="app-info-label">Closes</span>
                <span class="app-info-value">${endDate}</span>
            </div>
        </div>
        <div class="app-countdown" id="countdown" style="${isOpen ? '' : 'display:none'}">
            <div class="app-countdown-label">Time Remaining</div>
            <div class="app-countdown-grid">
                <div class="app-countdown-unit"><span class="app-countdown-num" id="cd-days">—</span><span class="app-countdown-seg">Days</span></div>
                <div class="app-countdown-unit"><span class="app-countdown-num" id="cd-hours">—</span><span class="app-countdown-seg">Hours</span></div>
                <div class="app-countdown-unit"><span class="app-countdown-num" id="cd-mins">—</span><span class="app-countdown-seg">Min</span></div>
                <div class="app-countdown-unit"><span class="app-countdown-num" id="cd-secs">—</span><span class="app-countdown-seg">Sec</span></div>
            </div>
        </div>
        ${!isOpen ? '<div class="app-countdown" style="text-align:center"><span style="font-size:13px;font-weight:700;color:var(--text-3)">Election Closed</span></div>' : ''}
    `;

    if (isOpen) {
        startCountdown(new Date(activeElection.end_date).getTime());
    }
}

function startCountdown(endTime) {
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        const now = new Date().getTime();
        const distance = endTime - now;

        const dEl = document.getElementById('cd-days');
        const hEl = document.getElementById('cd-hours');
        const mEl = document.getElementById('cd-mins');
        const sEl = document.getElementById('cd-secs');
        if (!dEl) { clearInterval(countdownInterval); return; }

        if (distance < 0) {
            clearInterval(countdownInterval);
            [dEl, hEl, mEl, sEl].forEach(el => { el.textContent = '0'; });
            return;
        }

        dEl.textContent = String(Math.floor(distance / (1000 * 60 * 60 * 24))).padStart(2, '0');
        hEl.textContent = String(Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))).padStart(2, '0');
        mEl.textContent = String(Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
        sEl.textContent = String(Math.floor((distance % (1000 * 60)) / 1000)).padStart(2, '0');
    }, 1000);
}

function renderProgress() {
    const list = document.getElementById('progress-list');
    list.innerHTML = '';

    positions.forEach(pos => {
        const hasVoted = userVotes.includes(pos.id);
        const li = document.createElement('li');
        li.className = `app-stepper-item${hasVoted ? ' voted' : ''}`;
        li.innerHTML = `
            <span class="app-stepper-num">${hasVoted ? '✓' : '—'}</span>
            <span style="flex:1">${pos.position_name}</span>
        `;
        list.appendChild(li);
    });
}

function renderMessage(msg) {
    document.getElementById('panel-label').textContent = 'Information';
    document.getElementById('panel-content').innerHTML = `
        <div class="app-empty">
            <div class="app-empty-icon" style="background:var(--surface-3);border:1px solid var(--border)">
                <i data-lucide="info" class="w-6 h-6" style="color:var(--text-3)"></i>
            </div>
            <span class="app-empty-sub">${msg}</span>
        </div>
    `;
}

function renderBallot() {
    document.getElementById('panel-label').textContent = 'Ballot';
    const content = document.getElementById('panel-content');

    const total = positions.length;
    const cast = userVotes.length;
    const isEligible = currentProfile.account_status === 'approved' && currentProfile.voting_rights;

    if (!isEligible) {
        content.innerHTML = `
            <div class="app-empty">
                <div class="app-empty-icon" style="background:var(--red-dim);border:1px solid rgba(244,63,94,0.15)">
                    <i data-lucide="alert-triangle" class="w-6 h-6" style="color:var(--red)"></i>
                </div>
                <span class="app-empty-title">Voting Restricted</span>
                <span class="app-empty-sub">Your account must be approved with active voting rights to vote.</span>
            </div>
        `;
        return;
    }

    if (cast >= total && total > 0) {
        content.innerHTML = `
            <div class="app-hero">
                <div class="w-[68px] h-[68px] rounded-full bg-emerald-50 border-2 border-emerald-200/60 flex items-center justify-center text-[26px] animate-pop-in">✓</div>
                <span class="app-hero-title">All Votes Submitted!</span>
                <span class="app-hero-sub">Thank you for participating. You have voted in all ${total} positions. Results will be published once the election closes.</span>
            </div>
        `;
    } else {
        const pct = total > 0 ? Math.round((cast / total) * 100) : 0;
        content.innerHTML = `
            <div class="app-hero">
                <div class="app-hero-icon">
                    <i data-lucide="file-text" class="w-7 h-7"></i>
                </div>
                <span class="app-hero-title">Voting is Live</span>
                <span class="app-hero-sub">Cast your secure ballot today. You have completed <strong>${cast} of ${total}</strong> positions.</span>
                <div class="app-progress-track">
                    <div class="app-progress-fill" style="width:${pct}%"></div>
                </div>
                <span class="text-xs font-semibold text-slate-400 mt-1">${pct}% complete</span>
                <a href="/pages/member/voting.html" class="app-btn-primary relative overflow-hidden">
                    Enter Voting Booth
                    <i data-lucide="arrow-right" class="w-[18px] h-[18px] ml-2"></i>
                </a>
            </div>
        `;
    }
}

async function renderResults() {
    document.getElementById('panel-label').textContent = 'Election Results';
    const content = document.getElementById('panel-content');
    content.innerHTML = `
        <div class="app-skeleton">
            <div class="app-spinner"></div>
            <span style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.08em">Tallying votes</span>
        </div>
    `;

    const { data: results, error } = await insforge.database.rpc('get_election_results', { election_id: activeElection.id });

    if (error) {
        content.innerHTML = `
            <div class="app-empty">
                <div class="app-empty-icon" style="background:var(--red-dim);border:1px solid rgba(244,63,94,0.15)">
                    <i data-lucide="alert-circle" class="w-6 h-6 text-red-500"></i>
                </div>
                <span class="app-empty-title" style="color:var(--red)">Failed to load results</span>
                <span class="app-empty-sub">RPC function 'get_election_results' may not be set up yet. Contact support.</span>
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
        cans.sort((a, b) => b.vote_count - a.vote_count);
        const totalVotesInPos = cans.reduce((sum, c) => sum + c.vote_count, 0);

        const section = document.createElement('div');
        section.className = 'app-pos-section';

        let html = `
            <div class="app-pos-header">
                <span class="app-pos-name">${posName}</span>
                <span style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em">${totalVotesInPos} votes cast</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px">
        `;

        cans.forEach((c, i) => {
            const isWinner = i === 0 && c.vote_count > 0;
            const pct = totalVotesInPos > 0 ? Math.round((c.vote_count / totalVotesInPos) * 100) : 0;

            html += `
                <div class="app-result-card${isWinner ? ' winner' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                        <span style="font-size:14px;font-weight:700;color:var(--text-1);display:flex;align-items:center;gap:6px">
                            ${c.candidate_name}
                            ${isWinner ? '<span style="font-size:10px;font-weight:800;background:rgba(245,158,11,0.15);color:#d97706;border:1px solid rgba(245,158,11,0.2);padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:0.06em">Winner 👑</span>' : ''}
                        </span>
                        <span style="font-size:13px;font-weight:700;color:var(--text-2)">${c.vote_count} <span style="font-size:11px;color:var(--text-3)">(${pct}%)</span></span>
                    </div>
                    <div class="app-result-bar-track">
                        <div class="app-result-bar-fill ${isWinner ? 'gold' : 'brand'}" style="width:${pct}%"></div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        section.innerHTML = html;
        content.appendChild(section);
    }
}