param(
  [Parameter(Mandatory=$true)]
  [string]$Url
)

Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class WallpaperWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern IntPtr FindWindowEx(IntPtr parentHandle, IntPtr childAfter, string lclassName, string windowTitle);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
    public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    public static void MakeFrameless(IntPtr hwnd) {
        const int GWL_STYLE = -16;
        const long WS_CAPTION = 0x00C00000L;
        const long WS_THICKFRAME = 0x00040000L;
        const long WS_MINIMIZEBOX = 0x00020000L;
        const long WS_MAXIMIZEBOX = 0x00010000L;
        const long WS_SYSMENU = 0x00080000L;
        long style = GetWindowLongPtr(hwnd, GWL_STYLE).ToInt64();
        style &= ~(WS_CAPTION | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_SYSMENU);
        SetWindowLongPtr(hwnd, GWL_STYLE, new IntPtr(style));
    }

    public static IntPtr GetWorkerW() {
        IntPtr progman = FindWindow("Progman", null);
        if (progman == IntPtr.Zero) return IntPtr.Zero;
        UIntPtr result;
        SendMessageTimeout(progman, 0x052C, new UIntPtr(0xD), new IntPtr(0x1), 0, 1000, out result);

        IntPtr workerw = IntPtr.Zero;
        EnumWindows((tophandle, topparamhandle) => {
            IntPtr p = FindWindowEx(tophandle, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (p != IntPtr.Zero) {
                workerw = FindWindowEx(IntPtr.Zero, tophandle, "WorkerW", null);
            }
            return true;
        }, IntPtr.Zero);

        if (workerw == IntPtr.Zero) {
            workerw = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
        }
        return workerw != IntPtr.Zero ? workerw : progman;
    }
}
"@

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$edgePaths = @(
  "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$edgeExe = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edgeExe) {
  $profileDir = Join-Path $env:TEMP "aiku-wallpaper-edge-profile"
  $proc = Start-Process -FilePath $edgeExe -ArgumentList @(
    "--app=$Url",
    "--user-data-dir=`"$profileDir`"",
    "--window-position=0,0",
    "--window-size=$($screen.Width),$($screen.Height)",
    "--disable-features=TranslateUI",
    "--no-first-run"
  ) -PassThru

  # Cari handle jendela berdasarkan judul "aiku Live Wallpaper Graph" atau MainWindowHandle
  $hwnd = [IntPtr]::Zero
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 120
    $hwnd = [WallpaperWin32]::FindWindow($null, "aiku Live Wallpaper Graph")
    if ($hwnd -eq [IntPtr]::Zero) {
      $proc.Refresh()
      $hwnd = $proc.MainWindowHandle
    }
    if ($hwnd -ne [IntPtr]::Zero) {
      $workerw = [WallpaperWin32]::GetWorkerW()
      if ($workerw -ne [IntPtr]::Zero) {
        [WallpaperWin32]::MakeFrameless($hwnd)
        [WallpaperWin32]::SetParent($hwnd, $workerw) | Out-Null
        [WallpaperWin32]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, $screen.Width, $screen.Height, 0x0064) | Out-Null
        break
      }
    }
  }

  try {
    Wait-Process -Id $proc.Id
  } catch {}
}
