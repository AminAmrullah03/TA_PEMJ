// server/server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const users = JSON.parse(fs.readFileSync(path.join(__dirname, '../users.json')));


// Data janji temu (jadwal konsultasi)
const appointments = [
  {
    id: 'room1',
    start: new Date(new Date().getTime() - 5 * 60000), // 5 menit lalu
    end: new Date(new Date().getTime() + 60 * 60000), // 1 jam dari sekarang
  },
];

let clients = {}; // { roomId: [socket1, socket2, ...] }

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    fs.readFile(path.join(__dirname, '../client/index.html'), (err, data) => {
      if (err) return res.writeHead(500).end('Error loading HTML');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/script.js') {
    fs.readFile(path.join(__dirname, '../client/script.js'), (err, data) => {
      if (err) return res.writeHead(500).end('Error loading JS');
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(data);
    });
  } else if (req.url === '/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const { username, password } = JSON.parse(body);
      const user = users.find(u => u.username === username && u.password === password);
      if (user) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, user }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      }
    });
  } else if (req.url === '/login.html') {
    fs.readFile(path.join(__dirname, '../client/login.html'), (err, data) => {
      if (err) return res.writeHead(500).end('Error loading login page');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  } else if (req.url === '/login.js') {
    fs.readFile(path.join(__dirname, '../client/login.js'), (err, data) => {
      if (err) return res.writeHead(500).end('Error loading login script');
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      res.end(data);
    });
  }
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\n` +
    `Upgrade: websocket\r\n` +
    `Connection: Upgrade\r\n` +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
  );

  let roomId = null;

  socket.on('data', (buffer) => {
    const msg = parseMessage(buffer);
    if (!msg) return;

    try {
      const data = JSON.parse(msg);

      if (data.type === 'join') {
        roomId = data.roomId;
        const appointment = appointments.find(
          (a) => a.id === roomId && new Date() >= a.start && new Date() <= a.end
        );

        if (!appointment) {
          socket.write(encodeMessage(JSON.stringify({ type: 'error', message: 'Janji tidak aktif' })));
          socket.end();
          return;
        }

        if (!clients[roomId]) clients[roomId] = [];
        clients[roomId].push(socket);
      } else {
        if (roomId && clients[roomId]) {
          clients[roomId].forEach((client) => {
            if (client !== socket) {
              client.write(encodeMessage(JSON.stringify(data)));
            }
          });
        }
      }
    } catch (e) {
      console.error('Parsing error', e);
    }
  });

  socket.on('end', () => {
    if (roomId && clients[roomId]) {
      clients[roomId] = clients[roomId].filter((s) => s !== socket);
    }
  });
});

function parseMessage(buffer) {
  const secondByte = buffer[1];
  const length = secondByte & 127;
  const maskingKey = buffer.slice(2, 6);
  const data = buffer.slice(6, 6 + length);
  const decoded = data.map((byte, i) => byte ^ maskingKey[i % 4]);
  return Buffer.from(decoded).toString('utf8');
}

function encodeMessage(str) {
  const msg = Buffer.from(str);
  const length = msg.length;
  const buffer = Buffer.alloc(2 + length);
  buffer[0] = 0x81; // FIN + text frame
  buffer[1] = length;
  msg.copy(buffer, 2);
  return buffer;
}

server.listen(8080, () => {
  console.log('Server running at http://localhost:8080');
});
