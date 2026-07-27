import React, { useState, useEffect } from 'react';
import { 
  Users, Calendar, FileText, Settings, Plus, Trash2, Edit2, 
  Download, CheckCircle, Clock, AlertTriangle, Moon, ShieldCheck, ChevronRight
} from 'lucide-react';

export default function AdminDashboard({ adminPin, showNotification }) {
  const [activeTab, setActiveTab] = useState('live'); // 'live' | 'history' | 'employees' | 'settings'
  
  // Data states
  const [employees, setEmployees] = useState([]);
  const [todayAttendance, setTodayAttendance] = useState([]);
  const [reportData, setReportData] = useState({ employees: [], attendance: [], screenTime: {} });
  
  // Filter states
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv');
  });
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString('sv'));
  
  // Modals state
  const [showAddEmpModal, setShowAddEmpModal] = useState(false);
  const [newEmpName, setNewEmpName] = useState('');
  const [newEmpDesignation, setNewEmpDesignation] = useState('');
  const [newEmpPin, setNewEmpPin] = useState('');
  
  const [showEditEmpModal, setShowEditEmpModal] = useState(false);
  const [editingEmp, setEditingEmp] = useState(null);
  const [editEmpName, setEditEmpName] = useState('');
  const [editEmpDesignation, setEditEmpDesignation] = useState('');
  const [editEmpPin, setEditEmpPin] = useState('');

  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideData, setOverrideData] = useState({
    employeeId: '',
    employeeName: '',
    date: '',
    status: 'Present',
    clockIn: '',
    clockOut: '',
    notes: ''
  });

  // Settings state
  const [currentAdminPin, setCurrentAdminPin] = useState('');
  const [newAdminPin, setNewAdminPin] = useState('');

  // Initial loads
  const loadEmployees = async () => {
    try {
      const res = await fetch('/api/employees');
      const data = await res.json();
      setEmployees(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadTodayAttendance = async () => {
    try {
      const res = await fetch('/api/attendance/today');
      const data = await res.json();
      setTodayAttendance(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadReport = async () => {
    try {
      const res = await fetch(`/api/attendance-report?start=${startDate}&end=${endDate}&adminPin=${adminPin}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadEmployees();
    loadTodayAttendance();
    loadReport();
  }, [adminPin]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadReport();
    } else if (activeTab === 'live') {
      loadTodayAttendance();
      loadEmployees();
    }
  }, [activeTab, startDate, endDate]);

  // Calculations helper for shift duration
  const getDuration = (clockIn, clockOut) => {
    if (!clockIn) return '-';
    const [inH, inM, inS] = clockIn.split(':').map(Number);
    const outTime = clockOut ? clockOut.split(':').map(Number) : null;
    
    let end = new Date();
    if (outTime) {
      end.setHours(outTime[0], outTime[1], outTime[2] || 0);
    }
    
    let start = new Date();
    start.setHours(inH, inM, inS || 0);
    
    let diffMs = end - start;
    if (diffMs < 0) diffMs = 0; // Prevent negative calculations if system clocks differ
    
    const hrs = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hrs}h ${mins}m`;
  };

  // 1. Employee Actions
  const handleAddEmployee = async (e) => {
    e.preventDefault();
    if (!newEmpName || !newEmpPin || newEmpPin.length < 4) {
      alert('Please fill out Name and enter a 4-digit PIN');
      return;
    }

    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newEmpName,
          pin: newEmpPin,
          designation: newEmpDesignation,
          adminPin
        })
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Registered ${newEmpName} successfully`, 'success');
        setShowAddEmpModal(false);
        setNewEmpName('');
        setNewEmpDesignation('');
        setNewEmpPin('');
        loadEmployees();
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Error registering employee');
    }
  };

  const handleEditEmpClick = (emp) => {
    setEditingEmp(emp);
    setEditEmpName(emp.name);
    setEditEmpDesignation(emp.designation);
    setEditEmpPin(''); // blank PIN implies unchanged
    setShowEditEmpModal(true);
  };

  const handleEditEmployeeSubmit = async (e) => {
    e.preventDefault();
    try {
      const body = {
        name: editEmpName,
        designation: editEmpDesignation,
        adminPin
      };
      if (editEmpPin) {
        body.pin = editEmpPin;
      }

      const res = await fetch(`/api/employees/${editingEmp.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Updated employee ${editEmpName}`, 'success');
        setShowEditEmpModal(false);
        loadEmployees();
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Error updating employee');
    }
  };

  const handleDeleteEmployee = async (empId, name) => {
    if (!confirm(`Are you sure you want to delete ${name}? This will remove them from the active employee registry.`)) return;

    try {
      const res = await fetch(`/api/employees/${empId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin })
      });
      const data = await res.json();
      if (data.success) {
        showNotification(`Deleted employee ${name}`, 'success');
        loadEmployees();
      }
    } catch (err) {
      alert('Error deleting employee');
    }
  };

  // 2. Attendance Override Actions
  const handleOpenOverride = (empId, empName, dateStr = new Date().toLocaleDateString('sv')) => {
    const existing = todayAttendance.find(a => a.employeeId === empId && a.date === dateStr) || 
                     reportData.attendance.find(a => a.employeeId === empId && a.date === dateStr);
    
    setOverrideData({
      employeeId: empId,
      employeeName: empName,
      date: dateStr,
      status: existing ? existing.status : 'Present',
      clockIn: existing ? (existing.clockIn || '') : '09:00:00',
      clockOut: existing ? (existing.clockOut || '') : '18:00:00',
      notes: existing ? (existing.notes || '') : ''
    });
    setShowOverrideModal(true);
  };

  const handleOverrideSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/attendance/admin-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: overrideData.employeeId,
          date: overrideData.date,
          status: overrideData.status,
          clockIn: overrideData.status === 'Leave' || overrideData.status === 'Absent' ? null : overrideData.clockIn,
          clockOut: overrideData.status === 'Leave' || overrideData.status === 'Absent' ? null : overrideData.clockOut,
          notes: overrideData.notes,
          adminPin
        })
      });
      const data = await res.json();
      if (data.success) {
        showNotification('Attendance log updated successfully', 'success');
        setShowOverrideModal(false);
        loadTodayAttendance();
        loadReport();
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Error overrides');
    }
  };

  // 3. Update Admin Credentials
  const handleAdminPinChangeSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/set-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin: currentAdminPin, newPin: newAdminPin })
      });
      const data = await res.json();
      if (data.success) {
        showNotification('Admin PIN updated. Use your new PIN next time.', 'success');
        setCurrentAdminPin('');
        setNewAdminPin('');
      } else {
        alert(data.message);
      }
    } catch (err) {
      alert('Error updating credentials');
    }
  };

  // 4. Report CSV exporter
  const handleExportCSV = () => {
    const { employees: reportEmps, attendance: reportAtt, screenTime: reportSt } = reportData;
    
    // Generate dates range array
    const start = new Date(startDate);
    const end = new Date(endDate);
    const dateArray = [];
    let current = new Date(start);
    while (current <= end) {
      dateArray.push(current.toLocaleDateString('sv'));
      current.setDate(current.getDate() + 1);
    }

    // CSV header: Employee Details + each date status + total metrics
    let csvContent = 'Employee ID,Name,Designation';
    dateArray.forEach(d => {
      csvContent += `,${d} (Status),${d} (Hours Worked),${d} (Screen-On Mins)`;
    });
    csvContent += ',Total Present Days,Total Half Days,Total Leaves,Total Active Screen Hours\n';

    reportEmps.forEach(emp => {
      let row = `"${emp.id}","${emp.name}","${emp.designation}"`;
      
      let presentCount = 0;
      let halfCount = 0;
      let leaveCount = 0;
      let totalMins = 0;

      dateArray.forEach(d => {
        const record = reportAtt.find(a => a.employeeId === emp.id && a.date === d);
        const mins = (reportSt[emp.id] && reportSt[emp.id][d]) || 0;
        totalMins += mins;

        if (record) {
          row += `,"${record.status}"`;
          row += `,"${record.clockIn ? getDuration(record.clockIn, record.clockOut) : '-'}"`;
          
          if (record.status === 'Present') presentCount++;
          else if (record.status === 'Half Day') halfCount++;
          else if (record.status === 'Leave') leaveCount++;
        } else {
          row += ',"Absent","-"';
        }
        row += `,"${mins} mins"`;
      });

      const screenHours = (totalMins / 60).toFixed(1);
      row += `,${presentCount},${halfCount},${leaveCount},${screenHours}\n`;
      csvContent += row;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Attendance_Report_${startDate}_to_${endDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper to construct a comma-separated list of top applications used
  const getAppUsageText = (employeeId, dateStr) => {
    const dayApps = reportData.appUsage && reportData.appUsage[employeeId] && reportData.appUsage[employeeId][dateStr];
    if (!dayApps) return '';
    
    // Sort apps by duration descending
    const sortedApps = Object.entries(dayApps)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4); // top 4 apps
      
    if (sortedApps.length === 0) return '';
    
    return sortedApps.map(([app, secs]) => {
      const mins = Math.round(secs / 60);
      if (mins < 1) return null;
      return `${app} (${mins}m)`;
    }).filter(Boolean).join(', ');
  };

  // 4b. Flat Report CSV exporter (Flat list of logs)
  const handleExportFlatCSV = (isTodayOnly = false) => {
    const dataToExport = isTodayOnly ? todayAttendance : reportData.attendance;
    const emps = isTodayOnly ? employees : reportData.employees;
    const st = isTodayOnly ? reportData.screenTime : reportData.screenTime;

    let csvContent = 'Date,Employee ID,Name,Designation,Status,Clock In,Clock Out,Shift duration,Screen-On Time,Apps Used,Notes\n';
    
    // Sort by date descending
    const sorted = [...dataToExport].sort((a, b) => b.date.localeCompare(a.date));
    
    if (isTodayOnly) {
      const todayStr = new Date().toLocaleDateString('sv');
      emps.forEach(emp => {
        const record = sorted.find(a => a.employeeId === emp.id);
        const screenMins = (st[emp.id] && st[emp.id][todayStr]) || 0;
        const hours = Math.floor(screenMins / 60);
        const mins = screenMins % 60;
        const screenTimeStr = `${hours}h ${mins}m`;
        
        const appText = getAppUsageText(emp.id, todayStr);
        if (record) {
          const duration = record.clockIn ? getDuration(record.clockIn, record.clockOut) : '-';
          csvContent += `"${todayStr}","${emp.id}","${emp.name}","${emp.designation}","${record.status}","${record.clockIn || '-'}","${record.clockOut || '-'}","${duration}","${screenTimeStr}","${appText}","${record.notes || ''}"\n`;
        } else {
          csvContent += `"${todayStr}","${emp.id}","${emp.name}","${emp.designation}","Absent","-","-","-","${screenTimeStr}","${appText}",""\n`;
        }
      });
    } else {
      sorted.forEach(att => {
        const emp = emps.find(e => e.id === att.employeeId);
        const name = emp ? emp.name : 'Unknown';
        const des = emp ? emp.designation : '';
        const screenMins = (st[att.employeeId] && st[att.employeeId][att.date]) || 0;
        const hours = Math.floor(screenMins / 60);
        const mins = screenMins % 60;
        const screenTimeStr = `${hours}h ${mins}m`;
        const duration = att.clockIn ? getDuration(att.clockIn, att.clockOut) : '-';
        const appText = getAppUsageText(att.employeeId, att.date);
        
        csvContent += `"${att.date}","${att.employeeId}","${name}","${des}","${att.status}","${att.clockIn || '-'}","${att.clockOut || '-'}","${duration}","${screenTimeStr}","${appText}","${att.notes || ''}"\n`;
      });
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const filename = isTodayOnly 
      ? `Attendance_Today_${new Date().toLocaleDateString('sv')}.csv` 
      : `Attendance_Detailed_Report_${startDate}_to_${endDate}.csv`;
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper for computing today's overview stats
  const getTodayStats = () => {
    let checkedIn = 0;
    let onLeave = 0;
    let activePings = 0;

    employees.forEach(emp => {
      const record = todayAttendance.find(a => a.employeeId === emp.id);
      if (record) {
        if (record.status === 'Present') checkedIn++;
        else if (record.status === 'Half Day') checkedIn++;
        else if (record.status === 'Leave') onLeave++;
      }
      
      // Calculate active screens (if they clocked in today and had at least one screen ping today)
      const reportDataTodaySt = reportData.screenTime && reportData.screenTime[emp.id];
      const todayStr = new Date().toLocaleDateString('sv');
      if (reportDataTodaySt && reportDataTodaySt[todayStr] > 0) {
        activePings++;
      }
    });

    return { checkedIn, onLeave, activePings };
  };

  const todayStats = getTodayStats();

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
      {/* Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800 }}>Admin Control Panel</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Review attendance, manage employees, and export reports</p>
        </div>
        
        {/* Navigation Tabs */}
        <div className="glass-panel" style={{ display: 'flex', padding: '4px', gap: '4px', borderRadius: 'var(--border-radius-md)' }}>
          <button 
            className="btn-secondary" 
            onClick={() => setActiveTab('live')}
            style={{ 
              background: activeTab === 'live' ? 'var(--accent-color)' : 'transparent',
              borderColor: activeTab === 'live' ? 'var(--accent-color)' : 'transparent',
              color: activeTab === 'live' ? 'white' : 'var(--text-secondary)',
              padding: '8px 16px',
              fontSize: '0.85rem'
            }}
          >
            <Clock size={15} style={{ marginRight: '6px' }} />
            Today's Log
          </button>
          <button 
            className="btn-secondary" 
            onClick={() => setActiveTab('history')}
            style={{ 
              background: activeTab === 'history' ? 'var(--accent-color)' : 'transparent',
              borderColor: activeTab === 'history' ? 'var(--accent-color)' : 'transparent',
              color: activeTab === 'history' ? 'white' : 'var(--text-secondary)',
              padding: '8px 16px',
              fontSize: '0.85rem'
            }}
          >
            <Calendar size={15} style={{ marginRight: '6px' }} />
            History Reports
          </button>
          <button 
            className="btn-secondary" 
            onClick={() => setActiveTab('employees')}
            style={{ 
              background: activeTab === 'employees' ? 'var(--accent-color)' : 'transparent',
              borderColor: activeTab === 'employees' ? 'var(--accent-color)' : 'transparent',
              color: activeTab === 'employees' ? 'white' : 'var(--text-secondary)',
              padding: '8px 16px',
              fontSize: '0.85rem'
            }}
          >
            <Users size={15} style={{ marginRight: '6px' }} />
            Employees Registry
          </button>
          <button 
            className="btn-secondary" 
            onClick={() => setActiveTab('settings')}
            style={{ 
              background: activeTab === 'settings' ? 'var(--accent-color)' : 'transparent',
              borderColor: activeTab === 'settings' ? 'var(--accent-color)' : 'transparent',
              color: activeTab === 'settings' ? 'white' : 'var(--text-secondary)',
              padding: '8px 16px',
              fontSize: '0.85rem'
            }}
          >
            <Settings size={15} style={{ marginRight: '6px' }} />
            Settings
          </button>
        </div>
      </div>

      {/* Overview Stats Dashboard cards */}
      {activeTab === 'live' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ padding: '12px', background: 'var(--success-glow)', color: 'var(--success-color)', borderRadius: '12px' }}>
              <CheckCircle size={28} />
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Checked In Today</span>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 800 }}>{todayStats.checkedIn} / {employees.length}</h3>
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ padding: '12px', background: 'var(--danger-glow)', color: 'var(--danger-color)', borderRadius: '12px' }}>
              <Moon size={28} />
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>On Leave</span>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 800 }}>{todayStats.onLeave}</h3>
            </div>
          </div>
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ padding: '12px', background: 'var(--accent-glow)', color: 'var(--accent-color)', borderRadius: '12px' }}>
              <ShieldCheck size={28} />
            </div>
            <div>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Active Employee Laptops</span>
              <h3 style={{ fontSize: '1.75rem', fontWeight: 800 }}>{todayStats.activePings}</h3>
            </div>
          </div>
        </div>
      )}

      {/* Content Container */}
      <div className="glass-panel" style={{ padding: '30px' }}>
        
        {/* Tab 1: Live Log */}
        {activeTab === 'live' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Today's Live Attendance - {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</h3>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button className="btn-primary" onClick={() => handleExportFlatCSV(true)} style={{ padding: '8px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Download size={14} />
                  Download Today's Excel/CSV
                </button>
                <button className="btn-secondary" onClick={() => { loadTodayAttendance(); loadEmployees(); loadReport(); showNotification('Logs refreshed', 'info'); }}>
                  Refresh List
                </button>
              </div>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee</th>
                    <th>Designation</th>
                    <th>Status</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>Shift duration</th>
                    <th>Laptop Screen-On Time</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => {
                    const record = todayAttendance.find(a => a.employeeId === emp.id);
                    const todayStr = new Date().toLocaleDateString('sv');
                    // Find active pings screen time
                    const screenMins = (reportData.screenTime[emp.id] && reportData.screenTime[emp.id][todayStr]) || 0;
                    const hours = Math.floor(screenMins / 60);
                    const mins = screenMins % 60;
                    
                    let statusBadge = <span className="badge badge-absent">Absent / Not In</span>;
                    if (record) {
                      if (record.status === 'Present') statusBadge = <span className="badge badge-present">Present</span>;
                      else if (record.status === 'Half Day') statusBadge = <span className="badge badge-halfday">Half Day</span>;
                      else if (record.status === 'Leave') statusBadge = <span className="badge badge-leave">Leave: {record.notes || 'Vacation'}</span>;
                    }

                    return (
                      <tr key={emp.id}>
                        <td style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{todayStr}</td>
                        <td style={{ fontWeight: 600 }}>{emp.name}</td>
                        <td style={{ color: 'var(--text-secondary)' }}>{emp.designation}</td>
                        <td>{statusBadge}</td>
                        <td style={{ fontFamily: 'monospace' }}>{record?.clockIn || '-'}</td>
                        <td style={{ fontFamily: 'monospace' }}>{record?.clockOut || '-'}</td>
                        <td style={{ fontWeight: 500 }}>
                          {record?.clockIn ? getDuration(record.clockIn, record.clockOut) : '-'}
                        </td>
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <span style={{ 
                              color: screenMins > 0 ? 'var(--success-color)' : 'var(--text-muted)',
                              fontWeight: 600,
                              background: screenMins > 0 ? 'var(--success-glow)' : 'transparent',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              alignSelf: 'flex-start'
                            }}>
                              {hours}h {mins}m
                            </span>
                            {screenMins > 0 && (() => {
                              const apps = getAppUsageText(emp.id, todayStr);
                              return apps ? (
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={apps}>
                                  💻 {apps}
                                </div>
                              ) : null;
                            })()}
                          </div>
                        </td>
                        <td>
                          <button 
                            className="btn-icon" 
                            title="Manual override today's log"
                            onClick={() => handleOpenOverride(emp.id, emp.name, todayStr)}
                          >
                            <Edit2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 2: History & Logs */}
        {activeTab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Custom Date Range Logs</h3>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>From</label>
                  <input type="date" className="form-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ padding: '8px 12px' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>To</label>
                  <input type="date" className="form-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ padding: '8px 12px' }} />
                </div>
                <button className="btn-primary" onClick={handleExportCSV} style={{ padding: '10px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Download size={15} />
                  Download Summary Matrix
                </button>
                <button className="btn-primary" onClick={() => handleExportFlatCSV(false)} style={{ padding: '10px 14px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--success-color)', borderColor: 'var(--success-color)' }}>
                  <Download size={15} />
                  Download Detailed Log (Rows)
                </button>
              </div>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employee Name</th>
                    <th>Status</th>
                    <th>Clock In</th>
                    <th>Clock Out</th>
                    <th>Shift Time</th>
                    <th>Screen-On Tracker</th>
                    <th>Adjustment Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.attendance.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                        No records logged in this range. Select another date range.
                      </td>
                    </tr>
                  ) : (
                    reportData.attendance
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((att, idx) => {
                        const emp = reportData.employees.find(e => e.id === att.employeeId);
                        const empName = emp ? emp.name : 'Unknown';
                        
                        const screenMins = (reportData.screenTime[att.employeeId] && reportData.screenTime[att.employeeId][att.date]) || 0;
                        const hours = Math.floor(screenMins / 60);
                        const mins = screenMins % 60;

                        let badge = <span className="badge badge-absent">Absent</span>;
                        if (att.status === 'Present') badge = <span className="badge badge-present">Present</span>;
                        else if (att.status === 'Half Day') badge = <span className="badge badge-halfday">Half Day</span>;
                        else if (att.status === 'Leave') badge = <span className="badge badge-leave">Leave</span>;

                        return (
                          <tr key={idx}>
                            <td style={{ fontWeight: 600 }}>{att.date}</td>
                            <td>{empName}</td>
                            <td>{badge}</td>
                            <td style={{ fontFamily: 'monospace' }}>{att.clockIn || '-'}</td>
                            <td style={{ fontFamily: 'monospace' }}>{att.clockOut || '-'}</td>
                            <td>{att.clockIn ? getDuration(att.clockIn, att.clockOut) : '-'}</td>
                            <td>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <span style={{ fontWeight: 600, color: screenMins > 0 ? 'var(--success-color)' : 'var(--text-muted)' }}>
                                  {hours}h {mins}m
                                </span>
                                {screenMins > 0 && (() => {
                                  const apps = getAppUsageText(att.employeeId, att.date);
                                  return apps ? (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={apps}>
                                      💻 {apps}
                                    </div>
                                  ) : null;
                                })()}
                              </div>
                            </td>
                            <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                              {att.notes || (att.type === 'Manual' ? 'Manual entry' : '')}
                            </td>
                            <td>
                              <button 
                                className="btn-icon" 
                                title="Adjust record"
                                onClick={() => handleOpenOverride(att.employeeId, empName, att.date)}
                              >
                                <Edit2 size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab 3: Employees Registry */}
        {activeTab === 'employees' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Registered Laptops & Employees ({employees.length})</h3>
              <button className="btn-primary" onClick={() => setShowAddEmpModal(true)}>
                <Plus size={16} />
                Register New Employee
              </button>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Employee ID</th>
                    <th>Full Name</th>
                    <th>Designation</th>
                    <th>PIN (Security code)</th>
                    <th>Registry Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map(emp => (
                    <tr key={emp.id}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 600 }}>{emp.id}</td>
                      <td style={{ fontWeight: 600 }}>{emp.name}</td>
                      <td>{emp.designation}</td>
                      <td style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>•••• (Protected)</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        {new Date(emp.dateCreated).toLocaleDateString()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button className="btn-icon" title="Edit Employee Details" onClick={() => handleEditEmpClick(emp)}>
                            <Edit2 size={14} />
                          </button>
                          <button className="btn-icon" title="Delete Employee" onClick={() => handleDeleteEmployee(emp.id, emp.name)} style={{ color: 'var(--danger-color)' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ 
              background: 'rgba(99, 102, 241, 0.05)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              borderRadius: 'var(--border-radius-md)',
              padding: '20px',
              marginTop: '15px'
            }}>
              <h4 style={{ color: 'var(--accent-color)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <ShieldCheck size={18} />
                How to set up TimePilot Attendance Tracker:
              </h4>
              <ol style={{ paddingLeft: '20px', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: '1.6' }}>
                <li>Copy the file <strong><code>attendance-client.exe</code></strong> from the server folder onto the employee's laptop.</li>
                <li>Double-click the <strong><code>attendance-client.exe</code></strong> file on the laptop to run it.</li>
                <li>Click <strong>"New Employee? Register Here"</strong> at the bottom.</li>
                <li>Wait 3-5 seconds for the network to auto-detect the server, or type the network address shown on your admin window.</li>
                <li>Enter their Name, Designation, and a 4-digit PIN, then click **Register Self**. The app will automatically register for startup and run in the background.</li>
              </ol>
            </div>
          </div>
        )}

        {/* Tab 4: Settings */}
        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '400px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Security Settings</h3>
            
            <form onSubmit={handleAdminPinChangeSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div className="form-group">
                <label>Current Admin PIN</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={currentAdminPin} 
                  onChange={(e) => setCurrentAdminPin(e.target.value)} 
                  placeholder="••••" 
                  maxLength={10} 
                />
              </div>
              <div className="form-group">
                <label>New Admin PIN</label>
                <input 
                  type="password" 
                  className="form-input" 
                  value={newAdminPin} 
                  onChange={(e) => setNewAdminPin(e.target.value)} 
                  placeholder="Enter new 4+ digit PIN" 
                  maxLength={10} 
                />
              </div>
              <button type="submit" className="btn-primary" style={{ justifyContent: 'center' }}>
                Change Admin PIN
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Add Employee Modal */}
      {showAddEmpModal && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in">
            <h3 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Register New Employee</h3>
            <form onSubmit={handleAddEmployee}>
              <div className="form-group">
                <label>Full Name</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. John Doe"
                  value={newEmpName}
                  onChange={(e) => setNewEmpName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Designation / Department</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. Sales Associate"
                  value={newEmpDesignation}
                  onChange={(e) => setNewEmpDesignation(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Employee PIN (4-digit code they will punch with)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="e.g. 1234"
                  maxLength={4}
                  pattern="\d{4}"
                  value={newEmpPin}
                  onChange={(e) => setNewEmpPin(e.target.value)}
                  required
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowAddEmpModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Employee Modal */}
      {showEditEmpModal && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in">
            <h3 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>Edit Employee Details</h3>
            <form onSubmit={handleEditEmployeeSubmit}>
              <div className="form-group">
                <label>Full Name</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={editEmpName}
                  onChange={(e) => setEditEmpName(e.target.value)}
                  required
                />
              </div>
              <div className="form-group">
                <label>Designation / Department</label>
                <input 
                  type="text" 
                  className="form-input"
                  value={editEmpDesignation}
                  onChange={(e) => setEditEmpDesignation(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label>Reset PIN (Leave blank to keep current PIN)</label>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Enter new 4-digit PIN"
                  maxLength={4}
                  pattern="\d{4}"
                  value={editEmpPin}
                  onChange={(e) => setEditEmpPin(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '24px' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowEditEmpModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Override / Adjustments Modal */}
      {showOverrideModal && (
        <div className="modal-overlay">
          <div className="modal-content animate-fade-in" style={{ maxWidth: '440px' }}>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '15px' }}>Adjust Attendance Record</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
              Employee: <strong>{overrideData.employeeName}</strong><br />
              Date: <strong>{overrideData.date}</strong>
            </p>
            
            <form onSubmit={handleOverrideSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div className="form-group">
                <label>Work Status</label>
                <select 
                  className="form-input"
                  value={overrideData.status}
                  onChange={(e) => setOverrideData(prev => ({ ...prev, status: e.target.value }))}
                >
                  <option value="Present">Present</option>
                  <option value="Half Day">Half Day</option>
                  <option value="Leave">Leave</option>
                  <option value="Absent">Absent</option>
                </select>
              </div>

              {overrideData.status !== 'Leave' && overrideData.status !== 'Absent' && (
                <div style={{ display: 'flex', gap: '10px' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Clock In Time</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="HH:MM:SS"
                      value={overrideData.clockIn}
                      onChange={(e) => setOverrideData(prev => ({ ...prev, clockIn: e.target.value }))}
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Clock Out Time</label>
                    <input 
                      type="text" 
                      className="form-input" 
                      placeholder="HH:MM:SS"
                      value={overrideData.clockOut}
                      onChange={(e) => setOverrideData(prev => ({ ...prev, clockOut: e.target.value }))}
                    />
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Adjustment Notes (e.g. "Sick Leave approval", "Adjusted clock-out")</label>
                <textarea 
                  className="form-input" 
                  rows={3} 
                  value={overrideData.notes}
                  onChange={(e) => setOverrideData(prev => ({ ...prev, notes: e.target.value }))}
                  placeholder="Reason for adjustment..."
                  style={{ resize: 'none' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowOverrideModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
                  Apply Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
