Add-Type -AssemblyName System.Drawing
$ktalkRoot = Split-Path $PSScriptRoot -Parent
$ktalkAssets = Join-Path $ktalkRoot 'assets'
[IO.Directory]::CreateDirectory($ktalkAssets) | Out-Null
$ktalkImages = @()
foreach ($ktalkSize in @(16, 32, 48, 64, 128, 256)) {
    $bitmap = New-Object Drawing.Bitmap($ktalkSize, $ktalkSize)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([Drawing.Color]::Transparent)
    $scale = $ktalkSize / 256.0
    $graphics.ScaleTransform($scale, $scale)
    $shape = New-Object Drawing.Drawing2D.GraphicsPath
    $shape.AddArc(4, 4, 80, 80, 180, 90)
    $shape.AddArc(172, 4, 80, 80, 270, 90)
    $shape.AddArc(172, 172, 80, 80, 0, 90)
    $shape.AddArc(4, 172, 80, 80, 90, 90)
    $shape.CloseFigure()
    $brush = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#0c815e'))
    $graphics.FillPath($brush, $shape)
    $pen = New-Object Drawing.Pen([Drawing.Color]::White, 13)
    $pen.StartCap = $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $heights = @(38, 76, 124, 88, 148, 66, 32)
    for ($i = 0; $i -lt $heights.Count; $i++) {
        $x = 53 + $i * 25
        $graphics.DrawLine($pen, $x, 128 - $heights[$i] / 2, $x, 128 + $heights[$i] / 2)
    }
    $memory = New-Object IO.MemoryStream
    $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
    $ktalkImages += ,@{ Size = $ktalkSize; Bytes = $memory.ToArray() }
    if ($ktalkSize -eq 256) { $bitmap.Save((Join-Path $ktalkAssets 'icon.png'), [Drawing.Imaging.ImageFormat]::Png) }
    $memory.Dispose(); $pen.Dispose(); $brush.Dispose(); $shape.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
$file = [IO.File]::Create((Join-Path $ktalkAssets 'icon.ico'))
$writer = New-Object IO.BinaryWriter($file)
try {
    $writer.Write([UInt16]0); $writer.Write([UInt16]1); $writer.Write([UInt16]$ktalkImages.Count)
    $offset = 6 + $ktalkImages.Count * 16
    foreach ($entry in $ktalkImages) {
        $dimension = if ($entry.Size -eq 256) { 0 } else { $entry.Size }
        $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
        $writer.Write([byte]0); $writer.Write([byte]0); $writer.Write([UInt16]1); $writer.Write([UInt16]32)
        $writer.Write([UInt32]$entry.Bytes.Length); $writer.Write([UInt32]$offset)
        $offset += $entry.Bytes.Length
    }
    foreach ($entry in $ktalkImages) { $writer.Write([byte[]]$entry.Bytes) }
} finally { $writer.Dispose(); $file.Dispose() }
