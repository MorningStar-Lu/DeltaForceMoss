using System;
using System.Diagnostics;
using System.Threading;

namespace DeltaForceMoss.Performance;
public sealed class PerformancePlayer
{
    public double PositionSeconds {get;private set;}
    public void Reset()=>PositionSeconds=0;
    // 在单一工作线程同步调度，SK 设备只由该线程操作。
    public void Run(MusicScore score,IInputBackend backend,Func<bool> targetActive,CancellationToken token,Action<int,double> progress)
    {
        var start=PositionSeconds;var clock=Stopwatch.StartNew();var seconds=60d/score.Bpm;
        void Check(){token.ThrowIfCancellationRequested();if(!targetActive())throw new InvalidOperationException("目标窗口已切换，演奏停止");}
        void Wait(double until){while(start+clock.Elapsed.TotalSeconds<until){Check();token.WaitHandle.WaitOne(1);}}
        try{
            for(int i=0;i<score.Notes.Count;i++){
                var n=score.Notes[i];var at=n.Start*seconds;var end=at+n.Beats*seconds;
                if(end<=start)continue;
                Wait(at);Check();progress(i,Math.Max(at,start));
                if(n.Midi is int midi){
                    var f=MusicScore.Map(midi);
                    if(f.Octave!=0)backend.Mouse(f.Octave<0?0:2,true);
                    if(f.Sharp)backend.Mouse(1,true);
                    Check();backend.Key(f.Key,true);
                    // 重新触发的同音留短释放间隔；源延音应已合并。
                    Wait(end-Math.Min(.01,(end-Math.Max(at,start))*.1));
                    backend.ReleaseAll();
                }
                Wait(end);
            }
            PositionSeconds=score.TotalBeats*seconds;
        }
        finally{
            PositionSeconds=Math.Min(score.TotalBeats*seconds,start+clock.Elapsed.TotalSeconds);
            backend.ReleaseAll();
        }
    }
}
