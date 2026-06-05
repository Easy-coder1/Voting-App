import { supabase } from './supabase.js';

let currentUser = null;
let currentProfile = null;
let turnoutChartInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Auth Check
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
            window.location.href = '/pages/login.html';
            return;
        }
        currentUser = session.user;

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
            await supabase.auth.signOut();
            window.location.href = '/';
        });

        setupTabs();
        loadAnalytics();
        setupForms();

        // Subscribe to realtime updates for live analytics
        supabase.channel('public:profiles')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
                loadAnalytics();
                if(!document.getElementById('tab-members').classList.contains('hidden')){
                    loadMembers();
                }
            })
            .subscribe();

        supabase.channel('public:votes')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, payload => {
                loadAnalytics();
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
                const isMobile = b.closest('nav') !== null; // inside mobile bottom nav container
                
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

            // Title and Data Loaders
            title.textContent = tabId.charAt(0).toUpperCase() + tabId.slice(1);
            if (tabId === 'members') loadMembers();
            if (tabId === 'elections') loadElections();
            if (tabId === 'candidates') {
                loadPositions();
                loadCandidates();
            }
        });
    });
}

// Analytics Logic
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

// Member Management
async function loadMembers() {
    const { data: members, error } = await supabase.from('profiles').select('*').eq('role', 'member').order('created_at', { ascending: false });
    const tbody = document.getElementById('members-table-body');
    tbody.innerHTML = '';
    
    if(error || !members) return;

    members.forEach(m => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-50/50 transition duration-150';
        
        const statusColors = {
            'pending': 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100',
            'approved': 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100',
            'rejected': 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100',
            'suspended': 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
        };

        tr.innerHTML = `
            <td class="px-6 py-4.5 whitespace-nowrap text-slate-800 font-bold">${m.full_name}</td>
            <td class="px-6 py-4.5 whitespace-nowrap text-slate-500">${m.email}</td>
            <td class="px-6 py-4.5 whitespace-nowrap">
                <select onchange="window.updateMemberStatus('${m.id}', this.value)" class="text-xs rounded-full border px-3.5 py-1.5 font-bold cursor-pointer transition focus:outline-none focus:ring-2 focus:ring-church-500 shadow-sm outline-none ${statusColors[m.account_status] || ''}">
                    <option value="pending" ${m.account_status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="approved" ${m.account_status === 'approved' ? 'selected' : ''}>Approved</option>
                    <option value="rejected" ${m.account_status === 'rejected' ? 'selected' : ''}>Rejected</option>
                    <option value="suspended" ${m.account_status === 'suspended' ? 'selected' : ''}>Suspended</option>
                </select>
            </td>
            <td class="px-6 py-4.5 whitespace-nowrap">
                <button onclick="window.toggleVotingRights('${m.id}', ${!m.voting_rights})" 
                    class="text-xs px-3.5 py-1.5 rounded-full font-bold shadow-sm transition active:scale-95 cursor-pointer border ${m.voting_rights ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' : 'bg-red-50 text-red-650 border-red-200 hover:bg-red-100'}">
                    ${m.voting_rights ? 'ENABLED ✓' : 'DISABLED'}
                </button>
            </td>
            <td class="px-6 py-4.5 whitespace-nowrap text-sm text-slate-300 font-bold">...</td>
        `;
        tbody.appendChild(tr);
    });
}

window.updateMemberStatus = async (id, status) => {
    await supabase.from('profiles').update({ account_status: status }).eq('id', id);
    if (status === 'approved') {
        await supabase.from('profiles').update({ voting_rights: true }).eq('id', id);
    } else {
        await supabase.from('profiles').update({ voting_rights: false }).eq('id', id);
    }
    loadMembers();
};

window.toggleVotingRights = async (id, right) => {
    await supabase.from('profiles').update({ voting_rights: right }).eq('id', id);
    loadMembers();
};

// Election Management
function setupForms() {
    setupImageUpload();

    document.getElementById('create-election-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('el-title').value;
        const start = document.getElementById('el-start').value;
        const end = document.getElementById('el-end').value;

        await supabase.from('elections').insert([{ title, start_date: start, end_date: end, status: 'upcoming' }]);
        e.target.reset();
        loadElections();
    });

    document.getElementById('add-candidate-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('can-name').value;
        const pos = document.getElementById('can-position').value;
        const photo = document.getElementById('can-photo').value;

        await supabase.from('candidates').insert([{ full_name: name, position_id: pos, photo_url: photo }]);
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
        // Prevent trigger loop when clicking within preview/buttons
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
                <div class="mt-3 text-xs font-bold flex items-center space-x-2">
                    <span class="px-2.5 py-1 rounded-full border uppercase ${statusColors[el.status] || ''}">${el.status}</span>
                    <span class="px-2.5 py-1 ${el.results_published ? 'bg-indigo-50 text-indigo-700 border-indigo-150' : 'bg-slate-100 text-slate-500 border-slate-200'} rounded-full border uppercase text-[10px]">Results: ${el.results_published ? 'Published ✓' : 'Hidden'}</span>
                </div>
            </div>
            <div class="space-x-2 mt-6 md:mt-0 flex items-center w-full md:w-auto">
                <select onchange="window.updateElectionStatus('${el.id}', this.value)" class="text-xs border border-slate-200 bg-white shadow-sm rounded-full px-4 py-2.5 font-bold cursor-pointer focus:outline-none focus:ring-2 focus:ring-church-500">
                    <option value="upcoming" ${el.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
                    <option value="open" ${el.status === 'open' ? 'selected' : ''}>Open</option>
                    <option value="closed" ${el.status === 'closed' ? 'selected' : ''}>Closed</option>
                </select>
                <button onclick="window.toggleResults('${el.id}', ${!el.results_published})" class="text-xs bg-slate-100 border border-slate-200 text-slate-700 px-4 py-2.5 rounded-full font-bold hover:bg-slate-200 hover:text-slate-900 transition-all duration-300 active:scale-95">
                    Toggle Results
                </button>
            </div>
        `;
        list.appendChild(div);
    });
}

window.updateElectionStatus = async (id, status) => {
    await supabase.from('elections').update({ status }).eq('id', id);
    loadElections();
};

window.toggleResults = async (id, pub) => {
    await supabase.from('elections').update({ results_published: pub }).eq('id', id);
    loadElections();
};

// Candidate Management
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
    const { data: candidates } = await supabase.from('candidates').select('*, positions(position_name)');
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
    if(confirm('Delete candidate?')) {
        await supabase.from('candidates').delete().eq('id', id);
        loadCandidates();
    }
};
