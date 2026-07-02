import { supabase, getCurrentUser, subscribeToTableChanges, confirmSignOut } from './supabase.js';
import { sortPositionEntries, candidatePhotoHtml, fetchCandidatePhotos } from './positionOrder.js';
import { showToast, showConfirm, escapeHtml } from './ui.js';

let currentUser = null;
let currentProfile = null;
let turnoutChartInstance = null;
let selectedResultsElection = null;
let allMembers = [];
let memberSearchQuery = '';
let allAdmins = [];
let onlineAdminIds = new Set();
let adminPresenceChannel = null;

function getInitials(name) {
    return (name || '?')
        .split(' ')
        .filter(Boolean)
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase() || '?';
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Auth Check
        const { data: currentUserData, error: sessionError } = await getCurrentUser();
        if (sessionError || !currentUserData?.user) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = currentUserData.user;

        // 2. Load Profile and verify Admin
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();

        if (profileError || !profile || profile.role !== 'admin' || profile.account_status !== 'approved') {
            console.error('Admin profile error:', profileError);
            window.location.href = '/pages/member/dashboard.html';
            return;
        }
        currentProfile = profile;
        const name = profile.full_name || 'Admin';
        document.getElementById('admin-name').textContent = name;
        const initials = getInitials(name);
        const avatarEl = document.getElementById('admin-avatar-badge');
        if (avatarEl) avatarEl.textContent = initials;

        setupAdminMenu();
        setupAdminPresence(name);

        document.getElementById('logout-btn').addEventListener('click', async () => {
            if (!(await confirmSignOut())) return;
            window.location.href = '/';
        });

        setupTabs();
        loadAnalytics();
        setupForms();
        setupResultsTab();
        setupPublishModal();

        // Subscribe to realtime updates for live analytics
        try {
            subscribeToTableChanges(['profiles', 'votes', 'runoff_votes'], () => {
                loadAnalytics();
                if (!document.getElementById('tab-members').classList.contains('hidden')) {
                    loadMembers();
                }
                if (!document.getElementById('tab-results').classList.contains('hidden') && selectedResultsElection && selectedResultsElection.status === 'open') {
                    renderResults(selectedResultsElection);
                }
            });
        } catch (realtimeErr) {
            console.warn('Realtime subscription failed (non-critical):', realtimeErr);
        }
    } catch (err) {
        console.error('Admin dashboard init error:', err);
        const main = document.querySelector('main') || document.body;
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'padding:40px;text-align:center;color:#dc2626;font-weight:600;font-family:sans-serif;';
        errDiv.innerHTML = `Failed to load admin dashboard: ${err.message}.<br>Please try <a style="text-decoration:underline" href="/pages/login.html">logging in again</a>.`;
        main.prepend(errDiv);
    }
});

function setPageHeader(titleText, subtitleText) {
    const title = document.getElementById('page-title');
    const subtitle = document.getElementById('page-subtitle');
    if (title) title.textContent = titleText;
    if (subtitle) subtitle.textContent = subtitleText;
}

async function loadAdmins() {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('role', 'admin')
        .order('full_name');

    if (error) {
        console.warn('Could not load admin roster:', error);
        return;
    }
    allAdmins = data || [];
    renderAdminRoster();
}

function syncOnlineAdminIds() {
    onlineAdminIds = new Set();
    if (!adminPresenceChannel) return;

    const state = adminPresenceChannel.presenceState();
    Object.values(state).forEach(presences => {
        (presences || []).forEach(p => {
            if (p?.user_id) onlineAdminIds.add(p.user_id);
        });
    });
    if (currentUser?.id) onlineAdminIds.add(currentUser.id);
    renderAdminRoster();
}

function renderAdminRoster() {
    const listEl = document.getElementById('admin-roster-list');
    if (!listEl) return;

    if (!allAdmins.length) {
        listEl.innerHTML = '<li class="admin-roster-empty">No administrators found</li>';
        return;
    }

    const sorted = [...allAdmins].sort((a, b) => {
        const aOnline = onlineAdminIds.has(a.id) ? 0 : 1;
        const bOnline = onlineAdminIds.has(b.id) ? 0 : 1;
        if (aOnline !== bOnline) return aOnline - bOnline;
        return (a.full_name || '').localeCompare(b.full_name || '');
    });

    listEl.innerHTML = sorted.map(admin => {
        const isOnline = onlineAdminIds.has(admin.id);
        const initials = getInitials(admin.full_name);
        const isSelf = admin.id === currentUser?.id;

        return `
            <li class="admin-roster-item" role="listitem">
                <div class="admin-roster-avatar">
                    ${initials}
                    <span class="admin-status-dot ${isOnline ? 'admin-status-dot--online' : 'admin-status-dot--offline'}" title="${isOnline ? 'Online' : 'Offline'}"></span>
                </div>
                <div class="min-w-0">
                    <span class="admin-roster-name">${escapeHtml(admin.full_name || 'Admin')}${isSelf ? ' (you)' : ''}</span>
                    <span class="admin-roster-status-text ${isOnline ? 'is-online' : ''}">${isOnline ? 'Online now' : 'Offline'}</span>
                </div>
            </li>
        `;
    }).join('');
}

function setupAdminMenu() {
    const btn = document.getElementById('admin-menu-btn');
    const popover = document.getElementById('admin-menu-popover');
    if (!btn || !popover) return;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isOpen = popover.classList.toggle('open');
        btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        popover.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        if (isOpen) await loadAdmins();
    });

    document.addEventListener('click', (e) => {
        if (!popover.classList.contains('open')) return;
        if (e.target.closest('.admin-menu')) return;
        popover.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        popover.setAttribute('aria-hidden', 'true');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && popover.classList.contains('open')) {
            popover.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            popover.setAttribute('aria-hidden', 'true');
            btn.focus();
        }
    });

    loadAdmins();
}

function setupAdminPresence(fullName) {
    adminPresenceChannel = supabase.channel('admin-dashboard-presence', {
        config: { presence: { key: currentUser.id } },
    });

    adminPresenceChannel
        .on('presence', { event: 'sync' }, syncOnlineAdminIds)
        .on('presence', { event: 'join' }, syncOnlineAdminIds)
        .on('presence', { event: 'leave' }, syncOnlineAdminIds)
        .subscribe(async (status) => {
            if (status !== 'SUBSCRIBED') return;
            await adminPresenceChannel.track({
                user_id: currentUser.id,
                full_name: fullName,
                online_at: new Date().toISOString(),
            });
            syncOnlineAdminIds();
        });

    window.addEventListener('beforeunload', () => {
        if (adminPresenceChannel) {
            adminPresenceChannel.untrack();
        }
    });
}

