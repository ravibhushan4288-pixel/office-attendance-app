const express = require('express');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS so the React dev server can talk to this server
app.use(cors());
app.use(express.json());

// Logger middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
  next();
});

// Helper to get local IP addresses
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

// 1. Employees Registry API
app.get('/api/employees', (req, res) => {
  // Return employees without PINs for basic lists
  const employees = db.getEmployees().map(({ pin, ...rest }) => rest);
  res.json(employees);
});

app.post('/api/employees/verify-pin', (req, res) => {
  const { employeeId, pin } = req.body;
  if (!employeeId || !pin) {
    return res.status(400).json({ success: false, message: 'Missing parameters' });
  }
  const isVerified = db.verifyEmployeePin(employeeId, pin);
  res.json({ success: isVerified });
});

// Register Employee directly from client (does NOT require Admin PIN)
app.post('/api/employees/register', (req, res) => {
  const { name, pin, designation, deviceId } = req.body;
  if (!name || !pin) {
    return res.status(400).json({ success: false, message: 'Name and PIN are required' });
  }

  if (deviceId) {
    const existing = db.getEmployees().find(e => e.deviceId === deviceId);
    if (existing) {
      return res.status(403).json({ success: false, message: `This laptop is already registered to ${existing.name}. Contact your admin to reset it.` });
    }
  }

  const newEmp = db.addEmployee(name, pin, designation || '', deviceId || '');
  res.json({ success: true, employee: newEmp });
});

// Add Employee (requires Admin PIN validation)
app.post('/api/employees', (req, res) => {
  const { name, pin, designation, adminPin } = req.body;
  if (!db.verifyAdminPin(adminPin)) {
    return res.status(403).json({ success: false, message: 'Invalid Admin PIN' });
  }
  if (!name || !pin) {
    return res.status(400).json({ success: false, message: 'Name and PIN are required' });
  }
  const newEmp = db.addEmployee(name, pin, designation);
  res.json({ success: true, employee: newEmp });
});

// Update Employee (requires Admin PIN validation)
app.put('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const { name, pin, designation, adminPin } = req.body;
  
  if (!db.verifyAdminPin(adminPin)) {
    return res.status(403).json({ success: false, message: 'Invalid Admin PIN' });
  }

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (pin !== undefined) updates.pin = pin;
  if (designation !== undefined) updates.designation = designation;

  const updated = db.updateEmployee(id, updates);
  if (!updated) {
    return res.status(404).json({ success: false, message: 'Employee not found' });
  }
  res.json({ success: true, employee: updated });
});

// Delete Employee (requires Admin PIN validation)
app.delete('/api/employees/:id', (req, res) => {
  const { id } = req.params;
  const { adminPin } = req.body;

  if (!db.verifyAdminPin(adminPin)) {
    return res.status(403).json({ success: false, message: 'Invalid Admin PIN' });
  }

  const success = db.deleteEmployee(id);
  res.json({ success });
});

// Verify Admin PIN
app.post('/api/admin/verify-pin', (req, res) => {
  const { pin } = req.body;
  const isVerified = db.verifyAdminPin(pin);
  res.json({ success: isVerified });
});

// Update Admin PIN
app.post('/api/admin/set-pin', (req, res) => {
  const { currentPin, newPin } = req.body;
  if (!db.verifyAdminPin(currentPin)) {
    return res.status(403).json({ success: false, message: 'Invalid current Admin PIN' });
  }
  if (!newPin || newPin.length < 4) {
    return res.status(400).json({ success: false, message: 'New PIN must be at least 4 digits' });
  }
  db.setAdminPin(newPin);
  res.json({ success: true, message: 'Admin PIN updated successfully' });
});

// Helper to get local date string YYYY-MM-DD
function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 2. Attendance Logging API
app.get('/api/attendance/today', (req, res) => {
  const todayStr = getTodayDateString();
  const attendance = db.getAttendanceByDate(todayStr);
  res.json(attendance);
});

app.get('/api/employee-status', (req, res) => {
  const { employeeId } = req.query;
  if (!employeeId) {
    return res.status(400).json({ success: false, message: 'Missing employeeId' });
  }

  // Verify employee exists on server registry
  const employees = db.getEmployees();
  const emp = employees.find(e => e.id === employeeId);
  if (!emp) {
    return res.status(404).json({ success: false, unregistered: true, message: 'Employee ID not found on server' });
  }

  const todayStr = getTodayDateString();
  const attendance = db.getAttendanceByDate(todayStr);
  const record = attendance.find(a => a.employeeId === employeeId);
  const screenTime = db.getScreenTimeRange(todayStr, todayStr);
  const activeMinutes = (screenTime[employeeId] && screenTime[employeeId][todayStr]) || 0;

  res.json({
    success: true,
    clockIn: record ? record.clockIn : null,
    clockOut: record ? record.clockOut : null,
    status: record ? record.status : 'Absent',
    activeMinutes
  });
});

app.post('/api/attendance/clock-in', (req, res) => {
  const { employeeId, pin } = req.body;
  if (!db.verifyEmployeePin(employeeId, pin)) {
    return res.status(401).json({ success: false, message: 'Incorrect PIN' });
  }
  const result = db.clockIn(employeeId);
  res.json(result);
});

