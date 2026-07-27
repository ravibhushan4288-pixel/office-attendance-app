const { execSync } = require('child_process');
const { rcedit } = require('rcedit');
const path = require('path');
const fs = require('fs');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 1. Helper to determine Mime Types for in-memory assets
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    case '.json': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

// 2. Helper to pack assets directory recursively
function packAssets(dir, baseDir = dir) {
  const files = fs.readdirSync(dir);
  let assets = {};
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      Object.assign(assets, packAssets(fullPath, baseDir));
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      const content = fs.readFileSync(fullPath).toString('base64');
      const mime = getMimeType(fullPath);
      assets[relPath] = { mime, content };
    }
  }
  return assets;
}

async function build() {
  const nodeExePath = process.execPath;
  const cscPath = 'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe';

  console.log(`Using host Node.js runtime: ${nodeExePath}`);

  // Clean old EXEs to prevent run locks
  const oldExes = ['attendance-admin.exe', 'attendance-client.exe', 'server-backend.exe'];
  for (const f of oldExes) {
    if (fs.existsSync(path.join(__dirname, f))) {
      try {
        fs.unlinkSync(path.join(__dirname, f));
      } catch (err) {
        console.log(`Warning: Could not remove old file ${f} (is it running?): ${err.message}`);
      }
    }
  }

  console.log('\n--- 1. Building React Frontend (Vite) ---');
  execSync('npm run build', { stdio: 'inherit' });

  console.log('\n--- 2. Packing static frontend assets into memory ---');
  const distPath = path.join(__dirname, 'dist');
  const assets = packAssets(distPath);
  fs.writeFileSync(
    path.join(__dirname, 'server', 'assets.cjs'),
    `module.exports = ${JSON.stringify(assets, null, 2)};`,
    'utf-8'
  );
  console.log(`Packed ${Object.keys(assets).length} static files into server/assets.cjs`);

  console.log('\n--- 3. Bundling Express server using esbuild ---');
  if (!fs.existsSync(path.join(__dirname, 'dist-server'))) {
    fs.mkdirSync(path.join(__dirname, 'dist-server'));
  }
  execSync('npx esbuild server/server.js --bundle --platform=node --target=node18 --outfile=dist-server/server.js', { stdio: 'inherit' });

  console.log('\n--- 4. Stamping and Injecting server-backend.exe (SEA) ---');
  const backendExe = path.join(__dirname, 'server-backend.exe');
  fs.copyFileSync(nodeExePath, backendExe);
  fs.chmodSync(backendExe, 0o777); // Strip read-only
  
  console.log('Waiting 3 seconds for file locks to release...');
  await sleep(3000);

  // Edit PE resource header details for backend (so firewall names it properly)
  await rcedit(backendExe, {
    'version-string': {
      'FileDescription': 'iLumina Attendance Server Engine',
      'ProductName': 'iLumina Attendance Server',
      'CompanyName': 'iLumina Workforce',
      'LegalCopyright': 'Copyright \u00a9 2026 iLumina Workforce',
      'OriginalFilename': 'server-backend.exe'
    },
    'file-version': '1.0.0',
    'product-version': '1.0.0'
  });
  await sleep(1000);

  // SEA blob preparation
  const seaConfigAdmin = path.join(__dirname, 'sea-config-admin.json');
  const blobAdmin = path.join(__dirname, 'sea-prep-admin.blob');
  fs.writeFileSync(seaConfigAdmin, JSON.stringify({
    main: path.join(__dirname, 'dist-server', 'server.js'),
    output: blobAdmin
  }), 'utf-8');

  execSync(`node --experimental-sea-config "${seaConfigAdmin}"`, { stdio: 'inherit' });
  execSync(`npx postject "${backendExe}" NODE_SEA_BLOB "${blobAdmin}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`, { stdio: 'inherit' });

  console.log('\n--- 5. Compiling C# GUI wrappers via csc.exe ---');
  
  const netDir = 'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319';
  const wpfDir = path.join(netDir, 'WPF');
  
  const commonRefs = [
    path.join(wpfDir, 'PresentationCore.dll'),
    path.join(wpfDir, 'PresentationFramework.dll'),
    path.join(wpfDir, 'WindowsBase.dll'),
    path.join(netDir, 'System.Xaml.dll'),
    path.join(netDir, 'System.Windows.Forms.dll'),
    path.join(netDir, 'System.Drawing.dll')
  ].map(p => `/reference:"${p}"`).join(' ');

  // Compile Admin Launcher (attendance-admin.exe)
  console.log('Compiling attendance-admin.exe (WPF GUI Launcher)...');
  const adminSrc = path.join(__dirname, 'server', 'AdminApp.cs');
  const adminOut = path.join(__dirname, 'attendance-admin.exe');
  const iconPath = path.join(__dirname, 'app_icon.ico');
  const iconArg = fs.existsSync(iconPath) ? ` /win32icon:"${iconPath}"` : '';
  execSync(`"${cscPath}" /target:winexe /platform:anycpu /out:"${adminOut}" ${commonRefs}${iconArg} "${adminSrc}"`, { stdio: 'inherit' });

  // Compile Client Application (attendance-client.exe)
  console.log('Compiling attendance-client.exe (WPF GUI Tracker)...');
  const clientSrc = path.join(__dirname, 'client', 'ClientApp.cs');
  const clientOut = path.join(__dirname, 'attendance-client.exe');
  const clientRefs = `${commonRefs} /reference:"${path.join(netDir, 'System.Net.Http.dll')}"`;
  execSync(`"${cscPath}" /target:winexe /platform:anycpu /out:"${clientOut}" ${clientRefs}${iconArg} "${clientSrc}"`, { stdio: 'inherit' });

  // Stamp launchers metadata
  console.log('Stamping C# launcher metadata...');
  await sleep(3000);
  
  await rcedit(adminOut, {
    'version-string': {
      'FileDescription': 'iLumina Attendance Server Manager',
      'ProductName': 'iLumina Server Launcher',
      'CompanyName': 'iLumina Workforce',
      'LegalCopyright': 'Copyright \u00a9 2026 iLumina Workforce'
    }
  });

  await rcedit(clientOut, {
    'version-string': {
      'FileDescription': 'iLumina Attendance Activity Portal',
      'ProductName': 'iLumina Attendance Client',
      'CompanyName': 'iLumina Workforce',
      'LegalCopyright': 'Copyright \u00a9 2026 iLumina Workforce'
    }
  });

  console.log('\n--- 6. Cleaning up compiler artifacts ---');
  try {
    fs.unlinkSync(seaConfigAdmin);
    fs.unlinkSync(blobAdmin);
    fs.unlinkSync(path.join(__dirname, 'server', 'assets.cjs'));
    fs.unlinkSync(path.join(__dirname, 'dist-server', 'server.js'));
    fs.rmdirSync(path.join(__dirname, 'dist-server'));
    console.log('Cleaned up compiler assets.');
  } catch (err) {
    console.log(`Warning during cleanup: ${err.message}`);
  }

  console.log('\n[+] GUI Desktop applications compiled successfully!');
}

build().catch(err => {
  console.error('\n[!] Build failed:', err);
  process.exit(1);
});
