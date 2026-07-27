using System;
using System.IO;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Forms;

namespace TimePilotAdmin
{
    public class App : System.Windows.Application
    {
        private static Mutex mutex = null;

        [STAThread]
        public static void Main()
        {
            bool createdNew;
            mutex = new Mutex(true, "TimePilotAttendanceAdmin_Mutex_Unique_982741", out createdNew);

            if (!createdNew)
            {
                IntPtr handle = GetExistingWindowHandle();
                if (handle != IntPtr.Zero)
                {
                    ShowWindow(handle, 9); // SW_RESTORE
                    SetForegroundWindow(handle);
                }
                else
                {
                    System.Windows.MessageBox.Show(
                        "TimePilot Attendance Server Manager is already running (check your system tray near the clock).", 
                        "Already Running", 
                        System.Windows.MessageBoxButton.OK, 
                        System.Windows.MessageBoxImage.Information
                    );
                }
                return;
            }

            App app = new App();
            app.Run(new MainWindow());
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private static IntPtr GetExistingWindowHandle()
        {
            Process current = Process.GetCurrentProcess();
            foreach (Process process in Process.GetProcessesByName(current.ProcessName))
            {
                if (process.Id != current.Id)
                {
                    return process.MainWindowHandle;
                }
            }
            return IntPtr.Zero;
        }
    }

    public class MainWindow : Window
    {
        private Process backendProcess;
        private string backendExeName = "server-backend.exe";
        
        // UI Controls
        private TextBlock lblStatus;
        private TextBlock lblLocalUrl;
        private TextBlock lblNetworkUrl;
        private System.Windows.Controls.Button btnLaunch;
        
        // System Tray
        private NotifyIcon trayIcon;
        private bool isExiting = false;

        public MainWindow()
        {
            InitializeWindow();
            InitializeTray();

            StartBackendServer();

            // Populate URLs
            lblLocalUrl.Text = "http://localhost:5000";
            lblNetworkUrl.Text = GetNetworkIpUrls();
        }

        private bool isDarkMode = false;

        private void ApplyThemeSettings()
        {
            if (isDarkMode)
            {
                Background = GetColor("#121214");
                Foreground = GetColor("#F3F4F6");
            }
            else
            {
                Background = GetColor("#F8FAFC");
                Foreground = GetColor("#0F172A");
            }
        }

        private SolidColorBrush GetThemeColor(string darkColor, string lightColor)
        {
            return GetColor(isDarkMode ? darkColor : lightColor);
        }

