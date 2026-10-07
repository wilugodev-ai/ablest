export type Account = { id: string; email: string; name: string; company: string; phone: string; role: 'admin' | 'client' };
export type Session = { authenticated: boolean; user: Account | null };
