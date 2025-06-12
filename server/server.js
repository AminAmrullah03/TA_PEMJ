const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const url = require('url');

// --- Database In-Memory ---
const users = JSON.parse(fs.readFileSync(path.join(__dirname, '../users.json')));
const appointments = [
  {
    id: 'room1',
    doctorId: 'dokter1',
    patientId: 'pasien1',
    description: 'Konsultasi Rutin',
    start: new Date(new Date().getTime() - 15 * 60000), // 15 menit lalu
    end: new Date(new Date().getTime() + 60 * 60000),   // 1 jam dari sekarang
  }
];

// Menyimpan koneksi klien berdasarkan roomId
const rooms = {}; // { roomId: Set<Socket> }

// --- Membuat Server HTTP ---
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // --- Rute API ---
  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      const { username, password } = JSON.parse(body);
      const user = users.find(u => u.username === username);

      if (user && await bcrypt.compare(password, user.password)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, user: { username: user.username, role: user.role } }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Username atau password salah' }));
      }
    });
    return;
  }

  if (pathname === '/api/appointments' && req.method === 'GET') {
    const { username } = parsedUrl.query;
    const userAppointments = appointments.filter(
      apt => apt.doctorId === username || apt.patientId === username
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(userAppointments));
    return;
  }

  // --- Rute Penyajian File (HTML, JS) ---
  const getContentType = (filePath) => {
    if (filePath.endsWith('.html')) return 'text/html';
    if (filePath.endsWith('.js')) return 'application/javascript';
    return 'text/plain';
  };
  
  let safePath;
  if (pathname === '/') {
    safePath = path.join(__dirname, '../client/login.html');
  } else {
    safePath = path.join(__dirname, '../client', pathname);
  }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': getContentType(safePath) });
      res.end(data);
    }
  });
});

// --- Upgrade ke WebSocket ---
server.on('upgrade', (req, socket, head) => {
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

  let currentRoomId = null;

  socket.on('data', (buffer) => {
    const msg = parseMessage(buffer);
    if (!msg) return;

    try {
      const data = JSON.parse(msg);

      if (data.type === 'join') {
        const { roomId, username } = data;
        const appointment = appointments.find(a => a.id === roomId);

        // Validasi Lengkap: Apakah janji temu ada, user berhak, dan waktunya pas?
        if (!appointment || (username !== appointment.doctorId && username !== appointment.patientId) || new Date() < new Date(appointment.start) || new Date() > new Date(appointment.end)) {
          socket.write(encodeMessage(JSON.stringify({ type: 'error', message: 'Sesi tidak valid atau tidak diizinkan.' })));
          socket.end();
          return;
        }

        // Jika valid, masukkan user ke room
        currentRoomId = roomId;
        if (!rooms[roomId]) rooms[roomId] = new Set();
        rooms[roomId].add(socket);

        console.log(`User ${username} joined room ${roomId}`);
        // Kirim pesan ke user lain di room
        rooms[roomId].forEach(client => {
          if (client !== socket) {
            client.write(encodeMessage(JSON.stringify({ type: 'user-joined', username })));
          }
        });
      } else if (currentRoomId && rooms[currentRoomId]) {
        // Broadcast pesan signaling (offer, answer, dll.) ke semua klien lain di room yang sama
        rooms[currentRoomId].forEach(client => {
          if (client !== socket) {
            client.write(encodeMessage(JSON.stringify(data)));
          }
        });
      }
    } catch (e) {
      console.error('Parsing error', e);
    }
  });

  socket.on('end', () => {
    console.log('Client disconnected');
    if (currentRoomId && rooms[currentRoomId]) {
      rooms[currentRoomId].delete(socket);
    }
  });
});

// --- Fungsi Helper WebSocket (dari kode asli Anda) ---
function parseMessage(buffer) {
  // ... (kode parseMessage Anda tidak perlu diubah)
  const secondByte = buffer[1];
  const length = secondByte & 127;
  let offset = 2;
  if (length === 126) {
    offset = 4;
  } else if (length === 127) {
    offset = 10;
  }
  const maskingKey = buffer.slice(offset, offset + 4);
  const data = buffer.slice(offset + 4);
  const decoded = data.map((byte, i) => byte ^ maskingKey[i % 4]);
  return Buffer.from(decoded).toString('utf8');
}

function encodeMessage(str) {
  // ... (kode encodeMessage Anda tidak perlu diubah)
  const msg = Buffer.from(str);
  const length = msg.length;
  let header;
  let buffer;
  if (length <= 125) {
    header = Buffer.from([0x81, length]);
    buffer = Buffer.concat([header, msg]);
  } else if (length <= 65535) {
    header = Buffer.from([0x81, 126, (length >> 8) & 0xFF, length & 0xFF]);
    buffer = Buffer.concat([header, msg]);
  } else {
    // Penanganan untuk pesan yang sangat besar (biasanya tidak diperlukan untuk signaling)
    // ...
  }
  return buffer;
}

// --- Menjalankan Server ---
server.listen(8080, () => {
  console.log('Server sederhana berjalan di http://localhost:8080');
});