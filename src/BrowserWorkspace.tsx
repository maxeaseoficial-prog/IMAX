import React, {useEffect, useRef, useState} from 'react';
import App from './App';
import DesktopAccess from './DesktopAccess';
import {connectBrowser} from './browser-client';
export default function BrowserWorkspace() {
  const live = useRef<Awaited<ReturnType<typeof connectBrowser>> | null>(null);
  const [state, setState] = useState<'idle'|'connecting'|'connected'|'lost'>('idle');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { if (state === 'connected') live.current?.start(); }, [state]);
  useEffect(() => {
    const hash = new URLSearchParams(location.hash.slice(1));
    const supplied = hash.get('pair');
    if (supplied && /^[a-f0-9]{64}$/.test(supplied)) {
      sessionStorage.setItem('imx-pair', supplied);
      history.replaceState(null, '', location.pathname);
    }
    const token = sessionStorage.getItem('imx-pair');
    if (!token) return;
    let canceled = false;
    let connection: Awaited<ReturnType<typeof connectBrowser>> | undefined;
    setState('connecting'); setError('');
    void connectBrowser(token, () => { if (!canceled) setState('lost'); }).then(c => {
      if (canceled) { c.close(); return; }
      connection = c; live.current = c; window.imx = c.api; setState('connected');

    }).catch(e => { if (!canceled) { setState('lost'); setError(String(e.message || e)); } });
    return () => { canceled = true; connection?.close(); };
  }, [attempt]);
  if (state === 'connected') return <><div style={{padding:'8px 20px',background:'#122a38',color:'#b6eaff',fontSize:13}}>Conectado ao IMAX deste Mac · Pastas e anexos são selecionados no aplicativo desktop.</div><App /></>;
  return <><div style={{padding:20,background:'#122a38',color:'#eaf2ff',fontFamily:'system-ui'}}>
    {state === 'connecting' ? 'Conectando ao IMAX no seu Mac…' : state === 'lost' ? 'Conexão com o Mac interrompida. As sessões continuam no IMAX enquanto ele estiver aberto.' : 'Para espelhar os terminais, clique em “Abrir no navegador” no IMAX do Mac.'}
    {error && <p>{error}</p>}
    {state === 'lost' && <button onClick={() => setAttempt(n => n+1)}>Reconectar aos terminais</button>}
    <p>Se o Chrome solicitar acesso à rede local, permita para conectar. Use este site no mesmo Mac onde o IMAX está aberto.</p>
  </div><DesktopAccess /></>;
}
