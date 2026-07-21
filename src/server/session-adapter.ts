import type { AuthoritySession, AuthoritySessionAdapter } from "./authority-types.js";

/** Development/test adapter. Production providers must validate signed server sessions. */
export class StaticSessionAdapter implements AuthoritySessionAdapter {
  constructor(private readonly sessions: ReadonlyMap<string, AuthoritySession>) {}

  async verify(sessionToken: string | undefined): Promise<AuthoritySession | null> {
    if (sessionToken === undefined || sessionToken.length < 32) return null;
    for (const [token, session] of this.sessions) {
      if (constantTimeEqual(token, sessionToken)) {
        if (session.expiresAt !== undefined && session.expiresAt <= new Date()) return null;
        return { ...session };
      }
    }
    return null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}
