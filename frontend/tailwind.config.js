/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#020617',
        card: '#0f172a',
        cyanGlow: '#22d3ee',
        violetGlow: '#a855f7'
      }
    }
  },
  plugins: []
};