        private void AddThemeToggle(System.Windows.Controls.Panel container)
        {
            System.Windows.Controls.Button btnToggle = new System.Windows.Controls.Button
            {
                Content = isDarkMode ? "☀ Bright Theme" : "🌙 Dark Theme",
                Padding = new Thickness(8, 4, 8, 4),
                Background = GetThemeColor("#2A2A35", "#E2E8F0"),
                Foreground = GetThemeColor("#F3F4F6", "#0F172A"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                HorizontalAlignment = System.Windows.HorizontalAlignment.Right,
                Margin = new Thickness(0, 0, 0, 15),
                Cursor = System.Windows.Input.Cursors.Hand,
                BorderThickness = new Thickness(1),
                FontSize = 10,
                FontWeight = FontWeights.SemiBold
            };
            btnToggle.Click += (s, e) =>
            {
                isDarkMode = !isDarkMode;
                ApplyThemeSettings();
                InitializeWindow();
            };
            container.Children.Insert(0, btnToggle);
        }

        private void InitializeWindow()
        {
            Title = "TimePilot Attendance Server Manager";
            Width = 460;
            Height = 350;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ResizeMode = ResizeMode.CanMinimize;
            ApplyThemeSettings();
            FontFamily = new System.Windows.Media.FontFamily("Segoe UI");

            // Extract embedded Win32 EXE icon for WPF Window
            try
            {
                var sysIcon = System.Drawing.Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule.FileName);
                using (var ms = new System.IO.MemoryStream())
                {
                    sysIcon.Save(ms);
                    ms.Seek(0, System.IO.SeekOrigin.Begin);
                    Icon = System.Windows.Media.Imaging.BitmapFrame.Create(ms);
                }
            }
            catch {}

            StackPanel panel = new StackPanel { Margin = new Thickness(25) };

            // Title Header
            panel.Children.Add(new TextBlock
            {
                Text = "TimePilot Attendance Server",
                FontSize = 22,
                FontWeight = FontWeights.Bold,
                Margin = new Thickness(0, 0, 0, 15)
            });

            // Status Border
            Border statusBorder = new Border
            {
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(15),
                Margin = new Thickness(0, 0, 0, 20)
            };

            StackPanel statusStack = new StackPanel();

            // Active indicator
            Grid statusGrid = new Grid { Margin = new Thickness(0, 0, 0, 8) };
            statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            statusGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            
            statusGrid.Children.Add(new TextBlock { Text = "Server Status:", Foreground = GetThemeColor("#9CA3AF", "#475569") });
            
            string statusColor = "#6366F1";
            string currentStatusText = "Starting...";
            if (lblStatus != null)
            {
                currentStatusText = lblStatus.Text;
                if (currentStatusText == "Running (Online)") statusColor = "#10B981";
                else if (currentStatusText.StartsWith("Failed") || currentStatusText.StartsWith("Start Error")) statusColor = "#EF4444";
            }
            lblStatus = new TextBlock { Text = currentStatusText, Foreground = GetColor(statusColor), FontWeight = FontWeights.Bold, TextAlignment = TextAlignment.Right };
            Grid.SetColumn(lblStatus, 1);
            statusGrid.Children.Add(lblStatus);
            statusStack.Children.Add(statusGrid);

            // Local URL
            Grid localGrid = new Grid { Margin = new Thickness(0, 0, 0, 5) };
            localGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(130) });
            localGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            localGrid.Children.Add(new TextBlock { Text = "Local Dashboard link:", Foreground = GetThemeColor("#9CA3AF", "#475569") });
            lblLocalUrl = new TextBlock { Text = "http://localhost:5000", FontWeight = FontWeights.SemiBold, TextAlignment = TextAlignment.Right };
            Grid.SetColumn(lblLocalUrl, 1);
            localGrid.Children.Add(lblLocalUrl);
            statusStack.Children.Add(localGrid);

