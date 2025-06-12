const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const url = require('url');

const users = JSON.parse(fs.readFileSync(path.join(__dirname, '../users.json')));
const appointments = [
  {
    id: 'room1',
    doctorId: 'dokter1',
    patientId: 'pasien1',
    description: 'Konsultasi Rutin',
    start: new Date(new Date().getTime() - 15 * 60000),
    end: new Date(new Date().getTime() + 60 * 60000),
  }
];

const rooms = {};

const server = http.createServer(async (req, res) => {
  // ... (Bagian ini tidak berubah, biarkan seperti sebelumnya)
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

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
  
  let safePath;
  if (pathname === '/' || pathname === '/login.html') {
    safePath = path.join(__dirname, '../client/login.html');
  } else {
    safePath = path.join(__dirname, '../client', pathname);
  }

  fs.readFile(safePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      const getContentType = (filePath) => {
        if (filePath.endsWith('.html')) return 'text/html';
        if (filePath.endsWith('.js')) return 'application/javascript';
        return 'text/plain';
      };
      res.writeHead(200, { 'Content-Type': getContentType(safePath) });
      res.end(data);
    }
  });
});


server.on('upgrade', (req, socket, head) => {
  // ... (Bagian handshake WebSocket tidak berubah)
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

  // ==================== PERUBAHAN DIMULAI DI SINI ====================

  // Buffer untuk menampung data yang mungkin terpotong atau datang dalam satu paket
  let inputBuffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    inputBuffer = Buffer.concat([inputBuffer, chunk]); // Gabungkan data baru ke buffer

    // Terus proses selama buffer kita masih punya data untuk diproses
    while (true) {
      const result = processBuffer(inputBuffer);

      if (!result) {
        // Jika data tidak cukup untuk satu frame utuh, hentikan loop dan tunggu data berikutnya
        break;
      }

      // Jika berhasil memproses satu frame
      const frame = result.frame;
      const msg = parseMessage(frame); // Gunakan fungsi parseMessage Anda yang lama
      if (msg) {
        handleMessage(JSON.parse(msg), socket); // Proses data JSON
      }

      // Buang bagian buffer yang sudah diproses
      inputBuffer = result.remainingBuffer;
    }
  });
  
  function handleMessage(data, socket) {
      try {
        if (data.type === 'join') {
            const { roomId, username } = data;
            const appointment = appointments.find(a => a.id === roomId);

            if (!appointment || (username !== appointment.doctorId && username !== appointment.patientId) || new Date() < new Date(appointment.start) || new Date() > new Date(appointment.end)) {
                socket.write(encodeMessage(JSON.stringify({ type: 'error', message: 'Sesi tidak valid atau tidak diizinkan.' })));
                socket.end();
                return;
            }

            currentRoomId = roomId;
            if (!rooms[roomId]) rooms[roomId] = new Set();
            rooms[roomId].add(socket);
            socket.roomId = roomId; // Simpan roomId di socket untuk proses 'close'

            console.log(`User ${username} joined room ${roomId}`);
            rooms[roomId].forEach(client => {
                if (client !== socket) {
                    client.write(encodeMessage(JSON.stringify({ type: 'user-joined', username })));
                }
            });
        } else if (socket.roomId && rooms[socket.roomId]) {
            rooms[socket.roomId].forEach(client => {
                if (client !== socket) {
                    client.write(encodeMessage(JSON.stringify(data)));
                }
            });
        }
      } catch (e) {
          console.error("Error handling message:", e);
      }
  }

  // Fungsi baru untuk memotong satu frame utuh dari buffer
  function processBuffer(buffer) {
    if (buffer.length < 2) return null; // Belum cukup data bahkan untuk header dasar

    const lengthByte = buffer[1] & 127;
    let payloadLength = lengthByte;
    let headerLength = 2; // opcode (1) + length (1)
    let maskOffset = 2;

    if (lengthByte === 126) {
      if (buffer.length < 4) return null; // Butuh 2 byte tambahan untuk panjang
      payloadLength = buffer.readUInt16BE(2);
      headerLength = 4;
      maskOffset = 4;
    } else if (lengthByte === 127) {
      if (buffer.length < 10) return null; // Butuh 8 byte tambahan untuk panjang
      payloadLength = Number(buffer.readBigUInt64BE(2)); // Mungkin perlu penyesuaian untuk pesan > 2GB
      headerLength = 10;
      maskOffset = 10;
    }
    
    const maskKeyLength = 4;
    const totalFrameLength = headerLength + maskKeyLength + payloadLength;

    if (buffer.length < totalFrameLength) {
      return null; // Data untuk satu frame penuh belum tiba
    }

    return {
      frame: buffer.slice(0, totalFrameLength),
      remainingBuffer: buffer.slice(totalFrameLength)
    };
  }

  // ==================== PERUBAHAN SELESAI DI SINI ====================


  socket.on('end', () => {
    console.log('Client disconnected');
    // Gunakan roomId yang disimpan di socket
    const roomId = socket.roomId; 
    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(socket);
    }
  });

  socket.on('error', (err) => {
    console.error("Socket error:", err.message);
  });
});

// ... (Fungsi parseMessage dan encodeMessage Anda tidak berubah)
function parseMessage(buffer) {
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
    header = Buffer.from([0x81, 127, 0, 0, 0, 0, (length >> 24) & 0xFF, (length >> 16) & 0xFF, (length >> 8) & 0xFF, length & 0xFF]);
    buffer = Buffer.concat([header, msg]);
  }
  return buffer;
}


server.listen(8080, () => {
  console.log('Server sederhana berjalan di http://localhost:8080');
});