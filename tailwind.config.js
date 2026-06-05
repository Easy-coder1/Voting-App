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
          50: '#f5f3ff',   // violet-50
          100: '#eef2ff',  // indigo-50
          200: '#e0e7ff',  // indigo-100
          300: '#c7d2fe',  // indigo-200
          400: '#818cf8',  // indigo-400
          500: '#6366f1',  // indigo-500 (Primary Brand Indicator)
          600: '#4f46e5',  // indigo-600
          700: '#4338ca',  // indigo-700
          800: '#3730a3',  // indigo-800
          900: '#1e1b4b',  // indigo-950
        },
        gold: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b', // Accent amber-500
          600: '#d97706',
          700: '#b45309',
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        heading: ['Outfit', 'Inter', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 8px 30px rgba(0, 0, 0, 0.02)',
        'soft-lg': '0 20px 40px rgba(0, 0, 0, 0.04)',
        'premium': '0 10px 40px -10px rgba(79, 70, 229, 0.08)',
        'premium-lg': '0 24px 60px -15px rgba(79, 70, 229, 0.12)',
        'glass': '0 8px 32px 0 rgba(79, 70, 229, 0.08)',
        'glass-dark': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      },
      borderRadius: {
        '4xl': '2rem',
        '5xl': '2.5rem',
      }
    },
  },
  plugins: [],
}
