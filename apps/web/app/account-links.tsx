'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from './lib/projects';
import type { Session } from './lib/accounts';
export default function AccountLinks({ onNavigate }: { onNavigate?: () => void }) {
 const [session,setSession]=useState<Session | null>(null);
 useEffect(()=>{let mounted=true;async function refresh(){try{const current=await api<Session>('auth/session');if(mounted)setSession(current);}catch{if(mounted)setSession(null);}}void refresh();window.addEventListener('focus',refresh);return()=>{mounted=false;window.removeEventListener('focus',refresh);};},[]);
 return <>{session?.authenticated ? <><Link href="/account" prefetch={false} onClick={onNavigate}>My account</Link>{session.user?.role==='admin' && <Link href="/admin" prefetch={false} onClick={onNavigate}>Admin</Link>}<button className="nav-signout" onClick={async()=>{try{await api('auth/logout',{method:'POST'});setSession({authenticated:false,user:null});onNavigate?.();}catch{window.location.href='/login';}}} type="button">Sign out</button></> : <Link href="/login" prefetch={false} onClick={onNavigate}>Sign in</Link>}</>;
}
