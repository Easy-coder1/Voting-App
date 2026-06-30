import { supabase, getCurrentUser, subscribeToTableChanges, confirmSignOut } from './supabase.js';
import { sortPositionEntries, candidatePhotoHtml, fetchCandidatePhotos } from './positionOrder.js';

let currentUser = null;
let currentProfile = null;
let turnoutChartInstance = null;
let selectedResultsElection = null;

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

        if (profileError || !profile || profile.role !== 'admin') {
            console.error('Admin profile error:', profileError);
            window.location.href = '/pages/member/dashboard.html';
            return;
        }
        currentProfile = profile;
        const name = profile.full_name || 'Admin';
        document.getElementById('admin-name').textContent = name;
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2);
        const avatarEl = document.getElementById('admin-avatar-badge');
        if (avatarEl) avatarEl.textContent = initials;

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
            subscribeToTableChanges(['profiles', 'votes'], () => {
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
                    subtitle: 'Member stats, turnout, and live election status'
                },
                members: {
                    title: 'Member Management',
                    subtitle: 'Approve accounts and manage voting rights'
                },
                elections: {
                    title: 'Election Management',
                    subtitle: 'Create elections and control ballot status'
                },
                candidates: {
                    title: 'Candidate Management',
                    subtitle: 'Add and manage candidates for elections'
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
    const [ {count: totalMembers}, {count: pending}, {count: approved}, {count: totalVotes} ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'member'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('account_status', 'pending').eq('role', 'member'),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('account_status', 'approved').eq('role', 'member'),
        supabase.from('votes').select('*', { count: 'exact', head: true })
    ]);

    document.getElementById('stat-total-members').textContent = totalMembers || 0;
    document.getElementById('stat-pending').textContent = pending || 0;
    document.getElementById('stat-approved').textContent = approved || 0;
    document.getElementById('stat-votes').textContent = totalVotes || 0;

    renderChart(approved || 0, totalMembers ? totalMembers - approved : 0);
    
    // Check active election
    const { data: elections } = await supabase.from('elections').select('*').eq('status', 'open').limit(1);
    const statusContainer = document.getElementById('live-election-status');
    if (statusContainer) {
        if(elections && elections.length > 0) {
            statusContainer.innerHTML = `
                <div class="space-y-4">
                    <div class="flex items-center space-x-2.5">
                        <span class="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
                        <span class="font-extrabold text-base text-slate-800">Active: ${elections[0].title}</span>
                    </div>
                    <div class="flex justify-between border-t border-slate-200/50 pt-4 text-xs font-semibold text-slate-400">
                        <span>Closing Date</span>
                        <span class="text-slate-700 font-bold">${new Date(elections[0].end_date).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}</span>
                    </div>
                    <button onclick="window.switchToResultsTab('${elections[0].id}')" class="mt-3 w-full bg-church-50 border border-church-100 text-church-700 hover:bg-church-100 px-4 py-2.5 rounded-full text-xs font-bold transition active:scale-95">
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

function renderChart(approved, others) {
    const ctx = document.getElementById('turnoutChart');
    if (!ctx) return;
    
    if (turnoutChartInstance) {
        turnoutChartInstance.data.datasets[0].data = [approved, others];
        turnoutChartInstance.update();
        return;
    }

    turnoutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Approved Voters', 'Others (Pending/Suspended)'],
            datasets: [{
                data: [approved, others],
                backgroundColor: ['#9e1b2e', '#f6c2c8'],
                borderWidth: 0,
                hoverOffset: 4
            }]
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
                            family: 'Plus Jakarta Sans'
                        }
                    }
                }
            }
        }
    });
}

// ----------------------
// MEMBER MANAGEMENT
// ----------------------
async function loadMembers() {
    const { data: members, error } = await supabase.from('profiles').select('*').eq('role', 'member').order('created_at', { ascending: false });
    const list = document.getElementById('members-list');
    list.innerHTML = '';
    
    if (error) {
        alert('Error fetching members: ' + error.message);
        return;
    }
    if (!members) return;

    members.forEach(m => {
        const div = document.createElement('div');
        div.className = 'flex flex-row flex-wrap justify-between items-center p-5 border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition duration-150 gap-4 bg-white';
        
        const initials = m.full_name.split(' ').map(n => n[0]).join('').substring(0, 2);
        const statusColors = {
            'pending': 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
            'approved': 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
        };

        const votingEnabled = m.account_status === 'approved';
        div.innerHTML = `
            <div class="flex items-center space-x-4">
                <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-church-700 to-church-500 text-white flex items-center justify-center font-bold text-sm uppercase shadow-sm">${initials}</div>
                <div>
                    <h4 class="font-extrabold text-church-900 leading-tight">${m.full_name}</h4>
                    <p class="text-xs text-slate-400 font-semibold mt-0.5">${m.email}</p>
                </div>
            </div>
            <div class="flex items-center gap-4">
                <div class="flex flex-col space-y-1 min-w-[120px]">
                    <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Account Status</span>
                    <select onchange="window.updateMemberStatus('${m.id}', this.value)" class="text-xs rounded-full border px-3 py-1.5 font-bold cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-church-500 shadow-sm outline-none ${statusColors[m.account_status] || ''}">
                        <option value="pending" ${m.account_status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="approved" ${m.account_status === 'approved' ? 'selected' : ''}>Approved</option>
                    </select>
                </div>
                <div class="flex flex-col space-y-1">
                    <span class="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Voting Rights</span>
                    <span title="Voting rights are controlled by the account status"
                        class="text-xs px-3.5 py-1.5 rounded-full font-bold shadow-sm border text-center cursor-not-allowed ${votingEnabled ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}">
                        ${votingEnabled ? 'ENABLED ✓' : 'DISABLED'}
                    </span>
                </div>
            </div>
        `;
        list.appendChild(div);
    });
}

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
            alert('Error updating status: ' + error.message);
        } else {
            loadMembers();
            loadAnalytics();
        }
    } catch (err) {
        alert('Exception updating status: ' + err.message);
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
            alert('Error creating election: ' + (error?.message || 'Unknown error'));
            return;
        }

        // Attach draft candidates and copy roster from the previous election if needed.
        const newElectionId = created[0].id;
        const attachResult = await attachCandidatesToElection(newElectionId);

        if (attachResult.error) {
            alert('Election created, but candidates could not be attached: ' + attachResult.error);
        } else if (attachResult.count === 0) {
            alert('Election created, but no candidates were linked. Add candidates on the Candidates tab, then edit this election or create a new one.');
        }

        e.target.reset();
        loadElections();
        loadCandidates();
    });

    document.getElementById('add-candidate-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('can-name').value;
        const pos = document.getElementById('can-position').value;
        const photo = document.getElementById('can-photo').value;

        const row = { full_name: name, position_id: pos, photo_url: photo || null };

        // Link new candidates to the current upcoming or open election when one exists.
        const { data: activeElections } = await supabase
            .from('elections')
            .select('id')
            .in('status', ['upcoming', 'open'])
            .order('created_at', { ascending: false })
            .limit(1);

        if (activeElections?.[0]) {
            row.election_id = activeElections[0].id;
        }

        await supabase.from('candidates').insert([row]);
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
        alert('Please select a valid image file.');
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
    const { data: elections } = await supabase.from('elections').select('*').order('created_at', { ascending: false });
    const list = document.getElementById('elections-list');
    list.innerHTML = '';

    if(!elections) return;

    elections.forEach(el => {
        const div = document.createElement('div');
        div.className = 'card-premium p-5 flex flex-col md:flex-row justify-between items-start md:items-center hover:shadow-card-hover transition-all';
        
        const statusColors = {
            'upcoming': 'bg-blue-50 text-blue-700 border-blue-100',
            'open': 'bg-emerald-50 text-emerald-700 border-emerald-100 animate-pulse',
            'closed': 'bg-slate-100 text-slate-600 border-slate-200'
        };

        div.innerHTML = `
            <div class="space-y-2">
                <h4 class="font-extrabold text-lg text-slate-800 tracking-tight leading-tight">${el.title}</h4>
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
                <select onchange="window.updateElectionStatus('${el.id}', this.value)" class="text-xs border border-slate-200 bg-white shadow-sm rounded-full px-4 py-2.5 font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-church-500">
                    <option value="upcoming" ${el.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
                    <option value="open" ${el.status === 'open' ? 'selected' : ''}>Open</option>
                    <option value="closed" ${el.status === 'closed' ? 'selected' : ''}>Closed</option>
                </select>
                <button onclick="window.viewElectionResults('${el.id}')" class="text-xs bg-church-50 border border-church-100 text-church-700 hover:bg-church-100 px-4 py-2.5 rounded-full font-bold transition-all duration-300 active:scale-95">
                    View Results
                </button>
                <button onclick="window.toggleResults('${el.id}', ${!el.results_published})" class="text-xs bg-church-50 border border-church-200 text-church-700 px-4 py-2.5 rounded-full font-bold hover:bg-church-100 hover:text-church-900 transition-all duration-300 active:scale-95">
                    Toggle Publish
                </button>
                <button onclick="window.deleteElection('${el.id}', '${(el.title || '').replace(/'/g, "\\'")}')" class="text-xs bg-red-50 border border-red-200 text-red-600 px-4 py-2.5 rounded-full font-bold hover:bg-red-100 hover:text-red-700 transition-all duration-300 active:scale-95">
                    Delete
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

window.updateElectionStatus = async (id, status) => {
    try {
        const { error } = await supabase.from('elections').update({ status }).eq('id', id);
        if (error) {
            alert('Error updating election status: ' + error.message);
            return;
        }

        if (status === 'open' || status === 'upcoming') {
            const { error: attachError, count } = await attachCandidatesToElection(id);
            if (attachError) {
                alert('Election updated, but candidates could not be linked: ' + attachError);
            } else if (count === 0) {
                alert('Election updated, but it has no candidates yet. Add candidates on the Candidates tab.');
            }
        }

        loadElections();
        loadAnalytics();
    } catch (err) {
        alert('Exception updating election status: ' + err.message);
    }
};

window.deleteElection = async (id, title) => {
    if (!confirm(`Delete election "${title}"? This will permanently remove the election and all of its votes. This action cannot be undone.`)) {
        return;
    }
    try {
        const { error: votesError } = await supabase.from('votes').delete().eq('election_id', id);
        if (votesError) {
            alert('Error deleting election votes: ' + votesError.message);
            return;
        }

        const { error } = await supabase.from('elections').delete().eq('id', id);
        if (error) {
            alert('Error deleting election: ' + error.message);
        } else {
            loadElections();
            loadAnalytics();
        }
    } catch (err) {
        alert('Exception deleting election: ' + err.message);
    }
};

window.toggleResults = async (id, pub) => {
    try {
        const { error } = await supabase.from('elections').update({ results_published: pub }).eq('id', id);
        if (error) {
            alert('Error toggling results: ' + error.message);
        } else {
            loadElections();
        }
    } catch (err) {
        alert('Exception toggling results: ' + err.message);
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
async function attachCandidatesToElection(electionId) {
    const { error: draftError } = await supabase
        .from('candidates')
        .update({ election_id: electionId })
        .is('election_id', null);

    if (draftError) {
        return { error: draftError.message, count: 0 };
    }

    const { data: current, error: currentError } = await supabase
        .from('candidates')
        .select('full_name, position_id')
        .eq('election_id', electionId);

    if (currentError) {
        return { error: currentError.message, count: 0 };
    }

    const existing = new Set((current || []).map(c => `${c.position_id}:${c.full_name}`));

    const { data: prevElections, error: prevError } = await supabase
        .from('elections')
        .select('id')
        .neq('id', electionId)
        .order('created_at', { ascending: false })
        .limit(1);

    if (prevError) {
        return { error: prevError.message, count: existing.size };
    }

    if (prevElections?.[0]) {
        const { data: templates, error: templateError } = await supabase
            .from('candidates')
            .select('full_name, position_id, photo_url')
            .eq('election_id', prevElections[0].id);

        if (templateError) {
            return { error: templateError.message, count: existing.size };
        }

        const toInsert = (templates || [])
            .filter(t => !existing.has(`${t.position_id}:${t.full_name}`))
            .map(t => ({
                full_name: t.full_name,
                position_id: t.position_id,
                photo_url: t.photo_url,
                election_id: electionId,
            }));

        if (toInsert.length) {
            const { error: insertError } = await supabase.from('candidates').insert(toInsert);
            if (insertError) {
                return { error: insertError.message, count: existing.size };
            }
        }
    }

    const { count, error: countError } = await supabase
        .from('candidates')
        .select('*', { count: 'exact', head: true })
        .eq('election_id', electionId);

    if (countError) {
        return { error: countError.message, count: existing.size };
    }

    return { error: null, count: count || 0 };
}

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
        .select('*, positions(position_name), elections(title, status)')
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
                    <p class="text-xs font-semibold text-slate-400 mt-1">Add candidates here, then create an election to use them for voting.</p>
                </div>
            </div>
        `;
        return;
    }

    candidates.forEach(c => {
        const div = document.createElement('div');
        div.className = 'card-premium p-5 flex flex-col items-center hover:shadow-card-hover transition-all hover:-translate-y-0.5';

        const electionLabel = c.elections?.title
            ? c.elections.title
            : 'Draft — next election';
        
        const hasPhoto = c.photo_url && c.photo_url.trim() !== '' && !c.photo_url.includes('placeholder');
        const initials = c.full_name.split(' ').map(n => n[0]).join('').substring(0, 2);
        
        let photoElement = '';
        if (hasPhoto) {
            photoElement = `<img src="${c.photo_url}" class="w-20 h-20 rounded-none object-cover object-[center_20%] mb-4 border-2 border-slate-200 shadow-sm">`;
        } else {
            photoElement = `<div class="w-20 h-20 rounded-none bg-gradient-to-tr from-church-800 via-church-600 to-church-500 text-white font-black text-xl flex items-center justify-center shadow-sm uppercase border-2 border-slate-200 mb-4">${initials}</div>`;
        }

        div.innerHTML = `
            ${photoElement}
            <h4 class="font-extrabold text-slate-800 text-base text-center tracking-tight mb-1 leading-tight">${c.full_name}</h4>
            <p class="text-[10px] text-church-700 font-extrabold mb-2 bg-church-50 border border-church-100 px-3 py-1 rounded-full uppercase tracking-wider">${c.positions?.position_name || 'Staff'}</p>
            <p class="text-[10px] text-slate-500 font-semibold mb-6 text-center leading-snug">${electionLabel}</p>
            <button onclick="window.deleteCandidate('${c.id}')" class="text-xs font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 px-4 py-2.5 rounded-full transition-all active:scale-95 w-full">Delete</button>
        `;
        list.appendChild(div);
    });
}

window.deleteCandidate = async (id) => {
    if(!confirm('Delete candidate?')) return;
    
    const { error } = await supabase.from('candidates').delete().eq('id', id);
    
    if (error) {
        if (error.code === '23503') {
            alert('Cannot delete this candidate because votes have already been cast for them. To delete this candidate, you must first remove all associated votes.');
        } else {
            alert('Error deleting candidate: ' + error.message);
        }
        console.error('Delete candidate error:', error);
    }
    
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

        let updateData = {};
        if (action === 'publish') {
            updateData.results_published = true;
        } else if (action === 'unpublish') {
            updateData.results_published = false;
        }

        const { error } = await supabase.from('elections').update(updateData).eq('id', electionId);
        if (error) {
            alert('Error updating results visibility: ' + error.message);
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
        if (!election.results_published) {
            publishArea.innerHTML = `
                <button onclick="window.showPublishModal('${election.id}', 'publish')" class="bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white px-5 py-2.5 rounded-full text-xs font-bold transition active:scale-95 shadow-sm">
                    Publish Results
                </button>
            `;
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
            fetchCandidatePhotos(supabase, election.id),
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
        let html = '<div class="space-y-6">';
        for (const [posName, cans] of sortPositionEntries(grouped)) {
            const totalInPos = cans[0]?.total_votes_in_position || 0;
            const leaderVotes = cans[0]?.vote_count || 0;
            const isTie = leaderVotes > 0 && (cans[1]?.vote_count || 0) === leaderVotes;

            html += `
                <section class="rounded-3xl border border-slate-100 bg-white shadow-soft overflow-hidden">
                    <header class="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-church-900 to-church-700 text-white">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <svg class="w-5 h-5 text-church-200 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path></svg>
                            <h4 class="text-base sm:text-lg font-extrabold tracking-tight truncate">${posName}</h4>
                        </div>
                        <span class="flex-shrink-0 text-[11px] font-bold uppercase tracking-wider bg-white/15 border border-white/20 px-3 py-1 rounded-full">${totalInPos} vote${totalInPos !== 1 ? 's' : ''}</span>
                    </header>
                    <div class="p-4 sm:p-5 space-y-3">`;

            cans.forEach((c, index) => {
                const isWinner = !isTie && index === 0 && c.vote_count > 0;
                const pct = totalInPos > 0 ? Math.round((c.vote_count / totalInPos) * 100) : 0;
                const rankBadge = isWinner
                    ? '<span class="w-8 h-8 flex-shrink-0 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 text-white flex items-center justify-center text-sm shadow-soft">👑</span>'
                    : `<span class="w-8 h-8 flex-shrink-0 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-sm font-black">${index + 1}</span>`;

                const avatar = candidatePhotoHtml(photoById[c.candidate_id], c.candidate_name, {
                    imgClass: 'w-12 h-12 flex-shrink-0 rounded-none object-cover object-[center_20%] border-2 border-white shadow-sm',
                    fallbackClass: 'w-12 h-12 flex-shrink-0 rounded-none bg-gradient-to-tr from-church-700 to-church-500 text-white flex items-center justify-center font-bold text-xs uppercase shadow-sm',
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
            <div class="col-span-2 sm:col-span-4 flex items-center justify-center py-6 text-slate-400 text-sm font-semibold bg-slate-50/60 border border-dashed border-slate-200 rounded-2xl">
                Turnout data not available yet
            </div>`;
        return;
    }

    const turnoutPct = Math.max(0, Math.min(100, Number(data.turnout_percentage) || 0));

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
    const ballotIcon = 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';

    container.innerHTML = `
        ${stat('Total Members', data.total_members, 'On the register', 'bg-church-50 text-church-700', peopleIcon)}
        ${stat('Eligible Voters', data.approved_voters, 'Approved to vote', 'bg-emerald-50 text-emerald-600', checkIcon)}
        ${stat('Votes Cast', data.votes_cast, election.status === 'open' ? 'Counting live' : 'Total ballots', 'bg-ember-50 text-ember-600', ballotIcon)}
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