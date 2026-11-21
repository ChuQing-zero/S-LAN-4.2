param([int]$x, [int]$y, [int]$clicks=1)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class MouseOps {
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
}
'@
for ($i=0; $i -lt $clicks; $i++) {
  [MouseOps]::mouse_event(0x0002, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 30
  [MouseOps]::mouse_event(0x0004, 0, 0, 0, 0)
  Start-Sleep -Milliseconds 200
}
