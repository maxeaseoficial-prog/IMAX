import React, {useEffect, useRef, useState} from 'react';
import App from './App';
import DesktopAccess from './DesktopAccess';
import {connectBrowser, pairBrowser} from './browser-client';
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
      localStorage.setItem('imx-pair', supplied);
      history.replaceState(null, '', location.pathname);
    }
    let token = localStorage.getItem('imx-pair') || sessionStorage.getItem('imx-pair');
    let canceled = false;
    let connection: Awaited<ReturnType<typeof connectBrowser>> | undefined;
    setState('connecting'); setError('');
    const lost = () => { if (!canceled) setState('lost'); };
    const connect = async () => {
      if (token) {
        try { return await connectBrowser(token, lost); }
        catch (e) { if ((e as {status?:number}).status !== 401) throw e; localStorage.removeItem('imx-pair'); sessionStorage.removeItem('imx-pair'); }
      }
      token = await pairBrowser();
      localStorage.setItem('imx-pair', token);
      return connectBrowser(token, lost);
    };
    void connect().then(c => {
      if (canceled) { c.close(); return; }
      connection = c; live.current = c; window.imx = c.api; setState('connected');

    }).catch(e => { if (!canceled) { setState('lost'); setError(String(e.message || e)); } });
    return () => { canceled = true; connection?.close(); };
  }, [attempt]);
  if (state === 'connected') return <><div style={{padding:'8px 20px',background:'#122a38',color:'#b6eaff',fontSize:13}}>Conectado ao IMAX deste Mac · Pastas e anexos são selecionados no aplicativo desktop.</div><App /></>;
  return <><div style={{padding:20,background:'#122a38',color:'#eaf2ff',fontFamily:'system-ui'}}>
    {state === 'connecting' ? 'Conectando ao IMAX… Na primeira vez, autorize na janela do aplicativo no Mac.' : state === 'lost' ? 'Conexão com o Mac interrompida. As sessões continuam no IMAX enquanto ele estiver aberto.' : 'Procurando o IMAX neste Mac…'}
    {error && <p>{error === 'Failed to fetch' ? 'Não foi possível acessar o IMAX. Abra o aplicativo neste Mac e permita o acesso à rede local no Chrome.' : error}</p>}
    {state === 'lost' && <button onClick={() => setAttempt(n => n+1)}>Reconectar aos terminais</button>}
    <p>Se o Chrome solicitar acesso à rede local, permita para conectar. Use este site no mesmo Mac onde o IMAX está aberto.</p>
  </div><DesktopAccess /></>;
}
