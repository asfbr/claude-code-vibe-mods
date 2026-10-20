param([Parameter(Mandatory)][string]$Pattern, [Parameter(Mandatory)][int]$Cycles, [double]$Volume = 0.35,
  [Parameter(Mandatory)][long]$StartedAt)
# Plays the pane's drone: sounds/drone-<pattern>.wav stitched to $Cycles breaths (see scripts/drone.py),
# starting as far in as the pane already is. The mod ends this process when the pane closes early.
$ErrorActionPreference = 'Stop'
$cycle = @{ '4-6' = 10; 'box' = 16; '4-7-8' = 19 }[$Pattern]
if (-not $cycle) { throw "no pattern '$Pattern'" }
Add-Type -TypeDefinition @'
using System; using System.IO;
public static class Drone {
  const int Rate = 22050;
  static int At(double seconds) { return (int)Math.Round(seconds * Rate); }
  // Takes: intro + overlap, one breath + overlap (looped), the goodbye. Each crossfades over the overlap.
  public static byte[] Stitch(string path, int cycle, int cycles, double volume, double skip) {
    var raw = File.ReadAllBytes(path);
    var src = new short[(raw.Length - 44) / 2];
    Buffer.BlockCopy(raw, 44, src, 0, src.Length * 2);
    int intro = At(1.6), fade = At(0.2), breath = At(cycle), outro = At(3.2);
    var mix = new float[intro + cycles * breath + outro + fade];
    Action<int, int, int, bool> lay = (from, length, at, blend) => {
      for (int i = 0; i < length; i++) {
        double s = src[from + i] / 32768.0, k = blend && i < fade ? Math.Sin(Math.PI / 2 * i / fade) : 1;
        double prev = blend && i < fade ? mix[at + i] * Math.Cos(Math.PI / 2 * i / fade) : 0;
        mix[at + i] = (float)(prev + s * k);
      }
    };
    lay(0, intro + fade, 0, false);
    for (int c = 0; c < cycles; c++) lay(intro + fade, breath + fade, intro + c * breath, true);
    lay(intro + fade + breath + fade, outro, intro + cycles * breath, true);
    int start = Math.Min(mix.Length, Math.Max(0, At(skip))), n = mix.Length - start;
    var wav = new MemoryStream(); var w = new BinaryWriter(wav);
    w.Write("RIFF".ToCharArray()); w.Write(36 + n * 2); w.Write("WAVEfmt ".ToCharArray());
    w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(Rate); w.Write(Rate * 2); w.Write((short)2); w.Write((short)16);
    w.Write("data".ToCharArray()); w.Write(n * 2);
    for (int i = start; i < mix.Length; i++) w.Write((short)Math.Max(-32767, Math.Min(32767, mix[i] * volume * 32767)));
    return wav.ToArray();
  }
}
'@
$path = Join-Path $PSScriptRoot "..\sounds\drone-$Pattern.wav"
$skip = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $StartedAt) / 1000 # catch up with the picture
$bytes = [Drone]::Stitch((Resolve-Path $path).Path, $cycle, $Cycles, $Volume, $skip)
(New-Object Media.SoundPlayer([IO.MemoryStream]::new($bytes))).PlaySync()
