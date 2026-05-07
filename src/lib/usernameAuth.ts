function slugifyUsername(username: string) {
  return username
    .trim()
    .toLowerCase()
    .replace(/['".]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Supabase Auth requires an email identifier. We derive a stable internal email from the username,
// so users can log in using "username + password" in the UI.
export function usernameToEmail(username: string) {
  const slug = slugifyUsername(username);
  return `${slug}@repovesi-open.local`;
}

export function usernameToPassword(username: string) {
  const slug = slugifyUsername(username);
  // This is a stable password derived from the username so the user only needs to enter the name.
  return `repovesi-${slug}-login`;
}

export function normalizeUsername(username: string) {
  return slugifyUsername(username);
}

