using System;
using System.IO;
using System.Linq;
using System.Text;
using DeltaForceMoss.Performance;

// 用真实的 MusicScore.Parse / Map 校验随包发行的内置曲谱：
// 字段严格性、词元合法性、音域、以及每个音都能落到键位。
var assembly = typeof(MusicScore).Assembly;
var resources = assembly.GetManifestResourceNames()
    .Where(name => name.StartsWith("builtin.", StringComparison.Ordinal))
    .OrderBy(name => name, StringComparer.Ordinal)
    .ToArray();

if (resources.Length == 0) throw new Exception("没有找到内置曲谱资源");

foreach (var resource in resources)
{
    using var stream = assembly.GetManifestResourceStream(resource)!;
    using var reader = new StreamReader(stream, Encoding.UTF8);
    var text = reader.ReadToEnd();

    MusicScore score;
    try
    {
        score = MusicScore.Parse(text);
    }
    catch (Exception ex)
    {
        throw new Exception($"内置曲谱 {resource} 解析失败：{ex.Message}");
    }

    int mapped = 0, rests = 0;
    foreach (var tone in score.Notes)
    {
        if (tone.Midi is int midi)
        {
            var fingering = MusicScore.Map(midi);   // 找不到指法会抛异常
            if (string.IsNullOrEmpty(fingering.Key)) throw new Exception($"MIDI {midi} 未给出键位");
            mapped++;
        }
        else rests++;
    }

    if (mapped == 0) throw new Exception($"内置曲谱 {resource} 没有任何可演奏音符");
    if (score.Bpm < 20 || score.Bpm > 400) throw new Exception($"BPM 越界：{score.Bpm}");
    if (score.TotalBeats <= 0) throw new Exception("总拍数必须为正");

    Console.WriteLine($"Builtin score OK: {score.Name} | {score.Bpm} BPM | {score.Meter} | " +
                      $"{mapped} notes + {rests} rests | {score.TotalBeats:0.###} beats | " +
                      $"{score.TotalBeats * 60 / score.Bpm:0.0}s @ {score.Bpm} BPM");
}

Console.WriteLine("Builtin scores parse, stay within C3-C6 and map every note to a key.");
