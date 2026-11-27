import { spawn } from "node:child_process";
import os from "node:os";
import { z } from "zod";

export interface SystemTelemetrySnapshot {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedGb: number;
  memoryTotalGb: number;
  netRxBytesPerSec: number;
  netTxBytesPerSec: number;
  powerStatus: "AC" | "Battery";
  batteryPercent: number;
  diskUsedPercent: number;
  diskFreeGb: number;
  volumePercent: number;
  volumeMuted: boolean;
}

export const LedgeControlActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("SET_VOLUME"), value: z.number().min(0).max(100) }),
  z.object({ action: z.literal("CYCLE_BRIGHTNESS") }),
  z.object({ action: z.literal("TAKE_SCREENSHOT") }),
  z.object({ action: z.literal("TOGGLE_DARK_MODE") }),
  z.object({ action: z.literal("LOCK_SCREEN") }),
  z.object({ action: z.literal("TOGGLE_KEEP_AWAKE"), enabled: z.boolean() }),
]);

export type LedgeControlAction = z.infer<typeof LedgeControlActionSchema>;

// Pure Node.js instant CPU delta tracker (0ms, zero child process!)
let prevCpuTotals: { idle: number; total: number } | null = null;

function sampleCpuPercentInstant(): number {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  if (!prevCpuTotals) {
    prevCpuTotals = { idle, total };
    return 8;
  }
  const dIdle = idle - prevCpuTotals.idle;
  const dTotal = total - prevCpuTotals.total;
  prevCpuTotals = { idle, total };
  if (dTotal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
}

const PS_TELEMETRY_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$bat = Get-CimInstance Win32_Battery
$batPct = if ($bat) { [int]$bat.EstimatedChargeRemaining } else { 100 }
$ac = if ($bat -and $bat.BatteryStatus -eq 1) { 'Battery' } else { 'AC' }

$disk = Get-PSDrive -Name C
$diskPct = 0
$diskFree = 0
if ($disk -and ($disk.Used + $disk.Free) -gt 0) {
  $diskPct = [int][Math]::Round(($disk.Used / ($disk.Used + $disk.Free)) * 100)
  $diskFree = [Math]::Round($disk.Free / 1GB, 1)
}

$rx = 0
$tx = 0
$stats = Get-NetAdapterStatistics | Where-Object { $_.ReceivedBytes -gt 0 }
foreach ($s in $stats) {
  $rx += [int64]$s.ReceivedBytes
  $tx += [int64]$s.SentBytes
}

@{
  batPct = $batPct
  ac = $ac
  diskPct = $diskPct
  diskFree = $diskFree
  rxTotal = $rx
  txTotal = $tx
} | ConvertTo-Json -Compress
`;

const CSHARP_AUDIO_HELPER = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i();
  int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
  int j();
  int GetMasterVolumeLevelScalar(out float pfLevel);
  int k(); int l(); int m(); int n();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
  int GetMute(out bool pbMute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int clsCtx, int activationParams, out IAudioEndpointVolume aev);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }

public static class AikuAudio {
  public static void SetVol(float level) {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev;
    enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid epvid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume epv;
    dev.Activate(ref epvid, 23, 0, out epv);
    epv.SetMute(level <= 0.005f, Guid.Empty);
    epv.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, level)), Guid.Empty);
  }
  public static int GetVol() {
    var enumerator = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator;
    IMMDevice dev;
    enumerator.GetDefaultAudioEndpoint(0, 1, out dev);
    Guid epvid = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume epv;
    dev.Activate(ref epvid, 23, 0, out epv);
    float v;
    epv.GetMasterVolumeLevelScalar(out v);
    return (int)Math.Round(v * 100f);
  }
}
"@ -ErrorAction SilentlyContinue
`;

function runSafePowerShell(script: string, timeoutMs = 4500): Promise<string> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve("");
      return;
    }
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
      { stdio: ["ignore", "pipe", "ignore"], windowsHide: true }
    );
    let out = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      resolve(out.trim());
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(out.trim());
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
  });
}

