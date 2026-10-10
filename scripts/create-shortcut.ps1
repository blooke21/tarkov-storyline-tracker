# Creates a "Tarkov Storyline Tracker" shortcut on the Desktop that runs launch.cmd.
# Run with: npm run shortcut
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Tarkov Storyline Tracker.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $projectRoot "launch.cmd"
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7  # minimized: the console window stays in the taskbar, out of the way
$shortcut.Description = "Starts the Tarkov Storyline Tracker and opens it in your browser"
$shortcut.Save()

Write-Host "Created shortcut: $shortcutPath"
