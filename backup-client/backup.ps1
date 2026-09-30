#requires -version 5.1
<#
  backup.ps1 - downloads a daily database backup from the app's own HTTPS backup
  endpoint and validates it before it is trusted. Meant to run once a day via
  register-task.ps1 (Windows Task Scheduler). See README.md in this folder for
  full setup steps.

  This machine never holds a database password. It only holds a single-purpose
  backup token (backup_token.txt) that can do nothing except call
  GET /api/backup/dump on the app's own server.
#>

# ----------------------------------------------------------------------------
# Configuration - edit these before first use
# ----------------------------------------------------------------------------
$AppName        = "alaa-eldin"
# Full HTTPS URL of the backup-download endpoint on the production server.
# Example: "https://alaa-eldin-production.up.railway.app/api/backup/dump"
$BackupUrl      = "https://CHANGE-ME.example.com/api/backup/dump"
$BackupRoot     = "D:\alaa-eldin-backups"
# Path to pg_restore.exe from a local PostgreSQL client install whose major
# version matches (or is newer than) the server's. Download the "binaries"
# zip (no installer needed) for Windows x64 from:
#   https://www.enterprisedb.com/download-postgresql-binaries
# and point this at the bin folder you unzip it into. Do NOT use an older
# client than the server - pg_restore refuses to read newer dump formats.
$PgRestoreExe   = "C:\PostgreSQL\16\bin\pg_restore.exe"
$RetainCount    = 30     # how many dumps to keep in dumps\ ; 0 = keep all forever
$TimeoutMinutes = 30     # per-attempt download timeout
$MaxAttempts    = 3
$RetryWaitsSec  = @(30, 120)   # wait after attempt 1 fails, then after attempt 2 fails
$NoRetryStatusCodes = @(401, 429, 503)

# ----------------------------------------------------------------------------
# Fixed paths - do not need to change
# ----------------------------------------------------------------------------
$DumpsDir  = Join-Path $BackupRoot "dumps"
$LogFile   = Join-Path $BackupRoot "backup.log"
$TokenFile = Join-Path $BackupRoot "backup_token.txt"

# ----------------------------------------------------------------------------
# Logging - never pass a token, password, or URL query string in here
# ----------------------------------------------------------------------------
function Write-Log {
    param([Parameter(Mandatory = $true)][string]$Message)
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    Add-Content -LiteralPath $LogFile -Value "[$timestamp] $Message" -Encoding UTF8
}

function Show-Notification {
    param([string]$Title, [string]$Message)
    # Best-effort only: a task run with no interactive desktop session (which
    # is normal for a scheduled task that fires at 03:15) cannot pop a toast,
    # so this never blocks the backup result on whether the user sees it -
    # the authoritative record is always backup.log.
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
        $texts = $template.GetElementsByTagName("text")
        $texts.Item(0).AppendChild($template.CreateTextNode($Title)) | Out-Null
        $texts.Item(1).AppendChild($template.CreateTextNode($Message)) | Out-Null
        $toast = [Windows.UI.Notifications.ToastNotification]::new($template)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("$AppName backup").Show($toast)
        return
    } catch {
        # fall through to the balloon-tip fallback below
    }
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $icon = New-Object System.Windows.Forms.NotifyIcon
        $icon.Icon = [System.Drawing.SystemIcons]::Warning
        $icon.Visible = $true
        $icon.ShowBalloonTip(10000, $Title, $Message, [System.Windows.Forms.ToolTipIcon]::Error)
        Start-Sleep -Seconds 1
        $icon.Dispose()
    } catch {
        # No interactive session available at all - backup.log is the source
        # of truth; nothing further to do here.
    }
}

function Fail-Run {
    param([Parameter(Mandatory = $true)][string]$Reason)
    Write-Log "FAILED - $Reason"
    Show-Notification -Title "$AppName backup failed" -Message $Reason
    exit 1
}

# ----------------------------------------------------------------------------
# Preconditions
# ----------------------------------------------------------------------------
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
New-Item -ItemType Directory -Force -Path $DumpsDir | Out-Null
if (-not (Test-Path $LogFile)) { New-Item -ItemType File -Path $LogFile | Out-Null }

Write-Log "starting backup run"
Write-Log "path: https"

if ($BackupUrl -like "*CHANGE-ME*") {
    Fail-Run "BackupUrl is still the placeholder - edit backup.ps1 and set the real production URL"
}
if (-not (Test-Path $TokenFile)) {
    Fail-Run "backup_token.txt not found in $BackupRoot - paste the backup token there (one line) first"
}
$token = (Get-Content -LiteralPath $TokenFile -TotalCount 1).Trim()
if ([string]::IsNullOrWhiteSpace($token)) {
    Fail-Run "backup_token.txt is empty"
}
if (-not (Test-Path $PgRestoreExe)) {
    Fail-Run "pg_restore.exe not found at configured path ($PgRestoreExe) - install a matching PostgreSQL client and fix the path at the top of this script"
}

