export const routerMock = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  refresh: jest.fn(),
  prefetch: jest.fn(),
};

let currentPath = '/';
let currentSearch = '';

export function setMockNavigation(path: string, search = '') {
  currentPath = path;
  currentSearch = search;
}

export const navigationMockFactory = () => ({
  useRouter: () => routerMock,
  usePathname: () => currentPath,
  useSearchParams: () => new URLSearchParams(currentSearch),
});
