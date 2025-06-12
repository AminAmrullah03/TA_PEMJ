document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();

  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  const data = await res.json();

  if (data.success) {
    localStorage.setItem('user', JSON.stringify(data.user));
    window.location.href = '/'; // Redirect ke halaman utama
  } else {
    document.getElementById('status').textContent = 'Login gagal!';
  }
});
