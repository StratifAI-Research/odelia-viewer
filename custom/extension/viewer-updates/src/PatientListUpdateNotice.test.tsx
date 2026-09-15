import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ReleaseUpdateProvider from './ReleaseUpdateProvider';
import PatientListUpdateNotice from './PatientListUpdateNotice';
import * as client from './releaseClient';

let mockAuth: any = { user: null };
jest.mock('@ohif/ui-next', () => ({
  useUserAuthentication: () => [mockAuth],
  Dialog: ({ children, open }) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
  DialogFooter: ({ children }) => <div>{children}</div>,
  Button: ({ children, variant, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
const mockTranslate = (_key, fallback) => fallback;
jest.mock('./releaseClient', () => ({
  ...jest.requireActual('./releaseClient'),
  checkRelease: jest.fn(),
}));

const release = {
  version: '99.0.0',
  url: 'https://github.com/StratifAI-Research/odelia-viewer/releases/tag/v99.0.0',
};
const config = { viewerUpdates: { enabled: true }, routerBasename: '/viewer' };
function App({ list = true, appConfig = config }) {
  return (
    <ReleaseUpdateProvider appConfig={appConfig}>
      {list ? <PatientListUpdateNotice /> : <div>Study viewer</div>}
    </ReleaseUpdateProvider>
  );
}
beforeEach(() => {
  jest.useFakeTimers();
  process.env.ODELIA_PRODUCT_VERSION = '3.4.0';
  mockAuth = { user: null };
  localStorage.clear();
  (client.checkRelease as jest.Mock).mockReset().mockResolvedValue(release);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
async function check() {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1);
  });
}
test('shows on list, hides on navigation, and shows an unacknowledged update on return', async () => {
  const view = render(<App />);
  await check();
  expect(screen.queryByRole('dialog')).not.toBeNull();
  view.rerender(<App list={false} />);
  expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<App />);
  expect(screen.queryByRole('dialog')).not.toBeNull();
  expect(client.checkRelease).toHaveBeenCalledTimes(1);
});
test('a late response never opens a popup after leaving the list', async () => {
  let resolve: (value: typeof release) => void;
  (client.checkRelease as jest.Mock).mockReturnValue(
    new Promise(r => {
      resolve = r;
    })
  );
  const view = render(<App />);
  await check();
  view.rerender(<App list={false} />);
  await act(async () => {
    resolve(release);
  });
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('does not check before OIDC authentication is ready or after logout', async () => {
  const appConfig = { ...config, oidc: [{ authority: 'https://auth.example' }] };
  const view = render(<App appConfig={appConfig} />);
  await check();
  expect(client.checkRelease).not.toHaveBeenCalled();
  mockAuth = { user: { profile: { sub: 'user-a', iss: 'issuer' } } };
  view.rerender(<App appConfig={appConfig} />);
  await check();
  expect(screen.queryByRole('dialog')).not.toBeNull();
  mockAuth = { user: null };
  view.rerender(<App appConfig={appConfig} />);
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('disabled checks show no popup and make no request', async () => {
  render(<App appConfig={{ ...config, viewerUpdates: { enabled: false } }} />);
  await check();
  expect(client.checkRelease).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('an older public release produces no popup', async () => {
  (client.checkRelease as jest.Mock).mockResolvedValue({ ...release, version: '2.2.0' });
  render(<App />);
  await check();
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('dismiss persists across list remount and a newer release can notify', async () => {
  (client.checkRelease as jest.Mock).mockResolvedValue({ ...release, version: '99.1.0' });
  const view = render(<App />);
  await check();
  fireEvent.click(screen.getByText('Dismiss'));
  view.rerender(<App list={false} />);
  view.rerender(<App />);
  expect(screen.queryByRole('dialog')).toBeNull();
  (client.checkRelease as jest.Mock).mockResolvedValue({ ...release, version: '99.2.0' });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(client.HOUR);
  });
  expect(screen.queryByRole('dialog')).not.toBeNull();
});
test('cross-tab dismissal closes the matching notice', async () => {
  (client.checkRelease as jest.Mock).mockResolvedValue({ ...release, version: '99.3.0' });
  render(<App />);
  await check();
  act(() =>
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `${client.CACHE_KEY}:dismissed:%2Fviewer:anonymous:99.3.0`,
        newValue: 'true',
      })
    )
  );
  expect(screen.queryByRole('dialog')).toBeNull();
});
test('hidden documents do not initiate checks', async () => {
  jest.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  render(<App />);
  await check();
  expect(client.checkRelease).not.toHaveBeenCalled();
});
