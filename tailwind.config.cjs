
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'Inter', 'Arial', 'sans-serif']
      },
      // The transaction add-row uses a 45-column grid on md+; Tailwind only ships col-span-1..12.
      gridColumn: {
        'span-13': 'span 13 / span 13',
      },
      keyframes: {
        'modal-in': {
          from: { opacity: '0', transform: 'translateY(4px) scale(0.98)' },
          to: { opacity: '1', transform: 'none' },
        },
        'toast-in': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'modal-in': 'modal-in 120ms ease-out',
        'toast-in': 'toast-in 150ms ease-out',
      },
    },
  },
  plugins: [],
}