# ----------------------------------------------------------------------------
# Download, streaming straight to a .part file on disk (never buffered fully
# in memory), with bounded retries. 401/429/503 are not retried: they mean
# "this will not succeed on retry right now" (bad/revoked token, rate limited,
# or server-side version mismatch), not a transient network blip.
# ----------------------------------------------------------------------------
$partPath = $null
$finalName = $null
$expectedSha256 = $null
$lastError = $null

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $req = [System.Net.HttpWebRequest]::Create($BackupUrl)
    $req.Method = "GET"
    $req.Headers.Add("Authorization", "Bearer $token")
    $req.Timeout = $TimeoutMinutes * 60 * 1000
    $req.ReadWriteTimeout = $TimeoutMinutes * 60 * 1000
    $req.AllowAutoRedirect = $false

    $resp = $null
    $statusCode = $null
    try {
        $resp = $req.GetResponse()
        $statusCode = [int]$resp.StatusCode
    } catch [System.Net.WebException] {
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            $_.Exception.Response.Close()
        }
        $lastError = "HTTP error on attempt $attempt (status: $statusCode): $($_.Exception.Message)"
    } catch {
        $lastError = "network error on attempt $attempt`: $($_.Exception.Message)"
    }

    if ($resp -and $statusCode -eq 200) {
        try {
            $contentDisposition = $resp.Headers["Content-Disposition"]
            $shaHeader = $resp.Headers["X-Backup-SHA256"]
            $expectedLength = $resp.ContentLength

            $nameMatch = [regex]::Match($contentDisposition, 'filename="([^"]+)"')
            if (-not $nameMatch.Success) { throw "response had no usable Content-Disposition filename" }
            $finalName = $nameMatch.Groups[1].Value
            if ([string]::IsNullOrWhiteSpace($shaHeader)) { throw "response had no X-Backup-SHA256 header" }
            $expectedSha256 = $shaHeader.Trim().ToLowerInvariant()

            $partPath = Join-Path $DumpsDir "$finalName.part"
            $outStream = [System.IO.File]::Create($partPath)
            $inStream = $resp.GetResponseStream()
            $buffer = New-Object byte[] 65536
            $totalRead = 0L
            try {
                while (($read = $inStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $outStream.Write($buffer, 0, $read)
                    $totalRead += $read
                }
            } finally {
                $outStream.Close()
                $inStream.Close()
            }
            $resp.Close()

            if ($expectedLength -gt 0 -and $totalRead -ne $expectedLength) {
                throw "downloaded $totalRead bytes but Content-Length said $expectedLength"
            }

            $actualSha256 = (Get-FileHash -LiteralPath $partPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualSha256 -ne $expectedSha256) {
                throw "SHA-256 mismatch: expected $expectedSha256, got $actualSha256"
            }

            Write-Log "downloaded size: $totalRead bytes"
            $lastError = $null
            break
        } catch {
            $lastError = "validation error on attempt $attempt`: $($_.Exception.Message)"
            if ($partPath -and (Test-Path $partPath)) { Remove-Item -LiteralPath $partPath -Force -ErrorAction SilentlyContinue }
            $partPath = $null
        }
    }

    if ($statusCode -in $NoRetryStatusCodes) {
        Fail-Run "server returned $statusCode - not retrying ($lastError)"
    }
    if ($attempt -lt $MaxAttempts) {
        $wait = $RetryWaitsSec[$attempt - 1]
        Write-Log "attempt $attempt failed ($lastError) - waiting ${wait}s before retry"
        Start-Sleep -Seconds $wait
    }
}

if (-not $partPath) {
    Fail-Run "download failed after $MaxAttempts attempts - $lastError"
}

# ----------------------------------------------------------------------------
# Validate the archive is real and complete before trusting it at all.
# "An untested backup is not a backup": we don't just check bytes arrived,
# we make pg_restore itself parse the whole table of contents.
# ----------------------------------------------------------------------------
$listOutput = & $PgRestoreExe --list $partPath 2>&1
if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $partPath -Force -ErrorAction SilentlyContinue
    Fail-Run "pg_restore --list failed against the downloaded file (exit $LASTEXITCODE) - archive is not trusted and was deleted"
}

$tableDataCount = ($listOutput | Select-String -Pattern "^\d+; \d+ \d+ TABLE DATA ").Count
if ($tableDataCount -eq 0) {
    Remove-Item -LiteralPath $partPath -Force -ErrorAction SilentlyContinue
    Fail-Run "pg_restore --list found zero TABLE DATA entries - archive looks empty or corrupt, deleted"
}

$versionLine = ($listOutput | Select-String -Pattern "Dumped from database version" | Select-Object -First 1)
if (-not $versionLine) {
    Remove-Item -LiteralPath $partPath -Force -ErrorAction SilentlyContinue
    Fail-Run "pg_restore --list output had no 'Dumped from database version' line - archive looks malformed, deleted"
}

Write-Log "pg_restore --list OK - tables with data: $tableDataCount"
Write-Log ($versionLine.Line.Trim() -replace '^;\s*', '')

# ----------------------------------------------------------------------------
# Only now, after every check has passed, does the file become a trusted dump.
# ----------------------------------------------------------------------------
$finalPath = Join-Path $DumpsDir $finalName
Move-Item -LiteralPath $partPath -Destination $finalPath -Force

# ----------------------------------------------------------------------------
# Retention
# ----------------------------------------------------------------------------
if ($RetainCount -gt 0) {
    $allDumps = Get-ChildItem -LiteralPath $DumpsDir -Filter "*.dump" | Sort-Object Name -Descending
    $toDelete = $allDumps | Select-Object -Skip $RetainCount
    foreach ($old in $toDelete) {
        Remove-Item -LiteralPath $old.FullName -Force -ErrorAction SilentlyContinue
    }
    if ($toDelete.Count -gt 0) {
        Write-Log "retention: deleted $($toDelete.Count) old dump(s), kept $RetainCount"
    }
}

Write-Log "finished successfully"
exit 0
