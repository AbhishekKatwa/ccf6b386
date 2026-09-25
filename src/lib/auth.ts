/**
 * Demo-grade auth helpers. There is no backend in this project (the zustand
 * persist store is the database), so password hashing and OTP are simulated
 * client-side. Passwords are never stored in plaintext.
 */

export function hashPassword(pw: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < pw.length; i++) {
    const c = pw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `h${h1.toString(36)}${h2.toString(36)}`;
}

export function verifyPassword(pw: string, hash: string): boolean {
  return hashPassword(pw) === hash;
}

/** Demo OTP: deterministic 6-digit code derived from the mobile number. */
export function generateOtp(mobile: string): string {
  let n = 0;
  for (let i = 0; i < mobile.length; i++) n = (n * 31 + mobile.charCodeAt(i)) >>> 0;
  return String(100000 + (n % 900000));
}

export function isOtpValid(mobile: string, code: string): boolean {
  return /^\d{6}$/.test(code) && code === generateOtp(mobile);
}

export function normalizeMobile(input: string): string {
  return input.replace(/\D/g, '').slice(-10);
}

export interface UserDraft {
  name: string;
  mobile: string;
  password: string;
  role: string;
  companyIds: string[];
}

/**
 * The one gate a new-user draft has to pass, plus the mobile it normalises to. Both the local
 * write and the cloud pre-flight read it, because the cloud path writes auth.users *before* the
 * profile row exists: a draft refused only locally would leave a login without a person.
 */
export function validateUserDraft(
  draft: UserDraft,
  isMobileTaken: (mobile: string) => boolean,
): { mobile: string; error: string | null } {
  const mobile = normalizeMobile(draft.mobile);
  if (mobile.length !== 10) return { mobile, error: 'Enter a valid 10-digit mobile number' };
  if (isMobileTaken(mobile)) return { mobile, error: 'A user with this mobile already exists' };
  if (draft.password.length < 4) return { mobile, error: 'Password must be at least 4 characters' };
  if (draft.role !== 'MASTER_ADMIN' && draft.companyIds.length === 0) {
    return { mobile, error: 'Assign at least one company' };
  }
  return { mobile, error: null };
}
