/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,html}",
    "./pages/**/*.html"
  ],
  theme: {
    extend: {
      colors: {
        // Primary brand — institutional navy (trust, civic, election-grade UI).
        // Kept as `church` so existing markup continues to work.
        church: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        // Live / informational accent (open elections, highlights).
        ember: {
          50:  '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
        // Typography & surfaces — cool slate neutrals.
        ink: {
          DEFAULT: '#0f172a',
          muted: '#475569',
          subtle: '#94a3b8',
        },
        canvas: {
          DEFAULT: '#f8fafc',
          alt: '#f1f5f9',
        },
        // Winner / leading candidate accent only.
        gold: {
          50:  '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        surface: {
          DEFAULT: '#ffffff',
          2: '#f8fafc',
          3: '#f1f5f9',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        heading: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['4.5rem', { lineHeight: '1.04', letterSpacing: '-0.03em' }],
        'display-lg': ['3.5rem', { lineHeight: '1.07', letterSpacing: '-0.025em' }],
        'display-md': ['2.5rem', { lineHeight: '1.11', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        'xs': '0 1px 2px rgba(15, 23, 42, 0.05)',
        'soft': '0 2px 8px rgba(15, 23, 42, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04)',
        'soft-lg': '0 10px 36px rgba(15, 23, 42, 0.08), 0 2px 8px rgba(15, 23, 42, 0.05)',
        'premium': '0 14px 44px -10px rgba(30, 64, 175, 0.22)',
        'premium-lg': '0 28px 70px -14px rgba(30, 64, 175, 0.28)',
        'ember': '0 10px 30px -8px rgba(14, 165, 233, 0.35)',
        'inner-soft': 'inset 0 1px 0 rgba(255,255,255,0.7)',
        'card': '0 0 0 1px rgba(15,23,42,0.06), 0 2px 8px rgba(15,23,42,0.05)',
        'card-hover': '0 0 0 1px rgba(29,78,216,0.14), 0 12px 28px rgba(15,23,42,0.08)',
      },
      borderRadius: {
        'DEFAULT': '0.625rem',
        'lg': '0.875rem',
        'xl': '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
      backgroundImage: {
        'grid-pattern': 'linear-gradient(rgba(30,64,175,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(30,64,175,0.04) 1px, transparent 1px)',
        'wine-gradient': 'linear-gradient(150deg, #172554 0%, #1e3a8a 40%, #1d4ed8 75%, #2563eb 100%)',
        'ember-gradient': 'linear-gradient(135deg, #1e40af 0%, #2563eb 55%, #3b82f6 100%)',
        'wine-radial': 'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(59,130,246,0.12) 0%, rgba(30,64,175,0.08) 35%, transparent 72%)',
        'flame-glow': 'radial-gradient(circle at 50% 120%, rgba(59,130,246,0.2) 0%, rgba(30,64,175,0.12) 30%, transparent 65%)',
      },
      backgroundSize: {
        'grid': '46px 46px',
      },
      keyframes: {
        'ember-flicker': {
          '0%, 100%': { opacity: '0.85', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.04)' },
        },
      },
      animation: {
        'ember-flicker': 'ember-flicker 3.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
