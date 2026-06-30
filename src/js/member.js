import { supabase, getCurrentUser, ensureProfile, confirmSignOut } from './supabase.js';
import { sortPositionEntries, candidatePhotoHtml, fetchCandidatePhotos } from './positionOrder.js';

let currentUser = null;
let currentProfile = null;
let activeElection = null;
let positions = [];
let candidates = [];
let userVotes = [];
let countdownInterval = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Auth Check
        const { data: currentUserData, error: sessionError } = await getCurrentUser();
        if (sessionError || !currentUserData?.user) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = currentUserData.user;

        // 2. Load or create Profile
        const { profile, error: profileError } = await ensureProfile(currentUser);

        if (!profile) {
            console.error('Could not load or create profile', profileError);
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
        const firstName = (profile.full_name || '').trim().split(' ')[0];
        const greetingEl = document.getElementById('greeting-name');
        if (greetingEl && firstName) greetingEl.textContent = firstName;
        const initials = profile.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        const avatarEl = document.getElementById('user-avatar-badge');
        if (avatarEl) avatarEl.textContent = initials;

        // Logout buttons
        async function doLogout() {
            if (!(await confirmSignOut())) return;
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
            panel.innerHTML = `<div style="text-align:center;padding:40px 16px;color:#b91c1c;font-weight:600;font-size:14px">Failed to load dashboard: ${err.message}.<br>Please try refreshing or <a style="color:#9b2335;text-decoration:underline" href="/pages/login.html">log in again</a>.</div>`;
        }
    }
});

async function loadDashboardData() {
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
            supabase.from('candidates').select('*').eq('election_id', activeElection.id)
        ]);

        candidates = canData || [];
        // Only consider positions that have candidates in this election.
        const activePositionIds = new Set(candidates.map(c => c.position_id));
        positions = (posData || []).filter(p => activePositionIds.has(p.id));

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
        banner.className = 'alert-banner error visible';
        banner.innerHTML = `
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
            <span>Your account is not currently approved for voting. Please contact the Election Committee.</span>
        `;
    } else {
        banner.className = 'alert-banner';
        banner.innerHTML = '';
    }
}

function renderStats() {
    const statRow = document.getElementById('metrics-row') || document.getElementById('stat-row');
    if (!statRow) return;

    const isOpen = activeElection && activeElection.status === 'open';
    const totalPos = positions.length;
    const castVotes = userVotes.length;
    const isRestricted = currentProfile.account_status !== 'approved' || !currentProfile.voting_rights;

    const statusColor = isOpen ? 'var(--green-dim)' : 'var(--surface-3)';
    const statusIconColor = isOpen ? 'var(--green)' : 'var(--text-3)';
    const statusBg = isOpen ? 'var(--green)' : 'var(--text-3)';

    const countColor = isRestricted ? 'var(--red)' : (castVotes >= totalPos && totalPos > 0) ? 'var(--green)' : 'var(--brand)';

    statRow.innerHTML = `
        <div class="stat-card">
            <div class="stat-icon" style="background:${statusColor}"><div style="width:10px;height:10px;border-radius:50%;background:${statusBg}"></div></div>
            <div class="stat-label">Status</div>
            <div class="stat-value">${isOpen ? 'Open' : activeElection ? 'Closed' : '—'}</div>
            <div class="stat-sub">${activeElection ? activeElection.title : 'No election'}</div>
        </div>
        <div class="stat-card" id="stat-countdown-card">
            <div class="stat-icon" style="background:var(--brand-dim)"><svg width="16" height="16" fill="none" stroke="var(--brand)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
            <div class="stat-label">Time Left</div>
            <div class="stat-value" id="stat-countdown">—</div>
            <div class="stat-sub" id="stat-countdown-sub">${isOpen ? 'until election closes' : 'Election ended'}</div>
        </div>
        <div class="stat-card">
            <div class="stat-icon" style="background:var(--gold-dim)"><svg width="16" height="16" fill="none" stroke="var(--gold)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg></div>
            <div class="stat-label">Progress</div>
            <div class="stat-value" style="color:${countColor}">${castVotes} / ${totalPos}</div>
            <div class="stat-sub">${totalPos === 0 ? 'No positions yet' : isRestricted ? 'Restricted' : (castVotes >= totalPos ? 'All done!' : 'positions voted')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-icon" style="background:${isRestricted ? 'var(--red-dim)' : 'var(--green-dim)'}">
                ${isRestricted
                    ? '<svg width="16" height="16" fill="none" stroke="var(--red)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>'
                    : '<svg width="16" height="16" fill="none" stroke="var(--green)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>'
                }
            </div>
            <div class="stat-label">Account</div>
            <div class="stat-value">${isRestricted ? 'Restricted' : 'Approved'}</div>
            <div class="stat-sub">${isRestricted ? 'Contact committee' : 'Ready to vote'}</div>
        </div>
    `;

    // Start countdown in stat card
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
            <div class="info-row">
                <span class="info-label">Title</span>
                <span class="info-value" style="max-width:160px">${activeElection.title}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Status</span>
                <span class="badge ${isOpen ? 'open' : 'closed'}">${activeElection.status}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Closes</span>
                <span class="info-value">${endDate}</span>
            </div>
        </div>
        <div id="countdown" class="countdown-wrap" style="${isOpen ? '' : 'display:none'}">
            <div class="countdown-label">Time Remaining</div>
            <div class="countdown-grid">
                <div class="countdown-unit"><span class="countdown-num" id="cd-days">—</span><span class="countdown-seg">Days</span></div>
                <div class="countdown-unit"><span class="countdown-num" id="cd-hours">—</span><span class="countdown-seg">Hours</span></div>
                <div class="countdown-unit"><span class="countdown-num" id="cd-mins">—</span><span class="countdown-seg">Min</span></div>
                <div class="countdown-unit"><span class="countdown-num" id="cd-secs">—</span><span class="countdown-seg">Sec</span></div>
            </div>
        </div>
        ${!isOpen ? '<div class="countdown-wrap" style="text-align:center"><span style="font-size:13px;font-weight:700;color:var(--text-3)">Election Closed</span></div>' : ''}
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
        li.className = `stepper-item${hasVoted ? ' voted' : ''}`;
        li.innerHTML = `
            <span class="stepper-num">${hasVoted ? '✓' : '—'}</span>
            <span style="flex:1">${pos.position_name}</span>
        `;
        list.appendChild(li);
    });
}