function setupTabs() {
    const btns = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            
            // Loop through all buttons to apply correct responsive classes
            btns.forEach(b => {
                const targetTab = b.getAttribute('data-tab');
                const isMobile = b.closest('aside') === null;
                
                if (targetTab === tabId) {
                    if (isMobile) {
                        b.className = 'tab-btn flex flex-col items-center p-2 text-church-800 transition duration-300';
                    } else {
                        b.className = 'tab-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 text-white font-semibold text-sm border border-white/10 transition-all';
                    }
                } else {
                    if (isMobile) {
                        b.className = 'tab-btn flex flex-col items-center p-2 text-ink-subtle hover:text-church-800 transition duration-300';
                    } else {
                        b.className = 'tab-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-church-400 hover:text-white hover:bg-white/5 font-medium text-sm transition-all';
                    }
                }
            });

            // Show corresponding content
            contents.forEach(c => c.classList.add('hidden'));
            document.getElementById(`tab-${tabId}`).classList.remove('hidden');

            const tabMeta = {
                analytics: {
                    title: 'Analytics',
                    subtitle: 'Member stats, pending, approved, rejected, and live election status'
                },
                members: {
                    title: 'Member Management',
                    subtitle: 'Search members, approve registrations, and view approved voters'
                },
                elections: {
                    title: 'Election Management',
                    subtitle: 'Create elections and control ballot status'
                },
                candidates: {
                    title: 'Candidate Management',
                    subtitle: 'Manage the shared candidate roster used by all elections'
                },
                results: {
                    title: 'Election Results',
                    subtitle: 'View tallies, turnout, and publish results'
                }
            };
            const meta = tabMeta[tabId] || {
                title: tabId.charAt(0).toUpperCase() + tabId.slice(1),
                subtitle: ''
            };
            setPageHeader(meta.title, meta.subtitle);

            if (tabId === 'members') loadMembers();
            if (tabId === 'elections') loadElections();
            if (tabId === 'candidates') {
                loadPositions();
                loadCandidates();
            }
            if (tabId === 'results') loadResultsTab();
        });
    });
}

// ----------------------
// ANALYTICS
// ----------------------
async function loadAnalytics() {
    const [
        { count: totalMembers },
        { count: pending },
        { count: approved },
        { count: rejected },
        { data: openElections },
    ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'member'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('account_status', 'pending').eq('role', 'member'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('account_status', 'approved').eq('role', 'member'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('account_status', 'rejected').eq('role', 'member'),
        supabase.from('elections').select('id, title, end_date').eq('status', 'open').limit(1),
    ]);

    let votersWhoVoted = 0;
    const activeElection = openElections?.[0] || null;

    if (activeElection) {
        const { data: voteRows } = await supabase
            .from('votes')
            .select('voter_id')
            .eq('election_id', activeElection.id);
        votersWhoVoted = new Set((voteRows || []).map(r => r.voter_id).filter(Boolean)).size;
    }

    document.getElementById('stat-total-members').textContent = totalMembers || 0;
    document.getElementById('stat-pending').textContent = pending || 0;
    document.getElementById('stat-approved').textContent = approved || 0;
    document.getElementById('stat-rejected').textContent = rejected || 0;
    document.getElementById('stat-votes').textContent = votersWhoVoted;

    renderMemberStatusChart(pending || 0, approved || 0, rejected || 0);

    const statusContainer = document.getElementById('live-election-status');
    if (statusContainer) {
        if (activeElection) {
            statusContainer.innerHTML = `
                <div class="space-y-4">
                    <div class="flex items-center space-x-2.5">
                        <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span class="font-extrabold text-base text-slate-800">Active: ${activeElection.title}</span>
                    </div>
                    <div class="flex justify-between border-t border-slate-200/50 pt-4 text-xs font-semibold text-slate-400">
                        <span>Closing Date</span>
                        <span class="text-slate-700 font-bold">${new Date(activeElection.end_date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                    <button onclick="window.switchToResultsTab('${activeElection.id}')" class="mt-3 w-full bg-church-50 border border-church-100 text-church-700 hover:bg-church-100 px-4 py-2.5 rounded-full text-xs font-bold transition active:scale-95">
                        View Live Results →
                    </button>
                </div>
            `;
        } else {
            statusContainer.innerHTML = `
                <div class="flex items-center space-x-2.5 text-slate-400 font-semibold py-2">
                    <span class="w-2.5 h-2.5 rounded-full bg-slate-300"></span>
                    <span>No active elections running</span>
                </div>
            `;
        }
    }
}

function renderMemberStatusChart(pending, approved, rejected) {
    const ctx = document.getElementById('turnoutChart');
    if (!ctx) return;

    const labels = ['Pending', 'Approved', 'Rejected'];
    const data = [pending, approved, rejected];
    const colors = ['#f59e0b', '#059669', '#dc2626'];

    if (turnoutChartInstance) {
        turnoutChartInstance.data.labels = labels;
        turnoutChartInstance.data.datasets[0].data = data;
        turnoutChartInstance.data.datasets[0].backgroundColor = colors;
        turnoutChartInstance.update();
        return;
    }

    turnoutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 4,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '78%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        padding: 20,
                        font: {
                            weight: 'bold',
                            family: 'Plus Jakarta Sans',
                        },
                    },
                },
            },
        },
    });
}

// ----------------------
// MEMBER MANAGEMENT
// ----------------------
function getMemberInitials(name) {
    return (name || '')
        .split(' ')
        .filter(Boolean)
        .map(n => n[0])
        .join('')
        .substring(0, 2)
        .toUpperCase();
}

function matchesMemberSearch(member, query) {
    if (!query) return true;
    const needle = query.toLowerCase();
    return (member.full_name || '').toLowerCase().includes(needle)
        || (member.email || '').toLowerCase().includes(needle);
}

function setupMemberSearch() {
    const input = document.getElementById('member-search');
    if (!input || input.dataset.bound) return;
    input.dataset.bound = 'true';
    input.addEventListener('input', () => {
        memberSearchQuery = input.value.trim();
        renderMembersUI();
    });
}

