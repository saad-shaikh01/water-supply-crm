module.exports = {
  displayName: 'data-access',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json', diagnostics: { ignoreCodes: [4111] } }] // 4111: api-client uses process.env.NEXT_PUBLIC_* (dot form is required for Next inlining),
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/shared/data-access',
};
