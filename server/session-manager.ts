import { issueToken } from '../packages/auth';

export interface Session {
  id: string;
  clientId: string;
  token: string;
  createdAt: number;
}

export class SessionManager {
  private sessions = new Map<string, Session>();

  create(clientId: string): Session {
    const id = crypto.randomUUID();
    const token = issueToken(id);
    const session: Session = { id, clientId, token, createdAt: Date.now() };
    this.sessions.set(id, session);
    return session;
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  remove(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  list() {
    return [...this.sessions.values()];
  }
}