function renderPendingMemberRow(m) {
    const initials = getMemberInitials(m.full_name);
    const div = document.createElement('div');
    div.className = 'member-row';

    div.innerHTML = `
        <div class="member-row-info">
            <div class="member-row-avatar member-row-avatar--pending">${initials}</div>
            <div class="member-row-text">
                <h4>${m.full_name}</h4>
                <p>${m.email}</p>
            </div>
        </div>
        <div class="member-row-actions">
            <button type="button" onclick="window.rejectMember('${m.id}')" class="member-btn member-btn--reject">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
                Reject
            </button>
            <button type="button" onclick="window.updateMemberStatus('${m.id}', 'approved')" class="member-btn member-btn--approve">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path></svg>
                Approve
            </button>
        </div>
    `;
    return div;
}

function renderApprovedMemberRow(m) {
    const initials = getMemberInitials(m.full_name);
    const div = document.createElement('div');
    div.className = 'member-row';

    div.innerHTML = `
        <div class="member-row-info">
            <div class="member-row-avatar member-row-avatar--approved">${initials}</div>
            <div class="member-row-text">
                <h4>${m.full_name}</h4>
                <p>${m.email}</p>
            </div>
        </div>
        <div class="member-row-actions">
            <span class="member-badge member-badge--ok">Enabled ✓</span>
            <button type="button" onclick="window.updateMemberStatus('${m.id}', 'pending')" class="member-btn member-btn--ghost">
                To pending
            </button>
        </div>
    `;
    return div;
}

function renderRejectedMemberRow(m) {
    const initials = getMemberInitials(m.full_name);
    const div = document.createElement('div');
    div.className = 'member-row';

    div.innerHTML = `
        <div class="member-row-info">
            <div class="member-row-avatar member-row-avatar--rejected">${initials}</div>
            <div class="member-row-text">
                <h4>${m.full_name}</h4>
                <p>${m.email}</p>
            </div>
        </div>
        <div class="member-row-actions">
            <span class="member-badge member-badge--no">Rejected</span>
            <button type="button" onclick="window.updateMemberStatus('${m.id}', 'pending')" class="member-btn member-btn--restore">
                Restore to pending
            </button>
        </div>
    `;
    return div;
}

function renderMemberSection(listEl, emptyEl, members, emptyMessage) {
    if (!listEl) return;
    listEl.innerHTML = '';

    if (members.length === 0) {
        emptyEl?.classList.remove('hidden');
        listEl.classList.add('hidden');
        if (emptyEl) {
            const msg = emptyEl.querySelector('p');
            if (msg) msg.textContent = emptyMessage;
        }
        return;
    }

    emptyEl?.classList.add('hidden');
    listEl.classList.remove('hidden');
    members.forEach(m => listEl.appendChild(m));
}

function renderMembersUI() {
    const pendingList = document.getElementById('members-list');
    const approvedList = document.getElementById('approved-members-list');
    const rejectedList = document.getElementById('rejected-members-list');
    const approvedEmpty = document.getElementById('approved-empty');
    const rejectedEmpty = document.getElementById('rejected-empty');
    const pendingCount = document.getElementById('pending-count');
    const approvedCount = document.getElementById('approved-count');
    const rejectedCount = document.getElementById('rejected-count');

    const pending = allMembers.filter(m => m.account_status === 'pending' && matchesMemberSearch(m, memberSearchQuery));
    const approved = allMembers.filter(m => m.account_status === 'approved' && matchesMemberSearch(m, memberSearchQuery));
    const rejected = allMembers.filter(m => m.account_status === 'rejected' && matchesMemberSearch(m, memberSearchQuery));

    if (pendingCount) pendingCount.textContent = String(pending.length);
    if (approvedCount) approvedCount.textContent = String(approved.length);
    if (rejectedCount) rejectedCount.textContent = String(rejected.length);

    if (pending.length === 0) {
        pendingList.innerHTML = `
            <div class="member-empty">
                <p>${memberSearchQuery ? 'No pending members match your search.' : 'No members waiting for approval. Great job!'}</p>
            </div>
        `;
    } else {
        pendingList.innerHTML = '';
        pending.forEach(m => pendingList.appendChild(renderPendingMemberRow(m)));
    }

    renderMemberSection(
        approvedList,
        approvedEmpty,
        approved.map(m => renderApprovedMemberRow(m)),
        memberSearchQuery ? 'No approved members match your search.' : 'No approved members yet.'
    );

    renderMemberSection(
        rejectedList,
        rejectedEmpty,
        rejected.map(m => renderRejectedMemberRow(m)),
        memberSearchQuery ? 'No rejected members match your search.' : 'No rejected members.'
    );
}

async function loadMembers() {
    const { data: members, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('role', 'member')
        .order('created_at', { ascending: false });

    if (error) {
        showToast('error', 'Error fetching members: ' + error.message);
        return;
    }

    allMembers = members || [];
    setupMemberSearch();
    renderMembersUI();
}

window.rejectMember = async (id) => {
    const member = allMembers.find(m => m.id === id);
    const name = member?.full_name || 'this member';
    if (!(await showConfirm(`Reject registration for ${name}? They will not be able to vote.`, {
        title: 'Reject member',
        confirmLabel: 'Reject',
        cancelLabel: 'Cancel',
        destructive: true,
    }))) return;
    await window.updateMemberStatus(id, 'rejected');
};

window.updateMemberStatus = async (id, status) => {
    try {
        let updateData = { account_status: status };
        if (status === 'approved') {
            updateData.voting_rights = true;
        } else {
            updateData.voting_rights = false;
        }

        const { error } = await supabase.from('profiles').update(updateData).eq('id', id);
        if (error) {
            showToast('error', 'Error updating status: ' + error.message);
        } else {
            const msg = status === 'approved' ? 'Member approved — they can now vote when an election opens.'
                : status === 'rejected' ? 'Member rejected.'
                : 'Member status updated.';
            showToast('success', msg);
            loadMembers();
            loadAnalytics();
        }
    } catch (err) {
        showToast('error', 'Exception updating status: ' + err.message);
    }
};

// ----------------------
// ELECTION MANAGEMENT
// ----------------------
function setupForms() {
    setupImageUpload();

    document.getElementById('create-election-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('el-title').value;
        const start = document.getElementById('el-start').value;
        const end = document.getElementById('el-end').value;

        const { data: created, error } = await supabase
            .from('elections')
            .insert([{ title, start_date: start, end_date: end, status: 'upcoming' }])
            .select();

        if (error || !created || created.length === 0) {
            showToast('error', 'Error creating election: ' + (error?.message || 'Unknown error'));
            return;
        }

        showToast('success', 'Election created. Set its status to Open when you are ready for voting.');
        e.target.reset();
        loadElections();
        loadCandidates();
    });

    document.getElementById('add-candidate-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('can-name').value;
        const pos = document.getElementById('can-position').value;
        const photo = document.getElementById('can-photo').value;

        const { error } = await supabase.from('candidates').insert([{
            full_name: name,
            position_id: pos,
            photo_url: photo || null,
        }]);

        if (error) {
            showToast('error', 'Error adding candidate: ' + error.message);
            return;
        }

        showToast('success', 'Candidate added to the roster.');
        e.target.reset();
        resetImageUpload();
        loadCandidates();
    });
}

