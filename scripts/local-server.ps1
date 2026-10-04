param(
    [string]$Root = "",
    [int]$Port = 4173
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Join-Path (Split-Path -Parent $PSScriptRoot) "offline-site"
}

$Root = [System.IO.Path]::GetFullPath($Root)
if (-not (Test-Path (Join-Path $Root "index.html") -PathType Leaf)) {
    Write-Host "ERROR: Offline site files were not found in: $Root" -ForegroundColor Red
    exit 1
}

$listener = $null
$activePort = $Port

for ($tryPort = $Port; $tryPort -lt ($Port + 10); $tryPort++) {
    try {
        $candidate = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Loopback,
            $tryPort
        )
        $candidate.Start()
        $listener = $candidate
        $activePort = $tryPort
        break
    }
    catch {
        if ($null -ne $candidate) {
            try { $candidate.Stop() } catch { }
        }
    }
}

if ($null -eq $listener) {
    Write-Host "ERROR: Ports $Port-$($Port + 9) are busy." -ForegroundColor Red
    exit 1
}

$url = "http://127.0.0.1:$activePort/"
Write-Host "Site is running: $url" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the local server." -ForegroundColor DarkGray
Write-Host ""

# Direct Excel file linking requires the File System Access API.
# Microsoft Edge is present on standard Windows installations; prefer it over
# the default browser so saving back to the same .xlsx file is available.
$browserCandidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$preferredBrowser = $browserCandidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($preferredBrowser) {
    Start-Process -FilePath $preferredBrowser -ArgumentList $url
}
else {
    Start-Process $url
}

function Get-ContentType([string]$Path) {
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { return "text/html; charset=utf-8" }
        ".js"   { return "text/javascript; charset=utf-8" }
        ".css"  { return "text/css; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".svg"  { return "image/svg+xml" }
        ".png"  { return "image/png" }
        ".jpg"  { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".webp" { return "image/webp" }
        ".ico"  { return "image/x-icon" }
        ".woff" { return "font/woff" }
        ".woff2" { return "font/woff2" }
        ".xlsx" { return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
        default  { return "application/octet-stream" }
    }
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()

        try {
            $stream = $client.GetStream()
            $reader = [System.IO.StreamReader]::new(
                $stream,
                [System.Text.Encoding]::ASCII,
                $false,
                1024,
                $true
            )

            $requestLine = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($requestLine)) {
                continue
            }

            while ($true) {
                $headerLine = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($headerLine)) { break }
            }

            $requestParts = $requestLine.Split(" ")
            if ($requestParts.Count -lt 2) {
                continue
            }

            $method = $requestParts[0].ToUpperInvariant()
            $rawPath = $requestParts[1].Split("?")[0]
            $relativePath = [System.Uri]::UnescapeDataString($rawPath).TrimStart([char]"/")

            if ([string]::IsNullOrWhiteSpace($relativePath)) {
                $relativePath = "index.html"
            }

            $relativePath = $relativePath.Replace(
                [char]"/",
                [System.IO.Path]::DirectorySeparatorChar
            )

            $trimCharacters = [char[]]@(
                [System.IO.Path]::DirectorySeparatorChar,
                [System.IO.Path]::AltDirectorySeparatorChar
            )
            $rootPrefix = $Root.TrimEnd($trimCharacters) + [System.IO.Path]::DirectorySeparatorChar

            $fullPath = [System.IO.Path]::GetFullPath(
                [System.IO.Path]::Combine($Root, $relativePath)
            )

            $status = "200 OK"
            $contentType = "application/octet-stream"
            $body = [byte[]]@()

            if (-not $fullPath.StartsWith(
                $rootPrefix,
                [System.StringComparison]::OrdinalIgnoreCase
            )) {
                $status = "403 Forbidden"
                $contentType = "text/plain; charset=utf-8"
                $body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
            }
            else {
                if (Test-Path $fullPath -PathType Container) {
                    $fullPath = Join-Path $fullPath "index.html"
                }

                if (-not (Test-Path $fullPath -PathType Leaf)) {
                    if ([string]::IsNullOrEmpty([System.IO.Path]::GetExtension($fullPath))) {
                        $fullPath = Join-Path $Root "index.html"
                    }
                    else {
                        $status = "404 Not Found"
                        $contentType = "text/plain; charset=utf-8"
                        $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
                    }
                }

                if ($status -eq "200 OK") {
                    $contentType = Get-ContentType $fullPath
                    $body = [System.IO.File]::ReadAllBytes($fullPath)
                }
            }

            $headers = (
                "HTTP/1.1 $status`r`n" +
                "Content-Type: $contentType`r`n" +
                "Content-Length: $($body.Length)`r`n" +
                "Cache-Control: no-cache`r`n" +
                "Connection: close`r`n`r`n"
            )

            $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
            $stream.Write($headerBytes, 0, $headerBytes.Length)

            if ($method -ne "HEAD" -and $body.Length -gt 0) {
                $stream.Write($body, 0, $body.Length)
            }

            $stream.Flush()
        }
        catch {
            Write-Host "Request error: $($_.Exception.Message)" -ForegroundColor Yellow
        }
        finally {
            $client.Close()
        }
    }
}
finally {
    if ($null -ne $listener) {
        $listener.Stop()
    }
}
