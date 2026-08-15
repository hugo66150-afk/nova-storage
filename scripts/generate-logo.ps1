# Generate Nova Storage branding: nova.png (high-res) and nova.ico (multi-size).
# Matches the validated visual identity: violet gradient rounded square + "N".

Add-Type -AssemblyName System.Drawing

$root = "C:\Users\hugo6\Desktop\WorkflowIA\Nova Storage"
$pngPath = Join-Path $root "assets\branding\nova.png"
$icoPath = Join-Path $root "assets\branding\nova.ico"
$icoBuildPath = Join-Path $root "build\icon.ico"

function New-NovaBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded-rect path
    $radius = [int]($size * 0.22)
    $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Width - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Width - $d, $rect.Height - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Height - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    # Glow shadow
    $shadowPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 139, 92, 246)), ([float]($size * 0.09))
    $shadowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $g.DrawPath($shadowPen, $path)

    # Violet gradient (135deg: #7c3aed -> #a855f7 -> #c084fc)
    $pt1 = New-Object System.Drawing.PointF 0, 0
    $pt2 = New-Object System.Drawing.PointF $size, $size
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $pt1, $pt2, ([System.Drawing.Color]::FromArgb(255, 124, 58, 237)), ([System.Drawing.Color]::FromArgb(255, 192, 132, 252))
    $blend = New-Object System.Drawing.Drawing2D.ColorBlend
    $blend.Positions = @(0.0, 0.55, 1.0)
    $blend.Colors = @([System.Drawing.Color]::FromArgb(255, 124, 58, 237), [System.Drawing.Color]::FromArgb(255, 168, 85, 247), [System.Drawing.Color]::FromArgb(255, 192, 132, 252))
    $brush.InterpolationColors = $blend
    $g.FillPath($brush, $path)

    # White bold "N"
    $fontSize = [float]($size * 0.52)
    $font = New-Object System.Drawing.Font "Segoe UI", $fontSize, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $textBrush = [System.Drawing.Brushes]::White
    $g.DrawString("N", $font, $textBrush, (New-Object System.Drawing.RectangleF 0, ([float]($size*0.02)), $size, $size), $sf)

    $font.Dispose()
    $brush.Dispose()
    $path.Dispose()
    $shadowPen.Dispose()
    $g.Dispose()
    return $bmp
}

function Save-IcoMulti {
    param([string]$path, [int[]]$sizes)
    # ICO container: ICONDIR + ICONDIRENTRY per size + PNG data blocks
    $images = @()
    $dataBlocks = New-Object System.Collections.Generic.List[byte[]]
    foreach ($s in $sizes) {
        $bmp = New-NovaBitmap $s
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $images += @{ size = $s; data = $ms.ToArray() }
        $dataBlocks.Add($ms.ToArray())
        $ms.Dispose()
    }
    $out = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter $out
    # ICONDIR
    $bw.Write([UInt16]0)          # reserved
    $bw.Write([UInt16]1)          # type: icon
    $bw.Write([UInt16]$images.Count)  # count
    $offset = 6 + 16 * $images.Count
    for ($i = 0; $i -lt $images.Count; $i++) {
        $img = $images[$i]
        $s = $img.size
        $bw.Write([byte]($s -band 0xFF))    # width (0 means 256)
        $bw.Write([byte]($s -band 0xFF))    # height
        $bw.Write([byte]0)                  # palette
        $bw.Write([byte]0)                  # reserved
        $bw.Write([UInt16]1)                # color planes
        $bw.Write([UInt16]32)               # bpp
        $bw.Write([UInt32]$img.data.Length) # size of data
        $bw.Write([UInt32]$offset)          # offset in file
        $offset += $img.data.Length
    }
    foreach ($blk in $dataBlocks) {
        $bw.Write($blk)
    }
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($path, $out.ToArray())
    $bw.Dispose()
    $out.Dispose()
}

# High-res PNG (1024)
$bmp = New-NovaBitmap 1024
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# Multi-size ICO (16, 24, 32, 48, 64, 128, 256)
$sizes = @(16, 24, 32, 48, 64, 128, 256)
Save-IcoMulti -path $icoPath -sizes $sizes
Copy-Item $icoPath $icoBuildPath -Force

Write-Output "PNG: $pngPath"
Write-Output "ICO: $icoPath"
Write-Output "ICO build: $icoBuildPath"