function resetImageUpload() {
    const photoInput = document.getElementById('can-photo');
    const fileInput = document.getElementById('can-photo-file');
    const preview = document.getElementById('upload-preview');
    const previewContainer = document.getElementById('upload-preview-container');
    
    if (photoInput) photoInput.value = '';
    if (fileInput) fileInput.value = '';
    if (preview) preview.src = '';
    if (previewContainer) previewContainer.classList.add('hidden');
}

function setupImageUpload() {
    const zone = document.getElementById('image-upload-zone');
    const fileInput = document.getElementById('can-photo-file');
    const removeBtn = document.getElementById('remove-preview-btn');

    if (!zone || !fileInput) return;

    zone.addEventListener('click', (e) => {
        if (e.target.closest('#remove-preview-btn') || e.target.closest('#upload-preview')) return;
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleSelectedFile(e.target.files[0]);
        }
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('border-church-500', 'bg-white');
    });

    ['dragleave', 'dragend'].forEach(evt => {
        zone.addEventListener(evt, () => {
            zone.classList.remove('border-church-500', 'bg-white');
        });
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('border-church-500', 'bg-white');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleSelectedFile(e.dataTransfer.files[0]);
        }
    });

    if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetImageUpload();
        });
    }
}

function handleSelectedFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        showToast('warning', 'Please select a valid image file.');
        return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 300;
            const MAX_HEIGHT = 300;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const base64 = canvas.toDataURL('image/jpeg', 0.8);
            document.getElementById('can-photo').value = base64;
            
            const preview = document.getElementById('upload-preview');
            const previewContainer = document.getElementById('upload-preview-container');
            if (preview) preview.src = base64;
            if (previewContainer) previewContainer.classList.remove('hidden');
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
}

