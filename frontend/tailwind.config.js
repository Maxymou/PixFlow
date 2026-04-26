/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#020617',
        card: '#0f172a',
        'card-hi': '#1e293b',
      },
      boxShadow: {
        'glow-cyan':   '0 0 24px rgba(34, 211, 238, 0.18)',
        'glow-violet': '0 0 24px rgba(168, 85, 247, 0.18)',
        'glow-green':  '0 0 12px rgba(52, 211, 153, 0.25)',
      },
      animation: {
        'slide-up':   'slideUp 0.22s ease-out',
        'pulse-dot':  'pulse 2.5s ease-in-out infinite',
      },
      keyframes: {
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
