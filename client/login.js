document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const dashboardSection = document.getElementById('dashboard-section');
  const loginForm = document.getElementById('loginForm');
  const statusEl = document.getElementById('status');
  const welcomeMessageEl = document.getElementById('welcome-message');
  const appointmentsListEl = document.getElementById('appointments-list');
  const logoutButton = document.getElementById('logoutButton');

  // Cek jika sudah login
  const user = JSON.parse(localStorage.getItem('user'));
  if (user) {
    showDashboard(user);
  }

  // Event listener untuk form login
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    statusEl.textContent = '';
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('user', JSON.stringify(data.user));
        showDashboard(data.user);
      } else {
        statusEl.textContent = data.message || 'Login gagal!';
      }
    } catch (err) {
      statusEl.textContent = 'Terjadi kesalahan pada server.';
    }
  });

  // Event listener untuk logout
  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('user');
    loginSection.style.display = 'block';
    dashboardSection.style.display = 'none';
    appointmentsListEl.innerHTML = '';
  });

  async function showDashboard(userData) {
    loginSection.style.display = 'none';
    dashboardSection.style.display = 'block';
    welcomeMessageEl.textContent = `Selamat Datang, ${userData.username} (${userData.role})`;
    await fetchAppointments(userData.username);
  }

  async function fetchAppointments(username) {
    try {
      const res = await fetch(`/api/appointments?username=${username}`);
      const appointments = await res.json();
      appointmentsListEl.innerHTML = ''; // Bersihkan list
      if (appointments.length === 0) {
        appointmentsListEl.innerHTML = '<p>Tidak ada jadwal konsultasi.</p>';
        return;
      }

      appointments.forEach(apt => {
        const aptEl = document.createElement('div');
        aptEl.className = 'appointment-item';
        aptEl.innerHTML = `
          <strong>${apt.description}</strong><br>
          Dengan: ${username === apt.doctorId ? apt.patientId : apt.doctorId}<br>
          Waktu: ${new Date(apt.start).toLocaleString()}
        `;
        aptEl.onclick = () => {
          // Arahkan ke ruang konsultasi
          window.location.href = `/index.html?roomId=${apt.id}`;
        };
        appointmentsListEl.appendChild(aptEl);
      });
    } catch (err) {
      appointmentsListEl.innerHTML = '<p>Gagal memuat jadwal.</p>';
    }
  }
});