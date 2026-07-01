# NUTFS E-Voting Web Application

A modern, secure, and mobile-first web application designed to conduct digital elections for NUTFS. Built with **Vanilla JavaScript**, **Tailwind CSS**, and powered by a robust **Supabase** backend. 

The application features a premium, Mobbin-level UI/UX design with glassmorphism, native-feeling bottom sheet modals, and silky smooth micro-animations.

---

## 🌟 Key Features

* **Admin Dashboard:** Manage elections, candidates, members, and view live voter turnout analytics.
* **Member Dashboard:** Browse open elections, view candidate profiles, and securely cast votes.
* **Mobile-First Design:** Features a mobile bottom navigation bar, native-feeling bottom sheet modals, and extremely tap-friendly UI elements.
* **Secure Voting System:** Built with Supabase Row Level Security (RLS) ensuring that users can only vote once, cannot tamper with other users' votes, and have their voting rights securely verified.
* **Realtime Updates:** The admin dashboard analytics update in real-time as users register or cast their votes.
* **Admin Results Panel:** A dedicated "Results" tab in the admin dashboard lets you view live vote tallies during an open election, see final results after closing, and publish/unpublish results to members with a confirmation dialog. Historical results for any past election are also accessible.

---

## 🚀 Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES Modules)
* **Styling:** Tailwind CSS v3
* **Build Tool:** Vite
* **Backend:** Supabase (PostgreSQL, Auth, Realtime, RPC)
* **Charts:** Chart.js

---

## 💻 Local Development Setup

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/church-e-voting.git
cd church-e-voting
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Supabase Backend Setup
1. Create a new project on [Supabase](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase dashboard.
3. Run all SQL migrations in `supabase/migrations/` **in timestamp order** via the SQL Editor, or use the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`.

   The final migration (`20260701120000_security_hardening.sql`) adds production security fixes — do not skip it.

### 4. Environment Variables
Copy `.env.example` to `.env.local` and fill in your Supabase project credentials:
```env
VITE_SUPABASE_URL=your-supabase-project-url
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### 5. Run the Application
```bash
npm run dev
```
Open your browser to `http://localhost:3000/` to view the application!

### 6. Supabase Auth URLs (production)
In Supabase → **Authentication** → **URL Configuration**, set:
- **Site URL:** your production domain (e.g. `https://your-app.vercel.app`)
- **Redirect URLs:** include `https://your-app.vercel.app/pages/reset-password.html` (and the same path on localhost for testing)

This is required for password reset emails to work.

---

## 👨‍💼 Administrator Account Setup

To access the Admin Panel, you must elevate your user role:
1. Register a new account normally through the application's `/pages/register.html`.
2. Go to your Supabase project's **Table Editor**.
3. Open the `profiles` table.
4. Locate your account, and change your `role` from `member` to `admin`.
5. Change your `account_status` to `approved` and `voting_rights` to `true`.
6. Log back in to the application. You will be redirected to the Admin Dashboard.

---

## 🎨 UI/UX Design System

* **Colors**: A custom "Church" palette emphasizing trust and clarity, accented by gold for winners.
* **Shadows**: Ultra-soft, widespread drop shadows (`shadow-soft` and `shadow-soft-lg`) to create depth without harsh borders.
* **Radiuses**: Pushed border radiuses (`rounded-[2rem]`) to match modern consumer app standards.
* **Tap Highlights**: Native mobile tap highlights are disabled for a true app-like experience.

---

## 📄 License
MIT License
