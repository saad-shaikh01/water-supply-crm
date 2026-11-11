import { act } from '@testing-library/react';
import { renderWithQuery } from '../../../test/utils/render';
import { SessionListener, SESSION_CLEARED_EVENT } from './session-listener';
import { useAuthStore } from '../../store/auth.store';

describe('SessionListener', () => {
  it('clears the user and query cache on session-cleared event', () => {
    useAuthStore.setState({ user: { id: '1', name: 'n', email: 'e', role: 'SUPER_ADMIN' } });
    const { client } = renderWithQuery(<SessionListener />);
    client.setQueryData(['k'], 1);
    act(() => {
      window.dispatchEvent(new Event(SESSION_CLEARED_EVENT));
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(client.getQueryData(['k'])).toBeUndefined();
  });
});
