document.addEventListener('DOMContentLoaded', () => {
  const localVideo = document.getElementById('localVideo');
  const remoteVideo = document.getElementById('remoteVideo');
  const statusEl = document.getElementById('status');
  const endCallButton = document.getElementById('endCallButton');

  const user = JSON.parse(localStorage.getItem('user'));
  if (!user) {
    alert('Anda harus login terlebih dahulu.');
    window.location.href = '/login.html';
    return;
  }
  
  const params = new URLSearchParams(window.location.search);
  const roomId = params.get('roomId');
  if (!roomId) {
    alert('Room ID tidak ditemukan.');
    window.location.href = '/login.html';
    return;
  }

  const ws = new WebSocket(`ws://${window.location.host}`);
  let peerConnection;
  let localStream;
  
  // --- PERBAIKAN: Variabel untuk Antrean dan Status Kesiapan ---
  let messageQueue = [];
  let isPeerConnectionReady = false;

  const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
  };

  const setupWebRTC = async () => {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      
      peerConnection = new RTCPeerConnection(configuration);

      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
      };

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate, roomId }));
        }
      };

      // --- PERBAIKAN: Tandai bahwa PeerConnection sudah siap dan proses antrean ---
      isPeerConnectionReady = true;
      console.log('[SETUP] PeerConnection is READY.');
      processMessageQueue();

    } catch (err) {
      console.error('[ERROR] Gagal saat setup WebRTC:', err);
      statusEl.textContent = 'Gagal mengakses kamera/mikrofon.';
    }
  };

  // --- PERBAIKAN: Logika pesan dipindah ke fungsi sendiri ---
  const handleMessage = async (data) => {
    switch(data.type) {
      case 'user-joined':
        statusEl.textContent = `User ${data.username} telah bergabung. Membuat penawaran...`;
        createOffer();
        break;
      case 'offer':
        statusEl.textContent = 'Menerima penawaran. Membuat jawaban...';
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        createAnswer();
        break;
      case 'answer':
        statusEl.textContent = 'Menerima jawaban. Koneksi terjalin.';
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        break;
      case 'ice-candidate':
        // Tambahkan try-catch di sini untuk menangani kandidat yang datang sebelum offer di-set
        try {
          await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch(e) {
          console.warn("Warn: Failed to add early ICE candidate.", e.message);
        }
        break;
      case 'error':
        alert(`Error dari server: ${data.message}`);
        window.location.href = '/login.html';
        break;
    }
  };

  // --- PERBAIKAN: Fungsi untuk memproses antrean ---
  const processMessageQueue = () => {
    console.log(`[QUEUE] Memproses ${messageQueue.length} pesan dalam antrean.`);
    while(messageQueue.length > 0) {
      const message = messageQueue.shift(); // Ambil pesan paling awal
      handleMessage(message);
    }
  }

  ws.onopen = () => {
    statusEl.textContent = 'Terhubung. Menunggu user lain...';
    ws.send(JSON.stringify({ type: 'join', username: user.username, roomId }));
    setupWebRTC();
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    
    // --- PERBAIKAN: Cek apakah PeerConnection siap, jika tidak, masukkan ke antrean ---
    if (isPeerConnectionReady) {
      handleMessage(data);
    } else {
      console.log('[QUEUE] PeerConnection belum siap. Pesan ditambahkan ke antrean.');
      messageQueue.push(data);
    }
  };

  ws.onclose = () => {
    statusEl.textContent = 'Koneksi terputus.';
    cleanUp();
  };

  ws.onerror = (err) => {
    console.error('[WS] WebSocket error:', err);
  };

  const createOffer = async () => {
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', offer: offer, roomId }));
    } catch (err) {
      console.error('[ERROR] Gagal membuat offer:', err);
    }
  };

  const createAnswer = async () => {
    try {
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', answer: answer, roomId }));
    } catch (err) {
      console.error('[ERROR] Gagal membuat answer:', err);
    }
  };
  
  const cleanUp = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
      peerConnection.close();
    }
  };

  endCallButton.addEventListener('click', () => { ws.close(); });
  window.addEventListener('beforeunload', () => { ws.close(); });
});