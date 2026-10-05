using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace DeltaForceMoss.Performance;
public record Tone(int? Midi, double Beats, double Start);
public record Fingering(string Key, int Octave, bool Sharp);
public record MusicScore(string Name, int Bpm, string Meter, IReadOnlyList<Tone> Notes, double TotalBeats)
{
    public static MusicScore Parse(string text)
    {
        using var doc = JsonDocument.Parse(text.TrimStart('\uFEFF'));
        var root = doc.RootElement;
        if(root.ValueKind!=JsonValueKind.Object) throw new FormatException("曲谱必须是鼠鼠 JSON 对象");
        var fields = root.EnumerateObject().Select(x=>x.Name).ToArray();
        if(fields.Length!=5 || fields.Distinct().Count()!=5 || fields.Except(new[]{"Name","Score","Bpm","Meter","Enabled"}).Any()) throw new FormatException("曲谱必须包含且仅包含 Name、Score、Bpm、Meter、Enabled");
        var name=root.GetProperty("Name").GetString() ?? throw new FormatException("缺少曲名");
        var bpm=root.GetProperty("Bpm").GetInt32();
        var meter=root.GetProperty("Meter").GetString() ?? "";
        if(bpm<20||bpm>400)throw new FormatException("BPM 须为 20–400");
        if(!Regex.IsMatch(meter,@"^[1-9]\d*/(1|2|4|8|16|32|64)$"))throw new FormatException("拍号无效");
        if(!root.GetProperty("Enabled").GetBoolean())throw new FormatException("曲谱 Enabled=false，未启用");
        var source=root.GetProperty("Score").GetString() ?? throw new FormatException("Score 必须是字符串");
        var notes=new List<Tone>();double start=0;
        foreach(var word in Regex.Split(source.Replace("|"," "),@"\s+").Where(x=>x.Length>0))
        {
            var m=Regex.Match(word,@"^([#b]?)([0-7])([',]?)(?::([0-9]+(?:\.[0-9]+)?))?$");
            if(!m.Success)throw new FormatException($"第 {notes.Count+1} 音格式错误：{word}");
            var degree=int.Parse(m.Groups[2].Value);
            if(degree==0&&(m.Groups[1].Length>0||m.Groups[3].Length>0))throw new FormatException("休止符不能升降或改变八度");
            var beats=m.Groups[4].Success?double.Parse(m.Groups[4].Value,CultureInfo.InvariantCulture):1;
            if(!double.IsFinite(beats)||beats<.03125||beats>64)throw new FormatException("时值须为 0.03125–64 拍");
            int? midi=degree==0?null:60+new[]{0,0,2,4,5,7,9,11}[degree]+(m.Groups[1].Value=="#"?1:m.Groups[1].Value=="b"?-1:0)+(m.Groups[3].Value=="'"?12:m.Groups[3].Value==","?-12:0);
            if(midi is not null)Map(midi.Value);
            notes.Add(new(midi,beats,start));start+=beats;
            if(notes.Count>20000)throw new FormatException("曲谱超过 20000 音上限");
        }
        if(notes.Count==0)throw new FormatException("曲谱为空");
        return new(name,bpm,meter,notes,start);
    }
    public static Fingering Map(int midi)
    {
        if(midi<48||midi>84)throw new FormatException($"MIDI {midi} 超出 C3–C6");
        if(midi==72)return new(",",0,false);
        var bases=new[]{60,62,64,65,67,69,71};var keys=new[]{"Z","X","C","V","B","N","M"};
        foreach(var octave in new[]{0,-1,1})
        for(var i=0;i<7;i++)foreach(var sharp in new[]{false,true})
            if(bases[i]+octave*12+(sharp?1:0)==midi)return new(keys[i],octave,sharp);
        throw new FormatException("无法找到指法");
    }
}
