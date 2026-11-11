import { SetMetadata } from '@nestjs/common';

/** Route is refused under ANY impersonation token (READ_ONLY and SUPPORT) with 403 IMPERSONATION_FORBIDDEN. */
export const BLOCK_WHEN_IMPERSONATING_KEY = 'block_when_impersonating';
export const BlockWhenImpersonating = () => SetMetadata(BLOCK_WHEN_IMPERSONATING_KEY, true);

/** Non-GET route that is still allowed in READ_ONLY mode (only the session-exit endpoint). */
export const ALLOW_IN_READ_ONLY_KEY = 'allow_in_read_only_impersonation';
export const AllowInReadOnlyImpersonation = () => SetMetadata(ALLOW_IN_READ_ONLY_KEY, true);
