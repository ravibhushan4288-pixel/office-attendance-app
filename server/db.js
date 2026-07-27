const fs = require('fs');
const path = require('path');

// Check if running inside a compiled executable
const isPackaged = typeof process.pkg !== 'undefined' || !path.basename(process.execPath).toLowerCase().startsWith('node');
const baseDir = isPackaged ? path.dirname(process.execPath) : path.join(__dirname, '..');

const DB_DIR = path.join(baseDir, 'data');
const DB_FILE = path.join(DB_DIR, 'attendance_db.json');

// Memory storage for throttled pings: { employeeId: lastPingTimestamp }
const lastPingMemory = {};

function initDb() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    const defaultData = {
      employees: [
        { id: 'emp_1', name: 'Alice Smith', pin: '1111', designation: 'Senior Developer', dateCreated: new Date().toISOString() },
        { id: 'emp_2', name: 'Bob Johnson', pin: '2222', designation: 'UI/UX Designer', dateCreated: new Date().toISOString() },
        { id: 'emp_3', name: 'Charlie Davis', pin: '3333', designation: 'Marketing Lead', dateCreated: new Date().toISOString() },
        { id: 'emp_4', name: 'Diana Prince', pin: '4444', designation: 'Office Administrator', dateCreated: new Date().toISOString() },
        { id: 'emp_5', name: 'Evan Wright', pin: '5555', designation: 'Support Analyst', dateCreated: new Date().toISOString() }
      ],
      attendance: [],
      screenTime: {},
      adminSettings: {
        adminPin: '9999' // Default admin PIN
      }
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
  }
}

function readData() {
  initDb();
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database file, returning empty state:', err);
    return { employees: [], attendance: [], screenTime: {}, adminSettings: { adminPin: '9999' } };
  }
}

function writeData(data) {
  try {
    // Write to a temporary file first, then rename, to avoid corruption if the server crashes
    const tempFile = DB_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
    return true;
  } catch (err) {
    console.error('Error writing database:', err);
    return false;
  }
}

