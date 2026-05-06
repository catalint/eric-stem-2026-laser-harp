param([Parameter(Mandatory=$true)][string]$WavFile)

$ErrorActionPreference = 'Stop'

function Warmup-AudioStack {
    $rate = 44100
    $dataSize = [uint32]($rate * 2 * 0.05)
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter $ms
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes('RIFF'))
    $bw.Write([uint32](36 + $dataSize))
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes('WAVE'))
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes('fmt '))
    $bw.Write([uint32]16)
    $bw.Write([uint16]1)
    $bw.Write([uint16]1)
    $bw.Write([uint32]$rate)
    $bw.Write([uint32]($rate * 2))
    $bw.Write([uint16]2)
    $bw.Write([uint16]16)
    $bw.Write([System.Text.Encoding]::ASCII.GetBytes('data'))
    $bw.Write([uint32]$dataSize)
    $bw.Write([byte[]]::new($dataSize))
    $ms.Position = 0
    $silent = New-Object System.Media.SoundPlayer
    $silent.Stream = $ms
    $silent.Load()
    $silent.PlaySync()
}

$sp = New-Object System.Media.SoundPlayer $WavFile
$sp.Load()
Warmup-AudioStack

[Console]::Out.WriteLine("ready")
[Console]::Out.Flush()

while ($null -ne ($line = [Console]::In.ReadLine())) {
    $trimmed = $line.Trim()
    if ($trimmed -eq 'play') {
        $sp.Play()
    } elseif ($trimmed.StartsWith('load ')) {
        $newPath = $trimmed.Substring(5)
        $sp = New-Object System.Media.SoundPlayer $newPath
        $sp.Load()
    }
}
