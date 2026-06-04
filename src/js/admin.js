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
        document.getElementById('admin-name').textContent = profile.full_name;

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
            
            // Update active styling
            btns.forEach(b => {
                b.classList.remove('bg-church-900');
                b.classList.add('hover:bg-church-700');
            });
            btn.classList.add('bg-church-900');
            btn.classList.remove('hover:bg-church-700');

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
    if(elections && elections.length > 0) {
        document.getElementById('live-election-status').innerHTML = `
            <p class="font-bold text-green-600">Active Election: ${elections[0].title}</p>
            <p>Closes: ${new Date(elections[0].end_date).toLocaleString()}</p>
        `;
    } else {
        document.getElementById('live-election-status').innerHTML = `<p class="text-gray-500">No active elections.</p>`;
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
                backgroundColor: ['#10B981', '#F3F4F6'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
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
        
        const statusColors = {
            'pending': 'bg-yellow-100 text-yellow-800',
            'approved': 'bg-green-100 text-green-800',
            'rejected': 'bg-red-100 text-red-800',
            'suspended': 'bg-gray-100 text-gray-800'
        };

        tr.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap">${m.full_name}</td>
            <td class="px-6 py-4 whitespace-nowrap">${m.email}</td>
            <td class="px-6 py-4 whitespace-nowrap">
                <select onchange="window.updateMemberStatus('${m.id}', this.value)" class="text-xs rounded border-gray-300 p-1 font-semibold ${statusColors[m.account_status] || ''}">
                    <option value="pending" ${m.account_status === 'pending' ? 'selected' : ''}>Pending</option>
                    <option value="approved" ${m.account_status === 'approved' ? 'selected' : ''}>Approved</option>
                    <option value="rejected" ${m.account_status === 'rejected' ? 'selected' : ''}>Rejected</option>
                    <option value="suspended" ${m.account_status === 'suspended' ? 'selected' : ''}>Suspended</option>
                </select>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
                <button onclick="window.toggleVotingRights('${m.id}', ${!m.voting_rights})" 
                    class="text-xs px-2 py-1 rounded font-semibold ${m.voting_rights ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                    ${m.voting_rights ? 'ON' : 'OFF'}
                </button>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-church-600 cursor-pointer">...</td>
        `;
        tbody.appendChild(tr);
    });
}

window.updateMemberStatus = async (id, status) => {
    await supabase.from('profiles').update({ account_status: status }).eq('id', id);
    // Automatic approval grants voting rights usually, but let's keep them separate as per specs
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
        loadCandidates();
    });
}

async function loadElections() {
    const { data: elections } = await supabase.from('elections').select('*').order('created_at', { ascending: false });
    const list = document.getElementById('elections-list');
    list.innerHTML = '';

    if(!elections) return;

    elections.forEach(el => {
        const div = document.createElement('div');
        div.className = 'bg-gray-50 border border-transparent rounded-[1.5rem] p-6 flex flex-col md:flex-row justify-between items-center hover:bg-white hover:shadow-soft transition-all';
        div.innerHTML = `
            <div>
                <h4 class="font-extrabold text-lg text-gray-900 tracking-tight">${el.title}</h4>
                <p class="text-sm text-gray-500 font-medium">${new Date(el.start_date).toLocaleString()} - ${new Date(el.end_date).toLocaleString()}</p>
                <div class="mt-3 text-sm font-bold flex items-center space-x-2">
                    <span class="px-2 py-1 bg-white rounded shadow-sm text-gray-600 uppercase text-xs">${el.status}</span>
                    <span class="px-2 py-1 ${el.results_published ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'} rounded shadow-sm uppercase text-xs">Results: ${el.results_published ? 'Yes' : 'No'}</span>
                </div>
            </div>
            <div class="space-x-3 mt-6 md:mt-0 flex items-center">
                <select onchange="window.updateElectionStatus('${el.id}', this.value)" class="text-sm border-none bg-white shadow-sm rounded-full px-4 py-2 font-bold cursor-pointer focus:ring-2 focus:ring-church-500 outline-none">
                    <option value="upcoming" ${el.status === 'upcoming' ? 'selected' : ''}>Upcoming</option>
                    <option value="open" ${el.status === 'open' ? 'selected' : ''}>Open</option>
                    <option value="closed" ${el.status === 'closed' ? 'selected' : ''}>Closed</option>
                </select>
                <button onclick="window.toggleResults('${el.id}', ${!el.results_published})" class="text-sm bg-gray-200 px-4 py-2 rounded-full font-bold hover:bg-gray-300 transition active:scale-95 text-gray-700">
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
        div.className = 'bg-gray-50 border border-transparent rounded-[2rem] p-6 flex flex-col items-center hover:bg-white hover:shadow-soft-lg transition-all transform hover:-translate-y-1';
        div.innerHTML = `
            <img src="${c.photo_url || 'https://via.placeholder.com/150'}" class="w-24 h-24 rounded-full object-cover mb-4 border-4 border-white shadow-sm">
            <h4 class="font-extrabold text-gray-900 text-lg text-center tracking-tight mb-1">${c.full_name}</h4>
            <p class="text-xs text-church-700 font-bold mb-6 bg-church-50 px-3 py-1 rounded-full">${c.positions.position_name}</p>
            <button onclick="window.deleteCandidate('${c.id}')" class="text-sm font-bold text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-4 py-3 rounded-full transition-all active:scale-95 w-full">Delete</button>
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
