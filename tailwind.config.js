/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './views/**/*.ejs',
    './routes/**/*.js',
    './app.js',
  ],
  safelist: [
    'bd-toast-root',
    'bd-toast-item',
    'is-visible',
    'is-leaving',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