async function loadElections() {
    const { data: elections, error } = await supabase.from('elections').select('*').order('created_at', { ascending: false });
    const list = document.getElementById('elections-list');
    list.innerHTML = '';

    if (error) {
        showToast('error', 'Error loading elections: ' + error.message);
        return;
    }

    if (!elections || elections.length === 0) {
        list.innerHTML = `
            <div class="member-empty py-12">
                <p>No elections yet. Create one using the form on the left, then add candidates and set the status to Open when ready.</p>
            </div>
        `;
        return;
    }

    elections.forEach(el => {
        const div = document.createElement('div');
        div.className = 'card-premium p-5 flex flex-col md:flex-row justify-between items-start md:items-center hover:shadow-card-hover transition-all';
        
        const statusColors = {
            'upcoming': 'bg-blue-50 text-blue-700 border-blue-100',
            'open': 'bg-emerald-50 text-emerald-700 border-emerald-100 animate-pulse',
            'closed': 'bg-slate-100 text-slate-600 border-slate-200'
        };

        const safeTitle = escapeHtml(el.title || 'Untitled');
        const deleteTitle = (el.title || '').replace(/'/g, "\\'");

        div.innerHTML = `
            <div class="space-y-2">
                <h4 class="font-extrabold text-lg text-slate-800 tracking-tight leading-tight">${safeTitle}</h4>
                <p class="text-sm text-slate-400 font-semibold flex items-center space-x-1.5">
                    <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    <span>${new Date(el.start_date).toLocaleDateString()} - ${new Date(el.end_date).toLocaleDateString()}</span>
                </p>
                <div class="mt-3 text-xs font-bold flex items-center space-x-2 flex-wrap gap-2">
                    <span class="px-2.5 py-1 rounded-full border uppercase ${statusColors[el.status] || ''}">${el.status}</span>
                    <span class="px-2.5 py-1 ${el.results_published ? 'bg-church-50 text-church-700 border-church-200' : 'bg-church-50/50 text-church-400 border-church-100'} rounded-full border uppercase text-[10px]">Results: ${el.results_published ? 'Published ✓' : 'Hidden'}</span>
                </div>
            </div>
            <div class="space-x-2 mt-6 md:mt-0 flex items-center w-full md:w-auto flex-wrap gap-2">
                <select onchange="window.updateElectionStatus('${el.id}', this.value)" class="text-xs border border-slate-200 bg-white shadow-sm rounded-full px-4 py-2.5 font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-church-500 min-h-[44px]">
                    <option value="upcoming" ${el.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
                    <option value="open" ${el.status === 'open' ? 'selected' : ''}>Open</option>
                    <option value="closed" ${el.status === 'closed' ? 'selected' : ''}>Closed</option>
                </select>
                <button onclick="window.viewElectionResults('${el.id}')" class="text-xs bg-church-50 border border-church-100 text-church-700 hover:bg-church-100 px-4 py-2.5 rounded-full font-bold transition-all duration-300 active:scale-95 min-h-[44px]">
                    View Results
                </button>
                <button onclick="window.deleteElection('${el.id}', '${deleteTitle}')" class="text-xs bg-red-50 border border-red-200 text-red-600 px-4 py-2.5 rounded-full font-bold hover:bg-red-100 hover:text-red-700 transition-all duration-300 active:scale-95 min-h-[44px]">
                    Delete
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

window.updateElectionStatus = async (id, status) => {
    try {
        if (status === 'open') {
            const { error: closeError } = await supabase
                .from('elections')
                .update({ status: 'closed' })
                .eq('status', 'open')
                .neq('id', id);

            if (closeError) {
                showToast('error', 'Error closing the previous election: ' + closeError.message);
                return;
            }
        }

        const { error } = await supabase.from('elections').update({ status }).eq('id', id);
        if (error) {
            showToast('error', 'Error updating election status: ' + error.message);
            return;
        }

        showToast('success', status === 'open' ? 'Election is now open for voting.' : status === 'closed' ? 'Election closed.' : 'Election marked as upcoming.');
        loadElections();
        loadAnalytics();
    } catch (err) {
        showToast('error', 'Exception updating election status: ' + err.message);
    }
};

window.deleteElection = async (id, title) => {
    if (!(await showConfirm(`Delete election "${title}"? This will permanently remove the election and all of its votes. This action cannot be undone.`, {
        title: 'Delete election',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        destructive: true,
    }))) {
        return;
    }
    try {
        const { error: votesError } = await supabase.from('votes').delete().eq('election_id', id);
        if (votesError) {
            showToast('error', 'Error deleting election votes: ' + votesError.message);
            return;
        }

        const { error } = await supabase.from('elections').delete().eq('id', id);
        if (error) {
            showToast('error', 'Error deleting election: ' + error.message);
        } else {
            showToast('success', 'Election deleted.');
            loadElections();
            loadAnalytics();
        }
    } catch (err) {
        showToast('error', 'Exception deleting election: ' + err.message);
    }
};

window.viewElectionResults = (electionId) => {
    // Switch to results tab and select this election
    document.querySelectorAll('.tab-btn').forEach(b => {
        const isMobile = b.closest('aside') === null;
        if (b.getAttribute('data-tab') === 'results') {
            if (isMobile) {
                b.className = 'tab-btn flex flex-col items-center p-2 text-church-800 transition duration-300';
            } else {
                b.className = 'tab-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/10 text-white font-semibold text-sm border border-white/10 transition-all';
            }
        } else {
            if (isMobile) {
                b.className = 'tab-btn flex flex-col items-center p-2 text-ink-subtle hover:text-church-800 transition duration-300';
            } else {
                b.className = 'tab-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-church-400 hover:text-white hover:bg-white/5 font-medium text-sm transition-all';
            }
        }
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById('tab-results').classList.remove('hidden');
    setPageHeader('Election Results', 'View tallies, turnout, and publish results');
    
    // Trigger results load with this election pre-selected
    loadResultsTab(electionId);
};

window.switchToResultsTab = (electionId) => {
    window.viewElectionResults(electionId);
};

// ----------------------
// CANDIDATE MANAGEMENT
// ----------------------
async function loadPositions() {
    const { data: pos } = await supabase.from('positions').select('*');
    const select = document.getElementById('can-position');
    select.innerHTML = '<option value="">Select a position...</option>';
    if (!pos) return;
    pos.forEach(p => {
        select.innerHTML += `<option value="${p.id}">${p.position_name}</option>`;
    });
}

async function loadCandidates() {
    const { data: candidates } = await supabase
        .from('candidates')
        .select('*, positions(position_name)')
        .order('created_at', { ascending: false });
    const list = document.getElementById('candidates-list');
    list.innerHTML = '';
    
    if(!candidates) return;

    if (candidates.length === 0) {
        list.innerHTML = `
            <div class="col-span-full flex flex-col items-center justify-center py-12 text-center space-y-3">
                <div class="w-14 h-14 rounded-2xl bg-church-50 border border-church-100 flex items-center justify-center">
                    <svg class="w-7 h-7 text-church-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"></path></svg>
                </div>
                <div>
                    <p class="text-sm font-bold text-slate-600">No candidates yet</p>
                    <p class="text-xs font-semibold text-slate-400 mt-1">Add candidates once — every election uses this shared roster.</p>
                </div>
            </div>
        `;
        return;
    }

    candidates.forEach(c => {
        const div = document.createElement('div');
        div.className = 'card-premium p-5 flex flex-col items-center hover:shadow-card-hover transition-all hover:-translate-y-0.5';

        const hasPhoto = c.photo_url && c.photo_url.trim() !== '' && !c.photo_url.includes('placeholder');
        const initials = c.full_name.split(' ').map(n => n[0]).join('').substring(0, 2);
        
        let photoElement = '';
        if (hasPhoto) {
            photoElement = `<img src="${c.photo_url}" class="w-28 h-28 rounded-none object-cover object-[center_20%] mb-4 border-2 border-slate-200 shadow-sm">`;
        } else {
            photoElement = `<div class="w-28 h-28 rounded-none bg-gradient-to-tr from-church-800 via-church-600 to-church-500 text-white font-black text-2xl flex items-center justify-center shadow-sm uppercase border-2 border-slate-200 mb-4">${initials}</div>`;
        }

        div.innerHTML = `
            ${photoElement}
            <h4 class="font-extrabold text-slate-800 text-base text-center tracking-tight mb-2 leading-tight">${c.full_name}</h4>
            <p class="text-[10px] text-church-700 font-extrabold mb-6 bg-church-50 border border-church-100 px-3 py-1 rounded-full uppercase tracking-wider">${c.positions?.position_name || 'Staff'}</p>
            <button onclick="window.deleteCandidate('${c.id}')" class="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 px-4 py-2.5 rounded-full transition-all active:scale-95 w-full">Delete</button>
        `;
        list.appendChild(div);
    });
}

window.deleteCandidate = async (id) => {
    if (!(await showConfirm('Delete this candidate from the roster?', {
        title: 'Delete candidate',
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        destructive: true,
    }))) return;
    
    const { error } = await supabase.from('candidates').delete().eq('id', id);
    
    if (error) {
        if (error.code === '23503') {
            showToast('error', 'Cannot delete this candidate because votes have already been cast for them.');
        } else {
            showToast('error', 'Error deleting candidate: ' + error.message);
        }
        console.error('Delete candidate error:', error);
        return;
    }

    showToast('success', 'Candidate removed.');
    loadCandidates();
};

// ======================================================================
// RESULTS TAB
// ======================================================================

function setupResultsTab() {
    // Listen for election selector change
    const selector = document.getElementById('results-election-select');
    if (selector) {
        selector.addEventListener('change', async (e) => {
            const electionId = e.target.value;
            if (!electionId) {
                selectedResultsElection = null;
                document.getElementById('results-content').innerHTML = `
                    <div class="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-3">
                        <svg class="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        <span class="text-sm font-semibold">Select an election to view results</span>
                    </div>
                `;
                document.getElementById('results-turnout').innerHTML = '';
                document.getElementById('results-election-status').innerHTML = '';
                document.getElementById('results-publish-area').innerHTML = '';
                return;
            }
            
            // Fetch election and render
            const { data: elections } = await supabase.from('elections').select('*').eq('id', electionId);
            if (elections && elections.length > 0) {
                selectedResultsElection = elections[0];
                renderResults(selectedResultsElection);
            }
        });
    }
}

function setupPublishModal() {
    const modal = document.getElementById('publish-modal');
    const cancelBtn = document.getElementById('publish-modal-cancel');
    const confirmBtn = document.getElementById('publish-modal-confirm');

    if (!modal || !cancelBtn || !confirmBtn) return;

    // Close on backdrop click
    modal.addEventListener('click', () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    });

    cancelBtn.addEventListener('click', () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    });

    confirmBtn.addEventListener('click', async () => {
        const action = confirmBtn.getAttribute('data-action');
        const electionId = confirmBtn.getAttribute('data-eid');
        
        if (!electionId) return;

        const { data: finalCheck } = await supabase.rpc('get_final_election_results', { p_election_id: electionId });
        const unresolved = (finalCheck || []).some(r =>
            ['runoff_pending', 'runoff_open', 'tie_unresolved'].includes(r.outcome)
        );
        if (action === 'publish' && unresolved) {
            showToast('warning', 'Resolve all tied positions via runoff before publishing results.');
            modal.classList.add('hidden');
            modal.classList.remove('flex');
            return;
        }

        let updateData = {};
        if (action === 'publish') {
            updateData.results_published = true;
        } else if (action === 'unpublish') {
            updateData.results_published = false;
        }

        const { error } = await supabase.from('elections').update(updateData).eq('id', electionId);
        if (error) {
            showToast('error', 'Error updating results visibility: ' + error.message);
        } else {
            showToast('success', action === 'publish' ? 'Results published — members can now see them.' : 'Results hidden from members.');
            loadElections();
        }

        modal.classList.add('hidden');
        modal.classList.remove('flex');

        // Refresh the results view
        const { data: elections } = await supabase.from('elections').select('*').eq('id', electionId);
        if (elections && elections.length > 0) {
            selectedResultsElection = elections[0];
            renderResults(selectedResultsElection);
        }
    });
}

async function loadResultsTab(preSelectedId = null) {
    // Fetch all elections for the selector
    const { data: elections } = await supabase.from('elections').select('*').order('created_at', { ascending: false });
    const selector = document.getElementById('results-election-select');
    if (!selector) return;

    selector.innerHTML = '<option value="">— Choose an election —</option>';
    if (!elections) return;

    let openElectionId = null;
    elections.forEach(el => {
        const label = `${el.title} (${el.status}${el.results_published ? ', Published' : ''})`;
        const opt = document.createElement('option');
        opt.value = el.id;
        opt.textContent = label;
        selector.appendChild(opt);
        if (el.status === 'open') openElectionId = el.id;
    });

    // Determine which election to select
    let selectId = preSelectedId || openElectionId || (elections.length > 0 ? elections[0].id : null);
    if (selectId) {
        selector.value = selectId;
        // Trigger change
        const { data: elData } = await supabase.from('elections').select('*').eq('id', selectId);
        if (elData && elData.length > 0) {
            selectedResultsElection = elData[0];
            renderResults(selectedResultsElection);
        }
    }
}

function analyzePositionTally(cans) {
    const sorted = [...cans].sort((a, b) => b.vote_count - a.vote_count);
    const max = sorted[0]?.vote_count || 0;
    const leaders = sorted.filter(c => c.vote_count === max && max > 0);
    return { sorted, max, leaders, isTie: leaders.length >= 2 };
}

window.startRunoff = async (electionId) => {
    if (!(await showConfirm(
        'Start a runoff election for all tied positions? Only the tied candidates will appear on the ballot.',
        { title: 'Start runoff', confirmLabel: 'Start runoff', cancelLabel: 'Cancel' }
    ))) return;

    const { data: runoffId, error } = await supabase.rpc('start_election_runoff', { p_election_id: electionId });
    if (error) {
        showToast('error', error.message);
        return;
    }
    showToast('success', 'Runoff is now open. Members can vote on tied positions only.');
    if (selectedResultsElection?.id === electionId) {
        renderResults(selectedResultsElection);
    }
    loadElections();
};

window.closeRunoff = async (runoffId) => {
    if (!(await showConfirm(
        'Close runoff voting? Members will no longer be able to submit runoff votes.',
        { title: 'Close runoff', confirmLabel: 'Close runoff', cancelLabel: 'Cancel' }
    ))) return;

    const { error } = await supabase.rpc('close_election_runoff', { p_runoff_id: runoffId });
    if (error) {
        showToast('error', error.message);
        return;
    }
    showToast('success', 'Runoff closed. Review final outcomes before publishing results.');
    if (selectedResultsElection) renderResults(selectedResultsElection);
    loadElections();
};

async function buildRunoffBanner(election) {
    if (election.status !== 'closed') return '';

    const [{ data: ties }, { data: runoff }] = await Promise.all([
        supabase.rpc('get_election_ties', { p_election_id: election.id }),
        supabase.from('runoffs').select('*').eq('election_id', election.id).maybeSingle(),
    ]);

    const tiedPositions = new Set((ties || []).map(t => t.position_id));
    const tiedCount = tiedPositions.size;

    if (runoff?.status === 'open') {
        return `
            <div class="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <p class="text-sm font-bold text-blue-900">Runoff voting is open</p>
                    <p class="text-xs font-semibold text-blue-700 mt-1">Members are voting again on ${tiedCount} tied position${tiedCount !== 1 ? 's' : ''}.</p>
                </div>
                <button onclick="window.closeRunoff('${runoff.id}')" class="bg-blue-700 hover:bg-blue-800 text-white px-5 py-2.5 rounded-full text-xs font-bold transition active:scale-95 shrink-0">
                    Close runoff
                </button>
            </div>
        `;
    }

    if (runoff?.status === 'closed') {
        return `
            <div class="bg-church-50 border border-church-200 rounded-2xl p-4 mb-6">
                <p class="text-sm font-bold text-church-900">Runoff completed</p>
                <p class="text-xs font-semibold text-church-700 mt-1">Review final outcomes below, then publish when ready.</p>
            </div>
        `;
    }

    if (tiedCount > 0) {
        return `
            <div class="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                    <p class="text-sm font-bold text-amber-900">${tiedCount} position${tiedCount !== 1 ? 's' : ''} tied</p>
                    <p class="text-xs font-semibold text-amber-800 mt-1">Start a runoff so members can vote again between the tied candidates only.</p>
                </div>
                <button onclick="window.startRunoff('${election.id}')" class="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2.5 rounded-full text-xs font-bold transition active:scale-95 shrink-0">
                    Start runoff
                </button>
            </div>
        `;
    }

    return '';
}

async function renderResults(election) {
    const contentEl = document.getElementById('results-content');
    const turnoutEl = document.getElementById('results-turnout');
    const statusEl = document.getElementById('results-election-status');
    const publishArea = document.getElementById('results-publish-area');

    // Update status pill
    const statusColors = {
        'upcoming': 'bg-blue-50 text-blue-700 border-blue-100',
        'open': 'bg-emerald-50 text-emerald-700 border-emerald-100',
        'closed': 'bg-slate-100 text-slate-600 border-slate-200'
    };
    statusEl.className = `inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${statusColors[election.status] || 'bg-slate-100 text-slate-500'}`;
    statusEl.innerHTML = `${election.status}${election.status === 'open' ? ' <span class="animate-pulse">🔴</span>' : ''}`;

    // Publish button
    publishArea.innerHTML = '';
    if (election.status === 'closed') {
        const { data: finalCheck } = await supabase.rpc('get_final_election_results', { p_election_id: election.id });
        const unresolved = (finalCheck || []).some(r =>
            ['runoff_pending', 'runoff_open', 'tie_unresolved'].includes(r.outcome)
        );

        if (!election.results_published) {
            if (unresolved) {
                publishArea.innerHTML = `
                    <span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200">
                        Resolve all ties before publishing
                    </span>
                `;
            } else {
                publishArea.innerHTML = `
                    <button onclick="window.showPublishModal('${election.id}', 'publish')" class="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white px-5 py-2.5 rounded-full text-xs font-bold transition active:scale-95 shadow-sm">
                        Publish Results
                    </button>
                `;
            }
        } else {
            publishArea.innerHTML = `
                <span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-church-50 text-church-700 border border-church-200 mr-2">Published ✓</span>
                <button onclick="window.showPublishModal('${election.id}', 'unpublish')" class="bg-slate-100 border border-slate-200 text-slate-700 hover:bg-slate-200 px-5 py-2.5 rounded-full text-xs font-bold transition active:scale-95">
                    Unpublish
                </button>
            `;
        }
    } else if (election.status === 'open') {
        // Don't show publish button for open elections
        publishArea.innerHTML = `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-100">Results show live during voting</span>`;
    } else {
        publishArea.innerHTML = `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">Voting has not started</span>`;
    }

    // Show loading state
    contentEl.innerHTML = `
        <div class="flex flex-col items-center justify-center py-16 text-center text-slate-400 space-y-3">
            <div class="animate-spin rounded-full h-9 w-9 border-2 border-slate-200 border-t-church-600"></div>
            <span class="text-xs font-bold uppercase tracking-wider">Tallying results…</span>
        </div>
    `;

    try {
        // Fetch summary results and candidate photos
        const [{ data: results, error }, photoById] = await Promise.all([
            supabase.rpc('get_admin_election_summary', { election_id: election.id }),
            fetchCandidatePhotos(supabase),
        ]);

        if (error) {
            throw error;
        }

        // Fetch turnout data
        const { data: turnout } = await supabase.rpc('get_election_turnout', { election_id: election.id });

        // Render turnout cards
        renderTurnoutCards(turnoutEl, turnout, election);

        if (!results || results.length === 0) {
            contentEl.innerHTML = `
                <div class="flex flex-col items-center justify-center py-16 text-center space-y-4">
                    <div class="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                        <svg class="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-slate-600">No results yet</p>
                        <p class="text-xs font-semibold text-slate-400 mt-1">No candidates or votes have been recorded for this election.</p>
                    </div>
                </div>
            `;
            return;
        }

        // Group by position
        const grouped = {};
        results.forEach(r => {
            if (!grouped[r.position_name]) grouped[r.position_name] = [];
            grouped[r.position_name].push(r);
        });

        // Render tallies
        const runoffBanner = await buildRunoffBanner(election);
        let html = runoffBanner + '<div class="space-y-6">';
        for (const [posName, cans] of sortPositionEntries(grouped)) {
            const totalInPos = cans[0]?.total_votes_in_position || 0;
            const { sorted, isTie, leaders } = analyzePositionTally(cans);
            const tiedNames = leaders.map(c => escapeHtml(c.candidate_name)).join(', ');

            html += `
                <section class="rounded-3xl border border-slate-100 bg-white shadow-soft overflow-hidden">
                    <header class="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-church-900 to-church-700 text-white">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <svg class="w-5 h-5 text-church-200 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path></svg>
                            <h4 class="text-base sm:text-lg font-extrabold tracking-tight truncate">${escapeHtml(posName)}</h4>
                        </div>
                        <span class="flex-shrink-0 text-[11px] font-bold uppercase tracking-wider bg-white/15 border border-white/20 px-3 py-1 rounded-full">${totalInPos} vote${totalInPos !== 1 ? 's' : ''}</span>
                    </header>
                    ${isTie ? `<p class="px-5 py-3 text-xs font-bold text-amber-800 bg-amber-50 border-b border-amber-100">Tie: ${tiedNames}</p>` : ''}
                    <div class="p-4 sm:p-5 space-y-3">`;

            sorted.forEach((c, index) => {
                const isWinner = !isTie && index === 0 && c.vote_count > 0;
                const pct = totalInPos > 0 ? Math.round((c.vote_count / totalInPos) * 100) : 0;
                const rankBadge = isWinner
                    ? '<span class="w-8 h-8 flex-shrink-0 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 text-white flex items-center justify-center text-sm shadow-soft">👑</span>'
                    : `<span class="w-8 h-8 flex-shrink-0 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm font-black">${index + 1}</span>`;

                const avatar = candidatePhotoHtml(photoById[c.candidate_id], c.candidate_name, {
                    imgClass: 'w-20 h-20 flex-shrink-0 rounded-none object-cover object-[center_20%] border-2 border-white shadow-sm',
                    fallbackClass: 'w-20 h-20 flex-shrink-0 rounded-none bg-gradient-to-tr from-church-700 to-church-500 text-white flex items-center justify-center font-bold text-sm uppercase shadow-sm',
                });

                html += `
                    <div class="relative overflow-hidden rounded-2xl border p-4 transition duration-300 hover:shadow-card-hover ${isWinner ? 'border-gold-300 bg-gold-50/50' : 'border-slate-100 bg-slate-50/60'}">
                        <div class="flex items-center gap-3 sm:gap-4">
                            ${rankBadge}
                            ${avatar}
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="font-extrabold text-sm sm:text-base ${isWinner ? 'text-church-900' : 'text-slate-700'} truncate">${c.candidate_name}</span>
                                    ${isWinner ? '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-gold-100 text-gold-800 uppercase tracking-wider">Leading</span>' : ''}
                                </div>
                                <div class="mt-2 w-full h-2 bg-slate-200/70 rounded-full overflow-hidden">
                                    <div class="h-full rounded-full transition-all duration-700 ${isWinner ? 'bg-gradient-to-r from-gold-500 to-gold-400' : 'bg-gradient-to-r from-church-700 to-church-500'}" style="width: ${pct}%"></div>
                                </div>
                            </div>
                            <div class="text-right flex-shrink-0">
                                <span class="block font-black text-lg leading-none ${isWinner ? 'text-gold-700' : 'text-church-900'}">${c.vote_count}</span>
                                <span class="text-[11px] text-slate-400 font-bold">${pct}%</span>
                            </div>
                        </div>
                    </div>`;
            });

            html += `</div></section>`;
        }
        html += '</div>';

        // If election is open, show a live banner
        if (election.status === 'open') {
            html = `
                <div class="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 mb-6 flex items-center space-x-3">
                    <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
                    <span class="text-sm font-bold text-emerald-800">Live Results — updating in real time as votes are cast.</span>
                </div>
            ` + html;
        } else if (election.status === 'closed' && !election.results_published) {
            html = `
                <div class="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-6 flex items-center space-x-3">
                    <svg class="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                    <span class="text-sm font-bold text-amber-800">Results are not yet published. Members cannot see them.</span>
                </div>
            ` + html;
        } else if (election.status === 'closed' && election.results_published) {
            html = `
                <div class="bg-church-50 border border-church-200 rounded-2xl p-4 mb-6 flex items-center space-x-3">
                    <svg class="w-5 h-5 text-church-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span class="text-sm font-bold text-church-800">Results are published. Members can view them.</span>
                </div>
            ` + html;
        }

        contentEl.innerHTML = html;

    } catch (err) {
        console.error('Error loading results:', err);
        contentEl.innerHTML = `
            <div class="flex flex-col items-center justify-center py-14 text-center text-red-500 border border-red-200/60 bg-red-50/50 rounded-3xl p-6 space-y-2">
                <div class="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center">
                    <svg class="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                </div>
                <span class="font-bold text-sm">Failed to load results</span>
                <span class="text-xs opacity-80">${err.message}</span>
            </div>
        `;
    }
}

function renderTurnoutCards(container, turnout, election) {
    if (!container) return;

    const data = turnout && turnout.length > 0 ? turnout[0] : null;

    if (!data) {
        container.innerHTML = `
            <div class="col-span-2 sm:col-span-3 lg:col-span-6 flex items-center justify-center py-6 text-slate-400 text-sm font-semibold bg-slate-50/60 border border-dashed border-slate-200 rounded-2xl">
                Turnout data not available yet
            </div>`;
        return;
    }

    const turnoutPct = Math.max(0, Math.min(100, Number(data.turnout_percentage) || 0));
    const pendingMembers = data.pending_members ?? 0;
    const rejectedMembers = data.rejected_members ?? 0;

    const stat = (label, value, sub, ring, iconPath) => `
        <div class="bg-white border border-slate-100 rounded-2xl p-4 shadow-soft hover:shadow-card-hover transition-all duration-300">
            <div class="flex items-center justify-between mb-3">
                <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400">${label}</span>
                <span class="w-8 h-8 rounded-xl ${ring} flex items-center justify-center">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"></path></svg>
                </span>
            </div>
            <span class="text-2xl font-black text-church-900 leading-none">${value}</span>
            <span class="block mt-1.5 text-[11px] font-semibold text-slate-400">${sub}</span>
        </div>`;

    const peopleIcon = 'M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4zm6 0a3 3 0 10-2.83-5';
    const checkIcon = 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
    const clockIcon = 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
    const rejectIcon = 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z';
    const ballotIcon = 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';

    container.innerHTML = `
        ${stat('Total Members', data.total_members, 'On the register', 'bg-church-50 text-church-700', peopleIcon)}
        ${stat('Pending', pendingMembers, 'Awaiting approval', 'bg-amber-50 text-amber-600', clockIcon)}
        ${stat('Approved', data.approved_voters, 'Eligible to vote', 'bg-emerald-50 text-emerald-600', checkIcon)}
        ${stat('Rejected', rejectedMembers, 'Not approved', 'bg-red-50 text-red-600', rejectIcon)}
        ${stat('Members Voted', data.votes_cast, election.status === 'open' ? 'Counting live' : 'Unique voters', 'bg-ember-50 text-ember-600', ballotIcon)}
        <div class="bg-gradient-to-br from-church-900 to-church-700 text-white rounded-2xl p-4 shadow-premium flex items-center gap-4">
            <div class="relative w-14 h-14 flex-shrink-0 rounded-full" style="background: conic-gradient(#ee8636 ${turnoutPct}%, rgba(255,255,255,0.18) ${turnoutPct}%);">
                <div class="absolute inset-[5px] rounded-full bg-church-900 flex items-center justify-center">
                    <span class="text-[13px] font-black">${turnoutPct}%</span>
                </div>
            </div>
            <div class="min-w-0">
                <span class="block text-[11px] font-bold uppercase tracking-wider text-white/60">Turnout</span>
                <span class="block text-lg font-black leading-tight">${data.votes_cast}/${data.approved_voters}</span>
                <span class="block text-[11px] font-semibold text-white/60">voters participated</span>
            </div>
        </div>
    `;
}

window.showPublishModal = (electionId, action) => {
    const modal = document.getElementById('publish-modal');
    const confirmBtn = document.getElementById('publish-modal-confirm');
    const titleEl = document.getElementById('publish-modal-title');
    const textEl = document.getElementById('publish-modal-text');
    const iconContainer = document.getElementById('publish-modal-icon');

    confirmBtn.setAttribute('data-action', action);
    confirmBtn.setAttribute('data-eid', electionId);

    if (action === 'publish') {
        titleEl.textContent = 'Publish Election Results?';
        textEl.textContent = 'Members will be able to see the full election tallies. This action can be reversed.';
        iconContainer.innerHTML = `<svg class="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`;
        iconContainer.className = 'w-14 h-14 mx-auto rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center';
        confirmBtn.className = 'flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white font-bold py-3 rounded-full transition active:scale-95 text-sm';
        confirmBtn.textContent = 'Yes, Publish';
    } else {
        titleEl.textContent = 'Unpublish Election Results?';
        textEl.textContent = 'Members will no longer see the results. This action can be reversed.';
        iconContainer.innerHTML = `<svg class="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>`;
        iconContainer.className = 'w-14 h-14 mx-auto rounded-full bg-amber-50 border border-amber-100 flex items-center justify-center';
        confirmBtn.className = 'flex-1 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-bold py-3 rounded-full transition active:scale-95 text-sm';
        confirmBtn.textContent = 'Yes, Unpublish';
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');
};