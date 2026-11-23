param(
  [ValidateSet("get", "toggle", "next", "prev")]
  [string]$Action = "get"
)

$ErrorActionPreference = "Stop"

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and
    $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -like "IAsyncOperation*"
  })[0]

  function Await-WinRt($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(2500) | Out-Null
    return $netTask.Result
  }

  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null
  $mgr = Await-WinRt ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $sess = $mgr.GetCurrentSession()

  if ($null -eq $sess) {
    Write-Output '{"active":false}'
    exit 0
  }

  if ($Action -eq "toggle") {
    [void](Await-WinRt ($sess.TryTogglePlayPauseAsync()) ([bool]))
  } elseif ($Action -eq "next") {
    [void](Await-WinRt ($sess.TrySkipNextAsync()) ([bool]))
  } elseif ($Action -eq "prev") {
    [void](Await-WinRt ($sess.TrySkipPreviousAsync()) ([bool]))
  }

  $info = Await-WinRt ($sess.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $pb = $sess.GetPlaybackInfo()
  $title = if ($info.Title) { [string]$info.Title } else { "" }
  $artist = if ($info.Artist) { [string]$info.Artist } else { "" }
  $status = if ($pb) { $pb.PlaybackStatus.ToString() } else { "Unknown" }

  if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($artist)) {
    Write-Output '{"active":false}'
    exit 0
  }

  @{
    active = $true
    title  = $title
    artist = $artist
    status = $status
  } | ConvertTo-Json -Compress
} catch {
  Write-Output '{"active":false}'
}
