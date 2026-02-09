const { createGlobPatternsForDependencies } = require('@nx/react/tailwind');
const { join } = require('path');
const baseConfig = require('../../tailwind.config.base.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...baseConfig,
  content: [
    join(__dirname, 'src/**/*.{ts,tsx,html,js,jsx}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
};
