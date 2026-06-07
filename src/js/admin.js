import { insforge } from './insforge.js';

let currentUser = null;
let currentProfile = null;
let turnoutChartInstance = null;
let selectedResultsElection = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Auth Check
        const { data: currentUserData, error: sessionError } = await insforge.auth.getCurrentUser();
        if (sessionError || !currentUserData?.user) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = currentUserData.user;

        // 2. Load Profile and verify Admin
        const { data: profile, error: profileError } = await insforge.database
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
            await insforge.auth.signOut();
            window.location.href = '/';
        });

        setupTabs();
        loadAnalytics();
        setupForms();
        setupResultsTab();
        setupPublishModal();

        // Subscribe to realtime updates for live analytics
        insforge.channel('public:profiles')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
                loadAnalytics();
                if(!document.getElementById('tab-members').classList.contains('hidden')){
                    loadMembers();
                }
            })
            .subscribe();

        insforge.channel('public:votes')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, payload => {
                loadAnalytics();
                // If results tab is open and we're viewing an open election, refresh live
                if (!document.getElementById('tab-results').classList.contains('hidden') && selectedResultsElection && selectedResultsElection.status === 'open') {
                    renderResults(selectedResultsElection);
                }
            })
            .subscribe();
    } catch (err) {
        console.error('Admin dashboard init error:', err);
        const main = document.querySelector('main') || document.body;
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'padding:40px;text-align:center;color:#dc2626;font-weight:600;font-family:sans-serif;';
        errDiv.innerHTML = `Failed to load admin dashboard: ${err.message}.<br>Please try <a style="text-decoration:underline" href="/pages/login.html">logging in again</a>.`;
        main.prepend(errDiv);
    }
});

