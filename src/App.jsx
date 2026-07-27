import React, { useState, useEffect } from 'react';
import { ShieldCheck, UserCheck, LogOut, Clock, Wifi, Sun, Moon } from 'lucide-react';
import EmployeePortal from './components/EmployeePortal';
import AdminDashboard from './components/AdminDashboard';
import logo from './logo.png';

export default function App() {
  const [view, setView] = useState('portal'); // 'portal' | 'admin'
  const [employees, setEmployees] = useState([]);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [showAdminPinModal, setShowAdminPinModal] = useState(false);
  const [adminPinInput, setAdminPinInput] = useState('');
  const [adminPinError, setAdminPinError] = useState('');
  const [notification, setNotification] = useState(null);
  
  // Real-time clock in header
  const [currentTime, setCurrentTime] = useState(new Date());

  // Light/Dark Theme State (Starts with Light by default)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('theme') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch employees
  const fetchEmployees = async () => {
    try {
      const response = await fetch('/api/employees');
      const data = await response.json();
      setEmployees(data);
    } catch (err) {
      console.error('Error fetching employees:', err);
      showNotification('Error connecting to local server.', 'danger');
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const handleAdminAccessClick = () => {
    if (isAdminAuthenticated) {
      setView('admin');
    } else {
      setShowAdminPinModal(true);
      setAdminPinInput('');
      setAdminPinError('');
    }
  };

  const handleAdminPinSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/admin/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: adminPinInput })
      });
      const data = await response.json();
      if (data.success) {
        setIsAdminAuthenticated(true);
        setView('admin');
        setShowAdminPinModal(false);
        setAdminPinInput('');
        showNotification('Admin access granted', 'success');
      } else {
        setAdminPinError('Invalid Admin PIN');
      }
    } catch (err) {
      setAdminPinError('Error connecting to server');
    }
  };

  const handleAdminLogout = () => {
    setIsAdminAuthenticated(false);
    setView('portal');
    showNotification('Logged out of Admin panel', 'info');
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', cursor: 'pointer' }} onClick={() => setView('portal')}>
          <img src={logo} alt="TimePilot Logo" style={{ 
            width: '40px',
            height: '40px',
            objectFit: 'contain'
          }} />
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(to right, #ffffff, #94a3b8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              TimePilot
            </h1>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', display: 'block', marginTop: '-2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Attendance Portal
            </span>
          </div>
        </div>

        {/* Live Network & Clock Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(255, 255, 255, 0.03)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem' }}>
            <Clock size={15} color="var(--accent-color)" />
            <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--text-primary)' }}>
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success-color)', fontSize: '0.85rem' }}>
            <Wifi size={16} />
            <span style={{ fontWeight: 500 }}>Local Host</span>
          </div>

          <button 
            className="btn-icon" 
            onClick={toggleTheme} 
            title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            style={{ width: '36px', height: '36px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--btn-secondary-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {theme === 'light' ? <Moon size={16} color="var(--text-primary)" /> : <Sun size={16} color="var(--text-primary)" />}
          </button>

          {view === 'portal' ? (
            <button className="btn-secondary" onClick={handleAdminAccessClick} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
              <ShieldCheck size={16} />
              Admin Panel
            </button>
          ) : (
            <button className="btn-danger" onClick={handleAdminLogout} style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
              <LogOut size={16} />
              Exit Admin
            </button>
          )}
        </div>
      </header>

      {/* Global Notifications */}
      {notification && (
        <div 
          className="animate-fade-in"
          style={{
            position: 'fixed',
            top: '85px',
            right: '40px',
            background: notification.type === 'success' ? 'var(--success-glow)' : notification.type === 'danger' ? 'var(--danger-glow)' : 'rgba(30, 41, 59, 0.9)',
            border: `1px solid ${notification.type === 'success' ? 'var(--success-color)' : notification.type === 'danger' ? 'var(--danger-color)' : 'var(--border-color)'}`,
            color: notification.type === 'success' ? 'var(--success-color)' : notification.type === 'danger' ? 'var(--danger-color)' : 'var(--text-primary)',
            padding: '12px 24px',
            borderRadius: 'var(--border-radius-md)',
            backdropFilter: 'var(--glass-blur)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
            zIndex: 999,
            fontWeight: 500,
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>{notification.message}</span>
        </div>
      )}

      {/* Main Workspace */}
      <main className="container">
        {view === 'portal' ? (
          <EmployeePortal 
            employees={employees} 
            showNotification={showNotification} 
            refreshEmployees={fetchEmployees}
          />
        ) : (
          <AdminDashboard 
            adminPin={adminPinInput || '9999'} // Uses verified input or default for API calls
            showNotification={showNotification}
          />
        )}
      </main>

      {/* Footer */}
      <footer style={{ marginTop: 'auto', padding: '20px 40px', borderTop: '1px solid var(--border-color)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
        &copy; {new Date().getFullYear()} TimePilot Attendance. Powered by Node.js & SQLite. Running locally on office network.
      </footer>

      {/* Admin PIN Dialog */}
      {showAdminPinModal && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '350px' }}>
            <h3 style={{ marginBottom: '16px', fontSize: '1.2rem', textAlign: 'center' }}>Enter Admin PIN</h3>
            <form onSubmit={handleAdminPinSubmit}>
              <div className="form-group">
                <input 
                  type="password" 
                  className="form-input" 
                  value={adminPinInput}
                  onChange={(e) => setAdminPinInput(e.target.value)}
                  placeholder="••••"
                  maxLength={10}
                  autoFocus
                  style={{ textAlign: 'center', fontSize: '1.5rem', letterSpacing: '0.4em' }}
                />
                {adminPinError && (
                  <span style={{ color: 'var(--danger-color)', fontSize: '0.8rem', textAlign: 'center', marginTop: '4px' }}>
                    {adminPinError}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowAdminPinModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  Verify
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
