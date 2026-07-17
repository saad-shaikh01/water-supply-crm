const { createGlobPatternsForDependencies } = require('@nx/react/tailwind');
const { join } = require('path');
const defaultTheme = require('tailwindcss/defaultTheme');
const baseConfig = require('../../tailwind.config.base.js');

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...baseConfig,
  content: [
    join(__dirname, 'src/**/*.{ts,tsx,html,js,jsx}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  theme: {
    ...baseConfig.theme,
    extend: {
      ...baseConfig.theme.extend,
      fontFamily: {
        sans: ['var(--font-sans)', ...defaultTheme.fontFamily.sans],
        mono: ['var(--font-mono)', ...defaultTheme.fontFamily.mono],
      },
    },
  },
};