function setupTabs() {
    const btns = document.querySelectorAll('.tab-btn');
    const contents = document.querySelectorAll('.tab-content');
    const title = document.getElementById('page-title');

    btns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            
            // Loop through all buttons to apply correct responsive classes
            btns.forEach(b => {
                const targetTab = b.getAttribute('data-tab');
                const isMobile = b.closest('nav') !== null;
                
                if (targetTab === tabId) {
                    if (isMobile) {
                        b.className = 'tab-btn flex flex-col items-center p-2 text-church-600 transition duration-300';
                    } else {
                        b.className = 'tab-btn w-full flex items-center space-x-3 px-4 py-3 rounded-2xl bg-church-600 text-white font-semibold transition-all duration-300';
                    }
                } else {
                    if (isMobile) {
                        b.className = 'tab-btn flex flex-col items-center p-2 text-slate-400 hover:text-church-600 transition duration-300';
                    } else {
                        b.className = 'tab-btn w-full flex items-center space-x-3 px-4 py-3 rounded-2xl text-slate-400 hover:text-white hover:bg-slate-900 font-semibold transition-all duration-300';
                    }
                }
            });

            // Show corresponding content
            contents.forEach(c => c.classList.add('hidden'));
            document.getElementById(`tab-${tabId}`).classList.remove('hidden');

            // Format tab name
            const tabNames = {
                'analytics': 'Analytics',
                'members': 'Member Management',
                'elections': 'Election Management',
                'candidates': 'Candidate Management',
                'results': 'Election Results'
            };
            title.textContent = tabNames[tabId] || tabId.charAt(0).toUpperCase() + tabId.slice(1);

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
        insforge.database.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'member'),
        insforge.database.from('profiles').select('*', { count: 'exact', head: true }).eq('account_status', 'pending').eq('role', 'member'),
        insforge.database.from('profiles').select('*', { count: 'exact', head: true }).eq('account_status', 'approved').eq('role', 'member'),
        insforge.database.from('votes').select('*', { count: 'exact', head: true })
    ]);

    document.getElementById('stat-total-members').textContent = totalMembers || 0;
    document.getElementById('stat-pending').textContent = pending || 0;
    document.getElementById('stat-approved').textContent = approved || 0;
    document.getElementById('stat-votes').textContent = totalVotes || 0;

    renderChart(approved || 0, totalMembers ? totalMembers - approved : 0);
    
    // Check active election
    const { data: elections } = await insforge.database.from('elections').select('*').eq('status', 'open').limit(1);
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
                backgroundColor: ['#4f46e5', '#e2e8f0'],
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
                            family: 'Inter'
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
    const { data: members, error } = await insforge.database.from('profiles').select('*').eq('role', 'member').order('created_at', { ascending: false });
    const list = document.getElementById('members-list');
    list.innerHTML = '';
    
    if (error) {
        alert('Error fetching members: ' + error.message);
        return;
    }
    if (!members) return;

    members.forEach(m => {
        const div = document.createElement('div');
        div.className = 'flex flex-col sm:flex-row justify-between items-start sm:items-center p-5 border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition duration-150 gap-4 bg-white';
        
        const initials = m.full_name.split(' ').map(n => n[0]).join('').substring(0, 2);
        const statusColors = {
            'pending': 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
            'approved': 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
            'rejected': 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
            'suspended': 'bg-slate-100 text-slate-650 border-slate-200 hover:bg-slate-200'
        };

        div.innerHTML = `
            <div class="flex items-center space-x-4">
                <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-church-600 to-indigo-500 text-white flex items-center justify-center font-bold text-sm uppercase shadow-sm">${initials}</div>
                <div>
                    <h4 class="font-extrabold text-slate-900 leading-tight">${m.full_name}</h4>
                    <p class="text-xs text-slate-400 font-semibold mt-0.5">${m.email}</p>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-4 w-full sm:w-auto">
                <div class="flex flex-col space-y-1 w-full sm:w-auto min-w-[120px]">
                    <span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Account Status</span>
                    <select onchange="window.updateMemberStatus('${m.id}', this.value)" class="text-xs rounded-full border px-3 py-1.5 font-bold cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-church-500 shadow-sm outline-none ${statusColors[m.account_status] || ''}">
                        <option value="pending" ${m.account_status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="approved" ${m.account_status === 'approved' ? 'selected' : ''}>Approved</option>
                        <option value="rejected" ${m.account_status === 'rejected' ? 'selected' : ''}>Rejected</option>
                        <option value="suspended" ${m.account_status === 'suspended' ? 'selected' : ''}>Suspended</option>
                    </select>
                </div>
                <div class="flex flex-col space-y-1 w-full sm:w-auto">
                    <span class="text-[10px] text-slate-450 font-bold uppercase tracking-wider">Voting Rights</span>
                    <button onclick="window.toggleVotingRights('${m.id}', ${!m.voting_rights})" 
                        class="text-xs px-3.5 py-1.5 rounded-full font-bold shadow-sm transition active:scale-95 cursor-pointer border ${m.voting_rights ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : 'bg-red-50 text-red-650 border-red-200 hover:bg-red-100'}">
                        ${m.voting_rights ? 'ENABLED ✓' : 'DISABLED'}
                    </button>
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

        const { error } = await insforge.database.from('profiles').update(updateData).eq('id', id);
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

window.toggleVotingRights = async (id, right) => {
    try {
        const { error } = await insforge.database.from('profiles').update({ voting_rights: right }).eq('id', id);
        if (error) {
            alert('Error updating voting rights: ' + error.message);
        } else {
            loadMembers();
        }
    } catch (err) {
        alert('Exception updating voting rights: ' + err.message);
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

        await insforge.database.from('elections').insert([{ title, start_date: start, end_date: end, status: 'upcoming' }]);
        e.target.reset();
        loadElections();
    });

    document.getElementById('add-candidate-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('can-name').value;
        const pos = document.getElementById('can-position').value;
        const photo = document.getElementById('can-photo').value;

        await insforge.database.from('candidates').insert([{ full_name: name, position_id: pos, photo_url: photo }]);
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
    const { data: elections } = await insforge.database.from('elections').select('*').order('created_at', { ascending: false });
    const list = document.getElementById('elections-list');
    list.innerHTML = '';

    if(!elections) return;

    elections.forEach(el => {
        const div = document.createElement('div');
        div.className = 'bg-slate-50 border border-slate-100 rounded-3xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center hover:bg-white hover:border-slate-200 hover:shadow-premium transition-all duration-300';
        
        const statusColors = {
            'upcoming': 'bg-blue-50 text-blue-700 border-blue-100',
            'open': 'bg-emerald-50 text-emerald-700 border-emerald-100 animate-pulse',
            'closed': 'bg-slate-150 text-slate-600 border-slate-200'
        };

        div.innerHTML = `
            <div class="space-y-2">
                <h4 class="font-extrabold text-lg text-slate-800 tracking-tight leading-tight">${el.title}</h4>
                <p class="text-sm text-slate-400 font-semibold flex items-center space-x-1.5">
                    <svg class="w-4 h-4 text-slate-350" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    <span>${new Date(el.start_date).toLocaleDateString()} - ${new Date(el.end_date).toLocaleDateString()}</span>
                </p>
                <div class="mt-3 text-xs font-bold flex items-center space-x-2 flex-wrap gap-2">
                    <span class="px-2.5 py-1 rounded-full border uppercase ${statusColors[el.status] || ''}">${el.status}</span>
                    <span class="px-2.5 py-1 ${el.results_published ? 'bg-indigo-50 text-indigo-700 border-indigo-150' : 'bg-slate-100 text-slate-500 border-slate-200'} rounded-full border uppercase text-[10px]">Results: ${el.results_published ? 'Published ✓' : 'Hidden'}</span>
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
                <button onclick="window.toggleResults('${el.id}', ${!el.results_published})" class="text-xs bg-slate-100 border border-slate-200 text-slate-700 px-4 py-2.5 rounded-full font-bold hover:bg-slate-200 hover:text-slate-900 transition-all duration-300 active:scale-95">
                    Toggle Publish
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

window.updateElectionStatus = async (id, status) => {
    try {
        const { error } = await insforge.database.from('elections').update({ status }).eq('id', id);
        if (error) {
            alert('Error updating election status: ' + error.message);
        } else {
            loadElections();
            loadAnalytics();
        }
    } catch (err) {
        alert('Exception updating election status: ' + err.message);
    }
};

window.toggleResults = async (id, pub) => {
    try {
        const { error } = await insforge.database.from('elections').update({ results_published: pub }).eq('id', id);
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
        const isMobile = b.closest('nav') !== null;
        if (b.getAttribute('data-tab') === 'results') {
            if (isMobile) {
                b.className = 'tab-btn flex flex-col items-center p-2 text-church-600 transition duration-300';
            } else {
                b.className = 'tab-btn w-full flex items-center space-x-3 px-4 py-3 rounded-2xl bg-church-600 text-white font-semibold transition-all duration-300';
            }
        } else {
            if (isMobile) {
                b.className = 'tab-btn flex flex-col items-center p-2 text-slate-400 hover:text-church-600 transition duration-300';
            } else {
                b.className = 'tab-btn w-full flex items-center space-x-3 px-4 py-3 rounded-2xl text-slate-400 hover:text-white hover:bg-slate-900 font-semibold transition-all duration-300';
            }
        }
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById('tab-results').classList.remove('hidden');
    document.getElementById('page-title').textContent = 'Election Results';
    
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
    const { data: pos } = await insforge.database.from('positions').select('*');
    const select = document.getElementById('can-position');
    select.innerHTML = '<option value="">Select a position...</option>';
    if (!pos) return;
    pos.forEach(p => {
        select.innerHTML += `<option value="${p.id}">${p.position_name}</option>`;
    });
}

async function loadCandidates() {
    const { data: candidates } = await insforge.database.from('candidates').select('*, positions(position_name)');
    const list = document.getElementById('candidates-list');
    list.innerHTML = '';
    
    if(!candidates) return;

    candidates.forEach(c => {
        const div = document.createElement('div');
        div.className = 'bg-slate-50 border border-slate-100 rounded-3xl p-6 flex flex-col items-center hover:bg-white hover:border-slate-200 hover:shadow-premium transition-all duration-300 transform hover:-translate-y-1';
        
        const hasPhoto = c.photo_url && c.photo_url.trim() !== '' && !c.photo_url.includes('placeholder');
        const initials = c.full_name.split(' ').map(n => n[0]).join('').substring(0, 2);
        
        let photoElement = '';
        if (hasPhoto) {
            photoElement = `<img src="${c.photo_url}" class="w-20 h-20 rounded-full object-cover mb-4 border-4 border-white shadow-sm">`;
        } else {
            photoElement = `<div class="w-20 h-20 rounded-full bg-gradient-to-tr from-church-600 via-indigo-500 to-violet-500 text-white font-black text-xl flex items-center justify-center shadow-sm uppercase border-4 border-white mb-4">${initials}</div>`;
        }

        div.innerHTML = `
            ${photoElement}
            <h4 class="font-extrabold text-slate-800 text-base text-center tracking-tight mb-1 leading-tight">${c.full_name}</h4>
            <p class="text-[10px] text-church-700 font-extrabold mb-6 bg-church-50 border border-church-100 px-3 py-1 rounded-full uppercase tracking-wider">${c.positions?.position_name || 'Staff'}</p>
            <button onclick="window.deleteCandidate('${c.id}')" class="text-xs font-bold text-red-650 hover:text-red-700 bg-red-50 hover:bg-red-100 border border-red-100 px-4 py-2.5 rounded-full transition-all active:scale-95 w-full">Delete</button>
        `;
        list.appendChild(div);
    });
}

window.deleteCandidate = async (id) => {
    if(!confirm('Delete candidate?')) return;
    
    const { error } = await insforge.database.from('candidates').delete().eq('id', id);
    
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
            const { data: elections } = await insforge.database.from('elections').select('*').eq('id', electionId);
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

        const { error } = await insforge.database.from('elections').update(updateData).eq('id', electionId);
        if (error) {
            alert('Error updating results visibility: ' + error.message);
        }

        modal.classList.add('hidden');
        modal.classList.remove('flex');

        // Refresh the results view
        const { data: elections } = await insforge.database.from('elections').select('*').eq('id', electionId);
        if (elections && elections.length > 0) {
            selectedResultsElection = elections[0];
            renderResults(selectedResultsElection);
        }
    });
}

async function loadResultsTab(preSelectedId = null) {
    // Fetch all elections for the selector
    const { data: elections } = await insforge.database.from('elections').select('*').order('created_at', { ascending: false });
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
        const { data: elData } = await insforge.database.from('elections').select('*').eq('id', selectId);
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
        'closed': 'bg-slate-150 text-slate-600 border-slate-200'
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
                <span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 mr-2">Published ✓</span>
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
        <div class="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-2">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-400"></div>
            <span class="text-xs font-semibold">Loading results...</span>
        </div>
    `;

    try {
        // Fetch summary results
        const { data: results, error } = await insforge.database.rpc('get_admin_election_summary', { election_id: election.id });

        if (error) {
            throw error;
        }

        // Fetch turnout data
        const { data: turnout } = await insforge.database.rpc('get_election_turnout', { election_id: election.id });

        // Render turnout cards
        renderTurnoutCards(turnoutEl, turnout, election);

        if (!results || results.length === 0) {
            contentEl.innerHTML = `
                <div class="flex flex-col items-center justify-center py-12 text-center text-slate-400 space-y-3">
                    <svg class="w-12 h-12 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
                    <span class="text-sm font-semibold">No candidates or votes found for this election yet.</span>
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
        let html = '';
        for (const [posName, cans] of Object.entries(grouped)) {
            const totalInPos = cans[0]?.total_votes_in_position || 0;
            
            html += `
                <div class="mb-10 last:mb-0 border-b border-slate-100 pb-8 last:border-b-0 last:pb-0">
                    <div class="flex items-center justify-between mb-5">
                        <h4 class="text-xl font-bold text-slate-900 tracking-tight">${posName}</h4>
                        <span class="text-xs font-bold text-slate-400 uppercase tracking-wider">${totalInPos} vote${totalInPos !== 1 ? 's' : ''} cast</span>
                    </div>
                    <div class="space-y-4">`;

            cans.forEach((c, index) => {
                const isWinner = index === 0 && c.vote_count > 0 && c.vote_count > (cans[1]?.vote_count || 0);
                const pct = totalInPos > 0 ? Math.round((c.vote_count / totalInPos) * 100) : 0;

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
                        <div class="w-full h-2.5 bg-slate-200/60 rounded-full relative overflow-hidden">
                            <div class="h-full rounded-full transition-all duration-1000 ${isWinner ? 'bg-gradient-to-r from-gold-500 to-amber-500' : 'bg-gradient-to-r from-church-600 to-indigo-500'}" style="width: ${pct}%"></div>
                        </div>
                    </div>`;
            });

            html += `</div></div>`;
        }

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
                <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 mb-6 flex items-center space-x-3">
                    <svg class="w-5 h-5 text-indigo-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span class="text-sm font-bold text-indigo-800">Results are published. Members can view them.</span>
                </div>
            ` + html;
        }

        contentEl.innerHTML = html;

    } catch (err) {
        console.error('Error loading results:', err);
        contentEl.innerHTML = `
            <div class="flex flex-col items-center justify-center py-12 text-center text-red-500 border border-red-200/50 bg-red-50/50 rounded-3xl p-6">
                <svg class="w-10 h-10 text-red-500 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <span class="font-bold mb-1">Failed to load results</span>
                <span class="text-xs opacity-80">${err.message}</span>
            </div>
        `;
    }
}

function renderTurnoutCards(container, turnout, election) {
    if (!container) return;

    const data = turnout && turnout.length > 0 ? turnout[0] : null;
    const totalVotes = election.status === 'open' ? null : (data ? data.votes_cast : 0);
    
    container.innerHTML = data ? `
        <div class="bg-white border border-slate-100 rounded-2xl p-4">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Total Members</span>
            <span class="text-xl font-black text-slate-900">${data.total_members}</span>
        </div>
        <div class="bg-white border border-slate-100 rounded-2xl p-4">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Eligible Voters</span>
            <span class="text-xl font-black text-slate-900">${data.approved_voters}</span>
        </div>
        <div class="bg-white border border-slate-100 rounded-2xl p-4">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Votes Cast</span>
            <span class="text-xl font-black text-slate-900">${data.votes_cast}</span>
        </div>
        <div class="bg-white border border-slate-100 rounded-2xl p-4">
            <span class="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">Turnout</span>
            <span class="text-xl font-black text-slate-900">${data.turnout_percentage}%</span>
        </div>
    ` : `
        <div class="col-span-4 text-center py-4 text-slate-400 text-sm font-semibold">Turnout data not available</div>
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