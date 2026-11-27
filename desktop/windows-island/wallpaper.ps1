param(
  [Parameter(Mandatory=$true)]
  [string]$Url
)

Add-Type -AssemblyName System.Windows.Forms

# Floating Desktop Widget ringan (420x320) di pojok kanan bawah — TANPA WorkerW/SetParent agar tidak pernah memblokir klik desktop!
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$widgetW = 420
$widgetH = 320
$posX = [Math]::Max(20, $area.Right - $widgetW - 20)
$posY = [Math]::Max(40, $area.Bottom - $widgetH - 20)

$edgePaths = @(
  "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
$edgeExe = $edgePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edgeExe) {
  $profileDir = Join-Path $env:TEMP "aiku-widget-edge-profile"
  $proc = Start-Process -FilePath $edgeExe -ArgumentList @(
    "--app=$Url",
    "--user-data-dir=`"$profileDir`"",
    "--window-position=$posX,$posY",
    "--window-size=$widgetW,$widgetH",
    "--disable-features=TranslateUI",
    "--no-first-run"
  ) -PassThru

  try {
    Wait-Process -Id $proc.Id
  } catch {}
}
