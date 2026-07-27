import React, { useState, useEffect } from 'react';
import { LogIn, LogOut, X, Delete } from 'lucide-react';

export default function EmployeePortal({ employees, showNotification, refreshEmployees }) {
  const [todayAttendance, setTodayAttendance] = useState([]);
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');

  // Fetch today's attendance statuses
  const fetchTodayAttendance = async () => {
    try {
      const res = await fetch('/api/attendance/today');
      const data = await res.json();
      setTodayAttendance(data);
    } catch (err) {
      console.error('Error fetching today attendance:', err);
    }
  };

  useEffect(() => {
    fetchTodayAttendance();
    // Auto refresh status every 30 seconds
    const interval = setInterval(fetchTodayAttendance, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleCardClick = (employee) => {
    setSelectedEmployee(employee);
    setPin('');
    setPinError('');
  };

  const handlePinKeyPress = (val) => {
    setPinError('');
    if (pin.length < 4) {
      setPin(prev => prev + val);
    }
  };

  const handleBackspace = () => {
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin('');
  };

  // Listen to keyboard inputs when PIN modal is open
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!selectedEmployee) return;
      if (e.key >= '0' && e.key <= '9') {
        handlePinKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        setSelectedEmployee(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEmployee, pin]);

  // Find today's attendance record for an employee
  const getEmployeeStatus = (empId) => {
    const record = todayAttendance.find(a => a.employeeId === empId);
    if (!record) return { status: 'Out', timeIn: null, timeOut: null };
    if (record.clockOut) return { status: 'Out', timeIn: record.clockIn, timeOut: record.clockOut };
    if (record.clockIn) return { status: 'In', timeIn: record.clockIn, timeOut: null };
    return { status: 'Out', timeIn: null, timeOut: null };
  };

  // Clock In / Clock Out Submission
  const handleClockAction = async (actionType) => {
    if (pin.length < 4) {
      setPinError('Please enter your 4-digit PIN');
      return;
    }

    const endpoint = actionType === 'in' ? '/api/attendance/clock-in' : '/api/attendance/clock-out';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: selectedEmployee.id, pin })
      });
      const data = await response.json();

      if (data.success) {
        const timeStr = data.record.clockOut || data.record.clockIn;
        showNotification(
          `${selectedEmployee.name} ${actionType === 'in' ? 'Clocked In' : 'Clocked Out'} successfully at ${timeStr}!`, 
          'success'
        );
        setSelectedEmployee(null);
        setPin('');
        fetchTodayAttendance();
        if (refreshEmployees) refreshEmployees();
      } else {
        setPinError(data.message || 'Incorrect PIN');
      }
    } catch (err) {
      setPinError('Server communication error');
    }
  };

  // Helper for generating colors/gradients based on name initials
  const getInitialsGradient = (name) => {
    const colors = [
      ['#4f46e5', '#3b82f6'], // Indigo-Blue
      ['#10b981', '#059669'], // Emerald-Green
      ['#ec4899', '#db2777'], // Pink
      ['#f59e0b', '#d97706'], // Amber-Orange
      ['#8b5cf6', '#7c3aed']  // Violet
    ];
    // Simple hash to select color
    let sum = 0;
    for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
    const pair = colors[sum % colors.length];
    return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`;
  };

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      {/* Title banner */}
      <div style={{ textAlign: 'center', margin: '20px 0' }}>
        <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: '8px' }}>
          Welcome back to the Office
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Please select your profile to check in or out for today.
        </p>
      </div>

      {/* Grid of employees */}
      {employees.length === 0 ? (
        <div className="glass-panel" style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <p>No employees registered yet. Go to Admin Panel to register employees.</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '24px',
          justifyContent: 'center',
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%'
        }}>
          {employees.map(emp => {
            const att = getEmployeeStatus(emp.id);
            return (
              <div 
                key={emp.id}
                className="glass-card"
                onClick={() => handleCardClick(emp)}
                style={{
                  padding: '30px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  cursor: 'pointer',
                  textAlign: 'center'
                }}
              >
                {/* Avatar Bubble */}
                <div style={{
                  background: getInitialsGradient(emp.name),
                  width: '72px',
                  height: '72px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  marginBottom: '16px',
                  boxShadow: '0 8px 16px rgba(0,0,0,0.2)'
                }}>
                  {getInitials(emp.name)}
                </div>

                {/* Name & Designation */}
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '4px' }}>{emp.name}</h3>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '20px', display: 'block' }}>
                  {emp.designation}
                </span>

                {/* Daily Status Badge */}
                {att.status === 'In' ? (
                  <div className="badge badge-present">
                    <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--success-color)', marginRight: '2px' }}></span>
                    Active • In: {att.timeIn.slice(0, 5)}
                  </div>
                ) : att.timeOut ? (
                  <div className="badge badge-absent">
                    Out • Out: {att.timeOut.slice(0, 5)}
                  </div>
                ) : (
                  <div className="badge badge-absent">
                    Not Clocked In
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Pin Input Modal */}
      {selectedEmployee && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '360px', padding: '24px 20px' }}>
            {/* Close Button */}
            <button 
              style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              onClick={() => setSelectedEmployee(null)}
            >
              <X size={20} />
            </button>

            {/* Profile Summary in Modal */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{
                background: getInitialsGradient(selectedEmployee.name),
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: '1.25rem',
                fontWeight: 700,
                marginBottom: '8px'
              }}>
                {getInitials(selectedEmployee.name)}
              </div>
              <h4 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{selectedEmployee.name}</h4>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{selectedEmployee.designation}</span>
            </div>

            {/* PIN Display bullets */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center',
                background: 'rgba(0,0,0,0.2)',
                padding: '12px 24px',
                borderRadius: 'var(--border-radius-md)',
                minWidth: '160px',
                border: '1px solid var(--border-color)'
              }}>
                {[0, 1, 2, 3].map(index => (
                  <span 
                    key={index} 
                    style={{
                      display: 'block',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: index < pin.length ? 'var(--accent-color)' : 'rgba(255,255,255,0.1)',
                      boxShadow: index < pin.length ? '0 0 8px var(--accent-color)' : 'none',
                      transition: 'var(--transition-smooth)'
                    }}
                  ></span>
                ))}
              </div>
              {pinError && (
                <span style={{ color: 'var(--danger-color)', fontSize: '0.8rem', marginTop: '8px', fontWeight: 500 }}>
                  {pinError}
                </span>
              )}
            </div>

            {/* Numeric Key Pad */}
            <div className="pin-pad">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
                <button key={num} className="pin-key" onClick={() => handlePinKeyPress(num.toString())}>
                  {num}
                </button>
              ))}
              <button className="pin-key" onClick={handleClear} style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Clear
              </button>
              <button className="pin-key" onClick={() => handlePinKeyPress('0')}>
                0
              </button>
              <button className="pin-key" onClick={handleBackspace} style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Delete size={20} />
              </button>
            </div>

            {/* Punch Buttons */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button 
                className="btn-primary" 
                style={{ flex: 1, justifyContent: 'center', background: 'linear-gradient(135deg, #10b981, #059669)', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)' }}
                onClick={() => handleClockAction('in')}
                disabled={pin.length < 4}
              >
                <LogIn size={18} />
                Time In
              </button>
              <button 
                className="btn-primary" 
                style={{ flex: 1, justifyContent: 'center', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)' }}
                onClick={() => handleClockAction('out')}
                disabled={pin.length < 4}
              >
                <LogOut size={18} />
                Time Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