function renderMessage(msg) {
    document.getElementById('panel-label').textContent = 'Information';
    document.getElementById('panel-content').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon" style="background:var(--surface-3);border:1px solid var(--border)">
                <svg width="24" height="24" fill="none" stroke="var(--text-3)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <span class="empty-sub">${msg}</span>
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
            <div class="empty-state">
                <div class="empty-icon" style="background:var(--red-dim);border:1px solid rgba(244,63,94,0.15)">
                    <svg width="24" height="24" fill="none" stroke="var(--red)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                </div>
                <span class="empty-title">Voting Restricted</span>
                <span class="empty-sub">Your account must be approved with active voting rights to vote.</span>
            </div>
        `;
        return;
    }

    if (cast >= total && total > 0) {
        content.innerHTML = `
            <div class="vote-hero">
                <div class="check-circle">✓</div>
                <span class="empty-title">All Votes Submitted!</span>
                <span class="empty-sub">Thank you for participating. You have voted in all ${total} positions. Results will be published once the election closes.</span>
            </div>
        `;
    } else {
        const pct = total > 0 ? Math.round((cast / total) * 100) : 0;
        content.innerHTML = `
            <div class="vote-hero">
                <div class="vote-hero-icon">
                    <svg width="28" height="28" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                </div>
                <span class="vote-hero-title">Voting is Live</span>
                <span class="vote-hero-sub">Cast your secure ballot today. You have completed <strong>${cast} of ${total}</strong> positions.</span>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${pct}%"></div>
                </div>
                <span class="progress-label">${pct}% complete</span>
                <a href="/pages/member/voting.html" class="cta-btn">
                    Enter Voting Booth
                    <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </a>
            </div>
        `;
    }
}

async function renderResults() {
    document.getElementById('panel-label').textContent = 'Election Results';
    const content = document.getElementById('panel-content');
    content.innerHTML = `
        <div class="skeleton">
            <div class="spinner"></div>
            <span style="font-size:12px;font-weight:600;color:var(--text-3);text-transform:uppercase;letter-spacing:0.08em">Tallying votes</span>
        </div>
    `;

    const [{ data: results, error }, photoById] = await Promise.all([
        supabase.rpc('get_election_results', { election_id: activeElection.id }),
        fetchCandidatePhotos(supabase, activeElection.id),
    ]);

    if (error) {
        content.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon" style="background:var(--red-dim);border:1px solid rgba(244,63,94,0.15)">
                    <svg width="24" height="24" fill="none" stroke="var(--red)" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                </div>
                <span class="empty-title" style="color:var(--red)">Failed to load results</span>
                <span class="empty-sub">RPC function 'get_election_results' may not be set up yet. Contact support.</span>
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

    for (const [posName, cans] of sortPositionEntries(grouped)) {
        cans.sort((a, b) => b.vote_count - a.vote_count);
        const totalVotesInPos = cans.reduce((sum, c) => sum + c.vote_count, 0);

        const section = document.createElement('div');
        section.className = 'pos-section';

        let html = `
            <div class="pos-header">
                <span class="pos-name">${posName}</span>
                <span style="font-size:11px;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em">${totalVotesInPos} votes cast</span>
            </div>
            <div style="display:flex;flex-direction:column;gap:10px">
        `;

        cans.forEach((c, i) => {
            const isWinner = i === 0 && c.vote_count > 0;
            const pct = totalVotesInPos > 0 ? Math.round((c.vote_count / totalVotesInPos) * 100) : 0;
            const avatar = candidatePhotoHtml(photoById[c.candidate_id], c.candidate_name, {
                imgClass: 'result-cand-photo',
                fallbackClass: 'result-cand-photo result-cand-initials',
            });

            html += `
                <div class="result-card${isWinner ? ' winner' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:12px">
                        <span style="font-size:14px;font-weight:700;color:var(--text-1);display:flex;align-items:center;gap:10px;min-width:0">
                            ${avatar}
                            <span style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0">
                                ${c.candidate_name}
                                ${isWinner ? '<span style="font-size:10px;font-weight:700;background:var(--gold-dim);color:#7a6228;border:1px solid rgba(184,148,63,0.25);padding:2px 8px;border-radius:4px;text-transform:uppercase;letter-spacing:0.06em">Winner</span>' : ''}
                            </span>
                        </span>
                        <span style="font-size:13px;font-weight:700;color:var(--text-2);flex-shrink:0">${c.vote_count} <span style="font-size:11px;color:var(--text-3)">(${pct}%)</span></span>
                    </div>
                    <div class="result-bar-track">
                        <div class="result-bar-fill ${isWinner ? 'gold' : 'brand'}" style="width:${pct}%"></div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        section.innerHTML = html;
        content.appendChild(section);
    }
}