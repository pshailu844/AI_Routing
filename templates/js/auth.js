document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const toRegisterBtn = document.getElementById('to-register');
    const toLoginBtn = document.getElementById('to-login');
    const authSubtitle = document.getElementById('auth-subtitle');
    const authMessage = document.getElementById('auth-message');

    // Toggle Forms
    toRegisterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.style.display = 'none';
        registerForm.style.display = 'block';
        authSubtitle.textContent = 'Create an account to access AI Ticket Support.';
        clearMessage();
    });

    toLoginBtn.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.style.display = 'none';
        loginForm.style.display = 'block';
        authSubtitle.textContent = 'Welcome back! Please login to your account.';
        clearMessage();
    });

    // Handle Login
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username').value;
        const password = document.getElementById('login-password').value;

        try {
            const response = await fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await response.json();

            if (data.status === 'success') {
                localStorage.setItem('auth_token', data.token);
                localStorage.setItem('user_info', JSON.stringify(data.user));
                showMessage('Login successful! Redirecting...', 'success');
                setTimeout(() => window.location.href = '/dashboard', 1500);
            } else {
                showMessage(data.message || 'Login failed', 'error');
            }
        } catch (error) {
            showMessage('Server connection failed!', 'error');
        }
    });

    // Handle Registration
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('reg-username').value;
        const full_name = document.getElementById('reg-fullname').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;

        try {
            const response = await fetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, full_name, email, password })
            });

            const data = await response.json();

            if (data.status === 'success') {
                showMessage('Account created successfully! You can login now.', 'success');
                setTimeout(() => {
                    toLoginBtn.click();
                    document.getElementById('login-username').value = username;
                }, 2000);
            } else {
                showMessage(data.message || 'Registration failed', 'error');
            }
        } catch (error) {
            showMessage('Server connection failed!', 'error');
        }
    });

    function showMessage(text, type) {
        authMessage.textContent = text;
        authMessage.className = `message ${type}`;
        authMessage.style.display = 'block';
    }

    function clearMessage() {
        authMessage.style.display = 'none';
        authMessage.textContent = '';
    }

    // Check if already logged in
    const existingToken = localStorage.getItem('auth_token');
    if (existingToken) {
        window.location.href = '/dashboard';
    }
});
