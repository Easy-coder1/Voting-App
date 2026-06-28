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
        church: {
          50:  '#fbf7f8',
          100: '#f5ecee',
          200: '#e8d4d8',
          300: '#d4aab2',
          400: '#b8707c',
          500: '#9b3d4d',
          600: '#822f3e',
          700: '#722F37',
          800: '#5a2329',
          900: '#3d151c',
          950: '#240c10',
        },
        ink: {
          DEFAULT: '#0c0608',
          muted: '#5c4f52',
          subtle: '#9a8d90',
        },
        canvas: {
          DEFAULT: '#faf8f6',
          alt: '#f3eeeb',
        },
        gold: {
          400: '#c9a84c',
          500: '#b8943f',
          600: '#96782f',
        },
        surface: {
          DEFAULT: '#ffffff',
          2: '#faf8f6',
          3: '#f3eeeb',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        heading: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'sans-serif'],
      },
      fontSize: {
        'display-xl': ['4.5rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        'display-lg': ['3.5rem', { lineHeight: '1.08', letterSpacing: '-0.025em' }],
        'display-md': ['2.5rem', { lineHeight: '1.12', letterSpacing: '-0.02em' }],
      },
      boxShadow: {
        'xs': '0 1px 2px rgba(12, 6, 8, 0.04)',
        'soft': '0 2px 8px rgba(12, 6, 8, 0.04), 0 1px 2px rgba(12, 6, 8, 0.03)',
        'soft-lg': '0 8px 32px rgba(12, 6, 8, 0.07), 0 2px 8px rgba(12, 6, 8, 0.04)',
        'premium': '0 12px 40px -8px rgba(114, 47, 55, 0.18)',
        'premium-lg': '0 24px 64px -12px rgba(114, 47, 55, 0.22)',
        'inner-soft': 'inset 0 1px 0 rgba(255,255,255,0.6)',
        'card': '0 0 0 1px rgba(12,6,8,0.06), 0 2px 8px rgba(12,6,8,0.04)',
        'card-hover': '0 0 0 1px rgba(114,47,55,0.12), 0 8px 24px rgba(12,6,8,0.08)',
      },
      borderRadius: {
        'DEFAULT': '0.625rem',
        'lg': '0.875rem',
        'xl': '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
      backgroundImage: {
        'grid-pattern': 'linear-gradient(rgba(114,47,55,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(114,47,55,0.03) 1px, transparent 1px)',
        'wine-gradient': 'linear-gradient(135deg, #3d151c 0%, #722F37 50%, #822f3e 100%)',
        'wine-radial': 'radial-gradient(ellipse 80% 60% at 50% 0%, rgba(114,47,55,0.12) 0%, transparent 70%)',
      },
      backgroundSize: {
        'grid': '48px 48px',
      },
    },
  },
  plugins: [],
}
