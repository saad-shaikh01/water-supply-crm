/**
 * "Unlocked at" marker for an identifier (normalised email / phone). A lock key whose value (the epoch-ms it was
 * set) is not newer than this marker no longer blocks sign-in. Needed because lock keys are suffixed with the
 * client IP (`auth:lock:<id>|<ip>`) and an admin cannot enumerate those IPs; pattern deletes only work against a
 * Redis client, so an explicit marker keeps "unlock" reliable on every cache store.
 */
export const loginUnlockedKey = (identifier: string) => `auth:unlocked:${identifier}`;
/** Longest possible lock (security.loginLockMinutes max 1440) plus slack. */
export const LOGIN_UNLOCKED_TTL_MS = 25 * 60 * 60 * 1000;
