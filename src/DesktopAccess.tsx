import React from "react";
export default function DesktopAccess() {
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,background:"#080d18",color:"#eaf2ff",fontFamily:"Inter,system-ui,sans-serif"}}>
    <section style={{maxWidth:680,width:"100%",padding:"48px 32px",border:"1px solid #23334c",borderRadius:24,background:"#0d1626"}}>
      <p style={{color:"#61d4ff",letterSpacing:4,fontSize:13}}>IMAX · AGENTIC WORKSPACE</p>
      <h1 style={{fontSize:"clamp(32px,6vw,52px)",lineHeight:1.08,margin:"24px 0"}}>Seu time de agentes.<br/>No seu computador.</h1>
      <p style={{color:"#b6c5dc",fontSize:18,lineHeight:1.7}}>Organize missões e distribua tarefas entre agentes de programação em um só lugar.</p>
      <div style={{margin:"28px 0",padding:20,borderRadius:12,background:"#142239",lineHeight:1.7}}>
        <strong>Abra o aplicativo desktop para começar</strong>
        <p style={{marginBottom:0}}>Esta página é o acesso web do projeto. Os terminais, arquivos e agentes funcionam no IMAX instalado no seu computador.</p>
      </div>
      <p style={{color:"#b6c5dc"}}>Se o projeto já está em ~/Desktop/IMAX, execute no Terminal:</p>
      <pre style={{padding:18,background:"#070c15",borderRadius:10,overflowX:"auto"}}><code>{"cd ~/Desktop/IMAX\nnpm run dev"}</code></pre>
      <a href="https://github.com/maxeaseoficial-prog/IMAX/tree/feat/imx-mvp" target="_blank" rel="noreferrer" style={{display:"inline-block",marginTop:20,padding:"13px 20px",background:"#46c8ff",color:"#06111c",borderRadius:9,fontWeight:700,textDecoration:"none"}}>Acessar código do IMAX ↗</a>
    </section>
  </main>;
}

