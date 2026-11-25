using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Media;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ElysiaDesktopPet
{
    internal static class Program
    {
        internal static readonly string LogPath = Path.Combine(Path.GetTempPath(), "elysia-desktop.log");
        [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();

        internal static void Log(string line)
        {
            try
            {
                File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss") + " " + line + "\r\n");
            }
            catch { }
        }

        [STAThread]
        public static void Main(string[] args)
        {
            Log("main start");
            try { SetProcessDPIAware(); } catch { }
            string api = "http://127.0.0.1:7823";
            string dsh = "";
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--api" && i + 1 < args.Length) api = args[i + 1];
                if (args[i] == "--dsh" && i + 1 < args.Length) dsh = args[i + 1];
            }
            try
            {
                bool created = false;
                var mutex = new System.Threading.Mutex(true, "ElysiaDesktopPet_SingleInstance", out created);
                if (!created)
                {
                    Log("already running");
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new PetForm(api, dsh));
                GC.KeepAlive(mutex);
                Log("run exit");
            }
            catch (Exception ex)
            {
                Log("main fail " + ex.ToString());
            }
        }
    }

    internal sealed class PetForm : Form
    {
        private const int WS_EX_LAYERED = 0x80000;
        private const int ULW_ALPHA = 2;
        private const int AC_SRC_ALPHA = 1;

        [StructLayout(LayoutKind.Sequential)]
        private struct POINT { public int X; public int Y; public POINT(int x, int y) { X = x; Y = y; } }
        [StructLayout(LayoutKind.Sequential)]
        private struct SIZE { public int cx; public int cy; public SIZE(int w, int h) { cx = w; cy = h; } }
        [StructLayout(LayoutKind.Sequential, Pack = 1)]
        private struct BLENDFUNCTION { public byte BlendOp; public byte BlendFlags; public byte SourceConstantAlpha; public byte AlphaFormat; }
        [StructLayout(LayoutKind.Sequential)]
        private struct BITMAPINFOHEADER
        {
            public int biSize; public int biWidth; public int biHeight; public short biPlanes; public short biBitCount;
            public int biCompression; public int biSizeImage; public int biXPelsPerMeter; public int biYPelsPerMeter;
            public int biClrUsed; public int biClrImportant;
        }
        [StructLayout(LayoutKind.Sequential)]
        private struct BITMAPINFO { public BITMAPINFOHEADER bmiHeader; public int bmiColors; }

        [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr hwnd);
        [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr hwnd, IntPtr hdc);
        [DllImport("user32.dll")] private static extern bool UpdateLayeredWindow(IntPtr hwnd, IntPtr hdcDst, ref POINT pptDst, ref SIZE psize, IntPtr hdcSrc, ref POINT pptSrc, int crKey, ref BLENDFUNCTION pblend, int dwFlags);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr hdc);
        [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr hdc);
        [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr obj);
        [DllImport("gdi32.dll")] private static extern IntPtr CreateDIBSection(IntPtr hdc, ref BITMAPINFO pbmi, uint usage, out IntPtr bits, IntPtr section, uint offset);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint flags);

        private readonly string api;
        private readonly string dshExe;
        private readonly HttpClient http = new HttpClient();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly Dictionary<string, Image> sprites = new Dictionary<string, Image>();
        private readonly Dictionary<string, Dictionary<string, string>> voiceBanks = new Dictionary<string, Dictionary<string, string>>();
        private readonly Dictionary<string, string[]> lines = new Dictionary<string, string[]>();
        private readonly Random rng = new Random();
        private readonly List<SoundPlayer> playing = new List<SoundPlayer>();
        private Font bubbleFont;
        private Font levelFont;
        private float scale = 1f;

        private string currentKey = "";
        private bool loaded;
        private bool busy;
        private bool moved;
        private Point downPoint;
        private Point dragStartScreen;
        private Point dragStartForm;
        private bool ttsOn = true;
        private bool soundOn = true;
        private bool debugOpenSettings;
        private bool debugOpenChat;
        private int level = 1;
        private string actionName = "";
        private int actionStep;
        private string bubbleTextValue = "";
        private bool bubbleVisible;
        private Timer bubbleTimer;
        private Timer poseTimer;
        private Timer actionTimer;
        private Timer actionStopTimer;
        private Timer walkTimer;
        private Timer renderTimer;
        private int walkStep;
        private int walkStartX;
        private int walkTargetX;
        private string walkPose = "walk_right";

        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= WS_EX_LAYERED;
                return cp;
            }
        }

        public PetForm(string api, string dshExe)
        {
            Program.Log("pet ctor " + api);
            this.api = api.TrimEnd('/');
            this.dshExe = dshExe;
            json.MaxJsonLength = int.MaxValue;
            json.RecursionLimit = 100;

            try
            {
                using (var g = Graphics.FromHwnd(IntPtr.Zero)) scale = g.DpiX / 96f;
            }
            catch { scale = 1f; }
            if (scale < 1f) scale = 1f;
            bubbleFont = new Font("Microsoft YaHei UI", 9f * scale, FontStyle.Regular, GraphicsUnit.Pixel);
            levelFont = new Font("Microsoft YaHei UI", 8f * scale, FontStyle.Regular, GraphicsUnit.Pixel);

            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.Manual;
            AutoScaleMode = AutoScaleMode.None;
            TopMost = true;
            ShowInTaskbar = false;
            MaximizeBox = false;
            MinimizeBox = false;
            ControlBox = false;
            ClientSize = new Size((int)(230 * scale), (int)(345 * scale));
            SetStyle(ControlStyles.Opaque, true);
            SetStyle(ControlStyles.UserPaint, true);
            SetStyle(ControlStyles.AllPaintingInWmPaint, true);
            Cursor = Cursors.Hand;
            ContextMenuStrip = BuildMenu();

            bubbleTimer = new Timer();
            bubbleTimer.Interval = 3500;
            bubbleTimer.Tick += delegate { bubbleVisible = false; bubbleTimer.Stop(); Render(); };

            poseTimer = new Timer();
            poseTimer.Tick += delegate
            {
                poseTimer.Stop();
                if (!busy) { currentKey = "ide"; Render(); }
            };

            actionTimer = new Timer();
            actionTimer.Interval = 150;
            actionTimer.Tick += ActionTick;

            actionStopTimer = new Timer();
            actionStopTimer.Interval = 2500;
            actionStopTimer.Tick += delegate
            {
                actionStopTimer.Stop();
                actionTimer.Stop();
                busy = false;
                currentKey = "ide";
                Render();
            };

            walkTimer = new Timer();
            walkTimer.Interval = 100;
            walkTimer.Tick += WalkTick;

            renderTimer = new Timer();
            renderTimer.Interval = 800;
            renderTimer.Tick += delegate { EnsureTopMost(); Render(); };

            LoadSettings();
            LoadPosition();
            debugOpenSettings = Array.IndexOf(Environment.GetCommandLineArgs(), "--settings") >= 0;
            debugOpenChat = Array.IndexOf(Environment.GetCommandLineArgs(), "--chat") >= 0;
            Load += delegate
            {
                Program.Log("loaded window=" + Width + "x" + Height);
                Render();
                renderTimer.Start();
                LoadSpritesAsync();
                LoadStatusAsync();
                if (debugOpenSettings) OpenSettings();
                if (debugOpenChat) OpenChat();
            };
            FormClosed += delegate { StopVoices(); };
        }

        private ContextMenuStrip BuildMenu()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("聊天…", null, delegate { OpenChat(); });
            menu.Items.Add("动一下", null, delegate { TriggerAction(); });
            menu.Items.Add("设置…", null, delegate { OpenSettings(); });
            menu.Items.Add("回到右下角", null, delegate { MoveHome(); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("关闭桌面版", null, delegate { Close(); });
            return menu;
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
        }

        protected override void OnPaint(PaintEventArgs e)
        {
        }

        private void Render()
        {
            if (!IsHandleCreated || Width <= 0 || Height <= 0) return;
            EnsureTopMost();
            try
            {
                using (var bmp = new Bitmap(Width, Height, PixelFormat.Format32bppPArgb))
                {
                    using (var g = Graphics.FromImage(bmp))
                    {
                        g.Clear(Color.Transparent);
                        g.SmoothingMode = SmoothingMode.AntiAlias;
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.TextRenderingHint = TextRenderingHint.AntiAlias;

                        if (bubbleVisible && bubbleTextValue.Length > 0) DrawBubble(g);
                        Image img;
                        if (currentKey.Length > 0 && sprites.TryGetValue(currentKey, out img) && img != null)
                        {
                            g.DrawImage(img, new Rectangle(S(10), S(105), S(210), S(210)));
                        }
                        DrawLevel(g);
                    }
                    PushLayered(bmp);
                }
            }
            catch (Exception ex)
            {
                Program.Log("render fail " + ex.Message);
            }
        }

        private int S(int v)
        {
            return (int)Math.Round(v * scale);
        }

        private void DrawLevel(Graphics g)
        {
            string text = "Lv." + level;
            SizeF size = g.MeasureString(text, levelFont);
            int w = (int)Math.Ceiling(size.Width) + S(16);
            int h = S(18);
            int x = (Width - w) / 2;
            int y = Height - S(27);
            using (var path = RoundRect(new Rectangle(x, y, w, h), S(9)))
            using (var fill = new SolidBrush(Color.FromArgb(210, 26, 20, 33)))
            {
                g.FillPath(fill, path);
            }
            g.DrawString(text, levelFont, new SolidBrush(Color.FromArgb(255, 255, 211, 234)), x + S(8), y + S(3));
        }

        private void DrawBubble(Graphics g)
        {
            int left = S(9);
            int maxWidth = S(212);
            int textWidth = maxWidth - S(24);
            SizeF measured = g.MeasureString(bubbleTextValue, bubbleFont, textWidth);
            int textHeight = Math.Max(S(18), (int)Math.Ceiling(measured.Height));
            int boxHeight = Math.Min(S(112), textHeight + S(18));
            int top = Math.Max(S(6), S(105) - boxHeight - S(6));
            var rect = new Rectangle(left, top, maxWidth, boxHeight);
            using (var path = RoundRect(rect, S(14)))
            {
                using (var shadow = new SolidBrush(Color.FromArgb(36, 80, 40, 70)))
                {
                    var shadowRect = new Rectangle(left + S(2), top + S(3), maxWidth, boxHeight);
                    using (var shadowPath = RoundRect(shadowRect, S(14))) g.FillPath(shadow, shadowPath);
                }
                using (var fill = new SolidBrush(Color.FromArgb(242, 255, 247, 253)))
                {
                    g.FillPath(fill, path);
                }
                using (var pen = new Pen(Color.FromArgb(170, 255, 150, 205), Math.Max(1, scale)))
                {
                    g.DrawPath(pen, path);
                }
                var textRect = new Rectangle(left + S(12), top + S(9), textWidth, boxHeight - S(14));
                g.DrawString(bubbleTextValue, bubbleFont, new SolidBrush(Color.FromArgb(255, 92, 55, 82)), textRect);
            }
        }

        private static GraphicsPath RoundRect(Rectangle rect, int radius)
        {
            var path = new GraphicsPath();
            int d = radius * 2;
            path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
            path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
            path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
            path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        private void EnsureTopMost()
        {
            if (!IsHandleCreated) return;
            // 0x0001 SWP_NOSIZE, 0x0002 SWP_NOMOVE, 0x0010 SWP_NOACTIVATE, HWND_TOPMOST = -1
            SetWindowPos(Handle, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
        }

        private void PushLayered(Bitmap bmp)
        {
            IntPtr screenDc = GetDC(IntPtr.Zero);
            IntPtr memDc = CreateCompatibleDC(screenDc);
            IntPtr hBitmap = IntPtr.Zero;
            IntPtr oldBitmap = IntPtr.Zero;
            try
            {
                BITMAPINFO bmi = new BITMAPINFO();
                bmi.bmiHeader.biSize = Marshal.SizeOf(typeof(BITMAPINFOHEADER));
                bmi.bmiHeader.biWidth = bmp.Width;
                bmi.bmiHeader.biHeight = -bmp.Height;
                bmi.bmiHeader.biPlanes = 1;
                bmi.bmiHeader.biBitCount = 32;
                bmi.bmiHeader.biCompression = 0;

                IntPtr bits;
                hBitmap = CreateDIBSection(screenDc, ref bmi, 0, out bits, IntPtr.Zero, 0);
                if (hBitmap == IntPtr.Zero) return;

                BitmapData data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppPArgb);
                try
                {
                    int bytes = Math.Abs(data.Stride) * bmp.Height;
                    byte[] buffer = new byte[bytes];
                    Marshal.Copy(data.Scan0, buffer, 0, bytes);
                    Marshal.Copy(buffer, 0, bits, bytes);
                }
                finally
                {
                    bmp.UnlockBits(data);
                }

                oldBitmap = SelectObject(memDc, hBitmap);
                POINT ptDst = new POINT(Left, Top);
                SIZE size = new SIZE(bmp.Width, bmp.Height);
                POINT ptSrc = new POINT(0, 0);
                BLENDFUNCTION blend = new BLENDFUNCTION();
                blend.BlendOp = 0;
                blend.BlendFlags = 0;
                blend.SourceConstantAlpha = 255;
                blend.AlphaFormat = AC_SRC_ALPHA;
                bool ok = UpdateLayeredWindow(Handle, screenDc, ref ptDst, ref size, memDc, ref ptSrc, 0, ref blend, ULW_ALPHA);
                if (!ok) Program.Log("ulw fail err=" + Marshal.GetLastWin32Error() + " hwnd=" + Handle + " size=" + size.cx + "x" + size.cy);
            }
            finally
            {
                if (oldBitmap != IntPtr.Zero) SelectObject(memDc, oldBitmap);
                if (hBitmap != IntPtr.Zero) DeleteObject(hBitmap);
                DeleteDC(memDc);
                ReleaseDC(IntPtr.Zero, screenDc);
            }
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            downPoint = e.Location;
            dragStartScreen = Cursor.Position;
            dragStartForm = Location;
            moved = false;
            Capture = true;
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            if (!Capture || e.Button != MouseButtons.Left) return;
            Point now = Cursor.Position;
            int dx = now.X - dragStartScreen.X;
            int dy = now.Y - dragStartScreen.Y;
            if (!moved && (Math.Abs(dx) > 3 || Math.Abs(dy) > 3)) moved = true;
            if (!moved) return;
            Location = new Point(dragStartForm.X + dx, dragStartForm.Y + dy);
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            if (e.Button != MouseButtons.Left) return;
            Capture = false;
            if (!moved && !busy) HandleClick(e.Location);
            if (moved) SavePosition();
        }

        private void HandleClick(Point p)
        {
            int px = p.X - S(10);
            int py = p.Y - S(105);
            int box = S(210);
            if (px < 0 || py < 0 || px > box || py > box) return;
            double x = px / (double)box;
            double y = py / (double)box;
            string category;
            string pose;
            if (x >= 0.28 && x <= 0.72 && y >= 0.10 && y <= 0.48) { category = "head"; pose = "blink"; }
            else if (x >= 0.38 && x <= 0.62 && y > 0.48 && y <= 0.72) { category = "heart"; pose = "shy"; }
            else if (y >= 0.28 && y <= 0.78 && (x < 0.32 || x > 0.68)) { category = "wings"; pose = "wings"; }
            else { category = "body"; pose = "happy"; }

            ShowPose(pose, 2000);
            ShowBubble(LineFor(category), 3500);
            PlayVoice(category);
            Touch();
        }

        private void ShowPose(string pose, int ms)
        {
            if (!sprites.ContainsKey(pose)) pose = "ide";
            currentKey = pose;
            Render();
            poseTimer.Stop();
            poseTimer.Interval = ms;
            poseTimer.Start();
        }

        private async void Touch()
        {
            try
            {
                var content = new StringContent("{}", Encoding.UTF8, "application/json");
                HttpResponseMessage response = await http.PostAsync(api + "/touch", content);
                string body = await response.Content.ReadAsStringAsync();
                var data = json.Deserialize<Dictionary<string, object>>(body);
                if (data.ContainsKey("level")) level = Convert.ToInt32(data["level"]);
                Render();
            }
            catch { }
        }

        private async void LoadStatusAsync()
        {
            try
            {
                string body = await http.GetStringAsync(api + "/status");
                var data = json.Deserialize<Dictionary<string, object>>(body);
                if (data.ContainsKey("companion"))
                {
                    var comp = data["companion"] as Dictionary<string, object>;
                    if (comp != null && comp.ContainsKey("level")) level = Convert.ToInt32(comp["level"]);
                }
                Render();
            }
            catch (Exception ex)
            {
                Program.Log("status fail " + ex.Message);
            }
        }

        private async void LoadSpritesAsync()
        {
            try
            {
                string body = await http.GetStringAsync(api + "/sprites");
                var data = json.Deserialize<Dictionary<string, object>>(body);
                var map = data.ContainsKey("sprites") ? data["sprites"] as Dictionary<string, object> : null;
                if (map == null) return;
                foreach (var pair in map)
                {
                    string b64 = pair.Value as string;
                    if (String.IsNullOrEmpty(b64)) continue;
                    try
                    {
                        byte[] bytes = Convert.FromBase64String(b64);
                        using (var ms = new MemoryStream(bytes))
                        {
                            using (var img = Image.FromStream(ms))
                            {
                                sprites[pair.Key] = new Bitmap(img);
                            }
                        }
                    }
                    catch { }
                }
                loaded = true;
                currentKey = "ide";
                Render();
                Program.Log("sprites " + sprites.Count + " hasIde=" + sprites.ContainsKey("ide"));
            }
            catch (Exception ex)
            {
                Program.Log("sprites fail " + ex.Message);
                ShowBubble("连不上本机接口：\n" + ex.Message, 8000);
            }
        }

        private string LineFor(string category)
        {
            if (!lines.ContainsKey(category))
            {
                try
                {
                    string body = http.GetStringAsync(api + "/lines?category=" + category).Result;
                    var data = json.Deserialize<Dictionary<string, object>>(body);
                    var raw = data.ContainsKey("lines") ? data["lines"] : null;
                    var list = raw as System.Collections.IList;
                    if (list != null)
                    {
                        var arr = new string[list.Count];
                        for (int i = 0; i < list.Count; i++) arr[i] = Convert.ToString(list[i]);
                        lines[category] = arr;
                    }
                }
                catch { }
            }
            string[] pool;
            if (lines.TryGetValue(category, out pool) && pool.Length > 0) return pool[rng.Next(pool.Length)];
            return "♪";
        }

        private async void PlayVoice(string category)
        {
            if (!soundOn) return;
            try
            {
                if (!voiceBanks.ContainsKey(category))
                {
                    string body = await http.GetStringAsync(api + "/voices?category=" + category);
                    var data = json.Deserialize<Dictionary<string, object>>(body);
                    var map = data.ContainsKey("voices") ? data["voices"] as Dictionary<string, object> : null;
                    var bank = new Dictionary<string, string>();
                    if (map != null)
                    {
                        foreach (var pair in map)
                        {
                            string b64 = pair.Value as string;
                            if (!String.IsNullOrEmpty(b64)) bank[pair.Key] = b64;
                        }
                    }
                    voiceBanks[category] = bank;
                }
                var voices = voiceBanks[category];
                if (voices.Count == 0) return;
                var keys = voices.Keys.ToList();
                string key = keys[rng.Next(keys.Count)];
                byte[] bytes = Convert.FromBase64String(voices[key]);
                var player = new SoundPlayer(new MemoryStream(bytes));
                playing.Add(player);
                if (playing.Count > 8) playing.RemoveAt(0);
                player.Play();
            }
            catch (Exception ex)
            {
                Program.Log("voice fail " + ex.Message);
            }
        }

        private void StopVoices()
        {
            foreach (var player in playing)
            {
                try { player.Stop(); } catch { }
            }
            playing.Clear();
        }

        private void TriggerAction()
        {
            if (!loaded || busy) return;
            busy = true;
            int pick = rng.Next(3);
            if (pick == 2) { Walk(); return; }
            actionName = pick == 0 ? "dance" : "action";
            actionStep = 0;
            currentKey = actionName + "_1";
            Render();
            actionTimer.Start();
            actionStopTimer.Start();
        }

        private void ActionTick(object sender, EventArgs e)
        {
            if (!busy) { actionTimer.Stop(); return; }
            actionStep = (actionStep + 1) % 4;
            string key = actionName + "_" + (actionStep + 1);
            if (sprites.ContainsKey(key)) currentKey = key;
            Render();
        }

        private void Walk()
        {
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            walkStartX = Left;
            walkTargetX = Left < area.Width / 2
                ? Math.Min(area.Right - Width - 12, Left + S(160))
                : Math.Max(area.Left + 12, Left - S(160));
            walkPose = walkTargetX > walkStartX ? "walk_right" : "walk_left";
            walkStep = 0;
            walkTimer.Start();
        }

        private void WalkTick(object sender, EventArgs e)
        {
            walkStep++;
            Left = walkStartX + (walkTargetX - walkStartX) * walkStep / 30;
            string key = walkPose + "_" + ((walkStep % 4) + 1);
            if (sprites.ContainsKey(key)) currentKey = key;
            Render();
            if (walkStep >= 30)
            {
                walkTimer.Stop();
                busy = false;
                currentKey = "ide";
                Render();
                SavePosition();
            }
        }

        private void ShowBubble(string text, int ms)
        {
            bubbleTextValue = text ?? "";
            bubbleVisible = true;
            bubbleTimer.Stop();
            bubbleTimer.Interval = Math.Max(1800, ms);
            bubbleTimer.Start();
            Render();
        }

        private void MoveHome()
        {
            // Screen.WorkingArea 在部分缩放环境下会比实际可视区大；这里再压一层
            // 绝对上限，保证任何分辨率下都不会把窗推到屏幕外。
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            int x = Math.Max(area.Left + 8, Math.Min(area.Right - 380, 1120));
            int y = Math.Max(area.Top + 8, Math.Min(area.Bottom - 470, 400));
            Location = new Point(x, y);
            Render();
            SavePosition();
        }

        private void ClampToScreen()
        {
            // 固定安全边界，避免 DPI 缩放把窗体推出可视区域。
            Rectangle area = Screen.PrimaryScreen.WorkingArea;
            int x = Math.Max(area.Left, Math.Min(Left, area.Right - 400));
            int y = Math.Max(area.Top, Math.Min(Top, area.Bottom - 480));
            Location = new Point(x, y);
        }

        private string ConfigDir()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string dir = Path.Combine(home, ".dsh", "dsh-elysia");
            if (!Directory.Exists(dir)) Directory.CreateDirectory(dir);
            return dir;
        }

        private void LoadPosition()
        {
            try
            {
                string path = Path.Combine(ConfigDir(), "desktop-pos.json");
                if (File.Exists(path))
                {
                    var data = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                    Location = new Point(Convert.ToInt32(data["left"]), Convert.ToInt32(data["top"]));
                    ClampToScreen();
                    return;
                }
            }
            catch { }
            MoveHome();
        }

        private void SavePosition()
        {
            try
            {
                var data = new Dictionary<string, object>();
                data["left"] = Left;
                data["top"] = Top;
                File.WriteAllText(Path.Combine(ConfigDir(), "desktop-pos.json"), json.Serialize(data));
            }
            catch { }
        }

        private void LoadSettings()
        {
            try
            {
                string path = Path.Combine(ConfigDir(), "desktop-settings.json");
                if (!File.Exists(path)) return;
                var data = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(path));
                ttsOn = data.ContainsKey("tts") ? Convert.ToBoolean(data["tts"]) : true;
                soundOn = data.ContainsKey("sound") ? Convert.ToBoolean(data["sound"]) : true;
            }
            catch { }
        }

        private void SaveSettings()
        {
            try
            {
                var data = new Dictionary<string, object>();
                data["tts"] = ttsOn;
                data["sound"] = soundOn;
                File.WriteAllText(Path.Combine(ConfigDir(), "desktop-settings.json"), json.Serialize(data));
            }
            catch { }
        }

        private void OpenChat()
        {
            var win = new ChatForm(this);
            win.Show();
            win.Activate();
        }

        internal async Task<string> Chat(string text)
        {
            var payload = new Dictionary<string, string>();
            payload["text"] = text;
            var content = new StringContent(json.Serialize(payload), Encoding.UTF8, "application/json");
            HttpResponseMessage response = await http.PostAsync(api + "/chat", content);
            string body = await response.Content.ReadAsStringAsync();
            var data = json.Deserialize<Dictionary<string, object>>(body);
            bool ok = data.ContainsKey("ok") && Convert.ToBoolean(data["ok"]);
            string reply = data.ContainsKey("text") ? Convert.ToString(data["text"]) : "她这次没说出话来。";
            ShowBubble(reply, 7000);
            if (ok && ttsOn) Speak(reply);
            return reply;
        }

        private void Speak(string text)
        {
            try
            {
                string copy = text;
                Task.Run(delegate
                {
                    try
                    {
                        using (var synth = new System.Speech.Synthesis.SpeechSynthesizer())
                        {
                            foreach (var voice in synth.GetInstalledVoices())
                            {
                                if (voice.Enabled && voice.VoiceInfo.Culture.Name.StartsWith("zh"))
                                {
                                    synth.SelectVoice(voice.VoiceInfo.Name);
                                    break;
                                }
                            }
                            synth.Rate = 0;
                            synth.SetOutputToDefaultAudioDevice();
                            synth.Speak(copy);
                        }
                    }
                    catch { }
                });
            }
            catch { }
        }

        private void OpenSettings()
        {
            var win = new SettingsForm(this);
            win.Show();
            win.Activate();
        }

        public bool TtsOn
        {
            get { return ttsOn; }
            set { ttsOn = value; SaveSettings(); }
        }

        public float UiScale
        {
            get { return scale; }
        }

        public bool SoundOn
        {
            get { return soundOn; }
            set { soundOn = value; SaveSettings(); }
        }

        public void OpenDsh()
        {
            try
            {
                if (!String.IsNullOrEmpty(dshExe) && File.Exists(dshExe)) Process.Start(dshExe);
            }
            catch { }
        }

        public void MoveHomePublic()
        {
            MoveHome();
        }
    }

    internal sealed class ChatForm : Form
    {
        private readonly PetForm pet;
        private readonly RichTextBox history = new RichTextBox();
        private readonly TextBox input = new TextBox();
        private readonly Button send = new Button();
        private bool sending;

        private int P(int v)
        {
            return (int)Math.Round(v * pet.UiScale);
        }

        public ChatForm(PetForm pet)
        {
            this.pet = pet;
            float s = pet.UiScale;
            Text = "和爱莉希雅说一句";
            AutoScaleMode = AutoScaleMode.None;
            ClientSize = new Size(P(430), P(330));
            StartPosition = FormStartPosition.CenterScreen;
            TopMost = true;
            BackColor = Color.FromArgb(24, 20, 30);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;

            history.ReadOnly = true;
            history.BorderStyle = BorderStyle.None;
            history.BackColor = Color.FromArgb(24, 20, 30);
            history.ForeColor = Color.FromArgb(250, 235, 255);
            history.Font = new Font("Microsoft YaHei UI", 9.5F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            history.Dock = DockStyle.Fill;
            history.Location = new Point(0, 0);
            history.Size = new Size(P(430), P(282));

            var bar = new Panel();
            bar.Dock = DockStyle.Bottom;
            bar.Height = P(48);
            bar.BackColor = Color.FromArgb(24, 20, 30);
            input.Location = new Point(P(12), P(10));
            input.Size = new Size(P(318), P(27));
            input.Font = new Font("Microsoft YaHei UI", 9.5F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            input.KeyDown += delegate(object s2, KeyEventArgs e) { if (e.KeyCode == Keys.Enter) { SendAsync(); e.SuppressKeyPress = true; } };
            send.Text = "发送";
            send.Font = new Font("Microsoft YaHei UI", 9.5F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            send.Location = new Point(P(340), P(9));
            send.Size = new Size(P(78), P(29));
            send.Click += delegate { SendAsync(); };
            bar.Controls.Add(input);
            bar.Controls.Add(send);

            Controls.Add(history);
            Controls.Add(bar);
            Load += delegate { input.Focus(); };
        }

        private async void SendAsync()
        {
            if (sending) return;
            string text = input.Text.Trim();
            if (text.Length == 0) return;
            sending = true;
            input.Text = "";
            history.AppendText((history.TextLength == 0 ? "" : "\n\n") + "你：" + text);
            string reply = await pet.Chat(text);
            history.AppendText("\n\n爱莉希雅：" + reply);
            history.ScrollToCaret();
            sending = false;
        }
    }

    internal sealed class SettingsForm : Form
    {
        private readonly PetForm pet;

        private int P(int v)
        {
            return (int)Math.Round(v * pet.UiScale);
        }

        public SettingsForm(PetForm pet)
        {
            this.pet = pet;
            float s = pet.UiScale;
            Text = "爱莉希雅的桌面设置";
            AutoScaleMode = AutoScaleMode.None;
            ClientSize = new Size(P(360), P(260));
            StartPosition = FormStartPosition.CenterScreen;
            TopMost = true;
            BackColor = Color.FromArgb(250, 244, 255);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            MinimizeBox = false;

            var title = new Label();
            title.Text = "桌面版爱莉希雅";
            title.Font = new Font("Microsoft YaHei UI", 12F * s, FontStyle.Bold, GraphicsUnit.Pixel);
            title.ForeColor = Color.FromArgb(45, 33, 53);
            title.Location = new Point(P(18), P(16));
            title.Size = new Size(P(300), P(28));

            var tts = new CheckBox();
            tts.Text = "聊天回复用系统语音念出来";
            tts.Font = new Font("Microsoft YaHei UI", 9F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            tts.Checked = pet.TtsOn;
            tts.Location = new Point(P(18), P(54));
            tts.Size = new Size(P(320), P(24));
            tts.CheckedChanged += delegate { pet.TtsOn = tts.Checked; };

            var sound = new CheckBox();
            sound.Text = "点击 / 拖拽播放原音台词语音";
            sound.Font = new Font("Microsoft YaHei UI", 9F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            sound.Checked = pet.SoundOn;
            sound.Location = new Point(P(18), P(82));
            sound.Size = new Size(P(320), P(24));
            sound.CheckedChanged += delegate { pet.SoundOn = sound.Checked; };

            var home = new Button();
            home.Text = "回到右下角";
            home.Font = new Font("Microsoft YaHei UI", 9F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            home.Location = new Point(P(18), P(120));
            home.Size = new Size(P(100), P(30));
            home.Click += delegate { pet.MoveHomePublic(); };

            var open = new Button();
            open.Text = "打开 DSH";
            open.Font = new Font("Microsoft YaHei UI", 9F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            open.Location = new Point(P(126), P(120));
            open.Size = new Size(P(100), P(30));
            open.Click += delegate { pet.OpenDsh(); };

            var close = new Button();
            close.Text = "关闭桌面版";
            close.Font = new Font("Microsoft YaHei UI", 9F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            close.Location = new Point(P(234), P(120));
            close.Size = new Size(P(100), P(30));
            close.Click += delegate { pet.Close(); };

            var tip = new Label();
            tip.Text = "关闭桌面版后，DSH 窗口内的桌宠会在下一次刷新时回来。";
            tip.Font = new Font("Microsoft YaHei UI", 8F * s, FontStyle.Regular, GraphicsUnit.Pixel);
            tip.ForeColor = Color.FromArgb(120, 105, 130);
            tip.Location = new Point(P(18), P(166));
            tip.Size = new Size(P(320), P(40));

            Controls.Add(title);
            Controls.Add(tts);
            Controls.Add(sound);
            Controls.Add(home);
            Controls.Add(open);
            Controls.Add(close);
            Controls.Add(tip);
        }
    }
}