app.post('/api/attendance/clock-out', (req, res) => {
  const { employeeId, pin } = req.body;
  if (!db.verifyEmployeePin(employeeId, pin)) {
    return res.status(401).json({ success: false, message: 'Incorrect PIN' });
  }
  const result = db.clockOut(employeeId);
  res.json(result);
});

// System-triggered clock out (does not require PIN validation, secure for shutdown actions)
app.post('/api/attendance/clock-out-system', (req, res) => {
  const { employeeId } = req.body;
  if (!employeeId) {
    return res.status(400).json({ success: false, message: 'Missing employeeId' });
  }
  const result = db.clockOut(employeeId);
  res.json(result);
});

// Get Attendance and Screen Time data
app.get('/api/attendance-report', (req, res) => {
  const { start, end, adminPin } = req.query;

  if (!db.verifyAdminPin(adminPin)) {
    return res.status(403).json({ error: 'Unauthorized: Invalid Admin PIN' });
  }

  if (!start || !end) {
    return res.status(400).json({ error: 'Missing start or end date' });
  }

  const attendance = db.getAttendanceRange(start, end);
  const screenTime = db.getScreenTimeRange(start, end);
  const appUsage = db.getAppUsageRange(start, end);
  const employees = db.getEmployees().map(({ pin, ...rest }) => rest);

  res.json({
    employees,
    attendance,
    screenTime,
    appUsage
  });
});

// Admin Override (Edit records directly)
app.post('/api/attendance/admin-override', (req, res) => {
  const { employeeId, date, status, clockIn, clockOut, notes, adminPin } = req.body;

  if (!db.verifyAdminPin(adminPin)) {
    return res.status(403).json({ success: false, message: 'Invalid Admin PIN' });
  }

  if (!employeeId || !date) {
    return res.status(400).json({ success: false, message: 'Employee ID and Date are required' });
  }

  const record = db.adminSetAttendance(employeeId, date, status, clockIn, clockOut, notes);
  res.json({ success: true, record });
});

// 3. Screen Tracking Ping (Accepts both GET query or POST body for convenience in shell scripts)
const handleScreenPing = (req, res) => {
  const employeeId = req.query.employeeId || req.body.employeeId;
  const appUsage = req.body.appUsage;
  if (!employeeId) {
    return res.status(400).json({ success: false, message: 'Missing employeeId' });
  }

  const result = db.recordScreenPing(employeeId, appUsage);
  if (result.success) {
    res.json({ success: true, activeMinutes: result.activeMinutes });
  } else {
    // Return 200 OK even if throttled to prevent script failures
    res.json({ success: true, message: result.message });
  }
};

app.post('/api/screen-ping', handleScreenPing);
app.get('/api/screen-ping', handleScreenPing); // Support GET for easier curl calls

// ----------------------------------------------------
// FRONTEND SERVING
// ----------------------------------------------------

// Serve static files from in-memory assets if packaged, otherwise from disk
let assets = {};
try {
  assets = require('./assets.cjs');
} catch (e) {
  // assets.cjs doesn't exist during dev mode
}

app.use((req, res, next) => {
  let urlPath = req.path.slice(1);
  if (!urlPath) urlPath = 'index.html';
  const asset = assets[urlPath];
  if (asset) {
    res.setHeader('Content-Type', asset.mime);
    res.send(Buffer.from(asset.content, 'base64'));
  } else {
    next();
  }
});

// Serve static files from the React frontend production build folder
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// Catch-all route to serve the React index.html for SPA client-side routing
app.get('*', (req, res) => {
  const asset = assets['index.html'];
  if (asset) {
    res.setHeader('Content-Type', asset.mime);
    res.send(Buffer.from(asset.content, 'base64'));
  } else {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send('Frontend has not been compiled yet. Please run "npm run build" in the project root directory.');
    }
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n======================================================');
  console.log(`🚀 IN-HOUSE ATTENDANCE SERVER STARTING`);
  console.log(`📅 Local Time: ${new Date().toLocaleString()}`);
  console.log('======================================================');
  console.log(`✔ Local access:   http://localhost:${PORT}`);
  console.log(`✔ Hostname link:  http://${os.hostname().toLowerCase()}:${PORT} (Recommended: This never changes!)`);
  
  const localIps = getLocalIpAddresses();
  if (localIps.length > 0) {
    console.log(`✔ Network IPs (Alternative links):`);
    localIps.forEach(ip => {
      console.log(`   👉 http://${ip}:${PORT}`);
    });
  } else {
    console.log(`⚠ No active local network IPs found. Ensure you are connected to Wi-Fi.`);
  }
  console.log('======================================================\n');

  // --- UDP Discovery Beacon ---
  // Broadcasts a beacon packet every 3 seconds so employee clients can auto-detect the server
  try {
    const dgram = require('dgram');
    const udpServer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const BEACON_PORT = 41234;
    const beacon = JSON.stringify({ service: 'TimePilot-Attendance', port: PORT, hostname: os.hostname() });

    udpServer.bind(() => {
      try { udpServer.setBroadcast(true); } catch(e) {}
      setInterval(() => {
        try {
          udpServer.send(beacon, 0, beacon.length, BEACON_PORT, '255.255.255.255');
        } catch(e) {}
      }, 3000);
      console.log(`📡 UDP Discovery Beacon active on port ${BEACON_PORT}`);
    });
  } catch(e) {
    console.log('⚠ UDP Discovery not available:', e.message);
  }
});
