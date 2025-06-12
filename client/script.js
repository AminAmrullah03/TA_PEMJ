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

  const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] // STUN server publik
  };

  const setupWebRTC = async () => {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localVideo.srcObject = localStream;
      
      peerConnection = new RTCPeerConnection(configuration);

      // Tambahkan stream lokal ke koneksi
      localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

      // Saat menerima stream dari remote
      peerConnection.ontrack = (event) => {
        remoteVideo.srcObject = event.streams[0];
      };

      // Saat ada ICE candidate baru
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          ws.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate, roomId }));
        }
      };

    } catch (err) {
      console.error('Error setting up WebRTC:', err);
      statusEl.textContent = 'Gagal mengakses kamera/mikrofon.';
    }
  };

  // --- WebSocket Logic ---
  ws.onopen = () => {
    console.log('WebSocket connected');
    statusEl.textContent = 'Terhubung. Menunggu user lain...';
    // Kirim pesan join
    ws.send(JSON.stringify({ type: 'join', username: user.username, roomId }));
    setupWebRTC();
  };

  ws.onmessage = async (event) => {
    const data = JSON.parse(event.data);

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
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        break;
      case 'error':
        alert(`Error: ${data.message}`);
        window.location.href = '/login.html';
        break;
    }
  };

  ws.onclose = () => {
    statusEl.textContent = 'Koneksi terputus.';
    cleanUp();
  };

  ws.onerror = (err) => {
    console.error('WebSocket error:', err);
    statusEl.textContent = 'Koneksi error.';
  };

  // --- WebRTC Signaling Functions ---
  const createOffer = async () => {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'offer', offer: offer, roomId }));
  };

  const createAnswer = async () => {
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'answer', answer: answer, roomId }));
  };
  
  // --- Controls ---
  const cleanUp = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnection) {
      peerConnection.close();
    }
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
  };

  endCallButton.addEventListener('click', () => {
    ws.close();
    cleanUp();
    window.location.href = '/login.html';
  });

  window.addEventListener('beforeunload', () => {
      ws.close();
      cleanUp();
  });
});