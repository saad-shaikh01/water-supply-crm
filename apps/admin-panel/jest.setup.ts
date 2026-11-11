// Global jest setup for admin-panel unit tests.
// NOTE: @testing-library/jest-dom, user-event and msw are NOT installed in this
// workspace; tests use plain assertions + fireEvent and mock the api modules.
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});
