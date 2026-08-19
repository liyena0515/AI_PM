$port = 8787
$htmlFile = Join-Path $PSScriptRoot "PM-RAG_standalone.html"

if (-not (Test-Path $htmlFile)) {
    Write-Host "ERROR: PM-RAG_standalone.html not found in this folder."
    Read-Host "Press Enter to exit"
    exit 1
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:" + $port + "/"
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    Write-Host "Failed to start server. Port may be in use."
    Write-Host "Try changing the port number at the top of this script."
    Read-Host "Press Enter to exit"
    exit 1
}

$bytes = [System.IO.File]::ReadAllBytes($htmlFile)

Write-Host ""
Write-Host "=========================================="
Write-Host "PM-RAG server started."
Write-Host "Open this address in your browser:"
Write-Host $prefix
Write-Host "Close this window to stop the server."
Write-Host "=========================================="
Write-Host ""

Start-Process $prefix

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $response = $context.Response
        try {
            $response.ContentType = "text/html; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } finally {
            $response.OutputStream.Close()
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
}