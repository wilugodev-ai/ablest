'use client';
import { useEffect,useState } from 'react';
import { api } from '../lib/projects';
import type { Account } from '../lib/accounts';
export default function ClientManager(){
 const [clients,setClients]=useState<Account[]>([]),[client,setClient]=useState<Account|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
 async function load(){setLoading(true);setError('');try{setClients(await api<Account[]>('admin/clients'));}catch(e){setError((e as Error).message);}finally{setLoading(false);}}
 useEffect(()=>{void load();},[]);
 if(loading)return <p role="status">Loading client profiles?</p>;
 if(error)return <><p className="admin-error" role="alert">{error}</p><button className="button" onClick={load}>Try again</button></>;
 if(!clients.length)return <div className="portfolio-empty"><h2>No client accounts yet.</h2><p>Clients can create their own account through Sign in on the website. Their profiles will appear here.</p></div>;
 return <div className="admin-workspace"><aside className="admin-projects" aria-label="Client accounts">{clients.map(user=><button key={user.id} className={client?.id===user.id?'selected':''} onClick={()=>setClient(user)}><strong>{user.name}</strong><span>{user.email}</span></button>)}</aside><section className="admin-editor">{client?<><h2>{client.name}</h2><dl className="client-profile-details"><dt>Email</dt><dd>{client.email}</dd><dt>Company</dt><dd>{client.company||'Not provided'}</dd><dt>Phone</dt><dd>{client.phone||'Not provided'}</dd><dt>Role</dt><dd>Client</dd></dl></>:<div className="admin-empty"><h2>Select a client.</h2><p>View the personal and business details they?ve added to their profile.</p></div>}</section></div>;
}
