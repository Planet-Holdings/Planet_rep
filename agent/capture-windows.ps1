# Planet Rep — workstation screenshot agent (Windows)
#
# Takes ONE screenshot per day, and only while this user is actually
# screen-sharing in Discord. The server decides; this script just asks.
#
# This is company monitoring software. Tell your team it is installed.
# It writes a plain-text log next to itself so anyone on the machine can see
# exactly when a screenshot was taken and where it went.
#
# Setup (run once, in PowerShell):
#   1. Fill in the three settings below.
#   2. Test it:      powershell -ExecutionPolicy Bypass -File .\capture-windows.ps1 -Once
#   3. Install it:   powershell -ExecutionPolicy Bypass -File .\capture-windows.ps1 -Install

param(
    [switch]$Once,     # take one decision/capture cycle then exit (for testing)
    [switch]$Install,  # register a scheduled task that runs this at logon
    [switch]$Uninstall
)

# ---------------------------------------------------------------------------
# SETTINGS — fill these in
# ---------------------------------------------------------------------------
$ServerUrl     = 'https://planetrep-production.up.railway.app'
$CaptureToken  = 'PASTE_CAPTURE_TOKEN_HERE'
$DiscordUserId = 'PASTE_THIS_REPS_DISCORD_USER_ID'
# ---------------------------------------------------------------------------

$ErrorActionPreference = 'Stop'
$ScriptPath = $MyInvocation.MyCommand.Path
$LogFile    = Join-Path (Split-Path $ScriptPath) 'capture-agent.log'
$TaskName   = 'PlanetRepCaptureAgent'

function Write-Log($Message) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $Message"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

if ($Install) {
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
        -Argument "-WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
        -Settings $settings -Description 'Planet Rep daily screenshot agent' -Force | Out-Null
    Write-Log "Installed scheduled task '$TaskName' (runs at logon)."
    Write-Log "Starting it now."
    Start-ScheduledTask -TaskName $TaskName
    exit 0
}

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Log "Removed scheduled task '$TaskName'."
    exit 0
}

if ($CaptureToken -like 'PASTE_*' -or $DiscordUserId -like 'PASTE_*') {
    Write-Log 'ERROR: Fill in $CaptureToken and $DiscordUserId at the top of this script first.'
    exit 1
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Take-Screenshot($Path) {
    # Captures every monitor into one image.
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
    $gfx = [System.Drawing.Graphics]::FromImage($bmp)
    $gfx.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $gfx.Dispose()
    $bmp.Dispose()
}

function Run-Cycle {
    $shouldUrl = "$ServerUrl/api/capture/should?userId=$DiscordUserId&token=$CaptureToken"
    try {
        $decision = Invoke-RestMethod -Uri $shouldUrl -Method Get -TimeoutSec 30
    } catch {
        Write-Log "Could not reach server: $($_.Exception.Message)"
        return 300
    }

    if (-not $decision.capture) {
        Write-Log "No capture needed ($($decision.reason))."
        return $decision.pollSeconds
    }

    $tmp = Join-Path $env:TEMP "planetrep-capture.png"
    try {
        Take-Screenshot $tmp
        $bytes = [System.IO.File]::ReadAllBytes($tmp)
        $host_ = $env:COMPUTERNAME
        $uploadUrl = "$ServerUrl/api/capture?userId=$DiscordUserId&token=$CaptureToken&host=$host_&platform=windows"
        Invoke-RestMethod -Uri $uploadUrl -Method Post -Body $bytes `
            -ContentType 'image/png' -TimeoutSec 60 | Out-Null
        Write-Log "Screenshot taken and uploaded while streaming in '$($decision.channelName)'."
    } catch {
        Write-Log "Capture/upload failed: $($_.Exception.Message)"
    } finally {
        Remove-Item $tmp -ErrorAction SilentlyContinue
    }
    return $decision.pollSeconds
}

Write-Log "Planet Rep capture agent started (user $DiscordUserId)."

if ($Once) {
    Run-Cycle | Out-Null
    exit 0
}

while ($true) {
    $sleep = Run-Cycle
    if (-not $sleep -or $sleep -lt 60) { $sleep = 300 }
    Start-Sleep -Seconds $sleep
}