export class WindowsTelemetryService {
  private cachedSlow = {
    powerStatus: "AC" as "AC" | "Battery",
    batteryPercent: 100,
    diskUsedPercent: 50,
    diskFreeGb: 50,
    volumePercent: 60,
    volumeMuted: false,
    netRxBytesPerSec: 0,
    netTxBytesPerSec: 0,
  };
  private prevNetSample: { rx: number; tx: number; atMs: number } | null = null;
  private lastSlowRefreshMs = 0;
  private refreshing = false;
  private brightnessStep = 75;
  private awakeProc: ReturnType<typeof spawn> | null = null;

  public constructor() {
    // Prime initial CPU baseline
    sampleCpuPercentInstant();
  }

  private refreshSlowMetricsInBackground(): void {
    if (this.refreshing || process.platform !== "win32") return;
    if (Date.now() - this.lastSlowRefreshMs < 4000) return;
    this.refreshing = true;
    this.lastSlowRefreshMs = Date.now();

    const fullScript = `${CSHARP_AUDIO_HELPER}\n$vol = try { [AikuAudio]::GetVol() } catch { 60 }\n$raw = ${PS_TELEMETRY_SCRIPT}\nWrite-Output "$vol|$raw"`;

    void runSafePowerShell(fullScript, 4000)
      .then((output) => {
        if (!output) return;
        const pipeIdx = output.indexOf("|");
        if (pipeIdx === -1) return;
        const volStr = output.slice(0, pipeIdx).trim();
        const jsonStr = output.slice(pipeIdx + 1).trim();
        const volNum = Number(volStr);
        if (Number.isFinite(volNum)) {
          this.cachedSlow.volumePercent = Math.max(0, Math.min(100, Math.round(volNum)));
          this.cachedSlow.volumeMuted = this.cachedSlow.volumePercent === 0;
        }
        const parsed = JSON.parse(jsonStr) as {
          batPct?: number;
          ac?: string;
          diskPct?: number;
          diskFree?: number;
          rxTotal?: number;
          txTotal?: number;
        };
        if (typeof parsed.batPct === "number") {
          this.cachedSlow.batteryPercent = Math.max(0, Math.min(100, parsed.batPct));
        }
        this.cachedSlow.powerStatus = parsed.ac === "Battery" ? "Battery" : "AC";
        if (typeof parsed.diskPct === "number") {
          this.cachedSlow.diskUsedPercent = Math.max(0, Math.min(100, parsed.diskPct));
        }
        if (typeof parsed.diskFree === "number") {
          this.cachedSlow.diskFreeGb = parsed.diskFree;
        }
        const now = Date.now();
        if (typeof parsed.rxTotal === "number" && typeof parsed.txTotal === "number") {
          if (this.prevNetSample && now > this.prevNetSample.atMs) {
            const dtSec = (now - this.prevNetSample.atMs) / 1000;
            this.cachedSlow.netRxBytesPerSec = Math.max(
              0,
              Math.round((parsed.rxTotal - this.prevNetSample.rx) / dtSec)
            );
            this.cachedSlow.netTxBytesPerSec = Math.max(
              0,
              Math.round((parsed.txTotal - this.prevNetSample.tx) / dtSec)
            );
          }
          this.prevNetSample = { rx: parsed.rxTotal, tx: parsed.txTotal, atMs: now };
        }
      })
      .catch(() => {})
      .finally(() => {
        this.refreshing = false;
      });
  }