// Get standard date string in YYYY-MM-DD
function getLocalDateString(dateObj = new Date()) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Get standard time string in HH:MM:SS
function getLocalTimeString(dateObj = new Date()) {
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  const seconds = String(dateObj.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

const db = {
  getEmployees: () => {
    return readData().employees;
  },

  addEmployee: (name, pin, designation, deviceId) => {
    const data = readData();
    const newEmp = {
      id: 'emp_' + Date.now(),
      name,
      pin: pin || '1234',
      designation: designation || 'Employee',
      deviceId: deviceId || '',
      dateCreated: new Date().toISOString()
    };
    data.employees.push(newEmp);
    writeData(data);
    return newEmp;
  },

  updateEmployee: (id, updates) => {
    const data = readData();
    const idx = data.employees.findIndex(e => e.id === id);
    if (idx === -1) return null;
    
    data.employees[idx] = { ...data.employees[idx], ...updates };
    writeData(data);
    return data.employees[idx];
  },

  deleteEmployee: (id) => {
    const data = readData();
    data.employees = data.employees.filter(e => e.id !== id);
    // clean up attendance if needed or leave it as historical records
    writeData(data);
    return true;
  },

  verifyEmployeePin: (employeeId, pin) => {
    const data = readData();
    const emp = data.employees.find(e => e.id === employeeId);
    return emp && emp.pin === pin;
  },

  verifyAdminPin: (pin) => {
    const data = readData();
    return data.adminSettings.adminPin === pin;
  },

  setAdminPin: (newPin) => {
    const data = readData();
    data.adminSettings.adminPin = newPin;
    return writeData(data);
  },

  getAttendanceByDate: (dateStr) => {
    const data = readData();
    return data.attendance.filter(a => a.date === dateStr);
  },

  getAttendanceRange: (startDateStr, endDateStr) => {
    const data = readData();
    return data.attendance.filter(a => a.date >= startDateStr && a.date <= endDateStr);
  },

  clockIn: (employeeId) => {
    const data = readData();
    const today = getLocalDateString();
    const time = getLocalTimeString();

    // Check if already clocked in today
    let record = data.attendance.find(a => a.employeeId === employeeId && a.date === today);

    if (record) {
      if (record.clockIn) {
        return { success: false, message: 'Already clocked in today at ' + record.clockIn };
      }
      record.clockIn = time;
      record.status = 'Present';
    } else {
      record = {
        employeeId,
        date: today,
        clockIn: time,
        clockOut: null,
        status: 'Present',
        type: 'Auto',
        notes: ''
      };
      data.attendance.push(record);
    }

    writeData(data);
    return { success: true, record };
  },

  clockOut: (employeeId) => {
    const data = readData();
    const today = getLocalDateString();
    const time = getLocalTimeString();

    // Check if clocked in today
    let record = data.attendance.find(a => a.employeeId === employeeId && a.date === today);

    if (!record) {
      // Allow clock out even if they forgot to clock in (status defaults to Present, with null clockIn)
      record = {
        employeeId,
        date: today,
        clockIn: null,
        clockOut: time,
        status: 'Present',
        type: 'Auto',
        notes: 'Forgot Clock In'
      };
      data.attendance.push(record);
    } else {
      record.clockOut = time;
    }

    writeData(data);
    return { success: true, record };
  },

  // Record a screen-active ping (usually sent every 5 minutes by client script)
  recordScreenPing: (employeeId, appUsage) => {
    const data = readData();
    const today = getLocalDateString();
    const now = Date.now();

    // Throttle active minutes updates (max once per 3 minutes)
    const lastPing = lastPingMemory[employeeId];
    let timeLogged = false;
    if (!lastPing || (now - lastPing) >= 3 * 60 * 1000) {
      lastPingMemory[employeeId] = now;
      if (!data.screenTime) data.screenTime = {};
      if (!data.screenTime[employeeId]) data.screenTime[employeeId] = {};
      const currentMins = data.screenTime[employeeId][today] || 0;
      data.screenTime[employeeId][today] = currentMins + 5;
      timeLogged = true;
    }

    // Process and merge app usage (seconds spent per app)
    if (appUsage && typeof appUsage === 'object') {
      if (!data.appUsage) data.appUsage = {};
      if (!data.appUsage[employeeId]) data.appUsage[employeeId] = {};
      if (!data.appUsage[employeeId][today]) data.appUsage[employeeId][today] = {};

      for (const [appName, seconds] of Object.entries(appUsage)) {
        const cleanName = appName.replace(/[^a-zA-Z0-9_\- ]/g, '').substring(0, 50);
        if (cleanName && typeof seconds === 'number') {
          const currentSecs = data.appUsage[employeeId][today][cleanName] || 0;
          data.appUsage[employeeId][today][cleanName] = currentSecs + seconds;
        }
      }
    }

    writeData(data);
    const activeMinutes = (data.screenTime && data.screenTime[employeeId] && data.screenTime[employeeId][today]) || 0;
    return { success: true, activeMinutes };
  },

  getScreenTimeRange: (startDateStr, endDateStr) => {
    const data = readData();
    return data.screenTime || {};
  },

  getAppUsageRange: (startDateStr, endDateStr) => {
    const data = readData();
    return data.appUsage || {};
  },

  // Admin Override
  adminSetAttendance: (employeeId, dateStr, status, clockIn, clockOut, notes) => {
    const data = readData();
    let recordIdx = data.attendance.findIndex(a => a.employeeId === employeeId && a.date === dateStr);

    const record = {
      employeeId,
      date: dateStr,
      clockIn: clockIn || null,
      clockOut: clockOut || null,
      status: status || 'Present',
      type: 'Manual',
      notes: notes || ''
    };

    if (recordIdx !== -1) {
      data.attendance[recordIdx] = record;
    } else {
      data.attendance.push(record);
    }

    writeData(data);
    return record;
  }
};

module.exports = db;