            // Network URL
            Grid netGrid = new Grid();
            netGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(130) });
            netGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            netGrid.Children.Add(new TextBlock { Text = "Employee Setup URL:", Foreground = GetThemeColor("#9CA3AF", "#475569") });
            
            string currentNetUrl = "Detecting IP...";
            if (lblNetworkUrl != null) currentNetUrl = lblNetworkUrl.Text;
            else currentNetUrl = GetNetworkIpUrls();
            
            lblNetworkUrl = new TextBlock { Text = currentNetUrl, FontWeight = FontWeights.SemiBold, TextAlignment = TextAlignment.Right, TextWrapping = TextWrapping.Wrap };
            Grid.SetColumn(lblNetworkUrl, 1);
            netGrid.Children.Add(lblNetworkUrl);
            statusStack.Children.Add(netGrid);

            statusBorder.Child = statusStack;
            panel.Children.Add(statusBorder);

            // Actions Buttons
            Grid btnGrid = new Grid();
            btnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            btnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            btnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            bool isLaunchEnabled = false;
            if (btnLaunch != null) isLaunchEnabled = btnLaunch.IsEnabled;

            btnLaunch = new System.Windows.Controls.Button
            {
                Content = "Open Admin Panel",
                Height = 40,
                Background = GetThemeColor("#6366F1", "#4F46E5"),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand,
                IsEnabled = isLaunchEnabled
            };
            btnLaunch.Click += (s, e) => LaunchBrowser("http://localhost:5000");
            Grid.SetColumn(btnLaunch, 0);
            btnGrid.Children.Add(btnLaunch);

            System.Windows.Controls.Button btnClose = new System.Windows.Controls.Button
            {
                Content = "Stop Server & Exit",
                Height = 40,
                Background = GetThemeColor("#EF4444", "#DC2626"),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btnClose.Click += (s, e) => { isExiting = true; Close(); };
            Grid.SetColumn(btnClose, 2);
            btnGrid.Children.Add(btnClose);

            panel.Children.Add(btnGrid);
            
            AddThemeToggle(panel);
            Content = panel;
        }

        private void InitializeTray()
        {
            trayIcon = new NotifyIcon();
            trayIcon.Text = "TimePilot Attendance Server Manager";
            
            // Extract embedded Win32 EXE icon for System Tray
            try
            {
                trayIcon.Icon = System.Drawing.Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule.FileName);
            }
            catch
            {
                trayIcon.Icon = System.Drawing.SystemIcons.Application;
            }
            trayIcon.Visible = true;

            trayIcon.DoubleClick += (s, e) =>
            {
                Show();
                WindowState = WindowState.Normal;
                Activate();
            };

            var contextMenu = new System.Windows.Forms.ContextMenu();
            contextMenu.MenuItems.Add("Open Server Console", (s, e) =>
            {
                Show();
                WindowState = WindowState.Normal;
                Activate();
            });
            contextMenu.MenuItems.Add("Open Dashboard", (s, e) => LaunchBrowser("http://localhost:5000"));
            contextMenu.MenuItems.Add("Stop & Exit Server", (s, e) =>
            {
                isExiting = true;
                Close();
            });
            trayIcon.ContextMenu = contextMenu;
        }

        protected override void OnClosing(System.ComponentModel.CancelEventArgs e)
        {
            if (!isExiting)
            {
                e.Cancel = true;
                Hide();
                trayIcon.ShowBalloonTip(2000, "TimePilot Server Active", "The attendance server is still running in the background.", ToolTipIcon.Info);
            }
            else
            {
                StopBackendServer();
                trayIcon.Visible = false;
                trayIcon.Dispose();
                base.OnClosing(e);
            }
        }

        private void StartBackendServer()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string backendPath = Path.Combine(baseDir, backendExeName);

            if (!File.Exists(backendPath))
            {
                lblStatus.Text = "Backend binary missing";
                lblStatus.Foreground = GetColor("#EF4444");
                return;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(backendPath);
                psi.CreateNoWindow = true; // Hides the black terminal cmd window
                psi.UseShellExecute = false;
                psi.WorkingDirectory = baseDir;

                backendProcess = Process.Start(psi);
                
                // Let it spin up
                Thread.Sleep(1000);

                if (!backendProcess.HasExited)
                {
                    lblStatus.Text = "Running (Online)";
                    lblStatus.Foreground = GetColor("#10B981");
                    btnLaunch.IsEnabled = true;
                }
                else
                {
                    lblStatus.Text = "Failed to run server";
                    lblStatus.Foreground = GetColor("#EF4444");
                }
            }
            catch (Exception ex)
            {
                lblStatus.Text = "Start Error: " + ex.Message;
                lblStatus.Foreground = GetColor("#EF4444");
            }
        }

        private void StopBackendServer()
        {
            if (backendProcess != null && !backendProcess.HasExited)
            {
                try
                {
                    backendProcess.Kill();
                    backendProcess.Dispose();
                }
                catch { }
            }
        }

        private void LaunchBrowser(string url)
        {
            try
            {
                Process.Start(url);
            }
            catch { }
        }

        private string GetNetworkIpUrls()
        {
            string addresses = "";
            try
            {
                foreach (var ip in Dns.GetHostEntry(Dns.GetHostName()).AddressList)
                {
                    if (ip.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip))
                    {
                        if (addresses.Length > 0) addresses += "\n";
                        addresses += string.Format("http://{0}:5000", ip.ToString());
                    }
                }
            }
            catch { }

            return string.IsNullOrEmpty(addresses) ? "Disconnected from Network" : addresses;
        }

        private SolidColorBrush GetColor(string hex)
        {
            return new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        }
    }
}
