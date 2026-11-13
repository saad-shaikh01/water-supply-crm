const { createGlobPatternsForDependencies } = require('@nx/react/tailwind');
const { join } = require('path');
const baseConfig = require('../../tailwind.config.base.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...baseConfig,
  content: [
    join(__dirname, 'src/**/*.{ts,tsx,html,js,jsx}'),
    // explicit: createGlobPatternsForDependencies returns [] when the Nx project graph is unavailable (next build/dev outside nx)
    join(__dirname, '../../libs/shared/ui/src/**/*.{ts,tsx}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
};
