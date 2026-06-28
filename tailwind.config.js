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
        // ── Brand crimson (sampled from the NUTFS flame-and-book mark) ──
        // Kept under the `church` key so existing markup keeps working,
        // but retuned from muted wine to a vivid, trustworthy ember-crimson.
        church: {
          50:  '#fdf2f3',
          100: '#fbe0e3',
          200: '#f6c2c8',
          300: '#ed959f',
          400: '#e15f70',
          500: '#d23a4c',
          600: '#bb2538',
          700: '#9e1b2e',
          800: '#7f1826',
          900: '#5d1019',
          950: '#39070d',
        },
        // Ember accent — the flame tips. Warm gold-orange for highlights/winners.
        ember: {
          50:  '#fef6ed',
          100: '#fce8cf',
          200: '#f8cd9a',
          300: '#f3aa5e',
          400: '#ee8636',
          500: '#e5641c',
          600: '#d24a12',
          700: '#af3512',
          800: '#8d2b16',
          900: '#732515',
        },
        ink: {
          DEFAULT: '#180a0c',
          muted: '#5c4f52',
          subtle: '#998c8f',
        },
        canvas: {
          DEFAULT: '#fbf8f5',
          alt: '#f4ece6',
        },
        gold: {
          50:  '#fdf8ec',
          100: '#f9ecca',
          200: '#f1d791',
          300: '#e6bd58',
          400: '#d6ad4f',
          500: '#c2963a',
          600: '#9c7526',
          700: '#7c5a1d',
          800: '#65491c',
          900: '#56401d',
        },
        surface: {
          DEFAULT: '#ffffff',
          2: '#fbf8f5',
          3: '#f4ece6',
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
        'xs': '0 1px 2px rgba(57, 7, 13, 0.05)',
        'soft': '0 2px 8px rgba(57, 7, 13, 0.05), 0 1px 2px rgba(57, 7, 13, 0.04)',
        'soft-lg': '0 10px 36px rgba(57, 7, 13, 0.08), 0 2px 8px rgba(57, 7, 13, 0.05)',
        'premium': '0 14px 44px -10px rgba(158, 27, 46, 0.26)',
        'premium-lg': '0 28px 70px -14px rgba(158, 27, 46, 0.32)',
        'ember': '0 10px 30px -8px rgba(229, 100, 28, 0.4)',
        'inner-soft': 'inset 0 1px 0 rgba(255,255,255,0.7)',
        'card': '0 0 0 1px rgba(57,7,13,0.06), 0 2px 8px rgba(57,7,13,0.05)',
        'card-hover': '0 0 0 1px rgba(158,27,46,0.16), 0 12px 28px rgba(57,7,13,0.1)',
      },
      borderRadius: {
        'DEFAULT': '0.625rem',
        'lg': '0.875rem',
        'xl': '1rem',
        '2xl': '1.25rem',
        '3xl': '1.5rem',
      },
      backgroundImage: {
        'grid-pattern': 'linear-gradient(rgba(158,27,46,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(158,27,46,0.035) 1px, transparent 1px)',
        // `wine-gradient` name retained; now a crimson→ember flame gradient.
        'wine-gradient': 'linear-gradient(150deg, #39070d 0%, #7f1826 38%, #bb2538 72%, #d24a12 100%)',
        'ember-gradient': 'linear-gradient(135deg, #9e1b2e 0%, #d24a12 60%, #ee8636 100%)',
        'wine-radial': 'radial-gradient(ellipse 75% 55% at 50% -5%, rgba(229,100,28,0.16) 0%, rgba(158,27,46,0.1) 35%, transparent 72%)',
        'flame-glow': 'radial-gradient(circle at 50% 120%, rgba(238,134,54,0.35) 0%, rgba(187,37,56,0.25) 30%, transparent 65%)',
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
