using System;
using System.IO;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.Http;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using System.Windows.Forms;
using System.Threading.Tasks;

namespace TimePilotClient
{
    public class App : System.Windows.Application
    {
        private static Mutex mutex = null;

        [STAThread]
        public static void Main()
        {
            bool createdNew;
            mutex = new Mutex(true, "TimePilotAttendanceClient_Mutex_Unique_982741", out createdNew);

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
                        "TimePilot Attendance Client is already running (check your system tray near the clock).", 
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
        private string configPath;
        private string logPath;

        // Config variables
        private string serverUrl = "";
        private string employeeId = "";
        private string employeeName = "";
        private string employeeDesignation = "";
        private bool autoPopup = true;

        // UI Controls
        private Grid mainGrid;
        private StackPanel onboardingPanel;
        private StackPanel dashboardPanel;

        // Onboarding controls
        private System.Windows.Controls.TextBox txtServerUrl;
        private System.Windows.Controls.TextBox txtEmployeeId;
        private TextBlock lblSetupError;

        // Registration controls
        private System.Windows.Controls.TextBox txtRegServerUrl;
        private System.Windows.Controls.TextBox txtRegName;
        private System.Windows.Controls.TextBox txtRegDesignation;
        private System.Windows.Controls.TextBox txtRegPin;
        private TextBlock lblRegError;

        // Dashboard controls
        private TextBlock lblEmpName;
        private TextBlock lblEmpDesignation;
        private TextBlock lblClockStatus;
        private TextBlock lblScreenTime;
        private TextBlock lblTrayTip;
        private System.Windows.Controls.CheckBox chkStartup;

        // PIN Keypad Controls
        private Border pinModal;
        private TextBlock lblPinDisplay;
        private TextBlock lblPinError;
        private string currentPin = "";
        private string pinActionType = ""; // "in" or "out"
        private string currentClockStatus = "out"; // Tracks if they are checked in or out

        // Auto Discovery
        private UdpClient udpListener;
        private Thread udpThread;

        // Timers and Background tasks
        private DispatcherTimer statusTimer;
        private Thread trackingThread;
        private bool isRunning = true;
        private bool isServerOffline = false;

        // System Tray
        private NotifyIcon trayIcon;
        private bool isExiting = false;
        private bool isShuttingDownAfterClockOut = false;

        // Win32 API for Idle Time
        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        public MainWindow()
        {
            // Initialize paths relative to execution folder
            string exeDir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName);
            configPath = Path.Combine(exeDir, "client_config.json");
            logPath = Path.Combine(exeDir, "client_tracker_log.txt");

            InitializeWindow();
            InitializeTray();

            LoadConfiguration();

            // Always force auto-startup on boot unconditionally
            RegisterAutoStartup();

            bool isSilentStartup = false;
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i].Equals("--silent", StringComparison.OrdinalIgnoreCase))
                {
                    isSilentStartup = true;
                    break;
                }
            }

            if (string.IsNullOrEmpty(serverUrl) || string.IsNullOrEmpty(employeeId))
            {
                ShowOnboarding();
            }
            else
            {
                ShowDashboard();
                if (isSilentStartup)
                {
                    Hide();
                }
            }

            StartUdpListener();

            // Start status polling timer (polls every 15 seconds)
            statusTimer = new DispatcherTimer();
            statusTimer.Interval = TimeSpan.FromSeconds(15);
            statusTimer.Tick += StatusTimer_Tick;
            statusTimer.Start();

            // Start background active time tracking thread
            trackingThread = new Thread(BackgroundTrackingLoop);
            trackingThread.IsBackground = true;
            trackingThread.Start();

            // Register key input and shutdown hooks
            KeyDown += MainWindow_KeyDown;
            Microsoft.Win32.SystemEvents.SessionEnding += SystemEvents_SessionEnding;

            LogLocal("Client GUI application started.");
        }

        private bool isDarkMode = false;
        private string currentView = "onboarding";

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
                
                // Redraw active screen
                if (currentView == "dashboard") ShowDashboard();
                else if (currentView == "registration") ShowRegistration();
                else ShowOnboarding();
            };
            container.Children.Insert(0, btnToggle);
        }

        private void InitializeWindow()
        {
            Title = "TimePilot Attendance Portal";
            Width = 400;
            Height = 580;
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            ResizeMode = ResizeMode.NoResize; // Prevent manual resizing
            Topmost = false;
            ApplyThemeSettings();
            FontFamily = new System.Windows.Media.FontFamily("Segoe UI");

            // Extract embedded Win32 EXE icon for WPF Window
            try
            {
                var sysIcon = System.Drawing.Icon.ExtractAssociatedIcon(Process.GetCurrentProcess().MainModule.FileName);
                using (var ms = new MemoryStream())
                {
                    sysIcon.Save(ms);
                    ms.Seek(0, SeekOrigin.Begin);
                    Icon = System.Windows.Media.Imaging.BitmapFrame.Create(ms);
                }
            }
            catch {}

            mainGrid = new Grid();
            Content = mainGrid;
        }

        private void InitializeTray()
        {
            trayIcon = new NotifyIcon();
            trayIcon.Text = "TimePilot Attendance Portal";
            
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
            contextMenu.MenuItems.Add("Open Portal", (s, e) =>
            {
                Show();
                WindowState = WindowState.Normal;
                Activate();
            });
            contextMenu.MenuItems.Add("Exit", (s, e) =>
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
                if (currentClockStatus != "in" && autoPopup)
                {
                    e.Cancel = true;
                    
                    // Async check to see if the server is reachable
                    Task.Run(() =>
                    {
                        bool isOnline = false;
                        if (!string.IsNullOrEmpty(serverUrl))
                        {
                            try
                            {
                                using (HttpClient client = new HttpClient())
                                {
                                    client.Timeout = TimeSpan.FromSeconds(2);
                                    // A simple endpoint check
                                    var response = client.GetAsync(serverUrl + "/api/employees").Result;
                                    isOnline = response.IsSuccessStatusCode;
                                }
                            }
                            catch { isOnline = false; }
                        }

                        Dispatcher.Invoke(() =>
                        {
                            if (isOnline)
                            {
                                System.Windows.MessageBox.Show("The office server is online. You must Clock In before you can minimize or close the portal.", "Clock In Required", MessageBoxButton.OK, MessageBoxImage.Warning);
                            }
                            else
                            {
                                var res = System.Windows.MessageBox.Show("The server appears to be offline or unreachable. Do you want to force close the portal?", "Server Offline", MessageBoxButton.YesNo, MessageBoxImage.Question);
                                if (res == MessageBoxResult.Yes)
                                {
                                    isExiting = true;
                                    Close();
                                }
                            }
                        });
                    });
                    
                    return;
                }

                e.Cancel = true;
                Hide(); // Minimize to system tray
                trayIcon.ShowBalloonTip(2000, "TimePilot Running", "Minimized to System Tray. Activity is still being tracked.", ToolTipIcon.Info);
            }
            else
            {
                isRunning = false;
                if (udpListener != null) udpListener.Close();
                if (trayIcon != null)
                {
                    trayIcon.Visible = false;
                    trayIcon.Dispose();
                }
                Microsoft.Win32.SystemEvents.SessionEnding -= SystemEvents_SessionEnding;
                base.OnClosing(e);
            }
        }

        private void LoadConfiguration()
        {
            if (File.Exists(configPath))
            {
                try
                {
                    string json = File.ReadAllText(configPath);
                    serverUrl = ExtractJsonValue(json, "serverUrl");
                    employeeId = ExtractJsonValue(json, "employeeId");
                    employeeName = ExtractJsonValue(json, "employeeName");
                    employeeDesignation = ExtractJsonValue(json, "employeeDesignation");
                    string autoPopVal = ExtractJsonValue(json, "autoPopup");
                    autoPopup = string.IsNullOrEmpty(autoPopVal) || autoPopVal.ToLower() == "true";
                }
                catch (Exception ex)
                {
                    LogLocal("Config load error: " + ex.Message);
                }
            }
        }

        private void SaveConfiguration()
        {
            try
            {
                string configJson = string.Format(
                    "{{\n  \"serverUrl\": \"{0}\",\n  \"employeeId\": \"{1}\",\n  \"employeeName\": \"{2}\",\n  \"employeeDesignation\": \"{3}\",\n  \"autoPopup\": \"{4}\"\n}}",
                    serverUrl, employeeId, employeeName, employeeDesignation, autoPopup ? "true" : "false"
                );
                File.WriteAllText(configPath, configJson);
            }
            catch (Exception ex)
            {
                LogLocal("Config save error: " + ex.Message);
            }
        }

        private string ExtractJsonValue(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            // Match quoted string value: "key":"value" (using * to allow empty strings)
            Match match = Regex.Match(json, "\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
            if (match.Success) return match.Groups[1].Value;
            // Match unquoted numeric or boolean value: "key":5000 or "key":true
            Match numMatch = Regex.Match(json, "\"" + key + "\"\\s*:\\s*([\\w.]+)");
            return numMatch.Success ? numMatch.Groups[1].Value : "";
        }

        private void LogLocal(string msg)
        {
            try
            {
                File.AppendAllText(logPath, string.Format("[{0}] {1}\n", DateTime.Now.ToString(), msg));
            }
            catch { }
        }

        // --- ONBOARDING PANEL (SETUP) ---
        private void ShowOnboarding()
        {
            currentView = "onboarding";
            mainGrid.Children.Clear();

            onboardingPanel = new StackPanel { Margin = new Thickness(30), VerticalAlignment = VerticalAlignment.Center };

            // Banner Title
            onboardingPanel.Children.Add(new TextBlock
            {
                Text = "TimePilot Setup",
                FontSize = 26,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 5)
            });

            onboardingPanel.Children.Add(new TextBlock
            {
                Text = "Configure connection to your central office server",
                FontSize = 12,
                Foreground = GetThemeColor("#9CA3AF", "#475569"),
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 20)
            });

            // Server URL
            onboardingPanel.Children.Add(new TextBlock { Text = "Server Address / IP", FontSize = 12, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 5) });
            txtServerUrl = new System.Windows.Controls.TextBox
            {
                Text = "",
                Height = 35,
                VerticalContentAlignment = VerticalAlignment.Center,
                Padding = new Thickness(8, 0, 8, 0),
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                CaretBrush = GetThemeColor("#FFFFFF", "#0F172A"),
                Margin = new Thickness(0, 0, 0, 15)
            };
            onboardingPanel.Children.Add(txtServerUrl);

            // Employee ID
            onboardingPanel.Children.Add(new TextBlock { Text = "Employee ID", FontSize = 12, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 5) });
            txtEmployeeId = new System.Windows.Controls.TextBox
            {
                Text = "",
                Height = 35,
                VerticalContentAlignment = VerticalAlignment.Center,
                Padding = new Thickness(8, 0, 8, 0),
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                CaretBrush = GetThemeColor("#FFFFFF", "#0F172A"),
                Margin = new Thickness(0, 0, 0, 20)
            };
            onboardingPanel.Children.Add(txtEmployeeId);

            // Error Label
            lblSetupError = new TextBlock
            {
                Text = "",
                Foreground = GetThemeColor("#EF4444", "#DC2626"),
                FontSize = 12,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 15)
            };
            onboardingPanel.Children.Add(lblSetupError);

            // Verify Button
            System.Windows.Controls.Button btnVerify = new System.Windows.Controls.Button
            {
                Content = "Verify & Connect",
                Height = 40,
                Background = GetThemeColor("#6366F1", "#4F46E5"),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btnVerify.Click += BtnVerify_Click;
            onboardingPanel.Children.Add(btnVerify);

            // Register Link Label / Button
            System.Windows.Controls.Button btnGoToReg = new System.Windows.Controls.Button
            {
                Content = "New Employee? Register Here",
                Height = 30,
                Background = Brushes.Transparent,
                Foreground = GetThemeColor("#6366F1", "#4F46E5"),
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand,
                Margin = new Thickness(0, 10, 0, 0)
            };
            btnGoToReg.Click += (s, e) => ShowRegistration();
            onboardingPanel.Children.Add(btnGoToReg);

            AddThemeToggle(onboardingPanel);
            mainGrid.Children.Add(onboardingPanel);
        }

        private string WatermarkText() { return "emp_1"; }

        private void BtnVerify_Click(object sender, RoutedEventArgs e)
        {
            string url = txtServerUrl.Text.Trim();
            string empId = txtEmployeeId.Text.Trim();

            if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(empId))
            {
                lblSetupError.Text = "Please fill in all configuration parameters.";
                return;
            }

            if (!url.StartsWith("http://") && !url.StartsWith("https://"))
            {
                url = "http://" + url;
            }

            if (url.EndsWith("/")) url = url.Substring(0, url.Length - 1);

            lblSetupError.Text = "Connecting to server...";
            lblSetupError.Foreground = GetColor("#6366F1");

            // Perform check in a separate task to avoid freezing UI
            Task.Run(() =>
            {
                try
                {
                    using (HttpClient client = new HttpClient())
                    {
                        client.Timeout = TimeSpan.FromSeconds(5);
                        var response = client.GetAsync(url + "/api/employees").Result;
                        if (!response.IsSuccessStatusCode)
                        {
                            throw new Exception("HTTP Status " + response.StatusCode);
                        }

                        string json = response.Content.ReadAsStringAsync().Result;
                        
                        // Parse JSON manually to find employee matching ID
                        Match objMatch = Regex.Match(json, "\\{[^{}]*\"id\"\\s*:\\s*\"" + Regex.Escape(empId) + "\"[^{}]*\\}");
                        if (!objMatch.Success)
                        {
                            Dispatcher.Invoke(() =>
                            {
                                lblSetupError.Text = "Connected to server, but Employee ID not found.";
                                lblSetupError.Foreground = GetColor("#EF4444");
                            });
                            return;
                        }

                        string empJson = objMatch.Value;
                        string name = ExtractJsonValue(empJson, "name");
                        string designation = ExtractJsonValue(empJson, "designation");

                        // Save configuration
                        serverUrl = url;
                        employeeId = empId;
                        employeeName = name;
                        employeeDesignation = designation;

                        SaveConfiguration();
                        LogLocal("Tracker configured. Employee: " + employeeName);

                        Dispatcher.Invoke(() =>
                        {
                            ShowDashboard();
                        });
                    }
                }
                catch (Exception ex)
                {
                    Dispatcher.Invoke(() =>
                    {
                        lblSetupError.Text = "Server connection failed: " + ex.Message;
                        lblSetupError.Foreground = GetColor("#EF4444");
                    });
                }
            });
        }

        // --- DASHBOARD PANEL ---
        private void ShowDashboard()
        {
            currentView = "dashboard";
            mainGrid.Children.Clear();

            dashboardPanel = new StackPanel { Margin = new Thickness(25) };

            // User Info header
            Border userCard = new Border
            {
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(20),
                Margin = new Thickness(0, 10, 0, 20)
            };

            Grid cardGrid = new Grid();
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(60) });
            cardGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            // Avatar Initials
            string initials = "";
            string[] names = employeeName.Split(' ');
            foreach (var n in names) if (n.Length > 0) initials += n[0];
            if (initials.Length > 2) initials = initials.Substring(0, 2);

            Border avatar = new Border
            {
                Width = 48,
                Height = 48,
                CornerRadius = new CornerRadius(24),
                Background = new LinearGradientBrush(GetThemeColor("#6366F1", "#4F46E5").Color, GetThemeColor("#3B82F6", "#3B82F6").Color, 45.0),
                Child = new TextBlock
                {
                    Text = initials.ToUpper(),
                    FontWeight = FontWeights.Bold,
                    FontSize = 18,
                    Foreground = Brushes.White,
                    HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                    VerticalAlignment = VerticalAlignment.Center
                }
            };
            Grid.SetColumn(avatar, 0);
            cardGrid.Children.Add(avatar);

            // Names stack
            StackPanel nameStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
            lblEmpName = new TextBlock { Text = employeeName, FontSize = 16, FontWeight = FontWeights.Bold, Foreground = GetThemeColor("#F3F4F6", "#0F172A") };
            lblEmpDesignation = new TextBlock { Text = employeeDesignation, FontSize = 12, Foreground = GetThemeColor("#9CA3AF", "#475569") };
            nameStack.Children.Add(lblEmpName);
            nameStack.Children.Add(lblEmpDesignation);
            Grid.SetColumn(nameStack, 1);
            cardGrid.Children.Add(nameStack);

            userCard.Child = cardGrid;
            dashboardPanel.Children.Add(userCard);

            // Stats Card
            Border statsCard = new Border
            {
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(12),
                Padding = new Thickness(20),
                Margin = new Thickness(0, 0, 0, 20)
            };

            StackPanel statsStack = new StackPanel();
            
            // Status row
            Grid statusRow = new Grid { Margin = new Thickness(0, 0, 0, 10) };
            statusRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            statusRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            statusRow.Children.Add(new TextBlock { Text = "Clock Status:", Foreground = GetThemeColor("#9CA3AF", "#475569"), FontSize = 13 });
            lblClockStatus = new TextBlock { Text = "Loading...", FontWeight = FontWeights.Bold, FontSize = 13, TextAlignment = TextAlignment.Right };
            Grid.SetColumn(lblClockStatus, 1);
            statusRow.Children.Add(lblClockStatus);
            statsStack.Children.Add(statusRow);

            // Screen time row
            Grid screenRow = new Grid { Margin = new Thickness(0, 0, 0, 5) };
            screenRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            screenRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            screenRow.Children.Add(new TextBlock { Text = "Active Screen Today:", Foreground = GetThemeColor("#9CA3AF", "#475569"), FontSize = 13 });
            lblScreenTime = new TextBlock { Text = "0 mins", Foreground = GetThemeColor("#F3F4F6", "#0F172A"), FontWeight = FontWeights.Bold, FontSize = 13, TextAlignment = TextAlignment.Right };
            Grid.SetColumn(lblScreenTime, 1);
            screenRow.Children.Add(lblScreenTime);
            statsStack.Children.Add(screenRow);

            statsCard.Child = statsStack;
            dashboardPanel.Children.Add(statsCard);

            // Action Buttons
            Grid buttonGrid = new Grid { Margin = new Thickness(0, 0, 0, 20) };
            buttonGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            buttonGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            buttonGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            System.Windows.Controls.Button btnIn = new System.Windows.Controls.Button
            {
                Content = "Time In",
                Height = 42,
                Background = GetThemeColor("#10B981", "#059669"),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btnIn.Click += (s, e) => OpenPinPad("in");
            Grid.SetColumn(btnIn, 0);
            buttonGrid.Children.Add(btnIn);

            System.Windows.Controls.Button btnOut = new System.Windows.Controls.Button
            {
                Content = "Time Out",
                Height = 42,
                Background = GetThemeColor("#6366F1", "#4F46E5"),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btnOut.Click += (s, e) => OpenPinPad("out");
            Grid.SetColumn(btnOut, 2);
            buttonGrid.Children.Add(btnOut);

            dashboardPanel.Children.Add(buttonGrid);

            // Checkbox: Run at startup
            chkStartup = new System.Windows.Controls.CheckBox
            {
                Content = "Launch automatically on Windows startup",
                Foreground = GetThemeColor("#9CA3AF", "#475569"),
                FontSize = 12,
                VerticalContentAlignment = VerticalAlignment.Center,
                IsChecked = CheckStartupRegistered(),
                Margin = new Thickness(0, 0, 0, 15)
            };
            chkStartup.Click += ChkStartup_Click;
            dashboardPanel.Children.Add(chkStartup);

            // Checkbox: Auto Pop-up
            System.Windows.Controls.CheckBox chkAutoPopup = new System.Windows.Controls.CheckBox
            {
                Content = "Auto pop-up for Time In and Timeout",
                Foreground = GetThemeColor("#9CA3AF", "#475569"),
                FontSize = 12,
                VerticalContentAlignment = VerticalAlignment.Center,
                IsChecked = autoPopup,
                Margin = new Thickness(0, 0, 0, 15)
            };
            chkAutoPopup.Click += (s, e) => {
                autoPopup = chkAutoPopup.IsChecked == true;
                SaveConfiguration();
            };
            dashboardPanel.Children.Add(chkAutoPopup);

            // Info tips
            lblTrayTip = new TextBlock
            {
                Text = "Tip: Closing this window minimizes the app to the system tray. Background activity monitoring is active.",
                FontSize = 10,
                Foreground = GetThemeColor("#9CA3AF", "#475569"),
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center
            };
            dashboardPanel.Children.Add(lblTrayTip);

            AddThemeToggle(dashboardPanel);
            mainGrid.Children.Add(dashboardPanel);

            // Pre-assemble PIN keypad overlay (hidden by default)
            BuildPinModal();

            // Perform initial status fetch immediately
            PollStatus();
        }

        private void ChkStartup_Click(object sender, RoutedEventArgs e)
        {
            string runKeyPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
            string appName = "TimePilotAttendanceClient";
            string exePath = Process.GetCurrentProcess().MainModule.FileName;

            try
            {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(runKeyPath, true))
                {
                    if (key != null)
                    {
                        if (chkStartup.IsChecked == true)
                        {
                            // Add registry entry to run silently in background
                            key.SetValue(appName, string.Format("\"{0}\" --silent", exePath));
                            LogLocal("Auto-startup registered.");
                        }
                        else
                        {
                            // Remove entry
                            key.DeleteValue(appName, false);
                            LogLocal("Auto-startup unregistered.");
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                System.Windows.MessageBox.Show("Registry update error: " + ex.Message, "Permission Error");
            }
        }

        private bool CheckStartupRegistered()
        {
            string runKeyPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
            string appName = "TimePilotAttendanceClient";
            try
            {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(runKeyPath, false))
                {
                    return key.GetValue(appName) != null;
                }
            }
            catch
            {
                return false;
            }
        }

        // --- PIN KEYPAD MODAL DIALOG ---
        private void BuildPinModal()
        {
            pinModal = new Border
            {
                Background = new SolidColorBrush(isDarkMode ? Color.FromArgb(235, 18, 18, 20) : Color.FromArgb(240, 248, 250, 252)), // semi-transparent dark/light bg
                Visibility = Visibility.Collapsed,
                Padding = new Thickness(25, 20, 25, 20)
            };

            StackPanel pinStack = new StackPanel { VerticalAlignment = VerticalAlignment.Center, MaxWidth = 300 };

            pinStack.Children.Add(new TextBlock
            {
                Text = "Enter your 4-digit PIN",
                FontSize = 18,
                FontWeight = FontWeights.Bold,
                Foreground = GetThemeColor("#F3F4F6", "#0F172A"),
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 15)
            });

            // Display Box (Asterisks)
            lblPinDisplay = new TextBlock
            {
                Text = "",
                FontSize = 24,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                Foreground = GetThemeColor("#F3F4F6", "#0F172A"),
                Padding = new Thickness(20, 10, 20, 10),
                MinWidth = 120,
                TextAlignment = TextAlignment.Center,
                Margin = new Thickness(0, 0, 0, 5)
            };
            pinStack.Children.Add(lblPinDisplay);

            lblPinError = new TextBlock
            {
                Text = "",
                Foreground = GetThemeColor("#EF4444", "#DC2626"),
                FontSize = 12,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 15)
            };
            pinStack.Children.Add(lblPinError);

            // Keypad Grid
            Grid keyGrid = new Grid { HorizontalAlignment = System.Windows.HorizontalAlignment.Center };
            for (int i = 0; i < 3; i++) keyGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(55) });
            for (int i = 0; i < 4; i++) keyGrid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(45) });

            int key = 1;
            for (int r = 0; r < 3; r++)
            {
                for (int c = 0; c < 3; c++)
                {
                    string num = key.ToString();
                    var btn = CreateKeypadButton(num, () => AddPinDigit(num));
                    Grid.SetRow(btn, r);
                    Grid.SetColumn(btn, c);
                    keyGrid.Children.Add(btn);
                    key++;
                }
            }

            // Bottom row: Clear, 0, Backspace
            var btnClear = CreateKeypadButton("C", ClearPin);
            Grid.SetRow(btnClear, 3);
            Grid.SetColumn(btnClear, 0);
            keyGrid.Children.Add(btnClear);

            var btnZero = CreateKeypadButton("0", () => AddPinDigit("0"));
            Grid.SetRow(btnZero, 3);
            Grid.SetColumn(btnZero, 1);
            keyGrid.Children.Add(btnZero);

            var btnBack = CreateKeypadButton("<", BackspacePin);
            Grid.SetRow(btnBack, 3);
            Grid.SetColumn(btnBack, 2);
            keyGrid.Children.Add(btnBack);

            pinStack.Children.Add(keyGrid);

            // Actions: Submit, Cancel
            Grid actGrid = new Grid { Margin = new Thickness(0, 20, 0, 0) };
            actGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            actGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            actGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            System.Windows.Controls.Button btnCancel = new System.Windows.Controls.Button
            {
                Content = "Cancel",
                Height = 35,
                Background = GetThemeColor("#2D2D37", "#E2E8F0"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                FontWeight = FontWeights.Bold,
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                BorderThickness = new Thickness(1),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btnCancel.Click += (s, e) => ClosePinPad();
            Grid.SetColumn(btnCancel, 0);
            actGrid.Children.Add(btnCancel);

            System.Windows.Controls.Button btnOk = new System.Windows.Controls.Button
            {
                Content = "OK",
                Height = 35,
                Background = GetThemeColor("#6366F1", "#4F46E5"),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btnOk.Click += (s, e) => SubmitPin();
            Grid.SetColumn(btnOk, 2);
            actGrid.Children.Add(btnOk);

            pinStack.Children.Add(actGrid);

            pinModal.Child = pinStack;
            mainGrid.Children.Add(pinModal);
        }

        private System.Windows.Controls.Button CreateKeypadButton(string text, Action onClick)
        {
            var btn = new System.Windows.Controls.Button
            {
                Content = text,
                FontSize = 16,
                FontWeight = FontWeights.Bold,
                Background = GetThemeColor("#2A2A35", "#FFFFFF"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                BorderBrush = GetThemeColor("#121214", "#CBD5E1"),
                BorderThickness = new Thickness(1),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btn.Click += (s, e) => onClick();
            return btn;
        }

        private void OpenPinPad(string action)
        {
            currentPin = "";
            pinActionType = action;
            lblPinDisplay.Text = "";
            lblPinError.Text = "";
            pinModal.Visibility = Visibility.Visible;
        }

        private void ClosePinPad()
        {
            pinModal.Visibility = Visibility.Collapsed;
            isShuttingDownAfterClockOut = false; // Reset flag on cancel
        }

        private void MainWindow_KeyDown(object sender, System.Windows.Input.KeyEventArgs e)
        {
            if (pinModal != null && pinModal.Visibility == Visibility.Visible)
            {
                string digit = "";
                if (e.Key >= System.Windows.Input.Key.D0 && e.Key <= System.Windows.Input.Key.D9)
                {
                    digit = ((int)e.Key - (int)System.Windows.Input.Key.D0).ToString();
                }
                else if (e.Key >= System.Windows.Input.Key.NumPad0 && e.Key <= System.Windows.Input.Key.NumPad9)
                {
                    digit = ((int)e.Key - (int)System.Windows.Input.Key.NumPad0).ToString();
                }

                if (!string.IsNullOrEmpty(digit))
                {
                    AddPinDigit(digit);
                    e.Handled = true;
                    return;
                }

                if (e.Key == System.Windows.Input.Key.Back)
                {
                    BackspacePin();
                    e.Handled = true;
                    return;
                }

                if (e.Key == System.Windows.Input.Key.Escape)
                {
                    ClosePinPad();
                    e.Handled = true;
                    return;
                }

                if (e.Key == System.Windows.Input.Key.Enter)
                {
                    SubmitPin();
                    e.Handled = true;
                    return;
                }
            }
        }

        private void SystemEvents_SessionEnding(object sender, Microsoft.Win32.SessionEndingEventArgs e)
        {
            // Only intercept shutdown if the employee is currently clocked in and autoPopup is enabled
            if (currentClockStatus == "in" && autoPopup)
            {
                // Cancel Windows shutdown/log-off
                e.Cancel = true;

                // Force client window to restore and pop up on top (via UI dispatcher)
                Dispatcher.Invoke(() =>
                {
                    isShuttingDownAfterClockOut = true;

                    Show();
                    WindowState = WindowState.Normal;
                    Activate();
                    Topmost = true;

                    // Automatically open the PIN entry dialog in clock-out mode
                    OpenPinPad("out");
                });
            }
        }

        private void AddPinDigit(string d)
        {
            lblPinError.Text = "";
            if (currentPin.Length < 4)
            {
                currentPin += d;
                lblPinDisplay.Text = new string('•', currentPin.Length);
            }
        }

        private void ClearPin()
        {
            currentPin = "";
            lblPinDisplay.Text = "";
            lblPinError.Text = "";
        }

        private void BackspacePin()
        {
            lblPinError.Text = "";
            if (currentPin.Length > 0)
            {
                currentPin = currentPin.Substring(0, currentPin.Length - 1);
                lblPinDisplay.Text = new string('•', currentPin.Length);
            }
        }

        private void SubmitPin()
        {
            if (currentPin.Length < 4)
            {
                lblPinError.Text = "Please enter 4 digits.";
                return;
            }

            lblPinError.Text = "Submitting...";
            lblPinError.Foreground = GetColor("#6366F1");

            string endpoint = pinActionType == "in" ? "clock-in" : "clock-out";
            string url = string.Format("{0}/api/attendance/{1}", serverUrl, endpoint);

            Task.Run(() =>
            {
                try
                {
                    using (HttpClient client = new HttpClient())
                    {
                        var values = new System.Collections.Generic.Dictionary<string, string>
                        {
                            { "employeeId", employeeId },
                            { "pin", currentPin }
                        };
                        var content = new FormUrlEncodedContent(values);
                        
                        // Fallback payload using JSON if server expects raw application/json
                        var jsonContent = new StringContent(
                            string.Format("{{\"employeeId\":\"{0}\", \"pin\":\"{1}\"}}", employeeId, currentPin),
                            System.Text.Encoding.UTF8, "application/json"
                        );

                        var response = client.PostAsync(url, jsonContent).Result;
                        string resStr = response.Content.ReadAsStringAsync().Result;

                        bool success = resStr.Contains("\"success\":true");
                        string msg = "";
                        
                        Match errorMatch = Regex.Match(resStr, "\"message\":\"([^\"]+)\"");
                        if (errorMatch.Success) msg = errorMatch.Groups[1].Value;

                        Dispatcher.Invoke(() =>
                        {
                            if (success)
                            {
                                LogLocal(string.Format("Manual Clock-{0} success.", pinActionType.ToUpper()));
                                trayIcon.ShowBalloonTip(2000, "TimePilot Punch successful", string.Format("Clocked-{0} successfully!", pinActionType), ToolTipIcon.Info);
                                ClosePinPad();
                                PollStatus();

                                if (pinActionType == "out" && isShuttingDownAfterClockOut)
                                {
                                    try
                                    {
                                        Process.Start("shutdown", "/s /t 0");
                                    }
                                    catch (Exception ex)
                                    {
                                        LogLocal("Trigger shutdown failed: " + ex.Message);
                                    }
                                }
                            }
                            else
                            {
                                lblPinError.Text = string.IsNullOrEmpty(msg) ? "Incorrect PIN." : msg;
                                lblPinError.Foreground = GetColor("#EF4444");
                            }
                        });
                    }
                }
                catch (Exception ex)
                {
                    Dispatcher.Invoke(() =>
                    {
                        lblPinError.Text = "Connection error: " + ex.Message;
                        lblPinError.Foreground = GetColor("#EF4444");
                    });
                }
            });
        }

        // --- TIMER STATUS FETCHING ---
        private void StatusTimer_Tick(object sender, EventArgs e)
        {
            PollStatus();
        }

        private void PollStatus()
        {
            if (string.IsNullOrEmpty(serverUrl) || string.IsNullOrEmpty(employeeId)) return;

            string url = string.Format("{0}/api/employee-status?employeeId={1}", serverUrl, employeeId);
            Task.Run(() =>
            {
                try
                {
                    using (HttpClient client = new HttpClient())
                    {
                        client.Timeout = TimeSpan.FromSeconds(3);
                        var response = client.GetAsync(url).Result;
                        
                        if (response.StatusCode == HttpStatusCode.NotFound || (response.Content != null && response.Content.ReadAsStringAsync().Result.Contains("\"unregistered\":true")))
                        {
                            Dispatcher.Invoke(() =>
                            {
                                employeeId = "";
                                employeeName = "";
                                employeeDesignation = "";
                                SaveConfiguration();
                                ShowOnboarding();
                                if (lblSetupError != null)
                                {
                                    lblSetupError.Text = "Employee ID not found on server. Please enter a valid ID or register.";
                                    lblSetupError.Foreground = GetColor("#EF4444");
                                }
                            });
                            return;
                        }

                        if (response.IsSuccessStatusCode)
                        {
                            string json = response.Content.ReadAsStringAsync().Result;
                            
                            string status = ExtractJsonValue(json, "status");
                            string clockIn = ExtractJsonValue(json, "clockIn");
                            string clockOut = ExtractJsonValue(json, "clockOut");
                            
                            // Active minutes parsed as string / number
                            Match minMatch = Regex.Match(json, "\"activeMinutes\"\\s*:\\s*(\\d+)");
                            int mins = minMatch.Success ? int.Parse(minMatch.Groups[1].Value) : 0;

                            string displayStatus = status;
                            if (!string.IsNullOrEmpty(clockIn) && string.IsNullOrEmpty(clockOut))
                            {
                                displayStatus = string.Format("Checked In ({0})", clockIn.Length >= 5 ? clockIn.Substring(0, 5) : clockIn);
                            }
                            else if (!string.IsNullOrEmpty(clockIn) && !string.IsNullOrEmpty(clockOut))
                            {
                                displayStatus = string.Format("Checked Out ({0})", clockOut.Length >= 5 ? clockOut.Substring(0, 5) : clockOut);
                            }

                            Dispatcher.Invoke(() =>
                            {
                                lblClockStatus.Text = displayStatus;
                                if (displayStatus.Contains("Checked In"))
                                {
                                    lblClockStatus.Foreground = GetColor("#10B981");
                                    currentClockStatus = "in";
                                    Topmost = false; // Allow normal operation and minimizing
                                }
                                else
                                {
                                    lblClockStatus.Foreground = GetColor("#EF4444");
                                    currentClockStatus = "out";

                                    if (autoPopup)
                                    {
                                        Topmost = true; // Force overlay

                                        // Ensure window is visible and at front if clocked out (only after window is fully loaded)
                                        if (IsLoaded && (Visibility != Visibility.Visible || WindowState == WindowState.Minimized))
                                        {
                                            Show();
                                            WindowState = WindowState.Normal;
                                            Activate();
                                        }
                                    }
                                    else
                                    {
                                        Topmost = false;
                                    }
                                }

                                lblScreenTime.Text = mins + " mins";
                                isServerOffline = false;
                            });
                        }
                    }
                }
                catch
                {
                    isServerOffline = true;
                }
            });
        }

        private System.Collections.Generic.Dictionary<string, int> localAppUsage = new System.Collections.Generic.Dictionary<string, int>();
        private object appUsageLock = new object();

        private string GetActiveProcessName()
        {
            try
            {
                IntPtr hwnd = GetForegroundWindow();
                if (hwnd != IntPtr.Zero)
                {
                    uint pid;
                    GetWindowThreadProcessId(hwnd, out pid);
                    if (pid > 0)
                    {
                        Process proc = Process.GetProcessById((int)pid);
                        return proc.ProcessName;
                    }
                }
            }
            catch {}
            return "unknown";
        }

        private string BuildAppUsageJson()
        {
            lock (appUsageLock)
            {
                if (localAppUsage.Count == 0) return "{}";
                System.Text.StringBuilder sb = new System.Text.StringBuilder();
                sb.Append("{");
                bool first = true;
                foreach (var pair in localAppUsage)
                {
                    if (!first) sb.Append(",");
                    sb.Append(string.Format("\"{0}\":{1}", pair.Key, pair.Value));
                    first = false;
                }
                sb.Append("}");
                localAppUsage.Clear();
                return sb.ToString();
            }
        }

        // --- BACKGROUND ACTIVE TIME MONITORING LOOP ---
        private void BackgroundTrackingLoop()
        {
            // Initial boot buffer
            Thread.Sleep(10000);

            while (isRunning)
            {
                int totalActiveSeconds = 0;
                // Accumulate active window stats every 10 seconds for 5 minutes (30 iterations)
                for (int step = 0; step < 30 && isRunning; step++)
                {
                    try
                    {
                        bool isLocked = Process.GetProcessesByName("LogonUI").Length > 0;
                        uint idleSeconds = GetIdleTime();
                        bool isIdle = idleSeconds > 600;

                        if (currentClockStatus == "in" && !isLocked && !isIdle)
                        {
                            string procName = GetActiveProcessName();
                            if (!string.IsNullOrEmpty(procName) && procName != "unknown")
                            {
                                lock (appUsageLock)
                                {
                                    if (localAppUsage.ContainsKey(procName))
                                        localAppUsage[procName] += 10;
                                    else
                                        localAppUsage[procName] = 10;
                                }
                                totalActiveSeconds += 10;
                            }
                        }
                    }
                    catch {}

                    // Sleep 10 seconds (responsive to isRunning changes)
                    for (int s = 0; s < 10 && isRunning; s++)
                    {
                        Thread.Sleep(1000);
                    }
                }

                // If they did at least 30 seconds of work, report the ping and app usage
                if (totalActiveSeconds >= 30 && isRunning)
                {
                    try
                    {
                        string url = serverUrl + "/api/screen-ping";
                        using (HttpClient client = new HttpClient())
                        {
                            client.Timeout = TimeSpan.FromSeconds(5);
                            
                            // Send app usage in POST JSON payload
                            string jsonPayload = string.Format(
                                "{{\n  \"employeeId\": \"{0}\",\n  \"appUsage\": {1}\n}}",
                                employeeId, BuildAppUsageJson()
                            );
                            var content = new StringContent(jsonPayload, System.Text.Encoding.UTF8, "application/json");

                            var response = client.PostAsync(url, content).Result;
                            if (response.IsSuccessStatusCode)
                            {
                                string res = response.Content.ReadAsStringAsync().Result;
                                Match minMatch = Regex.Match(res, "\"activeMinutes\"\\s*:\\s*(\\d+)");
                                if (minMatch.Success)
                                {
                                    LogLocal("Status: Active. Ping sent. Daily active: " + minMatch.Groups[1].Value + " mins.");
                                    
                                    // Update display if window is open
                                    Dispatcher.Invoke(() =>
                                    {
                                        lblScreenTime.Text = minMatch.Groups[1].Value + " mins";
                                    });
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        LogLocal("Tracking background error: " + ex.Message);
                    }
                }
                else
                {
                    // Clear cache if idle or clocked out
                    lock (appUsageLock)
                    {
                        localAppUsage.Clear();
                    }
                }
            }
        }

        static uint GetIdleTime()
        {
            LASTINPUTINFO lii = new LASTINPUTINFO();
            lii.cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf(lii);
            if (GetLastInputInfo(ref lii))
            {
                uint uptime = (uint)Environment.TickCount;
                return (uptime - lii.dwTime) / 1000; // seconds
            }
            return 0;
        }

        private void ShowRegistration()
        {
            currentView = "registration";
            mainGrid.Children.Clear();

            StackPanel regPanel = new StackPanel { Margin = new Thickness(30), VerticalAlignment = VerticalAlignment.Center };

            // Banner Title
            regPanel.Children.Add(new TextBlock
            {
                Text = "Employee Registration",
                FontSize = 24,
                FontWeight = FontWeights.Bold,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 5)
            });

            regPanel.Children.Add(new TextBlock
            {
                Text = "Register yourself on the central attendance system",
                FontSize = 12,
                Foreground = GetThemeColor("#9CA3AF", "#475569"),
                TextWrapping = TextWrapping.Wrap,
                TextAlignment = TextAlignment.Center,
                HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
                Margin = new Thickness(0, 0, 0, 20)
            });

            // Server URL
            regPanel.Children.Add(new TextBlock { Text = "Server Address / IP", FontSize = 11, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 3) });
            txtRegServerUrl = new System.Windows.Controls.TextBox
            {
                Text = "",
                Height = 30,
                VerticalContentAlignment = VerticalAlignment.Center,
                Padding = new Thickness(6, 0, 6, 0),
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                CaretBrush = GetThemeColor("#FFFFFF", "#0F172A"),
                Margin = new Thickness(0, 0, 0, 4)
            };
            regPanel.Children.Add(txtRegServerUrl);

            // Scanning hint
            var lblScanHint = new TextBlock
            {
                Text = "📡 Scanning for server on your office network...",
                FontSize = 10,
                Foreground = GetThemeColor("#6366F1", "#4F46E5"),
                Margin = new Thickness(0, 0, 0, 10),
                TextWrapping = TextWrapping.Wrap
            };
            regPanel.Children.Add(lblScanHint);

            // Name
            regPanel.Children.Add(new TextBlock { Text = "Full Name", FontSize = 11, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 3) });
            txtRegName = new System.Windows.Controls.TextBox
            {
                Height = 30,
                VerticalContentAlignment = VerticalAlignment.Center,
                Padding = new Thickness(6, 0, 6, 0),
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                CaretBrush = GetThemeColor("#FFFFFF", "#0F172A"),
                Margin = new Thickness(0, 0, 0, 10)
            };
            regPanel.Children.Add(txtRegName);

            // Designation
            regPanel.Children.Add(new TextBlock { Text = "Designation (e.g. Sales, Developer)", FontSize = 11, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 3) });
            txtRegDesignation = new System.Windows.Controls.TextBox
            {
                Height = 30,
                VerticalContentAlignment = VerticalAlignment.Center,
                Padding = new Thickness(6, 0, 6, 0),
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                CaretBrush = GetThemeColor("#FFFFFF", "#0F172A"),
                Margin = new Thickness(0, 0, 0, 10)
            };
            regPanel.Children.Add(txtRegDesignation);

            // Set 4-digit PIN
            regPanel.Children.Add(new TextBlock { Text = "Set 4-digit Clock PIN", FontSize = 11, FontWeight = FontWeights.SemiBold, Margin = new Thickness(0, 0, 0, 3) });
            txtRegPin = new System.Windows.Controls.TextBox
            {
                Height = 30,
                VerticalContentAlignment = VerticalAlignment.Center,
                Padding = new Thickness(6, 0, 6, 0),
                Background = GetThemeColor("#1A1A1E", "#FFFFFF"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                CaretBrush = GetThemeColor("#FFFFFF", "#0F172A"),
                MaxLength = 4,
                Margin = new Thickness(0, 0, 0, 15)
            };
            regPanel.Children.Add(txtRegPin);

            // Error Label
            lblRegError = new TextBlock
            {
                Text = "",
                Foreground = GetThemeColor("#EF4444", "#DC2626"),
                FontSize = 11,
                TextAlignment = TextAlignment.Center,
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 0, 0, 10)
            };
            regPanel.Children.Add(lblRegError);

            // Submit & Cancel Buttons
            Grid btnGrid = new Grid();
            btnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            btnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(10) });
            btnGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            System.Windows.Controls.Button btnCancel = new System.Windows.Controls.Button
            {
                Content = "Back to Setup",
                Height = 35,
                Background = GetThemeColor("#2D2D37", "#E2E8F0"),
                Foreground = GetThemeColor("#FFFFFF", "#0F172A"),
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(1),
                BorderBrush = GetThemeColor("#313244", "#CBD5E1"),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btnCancel.Click += (s, e) => ShowOnboarding();
            Grid.SetColumn(btnCancel, 0);
            btnGrid.Children.Add(btnCancel);

            System.Windows.Controls.Button btnSubmit = new System.Windows.Controls.Button
            {
                Content = "Register Self",
                Height = 35,
                Background = GetThemeColor("#10B981", "#059669"),
                Foreground = Brushes.White,
                FontWeight = FontWeights.Bold,
                BorderThickness = new Thickness(0),
                Cursor = System.Windows.Input.Cursors.Hand
            };
            btnSubmit.Click += BtnRegisterSubmit_Click;
            Grid.SetColumn(btnSubmit, 2);
            btnGrid.Children.Add(btnSubmit);

            regPanel.Children.Add(btnGrid);
            
            AddThemeToggle(regPanel);
            mainGrid.Children.Add(regPanel);
        }

        private void BtnRegisterSubmit_Click(object sender, RoutedEventArgs e)
        {
            string url = txtRegServerUrl.Text.Trim();
            string name = txtRegName.Text.Trim();
            string designation = txtRegDesignation.Text.Trim();
            string pin = txtRegPin.Text.Trim();

            if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(name) || string.IsNullOrEmpty(pin))
            {
                lblRegError.Text = "Server URL, Name, and PIN are required.";
                lblRegError.Foreground = GetColor("#EF4444");
                return;
            }

            if (pin.Length != 4 || !Regex.IsMatch(pin, "^\\d{4}$"))
            {
                lblRegError.Text = "PIN must be exactly 4 digits.";
                lblRegError.Foreground = GetColor("#EF4444");
                return;
            }

            if (!url.StartsWith("http://") && !url.StartsWith("https://"))
            {
                url = "http://" + url;
            }
            if (url.EndsWith("/")) url = url.Substring(0, url.Length - 1);

            lblRegError.Text = "Registering on server...";
            lblRegError.Foreground = GetColor("#6366F1");

            Task.Run(() =>
            {
                try
                {
                    using (HttpClient client = new HttpClient())
                    {
                        client.Timeout = TimeSpan.FromSeconds(5);
                        
                        // Construct registration payload
                        string jsonPayload = string.Format(
                            "{{\n  \"name\": \"{0}\",\n  \"pin\": \"{1}\",\n  \"designation\": \"{2}\",\n  \"deviceId\": \"{3}\"\n}}",
                            name, pin, designation, Environment.MachineName
                        );
                        var content = new StringContent(jsonPayload, System.Text.Encoding.UTF8, "application/json");

                        var response = client.PostAsync(url + "/api/employees/register", content).Result;
                        string resStr = response.Content.ReadAsStringAsync().Result;

                        if (response.IsSuccessStatusCode && resStr.Contains("\"success\":true"))
                        {
                            // Extract registration values
                            string regId = ExtractJsonValue(resStr, "id");
                            string regName = ExtractJsonValue(resStr, "name");
                            string regDesig = ExtractJsonValue(resStr, "designation");

                            // Save configuration
                            serverUrl = url;
                            employeeId = regId;
                            employeeName = regName;
                            employeeDesignation = regDesig;

                            SaveConfiguration();
                            LogLocal("Employee registered self. ID: " + employeeId);

                            Dispatcher.Invoke(() =>
                            {
                                trayIcon.ShowBalloonTip(2000, "Registration successful", "You have registered successfully! ID: " + employeeId, ToolTipIcon.Info);
                                ShowDashboard();
                            });
                        }
                        else
                        {
                            Match errorMatch = Regex.Match(resStr, "\"message\":\"([^\"]+)\"");
                            string msg = errorMatch.Success ? errorMatch.Groups[1].Value : "Registration failed.";
                            Dispatcher.Invoke(() =>
                            {
                                lblRegError.Text = msg;
                                lblRegError.Foreground = GetColor("#EF4444");
                            });
                        }
                    }
                }
                catch (Exception ex)
                {
                    Dispatcher.Invoke(() =>
                    {
                        lblRegError.Text = "Server connection failed: " + ex.Message;
                        lblRegError.Foreground = GetColor("#EF4444");
                    });
                }
            });
        }

        private void RegisterAutoStartup()
        {
            string runKeyPath = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
            string appName = "TimePilotAttendanceClient";
            string exePath = Process.GetCurrentProcess().MainModule.FileName;

            try
            {
                using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(runKeyPath, true))
                {
                    if (key != null)
                    {
                        key.SetValue(appName, string.Format("\"{0}\" --silent", exePath));
                    }
                }
            }
            catch (Exception ex)
            {
                LogLocal("Registry auto-start update error: " + ex.Message);
            }
        }

        private void StartUdpListener()
        {
            udpThread = new Thread(() =>
            {
                try
                {
                    udpListener = new UdpClient();
                    udpListener.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                    udpListener.Client.Bind(new IPEndPoint(IPAddress.Any, 41234));

                    while (isRunning)
                    {
                        IPEndPoint remoteEP = new IPEndPoint(IPAddress.Any, 0);
                        byte[] bytes = udpListener.Receive(ref remoteEP);
                        string message = System.Text.Encoding.UTF8.GetString(bytes);

                        if (message.Contains("\"service\":\"TimePilot-Attendance\""))
                        {
                            string ip = remoteEP.Address.ToString();

                            // Port is a JSON number (unquoted), so use a numeric regex
                            Match portMatch = Regex.Match(message, "\"port\"\\s*:\\s*(\\d+)");
                            string port = portMatch.Success ? portMatch.Groups[1].Value : "5000";

                            string discoveredUrl = string.Format("http://{0}:{1}", ip, port);

                            Dispatcher.Invoke(() =>
                            {
                                bool shouldUpdateSetup = txtServerUrl != null && (string.IsNullOrEmpty(txtServerUrl.Text) || txtServerUrl.Text.EndsWith(":") || txtServerUrl.Text == "http://localhost:5000");
                                bool shouldUpdateReg = txtRegServerUrl != null && (string.IsNullOrEmpty(txtRegServerUrl.Text) || txtRegServerUrl.Text.EndsWith(":") || txtRegServerUrl.Text == "http://localhost:5000");

                                if (shouldUpdateSetup) txtServerUrl.Text = discoveredUrl;
                                if (shouldUpdateReg) txtRegServerUrl.Text = discoveredUrl;

                                // Auto-heal server URL if connection is lost and server moved to new IP
                                if (isServerOffline && !string.IsNullOrEmpty(serverUrl) && serverUrl != discoveredUrl)
                                {
                                    serverUrl = discoveredUrl;
                                    SaveConfiguration();
                                    LogLocal("Auto-healed server URL to discovered IP: " + serverUrl);
                                    PollStatus();
                                }
                            });
                        }
                    }
                }
                catch (Exception ex)
                {
                    LogLocal("UDP Discovery error: " + ex.Message);
                }
            });
            udpThread.IsBackground = true;
            udpThread.Start();
        }

        // Color Helper
        private SolidColorBrush GetColor(string hex)
        {
            return new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        }
    }
}
