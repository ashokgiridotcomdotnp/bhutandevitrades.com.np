/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './views/**/*.ejs',
    './public/javascripts/**/*.js',
    './routes/**/*.js',
    './app.js',
  ],
  safelist: [
    'bd-toast-root',
    'bd-toast-item',
    'has-mobile-bottom-nav',
    'is-visible',
    'is-leaving',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
