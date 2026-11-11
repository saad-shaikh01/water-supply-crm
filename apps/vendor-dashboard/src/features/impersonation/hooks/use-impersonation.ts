import { useEffect, useState } from 'react';
import { usePermissionsQuery } from '../../authz/hooks/use-permissions';
import { isImpersonating } from '../session';
import type { ImpersonationInfo } from '../api/impersonation.api';

/** Impersonation state for the current tab: marker cookie + details from `/auth/me`. */
export function useImpersonation(): { active: boolean; info: ImpersonationInfo | null } {
  const [marker, setMarker] = useState(false);
  useEffect(() => setMarker(isImpersonating()), []);
  const { data } = usePermissionsQuery();
  const info = (data as { impersonation?: ImpersonationInfo } | undefined)?.impersonation ?? null;
  return { active: marker || !!info, info };
}
