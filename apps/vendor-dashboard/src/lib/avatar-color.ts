// Chrome-profile-style avatars: a single initial on a solid colour that is
// derived from the name, so the same person always gets the same colour.
const AVATAR_COLORS = [
  '#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab', '#1e88e5',
  '#039be5', '#00897b', '#43a047', '#7cb342', '#f4511e', '#6d4c41',
  '#546e7a', '#c0792b',
];

export const avatarInitial = (name: string): string => {
  const first = Array.from(name.trim())[0];
  return first ? first.toUpperCase() : '?';
};

export const avatarColor = (name: string): string => {
  let hash = 0;
  for (const ch of name.trim().toLowerCase()) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
};
