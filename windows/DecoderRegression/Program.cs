using System;
using System.Collections.Generic;
using DeltaForceMoss.Services;

foreach (int rate in new[] { 44100, 48000 })
foreach (int packetSize in new[] { 128, 480, 1024, 4096 })
foreach (double hz in new[] { 4150.0, 4200.0, 4350.0 })
{
    using var engine = new MorseDecoderEngine();
    string digits = "";
    engine.OnDigitsUpdated += value => digits = value;
    var audio = new List<float>();
    void Append(int ms, bool tone)
    {
        int count = rate * ms / 1000;
        for (int i = 0; i < count; i++)
            audio.Add(tone ? (float)(0.15 * Math.Sin(2 * Math.PI * hz * i / rate)) : 0);
    }
    Append(300, false);
    foreach (string group in new[] { "-----", "---..", "...--" })
    {
        foreach (char symbol in group)
        {
            Append(symbol == '.' ? 50 : 140, true);
            Append(symbol == '.' ? 250 : 160, false);
        }
        Append(300, false);
    }
    var samples = audio.ToArray();
    for (int start = 0; start < samples.Length; start += packetSize)
    {
        int count = Math.Min(packetSize, samples.Length - start);
        var packet = new float[count];
        Array.Copy(samples, start, packet, 0, count);
        engine.ProcessAudio(packet, count, rate);
    }
    if (digits != "083") throw new Exception($"{rate} Hz / {packetSize} samples / cue {hz} Hz: {digits}");
}
Console.WriteLine("Native decoder: synthetic 083 passed across sample rates, packet sizes and cue frequencies.");

// Synthetic effects, not recordings of the user's knife sound.
foreach (string scenario in new[] { "isolated", "wrong-cadence", "changing-frequency", "broadband" })
{
    using var engine = new MorseDecoderEngine();
    int updates = 0;
    engine.OnCandidatesUpdated += _ => updates++;
    const int rate = 48000;
    var samples = new List<float>();
    var random = new Random(83);
    for (int pulse = 0; pulse < (scenario == "isolated" ? 1 : 5); pulse++)
    {
        for (int i = 0; i < rate / 20; i++)
        {
            double hz = scenario == "changing-frequency" ? (pulse % 2 == 0 ? 4100 : 4400) : 4200;
            samples.Add(scenario == "broadband" ? (float)(random.NextDouble() - 0.5)
                : (float)(0.15 * Math.Sin(2 * Math.PI * hz * i / rate)));
        }
        int silenceMs = scenario == "wrong-cadence" ? 50 : 250;
        for (int i = 0; i < rate * silenceMs / 1000; i++) samples.Add(0);
    }
    var audio = samples.ToArray();
    engine.ProcessAudio(audio, audio.Length, rate);
    if (updates != 0) throw new Exception($"False Morse trace for synthetic {scenario}: {updates}");
}
Console.WriteLine("Synthetic isolated effects, irregular cadence, frequency changes and broadband noise rejected.");
