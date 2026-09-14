/* =========================================================
   SINCRONIZAÇÃO PÚBLICA
   Uma conexão independente por aba/navegador/dispositivo.
   O Render é o servidor WebSocket; o Netlify apenas publica os arquivos.
   Nenhum dado financeiro é enviado por este arquivo.
========================================================= */
(function(){
  const qs=new URLSearchParams(location.search);
  const room=qs.get('sala')||'demo-publico';
  const configured=(qs.get('servidor')||window.DEMO_SERVER_URL||'https://preventseniorgr.onrender.com').trim();
  let lastState=null,ws=null,queue=[],reconnectTimer=null,reconnectAllowed=true,connecting=false;

  function makeId(){
    return 'cliente-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
  }

  let clientId='';
  try{ clientId=sessionStorage.getItem('preventDemoClientId')||''; }catch(e){}
  if(!clientId){
    clientId=makeId();
    try{ sessionStorage.setItem('preventDemoClientId',clientId); }catch(e){}
  }
  window.PREVENT_DEMO_CLIENT_ID=clientId;

  function wsUrl(){
    let base=configured;
    if(!base||/^file:/i.test(base)) base='https://preventseniorgr.onrender.com';
    base=base.replace(/^http:/i,'ws:').replace(/^https:/i,'wss:').replace(/\/$/,'');
    return /\/ws$/i.test(base)?base:base+'/ws';
  }

  function isPanel(){
    return location.pathname.split('/').pop().toLowerCase()==='painel.html';
  }

  function scheduleReconnect(){
    if(!reconnectAllowed)return;
    clearTimeout(reconnectTimer);
    reconnectTimer=setTimeout(connect,1800);
  }

  function connect(){
    const page=location.pathname.split('/').pop().toLowerCase();
    if(page!=='area.html'&&page!=='painel.html')return;
    if(!reconnectAllowed||connecting)return;
    if(ws&&(ws.readyState===WebSocket.OPEN||ws.readyState===WebSocket.CONNECTING))return;

    connecting=true;
    try{ ws=new WebSocket(wsUrl()); }
    catch(e){ connecting=false;scheduleReconnect();return; }

    ws.onopen=function(){
      connecting=false;
      try{
        ws.send(JSON.stringify({type:'join',room,role:isPanel()?'operator':'client',clientId}));
        if(!isPanel())ws.send(JSON.stringify({type:'client_info',clientId,name:''}));
        const pending=queue.splice(0);
        pending.forEach(item=>{try{ws.send(JSON.stringify(item));}catch(e){queue.push(item);}});
      }catch(e){}
    };

    ws.onmessage=function(event){
      try{
        const data=JSON.parse(event.data);
        if(data&&(data.type==='state'||data.type==='client_list'))lastState=data;
        window.dispatchEvent(new CustomEvent('demo-public-message',{detail:data}));
      }catch(e){}
    };

    ws.onclose=function(){
      connecting=false;ws=null;clearTimeout(reconnectTimer);
      if(reconnectAllowed)scheduleReconnect();
    };

    ws.onerror=function(){try{ws.close();}catch(e){}};
  }

  window.demoPublic={
    room,clientId,
    getLastState:function(){return lastState;},
    getClientList:function(){return lastState&&Array.isArray(lastState.clients)?lastState.clients.slice():[];},
    send:function(payload){
      const msg={...(payload||{}),room,clientId:payload&&payload.clientId?payload.clientId:clientId};
      if(ws&&ws.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify(msg));return true;}catch(e){}}
      queue.push(msg);return false;
    },
    disconnect:function(){reconnectAllowed=false;clearTimeout(reconnectTimer);try{ws?.close();}catch(e){}}
  };

  window.addEventListener('demo-public-message',function(event){
    const data=event.detail||{};
    if(data.type==='removed_by_operator'&&data.clientId===clientId){
      reconnectAllowed=false;clearTimeout(reconnectTimer);try{ws?.close();}catch(e){}
    }
  });

  window.addEventListener('pagehide',function(){
    reconnectAllowed=false;clearTimeout(reconnectTimer);try{ws?.close();}catch(e){}
  });

  connect();
})();
