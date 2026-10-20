param([Parameter(Mandatory)][string]$Url, [string]$Title = 'Breathe', [int]$Width = 330, [int]$Height = 400)
# Opens $Url in a small Edge app window, bottom-right of the monitor in front, on top but never focused.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class BreathWindow {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  public static IntPtr Find(string title) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var s = new StringBuilder(256); GetWindowText(h, s, 256);
      if (s.ToString() == title) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$area = [System.Windows.Forms.Screen]::FromHandle([BreathWindow]::GetForegroundWindow()).WorkingArea
$x = $area.Right - $Width - 24
$y = $area.Bottom - $Height - 24
$key = 'SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe'
$edge = (Get-ItemProperty "HKLM:\$key" -ErrorAction SilentlyContinue).'(default)'
if (-not $edge) { $edge = (Get-ItemProperty "HKCU:\$key").'(default)' }
$dataDir = Join-Path $env:LOCALAPPDATA 'claude-breathe\edge' # its own Edge profile, so it never joins the person's browser
Start-Process $edge -ArgumentList "--app=$Url", "--user-data-dir=`"$dataDir`"", "--window-size=$Width,$Height",
  "--window-position=$x,$y", '--autoplay-policy=no-user-gesture-required', '--no-first-run', '--no-default-browser-check',
  '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'
# Windows keeps the foreground from Edge, so it opens behind the editor: pin it on top, still unfocused.
# Edge drops the pin now and then, so it is put back until the window closes (this script lives that long).
$deadline = (Get-Date).AddSeconds(15)
do { Start-Sleep -Milliseconds 100; $h = [BreathWindow]::Find($Title) } while ($h -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
if ($h -eq [IntPtr]::Zero) { throw "no '$Title' window after 15 s" }
while ([BreathWindow]::IsWindow($h)) {
  if (([BreathWindow]::GetWindowLong($h, -20) -band 8) -eq 0) { # WS_EX_TOPMOST gone
    [void][BreathWindow]::SetWindowPos($h, [IntPtr]::new(-1), 0, 0, 0, 0, 0x13) # HWND_TOPMOST; NOSIZE | NOMOVE | NOACTIVATE
  }
  Start-Sleep -Milliseconds 250
}
