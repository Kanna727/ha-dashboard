// Whether the logged-in HA user is an admin, once known (HaProvider sets it from
// the user it fetches at login). Saving to HA's dashboard store needs an admin,
// so a screen that knows it isn't saves through the inbox list right away
// instead of trying and being refused (engine.ts).
let admin: boolean | undefined;

export const isAdmin = (): boolean | undefined => admin;

export function setAdmin(value: boolean | undefined): void {
  admin = value;
}
