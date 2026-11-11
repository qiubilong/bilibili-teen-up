Add-Type -AssemblyName System.Drawing
$out = "E:\myGit\bilibili-teen-up\icons"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function New-Icon([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)

  # 渐变圆角背景
  $m = [Math]::Max(1.0, $size * 0.03)
  $r = $size * 0.22
  $bgPath = New-RoundRect $m $m ($size - 2 * $m) ($size - 2 * $m) $r
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
    [System.Drawing.Color]::FromArgb(251, 114, 153),
    [System.Drawing.Color]::FromArgb(0, 161, 214), 45)
  $g.FillPath($brush, $bgPath)

  # 白色盾牌
  $s = [float]$size
  $cx = $s / 2
  $top = $s * 0.24
  $bot = $s * 0.82
  $hw = $s * 0.25
  $mid = $top + ($bot - $top) * 0.5
  $shield = New-Object System.Drawing.Drawing2D.GraphicsPath
  $shield.AddLine($cx - $hw, $top, $cx + $hw, $top)
  $shield.AddLine($cx + $hw, $top, $cx + $hw, $mid)
  $shield.AddLine($cx + $hw, $mid, $cx, $bot)
  $shield.AddLine($cx, $bot, $cx - $hw, $mid)
  $shield.AddLine($cx - $hw, $mid, $cx - $hw, $top)
  $shield.CloseFigure()
  $g.FillPath([System.Drawing.Brushes]::White, $shield)

  # 粉色播放三角
  $cy = $s * 0.5
  $tri = New-Object System.Drawing.Drawing2D.GraphicsPath
  $tx = $cx - $s * 0.075
  $tri.AddLine($tx, $cy - $s * 0.12, $tx, $cy + $s * 0.12)
  $tri.AddLine($tx, $cy + $s * 0.12, $cx + $s * 0.14, $cy)
  $tri.CloseFigure()
  $pink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(251, 114, 153))
  $g.FillPath($pink, $tri)

  $g.Dispose()
  $bmp.Save("$out\icon$size.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "icon$size.png generated"
}

New-Icon 128
New-Icon 48
New-Icon 16