  public getSnapshot(): SystemTelemetrySnapshot {
    this.refreshSlowMetricsInBackground();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = Math.max(0, totalMem - freeMem);
    const memoryPercent = Math.max(1, Math.min(100, Math.round((usedMem / totalMem) * 100)));

    return {
      cpuPercent: sampleCpuPercentInstant(),
      memoryPercent,
      memoryUsedGb: Number((usedMem / 1024 ** 3).toFixed(1)),
      memoryTotalGb: Number((totalMem / 1024 ** 3).toFixed(1)),
      netRxBytesPerSec: this.cachedSlow.netRxBytesPerSec,
      netTxBytesPerSec: this.cachedSlow.netTxBytesPerSec,
      powerStatus: this.cachedSlow.powerStatus,
      batteryPercent: this.cachedSlow.batteryPercent,
      diskUsedPercent: this.cachedSlow.diskUsedPercent,
      diskFreeGb: this.cachedSlow.diskFreeGb,
      volumePercent: this.cachedSlow.volumePercent,
      volumeMuted: this.cachedSlow.volumeMuted,
    };
  }

  public async executeControl(cmd: LedgeControlAction): Promise<{ ok: boolean; message: string; value?: number }> {
    switch (cmd.action) {
      case "SET_VOLUME": {
        const clamped = Math.max(0, Math.min(100, Math.round(cmd.value)));
        this.cachedSlow.volumePercent = clamped;
        this.cachedSlow.volumeMuted = clamped === 0;
        const scalar = (clamped / 100).toFixed(3);
        await runSafePowerShell(`${CSHARP_AUDIO_HELPER}\n[AikuAudio]::SetVol(${scalar})`, 3000);
        return { ok: true, message: `Volume diatur ke ${clamped}%`, value: clamped };
      }

      case "CYCLE_BRIGHTNESS": {
        this.brightnessStep = this.brightnessStep >= 100 ? 25 : this.brightnessStep + 25;
        const target = this.brightnessStep;
        await runSafePowerShell(
          `(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue).WmiSetBrightness(1, ${target})`,
          3000
        );
        return { ok: true, message: `Kecerahan layar: ${target}%`, value: target };
      }

      case "TAKE_SCREENSHOT": {
        if (process.platform === "win32") {
          const child = spawn("explorer.exe", ["ms-screenclip:"], { detached: true, stdio: "ignore" });
          child.unref();
        }
        return { ok: true, message: "Membuka tangkapan layar Windows..." };
      }

      case "TOGGLE_DARK_MODE": {
        const out = await runSafePowerShell(
          `$p = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize'; $cur = (Get-ItemProperty -Path $p -Name AppsUseLightTheme).AppsUseLightTheme; $next = if ($cur -eq 0) { 1 } else { 0 }; Set-ItemProperty -Path $p -Name AppsUseLightTheme -Value $next; Set-ItemProperty -Path $p -Name SystemUsesLightTheme -Value $next; Write-Output $next`,
          3500
        );
        const isDark = out.trim() === "0";
        return { ok: true, message: isDark ? "Mode Gelap Windows aktif" : "Mode Terang Windows aktif" };
      }

      case "LOCK_SCREEN": {
        if (process.platform === "win32") {
          const child = spawn("rundll32.exe", ["user32.dll,LockWorkStation"], {
            detached: true,
            stdio: "ignore",
          });
          child.unref();
        }
        return { ok: true, message: "Mengunci layar..." };
      }

      case "TOGGLE_KEEP_AWAKE": {
        if (!cmd.enabled) {
          if (this.awakeProc && !this.awakeProc.killed) {
            try {
              this.awakeProc.kill();
            } catch {}
          }
          this.awakeProc = null;
          return { ok: true, message: "Mode Keep Awake dimatikan" };
        }
        if (process.platform === "win32" && (!this.awakeProc || this.awakeProc.killed)) {
          this.awakeProc = spawn(
            "powershell.exe",
            [
              "-NoProfile",
              "-WindowStyle",
              "Hidden",
              "-Command",
              `Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);' -Name WinAwake -Namespace Aiku; while ($true) { [Aiku.WinAwake]::SetThreadExecutionState(0x80000003) | Out-Null; Start-Sleep -Seconds 30 }`,
            ],
            { stdio: "ignore", windowsHide: true }
          );
          this.awakeProc.unref();
        }
        return { ok: true, message: "Keep Awake aktif — layar tidak akan tidur otomatis" };
      }
    }
  }
}
