/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // EmberCheck "Eucalypt & ochre" palette (mirrors the CSS tokens in
        // index.css so utility classes and inline var() styles stay in sync).
        ember: {
          paper: '#F3EEDF',
          'paper-deep': '#DDD7C4',
          card: '#FBF8EE',
          ink: '#2B2920',
          'ink-soft': '#6B6552',
          euc: '#5E6B4F',
          forest: '#3C4733', // euc-deep
          cream: '#F3EEDF', // legacy alias
          amber: '#C28E3F', // legacy alias
          ochre: '#C28E3F',
          'ochre-soft': '#DCB877',
        },
      },
      fontFamily: {
        display: ['Alegreya Sans', 'Helvetica Neue', 'sans-serif'],
        ui: ['Source Sans 3', 'Helvetica Neue', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
